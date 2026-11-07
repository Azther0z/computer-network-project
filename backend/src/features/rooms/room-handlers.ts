import { requireActor } from '../auth/auth-context.js';
import { Storage } from '../../database/storage.js';
import {
  expectObject,
  expectString,
  RequestError,
  roomChannel,
  type Acknowledge,
} from '../../lib/protocol.js';
import { toPublicRoom, type PublicUser } from '../../lib/public-room.js';
import {
  DomainError,
  type AuthenticatedActor,
  type MessageRecord,
  type UserRecord,
} from '../../lib/types.js';

type RoomSocket = {
  data: { actor?: AuthenticatedActor };
  on(event: string, listener: (...args: unknown[]) => void): void;
  join(channel: string): void | Promise<void>;
};

type RoomBroadcaster = {
  to(channel: string): { emit(event: string, payload: unknown): void };
};

function expectAck(value: unknown): Acknowledge | undefined {
  return typeof value === 'function' ? (value as Acknowledge) : undefined;
}

type RoomHandlerDependencies = {
  isOnline(userId: string): boolean;
  toPublicUser(user: UserRecord): PublicUser;
  joinUserToRoom(userId: string, roomId: string): void;
  emitToUser(userId: string, event: string, payload: unknown): void;
  broadcastDirectories(): void;
  clearTyping(userId: string, roomId: string): void;
};

const defaultDependencies: RoomHandlerDependencies = {
  isOnline: () => false,
  toPublicUser: (user) => ({ userId: user.userId, name: user.name, online: false }),
  joinUserToRoom: () => {},
  emitToUser: () => {},
  broadcastDirectories: () => {},
  clearTyping: () => {},
};

function messageWithSenderName(message: MessageRecord, senderName: string) {
  return { ...message, senderName };
}

function acknowledge<T>(ack: Acknowledge | undefined, work: () => T): void {
  if (!ack) {
    return;
  }

  try {
    ack({ ok: true, data: work() });
  } catch (error) {
    ack({ ok: false, error: toProtocolError(error) });
  }
}

function toProtocolError(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError && error.code === 'USER_NOT_FOUND') {
    return { code: 'USER_OFFLINE', message: 'This user is currently offline.' };
  }
  if (error instanceof DomainError || error instanceof RequestError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' };
}

/**
 * Registers Poom-owned room/message commands. Guitar's auth handlers set
 * socket.data.actor; every command below derives authority only from that value.
 */
export function registerRoomHandlers(
  socket: RoomSocket,
  io: RoomBroadcaster,
  storage: Storage,
  suppliedDependencies: Partial<RoomHandlerDependencies> = {},
): void {
  const dependencies = { ...defaultDependencies, ...suppliedDependencies };

  socket.on('private.open', (payload, acknowledgement) => {
    acknowledge(expectAck(acknowledgement), () => {
      const actor = requireActor(socket);
      const input = expectObject(payload);
      const peerId = expectString(input.peerId, 'peerId');
      if (peerId === actor.userId) {
        throw new RequestError(
          'SELF_CHAT_NOT_ALLOWED',
          'You cannot open a private chat with yourself.',
        );
      }

      const existing = storage.findPrivateRoom(actor.userId, peerId);
      if (!existing && !dependencies.isOnline(peerId)) {
        throw new RequestError('USER_OFFLINE', 'This user is currently offline.');
      }
      const created = existing === undefined;
      const room = existing ?? storage.findOrCreatePrivateRoom(actor.userId, peerId);
      const publicRoom = toPublicRoom(storage, room, dependencies.toPublicUser);
      // Delivery channels are caches only. Put both live private members into the
      // new room after its persisted memberships have committed.
      void socket.join(roomChannel(room.roomId));
      dependencies.joinUserToRoom(actor.userId, room.roomId);
      dependencies.joinUserToRoom(peerId, room.roomId);
      if (created) {
        dependencies.emitToUser(actor.userId, 'private.opened', { room: publicRoom });
        dependencies.emitToUser(peerId, 'private.opened', { room: publicRoom });
      }
      return { room: publicRoom };
    });
  });

  socket.on('group.create', (payload, acknowledgement) => {
    acknowledge(expectAck(acknowledgement), () => {
      const actor = requireActor(socket);
      const input = expectObject(payload);
      const name = expectString(input.name, 'name').trim();
      if (name.length < 1 || name.length > 64) {
        throw new RequestError('INVALID_PAYLOAD', 'Group name must contain 1–64 characters.');
      }

      const group = storage.createGroup(actor.userId, name);
      void socket.join(roomChannel(group.roomId));
      const publicGroup = toPublicRoom(storage, group, dependencies.toPublicUser);
      dependencies.broadcastDirectories();
      return { group: publicGroup };
    });
  });

  socket.on('group.join', (payload, acknowledgement) => {
    acknowledge(expectAck(acknowledgement), () => {
      const actor = requireActor(socket);
      const input = expectObject(payload);
      const roomId = expectString(input.roomId, 'roomId');
      storage.joinGroup(actor.userId, roomId);
      const room = storage.getRoom(roomId);
      if (!room) {
        throw new DomainError('ROOM_NOT_FOUND', 'Room was not found.');
      }
      void socket.join(roomChannel(roomId));
      const publicGroup = toPublicRoom(storage, room, dependencies.toPublicUser);
      dependencies.broadcastDirectories();
      return { group: publicGroup };
    });
  });

  socket.on('room.send', (payload, acknowledgement) => {
    acknowledge(expectAck(acknowledgement), () => {
      const actor = requireActor(socket);
      const input = expectObject(payload);
      const roomId = expectString(input.roomId, 'roomId');
      const clientMessageId = expectString(input.clientMessageId, 'clientMessageId');
      const text = expectString(input.text, 'text');
      if (text.trim().length < 1 || text.length > 4_000) {
        throw new RequestError('INVALID_PAYLOAD', 'Message text must contain 1–4000 characters.');
      }

      const result = storage.sendMessage({ senderId: actor.userId, roomId, clientMessageId, text });
      const message = messageWithSenderName(result.message, actor.name);
      dependencies.clearTyping(actor.userId, roomId);
      if (!result.replayed) {
        io.to(roomChannel(roomId)).emit('message.created', message);
      }
      return { message, replayed: result.replayed };
    });
  });

  socket.on('room.history', (payload, acknowledgement) => {
    acknowledge(expectAck(acknowledgement), () => {
      const actor = requireActor(socket);
      const input = expectObject(payload);
      const roomId = expectString(input.roomId, 'roomId');
      const beforeSeq = input.beforeSeq === undefined ? undefined : Number(input.beforeSeq);
      const limit = input.limit === undefined ? undefined : Number(input.limit);
      if (
        (beforeSeq !== undefined && (!Number.isInteger(beforeSeq) || beforeSeq < 1)) ||
        (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
      ) {
        throw new RequestError(
          'INVALID_PAYLOAD',
          'History cursor and limit must be positive integers.',
        );
      }

      const page = storage.loadHistory({ actorId: actor.userId, roomId, beforeSeq, limit });
      return {
        roomId,
        messages: page.messages.map((message) => {
          const sender = storage.getUser(message.senderId);
          return messageWithSenderName(message, sender?.name ?? '<Unknown>');
        }),
        nextBeforeSeq: page.nextBeforeSeq,
        highWatermarkSeq: page.highWatermarkSeq,
      };
    });
  });
}

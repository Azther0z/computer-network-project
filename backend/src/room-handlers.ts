import { requireActor } from './auth-context.js';
import { Storage } from './storage.js';
import {
  DomainError,
  type AuthenticatedActor,
  type MessageRecord,
  type RoomRecord,
  type UserRecord,
} from './types.js';

type Ack = (response: AckResponse<unknown>) => void;

type AckResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

type RoomSocket = {
  data: { actor?: AuthenticatedActor };
  on(event: string, listener: (...args: unknown[]) => void): void;
  join(channel: string): void | Promise<void>;
};

type RoomBroadcaster = {
  to(channel: string): { emit(event: string, payload: unknown): void };
};

class RequestError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_PAYLOAD'
      | 'SELF_CHAT_NOT_ALLOWED'
      | 'NOT_AUTHENTICATED'
      | 'USER_OFFLINE',
    message: string,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RequestError('INVALID_PAYLOAD', `${field} must be a string.`);
  }
  return value;
}

function expectObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RequestError('INVALID_PAYLOAD', 'Payload must be an object.');
  }
  return value;
}

function expectAck(value: unknown): Ack | undefined {
  return typeof value === 'function' ? (value as Ack) : undefined;
}

type PublicUser = { userId: string; name: string; online: boolean };

type RoomHandlerDependencies = {
  isOnline(userId: string): boolean;
  toPublicUser(user: UserRecord): PublicUser;
};

const defaultDependencies: RoomHandlerDependencies = {
  isOnline: () => false,
  toPublicUser: (user) => ({ userId: user.userId, name: user.name, online: false }),
};

function asMessage(message: MessageRecord, senderName: string) {
  return { ...message, senderName };
}

function asRoom(storage: Storage, room: RoomRecord, dependencies: RoomHandlerDependencies) {
  return {
    roomId: room.roomId,
    kind: room.kind,
    ...(room.name === null ? {} : { name: room.name }),
    members: storage.getRoomMembers(room.roomId).map(dependencies.toPublicUser),
  };
}

function acknowledge<T>(ack: Ack | undefined, work: () => T): void {
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
  if (error instanceof Error && error.message === 'NOT_AUTHENTICATED') {
    return { code: 'NOT_AUTHENTICATED', message: 'Sign in before using chat.' };
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
        throw new RequestError('SELF_CHAT_NOT_ALLOWED', 'You cannot open a private chat with yourself.');
      }

      const existing = storage.findPrivateRoom(actor.userId, peerId);
      if (!existing && !dependencies.isOnline(peerId)) {
        throw new RequestError('USER_OFFLINE', 'This user is currently offline.');
      }
      const room = existing ?? storage.findOrCreatePrivateRoom(actor.userId, peerId);
      void socket.join(roomChannel(room.roomId));
      return { room: asRoom(storage, room, dependencies) };
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
      return { group: asRoom(storage, group, dependencies) };
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
      return { group: asRoom(storage, room, dependencies) };
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
      const message = asMessage(result.message, actor.name);
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
      if ((beforeSeq !== undefined && (!Number.isInteger(beforeSeq) || beforeSeq < 1)) ||
          (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) {
        throw new RequestError('INVALID_PAYLOAD', 'History cursor and limit must be positive integers.');
      }

      const page = storage.loadHistory({ actorId: actor.userId, roomId, beforeSeq, limit });
      return {
        roomId,
        messages: page.messages.map((message) => {
          const sender = storage.getUser(message.senderId);
          return asMessage(message, sender?.name ?? 'Unknown');
        }),
        nextBeforeSeq: page.nextBeforeSeq,
        highWatermarkSeq: page.highWatermarkSeq,
      };
    });
  });
}

import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import type { Server, Socket } from 'socket.io';

import { Storage } from '../../database/storage.js';
import { toPublicRoom, type PublicRoom, type PublicUser } from '../../lib/public-room.js';
import type { AuthenticatedActor, RoomRecord } from '../../lib/types.js';
import { expectObject, RequestError, roomChannel, type Acknowledge } from '../../lib/protocol.js';
import { requireActor } from './auth-context.js';
import { readCredentials, readPasswordConfirmation } from './credentials.js';

export type { PublicUser } from '../../lib/public-room.js';
export type AccountSnapshot = {
  self: PublicUser;
  users: PublicUser[];
  groups: PublicRoom[];
  privateRooms: PublicRoom[];
};
/** One process and the default (synchronous, in-memory) Socket.IO adapter only. */
export class AuthPresence {
  readonly activeSocketByUserId = new Map<string, string>();
  // Unknown names still perform password verification; never skip the expensive step.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly io: Server,
    private readonly storage: Storage,
  ) {}

  isOnline = (userId: string): boolean => {
    const id = this.activeSocketByUserId.get(userId);
    return id !== undefined && this.io.sockets.sockets.get(id)?.connected === true;
  };

  toPublicUser = (user: AuthenticatedActor): PublicUser => ({
    userId: user.userId,
    name: user.name,
    online: this.isOnline(user.userId),
  });

  private listOnlineUsers(): PublicUser[] {
    return [...this.activeSocketByUserId.keys()]
      .filter(this.isOnline)
      .map((id) => this.toPublicUser(this.storage.getUser(id)!));
  }

  private room = (room: RoomRecord): PublicRoom =>
    toPublicRoom(this.storage, room, this.toPublicUser);

  private listPublicGroups(): PublicRoom[] {
    return this.storage.listGroups().map(this.room);
  }

  private createSnapshot(actor: AuthenticatedActor): AccountSnapshot {
    return {
      self: this.toPublicUser(actor),
      users: this.listOnlineUsers(),
      groups: this.listPublicGroups(),
      privateRooms: this.storage
        .listMemberRooms(actor.userId)
        .filter((r) => r.kind === 'private')
        .map(this.room),
    };
  }

  /** Refresh the authenticated-only online-user and public-group directories. */
  broadcastDirectories = (): void => {
    const users = this.listOnlineUsers();
    const groups = this.listPublicGroups();
    // Target authenticated sockets explicitly, never the namespace or arbitrary guests.
    for (const id of this.activeSocketByUserId.values()) {
      const socket = this.io.sockets.sockets.get(id);
      if (!socket?.connected || !socket.data.actor) {
        continue;
      }
      socket.emit('users.snapshot', { users });
      socket.emit('groups.snapshot', { groups });
    }
  };

  /** Add a currently authenticated account's live socket to a delivery cache. */
  joinUserToRoom = (userId: string, roomId: string): void => {
    const socketId = this.activeSocketByUserId.get(userId);
    const socket = socketId === undefined ? undefined : this.io.sockets.sockets.get(socketId);
    if (socket?.connected && socket.data.actor?.userId === userId) {
      void socket.join(roomChannel(roomId));
    }
  };

  /** Deliver a non-room event only to an authenticated account's current socket. */
  emitToUser = (userId: string, event: string, payload: unknown): void => {
    const socketId = this.activeSocketByUserId.get(userId);
    const socket = socketId === undefined ? undefined : this.io.sockets.sockets.get(socketId);
    if (socket?.connected && socket.data.actor?.userId === userId) {
      socket.emit(event, payload);
    }
  };

  /** Refresh the remaining participant's label when a private-chat peer is deleted. */
  notifyPrivateRoomChanges(userId: string): void {
    for (const room of this.storage.listMemberRooms(userId)) {
      if (room.kind !== 'private') {
        continue;
      }
      const publicRoom = this.room(room);
      for (const member of this.storage.getPrivateRoomMembers(room.roomId)) {
        if (member.userId !== userId) {
          this.emitToUser(member.userId, 'private.updated', { room: publicRoom });
        }
      }
    }
  }

  private clearSocketIdentity(socket: Socket): boolean {
    const actor = socket.data.actor as AuthenticatedActor | undefined;
    delete socket.data.actor;
    if (actor && this.activeSocketByUserId.get(actor.userId) === socket.id) {
      this.activeSocketByUserId.delete(actor.userId);
    }
    for (const channel of socket.rooms) {
      if (channel !== socket.id) {
        void socket.leave(channel);
      }
    }
    return actor !== undefined;
  }

  private bindSocketIdentity(socket: Socket, actor: AuthenticatedActor): AccountSnapshot {
    if (this.isOnline(actor.userId)) {
      throw new RequestError(
        'SESSION_IN_USE',
        'This account is signed in elsewhere. Sign out there first.',
      );
    }
    socket.data.actor = actor;
    this.activeSocketByUserId.set(actor.userId, socket.id);
    try {
      for (const room of this.storage.listMemberRooms(actor.userId)) {
        void socket.join(roomChannel(room.roomId));
      }
      return this.createSnapshot(actor);
    } catch (error) {
      this.clearSocketIdentity(socket);
      throw error;
    }
  }

  /** Restores an unexpired HTTP-only-cookie session on a new Socket.IO connection. */
  restoreSession(socket: Socket, sessionId: string): AccountSnapshot | undefined {
    if (socket.data.actor) {
      return undefined;
    }
    const user = this.storage.findSessionUser(sessionId);
    if (!user) {
      return undefined;
    }
    try {
      return this.bindSocketIdentity(socket, { userId: user.userId, name: user.name });
    } catch {
      return undefined;
    }
  }

  private requireGuest(socket: Socket): void {
    if (socket.data.actor) {
      throw new RequestError('ALREADY_AUTHENTICATED', 'This connection is already signed in.');
    }
  }

  private async registerAccount(
    socket: Socket,
    payload: unknown,
  ): Promise<AccountSnapshot | undefined> {
    this.requireGuest(socket);
    const input = readCredentials(payload);
    const passwordHash = await hash(input.password, { type: argon2id });
    if (!socket.connected) {
      return;
    }

    // No await between the uniqueness check and INSERT in this single process.
    if (this.storage.findUserByCanonicalName(input.canonicalName)) {
      throw new RequestError(
        'NAME_TAKEN',
        'That name is already registered. Choose another name or sign in.',
      );
    }
    const user = this.storage.createUser({
      name: input.name,
      canonicalName: input.canonicalName,
      passwordHash,
    });
    return this.bindSocketIdentity(socket, { userId: user.userId, name: user.name });
  }

  private async loginAccount(
    socket: Socket,
    payload: unknown,
  ): Promise<AccountSnapshot | undefined> {
    this.requireGuest(socket);
    const input = readCredentials(payload);
    const user = this.storage.findUserByCanonicalName(input.canonicalName);

    // Unknown accounts still pay the password-verification cost and get the same error.
    this.dummyHash ??= hash(randomBytes(32), { type: argon2id });
    const fallbackHash = await this.dummyHash;
    const valid = await verify(user?.passwordHash ?? fallbackHash, input.password);
    if (!socket.connected) {
      return;
    }
    if (!user || !valid) {
      throw new RequestError('INVALID_CREDENTIALS', 'Name or password is incorrect.');
    }

    // bindSocketIdentity checks and claims the active socket without an await.
    return this.bindSocketIdentity(socket, { userId: user.userId, name: user.name });
  }

  private logoutAccount(socket: Socket, payload: unknown): object {
    expectObject(payload);
    requireActor(socket);
    this.clearSocketIdentity(socket);
    return {};
  }

  private async deleteAccount(socket: Socket, payload: unknown): Promise<object | undefined> {
    const actor = requireActor(socket);
    const user = this.storage.getUser(actor.userId);
    const valid = user ? await verify(user.passwordHash, readPasswordConfirmation(payload)) : false;
    if (!socket.connected) {
      return;
    }
    if (!valid) {
      throw new RequestError('INVALID_CREDENTIALS', 'Password confirmation is incorrect.');
    }

    this.storage.deleteAccount(actor.userId);
    this.notifyPrivateRoomChanges(actor.userId);
    this.clearSocketIdentity(socket);
    return {};
  }

  register(socket: Socket): void {
    // The lock belongs to this socket and covers every authentication command.
    let requestInProgress = false;
    type Command = (payload: unknown) => object | undefined | Promise<object | undefined>;

    const registerCommand = (event: string, command: Command): void => {
      socket.on(event, async (...args: unknown[]) => {
        const acknowledge = args[1] as Acknowledge;
        // No acknowledgement, no mutation.
        if (typeof acknowledge !== 'function') {
          return;
        }
        // A rejected overlapping request must not release the original request's lock.
        let ownsLock = false;
        try {
          if (args.length !== 2) {
            throw new RequestError('INVALID_PAYLOAD', 'Expected one payload and acknowledgement.');
          }
          if (requestInProgress) {
            throw new RequestError(
              'INVALID_PAYLOAD',
              'An authentication request is already in progress.',
            );
          }
          requestInProgress = true;
          ownsLock = true;

          const result = command(args[0]);
          // Keep synchronous logout cleanup and acknowledgement in the same event turn.
          const data = result instanceof Promise ? await result : result;
          // Disconnected while password work was pending.
          if (data === undefined) {
            return;
          }
          acknowledge({ ok: true, data });
          this.broadcastDirectories();
        } catch (error) {
          const publicError =
            error instanceof RequestError
              ? { code: error.code, message: error.message }
              : {
                  code: 'INTERNAL_ERROR',
                  message: 'The request could not be completed. Try again.',
                };
          acknowledge({ ok: false, error: publicError });
        } finally {
          if (ownsLock) {
            requestInProgress = false;
          }
        }
      });
    };

    registerCommand('auth.register', async (payload) => {
      const snapshot = await this.registerAccount(socket, payload);
      return snapshot === undefined ? undefined : { snapshot };
    });
    registerCommand('auth.login', async (payload) => {
      const snapshot = await this.loginAccount(socket, payload);
      return snapshot === undefined ? undefined : { snapshot };
    });
    registerCommand('auth.logout', (payload) => this.logoutAccount(socket, payload));
    registerCommand('auth.deleteAccount', (payload) => this.deleteAccount(socket, payload));
    socket.on('disconnect', () => {
      if (this.clearSocketIdentity(socket)) {
        this.broadcastDirectories();
      }
    });
  }
}

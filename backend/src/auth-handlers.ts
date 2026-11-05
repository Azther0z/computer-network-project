import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import type { Server, Socket } from 'socket.io';

import { Storage } from './storage.js';
import type { AuthenticatedActor, RoomRecord } from './types.js';

export type PublicUser = AuthenticatedActor & { online: boolean };
type PublicRoom = { roomId: string; kind: 'private' | 'group'; name?: string; members: PublicUser[] };
export type AccountSnapshot = {
  self: PublicUser;
  users: PublicUser[];
  groups: PublicRoom[];
  privateRooms: PublicRoom[];
};
type Ack = (response: { ok: true; data: unknown } | {
  ok: false; error: { code: string; message: string };
}) => void;

class AuthError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthError('INVALID_PAYLOAD', 'Payload must be an object.');
  }
  return value as Record<string, unknown>;
}

function credentials(payload: unknown) {
  const input = object(payload);
  if (typeof input.name !== 'string' || typeof input.password !== 'string') {
    throw new AuthError('INVALID_PAYLOAD', 'Name and password are required.');
  }
  const name = input.name.trim().normalize('NFC');
  if ([...name].length < 1 || [...name].length > 32 || /\p{Cc}/u.test(name)) {
    throw new AuthError('INVALID_PAYLOAD', 'Name must contain 1–32 characters without control characters.');
  }
  if ([...input.password].length < 8 || [...input.password].length > 128) {
    throw new AuthError('INVALID_PAYLOAD', 'Password must contain 8–128 characters.');
  }
  return { name, canonicalName: name.toLowerCase(), password: input.password };
}

/** One process and the default (synchronous, in-memory) Socket.IO adapter only. */
export class AuthPresence {
  readonly activeSocketByUserId = new Map<string, string>();
  // Unknown names still perform password verification; never skip the expensive step.
  private dummyHash?: Promise<string>;

  constructor(private readonly io: Server, private readonly storage: Storage) {}

  isOnline = (userId: string): boolean => {
    const id = this.activeSocketByUserId.get(userId);
    return id !== undefined && this.io.sockets.sockets.get(id)?.connected === true;
  };

  toPublicUser = (user: AuthenticatedActor): PublicUser => ({
    userId: user.userId, name: user.name, online: this.isOnline(user.userId),
  });

  private users(): PublicUser[] {
    return [...this.activeSocketByUserId.keys()].filter(this.isOnline).map(id =>
      this.toPublicUser(this.storage.getUser(id)!),
    );
  }

  private room = (room: RoomRecord): PublicRoom => ({
    roomId: room.roomId, kind: room.kind,
    ...(room.name === null ? {} : { name: room.name }),
    members: this.storage.getRoomMembers(room.roomId).map(this.toPublicUser),
  });

  private groups(): PublicRoom[] { return this.storage.listGroups().map(this.room); }

  private snapshot(actor: AuthenticatedActor): AccountSnapshot {
    return {
      self: this.toPublicUser(actor), users: this.users(), groups: this.groups(),
      privateRooms: this.storage.listMemberRooms(actor.userId).filter(r => r.kind === 'private').map(this.room),
    };
  }

  private broadcast(): void {
    const users = this.users();
    const groups = this.groups();
    // Target authenticated sockets explicitly, never the namespace or arbitrary guests.
    for (const id of this.activeSocketByUserId.values()) {
      const socket = this.io.sockets.sockets.get(id);
      if (!socket?.connected || !socket.data.actor) continue;
      socket.emit('users.snapshot', { users });
      socket.emit('groups.snapshot', { groups });
    }
  }

  register(socket: Socket): void {
    let busy = false;
    const clear = () => {
      const actor = socket.data.actor as AuthenticatedActor | undefined;
      delete socket.data.actor;
      if (actor && this.activeSocketByUserId.get(actor.userId) === socket.id) {
        this.activeSocketByUserId.delete(actor.userId);
      }
      for (const channel of socket.rooms) {
        if (channel !== socket.id) void socket.leave(channel);
      }
      return actor !== undefined;
    };

    for (const event of ['auth.register', 'auth.login', 'auth.logout'] as const) {
      socket.on(event, async (...args: unknown[]) => {
        const ack = args[1] as Ack;
        if (typeof ack !== 'function') return; // No acknowledged command, no mutation.
        let acquired = false;
        try {
          if (args.length !== 2) throw new AuthError('INVALID_PAYLOAD', 'Expected one payload and acknowledgement.');
          if (busy) throw new AuthError('INVALID_PAYLOAD', 'An authentication request is already in progress.');
          if (event === 'auth.logout') {
            object(args[0]);
            if (!socket.data.actor) throw new AuthError('NOT_AUTHENTICATED', 'Sign in before using chat.');
            clear();
            ack({ ok: true, data: {} });
            this.broadcast();
            return;
          }
          if (socket.data.actor) throw new AuthError('ALREADY_AUTHENTICATED', 'This connection is already signed in.');
          const input = credentials(args[0]);
          busy = acquired = true;
          let user;
          if (event === 'auth.register') {
            const passwordHash = await hash(input.password, { type: argon2id });
            if (!socket.connected) return;
            // The check and unique INSERT run together without an await in this single process.
            if (this.storage.findUserByCanonicalName(input.canonicalName)) {
              throw new AuthError('NAME_TAKEN', 'That name is already registered. Choose another name or sign in.');
            }
            user = this.storage.createUser({ name: input.name, canonicalName: input.canonicalName, passwordHash });
          } else {
            user = this.storage.findUserByCanonicalName(input.canonicalName);
            this.dummyHash ??= hash(randomBytes(32), { type: argon2id });
            const fallback = await this.dummyHash;
            const valid = await verify(user?.passwordHash ?? fallback, input.password);
            if (!socket.connected) return;
            if (!user || !valid) throw new AuthError('INVALID_CREDENTIALS', 'Name or password is incorrect.');
          }
          if (this.isOnline(user.userId)) {
            throw new AuthError('SESSION_IN_USE', 'This account is signed in elsewhere. Sign out there first.');
          }
          // No await between the active-socket check and binding, so concurrent logins cannot both win.
          socket.data.actor = { userId: user.userId, name: user.name };
          this.activeSocketByUserId.set(user.userId, socket.id);
          let snapshot;
          try {
            for (const room of this.storage.listMemberRooms(user.userId)) void socket.join(`room:${room.roomId}`);
            snapshot = this.snapshot(socket.data.actor);
          } catch (error) {
            clear();
            throw error;
          }
          ack({ ok: true, data: { snapshot } });
          this.broadcast();
        } catch (error) {
          ack({ ok: false, error: error instanceof AuthError
            ? { code: error.code, message: error.message }
            : { code: 'INTERNAL_ERROR', message: 'The request could not be completed. Try again.' } });
        } finally {
          if (acquired) busy = false;
        }
      });
    }
    socket.on('disconnect', () => { if (clear()) this.broadcast(); });
  }
}

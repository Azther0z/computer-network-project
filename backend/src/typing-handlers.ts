import { requireActor } from './auth-context.js';
import { Storage } from './storage.js';
import { DomainError, type AuthenticatedActor } from './types.js';

const EXPIRY_MS = 3_000;
const ACTIVE_THROTTLE_MS = 500;

type Ack = (response: { ok: true; data: object } | { ok: false; error: { code: string; message: string } }) => void;
type TypingSocket = {
  id: string;
  data: { actor?: AuthenticatedActor };
  on(event: string, listener: (...args: unknown[]) => void): void;
};
type TypingBroadcaster = {
  to(channel: string): { except(socketId: string): { emit(event: string, payload: unknown): void } };
};
type ActiveTyping = { roomId: string; userId: string; socketId: string; lastEmittedAt: number; expiry: NodeJS.Timeout };

function roomChannel(roomId: string): string { return `room:${roomId}`; }
function key(roomId: string, userId: string): string { return `${roomId}:${userId}`; }

function invalid(message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = 'INVALID_PAYLOAD';
  throw error;
}

function input(payload: unknown): { roomId: string; isTyping: boolean } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid('Payload must be an object.');
  const value = payload as Record<string, unknown>;
  if (typeof value.roomId !== 'string' || typeof value.isTyping !== 'boolean') {
    invalid('roomId and isTyping are required.');
  }
  return { roomId: value.roomId, isTyping: value.isTyping };
}

/** Keeps typing only in process memory; it is never written to SQLite or replayed. */
export class TypingPresence {
  private readonly active = new Map<string, ActiveTyping>();

  constructor(private readonly io: TypingBroadcaster, private readonly storage: Storage) {}

  clearTyping = (userId: string, roomId: string): void => {
    this.clear(key(roomId, userId));
  };

  private emit(entry: Pick<ActiveTyping, 'roomId' | 'userId' | 'socketId'>, isTyping: boolean): void {
    this.io.to(roomChannel(entry.roomId)).except(entry.socketId).emit('typing.updated', {
      roomId: entry.roomId, userId: entry.userId, isTyping, expiresInMs: isTyping ? EXPIRY_MS : 0,
    });
  }

  private clear(entryKey: string): void {
    const entry = this.active.get(entryKey);
    if (!entry) return;
    clearTimeout(entry.expiry);
    this.active.delete(entryKey);
    this.emit(entry, false);
  }

  private clearSocket(socketId: string): void {
    for (const [entryKey, entry] of this.active) {
      if (entry.socketId === socketId) this.clear(entryKey);
    }
  }

  register(socket: TypingSocket): void {
    socket.on('typing.set', (payload, acknowledgement) => {
      const ack = typeof acknowledgement === 'function' ? acknowledgement as Ack : undefined;
      if (!ack) return;
      try {
        const actor = requireActor(socket);
        const request = input(payload);
        this.storage.assertMember(actor.userId, request.roomId);
        const entryKey = key(request.roomId, actor.userId);
        if (!request.isTyping) {
          this.clear(entryKey);
          ack({ ok: true, data: {} });
          return;
        }

        const now = Date.now();
        const previous = this.active.get(entryKey);
        if (previous) clearTimeout(previous.expiry);
        const entry: ActiveTyping = {
          roomId: request.roomId,
          userId: actor.userId,
          socketId: socket.id,
          lastEmittedAt: previous?.lastEmittedAt ?? 0,
          expiry: setTimeout(() => this.clear(entryKey), EXPIRY_MS),
        };
        this.active.set(entryKey, entry);
        if (now - entry.lastEmittedAt >= ACTIVE_THROTTLE_MS) {
          entry.lastEmittedAt = now;
          this.emit(entry, true);
        }
        ack({ ok: true, data: {} });
      } catch (error) {
        const code = error instanceof DomainError ? error.code
          : error instanceof Error && error.message === 'NOT_AUTHENTICATED' ? 'NOT_AUTHENTICATED'
            : error instanceof Error && 'code' in error ? String((error as { code: string }).code)
              : 'INTERNAL_ERROR';
        ack({ ok: false, error: { code, message: code === 'NOT_AUTHENTICATED' ? 'Sign in before using chat.' : 'The typing request could not be completed.' } });
      }
    });
    // auth.logout clears socket.data.actor first, so clear by socket ID rather than actor identity.
    socket.on('auth.logout', () => this.clearSocket(socket.id));
    socket.on('disconnect', () => this.clearSocket(socket.id));
  }
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AccountSnapshot, Ack, AuthMode } from './account-types';
import type { ChatUser } from './chat-types';

const errors: Record<string, string> = {
  INVALID_CREDENTIALS: 'Name or password is incorrect.',
  NAME_TAKEN: 'That name is already registered. Choose another name or sign in.',
  SESSION_IN_USE: 'This account is signed in elsewhere. Sign out there first.',
  INVALID_PAYLOAD: 'Use a name of 1–32 characters and a password of 8–128 characters.',
  ALREADY_AUTHENTICATED: 'This connection is already signed in.',
};

/** Mount once in AuthGate; share this connection with the conversation UI. */
export function useAccountAuth() {
  const connection = useRef<Socket | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const identity = useRef<AccountSnapshot | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = io(process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080', {
      path: '/socket.io', transports: ['websocket'], autoConnect: false,
      reconnection: true, reconnectionAttempts: 5,
      reconnectionDelay: 1000, reconnectionDelayMax: 5000,
      // No retries option: application writes are never automatically replayed.
    });
    connection.current = client;
    const invalidate = () => {
      generation.current++;
      identity.current = null;
    };
    const resetIdentity = () => {
      invalidate();
      pending.current = false;
      setSnapshot(null);
      setBusy(false);
    };
    client.on('connect', () => { resetIdentity(); setSocket(client); setStatus('connected'); });
    const offline = () => { resetIdentity(); setSocket(null); setStatus('offline'); };
    client.on('disconnect', offline);
    client.on('connect_error', offline);
    client.on('users.snapshot', ({ users }: { users: ChatUser[] }) => {
      if (!identity.current) return;
      const online = new Set(users.map(user => user.userId));
      const update = (user: ChatUser) => ({ ...user, online: online.has(user.userId) });
      const current = identity.current;
      const next = { ...current, users, self: update(current.self),
        groups: current.groups.map(room => ({ ...room, members: room.members.map(update) })),
        privateRooms: current.privateRooms.map(room => ({ ...room, members: room.members.map(update) })),
      };
      identity.current = next;
      setSnapshot(next);
    });
    client.on('groups.snapshot', ({ groups }: Pick<AccountSnapshot, 'groups'>) => {
      if (!identity.current) return;
      identity.current = { ...identity.current, groups };
      setSnapshot(identity.current);
    });
    client.connect();
    return () => {
      invalidate();
      connection.current = null;
      client.removeAllListeners();
      client.disconnect();
    };
  }, []);

  function resetTransport(client: Socket) {
    generation.current++;
    identity.current = null;
    setSnapshot(null);
    pending.current = false;
    setBusy(false);
    setSocket(null);
    setStatus('connecting');
    client.disconnect();
    client.connect(); // A fresh unauthenticated connection, never a credential/write retry.
  }

  async function authenticate(mode: AuthMode, name: string, password: string): Promise<void> {
    const client = connection.current;
    if (pending.current || identity.current) return;
    if (!client?.connected) { setError('Connect to the chat server before signing in.'); return; }
    const current = generation.current;
    const id = client.id;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response: Ack<{ snapshot: AccountSnapshot }> = await client.timeout(10000).volatile.emitWithAck(
        `auth.${mode}`, { name, password },
      );
      if (current !== generation.current || !client.connected || client.id !== id) return;
      if (response.ok) {
        identity.current = response.data.snapshot;
        setSnapshot(response.data.snapshot);
      } else {
        setError(errors[response.error.code] ?? 'Could not sign in. Try again.');
      }
    } catch {
      if (current !== generation.current) return;
      resetTransport(client);
      setError('The result could not be confirmed. Sign in to check your account; your request was not retried.');
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false); }
    }
  }

  async function logout(): Promise<void> {
    const client = connection.current;
    if (!identity.current || pending.current || !client?.connected) return;
    const current = generation.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    identity.current = null;
    setSnapshot(null); // Gate chat immediately, including while the acknowledgement is pending.
    try {
      const response: Ack<object> = await client.timeout(10000).volatile.emitWithAck('auth.logout', {});
      if (current !== generation.current) return;
      if (!response.ok) resetTransport(client);
    } catch {
      if (current === generation.current) resetTransport(client);
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false); }
    }
  }

  /** Poom can use this for commands; unknown writes must be retried manually with the same ID. */
  async function request<T>(event: string, payload: object): Promise<Ack<T>> {
    const client = connection.current;
    if (!client?.connected || !identity.current || pending.current) {
      throw new Error('Sign in before using chat.');
    }
    if (event.startsWith('auth.')) throw new Error('Use the authentication controls.');
    const current = generation.current;
    const response: Ack<T> = await client.timeout(10000).volatile.emitWithAck(event, payload);
    if (current !== generation.current || !identity.current) throw new Error('Connection changed. Sign in again.');
    return response;
  }

  function reconnect() { connection.current?.connect(); }
  function clearError() { setError(null); }

  return { socket, status, snapshot, busy, error, authenticate, logout, request, reconnect, clearError };
}

export type AccountAuth = ReturnType<typeof useAccountAuth>;

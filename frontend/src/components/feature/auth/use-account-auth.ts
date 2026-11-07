'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AccountSnapshot, Ack, AuthMode } from '../../../lib/account-types';
import type { ChatUser } from '../../../lib/chat-types';
import type { ChatCommands } from '../../../lib/chat-protocol';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Name or password is incorrect.',
  NAME_TAKEN: 'That name is already registered. Choose another name or sign in.',
  SESSION_IN_USE: 'This account is signed in elsewhere. Sign out there first.',
  INVALID_PAYLOAD: 'Use a name of 1–32 characters and a password of 8–128 characters.',
  ALREADY_AUTHENTICATED: 'This connection is already signed in.',
};

const ACK_TIMEOUT_MS = 10_000;
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080';

async function persistSessionCookie(client: Socket): Promise<void> {
  if (!client.id) {
    return;
  }
  await fetch(`${backendUrl}/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-talkmato-socket-id': client.id },
  });
}

async function revokeSessionCookie(): Promise<void> {
  await fetch(`${backendUrl}/session`, { method: 'DELETE', credentials: 'include' });
}

/** Mount once in AuthGate; share this connection with the conversation UI. */
export function useAccountAuth() {
  const connectionRef = useRef<Socket | null>(null);
  const connectionGenerationRef = useRef(0);
  const authRequestPendingRef = useRef(false);
  const identityRef = useRef<AccountSnapshot | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  // The ref gates commands immediately. State drives the rendered account view.
  const updateSnapshot = useCallback((next: AccountSnapshot | null) => {
    identityRef.current = next;
    setSnapshot(next);
  }, []);

  const invalidateIdentity = useCallback(() => {
    connectionGenerationRef.current++;
    identityRef.current = null;
  }, []);

  const clearIdentity = useCallback(() => {
    invalidateIdentity();
    setSnapshot(null);
    authRequestPendingRef.current = false;
    setBusy(false);
  }, [invalidateIdentity]);

  useEffect(() => {
    const client = io(backendUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      autoConnect: false,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // No retries option: application writes are never automatically replayed.
    });
    connectionRef.current = client;
    client.on('connect', () => {
      clearIdentity();
      setSessionChecked(false);
      setSocket(client);
      setStatus('connected');
    });
    const offline = () => {
      clearIdentity();
      setSessionChecked(true);
      setSocket(null);
      setStatus('offline');
    };
    client.on('disconnect', offline);
    client.on('connect_error', offline);
    client.on('auth.session', ({ snapshot }: { snapshot?: AccountSnapshot }) => {
      if (!client.connected) {
        return;
      }
      if (snapshot) {
        updateSnapshot(snapshot);
      }
      setSessionChecked(true);
    });
    client.on('users.snapshot', ({ users }: { users: ChatUser[] }) => {
      if (!identityRef.current) {
        return;
      }
      const online = new Set(users.map((user) => user.userId));
      const update = (user: ChatUser) => ({ ...user, online: online.has(user.userId) });
      const current = identityRef.current;
      const next = {
        ...current,
        users,
        self: update(current.self),
        groups: current.groups.map((room) => ({ ...room, members: room.members.map(update) })),
        privateRooms: current.privateRooms.map((room) => ({
          ...room,
          members: room.members.map(update),
        })),
      };
      updateSnapshot(next);
    });
    client.on('groups.snapshot', ({ groups }: Pick<AccountSnapshot, 'groups'>) => {
      if (!identityRef.current) {
        return;
      }
      updateSnapshot({ ...identityRef.current, groups });
    });
    client.connect();
    return () => {
      // Invalidate pending acknowledgements without updating an unmounted view.
      invalidateIdentity();
      connectionRef.current = null;
      client.removeAllListeners();
      client.disconnect();
    };
  }, [clearIdentity, invalidateIdentity, updateSnapshot]);

  function resetTransport(client: Socket) {
    clearIdentity();
    setSocket(null);
    setStatus('connecting');
    client.disconnect();
    client.connect(); // A fresh unauthenticated connection, never a credential/write retry.
  }

  async function authenticate(mode: AuthMode, name: string, password: string): Promise<void> {
    const client = connectionRef.current;
    if (authRequestPendingRef.current || identityRef.current) {
      return;
    }
    if (!client?.connected) {
      setError('Connect to the chat server before signing in.');
      return;
    }
    const startedGeneration = connectionGenerationRef.current;
    const id = client.id;
    authRequestPendingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response: Ack<{ snapshot: AccountSnapshot }> = await client
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(`auth.${mode}`, { name, password });
      if (
        startedGeneration !== connectionGenerationRef.current ||
        !client.connected ||
        client.id !== id
      ) {
        return;
      }
      if (response.ok) {
        updateSnapshot(response.data.snapshot);
        // The opaque cookie is set by HTTP, never exposed to application code or storage.
        void persistSessionCookie(client).catch(() => {});
      } else {
        setError(AUTH_ERROR_MESSAGES[response.error.code] ?? 'Could not sign in. Try again.');
      }
    } catch {
      if (startedGeneration !== connectionGenerationRef.current) {
        return;
      }
      resetTransport(client);
      setError(
        'The result could not be confirmed. Sign in to check your account; your request was not retried.',
      );
    } finally {
      if (startedGeneration === connectionGenerationRef.current) {
        authRequestPendingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function logout(): Promise<void> {
    const client = connectionRef.current;
    if (!identityRef.current || authRequestPendingRef.current || !client?.connected) {
      return;
    }
    const startedGeneration = connectionGenerationRef.current;
    authRequestPendingRef.current = true;
    setBusy(true);
    setError(null);
    updateSnapshot(null); // Gate chat immediately while the acknowledgement is pending.
    try {
      const response: Ack<object> = await client
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('auth.logout', {});
      if (startedGeneration !== connectionGenerationRef.current) {
        return;
      }
      if (!response.ok) {
        resetTransport(client);
      } else {
        void revokeSessionCookie().catch(() => {});
      }
    } catch {
      if (startedGeneration === connectionGenerationRef.current) {
        resetTransport(client);
      }
    } finally {
      if (startedGeneration === connectionGenerationRef.current) {
        authRequestPendingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function deleteAccount(password: string): Promise<boolean> {
    const client = connectionRef.current;
    if (!identityRef.current || authRequestPendingRef.current || !client?.connected) {
      return false;
    }
    const startedGeneration = connectionGenerationRef.current;
    authRequestPendingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response: Ack<object> = await client
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck('auth.deleteAccount', { password });
      if (startedGeneration !== connectionGenerationRef.current) {
        return false;
      }
      if (!response.ok) {
        setError(
          AUTH_ERROR_MESSAGES[response.error.code] ?? 'Could not delete the account. Try again.',
        );
        return false;
      }
      updateSnapshot(null);
      void revokeSessionCookie().catch(() => {});
      return true;
    } catch {
      if (startedGeneration === connectionGenerationRef.current) {
        resetTransport(client);
        setError(
          'The deletion result could not be confirmed. Sign in again to check your account.',
        );
      }
      return false;
    } finally {
      if (startedGeneration === connectionGenerationRef.current) {
        authRequestPendingRef.current = false;
        setBusy(false);
      }
    }
  }

  /** Application writes are sent once. A manual retry must reuse its original message ID. */
  async function request<Event extends keyof ChatCommands>(
    event: Event,
    payload: ChatCommands[Event]['payload'],
  ): Promise<Ack<ChatCommands[Event]['result']>> {
    const client = connectionRef.current;
    if (!client?.connected || !identityRef.current || authRequestPendingRef.current) {
      throw new Error('Sign in before using chat.');
    }
    if (event.startsWith('auth.')) {
      throw new Error('Use the authentication controls.');
    }
    const startedGeneration = connectionGenerationRef.current;
    const response: Ack<ChatCommands[Event]['result']> = await client
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(event, payload);
    if (startedGeneration !== connectionGenerationRef.current || !identityRef.current) {
      throw new Error('Connection changed. Sign in again.');
    }
    return response;
  }

  function reconnect() {
    connectionRef.current?.connect();
  }
  function clearError() {
    setError(null);
  }

  return {
    socket,
    status,
    snapshot,
    busy,
    error,
    sessionChecked,
    authenticate,
    logout,
    deleteAccount,
    request,
    reconnect,
    clearError,
  };
}

export type AccountAuth = ReturnType<typeof useAccountAuth>;

export type SignedInAccount = AccountAuth & {
  snapshot: AccountSnapshot;
  socket: NonNullable<AccountAuth['socket']>;
};

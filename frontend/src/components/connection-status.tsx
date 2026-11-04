'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

type ConnectionState = 'connecting' | 'connected' | 'offline';

const labels: Record<ConnectionState, string> = {
  connecting: 'Connecting to chat server…',
  connected: 'Chat server connected — sign in is the next integration step.',
  offline: 'Chat server unavailable. Retrying…',
};

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080', {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });

    socket.on('connect', () => setState('connected'));
    socket.on('disconnect', () => setState('offline'));
    socket.on('connect_error', () => setState('offline'));

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <p aria-live="polite" className={`status status-${state}`}>
      <span aria-hidden="true" />
      {labels[state]}
    </p>
  );
}

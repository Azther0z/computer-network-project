// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { socket, pending, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const socket = {
    connected: true, id: 'connection-1',
    on: vi.fn((event, callback) => { listeners.set(event, callback); }),
    disconnect: vi.fn(), connect: vi.fn(), removeAllListeners: vi.fn(),
    timeout: vi.fn(), emitWithAck: vi.fn(),
  };
  socket.timeout.mockReturnValue(socket);
  socket.emitWithAck.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  return { socket, pending, listeners };
});
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));
import { useAccountAuth } from './use-account-auth';

const snapshot = {
  self: { userId: 'alice', name: 'Alice', online: true },
  users: [{ userId: 'alice', name: 'Alice', online: true }], groups: [], privateRooms: [],
};
beforeEach(() => {
  pending.length = 0;
  listeners.clear();
  vi.clearAllMocks();
  socket.connected = true;
  socket.id = 'connection-1';
});
afterEach(cleanup);

test('chat identity exists only after a successful acknowledgement; duplicate submission is blocked', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => listeners.get('connect')!());
  expect(result.current.snapshot).toBeNull();
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('login', 'Alice', 'test-password'); });
  await act(async () => { await result.current.authenticate('login', 'Alice', 'test-password'); });
  expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot).toBeNull();
  await act(async () => { pending[0].resolve({ ok: true, data: { snapshot } }); await task; });
  expect(result.current.snapshot).toEqual(snapshot);
});

test('disconnect clears identity and reconnect never replays credentials', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => listeners.get('connect')!());
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('register', 'Alice', 'test-password'); });
  await act(async () => { pending[0].resolve({ ok: true, data: { snapshot } }); await task; });
  act(() => { socket.connected = false; listeners.get('disconnect')!(); });
  expect(result.current.snapshot).toBeNull();
  expect(result.current.cachedSnapshot).toEqual(snapshot);
  await expect(result.current.request('room.send', {})).rejects.toThrow('Sign in');
  act(() => { socket.connected = true; socket.id = 'connection-2'; listeners.get('connect')!(); });
  expect(result.current.snapshot).toBeNull();
  expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
  act(() => listeners.get('auth.session')!({}));
  expect(result.current.cachedSnapshot).toBeNull();
});

test('disconnected submits never emit; late acknowledgement cannot restore identity after reconnect', async () => {
  const { result } = renderHook(useAccountAuth);
  socket.connected = false;
  await act(async () => { await result.current.authenticate('login', 'Alice', 'test-password'); });
  expect(socket.emitWithAck).not.toHaveBeenCalled();
  act(() => { socket.connected = true; listeners.get('connect')!(); });
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('login', 'Alice', 'test-password'); });
  act(() => { listeners.get('disconnect')!(); socket.id = 'new-connection'; listeners.get('connect')!(); });
  await act(async () => { pending[0].resolve({ ok: true, data: { snapshot } }); await task; });
  expect(result.current.snapshot).toBeNull();
});

test('unknown authentication outcome resets transport without retrying the write', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => listeners.get('connect')!());
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('register', 'Alice', 'test-password'); });
  await act(async () => { pending[0].reject(new Error('ack timeout')); await task; });
  expect(result.current.snapshot).toBeNull();
  expect(socket.disconnect).toHaveBeenCalled();
  expect(socket.connect).toHaveBeenCalled();
  expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
  expect(result.current.error).toContain('Sign in');
});

test('sign out immediately gates chat and clears identity even when acknowledgement is lost', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => listeners.get('connect')!());
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('login', 'Alice', 'test-password'); });
  await act(async () => { pending[0].resolve({ ok: true, data: { snapshot } }); await task; });
  act(() => { task = result.current.logout(); });
  expect(result.current.snapshot).toBeNull();
  expect(result.current.cachedSnapshot).toBeNull();
  await act(async () => { pending[1].reject(new Error('ack timeout')); await task; });
  expect(result.current.snapshot).toBeNull();
  expect(socket.disconnect).toHaveBeenCalled();
});

test('invalid credentials display a generic client message, never the server error detail', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => listeners.get('connect')!());
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('login', 'Alice', 'test-password'); });
  await act(async () => {
    pending[0].resolve({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'sensitive provider detail' } });
    await task;
  });
  expect(result.current.error).toBe('Name or password is incorrect.');
  expect(result.current.snapshot).toBeNull();
  act(() => result.current.clearError());
  expect(result.current.error).toBeNull();
});

test('chat commands require authentication and are blocked as soon as sign-out starts', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => listeners.get('connect')!());
  await expect(result.current.request('room.history', { roomId: 'room' })).rejects.toThrow('Sign in');
  expect(socket.emitWithAck).not.toHaveBeenCalled();
  let task: Promise<void>;
  act(() => { task = result.current.authenticate('login', 'Alice', 'test-password'); });
  await act(async () => { pending[0].resolve({ ok: true, data: { snapshot } }); await task; });
  let request: Promise<unknown>;
  act(() => { request = result.current.request('room.history', { roomId: 'room' }); });
  await act(async () => { pending[1].resolve({ ok: true, data: { messages: [] } }); await request; });
  expect(socket.emitWithAck).toHaveBeenLastCalledWith('room.history', { roomId: 'room' });
  act(() => { task = result.current.logout(); });
  await expect(result.current.request('room.send', {})).rejects.toThrow('Sign in');
  await act(async () => { pending[2].resolve({ ok: true, data: {} }); await task; });
});

test('losing transport during account deletion discards display data even with an unknown result', async () => {
  const { result } = renderHook(useAccountAuth);
  act(() => { listeners.get('connect')!(); listeners.get('auth.session')!({ snapshot }); });
  let task: Promise<boolean>;
  act(() => { task = result.current.deleteAccount('test-password'); });
  act(() => { socket.connected = false; listeners.get('disconnect')!(); });
  expect(result.current.snapshot).toBeNull();
  expect(result.current.cachedSnapshot).toBeNull();
  await act(async () => { pending[0].reject(new Error('lost connection')); await task; });
  expect(result.current.cachedSnapshot).toBeNull();
});

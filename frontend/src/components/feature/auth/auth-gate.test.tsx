// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ChatApp } from '../chat/chat-app';

const { socket, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: never[]) => void>();
  const socket = {
    connected: true, id: 'first-connection',
    on: vi.fn((event, listener) => listeners.set(event, listener)),
    off: vi.fn((event) => listeners.delete(event)),
    connect: vi.fn(), disconnect: vi.fn(), removeAllListeners: vi.fn(),
    timeout: vi.fn(), emitWithAck: vi.fn(),
  };
  socket.timeout.mockReturnValue(socket);
  return { socket, listeners };
});
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }));

const alice = { userId: 'alice', name: 'Alice', online: true };
const snapshot = { self: alice, users: [alice], privateRooms: [], groups: [
  { roomId: 'study', kind: 'group', name: 'Study', members: [alice] },
] };
const message = { seq: 1, messageId: 'one', roomId: 'study', senderId: 'alice', senderName: 'Alice',
  text: 'Cached message', sentAt: '2026-11-08T00:00:00Z', emojis: [] };
const emit = (event: string, value?: unknown) => act(() => listeners.get(event)?.(value as never));

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  socket.connected = true;
  socket.id = 'first-connection';
  socket.emitWithAck.mockImplementation(async (event: string) => event === 'room.history'
    ? { ok: true, data: { roomId: 'study', messages: [message], nextBeforeSeq: null, highWatermarkSeq: 1 } }
    : { ok: true, data: {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openChat() {
  render(<ChatApp />);
  emit('connect');
  emit('auth.session', { snapshot });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study' })));
  expect(screen.getByText('Cached message')).toBeTruthy();
}

test('temporary loss preserves the view and draft, blocks commands, and restores the same account', async () => {
  await openChat();
  const input = screen.getByRole('textbox', { name: 'Message Study' }) as HTMLTextAreaElement;
  await act(async () => fireEvent.change(input, { target: { value: 'Unsent draft' } }));
  socket.connected = false;
  emit('disconnect');
  expect(screen.getByText('Cached message')).toBeTruthy();
  expect(input.value).toBe('Unsent draft');
  expect(input.disabled).toBe(true);
  const count = socket.emitWithAck.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  expect(socket.emitWithAck.mock.calls).toHaveLength(count);
  socket.connected = true;
  socket.id = 'second-connection';
  emit('connect');
  expect(input.disabled).toBe(true);
  await act(async () => emit('auth.session', { snapshot }));
  expect((screen.getByRole('textbox', { name: 'Message Study' }) as HTMLTextAreaElement).value).toBe('Unsent draft');
  expect(input.disabled).toBe(false);
  expect(socket.emitWithAck.mock.calls.filter(([event]) => event === 'room.history')).toHaveLength(2);
  expect(socket.emitWithAck.mock.calls.filter(([event]) => event === 'room.send')).toHaveLength(0);
});

test('absent restoration clears cached conversation and draft before another sign-in', async () => {
  await openChat();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private draft' } });
  socket.connected = false;
  emit('disconnect');
  socket.connected = true;
  emit('connect');
  emit('auth.session', {});
  expect(screen.queryByText('Cached message')).toBeNull();
  expect(screen.queryByDisplayValue('Private draft')).toBeNull();
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeTruthy();
});

test('different restored identity resets the workspace, and sign-out clears its display cache', async () => {
  await openChat();
  socket.connected = false;
  emit('disconnect');
  socket.connected = true;
  emit('connect');
  emit('auth.session', { snapshot: { self: { userId: 'bob', name: 'Bob', online: true }, users: [], groups: [], privateRooms: [] } });
  expect(screen.queryByText('Cached message')).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })));
  expect(screen.queryByRole('region', { name: 'Chat workspace' })).toBeNull();
  socket.connected = false;
  emit('disconnect');
  expect(screen.queryByText('Cached message')).toBeNull();
});

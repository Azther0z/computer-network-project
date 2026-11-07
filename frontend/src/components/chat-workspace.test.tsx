// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ChatMessage, MessageEmoji } from '../lib/chat-types';
import { ChatWorkspace } from './chat-workspace';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const happy: MessageEmoji = { emojiId: 'emoji-one', emoji: '😊', createdAt: '2026-11-07T00:00:00.000Z' };
const party: MessageEmoji = { emojiId: 'emoji-two', emoji: '🎉', createdAt: '2026-11-07T00:00:01.000Z' };
const message: ChatMessage = {
  seq: 1, messageId: 'message-one', roomId: 'room-one', senderId: 'bob', senderName: 'Bob',
  text: 'Synthetic shared message', sentAt: '2026-11-07T00:00:00.000Z', emojis: [],
};

function setup(saved: MessageEmoji[] = []) {
  const listeners = new Map<string, (value: unknown) => void>();
  const socket = {
    on: vi.fn((event: string, listener: (value: unknown) => void) => listeners.set(event, listener)),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  let finishHistory!: (value: unknown) => void;
  const request = vi.fn((event: string) => event === 'room.history'
    ? new Promise(resolve => { finishHistory = resolve; })
    : Promise.resolve({ ok: true, data: {} }));
  const self = { userId: 'alice', name: 'Alice', online: true };
  const snapshot = { self, users: [self], privateRooms: [], groups: [
    { roomId: 'room-one', kind: 'group', name: 'Study', members: [self] },
    { roomId: 'room-two', kind: 'group', name: 'Other', members: [self] },
  ] };
  const account = { snapshot, socket, request, busy: false, logout: vi.fn(), deleteAccount: vi.fn(), error: null } as unknown as ComponentProps<typeof ChatWorkspace>['account'];
  const view = render(<ChatWorkspace account={account} />);
  return {
    view, socket, request, listeners,
    emit: (event: string, value: unknown) => listeners.get(event)?.(value),
    finish: (roomId = 'room-one', emojis = saved) => finishHistory({ ok: true, data: {
      roomId, messages: roomId === 'room-one' ? [{ ...message, emojis }] : [],
    } }),
  };
}

test('a live attachment arriving before history survives stale history, duplicate delivery and room switches', async () => {
  vi.useFakeTimers();
  const app = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  expect(app.request).toHaveBeenCalledWith('room.history', { roomId: 'room-one' });
  await act(async () => {
    app.emit('message.emojiAdded', { roomId: 'room-one', messageId: message.messageId, attachment: happy });
    app.emit('message.emojiAdded', { roomId: 'room-one', messageId: message.messageId, attachment: happy });
    app.finish();
  });
  expect(screen.getAllByRole('button', { name: 'Replay 😊 firework' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await act(async () => { vi.advanceTimersByTime(2200); });
  act(() => app.emit('message.created', { ...message, emojis: [] }));
  act(() => app.emit('message.emojiAdded', { roomId: 'room-one', messageId: message.messageId, attachment: happy }));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  await act(async () => { app.finish('room-two'); });
  act(() => app.emit('message.emojiAdded', { roomId: 'room-one', messageId: message.messageId, attachment: party }));
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  await act(async () => { app.finish(); });
  expect(screen.getByRole('button', { name: 'Replay 😊 firework' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Replay 🎉 firework' })).toBeTruthy();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('🎉');
  expect(app.request.mock.calls.filter(([event]) => event === 'message.emojiSuggest')).toHaveLength(0);
  app.view.unmount();
  expect(app.listeners.has('message.emojiAdded')).toBe(false);
});

test('saved history renders multiple emojis without an AI call, and replay is a local action', async () => {
  vi.useFakeTimers();
  const app = setup([happy, party]);
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  await act(async () => { app.finish(); });
  expect(screen.getAllByRole('status')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
  const row=screen.getByText(message.text).closest('li')!;
  const bubble=screen.getByText(message.text).parentElement!;
  const replay=screen.getByRole('button', { name: 'Replay 😊 firework' });
  expect(row.contains(replay)).toBe(true);
  expect(bubble.contains(replay)).toBe(false);
  const overlay=document.querySelector('[data-firework-layer]')!;
  expect(overlay.parentElement?.tagName).toBe('MAIN');
  for(const status of screen.getAllByRole('status')) expect(overlay.contains(status)).toBe(true);
  await act(async () => { vi.advanceTimersByTime(2200); });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Replay 😊 firework' }));
  expect(screen.getByRole('status').textContent).toContain('😊');
  expect(app.request.mock.calls.map(([event]) => event)).toEqual(['room.history']);
});

test('the initial AI action is outside its message bubble and shows only the diamond with an accessible label', async () => {
  const app=setup();
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  await act(async () => { app.finish(); });
  const text=screen.getByText(message.text);
  const action=screen.getByRole('button', { name: 'AI emoji effect' });
  expect(text.closest('li')?.contains(action)).toBe(true);
  expect(text.parentElement?.contains(action)).toBe(false);
  expect(action.parentElement?.previousElementSibling).toBe(text.parentElement);
  expect(action.textContent).toBe('✧');
  expect(action.getAttribute('title')).toBe('AI emoji effect');
});

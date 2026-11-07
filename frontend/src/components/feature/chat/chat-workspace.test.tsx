// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ChatMessage, MessageEmoji } from '../../../lib/chat-types';
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
    view, socket, request, listeners, account,
    emit: (event: string, value: unknown) => listeners.get(event)?.(value),
    finish: (roomId = 'room-one', emojis = saved) => finishHistory({ ok: true, data: {
      roomId, messages: roomId === 'room-one' ? [{ ...message, emojis }] : [], nextBeforeSeq: null, highWatermarkSeq: 1,
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

test('older history retries the failed cursor, deduplicates live messages and stops at the last page', async () => {
  const app = setup();
  const replies: ((value: unknown) => void)[] = [];
  app.request.mockImplementation(((event: string) => event === 'room.history'
    ? new Promise(resolve => replies.push(resolve)) : Promise.resolve({ ok: true, data: {} })) as never);
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  const latest = { ...message, seq: 51, messageId: 'latest', text: 'Latest message' };
  act(() => app.emit('message.created', { ...message, seq: 52, messageId: 'live', text: 'Arrived during history' }));
  await act(async () => replies.shift()!({ ok: true, data: { roomId: 'room-one', messages: [latest], nextBeforeSeq: 51, highWatermarkSeq: 51 } }));
  expect(screen.getByText('Arrived during history')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
  expect(app.request.mock.calls.filter(([event]) => event === 'room.history')).toHaveLength(2);
  await act(async () => replies.shift()!({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'private detail' } }));
  expect(screen.getByText('Latest message')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  expect(app.request).toHaveBeenLastCalledWith('room.history', { roomId: 'room-one', beforeSeq: 51 });
  act(() => app.emit('message.created', latest));
  await act(async () => replies.shift()!({ ok: true, data: { roomId: 'room-one', messages: [message, latest], nextBeforeSeq: null, highWatermarkSeq: 51 } }));
  expect(screen.getAllByText('Latest message')).toHaveLength(1);
  expect(screen.getByText(message.text)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  expect(screen.queryByText('private detail')).toBeNull();
});

test('initial history failure retries, and a late response cannot replace another room', async () => {
  const app = setup();
  const replies: ((value: unknown) => void)[] = [];
  app.request.mockImplementation(((event: string) => event === 'room.history'
    ? new Promise(resolve => replies.push(resolve)) : Promise.resolve({ ok: true, data: {} })) as never);
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  await act(async () => replies.shift()!({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  const oldReply = replies.shift()!;
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  await act(async () => {
    replies.shift()!({ ok: true, data: { roomId: 'room-two', messages: [], nextBeforeSeq: null, highWatermarkSeq: 0 } });
    oldReply({ ok: true, data: { roomId: 'room-one', messages: [message], nextBeforeSeq: null, highWatermarkSeq: 1 } });
  });
  expect(screen.queryByText(message.text)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry history' })).toBeNull();
});

test('composition Enter is ignored, Shift+Enter stays local, and normal Enter sends once', async () => {
  const app = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  await act(async () => app.finish());
  const input = screen.getByRole('textbox', { name: 'Message Study' });
  fireEvent.change(input, { target: { value: 'ข้อความภาษาไทย' } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(app.request.mock.calls.filter(([event]) => event === 'room.send')).toHaveLength(0);
  app.request.mockImplementation(((event: string) => Promise.resolve(event === 'room.send'
    ? { ok: true, data: { message, replayed: false } } : { ok: true, data: {} })) as never);
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
  expect(app.request.mock.calls.filter(([event]) => event === 'room.send')).toHaveLength(1);
});

test('group input permits the server limit of 64 astral code points', async () => {
  const app = setup();
  app.request.mockResolvedValue({ ok: true, data: { group: app.account.snapshot.groups[0] } });
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  const input = screen.getByRole('textbox', { name: 'Group name' });
  const create = within(screen.getByRole('form', { name: 'Create group' })).getByRole('button', { name: 'Create group' });
  expect(input.hasAttribute('maxlength')).toBe(false);
  fireEvent.change(input, { target: { value: '🍅'.repeat(65) } });
  expect((create as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: '🍅'.repeat(64) } });
  await act(async () => fireEvent.click(create));
  expect(app.request).toHaveBeenCalledWith('group.create', { name: '🍅'.repeat(64) });
});

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
    { roomId: 'room-one', kind: 'group', name: 'Study', members: [self, { userId: 'bob', name: 'Bob', online: false }] },
    { roomId: 'room-two', kind: 'group', name: 'Other', members: [self] },
  ] };
  const logout = vi.fn();
  const deleteAccount = vi.fn().mockResolvedValue(false);
  const account = { snapshot, socket, request, busy: false, logout, deleteAccount, error: null } as unknown as ComponentProps<typeof ChatWorkspace>['account'];
  const view = render(<ChatWorkspace account={account} />);
  return {
    view, socket, request, listeners, logout, deleteAccount,
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

test('member details include offline members and close outside the popover or when switching rooms', async () => {
  const app = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Study' }));
  await act(async () => { app.finish(); });
  const members = screen.getByRole('button', { name: '2 members' });
  fireEvent.click(members);
  const details = screen.getByRole('dialog', { name: 'Group members' });
  const bob = within(details).getByText('Bob').closest('li')!;
  expect(within(bob).getByText('Offline')).toBeTruthy();
  fireEvent.pointerDown(within(details).getByText('Bob'));
  expect(members.getAttribute('aria-expanded')).toBe('true');
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog', { name: 'Group members' })).toBeNull();
  fireEvent.click(members);
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  await act(async () => { app.finish('room-two'); });
  expect(screen.queryByRole('dialog', { name: 'Group members' })).toBeNull();
  expect(screen.getByRole('button', { name: '1 member' }).getAttribute('aria-expanded')).toBe('false');
});

test('sidebar and extracted dialogs keep group creation, deletion confirmation and logout wired to the account', async () => {
  const app = setup();
  const self = { userId: 'alice', name: 'Alice', online: true };
  app.request.mockImplementation((event: string) => event === 'group.create'
    ? Promise.resolve({ ok: true, data: { group: { roomId: 'created-room', kind: 'group', name: 'New group', members: [self] } } })
    : Promise.resolve({ ok: true, data: { roomId: 'created-room', messages: [] } }));

  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  const form = screen.getByRole('form', { name: 'Create group' });
  expect((within(form).getByRole('button', { name: 'Create group' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(form).getByLabelText('Group name'), { target: { value: 'New group' } });
  await act(async () => { fireEvent.submit(form); });
  expect(app.request).toHaveBeenCalledWith('group.create', { name: 'New group' });
  expect(screen.queryByRole('form', { name: 'Create group' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'New group' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  const deletion = screen.getByRole('form', { name: 'Delete account?' });
  const password = within(deletion).getByLabelText('Confirm password');
  expect(password.getAttribute('type')).toBe('password');
  expect((within(deletion).getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(password, { target: { value: 'synthetic-confirmation' } });
  await act(async () => { fireEvent.submit(deletion); });
  expect(app.deleteAccount).toHaveBeenCalledWith('synthetic-confirmation');
  expect(within(deletion).getByRole('alert').textContent).toContain('Could not delete the account');
  fireEvent.click(within(deletion).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Delete account?' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(app.logout).toHaveBeenCalledTimes(1);
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

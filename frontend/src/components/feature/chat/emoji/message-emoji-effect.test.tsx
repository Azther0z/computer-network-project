// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MessageEmojiEffect } from './message-emoji-effect';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const attachment = (emoji: string, emojiId = emoji) => ({
  emojiId,
  emoji,
  createdAt: '2026-11-07T00:00:00.000Z',
});
const success = (emoji: string) => ({ ok: true, data: { emoji, attachment: attachment(emoji) } });

test('explicit action requests only the selected IDs and displays a saved emoji with its first firework', async () => {
  const request = vi.fn().mockResolvedValue(success('😊'));
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  expect(request).toHaveBeenCalledExactlyOnceWith('message.emojiSuggest', {
    roomId: 'room-one',
    messageId: 'message-one',
  });
  expect((await screen.findByText('AI emoji: 😊')).textContent).toContain('AI emoji: 😊');
  expect(screen.getByRole('button', { name: 'Replay 😊 firework' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
});

test('safe errors offer manual retry without inventing or automatically requesting an emoji', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: 'AI_UNAVAILABLE', message: 'synthetic private provider detail' },
    })
    .mockResolvedValueOnce(success('🎉'));
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('unavailable');
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.body.textContent).not.toContain('private provider');
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry AI emoji effect' }));
  expect((await screen.findByText('AI emoji: 🎉')).textContent).toContain('🎉');
  expect(request).toHaveBeenCalledTimes(2);
});

test('rate limiting marks the diamond and exposes its explanation without adding a message row', async () => {
  const request = vi.fn().mockResolvedValue({
    ok: false,
    error: { code: 'AI_RATE_LIMITED', message: 'synthetic internal detail' },
  });
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  const alert = await screen.findByRole('alert');
  const retry = screen.getByRole('button', { name: 'Retry AI emoji effect' });
  expect(alert.className).toBe('srOnly');
  expect(retry.getAttribute('aria-describedby')).toBe(alert.id);
  expect(retry.getAttribute('title')).toContain('Please wait before requesting another AI effect.');
  expect(retry.textContent).toBe('✧');
  expect(request).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain('synthetic internal detail');
});

test('pending results are discarded after changing the visible message and double clicks do not duplicate requests', async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <MessageEmojiEffect key="old" roomId="room-one" messageId="old" request={request} />,
  );
  const button = screen.getByRole('button', { name: 'AI emoji effect' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
  expect(screen.getByRole('status', { name: 'Choosing emoji' }).textContent).toContain('Choosing…');
  view.rerender(
    <MessageEmojiEffect key="new" roomId="room-two" messageId="new" request={request} />,
  );
  await act(async () => {
    finish(success('😢'));
  });
  expect(screen.queryByRole('status')).toBeNull();
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
});

test('a rejected transport request stays recoverable and malformed success does not display an effect', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(Error('synthetic private transport detail'))
    .mockResolvedValueOnce({ ok: true, data: { emoji: 42 } });
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('retry manually');
  expect(document.body.textContent).not.toContain('private transport');
  fireEvent.click(screen.getByRole('button', { name: 'Retry AI emoji effect' }));
  expect((await screen.findByRole('alert')).textContent).toContain('valid emoji');
  expect(screen.queryByRole('status')).toBeNull();
});

test('the firework expires but the saved emoji remains clickable and replays without an AI request', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(success('😊'));
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  });
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(2200);
  });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Replay 😊 firework' }));
  expect(screen.getByRole('status').textContent).toContain('😊');
  expect(request).toHaveBeenCalledTimes(1);
});

test('multiple history emojis animate once per session and do not replay on rerender or revisiting the room', async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const seen = new Set<string>();
  const saved = [attachment('😊'), attachment('🎉')];
  const view = render(
    <MessageEmojiEffect
      key="one"
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={saved}
      seenEmojiIds={seen}
    />,
  );
  expect(screen.getAllByRole('status')).toHaveLength(2);
  await act(async () => {
    vi.advanceTimersByTime(2200);
  });
  view.rerender(
    <MessageEmojiEffect
      key="one"
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={[...saved]}
      seenEmojiIds={seen}
    />,
  );
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(
    <MessageEmojiEffect
      key="two"
      roomId="room-two"
      messageId="two"
      request={request}
      seenEmojiIds={seen}
    />,
  );
  view.rerender(
    <MessageEmojiEffect
      key="one"
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={saved}
      seenEmojiIds={seen}
    />,
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Replay 😊 firework' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Replay 🎉 firework' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

test('saved history keeps the AI action removed after a fresh mount while allowing replay', () => {
  const request = vi.fn();
  const saved = attachment('🍅');
  const view = render(
    <MessageEmojiEffect
      key="initial"
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={[saved]}
    />,
  );
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
  view.rerender(
    <MessageEmojiEffect
      key="reload"
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={[saved]}
    />,
  );
  expect(screen.queryByRole('button', { name: 'AI emoji effect' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Replay 🍅 firework' }));
  expect(request).not.toHaveBeenCalled();
});

test('a broadcast followed by the same acknowledgement renders one saved emoji and one firework', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<MessageEmojiEffect roomId="room-one" messageId="one" request={request} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI emoji effect' }));
  view.rerender(
    <MessageEmojiEffect
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={[attachment('😊')]}
    />,
  );
  expect(screen.getAllByRole('status')).toHaveLength(1);
  await act(async () => {
    vi.advanceTimersByTime(1000);
    finish(success('😊'));
  });
  expect(screen.getAllByRole('button', { name: 'Replay 😊 firework' })).toHaveLength(1);
  await act(async () => {
    vi.advanceTimersByTime(1200);
  });
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(
    <MessageEmojiEffect
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={[attachment('😊'), attachment('🎉')]}
    />,
  );
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('🎉');
});

test('each replay gets fresh sizes and a spread across the whole effect surface, stable during rerenders', () => {
  let sample = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => ((sample++ * 37) % 100) / 100);
  const request = vi.fn();
  const saved = [attachment('🍅')];
  const view = render(
    <MessageEmojiEffect roomId="room-one" messageId="one" request={request} attachments={saved} />,
  );
  const particles = () => [...document.querySelectorAll<HTMLElement>('[data-firework-particle]')];
  const initial = particles().map((particle) => particle.getAttribute('style'));
  const left = particles().map((particle) => parseFloat(particle.style.getPropertyValue('--left')));
  const top = particles().map((particle) => parseFloat(particle.style.getPropertyValue('--top')));
  expect(Math.min(...left)).toBeLessThan(20);
  expect(Math.max(...left)).toBeGreaterThan(80);
  expect(Math.min(...top)).toBeLessThan(20);
  expect(Math.max(...top)).toBeGreaterThan(80);
  expect(
    new Set(particles().map((particle) => particle.style.getPropertyValue('--size'))).size,
  ).toBeGreaterThan(1);
  view.rerender(
    <MessageEmojiEffect
      roomId="room-one"
      messageId="one"
      request={request}
      attachments={[...saved]}
    />,
  );
  expect(particles().map((particle) => particle.getAttribute('style'))).toEqual(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Replay 🍅 firework' }));
  expect(particles().map((particle) => particle.getAttribute('style'))).not.toEqual(initial);
  expect(request).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MessageEmojiEffect } from './message-emoji-effect';

afterEach(()=>{cleanup();vi.useRealTimers();});

test('explicit action requests only the selected IDs and displays a local emoji result', async()=>{
  const request=vi.fn().mockResolvedValue({ok:true,data:{emoji:'😊'}});
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request}/>);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'AI emoji effect'}));
  expect(request).toHaveBeenCalledExactlyOnceWith('message.emojiSuggest',{roomId:'room-one',messageId:'message-one'});
  expect((await screen.findByRole('status')).textContent).toContain('AI emoji: 😊');
});

test('safe errors offer manual retry without inventing or automatically requesting an emoji', async()=>{
  const request=vi.fn().mockResolvedValueOnce({ok:false,error:{code:'AI_UNAVAILABLE',message:'synthetic private provider detail'}})
    .mockResolvedValueOnce({ok:true,data:{emoji:'🎉'}});
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request}/>);
  fireEvent.click(screen.getByRole('button',{name:'AI emoji effect'}));
  expect((await screen.findByRole('alert')).textContent).toContain('unavailable');
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.body.textContent).not.toContain('private provider');
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Retry AI emoji effect'}));
  expect((await screen.findByRole('status')).textContent).toContain('🎉');
  expect(request).toHaveBeenCalledTimes(2);
});

test('pending results are discarded after changing the visible message and double clicks do not duplicate requests', async()=>{
  let finish!: (value:unknown)=>void;
  const request=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<MessageEmojiEffect key="old" roomId="room-one" messageId="old" request={request}/>);
  const button=screen.getByRole('button',{name:'AI emoji effect'});
  fireEvent.click(button);
  fireEvent.click(button);
  expect(request).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<MessageEmojiEffect key="new" roomId="room-two" messageId="new" request={request}/>);
  await act(async()=>{finish({ok:true,data:{emoji:'😢'}});});
  expect(screen.queryByRole('status')).toBeNull();
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
});

test('a rejected transport request stays recoverable and malformed success does not display an effect', async()=>{
  const request=vi.fn().mockRejectedValueOnce(Error('synthetic private transport detail')).mockResolvedValueOnce({ok:true,data:{emoji:42}});
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request}/>);
  fireEvent.click(screen.getByRole('button',{name:'AI emoji effect'}));
  expect((await screen.findByRole('alert')).textContent).toContain('retry manually');
  expect(document.body.textContent).not.toContain('private transport');
  fireEvent.click(screen.getByRole('button',{name:'Retry AI emoji effect'}));
  expect((await screen.findByRole('alert')).textContent).toContain('valid emoji');
  expect(screen.queryByRole('status')).toBeNull();
});

test('the effect expires instead of becoming a persistent reaction', async()=>{
  vi.useFakeTimers();
  const request=vi.fn().mockResolvedValue({ok:true,data:{emoji:'😊'}});
  render(<MessageEmojiEffect roomId="room-one" messageId="message-one" request={request}/>);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'AI emoji effect'}));});
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async()=>{vi.advanceTimersByTime(2200);});
  expect(screen.queryByRole('status')).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

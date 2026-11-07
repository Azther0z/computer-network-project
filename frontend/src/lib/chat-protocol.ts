import type { Ack } from './account-types';
import type { ChatMessage, GroupSummary, MessageEmoji, PrivateRoom } from './chat-types';

export type PendingMessage = { roomId: string; text: string; clientMessageId: string };
export type HistoryPage = {
  roomId: string;
  messages: ChatMessage[];
  nextBeforeSeq: number | null;
  highWatermarkSeq: number;
};
export type TypingUpdate = {
  roomId: string;
  userId: string;
  isTyping: boolean;
  expiresInMs: number;
};

/** The event name determines both the request payload and the acknowledged result. */
export type ChatCommands = {
  'private.open': { payload: { peerId: string }; result: { room: PrivateRoom } };
  'group.create': { payload: { name: string }; result: { group: GroupSummary } };
  'group.join': { payload: { roomId: string }; result: { group: GroupSummary } };
  'room.history': {
    payload: { roomId: string; beforeSeq?: number; limit?: number };
    result: HistoryPage;
  };
  'room.send': { payload: PendingMessage; result: { message: ChatMessage; replayed: boolean } };
  'typing.set': { payload: { roomId: string; isTyping: boolean }; result: object };
  'message.emojiSuggest': {
    payload: { roomId: string; messageId: string };
    result: { emoji: string; attachment: MessageEmoji };
  };
};

export type ChatRequest = <Event extends keyof ChatCommands>(
  event: Event,
  payload: ChatCommands[Event]['payload'],
) => Promise<Ack<ChatCommands[Event]['result']>>;

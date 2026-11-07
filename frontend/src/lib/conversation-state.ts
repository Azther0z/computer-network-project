import type { ChatMessage, GroupRoom, GroupSummary } from './chat-types';
import { mergeMessageEmojis } from './message-emojis';

export function withJoinedStatus(group: GroupSummary, selfId: string): GroupRoom {
  return { ...group, joined: group.members.some((member) => member.userId === selfId) };
}

export function mergeRooms<T extends { roomId: string }>(current: T[], incoming: T[]): T[] {
  const rooms = new Map(current.map((room) => [room.roomId, room]));
  for (const room of incoming) {
    rooms.set(room.roomId, room);
  }
  return [...rooms.values()];
}

/** History, acknowledgements and live delivery can contain the same message. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) {
    const previous = messages.get(message.messageId);
    messages.set(message.messageId, {
      ...message,
      // A stale history page must not erase an attachment already received live.
      emojis: mergeMessageEmojis(previous?.emojis ?? [], message.emojis),
    });
  }
  return [...messages.values()].sort((left, right) => left.seq - right.seq);
}

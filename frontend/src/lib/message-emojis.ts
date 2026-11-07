import type { MessageEmoji } from './chat-types';

/** History, live delivery and acknowledgements may all contain the same attachment. */
export function mergeMessageEmojis(
  current: MessageEmoji[],
  incoming: MessageEmoji[],
): MessageEmoji[] {
  const emojis = new Map(current.map((entry) => [entry.emojiId, entry]));
  for (const entry of incoming) {
    emojis.set(entry.emojiId, entry);
  }
  return [...emojis.values()];
}

export function isMessageEmoji(value: unknown): value is MessageEmoji {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.emojiId === 'string' &&
    entry.emojiId.length > 0 &&
    entry.emojiId.length <= 128 &&
    typeof entry.emoji === 'string' &&
    entry.emoji.length > 0 &&
    entry.emoji.length <= 64 &&
    typeof entry.createdAt === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt))
  );
}

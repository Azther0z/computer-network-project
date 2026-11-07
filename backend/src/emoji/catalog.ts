import { emojiDefinitions } from './catalog-data.js';

export type EmojiEntry = { id: string; emoji: string; name: string };
export const emojiCatalog: EmojiEntry[] = emojiDefinitions.map(([emoji, name]) => ({
  id: `e_${Array.from(emoji, character => character.codePointAt(0)!.toString(16)).join('_')}`,
  emoji,
  name,
}));
export const allowedEmoji = new Set(emojiCatalog.map(entry => entry.emoji));
if (emojiCatalog.length < 2 || emojiCatalog.length > 255 || allowedEmoji.size !== emojiCatalog.length ||
    new Set(emojiCatalog.map(entry => entry.id)).size !== emojiCatalog.length) {
  throw new Error('Emoji catalog must contain 2–255 distinct choices.');
}

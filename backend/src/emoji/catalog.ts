import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type EmojiEntry = { id: string; emoji: string; name: string; group: string; subgroup: string; points: number[] };
export type ChoiceNode = { id: string; description: string; children?: ChoiceNode[]; entry?: EmojiEntry };
export const UNICODE_VERSION = '17.0';
const raw = readFileSync(new URL('./data/emoji-test-17.0.txt', import.meta.url), 'utf8');
if (createHash('sha256').update(raw).digest('hex') !== '1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda') {
  throw new Error('Emoji source checksum mismatch.');
}

let group = '';
let subgroup = '';
export const emojiCatalog: EmojiEntry[] = [];
for (const line of raw.split('\n')) {
  if (line.startsWith('# group: ')) group = line.slice(9).trim();
  if (line.startsWith('# subgroup: ')) subgroup = line.slice(12).trim();
  const match = line.match(/^([A-F0-9 ]+)\s*; fully-qualified\s*#\s*\S+\s+E[\d.]+\s+(.+)$/);
  if (!match) continue;
  const points = match[1].trim().split(/\s+/).map(hex => Number.parseInt(hex, 16));
  emojiCatalog.push({ id: `e_${points.map(n => n.toString(16)).join('_')}`, emoji: String.fromCodePoint(...points),
    name: match[2].trim(), group, subgroup, points });
}
if (emojiCatalog.length !== 3944) throw new Error('Unexpected emoji source version.');
const key = (points: number[]) => points.filter(n => n !== 0xfe0f).join('_');
const bySequence = new Map(emojiCatalog.map(entry => [key(entry.points), entry]));
const aliases = new Map<string, string>([
  ['🤴', '🫅'], ['👸', '🫅'], ['🎅', '🧑‍🎄'], ['🤶', '🧑‍🎄'], ['🤰', '🫄'], ['🫃', '🫄'],
  ['👫', '🧑‍🤝‍🧑'], ['👬', '🧑‍🤝‍🧑'], ['👭', '🧑‍🤝‍🧑'],
]);

/** Policy is enforced by candidate construction, never by trusting the model's instruction following. */
export function isDefaultEmoji(entry: EmojiEntry): boolean {
  if (entry.points.some(n => n >= 0x1f3fb && n <= 0x1f3ff) || aliases.has(entry.emoji)) return false;
  const neutral = entry.points.filter((n, index, points) =>
    !(n === 0x200d && [0x2640, 0x2642].includes(points[index + 1])) && ![0x2640, 0x2642].includes(n));
  const neutralEntry = bySequence.get(key(neutral));
  if (neutralEntry && neutralEntry.id !== entry.id) return false;
  const person = entry.points.map(n => [0x1f468, 0x1f469].includes(n) ? 0x1f9d1 :
    [0x1f466, 0x1f467].includes(n) ? 0x1f9d2 : [0x1f474, 0x1f475].includes(n) ? 0x1f9d3 : n);
  const neutralPerson = bySequence.get(key(person));
  if (neutralPerson && neutralPerson.id !== entry.id) return false;
  // Generic couple/kiss symbols are the defaults for gendered joined couple sequences.
  if (entry.points.includes(0x200d) && entry.points.includes(0x2764) &&
      entry.points.some(n => [0x1f468, 0x1f469].includes(n))) return false;
  return true;
}

export const selectableEmojis = emojiCatalog.filter(isDefaultEmoji);
export const allowedEmoji = new Set(selectableEmojis.map(entry => entry.emoji));
const leaf = (entry: EmojiEntry): ChoiceNode => ({ id: entry.id, description: `${entry.emoji}: ${entry.name}`, entry });
let serial = 0;
function branch(description: string, children: ChoiceNode[]): ChoiceNode {
  if (!children.length) throw new Error('Empty emoji decision.');
  if (children.length > 255) {
    const partitions: ChoiceNode[] = [];
    for (let index = 0; index < children.length; index += 128) {
      const members = children.slice(index, index + 128);
      partitions.push(branch(`Contains these choices: ${members.map(child => child.description).join('; ')}`, members));
    }
    return branch(description, partitions);
  }
  return { id: `n_${serial++}`, description, children };
}

export const emojiTree = branch('All standard default emoji', [...Map.groupBy(selectableEmojis, entry => entry.group)]
  .map(([name, entries]) => name === 'Smileys & Emotion' ? branch(name, entries.map(leaf)) :
    branch(name, [...Map.groupBy(entries, entry => entry.subgroup)]
      .map(([subName, members]) => branch(subName, members.map(leaf))))));

export function decisionAt(node: ChoiceNode): ChoiceNode {
  while (!node.entry && node.children?.length === 1) node = node.children[0];
  return node;
}

import { isRecord } from '../../lib/protocol.js';
import { DEFAULT_EMOJI, emojiCatalog, type EmojiEntry } from './catalog.js';
import { EmojiError } from './emoji-error.js';

// Accept the same small score-rounding differences as the original provider contract.
const PER_OPTION_ROUNDING_TOLERANCE = 0.00005;
const SCORE_COMPARISON_TOLERANCE = 0.0002;

type ChoiceAnswer = { choice: string; probabilities: Record<string, unknown> };

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function readChoiceAnswer(body: unknown): ChoiceAnswer {
  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.result) ||
    !isRecord(body.result.answers)
  ) {
    throw new EmojiError('AI_INVALID_RESPONSE');
  }
  const answer = body.result.answers.selection;
  if (
    !isRecord(answer) ||
    answer.type !== 'choice' ||
    typeof answer.choice !== 'string' ||
    !isProbability(answer.confidence) ||
    !isRecord(answer.probabilities)
  ) {
    throw new EmojiError('AI_INVALID_RESPONSE');
  }
  return { choice: answer.choice, probabilities: answer.probabilities };
}

function readProbabilityScores(
  answer: ChoiceAnswer,
  knownChoice: boolean,
): Array<[string, number]> {
  const expectedIds = new Set(emojiCatalog.map((entry) => entry.id));
  // Unknown choices can have a score too. Every offered catalog ID must still be present.
  if (!knownChoice && Object.hasOwn(answer.probabilities, answer.choice)) {
    expectedIds.add(answer.choice);
  }
  const entries = Object.entries(answer.probabilities);
  if (
    entries.length !== expectedIds.size ||
    entries.some(([id, value]) => !expectedIds.has(id) || !isProbability(value))
  ) {
    throw new EmojiError('AI_INVALID_RESPONSE');
  }
  const scores = entries as Array<[string, number]>;
  const total = scores.reduce((sum, [, probability]) => sum + probability, 0);
  const sumTolerance =
    expectedIds.size * PER_OPTION_ROUNDING_TOLERANCE + SCORE_COMPARISON_TOLERANCE;
  if (Math.abs(total - 1) > sumTolerance) {
    throw new EmojiError('AI_INVALID_RESPONSE');
  }
  return scores;
}

/** Invalid structure is retryable. A valid but unknown choice uses the fixed tomato fallback. */
export function parseClefChoice(body: unknown): EmojiEntry {
  const answer = readChoiceAnswer(body);
  const selected = emojiCatalog.find((entry) => entry.id === answer.choice);
  const scores = readProbabilityScores(answer, selected !== undefined);
  if (!selected) {
    return emojiCatalog.find((entry) => entry.emoji === DEFAULT_EMOJI)!;
  }
  const selectedScore = answer.probabilities[selected.id] as number;
  if (scores.some(([, probability]) => probability > selectedScore + SCORE_COMPARISON_TOLERANCE)) {
    throw new EmojiError('AI_INVALID_RESPONSE');
  }
  return selected;
}

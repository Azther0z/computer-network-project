'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ChatRequest } from '../../../../lib/chat-protocol';
import type { MessageEmoji } from '@/lib/chat-types';
import { isMessageEmoji, mergeMessageEmojis } from '../../../../lib/message-emojis';
import { createFireworkRun, EmojiFirework, type FireworkRun } from './emoji-firework';
import styles from './message-emoji-effect.module.css';

const errors: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sign in again before requesting an AI effect.',
  NOT_MEMBER: 'Join this room before requesting an AI effect.',
  MESSAGE_NOT_AVAILABLE: 'This message is no longer available for an AI effect.',
  AI_UNAVAILABLE: 'The AI effect is unavailable. Try again later.',
  AI_INVALID_RESPONSE: 'The AI could not choose a valid emoji. You can try again.',
  AI_RATE_LIMITED: 'Please wait before requesting another AI effect.',
};
const FIREWORK_LIFETIME_MS = 2_200;
const emptyEmojis: MessageEmoji[] = [];

function SavedEmoji({
  attachment,
  seenEmojiIds,
  fireworkTarget,
}: {
  attachment: MessageEmoji;
  seenEmojiIds: Set<string>;
  fireworkTarget?: HTMLElement | null;
}) {
  const [effect, setEffect] = useState<FireworkRun | null>(() =>
    seenEmojiIds.has(attachment.emojiId) ? null : createFireworkRun(0),
  );
  const playSequenceRef = useRef(0);
  useEffect(() => {
    seenEmojiIds.add(attachment.emojiId);
  }, [attachment.emojiId, seenEmojiIds]);
  useEffect(() => {
    if (!effect) {
      return;
    }
    const timer = window.setTimeout(() => setEffect(null), FIREWORK_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [effect]);
  return (
    <span className={styles.savedEmoji}>
      <button
        type="button"
        className={`${styles.button} ${styles.savedButton}`}
        aria-label={`Replay ${attachment.emoji} firework`}
        onClick={() => setEffect(createFireworkRun(++playSequenceRef.current))}
      >
        {attachment.emoji}
      </button>
      {effect && (
        <EmojiFirework
          key={effect.run}
          emoji={attachment.emoji}
          effect={effect}
          target={fireworkTarget}
        />
      )}
    </span>
  );
}

/** Attachments are durable; animation state stays in the viewing browser. */
export function MessageEmojiEffect({
  roomId,
  messageId,
  request,
  attachments = emptyEmojis,
  seenEmojiIds,
  onAttachment,
  fireworkTarget,
}: {
  roomId: string;
  messageId: string;
  request: ChatRequest;
  attachments?: MessageEmoji[];
  seenEmojiIds?: Set<string>;
  onAttachment?: (attachment: MessageEmoji) => void;
  fireworkTarget?: HTMLElement | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const [confirmed, setConfirmed] = useState<MessageEmoji[]>([]);
  const localSeenEmojiIds = useRef(new Set<string>());
  const viewGenerationRef = useRef(0);
  const requestInFlightRef = useRef(false);
  useEffect(
    () => () => {
      viewGenerationRef.current++;
    },
    [],
  );
  const emojis = mergeMessageEmojis(attachments, confirmed);

  async function suggest(): Promise<void> {
    if (requestInFlightRef.current || emojis.length > 0) {
      return;
    }
    requestInFlightRef.current = true;
    const startedGeneration = viewGenerationRef.current;
    setPending(true);
    setError(null);
    try {
      const result = await request('message.emojiSuggest', { roomId, messageId });
      if (startedGeneration !== viewGenerationRef.current) {
        return;
      }
      if (!result.ok) {
        setError(
          errors[result.error.code] ?? 'The AI effect could not be completed. You can try again.',
        );
        return;
      }
      if (
        !isMessageEmoji(result.data?.attachment) ||
        result.data.emoji !== result.data.attachment.emoji
      ) {
        setError(errors.AI_INVALID_RESPONSE);
        return;
      }
      const attachment = result.data.attachment;
      setConfirmed((current) => mergeMessageEmojis(current, [attachment]));
      onAttachment?.(attachment);
    } catch {
      if (startedGeneration === viewGenerationRef.current) {
        setError('The AI request was not confirmed. You can retry manually.');
      }
    } finally {
      if (startedGeneration === viewGenerationRef.current) {
        requestInFlightRef.current = false;
        setPending(false);
      }
    }
  }

  return (
    <div className={styles.action}>
      {emojis.length === 0 && !pending && (
        <button
          type="button"
          className={`${styles.button} ${styles.aiButton} ${error ? styles.failed : ''}`}
          onClick={() => void suggest()}
          aria-label={error ? 'Retry AI emoji effect' : 'AI emoji effect'}
          aria-describedby={error ? errorId : undefined}
          title={error ? `${error} Click to retry.` : 'AI emoji effect'}
        >
          <span aria-hidden="true">✧</span>
        </button>
      )}
      {pending && emojis.length === 0 && (
        <span className={styles.choosing} role="status" aria-label="Choosing emoji">
          <span aria-hidden="true">✧</span>
          <span className="srOnly">Choosing…</span>
        </span>
      )}
      {emojis.length > 0 && (
        <span className={styles.savedEmojis} role="group" aria-label="Saved AI emojis">
          {emojis.map((attachment) => (
            <SavedEmoji
              key={attachment.emojiId}
              attachment={attachment}
              seenEmojiIds={seenEmojiIds ?? localSeenEmojiIds.current}
              fireworkTarget={fireworkTarget}
            />
          ))}
        </span>
      )}
      {error && emojis.length === 0 && (
        <span id={errorId} className="srOnly" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Ack } from '@/lib/account-types';
import styles from './message-emoji-effect.module.css';

type Request = <T>(event: string, payload: object) => Promise<Ack<T>>;
const errors: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sign in again before requesting an AI effect.',
  NOT_MEMBER: 'Join this room before requesting an AI effect.',
  MESSAGE_NOT_AVAILABLE: 'This message is no longer available for an AI effect.',
  AI_UNAVAILABLE: 'The AI effect is unavailable. Try again later.',
  AI_INVALID_RESPONSE: 'The AI could not choose a valid emoji. You can try again.',
  AI_RATE_LIMITED: 'Please wait before requesting another AI effect.',
};
const particles = [[-64, -55], [0, -80], [64, -55], [-88, 0], [88, 0], [-64, 55], [0, 76], [64, 55]];

/** All state belongs to this visible message. Nothing is sent to other browsers or saved as a reaction. */
export function MessageEmojiEffect({ roomId, messageId, request }: {
  roomId: string; messageId: string; request: Request;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effect, setEffect] = useState<{ emoji: string; run: number } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!effect) return;
    const timer = window.setTimeout(() => setEffect(null), 2_200);
    return () => window.clearTimeout(timer);
  }, [effect]);

  async function suggest(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    setPending(true);
    setError(null);
    setEffect(null);
    try {
      const result = await request<{ emoji: string }>('message.emojiSuggest', { roomId, messageId });
      if (current !== generation.current) return;
      if (!result.ok) { setError(errors[result.error.code] ?? 'The AI effect could not be completed. You can try again.'); return; }
      if (typeof result.data?.emoji !== 'string' || !result.data.emoji || result.data.emoji.length > 64) {
        setError(errors.AI_INVALID_RESPONSE);
        return;
      }
      setEffect({ emoji: result.data.emoji, run: ++sequence.current });
    } catch {
      if (current === generation.current) setError('The AI request was not confirmed. You can retry manually.');
    } finally {
      if (current === generation.current) { inFlight.current = false; setPending(false); }
    }
  }

  return <div className={styles.action}>
    <button type="button" className={styles.button} onClick={() => void suggest()} disabled={pending}
      aria-label={error ? 'Retry AI emoji effect' : 'AI emoji effect'}>
      <span aria-hidden="true">✧</span> {pending ? 'Choosing…' : error ? 'Retry AI effect' : 'AI effect'}
    </button>
    {error && <span className={styles.error} role="alert">{error}</span>}
    {effect && <div key={effect.run} className={styles.burst} role="status">
      <span className="srOnly">AI emoji: {effect.emoji}</span>
      <span className={styles.main} aria-hidden="true">{effect.emoji}</span>
      {particles.map(([x, y], index) => <span key={index} className={styles.particle} aria-hidden="true"
        style={{ '--x': `${x}px`, '--y': `${y}px`, '--delay': `${index * 18}ms` } as CSSProperties}>{effect.emoji}</span>)}
    </div>}
  </div>;
}

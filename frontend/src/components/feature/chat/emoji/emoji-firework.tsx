'use client';

import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import styles from './message-emoji-effect.module.css';

export type FireworkRun = { run: number; center: CSSProperties; particles: CSSProperties[] };

/** Sample once per play so rerenders do not move particles mid-flight. */
export function createFireworkRun(run: number): FireworkRun {
  return {
    run,
    center: {
      '--left': `${35 + Math.random() * 30}%`,
      '--top': `${30 + Math.random() * 40}%`,
      '--size': `${64 + Math.random() * 40}px`,
    } as CSSProperties,
    // Jitter within cells keeps every part of the conversation covered on every play.
    particles: Array.from({ length: 35 }, (_, index) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 45 + Math.random() * 110;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      return {
        '--left': `${5 + ((index % 7) + Math.random()) * (90 / 7)}%`,
        '--top': `${5 + (Math.floor(index / 7) + Math.random()) * 18}%`,
        '--size': `${18 + Math.random() * 46}px`,
        '--from-x': `${-x * 0.45}px`,
        '--from-y': `${-y * 0.45}px`,
        '--x': `${x}px`,
        '--y': `${y + 40}px`,
        '--rotation': `${-90 + Math.random() * 180}deg`,
        '--duration': `${1100 + Math.random() * 550}ms`,
        '--delay': `${Math.random() * 350}ms`,
      } as CSSProperties;
    }),
  };
}

export function EmojiFirework({ emoji, effect, target }: {
  emoji: string; effect: FireworkRun; target?: HTMLElement | null;
}) {
  const burst = <span key={effect.run} className={styles.burst} role="status" data-emoji-firework="">
    <span className="srOnly">AI emoji: {emoji}</span>
    <span className={styles.main} style={effect.center} aria-hidden="true">{emoji}</span>
    {effect.particles.map((style, index) => <span key={index} className={styles.particle}
      style={style} aria-hidden="true" data-firework-particle="">{emoji}</span>)}
  </span>;
  return target ? createPortal(burst, target) : burst;
}

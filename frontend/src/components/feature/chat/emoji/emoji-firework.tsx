'use client';

import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import styles from './message-emoji-effect.module.css';

const PARTICLE_COLUMNS = 7;
const PARTICLE_ROWS = 5;
const EDGE_MARGIN_PERCENT = 5;
const COVERAGE_PERCENT = 90;

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

export type FireworkRun = { run: number; center: CSSProperties; particles: CSSProperties[] };

/** Sample once per play so rerenders do not move particles mid-flight. */
export function createFireworkRun(run: number): FireworkRun {
  return {
    run,
    center: {
      '--left': `${randomBetween(35, 65)}%`,
      '--top': `${randomBetween(30, 70)}%`,
      '--size': `${randomBetween(64, 104)}px`,
    } as CSSProperties,
    // Jitter within cells keeps every part of the conversation covered on every play.
    particles: Array.from({ length: PARTICLE_COLUMNS * PARTICLE_ROWS }, (_, index) => {
      const angle = randomBetween(0, Math.PI * 2);
      const distance = randomBetween(45, 155);
      const travelX = Math.cos(angle) * distance;
      const travelY = Math.sin(angle) * distance;
      return {
        '--left': `${EDGE_MARGIN_PERCENT + ((index % PARTICLE_COLUMNS) + Math.random()) * (COVERAGE_PERCENT / PARTICLE_COLUMNS)}%`,
        '--top': `${EDGE_MARGIN_PERCENT + (Math.floor(index / PARTICLE_COLUMNS) + Math.random()) * (COVERAGE_PERCENT / PARTICLE_ROWS)}%`,
        '--size': `${randomBetween(18, 64)}px`,
        '--from-x': `${-travelX * 0.45}px`,
        '--from-y': `${-travelY * 0.45}px`,
        '--x': `${travelX}px`,
        '--y': `${travelY + 40}px`,
        '--rotation': `${randomBetween(-90, 90)}deg`,
        '--duration': `${randomBetween(1100, 1650)}ms`,
        '--delay': `${randomBetween(0, 350)}ms`,
      } as CSSProperties;
    }),
  };
}

export function EmojiFirework({
  emoji,
  effect,
  target,
}: {
  emoji: string;
  effect: FireworkRun;
  target?: HTMLElement | null;
}) {
  const burst = (
    <span key={effect.run} className={styles.burst} role="status" data-emoji-firework="">
      <span className="srOnly">AI emoji: {emoji}</span>
      <span className={styles.main} style={effect.center} aria-hidden="true">
        {emoji}
      </span>
      {effect.particles.map((style, index) => (
        <span
          key={index}
          className={styles.particle}
          style={style}
          aria-hidden="true"
          data-firework-particle=""
        >
          {emoji}
        </span>
      ))}
    </span>
  );
  return target ? createPortal(burst, target) : burst;
}

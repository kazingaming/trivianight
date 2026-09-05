import { useEffect, useRef } from 'react';
import { useCountdown } from '../lib/hooks.js';
import { play } from '../state/settings.js';

/**
 * The clock.
 *
 * Absolute-deadline based, so backgrounding a tab or a slow phone can never
 * gift extra seconds. It warns without nagging: a colour shift at ten seconds,
 * a single soft cue, then a per-second tick only in the last five.
 */
export function Timer({
  deadline,
  totalMs,
  clockOffset = 0,
  onExpire,
  paused,
}: {
  deadline: number | null;
  totalMs: number;
  clockOffset?: number;
  onExpire?: () => void;
  paused?: boolean;
}) {
  const { remainingMs, fraction } = useCountdown(deadline, totalMs, clockOffset);
  const seconds = Math.ceil(remainingMs / 1000);
  const firedExpire = useRef(false);
  const lastTick = useRef(-1);
  const warned = useRef(false);

  const urgent = remainingMs <= 5000;
  const warn = !urgent && remainingMs <= 10_000;

  useEffect(() => {
    firedExpire.current = false;
    warned.current = false;
    lastTick.current = -1;
  }, [deadline]);

  useEffect(() => {
    if (deadline === null || paused) return;
    if (remainingMs <= 0 && !firedExpire.current) {
      firedExpire.current = true;
      onExpire?.();
      return;
    }
    if (remainingMs <= 10_000 && remainingMs > 5000 && !warned.current) {
      warned.current = true;
      play('warning');
    }
    if (remainingMs <= 5000 && seconds !== lastTick.current && seconds > 0) {
      lastTick.current = seconds;
      play('tick');
    }
  }, [remainingMs, seconds, deadline, onExpire, paused]);

  const tone = urgent ? 'timer--urgent' : warn ? 'timer--warn' : '';

  return (
    <div className={`timer ${tone}`}>
      <div className="timer__track">
        <div
          className="timer__fill"
          style={{
            width: '100%',
            transform: `scaleX(${fraction})`,
            transformOrigin: 'left center',
            transition: 'transform 120ms linear, background-color 400ms linear',
          }}
        />
      </div>
      <span
        className="timer__value"
        role="timer"
        aria-live={urgent ? 'assertive' : 'off'}
        aria-label={`${Math.max(0, seconds)} seconds remaining`}
      >
        {Math.max(0, seconds)}
      </span>
    </div>
  );
}

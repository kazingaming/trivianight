import { useEffect, useRef } from 'react';
import { pickTheme, runScene, type MissDirection } from '../anim/engine.js';
import { staticVerdict, THEMES } from '../anim/themes.js';
import { useReactionsEnabled, useSceneSpeed } from '../state/settings.js';

/**
 * The short scene that plays between locking in and seeing the number.
 *
 * The theme rotates per round so you are not watching the same arrow forever,
 * and the outcome mirrors the guess: overshoot for too high, fall short for
 * too low, dead centre for a bullseye.
 */
export function ReactionScene({
  accuracy,
  direction,
  seed,
  onDone,
  label,
}: {
  accuracy: number;
  direction: MissDirection;
  seed: string;
  onDone?: () => void;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enabled = useReactionsEnabled();
  const speed = useSceneSpeed();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const theme = pickTheme(seed);

  useEffect(() => {
    if (!enabled) {
      // Still let the parent advance on schedule when scenes are switched off.
      const id = setTimeout(() => doneRef.current?.(), 350);
      return () => clearTimeout(id);
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = runScene(
      canvas,
      { accuracy, direction, seed, theme },
      { speed, onDone: () => doneRef.current?.() },
    );
    return stop;
  }, [accuracy, direction, seed, theme, enabled, speed]);

  const description = `${THEMES[theme].label}: ${staticVerdict(accuracy)}`;

  if (!enabled) {
    return (
      <div className="reaction" role="img" aria-label={description}>
        <div className="reaction__static">
          <span className="eyebrow">{THEMES[theme].label}</span>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-2)' }}>
            {staticVerdict(accuracy)}
          </strong>
          {label ? <span className="muted">{label}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="reaction">
      <canvas ref={canvasRef} className="reaction__canvas" role="img" aria-label={description} />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A countdown driven by an absolute deadline rather than a decrementing
 * counter, so it stays correct when a tab is backgrounded, the device sleeps,
 * or the client's clock disagrees with the server's.
 */
export function useCountdown(
  deadline: number | null,
  totalMs: number,
  clockOffsetMs = 0,
): { remainingMs: number; fraction: number; expired: boolean } {
  const [remainingMs, setRemainingMs] = useState(() =>
    deadline === null ? totalMs : Math.max(0, deadline - (Date.now() + clockOffsetMs)),
  );

  useEffect(() => {
    if (deadline === null) {
      setRemainingMs(totalMs);
      return;
    }

    let frame = 0;
    let lastBucket = -1;

    const tick = () => {
      const left = Math.max(0, deadline - (Date.now() + clockOffsetMs));
      // Re-render at 10fps; CSS smooths the bar between updates.
      const bucket = Math.floor(left / 100);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        setRemainingMs(left);
      }
      if (left > 0) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [deadline, totalMs, clockOffsetMs]);

  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  return { remainingMs, fraction, expired: deadline !== null && remainingMs <= 0 };
}

/** Window-level keyboard shortcuts, ignored while the user is typing. */
export function useHotkeys(
  bindings: Record<string, (event: KeyboardEvent) => void>,
  enabled = true,
): void {
  const saved = useRef(bindings);
  useLayoutEffect(() => {
    saved.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      const handler = saved.current[event.key] ?? saved.current[event.key.toLowerCase()];
      if (!handler) return;
      // Enter and Escape still work while typing; letter keys do not.
      if (typing && event.key.length === 1) return;
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** The OS-level reduced-motion preference, live. */
export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Copy text with a "Copied" flag that clears itself. */
export function useCopy(resetMs = 1800): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (text: string) => {
      const done = () => setCopied(true);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }

      function fallback() {
        // execCommand is deprecated but remains the only option on some
        // in-app browsers and non-secure origins.
        try {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          document.body.removeChild(area);
          done();
        } catch {
          setCopied(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), resetMs);
    return () => clearTimeout(id);
  }, [copied, resetMs]);

  return [copied, copy];
}

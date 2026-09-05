import { useMemo } from 'react';
import { formatShort, formatYear } from '@trivia/shared';

export interface LineMarker {
  id: string;
  name: string;
  value: number;
  color: number;
  isYou?: boolean;
}

export type LineScale = 'log' | 'linear' | 'year';

/**
 * Where everyone landed, relative to the truth.
 *
 * Big quantities use a log axis, because that is the axis the scoring uses and
 * the one human intuition actually works on. Guesses that fall outside a
 * sensible window are pinned to the edge and marked as off-scale rather than
 * squashing everyone else into a single pixel.
 */
export function NumberLine({
  answer,
  answerLabel,
  markers,
  scale,
  domain,
}: {
  answer: number;
  answerLabel: string;
  markers: LineMarker[];
  scale: LineScale;
  domain?: [number, number];
}) {
  const layout = useMemo(
    () => buildLayout(answer, markers, scale, domain),
    [answer, markers, scale, domain],
  );

  if (!layout) return null;

  return (
    <div className="numberline">
      <div className="numberline__track">
        {layout.ticks.map((tick) => (
          <span key={tick.position} className="numberline__tick" style={{ left: pct(tick.position) }}>
            <span className="numberline__tick-label">{tick.label}</span>
          </span>
        ))}

        <span
          className="numberline__answer"
          style={{ left: pct(layout.answerPosition) }}
          data-label={answerLabel}
          aria-hidden
        />

        {layout.points.map((point, index) => (
          <span
            key={point.id}
            className={`numberline__marker ${point.offScale ? 'numberline__marker--off' : ''}`}
            data-color={point.color}
            style={{ left: pct(point.position) }}
            title={`${point.name}: ${point.display}${point.offScale ? ' (off the scale)' : ''}`}
          >
            <span className="numberline__pin" />
            {/* Stagger the labels so close guesses stay readable. */}
            <span className="numberline__name" style={{ top: 16 + (index % 2) * 15 }}>
              {point.name}
            </span>
          </span>
        ))}
      </div>
      <p className="sr-only">
        The answer is {answerLabel}.{' '}
        {layout.points.map((point) => `${point.name} guessed ${point.display}. `).join('')}
      </p>
    </div>
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

interface Layout {
  answerPosition: number;
  ticks: Array<{ position: number; label: string }>;
  points: Array<{
    id: string;
    name: string;
    display: string;
    position: number;
    color: number;
    offScale: boolean;
  }>;
}

/**
 * Widest window we will ever draw, in decades either side of the answer.
 * Capped so one absurd outlier cannot squash everybody else into the middle —
 * anything beyond the window is pinned to the edge and flagged off-scale.
 */
const MAX_DECADES = 2;
const MIN_DECADES = 0.8;

function buildLayout(
  answer: number,
  markers: LineMarker[],
  scale: LineScale,
  domain?: [number, number],
): Layout | null {
  if (!Number.isFinite(answer)) return null;

  if (scale === 'log') {
    if (answer <= 0) return null;
    const answerLog = Math.log10(answer);
    const guessLogs = markers
      .filter((marker) => marker.value > 0 && Number.isFinite(marker.value))
      .map((marker) => Math.log10(marker.value));

    const furthest = guessLogs.reduce(
      (max, value) => Math.max(max, Math.abs(value - answerLog)),
      MIN_DECADES,
    );
    const half = Math.min(MAX_DECADES, furthest * 1.15);
    const lo = answerLog - half;
    const hi = answerLog + half;
    const position = (value: number) => (value - lo) / (hi - lo);

    const ticks: Array<{ position: number; label: string }> = [];
    for (let power = Math.ceil(lo); power <= Math.floor(hi); power++) {
      const at = position(power);
      if (at < 0.02 || at > 0.98) continue;
      ticks.push({ position: at, label: formatShort(Math.pow(10, power)) });
    }

    return {
      answerPosition: position(answerLog),
      ticks,
      points: markers.map((marker) => {
        const valid = marker.value > 0 && Number.isFinite(marker.value);
        const raw = valid ? position(Math.log10(marker.value)) : 0;
        return {
          id: marker.id,
          name: marker.name,
          display: formatShort(marker.value),
          position: Math.min(1, Math.max(0, raw)),
          color: marker.color,
          offScale: !valid || raw < 0 || raw > 1,
        };
      }),
    };
  }

  // Linear axes: percentages have a fixed 0-100 domain, years are derived.
  const values = markers.map((marker) => marker.value).filter(Number.isFinite);
  let [lo, hi] = domain ?? [Math.min(answer, ...values), Math.max(answer, ...values)];
  if (!domain) {
    const pad = Math.max((hi - lo) * 0.15, Math.abs(answer) * 0.05, 1);
    lo -= pad;
    hi += pad;
  }
  if (hi <= lo) hi = lo + 1;

  const position = (value: number) => (value - lo) / (hi - lo);
  const format = scale === 'year' ? formatYear : (value: number) => `${Math.round(value)}%`;

  const ticks: Array<{ position: number; label: string }> = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const value = lo + ((hi - lo) * i) / steps;
    ticks.push({ position: i / steps, label: format(value) });
  }

  return {
    answerPosition: Math.min(1, Math.max(0, position(answer))),
    ticks,
    points: markers.map((marker) => {
      const raw = position(marker.value);
      return {
        id: marker.id,
        name: marker.name,
        display: format(marker.value),
        position: Math.min(1, Math.max(0, raw)),
        color: marker.color,
        offScale: raw < 0 || raw > 1,
      };
    }),
  };
}

import { useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { parseHumanNumber, type NumericQuestion } from '@trivia/shared';
import { stripSuffix, toShorthand } from '../lib/format.js';
import { IconCalculator } from './primitives.js';

export interface NumberFieldProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  onOpenCalculator?: () => void;
  unit?: string;
  magnitude?: NumericQuestion['magnitude'];
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
  /** Clamp helper text for bounded formats like percentages. */
  bounds?: { min: number; max: number };
  /**
   * Magnitude shortcuts make no sense on a 0-100 scale, where the caller
   * supplies its own presets instead.
   */
  chips?: 'magnitude' | 'none';
}

/** Suffix chips offered for each expected order of magnitude. */
const CHIP_SETS: Record<NonNullable<NumericQuestion['magnitude']>, string[]> = {
  small: ['k'],
  thousands: ['k', 'm'],
  millions: ['k', 'm', 'b'],
  billions: ['m', 'b', 't'],
  astronomical: ['m', 'b', 't', 'q'],
};

const CHIP_LABELS: Record<string, string> = {
  k: 'K',
  m: 'M',
  b: 'B',
  t: 'T',
  q: 'Qd',
};

const CHIP_TITLES: Record<string, string> = {
  k: 'Thousand',
  m: 'Million',
  b: 'Billion',
  t: 'Trillion',
  q: 'Quadrillion',
};

/**
 * The number entry.
 *
 * Nobody should ever type 20000000000000000. They type "20" and tap Qd, and
 * the interpreted value is echoed underneath in words *and* digits so a
 * magnitude slip is impossible to miss.
 */
export function NumberField({
  value,
  onChange,
  onSubmit,
  onOpenCalculator,
  unit,
  magnitude = 'millions',
  placeholder = 'Your estimate',
  disabled,
  autoFocus,
  label,
  bounds,
  chips: chipMode = 'magnitude',
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const echoId = useId();
  const parsed = useMemo(() => parseHumanNumber(value), [value]);
  const hasText = value.trim().length > 0;

  const outOfBounds =
    bounds && parsed.ok && (parsed.value < bounds.min || parsed.value > bounds.max);

  const applySuffix = (suffix: string) => {
    const base = stripSuffix(value).trim() || '1';
    onChange(`${base}${suffix}`);
    inputRef.current?.focus();
  };

  const scaleBy = (factor: number) => {
    const current = parsed.ok ? parsed.value : 1;
    const next = current === 0 ? factor : current * factor;
    onChange(toShorthand(next));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && parsed.ok && !outOfBounds) {
      event.preventDefault();
      onSubmit?.();
    }
    // Arrow keys nudge by an order of magnitude — fast, and hard to misread.
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && parsed.ok) {
      event.preventDefault();
      scaleBy(event.key === 'ArrowUp' ? 10 : 0.1);
    }
  };

  const chips = CHIP_SETS[magnitude] ?? CHIP_SETS.millions;

  return (
    <div className="numfield">
      <div
        className={`numfield__row ${!parsed.ok && hasText ? 'numfield__row--invalid' : ''}`}
      >
        <input
          ref={inputRef}
          className="numfield__input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          // A decimal pad on mobile; the chips cover the magnitudes so no
          // letters are ever required on a touch keyboard.
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={(event) => {
            // The on-screen keyboard shrinks the visual viewport, which can
            // leave the field under it or push the question off the top.
            // Centring on focus keeps both the prompt and the input visible.
            const input = event.currentTarget;
            setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
          }}
          aria-label={label}
          aria-describedby={echoId}
          aria-invalid={hasText && !parsed.ok}
        />
        {unit ? <span className="numfield__unit">{unit}</span> : null}
        {onOpenCalculator ? (
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onOpenCalculator}
            aria-label="Open calculator"
            title="Calculator (C)"
            disabled={disabled}
          >
            <IconCalculator />
          </button>
        ) : null}
      </div>

      <div
        id={echoId}
        className={`numfield__echo ${hasText && !parsed.ok ? 'numfield__echo--error' : ''}`}
        aria-live="polite"
      >
        {!hasText ? (
          <span className="faint">Type a number, or tap a size below.</span>
        ) : !parsed.ok ? (
          <span>{parsed.error}</span>
        ) : outOfBounds ? (
          <span>
            Needs to be between {bounds!.min} and {bounds!.max}.
          </span>
        ) : (
          <>
            <span className="faint">=</span>
            <strong>{parsed.formatted}</strong>
            {parsed.compact ? <span className="faint">· {parsed.compact}</span> : null}
            {unit ? <span className="faint">{unit}</span> : null}
          </>
        )}
      </div>

      <div className="numfield__chips">
        {chipMode === 'magnitude' ? (
          <>
            {chips.map((suffix) => (
              <button
                key={suffix}
                type="button"
                className="magchip"
                onClick={() => applySuffix(suffix)}
                disabled={disabled}
                title={CHIP_TITLES[suffix]}
              >
                {CHIP_LABELS[suffix]}
              </button>
            ))}
            <button
              type="button"
              className="magchip magchip--tool"
              onClick={() => scaleBy(10)}
              disabled={disabled || !parsed.ok}
              title="Ten times bigger"
            >
              ×10
            </button>
            <button
              type="button"
              className="magchip magchip--tool"
              onClick={() => scaleBy(0.1)}
              disabled={disabled || !parsed.ok}
              title="Ten times smaller"
            >
              ÷10
            </button>
          </>
        ) : null}
        {hasText ? (
          <button
            type="button"
            className="magchip magchip--tool"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            disabled={disabled}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

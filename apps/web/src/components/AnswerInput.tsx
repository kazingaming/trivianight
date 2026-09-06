import { useEffect, useMemo, useState } from 'react';
import {
  clampYear,
  formatYear,
  parseHumanNumber,
  shuffle,
  sliderFromYear,
  YEAR_AXIS_LATEST,
  YEAR_AXIS_OLDEST,
  YEAR_SLIDER_DEFAULT,
  YEAR_SLIDER_DEFAULT_YEAR,
  YEAR_SLIDER_STEPS,
  yearFromSlider,
  type ChoiceOption,
  type Guess,
  type OrderItem,
  type PublicQuestion,
} from '@trivia/shared';
import { NumberField } from './NumberField.js';
import { useIsTouch } from '../lib/hooks.js';
import { IconDown, IconUp, NO_TRANSLATE } from './primitives.js';
import { play } from '../state/settings.js';

/**
 * Every question format, one component.
 *
 * The parent owns "has the player committed"; this owns "what have they
 * chosen so far". Adding a format means adding a branch here and nothing else.
 */

export interface AnswerInputProps {
  question: PublicQuestion;
  disabled?: boolean;
  /** Fires on every change so the parent can enable the lock-in button. */
  onDraft: (guess: Guess | null) => void;
  onSubmit: () => void;
  onOpenCalculator?: () => void;
  /** Set by the calculator's "Use answer" button. */
  injectedValue?: { value: number; nonce: number } | null;
}

export function AnswerInput(props: AnswerInputProps) {
  switch (props.question.type) {
    case 'numeric':
      return <NumericAnswer {...props} />;
    case 'percentage':
    case 'probability':
      return <PercentAnswer {...props} />;
    case 'year':
      return <YearAnswer {...props} />;
    case 'higher-lower':
      return <HigherLowerAnswer {...props} />;
    case 'which-is-bigger':
    case 'which-is-closer':
      return <ChoiceAnswer {...props} />;
    case 'multiple-choice':
      return <MultipleChoiceAnswer {...props} />;
    case 'order':
      return <OrderAnswer {...props} />;
    default:
      return null;
  }
}

/* --- Numeric ----------------------------------------------------------- */

/**
 * Autofocus is a desktop courtesy and a mobile ambush.
 *
 * On a phone, focusing the field the instant a question appears throws up the
 * on-screen keyboard: the viewport resizes, the prompt scrolls away, and the
 * player is reading half a question through a keyboard they did not ask for.
 * On a desktop it just means you can start typing. So it is offered on one and
 * not the other, and the player taps the field when they are ready.
 */
function useAutoFocus(): boolean {
  return !useIsTouch();
}

function NumericAnswer({
  question,
  disabled,
  onDraft,
  onSubmit,
  onOpenCalculator,
  injectedValue,
}: AnswerInputProps) {
  const [text, setText] = useState('');
  const autoFocus = useAutoFocus();
  const parsed = useMemo(() => parseHumanNumber(text), [text]);

  useEffect(() => {
    if (!injectedValue) return;
    setText(String(Number(injectedValue.value.toPrecision(12))));
  }, [injectedValue]);

  useEffect(() => {
    onDraft(parsed.ok ? { kind: 'number', value: parsed.value } : null);
    // onDraft is stable enough in practice; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.ok, parsed.value]);

  return (
    <NumberField
      label={question.prompt}
      value={text}
      onChange={setText}
      onSubmit={onSubmit}
      onOpenCalculator={onOpenCalculator}
      unit={question.unit}
      magnitude={question.magnitude}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  );
}

/* --- Percentage / probability ------------------------------------------ */

const PERCENT_PRESETS = [1, 10, 25, 50, 75, 90, 99];

function PercentAnswer({
  question,
  disabled,
  onDraft,
  onSubmit,
  onOpenCalculator,
  injectedValue,
}: AnswerInputProps) {
  const [text, setText] = useState('');
  const autoFocus = useAutoFocus();
  const parsed = useMemo(() => parseHumanNumber(text), [text]);
  const value = parsed.ok ? Math.min(100, Math.max(0, parsed.value)) : 50;
  const valid = parsed.ok && parsed.value >= 0 && parsed.value <= 100;

  useEffect(() => {
    if (!injectedValue) return;
    setText(String(Number(injectedValue.value.toPrecision(6))));
  }, [injectedValue]);

  useEffect(() => {
    onDraft(valid ? { kind: 'number', value: parsed.value } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, parsed.value]);

  const isProbability = question.type === 'probability';

  return (
    <div className="numfield">
      <NumberField
        label={question.prompt}
        value={text}
        onChange={setText}
        onSubmit={onSubmit}
        onOpenCalculator={onOpenCalculator}
        unit="%"
        magnitude="small"
        chips="none"
        placeholder={isProbability ? 'Chance out of 100' : 'Percentage'}
        disabled={disabled}
        bounds={{ min: 0, max: 100 }}
        autoFocus={autoFocus}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        aria-label={`${question.prompt} — slider`}
        style={{ accentColor: 'var(--cyan)', width: '100%' }}
      />
      <div className="numfield__chips">
        {PERCENT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="magchip"
            disabled={disabled}
            onClick={() => {
              play('tap');
              setText(String(preset));
            }}
          >
            {preset}%
          </button>
        ))}
      </div>
    </div>
  );
}

/* --- Year --------------------------------------------------------------- */

/**
 * Year input.
 *
 * The slider runs along one shared timeline for every year question and always
 * opens in the same place on it, so its starting position says nothing about
 * the answer. Typing is the precise route; the slider is the exploratory one.
 */
function YearAnswer({ question, disabled, onDraft, onSubmit, injectedValue }: AnswerInputProps) {
  const [position, setPosition] = useState(YEAR_SLIDER_DEFAULT);
  const [year, setYear] = useState(YEAR_SLIDER_DEFAULT_YEAR);
  const [text, setText] = useState('');
  const autoFocus = useAutoFocus();

  const commitYear = (next: number) => {
    const clamped = clampYear(next);
    setYear(clamped);
    setPosition(sliderFromYear(clamped));
    return clamped;
  };

  useEffect(() => {
    if (!injectedValue) return;
    setText(formatYear(commitYear(injectedValue.value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedValue]);

  useEffect(() => {
    onDraft({ kind: 'number', value: year });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const commitText = (raw: string) => {
    setText(raw);
    const parsed = parseHumanNumber(raw.replace(/\s*(bce|bc)\s*$/i, ''));
    if (!parsed.ok) return;
    const negative = /bce|bc/i.test(raw);
    commitYear(negative ? -Math.abs(parsed.value) : parsed.value);
  };

  const nudge = (step: number) => {
    setText(formatYear(commitYear(year + step)));
  };

  return (
    <div className="numfield">
      <div className="numfield__row">
        <input
          className="numfield__input"
          value={text}
          onChange={(event) => commitText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
          inputMode="numeric"
          placeholder="Year"
          disabled={disabled}
          aria-label={`${question.prompt} — type a year`}
          autoFocus={autoFocus}
        />
        <span className="numfield__unit">{year < 0 ? 'BCE' : 'CE'}</span>
      </div>

      <div className="numfield__echo" aria-live="polite">
        <span className="faint">=</span>
        <strong>{formatYear(year)}</strong>
      </div>

      <input
        type="range"
        min={0}
        max={YEAR_SLIDER_STEPS}
        step={1}
        value={position}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          setPosition(next);
          const asYear = yearFromSlider(next);
          setYear(asYear);
          setText(formatYear(asYear));
        }}
        aria-label={`${question.prompt} — slider`}
        aria-valuetext={formatYear(year)}
        style={{ accentColor: 'var(--cyan)', width: '100%' }}
      />

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
          {formatYear(YEAR_AXIS_OLDEST)}
        </span>
        <div className="numfield__chips">
          {[-100, -10, +10, +100].map((step) => (
            <button
              key={step}
              type="button"
              className="magchip magchip--tool"
              disabled={disabled}
              onClick={() => nudge(step)}
            >
              {step > 0 ? `+${step}` : step}
            </button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
          {formatYear(YEAR_AXIS_LATEST)}
        </span>
      </div>
    </div>
  );
}

/* --- Higher / lower ------------------------------------------------------ */

function HigherLowerAnswer({ question, disabled, onDraft }: AnswerInputProps) {
  const [choice, setChoice] = useState<'higher' | 'lower' | null>(null);

  const pick = (next: 'higher' | 'lower') => {
    play('tap');
    setChoice(next);
    onDraft({ kind: 'higher-lower', value: next });
  };

  return (
    <div className="stack">
      <p className="question__sub">
        Is the real figure higher or lower than <strong>{question.reference}</strong>?
      </p>
      <div className="choices choices--pair">
        {(['higher', 'lower'] as const).map((option, index) => (
          <button
            key={option}
            type="button"
            className="choice"
            aria-pressed={choice === option}
            disabled={disabled}
            onClick={() => pick(option)}
          >
            <span className="choice__key notranslate" {...NO_TRANSLATE}>{index + 1}</span>
            <span>{option === 'higher' ? 'Higher' : 'Lower'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --- Two-option comparison ------------------------------------------------ */

function ChoiceAnswer({ question, disabled, onDraft }: AnswerInputProps) {
  const [choice, setChoice] = useState<0 | 1 | null>(null);
  const options = (question.options ?? []) as ChoiceOption[];

  const pick = (index: 0 | 1) => {
    play('tap');
    setChoice(index);
    onDraft({ kind: 'binary', value: index });
  };

  return (
    <div className="choices choices--pair">
      {options.map((option, index) => (
        <button
          key={option.label}
          type="button"
          className="choice"
          aria-pressed={choice === index}
          disabled={disabled}
          onClick={() => pick(index as 0 | 1)}
        >
          <span className="choice__key notranslate" {...NO_TRANSLATE}>{index === 0 ? 'A' : 'B'}</span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/* --- Multiple choice -------------------------------------------------------- */

function MultipleChoiceAnswer({ question, disabled, onDraft }: AnswerInputProps) {
  const [choice, setChoice] = useState<number | null>(null);
  const options = (question.options ?? []) as string[];

  const pick = (index: number) => {
    play('tap');
    setChoice(index);
    onDraft({ kind: 'binary', value: index as 0 | 1 });
  };

  return (
    <div className={`choices ${options.length === 2 ? 'choices--pair' : ''}`}>
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          className="choice"
          aria-pressed={choice === index}
          disabled={disabled}
          onClick={() => pick(index)}
        >
          <span className="choice__key notranslate" {...NO_TRANSLATE}>
            {String.fromCharCode(65 + index)}
          </span>
          <span>{option}</span>
        </button>
      ))}
    </div>
  );
}

/* --- Order ------------------------------------------------------------------ */

function OrderAnswer({ question, disabled, onDraft }: AnswerInputProps) {
  const source = (question.items ?? []) as OrderItem[];
  // Present in a shuffled order that is stable for this question.
  const [items, setItems] = useState<OrderItem[]>(() => shuffle(source));

  useEffect(() => {
    setItems(shuffle(source));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  useEffect(() => {
    onDraft({ kind: 'order', value: items.map((item) => item.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    play('tap');
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  return (
    <div className="stack">
      <p className="question__sub">{question.instruction}</p>
      <ul className="orderlist">
        {items.map((item, index) => (
          <li className="orderitem" key={item.id}>
            <span className="orderitem__rank">{index + 1}</span>
            <span className="orderitem__label">{item.label}</span>
            <span className="orderitem__moves">
              <button
                type="button"
                className="orderitem__move"
                onClick={() => move(index, -1)}
                disabled={disabled || index === 0}
                aria-label={`Move ${item.label} up`}
              >
                <IconUp />
              </button>
              <button
                type="button"
                className="orderitem__move"
                onClick={() => move(index, 1)}
                disabled={disabled || index === items.length - 1}
                aria-label={`Move ${item.label} down`}
              >
                <IconDown />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

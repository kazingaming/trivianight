import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatGrouped, formatShort } from '@trivia/shared';
import { play } from '../state/settings.js';

/**
 * A plain arithmetic calculator.
 *
 * Deliberately dumb: four operations, a percent key and nothing else. Doing a
 * little multiplication is part of Fermi reasoning; looking things up is not.
 * It never pauses the clock — thinking time is the cost of using it.
 */

type Token = number | Operator;
type Operator = '+' | '-' | '*' | '/';

const OPERATORS: Operator[] = ['+', '-', '*', '/'];
const SYMBOL: Record<Operator, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

function isOperator(token: Token): token is Operator {
  return typeof token === 'string';
}

/** Two-pass evaluation so multiplication binds tighter than addition. */
function evaluate(tokens: Token[]): number {
  if (tokens.length === 0) return 0;
  const first: Token[] = [];

  for (const token of tokens) {
    const previous = first[first.length - 1];
    if (typeof token === 'number' && (previous === '*' || previous === '/')) {
      const operator = first.pop() as Operator;
      const left = first.pop() as number;
      first.push(operator === '*' ? left * token : token === 0 ? Number.NaN : left / token);
    } else {
      first.push(token);
    }
  }

  let result = typeof first[0] === 'number' ? first[0] : 0;
  for (let i = 1; i < first.length; i += 2) {
    const operator = first[i];
    const operand = first[i + 1];
    if (!isOperator(operator) || typeof operand !== 'number') break;
    result = operator === '+' ? result + operand : result - operand;
  }
  return result;
}

interface CalcState {
  tokens: Token[];
  /** The number being typed. Empty means "waiting for the next operand". */
  entry: string;
  justEvaluated: boolean;
}

type CalcAction =
  | { type: 'digit'; value: string }
  | { type: 'operator'; value: Operator }
  | { type: 'equals' }
  | { type: 'percent' }
  | { type: 'clear' }
  | { type: 'backspace' };

const INITIAL: CalcState = { tokens: [], entry: '0', justEvaluated: false };

function operandOf(state: CalcState): number {
  return state.entry === '' ? 0 : Number(state.entry);
}

function pending(state: CalcState): Token[] {
  return state.entry === '' ? state.tokens : [...state.tokens, operandOf(state)];
}

/**
 * Every press is a pure transition, so several in the same tick (a fast
 * double-tap, a held key) compose correctly instead of reading stale state.
 */
function reduce(state: CalcState, action: CalcAction): CalcState {
  switch (action.type) {
    case 'digit': {
      const base = state.justEvaluated ? '0' : state.entry;
      const tokens = state.justEvaluated ? [] : state.tokens;
      let entry: string;
      if (action.value === '.') entry = base.includes('.') ? base : `${base || '0'}.`;
      else if (base === '0') entry = action.value;
      // Long enough for anything, short enough to stay readable.
      else entry = base.length >= 15 ? base : base + action.value;
      return { tokens, entry, justEvaluated: false };
    }
    case 'operator': {
      // Replacing a trailing operator is what everyone expects.
      if (
        state.entry === '' &&
        state.tokens.length > 0 &&
        isOperator(state.tokens[state.tokens.length - 1])
      ) {
        return {
          tokens: [...state.tokens.slice(0, -1), action.value],
          entry: '',
          justEvaluated: false,
        };
      }
      return {
        tokens: [...state.tokens, operandOf(state), action.value],
        entry: '',
        justEvaluated: false,
      };
    }
    case 'equals': {
      const value = evaluate(pending(state));
      return {
        tokens: [],
        entry: Number.isFinite(value) ? trim(value) : '0',
        justEvaluated: true,
      };
    }
    case 'percent':
      return { ...state, entry: trim(operandOf(state) / 100), justEvaluated: false };
    case 'clear':
      return { ...INITIAL };
    case 'backspace': {
      if (state.justEvaluated || state.entry.length <= 1) {
        return { ...state, entry: '0', justEvaluated: false };
      }
      return { ...state, entry: state.entry.slice(0, -1), justEvaluated: false };
    }
    default:
      return state;
  }
}

export function Calculator({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (value: number) => void;
}) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const panel = useRef<HTMLDivElement>(null);
  const { tokens, entry } = state;

  const current = operandOf(state);
  const preview = evaluate(pending(state));

  const pressDigit = useCallback((digit: string) => {
    play('tap');
    dispatch({ type: 'digit', value: digit });
  }, []);

  const pressOperator = useCallback((operator: Operator) => {
    play('tap');
    dispatch({ type: 'operator', value: operator });
  }, []);

  const pressEquals = useCallback(() => {
    play('tap');
    dispatch({ type: 'equals' });
  }, []);

  const pressPercent = useCallback(() => {
    play('tap');
    dispatch({ type: 'percent' });
  }, []);

  const clearAll = useCallback(() => {
    play('tap');
    dispatch({ type: 'clear' });
  }, []);

  const backspace = useCallback(() => dispatch({ type: 'backspace' }), []);

  const use = useCallback(() => {
    const value = evaluate(pending(state));
    if (Number.isFinite(value)) {
      play('lock');
      onUse(value);
      onClose();
    }
  }, [state, onClose, onUse]);

  // Keyboard support: the calculator is usable without ever touching a key cap.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const { key } = event;
      if (key >= '0' && key <= '9') {
        event.preventDefault();
        pressDigit(key);
      } else if (key === '.' || key === ',') {
        event.preventDefault();
        pressDigit('.');
      } else if (OPERATORS.includes(key as Operator)) {
        event.preventDefault();
        pressOperator(key as Operator);
      } else if (key === 'x' || key === 'X') {
        event.preventDefault();
        pressOperator('*');
      } else if (key === 'Enter' || key === '=') {
        event.preventDefault();
        pressEquals();
      } else if (key === 'Backspace') {
        event.preventDefault();
        backspace();
      } else if (key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (key === '%') {
        event.preventDefault();
        pressPercent();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, pressDigit, pressOperator, pressEquals, backspace, pressPercent, onClose]);

  const expression = tokens
    .map((token) => (isOperator(token) ? SYMBOL[token] : formatGrouped(token)))
    .join(' ');

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panel}
            className="calc"
            role="dialog"
            aria-label="Calculator"
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="calc__display">
              <div className="calc__expr">{expression || ' '}</div>
              <div className="calc__value" aria-live="polite">
                {entry === '' ? formatGrouped(preview) : formatGrouped(current)}
              </div>
              <div className="calc__expr">
                {Number.isFinite(preview) && Math.abs(preview) >= 10000
                  ? formatShort(preview)
                  : ' '}
              </div>
            </div>

            <div className="calc__keys">
              <Key className="calc__key--fn" onPress={clearAll} label="Clear">
                C
              </Key>
              <Key className="calc__key--fn" onPress={backspace} label="Backspace">
                ⌫
              </Key>
              <Key className="calc__key--fn" onPress={pressPercent} label="Percent">
                %
              </Key>
              <Key className="calc__key--op" onPress={() => pressOperator('/')} label="Divide">
                ÷
              </Key>

              {['7', '8', '9'].map((digit) => (
                <Key key={digit} onPress={() => pressDigit(digit)} label={digit}>
                  {digit}
                </Key>
              ))}
              <Key className="calc__key--op" onPress={() => pressOperator('*')} label="Multiply">
                ×
              </Key>

              {['4', '5', '6'].map((digit) => (
                <Key key={digit} onPress={() => pressDigit(digit)} label={digit}>
                  {digit}
                </Key>
              ))}
              <Key className="calc__key--op" onPress={() => pressOperator('-')} label="Subtract">
                −
              </Key>

              {['1', '2', '3'].map((digit) => (
                <Key key={digit} onPress={() => pressDigit(digit)} label={digit}>
                  {digit}
                </Key>
              ))}
              <Key className="calc__key--op" onPress={() => pressOperator('+')} label="Add">
                +
              </Key>

              <Key onPress={() => pressDigit('0')} label="Zero">
                0
              </Key>
              <Key onPress={() => pressDigit('.')} label="Decimal point">
                .
              </Key>
              <Key className="calc__key--op" onPress={pressEquals} label="Equals">
                =
              </Key>
              <Key className="calc__key--fn" onPress={onClose} label="Close calculator">
                ✕
              </Key>

              <Key className="calc__key--use" onPress={use} label="Use this number as my answer">
                Use answer
              </Key>
              <Key className="calc__key--fn calc__key--wide" onPress={onClose} label="Close">
                Close
              </Key>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Key({
  children,
  onPress,
  className = '',
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  className?: string;
  label: string;
}) {
  return (
    <button type="button" className={`calc__key ${className}`} onClick={onPress} aria-label={label}>
      {children}
    </button>
  );
}

function trim(value: number): string {
  if (!Number.isFinite(value)) return '0';
  // Keep precision without printing 0.30000000000000004.
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

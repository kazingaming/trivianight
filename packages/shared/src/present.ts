/**
 * Turning a Question into the two things the game actually shows:
 * a spoiler-free prompt, and a reveal.
 *
 * Solo runs entirely in the browser and multiplayer runs on the server, so
 * this lives in shared code and both paths render identical strings.
 */

import { formatDisplay, formatGrouped, formatYear } from './numbers.js';
import type {
  ChoiceOption,
  Guess,
  OrderItem,
  PublicQuestion,
  Question,
  RevealPayload,
} from './types.js';
import { shuffle, type Rng } from './util.js';

/**
 * Strip everything a player could use to cheat.
 * Difficulty is deliberately omitted: knowing a question is "Wildcard" leaks
 * that the answer is absurd, which would let players game the ramp.
 */
export function toPublicQuestion(question: Question, rng: Rng = Math.random): PublicQuestion {
  const base: PublicQuestion = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    subPrompt: question.subPrompt,
    category: question.category,
    tags: question.tags,
  };

  switch (question.type) {
    case 'numeric':
      return { ...base, unit: question.unit, magnitude: question.magnitude };
    case 'percentage':
    case 'probability':
      return base;
    case 'year':
      return { ...base, range: question.range };
    case 'higher-lower':
      return { ...base, reference: question.reference };
    case 'which-is-bigger':
    case 'which-is-closer':
      // Labels only — the `detail` fields would give the comparison away.
      return {
        ...base,
        options: question.options.map((option) => ({ label: option.label })) as ChoiceOption[],
      };
    case 'multiple-choice':
      return { ...base, options: question.options.slice() };
    case 'order':
      return {
        ...base,
        instruction: question.instruction,
        items: shuffle(question.items, rng).map((item) => ({
          id: item.id,
          label: item.label,
        })) as OrderItem[],
      };
    default:
      return base;
  }
}

/** The headline string for the reveal, honouring hand-written precision. */
export function answerLabel(question: Question): string {
  switch (question.type) {
    case 'numeric':
      return question.displayAnswer ?? formatDisplay(question.answer, question.unit);
    case 'percentage':
      return question.displayAnswer ?? `${trim(question.answer)}%`;
    case 'probability':
      return question.displayAnswer ?? `${trim(question.answer)}%`;
    case 'year':
      return question.displayAnswer ?? formatYear(question.answer);
    case 'higher-lower':
      return question.actual;
    case 'which-is-bigger':
    case 'which-is-closer':
      return question.options[question.answer].label;
    case 'multiple-choice':
      return question.options[question.answer] ?? '';
    case 'order':
      return question.items.map((item) => item.label).join('  ·  ');
    default:
      return '';
  }
}

/** The numeric truth, where one exists. Drives the reveal number line. */
export function answerValue(question: Question): number | null {
  switch (question.type) {
    case 'numeric':
    case 'percentage':
    case 'probability':
    case 'year':
      return question.answer;
    default:
      return null;
  }
}

export function toRevealPayload(question: Question): RevealPayload {
  const payload: RevealPayload = {
    answerValue: answerValue(question),
    answerLabel: answerLabel(question),
    reveal: question.reveal,
    source: question.source,
  };

  switch (question.type) {
    case 'numeric':
      payload.unit = question.unit;
      break;
    case 'higher-lower':
      payload.correctSide = question.answer;
      payload.actual = question.actual;
      break;
    case 'which-is-bigger':
    case 'which-is-closer':
      payload.correctIndex = question.answer;
      payload.optionDetails = question.options.map((option) => option.detail);
      break;
    case 'multiple-choice':
      payload.correctIndex = question.answer;
      break;
    case 'order':
      payload.correctOrder = question.items.map((item) => item.id);
      payload.optionDetails = question.items.map((item) => item.detail);
      break;
    default:
      break;
  }
  return payload;
}

/** How a player's submission is written on the reveal screen. */
export function guessLabel(question: PublicQuestion, guess: Guess | null | undefined): string {
  if (!guess || guess.kind === 'none') return 'No guess';
  switch (question.type) {
    case 'numeric':
      return guess.kind === 'number' ? formatDisplay(guess.value, question.unit) : 'No guess';
    case 'percentage':
    case 'probability':
      return guess.kind === 'number' ? `${trim(guess.value)}%` : 'No guess';
    case 'year':
      return guess.kind === 'number' ? formatYear(guess.value) : 'No guess';
    case 'higher-lower':
      return guess.kind === 'higher-lower'
        ? guess.value === 'higher'
          ? 'Higher'
          : 'Lower'
        : 'No guess';
    case 'which-is-bigger':
    case 'which-is-closer': {
      if (guess.kind !== 'binary') return 'No guess';
      const options = question.options as ChoiceOption[] | undefined;
      return options?.[guess.value]?.label ?? 'No guess';
    }
    case 'multiple-choice': {
      if (guess.kind !== 'binary' && guess.kind !== 'number') return 'No guess';
      const options = question.options as string[] | undefined;
      return options?.[guess.value as number] ?? 'No guess';
    }
    case 'order': {
      if (guess.kind !== 'order') return 'No guess';
      const byId = new Map((question.items ?? []).map((item) => [item.id, item.label]));
      return guess.value.map((id) => byId.get(id) ?? id).join('  ·  ');
    }
    default:
      return 'No guess';
  }
}

/** True when the format puts guesses on a shared number line. */
export function isNumericFormat(type: PublicQuestion['type']): boolean {
  return type === 'numeric' || type === 'percentage' || type === 'probability' || type === 'year';
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : formatGrouped(rounded);
}

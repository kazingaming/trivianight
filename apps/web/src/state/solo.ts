/**
 * Solo Gauntlet.
 *
 * Runs entirely in the browser — no server, no latency, and it keeps working
 * if the game is ever packaged for a platform without a backend. The full
 * question (answer included) is therefore in memory during a round; in a
 * single-player high-score mode the only person you could cheat is yourself.
 */

import { create } from 'zustand';
import { QuestionPool } from '@trivia/content';
import {
  answerLabel,
  bandFor,
  computeRoundPoints,
  costsLife,
  extendsStreak,
  guessLabel,
  MODES,
  resolveTimeLimit,
  scoreGuess,
  toPublicQuestion,
  toRevealPayload,
  type Difficulty,
  type FeedbackBand,
  type Guess,
  type PublicQuestion,
  type Question,
  type RevealPayload,
  type ScoreResult,
} from '@trivia/shared';

import {
  loadRecentQuestions,
  loadSoloRecord,
  rememberQuestions,
  saveSoloRecord,
  type SoloRecord,
} from '../lib/storage.js';
import { useSettings } from './settings.js';
import { useAccount } from './account.js';

export type SoloPhase = 'idle' | 'question' | 'reveal' | 'over';

export interface SoloRoundRecord {
  round: number;
  questionId: string;
  prompt: string;
  answerLabel: string;
  guessLabel: string;
  accuracy: number;
  band: FeedbackBand;
  missLabel: string | null;
  points: number;
  difficulty: Difficulty;
  answered: boolean;
  lostLife: boolean;
}

export interface SoloResult {
  score: ScoreResult;
  points: ReturnType<typeof computeRoundPoints>;
  reveal: RevealPayload;
  lostLife: boolean;
  streakAfter: number;
}

export interface SoloState {
  phase: SoloPhase;
  round: number;
  score: number;
  streak: number;
  bestStreak: number;
  lives: number;
  maxLives: number;
  question: Question | null;
  publicQuestion: PublicQuestion | null;
  timeLimitMs: number;
  deadline: number | null;
  guess: Guess | null;
  result: SoloResult | null;
  history: SoloRoundRecord[];
  record: SoloRecord;
  /** Set when the bank runs out rather than the player running out of lives. */
  endedBecause: 'lives' | 'pool' | null;

  start: () => void;
  submit: (guess: Guess) => void;
  timeUp: () => void;
  next: () => void;
  quit: () => void;
}

const MAX_LIVES = MODES.solo.lives ?? 3;

let pool: QuestionPool | null = null;

export const useSolo = create<SoloState>((set, get) => ({
  phase: 'idle',
  round: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  lives: MAX_LIVES,
  maxLives: MAX_LIVES,
  question: null,
  publicQuestion: null,
  timeLimitMs: 0,
  deadline: null,
  guess: null,
  result: null,
  history: [],
  record: loadSoloRecord(),
  endedBecause: null,

  start: () => {
    // Skip questions from recent runs so back-to-back games feel different —
    // but never so many that the pool cannot fill a proper gauntlet.
    const recent = loadRecentQuestions().slice(0, 24);
    pool = new QuestionPool({ mode: 'solo', exclude: recent });
    set({
      phase: 'idle',
      round: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      lives: MAX_LIVES,
      question: null,
      publicQuestion: null,
      guess: null,
      result: null,
      history: [],
      endedBecause: null,
      record: loadSoloRecord(),
    });
    advance();
  },

  submit: (guess) => {
    const state = get();
    if (state.phase !== 'question' || !state.question) return;
    resolve(guess);
  },

  timeUp: () => {
    const state = get();
    if (state.phase !== 'question') return;
    resolve({ kind: 'none' });
  },

  next: () => {
    const state = get();
    if (state.phase !== 'reveal') return;
    if (state.lives <= 0) return finish('lives');
    advance();
  },

  quit: () => {
    const state = get();
    if (state.phase === 'question' || state.phase === 'reveal') finish('lives');
    else set({ phase: 'idle' });
  },
}));

/** Draw the next question and open the clock. */
function advance(): void {
  const state = useSolo.getState();
  const question = pool?.next(state.round + 1) ?? null;
  if (!question) return finish('pool');

  const timerPreference = useSettings.getState().settings.timer;
  const seconds = resolveTimeLimit('solo', timerPreference, question.timeLimitSec);

  useSolo.setState({
    phase: 'question',
    round: state.round + 1,
    question,
    publicQuestion: toPublicQuestion(question),
    guess: null,
    result: null,
    timeLimitMs: seconds * 1000,
    deadline: Date.now() + seconds * 1000,
  });
}

function resolve(guess: Guess): void {
  const state = useSolo.getState();
  const question = state.question;
  if (!question) return;

  const elapsed = state.deadline === null ? 0 : state.timeLimitMs - (state.deadline - Date.now());
  const speed = state.timeLimitMs > 0 ? 1 - Math.min(1, Math.max(0, elapsed / state.timeLimitMs)) : 0.5;

  const score = scoreGuess(question, guess, { speed });
  const points = computeRoundPoints({
    score,
    difficulty: question.difficulty,
    streak: state.streak,
  });

  const lostLife = costsLife(score);
  const streakAfter = extendsStreak(score) ? state.streak + 1 : 0;
  const lives = Math.max(0, state.lives - (lostLife ? 1 : 0));

  const record: SoloRoundRecord = {
    round: state.round,
    questionId: question.id,
    prompt: question.prompt,
    answerLabel: answerLabel(question),
    guessLabel: guessLabel(state.publicQuestion ?? toPublicQuestion(question), guess),
    accuracy: score.accuracy,
    band: bandFor(score.accuracy),
    missLabel: score.miss?.label ?? null,
    points: points.total,
    difficulty: question.difficulty,
    answered: score.answered,
    lostLife,
  };

  useSolo.setState({
    phase: 'reveal',
    guess,
    lives,
    score: state.score + points.total,
    streak: streakAfter,
    bestStreak: Math.max(state.bestStreak, streakAfter),
    deadline: null,
    history: [...state.history, record],
    result: {
      score,
      points,
      reveal: toRevealPayload(question),
      lostLife,
      streakAfter,
    },
  });
}

function finish(reason: 'lives' | 'pool'): void {
  const state = useSolo.getState();
  rememberQuestions(state.history.map((entry) => entry.questionId));
  const run = {
    score: state.score,
    rounds: state.history.length,
    streak: state.bestStreak,
  };
  const record = saveSoloRecord(run);
  /*
   * Also push the run at the account, if there is one. Deliberately not
   * awaited: the device's copy is already saved, so the game-over screen must
   * not wait on a network round trip to appear.
   */
  void useAccount.getState().reportSoloRun(run);
  useSolo.setState({
    phase: 'over',
    endedBecause: reason,
    deadline: null,
    question: null,
    publicQuestion: null,
    record,
  });
}

/** Highlights for the game-over screen. */
export function summarise(history: SoloRoundRecord[]) {
  const answered = history.filter((entry) => entry.answered);
  const best = answered.reduce<SoloRoundRecord | null>(
    (leader, entry) => (!leader || entry.accuracy > leader.accuracy ? entry : leader),
    null,
  );
  const worst = answered.reduce<SoloRoundRecord | null>(
    (leader, entry) => (!leader || entry.accuracy < leader.accuracy ? entry : leader),
    null,
  );
  const averageAccuracy =
    answered.length > 0
      ? answered.reduce((sum, entry) => sum + entry.accuracy, 0) / answered.length
      : 0;
  return { best, worst, averageAccuracy, answered: answered.length };
}

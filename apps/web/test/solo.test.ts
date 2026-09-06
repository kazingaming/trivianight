/**
 * The Solo Gauntlet's run loop.
 *
 * The behaviour this exists to pin down: losing your last life is not a
 * special case. The answer to the question you just got wrong is revealed
 * exactly as it is for any other round, and the run ends only when the player
 * moves on from that reveal. Ending the run straight from a wrong answer means
 * never finding out what the answer was, which is the whole point of the game.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useSolo } from '../src/state/solo.js';
import type { Guess, PublicQuestion } from '@trivia/shared';

/** A guess that is wrong in whatever way this question format allows. */
function terribleGuess(question: PublicQuestion): Guess {
  switch (question.type) {
    case 'numeric':
      return { kind: 'number', value: 1 };
    case 'percentage':
    case 'probability':
      return { kind: 'number', value: 0 };
    case 'year':
      return { kind: 'number', value: -40_000 };
    case 'higher-lower':
      return { kind: 'higher-lower', value: 'lower' };
    case 'order':
      return { kind: 'order', value: (question.items ?? []).map((item) => item.id).reverse() };
    default:
      return { kind: 'binary', value: 0 };
  }
}

/** Answer badly until a life is lost, and report the state at that moment. */
function loseOneLife(): { lostLife: boolean; rounds: number } {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = useSolo.getState();
    if (state.phase !== 'question' || !state.publicQuestion) break;
    state.submit(terribleGuess(state.publicQuestion));
    const after = useSolo.getState();
    if (after.result?.lostLife) return { lostLife: true, rounds: after.round };
    if (after.phase !== 'reveal') break;
    after.next();
  }
  return { lostLife: false, rounds: useSolo.getState().round };
}

beforeEach(() => {
  useSolo.getState().start();
});

describe('a solo run', () => {
  it('starts on a question with a full set of lives', () => {
    const state = useSolo.getState();
    expect(state.phase).toBe('question');
    expect(state.lives).toBe(state.maxLives);
    expect(state.round).toBe(1);
    expect(state.publicQuestion).not.toBeNull();
  });

  it('reveals the answer after every guess, including the one that ends the run', () => {
    let guard = 0;
    while (useSolo.getState().lives > 0 && guard++ < 200) {
      const state = useSolo.getState();
      expect(state.phase, 'still asking questions').toBe('question');
      const outcome = loseOneLife();
      expect(outcome.lostLife, 'a wrong answer costs a life').toBe(true);

      const after = useSolo.getState();
      // The reveal is shown whether that was the first life or the last.
      expect(after.phase, `reveal after losing a life (lives ${after.lives})`).toBe('reveal');
      expect(after.result).not.toBeNull();
      expect(after.result!.reveal.answerLabel.length).toBeGreaterThan(0);

      if (after.lives > 0) after.next();
    }

    // Out of lives, and still on the reveal — nothing has skipped past it.
    const outOfLives = useSolo.getState();
    expect(outOfLives.lives).toBe(0);
    expect(outOfLives.phase).toBe('reveal');
    expect(outOfLives.result!.lostLife).toBe(true);

    // Only moving on from that reveal ends the run.
    outOfLives.next();
    const over = useSolo.getState();
    expect(over.phase).toBe('over');
    expect(over.endedBecause).toBe('lives');
    expect(over.history.length).toBe(outOfLives.round);
  });

  it('reveals the answer when the clock runs out on the last life too', () => {
    // Drop to one life the honest way, then let the timer expire.
    let guard = 0;
    while (useSolo.getState().lives > 1 && guard++ < 200) {
      loseOneLife();
      const state = useSolo.getState();
      if (state.phase === 'reveal' && state.lives > 0) state.next();
    }
    expect(useSolo.getState().lives).toBe(1);

    // Advance to a fresh question if the previous reveal is still up.
    if (useSolo.getState().phase === 'reveal') useSolo.getState().next();
    expect(useSolo.getState().phase).toBe('question');

    useSolo.getState().timeUp();
    const after = useSolo.getState();
    expect(after.phase, 'a timeout reveals the answer as well').toBe('reveal');
    expect(after.lives).toBe(0);
    expect(after.result!.score.answered).toBe(false);
    expect(after.result!.reveal.answerLabel.length).toBeGreaterThan(0);

    after.next();
    expect(useSolo.getState().phase).toBe('over');
  });

  it('ignores a second advance from the reveal', () => {
    loseOneLife();
    const revealed = useSolo.getState();
    expect(revealed.phase).toBe('reveal');
    const round = revealed.round;

    revealed.next();
    const moved = useSolo.getState();
    // One advance, one round: the store must not double-step if the button is
    // somehow activated twice.
    expect(moved.round).toBe(round + 1);
    expect(moved.phase).toBe('question');
  });

  it('never asks the same question twice in one run', () => {
    const seen = new Set<string>();
    let guard = 0;
    while (useSolo.getState().phase !== 'over' && guard++ < 120) {
      const state = useSolo.getState();
      if (state.phase === 'question' && state.publicQuestion) {
        expect(seen.has(state.publicQuestion.id), state.publicQuestion.id).toBe(false);
        seen.add(state.publicQuestion.id);
        state.submit(terribleGuess(state.publicQuestion));
      }
      const after = useSolo.getState();
      if (after.phase === 'reveal') after.next();
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('opens on a different question run after run', () => {
    const openings = new Set<string>();
    for (let i = 0; i < 25; i++) {
      useSolo.getState().start();
      openings.add(useSolo.getState().publicQuestion!.id);
    }
    expect(openings.size).toBeGreaterThan(5);
  });
});

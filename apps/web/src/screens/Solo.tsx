import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DIFFICULTY_NAMES, streakLabel, type Guess } from '@trivia/shared';

import { AnswerInput } from '../components/AnswerInput.js';
import { Calculator } from '../components/Calculator.js';
import { Reveal, type RevealPlayer } from '../components/Reveal.js';
import { Timer } from '../components/Timer.js';
import { Lives, Stat } from '../components/primitives.js';
import { useHotkeys } from '../lib/hooks.js';
import { play, useSettings } from '../state/settings.js';
import { summarise, useSolo } from '../state/solo.js';

export function SoloScreen() {
  const state = useSolo();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Guess | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [injected, setInjected] = useState<{ value: number; nonce: number } | null>(null);
  const identity = useSettings((s) => s.identity);

  const { phase, question, publicQuestion, result } = state;

  useEffect(() => {
    setDraft(null);
    setInjected(null);
  }, [publicQuestion?.id]);

  const lockIn = useCallback(() => {
    if (state.phase !== 'question' || !draft) return;
    play('lock');
    state.submit(draft);
  }, [draft, state]);

  const next = useCallback(() => {
    if (state.phase !== 'reveal') return;
    play('advance');
    state.next();
  }, [state]);

  useHotkeys(
    {
      Enter: () => {
        if (phase === 'question') lockIn();
        else if (phase === 'reveal') next();
      },
      c: () => {
        if (phase === 'question') setCalculatorOpen((open) => !open);
      },
      Escape: () => setCalculatorOpen(false),
    },
    phase === 'question' || phase === 'reveal',
  );

  /* --- Not started ---------------------------------------------------- */
  if (phase === 'idle' && state.history.length === 0) {
    return (
      <div className="placeholder">
        <div className="stack center" style={{ gap: 'var(--sp-4)', maxWidth: '44ch' }}>
          <p className="eyebrow">Solo Gauntlet</p>
          <h1 style={{ fontSize: 'var(--step-4)' }}>Three lives. No finish line.</h1>
          <p className="muted">
            Questions start friendly and get steadily less reasonable. A guess that is wildly off
            costs a life. Good estimates in a row are worth a bonus.
          </p>
          {state.record.score > 0 ? (
            <p className="faint">
              Your best: {state.record.score.toLocaleString('en-US')} over {state.record.rounds}{' '}
              rounds
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary btn--lg" onClick={() => state.start()}>
              Start the run
            </button>
            <Link to="/" className="btn btn--ghost">
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* --- Run over -------------------------------------------------------- */
  if (phase === 'over') {
    return <GameOver onReplay={() => state.start()} onHome={() => navigate('/')} />;
  }

  if (!publicQuestion || !question) {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <p className="muted">Dealing a question…</p>
      </div>
    );
  }

  const revealPlayers: RevealPlayer[] = result
    ? [
        {
          id: identity.clientId,
          name: identity.name || 'You',
          color: identity.color,
          guessLabel: state.history[state.history.length - 1]?.guessLabel ?? 'No guess',
          guessValue: state.guess?.kind === 'number' ? state.guess.value : null,
          accuracy: result.score.accuracy,
          band: result.score.band,
          missLabel: result.score.miss?.label ?? null,
          points: result.points.total,
          closest: false,
          answered: result.score.answered,
          correct: result.score.correct,
          isYou: true,
        },
      ]
    : [];

  return (
    <div className="play">
      <div className="play__status">
        <Stat label="Round" value={state.round} />
        <Stat label="Score" value={state.score.toLocaleString('en-US')} />
        {state.streak >= 2 ? (
          <Stat label="Streak" value={state.streak} hint={streakLabel(state.streak) ?? undefined} />
        ) : null}
        <div className="spacer" />
        <Lives lives={state.lives} max={state.maxLives} />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            state.quit();
          }}
        >
          End run
        </button>
      </div>

      {phase === 'question' ? (
        <>
          <Timer
            deadline={state.deadline}
            totalMs={state.timeLimitMs}
            onExpire={() => state.timeUp()}
          />

          <motion.div
            key={publicQuestion.id}
            className="question"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="question__meta">
              <span className="chip">{publicQuestion.category}</span>
              {state.round >= 6 ? (
                <span className="chip">{DIFFICULTY_NAMES[question.difficulty]}</span>
              ) : null}
            </div>
            <h1 className="question__prompt">{publicQuestion.prompt}</h1>
            {publicQuestion.subPrompt ? (
              <p className="question__sub">{publicQuestion.subPrompt}</p>
            ) : null}
          </motion.div>

          <div className="answer">
            <AnswerInput
              key={publicQuestion.id}
              question={publicQuestion}
              onDraft={setDraft}
              onSubmit={lockIn}
              onOpenCalculator={() => setCalculatorOpen(true)}
              injectedValue={injected}
            />
            <div className="lockbar">
              <button
                type="button"
                className="btn btn--primary btn--lg btn--block"
                onClick={lockIn}
                disabled={!draft}
              >
                {draft ? 'Lock it in' : 'Make a guess'}
              </button>
            </div>
            <p className="lockbar__hint center">
              Enter to lock in · C for the calculator
            </p>
          </div>
        </>
      ) : null}

      {phase === 'reveal' && result ? (
        <>
          <Reveal
            question={publicQuestion}
            payload={result.reveal}
            players={revealPlayers}
            multiplayer={false}
          />
          {result.lostLife ? (
            <p className="center" style={{ color: 'var(--magenta)', fontWeight: 600 }}>
              {state.lives > 0
                ? `That cost a life. ${state.lives} left.`
                : 'That was your last life.'}
            </p>
          ) : null}
          <div className="lockbar">
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={next}>
              {state.lives > 0 ? 'Next question' : 'See how you did'}
            </button>
          </div>
        </>
      ) : null}

      <Calculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        onUse={(value) => setInjected({ value, nonce: Date.now() })}
      />
    </div>
  );
}

/* --- Game over ------------------------------------------------------------ */

function GameOver({ onReplay, onHome }: { onReplay: () => void; onHome: () => void }) {
  const state = useSolo();
  const stats = useMemo(() => summarise(state.history), [state.history]);
  const isRecord = state.score > 0 && state.score >= state.record.score;

  return (
    <div className="gameover">
      <p className="eyebrow">{state.endedBecause === 'pool' ? 'Bank exhausted' : 'Run over'}</p>
      <h1 style={{ fontSize: 'var(--step-3)' }}>
        {state.endedBecause === 'pool'
          ? 'You answered everything we had.'
          : titleFor(state.history.length)}
      </h1>

      <div className="gameover__score" aria-label={`Final score ${state.score}`}>
        {state.score.toLocaleString('en-US')}
      </div>
      {isRecord ? <span className="chip chip--accent">New personal best</span> : null}

      <div className="summary">
        <div className="summary__cell">
          <span className="summary__label">Rounds survived</span>
          <span className="summary__value">{state.history.length}</span>
        </div>
        <div className="summary__cell">
          <span className="summary__label">Best streak</span>
          <span className="summary__value">{state.bestStreak}</span>
        </div>
        <div className="summary__cell">
          <span className="summary__label">Average closeness</span>
          <span className="summary__value">{Math.round(stats.averageAccuracy * 100)}%</span>
        </div>
        <div className="summary__cell">
          <span className="summary__label">Personal best</span>
          <span className="summary__value">{state.record.score.toLocaleString('en-US')}</span>
        </div>
      </div>

      {stats.best ? (
        <div className="summary" style={{ gridTemplateColumns: '1fr' }}>
          <div className="summary__cell">
            <span className="summary__label">Best guess — round {stats.best.round}</span>
            <span className="summary__value">{stats.best.guessLabel}</span>
            <span className="summary__note">
              Answer was {stats.best.answerLabel}
              {stats.best.missLabel ? ` · ${stats.best.missLabel}` : ''}
            </span>
            <span className="summary__note faint">{stats.best.prompt}</span>
          </div>
          {stats.worst && stats.worst.questionId !== stats.best.questionId ? (
            <div className="summary__cell">
              <span className="summary__label">
                Most spectacular miss — round {stats.worst.round}
              </span>
              <span className="summary__value">{stats.worst.guessLabel}</span>
              <span className="summary__note">
                Answer was {stats.worst.answerLabel}
                {stats.worst.missLabel ? ` · ${stats.worst.missLabel}` : ''}
              </span>
              <span className="summary__note faint">{stats.worst.prompt}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn--primary btn--lg" onClick={onReplay}>
          Run it again
        </button>
        <button type="button" className="btn btn--ghost" onClick={onHome}>
          Back home
        </button>
      </div>
    </div>
  );
}

function titleFor(rounds: number): string {
  if (rounds >= 18) return 'That was genuinely absurd.';
  if (rounds >= 13) return 'Deep into the wildcards.';
  if (rounds >= 9) return 'Strong run.';
  if (rounds >= 6) return 'Respectable.';
  if (rounds >= 3) return 'The scale got you.';
  return 'Brutal start.';
}

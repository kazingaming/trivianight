import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  getFeedback,
  isNumericFormat,
  type ChoiceOption,
  type FeedbackBand,
  type OrderItem,
  type PublicQuestion,
  type RevealPayload,
} from '@trivia/shared';

import { NumberLine, type LineMarker, type LineScale } from './NumberLine.js';
import { ReactionScene } from './ReactionScene.js';
import { Avatar } from './primitives.js';
import { formatPoints } from '../lib/format.js';
import { bandSound } from '../lib/audio.js';
import { play, useReactionsEnabled } from '../state/settings.js';

export interface RevealPlayer {
  id: string;
  name: string;
  color: number;
  guessLabel: string;
  guessValue: number | null;
  accuracy: number;
  band: FeedbackBand;
  missLabel: string | null;
  points: number;
  totalScore?: number;
  closest: boolean;
  answered: boolean;
  correct: boolean | null;
  isYou: boolean;
}

/**
 * The reveal.
 *
 * Information arrives in beats rather than all at once: the scene plays, the
 * number lands, then your verdict, then everyone else, then the story behind
 * it. Getting this rhythm right is most of what makes a surprising fact land.
 */
export function Reveal({
  question,
  payload,
  players,
  multiplayer,
}: {
  question: PublicQuestion;
  payload: RevealPayload;
  players: RevealPlayer[];
  multiplayer: boolean;
}) {
  const you = players.find((player) => player.isYou) ?? null;
  const reactionsOn = useReactionsEnabled();
  const stage = useStages(question.id, reactionsOn);

  useEffect(() => {
    if (stage < 1 || !you) return;
    play(bandSound(you.band));
    // Only cue once per question, when the number lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage >= 1, question.id]);

  const numeric = isNumericFormat(question.type) && payload.answerValue !== null;

  const feedback = you
    ? getFeedback({
        band: you.band,
        answered: you.answered,
        correct: you.correct,
        seed: `${you.id}:${question.id}`,
        numeric,
      })
    : null;

  const markers: LineMarker[] = numeric
    ? players
        .filter((player) => player.answered && player.guessValue !== null)
        .map((player) => ({
          id: player.id,
          name: player.isYou ? 'You' : player.name,
          value: player.guessValue as number,
          color: player.color,
          isYou: player.isYou,
        }))
    : [];

  const scale: LineScale =
    question.type === 'year' ? 'year' : question.type === 'numeric' ? 'log' : 'linear';
  const lineDomain: [number, number] | undefined =
    question.type === 'percentage' || question.type === 'probability' ? [0, 100] : undefined;

  // An ordering question spells its answer out in the list below, so the
  // headline just names what you are looking at.
  const headline =
    payload.reveal.headline ??
    (question.type === 'order' ? 'The correct order' : payload.answerLabel);
  const answerIsLong = headline.length > 22;

  return (
    <div className="reveal">
      {you ? (
        <ReactionScene
          accuracy={you.accuracy}
          direction={
            you.correct === false
              ? 'high'
              : !you.answered
                ? 'low'
                : missDirection(you.guessValue, payload.answerValue)
          }
          seed={`${you.id}:${question.id}`}
          label={you.guessLabel}
        />
      ) : null}

      <AnimatePresence>
        {stage >= 1 ? (
          <motion.div
            className="reveal__headline"
            initial={{ opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="reveal__label">The answer</span>
            <h2 className={`reveal__answer ${answerIsLong ? 'reveal__answer--small' : ''}`}>
              {headline}
            </h2>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {stage >= 2 && you ? (
        <motion.div
          className="reveal__headline"
          data-band={you.band}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="reveal__verdict">{feedback?.headline}</div>
          <div className="reveal__yours">
            <span className="muted">Your guess</span>
            <span className="reveal__yours-value">{you.guessLabel}</span>
            {you.missLabel ? <span className="chip chip--band">{you.missLabel}</span> : null}
          </div>
          {feedback?.aside ? <p className="reveal__aside">{feedback.aside}</p> : null}
          <div className={`reveal__points ${you.points === 0 ? 'reveal__points--zero' : ''}`}>
            {formatPoints(you.points)}
          </div>
        </motion.div>
      ) : null}

      {stage >= 3 && numeric && markers.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <NumberLine
            answer={payload.answerValue as number}
            answerLabel={payload.answerLabel}
            markers={markers}
            scale={scale}
            domain={lineDomain}
          />
        </motion.div>
      ) : null}

      {stage >= 3 && !numeric ? <NonNumericAnswer question={question} payload={payload} /> : null}

      {stage >= 4 && multiplayer ? (
        <motion.div
          className="results"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          {players.map((player) => (
            <ResultRow key={player.id} player={player} />
          ))}
        </motion.div>
      ) : null}

      {stage >= 5 ? (
        <motion.div
          className="reveal__explain"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {payload.reveal.comparison ? (
            <p className="reveal__comparison">{payload.reveal.comparison}</p>
          ) : null}
          <p>{payload.reveal.explanation}</p>
          <SourceNote payload={payload} />
        </motion.div>
      ) : null}
    </div>
  );
}

/* --- Result row --------------------------------------------------------- */

export function ResultRow({ player }: { player: RevealPlayer }) {
  const classes = [
    'result',
    player.isYou ? 'result--you' : '',
    player.closest ? 'result--closest' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-color={player.color} data-band={player.band}>
      <Avatar name={player.name} color={player.color} />
      <div className="result__who">
        <span className="result__name">
          {player.isYou ? `${player.name} (you)` : player.name}
          {player.closest ? <span className="chip chip--accent">Closest</span> : null}
        </span>
        <span className="result__guess">
          {player.guessLabel}
          {player.missLabel ? <span className="result__miss"> · {player.missLabel}</span> : null}
        </span>
      </div>
      <div className="result__points">
        {formatPoints(player.points)}
        {player.totalScore !== undefined ? (
          <span className="result__total">{player.totalScore.toLocaleString('en-US')} total</span>
        ) : null}
      </div>
    </div>
  );
}

/* --- Non-numeric answers -------------------------------------------------- */

function NonNumericAnswer({
  question,
  payload,
}: {
  question: PublicQuestion;
  payload: RevealPayload;
}) {
  if (question.type === 'order') {
    const items = (question.items ?? []) as OrderItem[];
    const byId = new Map(items.map((item) => [item.id, item]));
    const correctOrder = payload.correctOrder ?? [];
    return (
      <ul className="orderlist">
        {correctOrder.map((id, index) => {
          const item = byId.get(id);
          const detail = payload.optionDetails?.[index];
          return (
            <li className="orderitem orderitem--correct" key={id}>
              <span className="orderitem__rank">{index + 1}</span>
              <span className="orderitem__label">
                {item?.label ?? id}
                {detail ? <span className="orderitem__detail">{detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (question.type === 'higher-lower') {
    return (
      <div className="choices choices--pair">
        {(['higher', 'lower'] as const).map((side) => (
          <div
            key={side}
            className={`choice ${payload.correctSide === side ? 'choice--correct' : ''}`}
          >
            <span className="choice__key">{side === 'higher' ? '↑' : '↓'}</span>
            <span>
              {side === 'higher' ? 'Higher' : 'Lower'}
              {payload.correctSide === side && payload.actual ? (
                <span className="choice__detail">Actually {payload.actual}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const options = (question.options ?? []) as Array<ChoiceOption | string>;
  if (options.length === 0) return null;

  return (
    <div className={`choices ${options.length === 2 ? 'choices--pair' : ''}`}>
      {options.map((option, index) => {
        const label = typeof option === 'string' ? option : option.label;
        const detail = payload.optionDetails?.[index];
        const correct = payload.correctIndex === index;
        return (
          <div key={label} className={`choice ${correct ? 'choice--correct' : ''}`}>
            <span className="choice__key">{correct ? '✓' : String.fromCharCode(65 + index)}</span>
            <span>
              {label}
              {detail ? <span className="choice__detail">{detail}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* --- Source ---------------------------------------------------------------- */

function SourceNote({ payload }: { payload: RevealPayload }) {
  const [open, setOpen] = useState(false);
  const source = payload.source;
  if (!source) return null;

  const dateline = source.statisticYear
    ? `${source.statisticYear} figures`
    : source.year
      ? `published ${source.year}`
      : null;

  return (
    <div className="source">
      <div className="row row-wrap" style={{ gap: 'var(--sp-2)' }}>
        <span>
          Source: {source.citation}
          {source.publisher && source.publisher !== source.citation ? ` — ${source.publisher}` : ''}
        </span>
        {dateline ? <span className="chip">{dateline}</span> : null}
        <span className="chip">{source.kind}</span>
      </div>
      <button
        type="button"
        className="source__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Hide details' : 'How solid is this number?'}
      </button>
      {open ? (
        <div className="source__body">
          <div className="source__row">
            <span className="source__key">Citation</span>
            <span>{source.citation}</span>
          </div>
          {source.publisher ? (
            <div className="source__row">
              <span className="source__key">Publisher</span>
              <span>{source.publisher}</span>
            </div>
          ) : null}
          {source.year ? (
            <div className="source__row">
              <span className="source__key">Published</span>
              <span>{source.year}</span>
            </div>
          ) : null}
          {source.statisticYear ? (
            <div className="source__row">
              <span className="source__key">Statistic year</span>
              <span>{source.statisticYear}</span>
            </div>
          ) : null}
          <div className="source__row">
            <span className="source__key">Type of figure</span>
            <span>{describeKind(source.kind)}</span>
          </div>
          {source.volatile ? (
            <div className="source__row">
              <span className="source__key">Changes over time</span>
              <span>Yes — treat this as a snapshot, not a constant.</span>
            </div>
          ) : null}
          {source.assumptions?.length ? (
            <div className="source__row">
              <span className="source__key">Assumptions</span>
              <span>
                {source.assumptions.map((assumption) => (
                  <span key={assumption} style={{ display: 'block' }}>
                    {assumption}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          {source.url ? (
            <div className="source__row">
              <span className="source__key">More</span>
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {source.url.replace(/^https?:\/\//, '')}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function describeKind(kind: string): string {
  switch (kind) {
    case 'measured':
      return 'Measured or counted directly.';
    case 'estimated':
      return 'A scientific estimate — the real value sits in a range.';
    case 'modelled':
      return 'Reconstructed from a model, with assumptions baked in.';
    default:
      return 'True by definition or by arithmetic.';
  }
}

/* --- Staging --------------------------------------------------------------- */

/** Delays between reveal beats, in milliseconds from the start. */
const BEATS_WITH_SCENE = [1500, 2100, 2650, 3050, 3400];
const BEATS_WITHOUT_SCENE = [250, 650, 1000, 1300, 1600];

function useStages(key: string, withScene: boolean): number {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
    const beats = withScene ? BEATS_WITH_SCENE : BEATS_WITHOUT_SCENE;
    const timers = beats.map((delay, index) =>
      setTimeout(() => setStage(index + 1), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [key, withScene]);

  return stage;
}

function missDirection(guess: number | null, answer: number | null): 'high' | 'low' | 'exact' {
  if (guess === null || answer === null) return 'low';
  if (guess === answer) return 'exact';
  return guess > answer ? 'high' : 'low';
}

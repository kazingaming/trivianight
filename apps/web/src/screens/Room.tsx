import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  MODES,
  TIMER_LABELS,
  normalizeRoomCode,
  type Guess,
  type PublicPlayer,
  type RoomSnapshot,
  type TimerPreference,
} from '@trivia/shared';

import { AnswerInput } from '../components/AnswerInput.js';
import { Calculator } from '../components/Calculator.js';
import { Reveal, type RevealPlayer } from '../components/Reveal.js';
import { Timer } from '../components/Timer.js';
import { Avatar, Banner, IconCheck, IconCopy, Segmented, Stat } from '../components/primitives.js';
import { useCopy, useCountdown, useHotkeys } from '../lib/hooks.js';
import { ordinal } from '../lib/format.js';
import { play, useSettings } from '../state/settings.js';
import { useIsHost, useMySeat, useRoom } from '../state/room.js';

export function RoomScreen() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const normalized = normalizeRoomCode(code);

  const snapshot = useRoom((state) => state.snapshot);
  const status = useRoom((state) => state.status);
  const joinRoom = useRoom((state) => state.joinRoom);
  const leave = useRoom((state) => state.leave);
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState(false);

  // Land here from a shared link (or a refresh) and we simply join.
  useEffect(() => {
    if (snapshot?.code === normalized || joining || failed) return;
    setJoining(true);
    void joinRoom(normalized).then((result) => {
      setJoining(false);
      if (!result.ok) setFailed(true);
    });
  }, [normalized, snapshot?.code, joinRoom, joining, failed]);

  const exit = useCallback(() => {
    leave();
    navigate('/');
  }, [leave, navigate]);

  if (failed && !snapshot) {
    return (
      <div className="placeholder">
        <div className="stack center" style={{ gap: 'var(--sp-4)', maxWidth: '40ch' }}>
          <h1 style={{ fontSize: 'var(--step-3)' }}>That room isn’t available.</h1>
          <p className="muted">
            The code <strong>{normalized}</strong> doesn’t match an open room. It may have closed,
            filled up, or the match may already be under way.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/private" className="btn btn--primary">
              Try another code
            </Link>
            <Link to="/" className="btn btn--ghost">
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <p className="muted">Joining room {normalized}…</p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      {status === 'reconnecting' ? (
        <Banner>
          <span className="spinner" /> Connection dropped — reconnecting. Your seat is held.
        </Banner>
      ) : null}
      {status === 'failed' ? (
        <Banner tone="error">Lost contact with the server. Check it is still running.</Banner>
      ) : null}

      {/* Enter-only, for the same reason as the route transition in App. */}
      <motion.div
        key={snapshot.phase}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {snapshot.phase === 'lobby' ? <Lobby snapshot={snapshot} onLeave={exit} /> : null}
        {snapshot.phase === 'countdown' ? <Countdown snapshot={snapshot} /> : null}
        {snapshot.phase === 'question' ? <QuestionPhase snapshot={snapshot} /> : null}
        {snapshot.phase === 'reveal' ? <RevealPhase snapshot={snapshot} /> : null}
        {snapshot.phase === 'final' ? <FinalPhase snapshot={snapshot} onLeave={exit} /> : null}
      </motion.div>
    </div>
  );
}

/* --- Lobby ---------------------------------------------------------------- */

function Lobby({ snapshot, onLeave }: { snapshot: RoomSnapshot; onLeave: () => void }) {
  const isHost = useIsHost();
  const startGame = useRoom((state) => state.startGame);
  const updateSettings = useRoom((state) => state.updateSettings);
  const myId = useSettings((state) => state.identity.clientId);
  const [copied, copy] = useCopy();
  const [starting, setStarting] = useState(false);

  const config = MODES[snapshot.mode];
  const seats = Math.max(config.maxPlayers, snapshot.players.length);
  const canStart = snapshot.players.filter((p) => p.connected).length >= config.minPlayers;

  return (
    <div className="lobby">
      <div className="roomcode">
        <span className="eyebrow">{config.label} · room code</span>
        <span className="roomcode__value" aria-label={`Room code ${snapshot.code.split('').join(' ')}`}>
          {snapshot.code}
        </span>
        <div className="row">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => copy(snapshot.code)}
          >
            {copied ? <IconCheck /> : <IconCopy />}
            {copied ? 'Copied' : 'Copy code'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => copy(window.location.href)}
          >
            <IconCopy />
            Copy link
          </button>
        </div>
      </div>

      <div className="seats">
        {Array.from({ length: seats }, (_, index) => {
          const player = snapshot.players[index];
          if (!player) {
            return (
              <div className="seat seat--empty" key={`empty-${index}`}>
                Waiting for a player…
              </div>
            );
          }
          return <Seat key={player.id} player={player} isYou={player.id === myId} />;
        })}
      </div>

      {isHost ? (
        <div className="card stack">
          <h2 style={{ fontSize: 'var(--step-1)' }}>Match settings</h2>
          <div className="field">
            <span className="field__label">Thinking time</span>
            <Segmented
              block
              label="Thinking time"
              value={snapshot.settings.timer}
              onChange={(timer: TimerPreference) => updateSettings({ timer })}
              options={(['relaxed', 'standard', 'blitz'] as TimerPreference[]).map((value) => ({
                value,
                label: TIMER_LABELS[value],
              }))}
            />
          </div>
          <div className="field">
            <span className="field__label">Rounds — {snapshot.settings.rounds}</span>
            <input
              type="range"
              min={3}
              max={16}
              step={1}
              value={snapshot.settings.rounds}
              onChange={(event) => updateSettings({ rounds: Number(event.target.value) })}
              style={{ accentColor: 'var(--cyan)' }}
              aria-label="Number of rounds"
            />
          </div>
        </div>
      ) : (
        <p className="center muted">
          Waiting for {snapshot.players.find((p) => p.isHost)?.name ?? 'the host'} to start.
        </p>
      )}

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        {isHost ? (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={!canStart || starting}
            onClick={async () => {
              setStarting(true);
              await startGame();
              setStarting(false);
            }}
          >
            {canStart
              ? 'Start the match'
              : `Need ${config.minPlayers} players`}
          </button>
        ) : null}
        <button type="button" className="btn btn--ghost" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </div>
  );
}

/**
 * A seat in the lobby. Your own is editable — joining with a typo in your name
 * and being stuck with it for ten rounds is a miserable way to start.
 */
function Seat({ player, isYou }: { player: PublicPlayer; isYou: boolean }) {
  const rename = useRoom((state) => state.rename);
  const setIdentity = useSettings((state) => state.setIdentity);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(player.name);

  const commit = () => {
    setEditing(false);
    const next = draft.trim().slice(0, 14);
    if (!next || next === player.name) {
      setDraft(player.name);
      return;
    }
    setIdentity({ name: next });
    rename(next);
  };

  return (
    <div
      className={`seat ${player.connected ? '' : 'seat--offline'}`}
      data-color={player.color}
    >
      <Avatar name={player.name} color={player.color} />
      <div className="stack" style={{ gap: 0, minWidth: 0, flex: 1 }}>
        {editing ? (
          <input
            className="input"
            style={{ minHeight: 34, padding: '0 var(--sp-2)' }}
            value={draft}
            maxLength={14}
            autoFocus
            aria-label="Your name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(player.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="seat__name">{player.name}</span>
        )}
        <span className="seat__meta">
          {player.isHost ? 'Host' : 'Ready'}
          {player.connected ? '' : ' · reconnecting'}
        </span>
      </div>
      {isYou && !editing ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setDraft(player.name);
            setEditing(true);
          }}
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

/* --- Countdown ------------------------------------------------------------ */

function Countdown({ snapshot }: { snapshot: RoomSnapshot }) {
  const clockOffset = useRoom((state) => state.clockOffset);
  const { remainingMs } = useCountdown(snapshot.startsAt ?? null, 3200, clockOffset);
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <div className="placeholder">
      <motion.div
        key={seconds}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
        className="gameover__score"
      >
        {seconds}
      </motion.div>
      <p className="muted">First question coming up…</p>
    </div>
  );
}

/* --- Question ------------------------------------------------------------- */

function QuestionPhase({ snapshot }: { snapshot: RoomSnapshot }) {
  const submitGuess = useRoom((state) => state.submitGuess);
  const myGuess = useRoom((state) => state.myGuess);
  const clockOffset = useRoom((state) => state.clockOffset);
  const allLockedRound = useRoom((state) => state.allLockedRound);
  const seat = useMySeat();

  const [draft, setDraft] = useState<Guess | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [injected, setInjected] = useState<{ value: number; nonce: number } | null>(null);

  const question = snapshot.question;
  const locked = myGuess !== null;

  useEffect(() => {
    setDraft(null);
    setInjected(null);
  }, [question?.id]);

  const lockIn = useCallback(() => {
    if (!question || !draft || locked) return;
    play('lock');
    void submitGuess(question.id, draft);
  }, [draft, locked, question, submitGuess]);

  useHotkeys(
    {
      Enter: () => lockIn(),
      c: () => setCalculatorOpen((open) => !open),
      Escape: () => setCalculatorOpen(false),
    },
    !locked,
  );

  if (!question) return null;

  const totalMs = Math.max(
    1000,
    (snapshot.deadline ?? 0) - (snapshot.questionStartedAt ?? (snapshot.deadline ?? 0) - 45_000),
  );

  return (
    <div className="play">
      <div className="play__status">
        <Stat label="Round" value={`${snapshot.round}/${snapshot.totalRounds ?? '∞'}`} />
        <Stat label="Your score" value={(seat?.score ?? 0).toLocaleString('en-US')} />
        <div className="spacer" />
        <PlayerStatuses players={snapshot.players} myId={seat?.id ?? ''} />
      </div>

      <Timer deadline={snapshot.deadline ?? null} totalMs={totalMs} clockOffset={clockOffset} />

      <div className="question">
        <div className="question__meta">
          <span className="chip">{question.category}</span>
          {allLockedRound === snapshot.round ? (
            <span className="chip chip--accent">Everyone’s in</span>
          ) : null}
        </div>
        <h1 className="question__prompt">{question.prompt}</h1>
        {question.subPrompt ? <p className="question__sub">{question.subPrompt}</p> : null}
      </div>

      <div className="answer">
        {locked ? (
          <div className="card card--quiet center stack" style={{ gap: 'var(--sp-2)' }}>
            <span className="eyebrow">Locked in</span>
            <p className="muted">
              Nobody can see your number until everyone has committed. Sit tight.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <span className="pulse-dot" style={{ color: 'var(--cyan)' }} />
              <span className="muted">
                Waiting for{' '}
                {snapshot.players.filter((p) => p.connected && p.activity === 'thinking').length}{' '}
                more
              </span>
            </div>
          </div>
        ) : (
          <>
            <AnswerInput
              key={question.id}
              question={question}
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
            <p className="lockbar__hint center">Enter to lock in · C for the calculator</p>
          </>
        )}
      </div>

      <Calculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        onUse={(value) => setInjected({ value, nonce: Date.now() })}
      />
    </div>
  );
}

/**
 * Who has committed.
 *
 * Status only — never the guess itself. Knowing your opponent locked in early
 * is part of the tension; knowing what they typed would be the whole game.
 */
function PlayerStatuses({ players, myId }: { players: PublicPlayer[]; myId: string }) {
  const label = (activity: PublicPlayer['activity']) =>
    activity === 'locked' ? 'Locked in' : activity === 'disconnected' ? 'Away' : 'Thinking';

  return (
    <div className="row row-wrap" style={{ gap: 'var(--sp-2)' }}>
      {players.map((player) => (
        <span
          key={player.id}
          className="chip"
          data-color={player.color}
          title={`${player.name}: ${label(player.activity)}`}
        >
          <span
            className={player.activity === 'thinking' ? 'pulse-dot' : 'dot'}
            style={{
              color:
                player.activity === 'locked'
                  ? 'var(--lime)'
                  : player.activity === 'disconnected'
                    ? 'var(--text-faint)'
                    : 'var(--accent)',
            }}
          />
          {player.id === myId ? 'You' : player.name}
          <span className="faint">{label(player.activity)}</span>
        </span>
      ))}
    </div>
  );
}

/* --- Reveal --------------------------------------------------------------- */

function RevealPhase({ snapshot }: { snapshot: RoomSnapshot }) {
  const identity = useSettings((state) => state.identity);
  const markReady = useRoom((state) => state.markReady);
  const clockOffset = useRoom((state) => state.clockOffset);
  const reveal = snapshot.reveal;
  const seat = useMySeat();

  const { remainingMs } = useCountdown(
    snapshot.revealUntil ?? null,
    MODES[snapshot.mode].revealDuration * 1000,
    clockOffset,
  );

  const byId = useMemo(
    () => new Map(snapshot.players.map((player) => [player.id, player])),
    [snapshot.players],
  );

  if (!reveal) return null;

  const players: RevealPlayer[] = reveal.results.map((result) => {
    const player = byId.get(result.playerId);
    return {
      id: result.playerId,
      name: player?.name ?? 'Player',
      color: player?.color ?? 0,
      guessLabel: result.guessLabel,
      guessValue: result.guess.kind === 'number' ? result.guess.value : null,
      accuracy: result.accuracy,
      band: result.band,
      missLabel: result.missLabel,
      points: result.points.total,
      totalScore: result.totalScore,
      closest: result.closest,
      answered: result.answered,
      correct: result.correct,
      isYou: result.playerId === identity.clientId,
    };
  });

  const standings = [...snapshot.players].sort((a, b) => b.score - a.score);

  return (
    <div className="stack" style={{ gap: 'var(--sp-5)' }}>
      <Reveal
        question={reveal.question}
        payload={reveal.payload}
        players={players}
        multiplayer
      />

      <div className="card card--quiet stack">
        <h2 className="eyebrow">Standings after round {reveal.round}</h2>
        <div className="standings">
          {standings.map((player, index) => (
            <div className="standing" key={player.id} data-color={player.color}>
              <span className="standing__rank">{index + 1}</span>
              <span className="standing__name">{player.name}</span>
              <span className="standing__score">{player.score.toLocaleString('en-US')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="lockbar">
        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={() => {
            play('advance');
            markReady();
          }}
          disabled={seat?.ready}
        >
          {seat?.ready
            ? `Waiting for others · ${Math.ceil(remainingMs / 1000)}s`
            : `Ready · next in ${Math.ceil(remainingMs / 1000)}s`}
        </button>
      </div>
    </div>
  );
}

/* --- Final ---------------------------------------------------------------- */

function FinalPhase({ snapshot, onLeave }: { snapshot: RoomSnapshot; onLeave: () => void }) {
  const isHost = useIsHost();
  const navigate = useNavigate();
  const identity = useSettings((state) => state.identity);
  const rematch = useRoom((state) => state.rematch);
  const leave = useRoom((state) => state.leave);
  const final = snapshot.final;
  if (!final) return null;

  const podium = final.standings.slice(0, 3);
  const rest = final.standings.slice(3);
  const youWon = final.winnerIds.includes(identity.clientId);
  const tie = final.winnerIds.length > 1;
  const isPublic = snapshot.visibility === 'public';
  const abandoned = final.reason === 'abandoned';

  const headline = abandoned
    ? snapshot.mode === 'duel'
      ? 'Your opponent left.'
      : 'Not enough players left.'
    : tie
      ? 'It’s a tie.'
      : youWon
        ? 'You win.'
        : `${final.standings[0]?.name ?? 'Nobody'} takes it.`;

  return (
    <div className="gameover">
      <p className="eyebrow">{abandoned ? 'Match ended early' : 'Final result'}</p>
      <h1 style={{ fontSize: 'var(--step-3)' }}>{headline}</h1>
      {abandoned ? (
        <p className="muted" style={{ maxWidth: '40ch' }}>
          Scores up to this point are shown below.
        </p>
      ) : null}

      <div className="podium" style={{ width: '100%' }}>
        {podium.map((standing) => (
          <div
            key={standing.playerId}
            className={`podium__slot ${standing.rank === 1 ? 'podium__slot--first' : ''}`}
            data-color={standing.color}
          >
            <span className="podium__rank">{ordinal(standing.rank)}</span>
            <Avatar name={standing.name} color={standing.color} size={46} />
            <span className="podium__name">
              {standing.name}
              {standing.playerId === identity.clientId ? ' (you)' : ''}
            </span>
            <span className="podium__score">{standing.score.toLocaleString('en-US')}</span>
            <span className="summary__note">
              {standing.roundsWon} round{standing.roundsWon === 1 ? '' : 's'} won · best{' '}
              {Math.round(standing.bestAccuracy * 100)}%
            </span>
          </div>
        ))}
      </div>

      {rest.length > 0 ? (
        <div className="standings" style={{ width: '100%' }}>
          {rest.map((standing) => (
            <div className="standing" key={standing.playerId} data-color={standing.color}>
              <span className="standing__rank">{standing.rank}</span>
              <span className="standing__name">{standing.name}</span>
              <span className="standing__score">{standing.score.toLocaleString('en-US')}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        {isPublic ? (
          // A public rematch would just be a private lobby; searching again is
          // both simpler and what people actually want.
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={() => {
              leave();
              navigate(`/quick/${snapshot.mode}`);
            }}
          >
            Find another match
          </button>
        ) : isHost ? (
          <button type="button" className="btn btn--primary btn--lg" onClick={() => void rematch()}>
            Rematch
          </button>
        ) : (
          <span className="muted">Waiting for the host to start a rematch.</span>
        )}
        <button type="button" className="btn btn--ghost" onClick={onLeave}>
          {isPublic ? 'Back home' : 'Leave room'}
        </button>
      </div>
      {snapshot.poolRemaining < 10 ? (
        <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
          {snapshot.poolRemaining} unseen questions left in the bank for this room.
        </p>
      ) : null}
    </div>
  );
}

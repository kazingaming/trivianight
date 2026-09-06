import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  MODES,
  TIMER_LABELS,
  normalizeRoomCode,
  resolveTimeLimit,
  type Guess,
  type PublicPlayer,
  type RoomSettings,
  type RoomSnapshot,
  type TimerPreference,
} from '@trivia/shared';

import { AnswerInput } from '../components/AnswerInput.js';
import { Calculator } from '../components/Calculator.js';
import { Reveal, type RevealPlayer } from '../components/Reveal.js';
import { Timer } from '../components/Timer.js';
import {
  Avatar,
  Banner,
  IconCheck,
  IconCopy,
  NO_TRANSLATE,
  Segmented,
  Stat,
} from '../components/primitives.js';
import { useArmed, useCopy, useCountdown, useHotkeys } from '../lib/hooks.js';
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
        <span
          className="roomcode__value notranslate"
          aria-label={`Room code ${snapshot.code.split('').join(' ')}`}
          {...NO_TRANSLATE}
        >
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
        <MatchSettings snapshot={snapshot} />
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
 * The host's controls.
 *
 * Two things this has to get right, both learned from real play. The thinking
 * time is named rather than numbered, so the only way to tell whether picking
 * one did anything is to show the seconds it actually buys. And the rounds
 * slider fires an event per step, so it is held locally while the finger is
 * down and committed once — a stream of updates used to be able to outrun the
 * socket and leave the room on a value the host only dragged through.
 */
function MatchSettings({ snapshot }: { snapshot: RoomSnapshot }) {
  const updateSettings = useRoom((state) => state.updateSettings);
  const [rounds, setRounds] = useState(snapshot.settings.rounds);
  const [failed, setFailed] = useState(false);

  // Follow the server unless this player is mid-drag.
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setRounds(snapshot.settings.rounds);
  }, [snapshot.settings.rounds]);

  const commit = async (patch: Partial<RoomSettings>) => {
    const result = await updateSettings(patch);
    setFailed(!result.ok);
  };

  const seconds = (preference: TimerPreference) =>
    resolveTimeLimit(snapshot.mode, preference);

  return (
    <div className="card stack">
      <h2 style={{ fontSize: 'var(--step-1)' }}>Match settings</h2>

      <div className="field">
        <span className="field__label">Thinking time</span>
        <Segmented
          block
          label="Thinking time"
          value={snapshot.settings.timer}
          onChange={(timer: TimerPreference) => void commit({ timer })}
          options={(['relaxed', 'standard', 'blitz'] as TimerPreference[]).map((value) => ({
            value,
            label: TIMER_LABELS[value],
            hint: `${seconds(value)} seconds a question`,
          }))}
        />
        <span className="field__hint">
          {seconds(snapshot.settings.timer)} seconds for every question this match.
        </span>
      </div>

      <div className="field">
        <span className="field__label">Rounds — {rounds}</span>
        <input
          type="range"
          min={3}
          max={16}
          step={1}
          value={rounds}
          onChange={(event) => {
            dragging.current = true;
            setRounds(Number(event.target.value));
          }}
          onPointerUp={() => {
            dragging.current = false;
            void commit({ rounds });
          }}
          onKeyUp={() => {
            dragging.current = false;
            void commit({ rounds });
          }}
          onBlur={() => {
            dragging.current = false;
            void commit({ rounds });
          }}
          style={{ accentColor: 'var(--cyan)' }}
          aria-label="Number of rounds"
        />
        <span className="field__hint">
          {snapshot.settings.rounds === rounds
            ? `The match will run ${snapshot.settings.rounds} rounds.`
            : 'Release to apply.'}
        </span>
      </div>

      {failed ? (
        <Banner tone="error">
          That setting did not reach the room. Check the connection and try again.
        </Banner>
      ) : null}
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
          <span className="seat__name notranslate" {...NO_TRANSLATE}>
            {player.name}
          </span>
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
  const [submitting, setSubmitting] = useState(false);

  const question = snapshot.question;
  /*
   * The server's view of this seat is the truth; the local echo only exists so
   * "Locked in" appears without waiting for a round trip. Trusting the echo
   * alone meant a guess that reached the room but whose acknowledgement was
   * lost — a phone on a flaky connection, nine seconds, a timeout — read as
   * never having been made, while every retry was refused as a duplicate.
   */
  const locked = myGuess !== null || seat?.activity === 'locked';

  useEffect(() => {
    setDraft(null);
    setInjected(null);
    setSubmitting(false);
  }, [question?.id]);

  const lockIn = useCallback(() => {
    if (!question || !draft || locked || submitting) return;
    // The clock is the server's, but the client knows when it has run out.
    // Sending a guess it can see is too late only earns a rejection and a
    // scary error; better to let the round close quietly.
    const deadline = snapshot.deadline;
    if (deadline !== undefined && Date.now() + clockOffset > deadline + 1200) return;
    play('lock');
    setSubmitting(true);
    void submitGuess(question.id, draft).finally(() => setSubmitting(false));
  }, [clockOffset, draft, locked, question, snapshot.deadline, submitGuess, submitting]);

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
        ) : null}

        {/*
          Kept mounted, and hidden rather than unmounted, while locked. The
          input owns the player's selection; throwing it away meant that a
          lock-in the server refused — because the round had just closed, or
          the last opponent dropped — left them staring at a cleared question
          with no idea what happened.
        */}
        <div hidden={locked}>
          <AnswerInput
            key={question.id}
            question={question}
            disabled={locked}
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
              disabled={!draft || submitting}
            >
              {draft ? 'Lock it in' : 'Make a guess'}
            </button>
          </div>
          <p className="lockbar__hint center">Enter to lock in · C for the calculator</p>
        </div>
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
          {player.id === myId ? (
            'You'
          ) : (
            <span className="notranslate" {...NO_TRANSLATE}>
              {player.name}
            </span>
          )}
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

  // Same hazard as Solo: this button replaces "Lock it in" in place, so a
  // stray second tap would skip the reveal for everyone who is already ready.
  const readyArmed = useArmed(650, snapshot.round);

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
              <span className="standing__name notranslate" {...NO_TRANSLATE}>
                {player.name}
              </span>
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
          disabled={seat?.ready || !readyArmed}
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
              <span className="notranslate" {...NO_TRANSLATE}>
                {standing.name}
              </span>
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
              <span className="standing__name notranslate" {...NO_TRANSLATE}>
                <span className="notranslate" {...NO_TRANSLATE}>
                {standing.name}
              </span>
              </span>
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

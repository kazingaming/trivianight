import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MODES, type QueueMode } from '@trivia/shared';

import { Avatar, Banner } from '../components/primitives.js';
import { useSettings } from '../state/settings.js';
import { useMatchmaking } from '../state/matchmaking.js';

/**
 * The queue.
 *
 * A search should feel like part of the game, not a loading screen: the seat
 * slots fill visibly as people arrive, the elapsed time is honest, and finding
 * an opponent gets its own beat before the match takes over.
 */
export function QuickMatchScreen() {
  const params = useParams<{ mode?: string }>();
  const navigate = useNavigate();
  const mode: QueueMode = params.mode === 'ffa' ? 'ffa' : 'duel';

  const identity = useSettings((state) => state.identity);
  const setIdentity = useSettings((state) => state.setIdentity);
  const { phase, status, match, error, connection, clockOffset, join, cancel, reset } =
    useMatchmaking();

  const [name, setName] = useState(identity.name);

  /**
   * Enter the queue on arrival, leave it on the way out.
   *
   * No mount guard: joining is idempotent (the server holds one ticket per
   * player), so React's development double-invoke resolves to join → cancel →
   * join and settles on searching. A guard here would swallow the second join
   * and leave the player staring at a cancelled search.
   */
  useEffect(() => {
    void join(mode);
    return () => {
      const state = useMatchmaking.getState();
      if (state.phase === 'searching') state.cancel();
    };
  }, [join, mode]);

  // A match exists: play the found beat, then hand over to the room.
  useEffect(() => {
    if (phase !== 'matched' || !match) return;
    const delay = Math.max(600, match.startsAt - (Date.now() + clockOffset) - 1400);
    const timer = setTimeout(() => {
      reset();
      navigate(`/room/${match.code}`, { replace: true });
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, match, clockOffset, navigate, reset]);

  const config = MODES[mode];
  const found = phase === 'matched' ? (match?.players.length ?? config.maxPlayers) : (status?.found ?? 1);
  // The party size is fixed, so there is only one number to show.
  const ideal = status?.idealTarget ?? config.maxPlayers;

  if (phase === 'matched' && match) {
    return <MatchFoundPanel mode={mode} match={match} />;
  }

  if (phase === 'failed' || connection === 'failed') {
    return (
      <div className="queue">
        <p className="eyebrow">{config.label}</p>
        <h1 className="queue__title">Matchmaking is unavailable.</h1>
        <Banner tone="error">
          {error?.message ?? 'Could not reach the game server. It may be starting up.'}
        </Banner>
        <div className="row row-wrap" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              reset();
              void join(mode);
            }}
          >
            Try again
          </button>
          <Link to="/" className="btn btn--ghost">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'cancelled') {
    return (
      <div className="queue">
        <p className="eyebrow">{config.label}</p>
        <h1 className="queue__title">Search cancelled.</h1>
        <p className="muted">You are out of the queue.</p>
        <div className="row row-wrap" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={() => {
              reset();
              void join(mode);
            }}
          >
            Search again
          </button>
          <Link to="/" className="btn btn--ghost">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="queue">
      <p className="eyebrow">{config.label}</p>
      <h1 className="queue__title">
        {mode === 'duel' ? 'Finding an opponent' : 'Filling the room'}
        <Ellipsis />
      </h1>

      <SeatSlots found={found} ideal={ideal} you={identity} />

      <p className="queue__count" aria-live="polite">
        {mode === 'duel'
          ? found >= 2
            ? 'Opponent found'
            : 'Waiting for one more player'
          : `${found} / ${ideal} players`}
      </p>

      <Elapsed since={status?.searchingSince ?? Date.now()} offset={clockOffset} />

      {connection === 'reconnecting' ? (
        <Banner>Reconnecting to the server — your place is being restored.</Banner>
      ) : null}

      <div className="queue__identity">
        <label className="field__label" htmlFor="queue-name">
          You are playing as
        </label>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <input
            id="queue-name"
            className="input"
            value={name}
            maxLength={14}
            placeholder="Player"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setIdentity({ name: name.trim().slice(0, 14) })}
          />
        </div>
        <span className="field__hint">
          No account needed. Your name is stored on this device only.
        </span>
      </div>

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn--ghost" onClick={cancel}>
          Cancel search
        </button>
      </div>
    </div>
  );
}

/* --- Pieces ------------------------------------------------------------- */

function SeatSlots({
  found,
  ideal,
  you,
}: {
  found: number;
  ideal: number;
  you: { name: string; color: number };
}) {
  const slots = Array.from({ length: ideal }, (_, index) => index);
  return (
    <div className="queue__slots" aria-hidden>
      {slots.map((index) => {
        const filled = index < found;
        const isYou = index === 0;
        return (
          <motion.div
            key={index}
            className={`queue__slot ${filled ? 'queue__slot--filled' : ''}`}
            data-color={isYou ? you.color : (index * 3) % 8}
            initial={false}
            animate={filled ? { scale: [0.9, 1.06, 1] } : { scale: 1 }}
            transition={{ duration: 0.42, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {filled ? (
              isYou ? (
                <Avatar name={you.name || 'You'} color={you.color} size={44} />
              ) : (
                <span className="queue__slot-dot" />
              )
            ) : (
              <span className="queue__slot-empty" />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function MatchFoundPanel({ mode, match }: { mode: QueueMode; match: { players: Array<{ id: string; name: string; color: number }> } }) {
  return (
    <div className="queue">
      <p className="eyebrow">{MODES[mode].label}</p>
      <motion.h1
        className="queue__title queue__title--found"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      >
        {mode === 'duel' ? 'Opponent found' : 'Room full'}
      </motion.h1>

      <div className="queue__roster">
        {match.players.map((player, index) => (
          <motion.div
            key={player.id}
            className="queue__player"
            data-color={player.color}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * index, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <Avatar name={player.name} color={player.color} size={46} />
            <span className="queue__player-name">{player.name}</span>
          </motion.div>
        ))}
      </div>

      <p className="muted" aria-live="polite">
        Starting the match…
      </p>
    </div>
  );
}

/** An honest elapsed timer, corrected for server clock skew. */
function Elapsed({ since, offset }: { since: number; offset: number }) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 500);
    return () => clearInterval(id);
  }, [offset]);

  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const label = useMemo(() => {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  }, [seconds]);

  return (
    <p className="queue__elapsed tabular">
      Searching for {label}
      {seconds > 45 ? ' · quiet at the moment, hang on' : ''}
    </p>
  );
}

function Ellipsis() {
  return (
    <span className="queue__dots" aria-hidden>
      <AnimatePresence>
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: index * 0.18 }}
          >
            .
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}

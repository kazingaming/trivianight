import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MODES, normalizeRoomCode, type GameMode } from '@trivia/shared';
import { Banner, Segmented } from '../components/primitives.js';
import { useRoom } from '../state/room.js';
import { useSettings } from '../state/settings.js';
import { loadLastRoom } from '../lib/storage.js';

type PrivateMode = 'duel' | 'ffa';

/**
 * Private games.
 *
 * The secondary multiplayer path: you make a room, read the code out, and your
 * friends join it. The party leader picks the settings and presses start —
 * that is a social role, not a technical one. The match itself is still run by
 * the server, exactly like a matchmade game.
 */
export function MultiplayerScreen() {
  const params = useParams<{ mode?: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const identity = useSettings((state) => state.identity);
  const setIdentity = useSettings((state) => state.setIdentity);
  const createRoom = useRoom((state) => state.createRoom);
  const joinRoom = useRoom((state) => state.joinRoom);
  const status = useRoom((state) => state.status);

  const [mode, setMode] = useState<PrivateMode>(params.mode === 'ffa' ? 'ffa' : 'duel');
  const [name, setName] = useState(identity.name);
  const [code, setCode] = useState(() => normalizeRoomCode(search.get('code') ?? ''));
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  const commitName = () => {
    const trimmed = name.trim().slice(0, 14);
    setIdentity({ name: trimmed });
    return trimmed;
  };

  const onCreate = async () => {
    commitName();
    setBusy('create');
    const result = await createRoom(mode as GameMode);
    setBusy(null);
    if (result.ok) navigate(`/room/${result.data.code}`);
  };

  const onJoin = async () => {
    const cleaned = normalizeRoomCode(code);
    if (cleaned.length < 4) return;
    commitName();
    setBusy('join');
    const result = await joinRoom(cleaned);
    setBusy(null);
    if (result.ok) navigate(`/room/${result.data.code}`);
  };

  const lastRoom = loadLastRoom();

  return (
    <div className="stack" style={{ maxWidth: '46ch', margin: '0 auto', gap: 'var(--sp-5)' }}>
      <header className="stack" style={{ gap: 'var(--sp-2)' }}>
        <p className="eyebrow">Private game</p>
        <h1 style={{ fontSize: 'var(--step-3)' }}>Play with people you know.</h1>
        <p className="muted">
          Make a room, share the code. For a game against whoever is online right now, use{' '}
          <Link to="/quick/duel">Quick 1v1</Link> instead.
        </p>
      </header>

      {status === 'failed' ? (
        <Banner tone="error">
          Could not reach the game server. Check it is running, then try again.
        </Banner>
      ) : null}

      <section className="card stack">
        <div className="field">
          <label className="field__label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            maxLength={14}
            placeholder="Player"
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
          />
          <span className="field__hint">Everyone in the room sees this.</span>
        </div>

        <div className="field">
          <span className="field__label">Room type</span>
          <Segmented
            block
            label="Room type"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'duel', label: '1v1 Duel', hint: MODES.duel.blurb },
              { value: 'ffa', label: 'Free For All', hint: MODES.ffa.blurb },
            ]}
          />
          <span className="field__hint">
            {mode === 'duel'
              ? 'Two players, 8 rounds.'
              : 'Up to four players, 10 rounds. You can change the pace in the lobby.'}
          </span>
        </div>

        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={onCreate}
          disabled={busy !== null}
        >
          {busy === 'create' ? 'Creating…' : 'Create private room'}
        </button>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Join a room</h2>
        <div className="field">
          <label className="field__label sr-only" htmlFor="code">
            Room code
          </label>
          <input
            id="code"
            className="input input--code"
            value={code}
            onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onJoin();
            }}
            placeholder="CODE"
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            aria-describedby="code-hint"
          />
          <span className="field__hint" id="code-hint">
            Four characters, from whoever created the room.
          </span>
        </div>
        <button
          type="button"
          className="btn btn--accent btn--block"
          onClick={onJoin}
          disabled={busy !== null || normalizeRoomCode(code).length < 4}
        >
          {busy === 'join' ? 'Joining…' : 'Join room'}
        </button>
        {lastRoom && lastRoom !== code ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setCode(lastRoom)}
          >
            Rejoin {lastRoom}
          </button>
        ) : null}
      </section>

      <p className="center faint" style={{ fontSize: 'var(--step--1)' }}>
        Testing on your own? Open a second browser tab and join with the same code.
      </p>

      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/" className="btn btn--ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}

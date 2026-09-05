import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Avatar, Banner } from '../components/primitives.js';
import { useAccount } from '../state/account.js';
import { useSettings } from '../state/settings.js';
import { loadSoloRecord } from '../lib/storage.js';

/**
 * The account screen.
 *
 * Reachable, never in the way. A guest sees what an account is for and a
 * single button; a signed-in player sees the three things an account actually
 * holds — a name, a picture, and their best runs.
 */
export function AccountScreen() {
  const [params, setParams] = useSearchParams();
  const { status, config, profile, records, notice, busy } = useAccount();
  const refresh = useAccount((state) => state.refresh);
  const setNotice = useAccount((state) => state.setNotice);

  // A failed sign-in comes back as ?error=…; show it once, then tidy the URL.
  useEffect(() => {
    const error = params.get('error');
    if (!error) return;
    setNotice(error);
    params.delete('error');
    setParams(params, { replace: true });
  }, [params, setParams, setNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="stack" style={{ maxWidth: '58ch', margin: '0 auto', gap: 'var(--sp-5)' }}>
      <header className="stack" style={{ gap: 'var(--sp-2)' }}>
        <p className="eyebrow">Account</p>
        <h1 style={{ fontSize: 'var(--step-4)' }}>
          {status === 'signed-in' ? 'Your account.' : 'Optional, as it should be.'}
        </h1>
      </header>

      {notice ? <Banner tone="error">{notice}</Banner> : null}

      {status === 'signed-in' && profile ? (
        <SignedIn profile={profile} records={records} busy={busy} />
      ) : (
        <SignedOut config={config} status={status} busy={busy} />
      )}

      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/" className="btn btn--ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}

/* --- Guest ------------------------------------------------------------- */

function SignedOut({
  config,
  status,
  busy,
}: {
  config: ReturnType<typeof useAccount.getState>['config'];
  status: string;
  busy: boolean;
}) {
  const signInWithGoogle = useAccount((state) => state.signInWithGoogle);
  const devSignIn = useAccount((state) => state.devSignIn);
  const record = loadSoloRecord();

  return (
    <section className="card stack">
      <h2 style={{ fontSize: 'var(--step-1)' }}>Playing as a guest</h2>
      <p className="muted">
        Every mode works without an account. Your score, name and settings live in this browser —
        which means they do not follow you to another device, and clearing site data clears them.
      </p>

      {record.score > 0 ? (
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          Best run on this device: <strong>{record.score.toLocaleString('en-US')}</strong> over{' '}
          {record.rounds} rounds.
        </p>
      ) : null}

      {status === 'unknown' ? null : config.google ? (
        <>
          <div className="row row-wrap">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => signInWithGoogle('/account')}
            >
              Sign in with Google
            </button>
          </div>
          <span className="field__hint">
            Your best runs move with you. Anything already set on this device comes along.
          </span>
        </>
      ) : config.devLogin ? (
        <>
          <div className="row row-wrap">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={devSignIn}>
              Sign in as a local tester
            </button>
          </div>
          <span className="field__hint">
            Google sign-in is not configured, and this is a local server — so this shortcut stands
            in for it. It does not exist on a deployed site.
          </span>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          Sign-in is not enabled on this server. Nothing else is affected.
        </p>
      )}
    </section>
  );
}

/* --- Signed in ---------------------------------------------------------- */

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
/** Stored square size. Small enough that a whole avatar fits in a record. */
const AVATAR_PX = 128;

function SignedIn({
  profile,
  records,
  busy,
}: {
  profile: NonNullable<ReturnType<typeof useAccount.getState>['profile']>;
  records: ReturnType<typeof useAccount.getState>['records'];
  busy: boolean;
}) {
  const saveProfile = useAccount((state) => state.saveProfile);
  const signOut = useAccount((state) => state.signOut);
  const setIdentity = useSettings((state) => state.setIdentity);

  const [username, setUsername] = useState(profile.username);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const local = useMemo(() => loadSoloRecord(), []);
  const best = Math.max(local.score, records?.soloScore ?? 0);
  const bestRounds = Math.max(local.rounds, records?.soloRounds ?? 0);
  const bestStreak = Math.max(local.streak, records?.soloStreak ?? 0);

  const commit = async (patch: { username?: string; avatar?: string | null }) => {
    setError(null);
    setSaved(false);
    const message = await saveProfile(patch);
    if (message) {
      setError(message);
      return;
    }
    setSaved(true);
    // Multiplayer reads the guest identity, so keep the two in step.
    if (patch.username) setIdentity({ name: patch.username });
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That image is very large. Try one under 6 MB.');
      return;
    }
    try {
      const avatar = await toSquareDataUrl(file, AVATAR_PX);
      await commit({ avatar });
    } catch {
      setError('That file could not be read as an image.');
    }
  };

  return (
    <>
      <section className="card stack">
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
          <ProfilePicture profile={profile} size={64} />
          <div className="stack" style={{ gap: 2 }}>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-2)' }}>
              {profile.username}
            </strong>
            <span className="muted" style={{ fontSize: 'var(--step--1)' }}>
              Signed in. Your best runs are saved to this account.
            </span>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="account-name">
            Public display name
          </label>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <input
              id="account-name"
              className="input"
              value={username}
              maxLength={14}
              placeholder="Player"
              onChange={(event) => setUsername(event.target.value)}
            />
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy || username.trim().length < 2 || username === profile.username}
              onClick={() => commit({ username: username.trim() })}
            >
              Save
            </button>
          </div>
          <span className="field__hint">
            Shown to other players in a match. Names are not reserved, so two people can share one.
          </span>
        </div>

        <div className="field">
          <span className="field__label">Profile picture</span>
          <div className="row row-wrap" style={{ gap: 'var(--sp-2)' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                void pickFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Upload a picture
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || !profile.avatar}
              onClick={() => commit({ avatar: null })}
            >
              Use my initials
            </button>
          </div>
          <span className="field__hint">
            Cropped to a square and shrunk to {AVATAR_PX}px before it leaves your device.
          </span>
        </div>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {saved && !error ? (
          <div className="row">
            <span className="chip chip--accent">Saved</span>
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Best runs</h2>
        <div className="row row-wrap" style={{ gap: 'var(--sp-4)' }}>
          <Figure label="Score" value={best.toLocaleString('en-US')} />
          <Figure label="Rounds" value={String(bestRounds)} />
          <Figure label="Streak" value={String(bestStreak)} />
        </div>
        <span className="field__hint">
          Saved to your account when a solo run ends, so they survive a new browser or a new
          device. A run set as a guest on this device is merged in when you sign in.
        </span>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Session</h2>
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          Signing out leaves the game working exactly as it does for a guest.
        </p>
        <div className="row row-wrap">
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack" style={{ gap: 0, minWidth: '6ch' }}>
      <span className="eyebrow">{label}</span>
      <strong
        className="tabular"
        style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)' }}
      >
        {value}
      </strong>
    </div>
  );
}

/** The account's picture, falling back to the initials avatar used elsewhere. */
export function ProfilePicture({
  profile,
  size = 32,
}: {
  profile: { username: string; avatar: string | null; color: number };
  size?: number;
}) {
  if (!profile.avatar) return <Avatar name={profile.username} color={profile.color} size={size} />;
  return (
    <img
      className="avatar-image"
      src={profile.avatar}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Centre-crop an image file to a square and shrink it.
 *
 * Done here rather than on the server so a 12 MP phone photo never crosses the
 * network, and so what gets stored is bounded by construction.
 */
async function toSquareDataUrl(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  // Step the quality down until it fits the server's ceiling.
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 38_000) return url;
  }
  throw new Error('too large');
}

import { Link } from 'react-router-dom';
import { PLAYER_COLORS, TIMER_LABELS, type TimerPreference } from '@trivia/shared';
import { Segmented } from '../components/primitives.js';
import { useSettings } from '../state/settings.js';
import { useAccount } from '../state/account.js';
import { sfx, type AudioDiagnostics } from '../lib/audio.js';
import { clearSoloRecord, loadSoloRecord, clearRecentQuestions } from '../lib/storage.js';
import { useState } from 'react';

/**
 * A sound check.
 *
 * Nothing in a browser can answer "did the player hear that", and the two ways
 * it can fail look identical from inside the page: audio that never started,
 * and audio that is playing into a device whose media volume is down. Phones
 * keep media volume separate from the ringer, so the second is common and
 * invisible.
 *
 * So this reports what the device is actually doing, and offers a tone that is
 * deliberately louder and longer than anything in the game. If the tone plays,
 * the audio path works and the rest is volume. If it does not, the numbers
 * below say how far it got.
 */
function SoundCheck() {
  const [report, setReport] = useState<AudioDiagnostics | null>(null);
  const [signal, setSignal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setSignal(null);
    const peak = await sfx.measureOutput();
    setSignal(peak);
    setReport(sfx.diagnostics());
    setBusy(false);
  };

  const verdict = () => {
    if (signal === null || !report) return null;
    if (signal > 0.01) {
      return (
        <>
          <strong>A signal is reaching your speaker.</strong> The page measured its own output at{' '}
          {Math.round(signal * 100)}% while the tone played, so the game&rsquo;s audio is working.
          If you heard nothing, it is the device: raise the <strong>media</strong> volume — on a
          phone that is a separate control from the ringer, and the volume keys only change it
          while something is playing.
        </>
      );
    }
    if (report.state !== 'running') {
      return (
        <>
          <strong>Audio has not started.</strong> The browser is still refusing to open an audio
          context ({report.state}). Tap the button once more — some browsers need the tap that
          starts audio to be a direct one.
        </>
      );
    }
    if (!report.enabled) {
      return (
        <>
          <strong>Sound effects are switched off</strong> in the control above.
        </>
      );
    }
    if (report.volume === 0) {
      return (
        <>
          <strong>The in-game volume is at zero.</strong> Raise the slider above.
        </>
      );
    }
    return (
      <>
        <strong>No signal was produced.</strong> Audio is running but nothing came out, which
        usually means the browser is blocking sound for this site. In Chrome: the padlock or
        &ldquo;i&rdquo; next to the address, then Permissions, then Sound.
      </>
    );
  };

  return (
    <div className="field">
      <span className="field__label">Not hearing anything?</span>
      <div className="row row-wrap">
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void check()}>
          {busy ? 'Listening…' : 'Test the sound'}
        </button>
      </div>
      <span className="field__hint">
        Plays three rising notes, much louder than the game, and measures whether they actually
        reach the speaker.
      </span>

      {signal !== null ? <p className="field__hint">{verdict()}</p> : null}

      {report ? (
        <p className="field__hint faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {report.state}
          {report.sampleRate ? ` · ${Math.round(report.sampleRate / 100) / 10} kHz` : ''}
          {report.baseLatencyMs !== null ? ` · buffer ${report.baseLatencyMs}ms` : ''}
          {report.lookaheadMs !== null ? ` · lookahead ${report.lookaheadMs}ms` : ''}
          {` · volume ${Math.round(report.volume * 100)}%`}
          {signal !== null ? ` · measured ${Math.round(signal * 1000) / 10}%` : ''}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsScreen() {
  const settings = useSettings((state) => state.settings);
  const update = useSettings((state) => state.update);
  const identity = useSettings((state) => state.identity);
  const setIdentity = useSettings((state) => state.setIdentity);
  const [record, setRecord] = useState(loadSoloRecord);
  const [cleared, setCleared] = useState(false);
  const accountStatus = useAccount((state) => state.status);
  const accountAvailable = useAccount((state) => state.config.available);

  return (
    <div className="stack" style={{ maxWidth: '58ch', margin: '0 auto', gap: 'var(--sp-5)' }}>
      <header className="stack" style={{ gap: 'var(--sp-2)' }}>
        <p className="eyebrow">Settings</p>
        <h1 style={{ fontSize: 'var(--step-4)' }}>Set it up how you like it.</h1>
      </header>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>You</h2>
        <div className="field">
          <label className="field__label" htmlFor="player-name">
            Display name
          </label>
          <input
            id="player-name"
            className="input"
            value={identity.name}
            maxLength={14}
            placeholder="Player"
            onChange={(event) => setIdentity({ name: event.target.value })}
          />
          <span className="field__hint">Shown to everyone in a multiplayer room.</span>
        </div>

        <div className="field">
          <span className="field__label" id="colour-label">
            Colour
          </span>
          <div className="row row-wrap" role="radiogroup" aria-labelledby="colour-label">
            {Array.from({ length: PLAYER_COLORS }, (_, index) => (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={identity.color === index}
                aria-label={`Colour ${index + 1}`}
                data-color={index}
                onClick={() => setIdentity({ color: index })}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  border:
                    identity.color === index
                      ? '3px solid var(--text-hi)'
                      : '3px solid transparent',
                  opacity: identity.color === index ? 1 : 0.55,
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Sound</h2>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Sound effects</span>
          <Segmented
            label="Sound effects"
            value={settings.sound ? 'on' : 'off'}
            onChange={(next) => {
              sfx.unlock();
              update({ sound: next === 'on' });
              if (next === 'on') sfx.play('score');
            }}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="volume">
            Volume
          </label>
          <input
            id="volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            disabled={!settings.sound}
            onChange={(event) => update({ volume: Number(event.target.value) })}
            onMouseUp={() => sfx.play('tap')}
            onTouchEnd={() => sfx.play('tap')}
            style={{ accentColor: 'var(--cyan)' }}
          />
        </div>

        <SoundCheck />
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Motion</h2>
        <div className="field">
          <span className="field__label">Animation</span>
          <Segmented
            block
            label="Animation intensity"
            value={settings.motion}
            onChange={(motion) => update({ motion })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <span className="field__hint">
            If your device asks for reduced motion, that is respected automatically — this only
            makes it calmer still.
          </span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            Reaction scenes
            <span className="field__hint" style={{ display: 'block' }}>
              The short animation before each answer.
            </span>
          </span>
          <Segmented
            label="Reaction scenes"
            value={settings.reactions ? 'on' : 'off'}
            onChange={(next) => update({ reactions: next === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Pace</h2>
        <div className="field">
          <span className="field__label">Thinking time</span>
          <Segmented
            block
            label="Thinking time"
            value={settings.timer}
            onChange={(timer: TimerPreference) => update({ timer })}
            options={(['relaxed', 'standard', 'blitz'] as TimerPreference[]).map((value) => ({
              value,
              label: TIMER_LABELS[value],
            }))}
          />
          <span className="field__hint">
            Applies to solo runs. Quick matches always use 30 seconds so both sides get the same
            clock; in a private room, the person who made it sets the pace.
          </span>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Your data</h2>
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          {accountStatus === 'signed-in'
            ? 'Settings stay in this browser; your best runs are also saved to your account.'
            : 'Everything is stored in this browser only.'}{' '}
          Best solo score on this device:{' '}
          <strong>{record.score.toLocaleString('en-US')}</strong> over {record.rounds} rounds.
        </p>
        {accountAvailable ? (
          <div className="row row-wrap">
            <Link to="/account" className="btn btn--sm">
              {accountStatus === 'signed-in' ? 'Manage your account' : 'Sign in to keep your scores'}
            </Link>
          </div>
        ) : null}
        <div className="row row-wrap">
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => {
              setRecord(clearSoloRecord());
              clearRecentQuestions();
              setCleared(true);
            }}
          >
            Reset scores and history
          </button>
          {cleared ? <span className="chip chip--accent">Cleared</span> : null}
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/" className="btn btn--ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { PLAYER_COLORS, TIMER_LABELS, type TimerPreference } from '@trivia/shared';
import { Segmented } from '../components/primitives.js';
import { useSettings } from '../state/settings.js';
import { sfx } from '../lib/audio.js';
import { clearSoloRecord, loadSoloRecord, clearRecentQuestions } from '../lib/storage.js';
import { useState } from 'react';

export function SettingsScreen() {
  const settings = useSettings((state) => state.settings);
  const update = useSettings((state) => state.update);
  const identity = useSettings((state) => state.identity);
  const setIdentity = useSettings((state) => state.setIdentity);
  const [record, setRecord] = useState(loadSoloRecord);
  const [cleared, setCleared] = useState(false);

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
            Applies to solo runs. In a room, the host sets the pace for everyone.
          </span>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-1)' }}>Your data</h2>
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          Everything is stored in this browser only. Best solo score:{' '}
          <strong>{record.score.toLocaleString('en-US')}</strong> over {record.rounds} rounds.
        </p>
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

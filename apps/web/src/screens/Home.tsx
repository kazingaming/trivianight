import { Link } from 'react-router-dom';
import { ALL_QUESTIONS } from '@trivia/content';
import { useAccount } from '../state/account.js';
import { loadSoloRecord } from '../lib/storage.js';

/**
 * Home.
 *
 * Three ways to play, in the order people actually want them: play alone right
 * now, play someone right now, play a group right now. Private rooms are still
 * one tap away, but they are no longer what "multiplayer" means here.
 */
const PRIMARY = [
  {
    to: '/solo',
    color: 1,
    kicker: 'Play now',
    name: 'Solo Gauntlet',
    blurb: 'Three lives, no finish line. The difficulty climbs until it beats you.',
    meta: ['Instant', '1 player', 'Endless'],
  },
  {
    to: '/quick/duel',
    color: 0,
    kicker: 'Public match',
    name: 'Quick 1v1',
    blurb: 'Straight into a duel with the next player searching. No code, no waiting room.',
    meta: ['Matchmade', '8 rounds', '30s a question'],
  },
  {
    to: '/quick/ffa',
    color: 2,
    kicker: 'Public match',
    name: 'Quick FFA',
    blurb: 'Four players, gathered automatically. The loudest way to play.',
    meta: ['Matchmade', '10 rounds', 'Up to 4'],
  },
];

export function Home() {
  // The best of the two places a run can be recorded: this device, and the
  // account if there is one.
  const remote = useAccount((state) => state.records?.soloScore ?? 0);
  const best = Math.max(loadSoloRecord().score, remote);

  return (
    <div className="home">
      <section className="home__hero">
        <p className="eyebrow">A reasoning game, not a quiz</p>
        <h1 className="home__title">
          You won’t know
          <br />
          the answer.
          <br />
          <em>Guess anyway.</em>
        </h1>
        <p className="home__pitch">
          Every question is a number nobody memorises. Work it out from what you already know —
          the closer you land, the more you score.
        </p>

        <div className="home__example">
          <p className="home__example-q">
            Approximately how many people worldwide were blind in 2020?
          </p>
          <div className="home__example-a">
            <span>You guess 20 million.</span>
            <strong>43.3 million</strong>
            <span>2.2× too low — and still worth a third of the points.</span>
          </div>
        </div>
      </section>

      <section className="modes" aria-label="Game modes">
        {PRIMARY.map((mode) => (
          <Link key={mode.to} to={mode.to} className="mode-card" data-color={mode.color}>
            <span className="mode-card__kicker">{mode.kicker}</span>
            <h2 className="mode-card__name">{mode.name}</h2>
            <p className="mode-card__blurb">{mode.blurb}</p>
            <div className="mode-card__meta">
              {mode.meta.map((item) => (
                <span key={item} className="chip">
                  {item}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </section>

      {/* Secondary by design: still discoverable, never competing for attention. */}
      <section className="home__secondary" aria-label="Other options">
        <Link to="/private" className="home__private">
          <span className="home__private-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <span>
            <strong>Private game</strong>
            <span className="home__private-sub">Play with friends using a room code</span>
          </span>
        </Link>
        <div className="home__links">
          <Link to="/how-to-play">How to play</Link>
          <span aria-hidden>·</span>
          <Link to="/settings">Settings</Link>
        </div>
      </section>

      <p className="center faint" style={{ fontSize: 'var(--step--1)' }}>
        {ALL_QUESTIONS.length} questions in the bank
        {best > 0 ? ` · your best solo run: ${best.toLocaleString('en-US')}` : ''}
      </p>
    </div>
  );
}

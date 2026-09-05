import { Link } from 'react-router-dom';
import { MODES } from '@trivia/shared';

export function HowToPlay() {
  return (
    <div className="stack" style={{ maxWidth: '68ch', margin: '0 auto', gap: 'var(--sp-6)' }}>
      <header className="stack" style={{ gap: 'var(--sp-2)' }}>
        <p className="eyebrow">How to play</p>
        <h1 style={{ fontSize: 'var(--step-4)' }}>Estimate, don’t recall.</h1>
      </header>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>The idea</h2>
        <p className="muted">
          Most questions ask for a number you have never looked up. That is deliberate. The point
          is not to remember it — it is to reason your way close to it using things you already
          know, then find out how close you got.
        </p>
        <p className="muted">
          Guessing 20 million when the answer is 43.3 million is wrong. It is also a genuinely good
          guess, and the game pays you for it.
        </p>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Scoring</h2>
        <ul className="muted stack" style={{ gap: 'var(--sp-2)' }}>
          <li>Closeness is measured in multiples, not in raw difference.</li>
          <li>
            Being twice as high or twice as low scores the same, whether the answer is 100 or 100
            billion.
          </li>
          <li>Landing within a few percent is worth almost everything.</li>
          <li>Landing in the right ballpark is still worth a solid chunk.</li>
          <li>Being ten times out is worth very little. That is the whole game.</li>
          <li>Harder rounds are worth more, and streaks of good guesses add a bonus.</li>
        </ul>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Entering numbers</h2>
        <p className="muted">
          Type shorthand — <code>25k</code>, <code>2.5m</code>, <code>7b</code>,{' '}
          <code>3.2t</code> — or tap the size buttons. Whatever you type, the interpreted value is
          shown underneath in full, so you can never lose a zero by accident.
        </p>
        <p className="muted">
          There is a calculator if you want to multiply something out. It does arithmetic and
          nothing else, and it does not stop the clock.
        </p>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>The modes</h2>
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div>
            <h3 style={{ fontSize: 'var(--step-1)', color: 'var(--amber)' }}>
              {MODES.solo.label}
            </h3>
            <p className="muted">
              Three lives, no finish line. Questions get harder the longer you last, and a wildly
              wrong answer costs a life. Chase your own high score.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 'var(--step-1)', color: 'var(--cyan)' }}>{MODES.duel.label}</h3>
            <p className="muted">
              Two players, same questions, {MODES.duel.rounds} rounds. Neither of you sees the
              other’s number until both have locked in. The closest guess takes a bonus, but
              everyone scores on accuracy — a near miss is never worth nothing.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 'var(--step-1)', color: 'var(--magenta)' }}>
              {MODES.ffa.label}
            </h3>
            <p className="muted">
              Up to four players in a room. The difficulty ramps most gently here, so everyone gets
              to settle in before the ridiculous questions arrive.
            </p>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Playing with other people</h2>
        <p className="muted">
          One person creates a room and reads out the four-character code. Everyone else joins with
          it. No accounts, no sign-up. If someone drops out their seat is held for a minute and a
          half, and a refresh puts them straight back in with their score intact.
        </p>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Where the numbers come from</h2>
        <p className="muted">
          Every factual question carries its source, and says whether the figure was counted,
          estimated or modelled. Numbers that change over time are dated. When the honest answer is
          &ldquo;about 43.3 million&rdquo;, the game says about — it will not pretend to a precision
          nobody has.
        </p>
      </section>

      <div className="row row-wrap" style={{ justifyContent: 'center' }}>
        <Link to="/solo" className="btn btn--primary btn--lg">
          Start a solo run
        </Link>
        <Link to="/" className="btn btn--ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}

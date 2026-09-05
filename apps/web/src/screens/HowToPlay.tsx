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
            <h3 style={{ fontSize: 'var(--step-1)', color: 'var(--cyan)' }}>Quick 1v1</h3>
            <p className="muted">
              Press the button and you are put in a queue. As soon as one other person is
              searching, you are matched and the game starts — no code, no lobby, nobody waiting
              on a host. {MODES.duel.rounds} rounds, 30 seconds each. Neither of you sees the
              other’s number until both have locked in. The closest guess takes a bonus, but
              everyone scores on accuracy — a near miss is never worth nothing.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 'var(--step-1)', color: 'var(--magenta)' }}>Quick FFA</h3>
            <p className="muted">
              The same idea for a group. Matchmaking gathers up to four players, then starts.
              The difficulty ramps most gently here, so everyone gets to settle in before the
              ridiculous questions arrive. If the queue is quiet it will start with three, and
              it tells you when it does — there are no bots.
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 'var(--step-1)' }}>Private game</h3>
            <p className="muted">
              For playing with people you already know. One person creates a room and reads out
              the four-character code; everyone else joins with it. The creator picks the pace
              and presses start.
            </p>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ fontSize: 'var(--step-2)' }}>Connection and identity</h2>
        <p className="muted">
          No accounts, no sign-up — just pick a name. Everything is run by the server, so nobody
          needs to open ports or host anything. If you drop out, your seat is held and a refresh
          puts you straight back in with your score intact.
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
        <Link to="/quick/duel" className="btn btn--accent">
          Find a 1v1
        </Link>
        <Link to="/" className="btn btn--ghost">
          Back home
        </Link>
      </div>
    </div>
  );
}

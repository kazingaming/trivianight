# Trivia Night

A reasoning-first trivia game. You usually **won't** know the answer — the point is to
work out roughly where it must be, and find out how close you got.

> Approximately how many people worldwide were estimated to be blind in 2020?
>
> You guess 20 million. The answer is **43.3 million**.
> You were 2.2× too low — and that is still worth a third of the points.

---

## Running it

Requires **Node 20 or newer**.

```bash
npm install
```

```bash
npm run dev
```

Then open **http://localhost:5173**.

That starts two processes: the Vite dev server on `5173` and the game server on `3001`.
Vite proxies `/socket.io` and `/api` through to the game server, so everything is
same-origin and there is nothing else to configure.

### Playing multiplayer locally

Open a **second browser tab** at the same address and join with the room code. Each tab is
a separate player — the seat token lives in `sessionStorage`, so tabs don't fight over one
identity, while a refresh still puts you back in your own seat with your score intact.

To play across devices on your network, use the `Network:` URL that Vite prints and make
sure port `5173` is reachable.

### Production build

```bash
npm run serve
```

Builds the client and serves it from the game server on **http://localhost:3001** —
one process, one port. Set `PORT` (or `TRIVIA_PORT`) to change it.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests plus a full lobby-to-podium multiplayer match |
| `npm run typecheck` | Typechecks every package |
| `npm run content:check` | Validates the question bank and prints its shape |
| `npm run build` | Builds the client only |

---

## What's in the box

**Three modes.**

- **Solo Gauntlet** — three lives, no finish line. Difficulty climbs fastest here, a wildly
  wrong guess costs a life, and your best score is kept locally.
- **1v1 Duel** — two players, same questions, eight rounds. Starts around medium.
- **Free For All** — up to four players. The gentlest ramp, so a room can settle in before
  the ridiculous questions arrive.

**Nine question formats** — numeric estimate, percentage, probability, year, higher/lower,
which-is-bigger, which-is-closer, ordering, and multiple choice.

**105 questions** across 14 categories, every one carrying its source and whether the
figure was measured, estimated, modelled, or true by definition.

---

## How scoring works

Being almost right should feel nearly as good as knowing.

Open quantities are scored on **log-ratio** error, not raw difference — so guessing 5
billion against 10 billion earns exactly what guessing 50 against 100 does. Absolute error
would turn every large-number question into a lottery.

```
accuracy = exp(-(log10(guess / answer) / tolerance) ^ 1.3)
```

With the default tolerance that works out to roughly:

| How far off | Score | Reads as |
| --- | --- | --- |
| within 1.4% | 99.5%+ | Bullseye |
| within 14% | 90% | Ridiculously close |
| within 37% | 72% | Good guess |
| within 2.3× | 30% | In the ballpark |
| within 4× | 10% | Way off |
| 10× out | 1% | Different universe |

Percentages and years are scored on absolute distance instead, because that is how people
actually reason about them. Ordering questions get partial credit from pairwise
concordance, rescaled so a random shuffle earns nothing.

On top of the accuracy score: harder rounds pay a multiplier, consecutive good rounds pay a
streak bonus, and in multiplayer the closest player takes a bonus — **but everyone still
scores on their own accuracy.** Losing a round by a hair is never worth zero.

---

## Project layout

```
packages/
  shared/     Types, scoring, number parsing, difficulty curves, wire protocol
  content/    The question bank, its validator, and the pool selector
apps/
  server/     Express + Socket.IO. Authoritative for every multiplayer room.
  web/        Vite + React client
```

**Content is data, never code.** `packages/shared/src/types.ts` defines the question model;
`packages/content/src/packs/` holds the questions. Nothing in the UI knows about any
individual question.

Workspace packages are consumed straight from TypeScript source — Vite aliases them and the
server runs under `tsx` — so there is no build step between editing shared code and seeing
it work.

---

## Adding questions

Add an entry to a file in `packages/content/src/packs/core/`, or create a new pack file and
register it in `packages/content/src/index.ts`. Then:

```bash
npm run content:check
```

The checker refuses anything malformed — a missing reveal, an answer outside its own range,
a duplicate id, an undated statistic that is marked as changing over time — and prints the
distribution across difficulty, format and category so gaps are obvious.

A numeric question looks like this:

```ts
{
  id: 'scale.ants',
  type: 'numeric',
  prompt: 'Approximately how many ants are alive on Earth right now?',
  category: 'Animals',
  difficulty: 3,
  answer: 2e16,
  displayAnswer: '20 quadrillion',   // avoids implying false precision
  unit: 'ants',
  magnitude: 'astronomical',          // picks the input's shorthand buttons
  tolerance: 0.42,                    // decades of log error; higher = kinder
  reveal: {
    headline: '20 quadrillion',
    explanation: '...',               // the payoff — make it interesting
    comparison: 'Roughly 2.5 million ants for every single human being.',
  },
  source: {
    citation: 'Schultheiss et al., "The abundance, biomass, and distribution of ants on Earth"',
    publisher: 'PNAS',
    year: 2022,
    kind: 'estimated',
  },
}
```

### What makes a good question

- The player should think *"I have no idea — but I can work this out."*
- Not *"I either memorised this or I didn't."*
- And not *"I can just multiply the numbers in the question."* A calculator may help you
  reason; it should never solve the thing for you.
- The reveal should be worth reading even if you got it right.
- If the honest answer is a range, say **about**. Never imply precision nobody has.
- Anything that drifts — populations, internet users — gets `volatile: true` and a year.

---

## Notes on the design

**Difficulty is never sent to the client during a question.** Knowing a question is tagged
"Wildcard" would leak that the answer is absurd, so `toPublicQuestion` strips it along with
the answer, the reveal text and the source.

**Guesses are held on the server** until every connected player has locked in. They are not
sent to other clients in any form before the reveal — the integration test asserts this.

**Difficulty is rolled, not scheduled.** Each round produces a weighted distribution centred
on a moving target rather than a fixed table, so the ramp is intentional but the selection
stays unpredictable.

**Reaction scenes** are procedural. One engine handles the physics and timing; seven themes
(archery, free throw, darts, booster landing, curling, putting, paper plane) supply the
paint, and the theme rotates per round. The outcome mirrors the guess: overshoot for too
high, fall short for too low, dead centre for a bullseye.

**Sound is synthesised** with the Web Audio API — no audio files, no licensing questions,
and it starts only after a real user gesture.

**Solo runs entirely in the browser.** No server, no latency, and it keeps working if the
game is ever packaged for a platform without a backend. That does mean the answer is in
memory during a round; in a single-player high-score mode the only person you could cheat
is yourself.

---

## Accessibility

- Animation intensity has three levels, and the OS `prefers-reduced-motion` setting is
  respected on top of whatever you choose.
- Reaction scenes can be switched off entirely; the reveal still tells you everything.
- Success and failure are never signalled by colour alone — there is always a word.
- Sound is toggleable from every screen and has a volume control.
- Full keyboard play: <kbd>Enter</kbd> locks in, <kbd>C</kbd> opens the calculator,
  <kbd>Esc</kbd> closes it. Focus is visible everywhere and dialogs trap it.
- Touch targets are at least 44px on touch devices; number entry never needs a letter key.
- Reveals are announced to screen readers, and the number line has a text equivalent.

---

## Deployment

The server serves the built client when `NODE_ENV=production`, so a single Node process on
a single port is all you need. Rooms are in-memory by design — a party game room is
worthless once everyone has gone home — and swapping that for a shared store touches only
`apps/server/src/rooms.ts`.

Nothing in the client assumes a browser-only environment beyond the DOM itself: no
build-time URLs, no absolute origins, fonts bundled rather than fetched. Packaging it later
for a desktop or mobile shell should be a matter of pointing the socket at a host.

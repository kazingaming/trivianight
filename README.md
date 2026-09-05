# Trivia Night

A reasoning-first trivia game. You usually **won't** know the answer — the point is to
work out roughly where it must be, and find out how close you got.

> Approximately how many people worldwide were estimated to be blind in 2020?
>
> You guess 20 million. The answer is **43.3 million**.
> You were 2.2× too low — and that is still worth a third of the points.

---

## Play it (one click)

Double-click **`Launch Trivia Night.bat`**.

It checks your setup, installs and builds anything missing, starts the game server and
opens your browser at <http://localhost:8787>. Close the window to stop the game.

The first launch takes a minute or two while dependencies install. After that it is a few
seconds.

The launcher runs the **real Cloudflare runtime** (workerd) on your machine, so what you
play locally is what deploys. No Cloudflare account or login is needed for this — only
`npm run deploy` talks to Cloudflare.

## First-time setup

You need **one** thing installed, once:

- **[Node.js 20 or newer](https://nodejs.org)** — download the LTS build and accept the
  defaults. npm comes with it.

That is all. The launcher handles dependencies and the build itself. If Node is missing or
too old, the launcher says so and tells you where to get it.

Nothing else is required: no database, no accounts, no API keys, no port forwarding.

---

## Game modes

| Mode | Players | Rounds | Clock | How you get in |
| --- | --- | --- | --- | --- |
| **Solo Gauntlet** | 1 | Endless, 3 lives | 45s | Instant |
| **Quick 1v1** | 2 | 8 | 30s | Public matchmaking |
| **Quick FFA** | exactly 4 | 10 | 30s | Public matchmaking |
| **Private game** | 2–4 | Configurable | Configurable | Room code |

**Solo Gauntlet** climbs the fastest and runs until three wildly wrong answers end it.
**Quick 1v1** opens around medium difficulty and rises to hard. **Quick FFA** has the
gentlest ramp so a room can settle in, and needs **all four players** — it waits for real
people however long that takes, never shrinks the party, and never uses bots. Cancel any
time. **Private games** are still there for playing with people you know — they are just
no longer what "multiplayer" means by default.

---

## Developer mode

```bash
npm install
```

```bash
npm run dev
```

Vite on <http://localhost:5173> with hot reload, and the Worker under `wrangler dev` on
`8787`. Vite proxies `/ws` and `/api` through, so everything is same-origin with no config.

To play multiplayer locally, open a **second browser tab**. Each tab is a separate player:
the seat token lives in `sessionStorage`, so tabs do not fight over one identity, while a
refresh still returns you to your own seat with your score intact.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite with hot reload plus the Worker |
| `npm run launch` | The one-click launcher, from a terminal |
| `npm start` | Build the client, then serve everything from the Worker |
| `npm test` | Full suite: unit tests plus real multi-client matches |
| `npm run typecheck` | Typechecks every package |
| `npm run content:check` | Validates the question bank and prints its shape |
| `npm run build` | Builds the client |
| `npm run deploy` | Build and deploy to Cloudflare |

## Production build

```bash
npm start
```

Builds the client and serves it from the Worker on <http://localhost:8787> — one process,
one port, no Vite. `wrangler dev` runs **workerd**, the same runtime Cloudflare runs, with
real Durable Objects, so if it works here it works deployed. This is what the launcher
uses.

## Testing

```bash
npm test
```

53 tests. The interesting ones are not unit tests: `apps/worker/test/` boots the real
Worker under `wrangler dev` and drives real WebSocket clients through complete matches —
matchmaking, hidden guesses, reveals, reconnection, disconnects, abandoned games, private
rooms and queue lifecycle. Nothing there reaches past the wire, so a passing test means a
browser would have worked too.

The integration files run one at a time (`fileParallelism: false`): each starts its own
workerd instance, and running several at once starves them of CPU badly enough to make
round timing flaky.

---

## Multiplayer architecture

**The server is authoritative for everything that matters.** No player's browser hosts a
game, decides a score, or controls another player's state. Clients render snapshots and
submit intent.

**Matchmaking.** Players join a queue by mode. The matchmaker gathers compatible tickets
and builds a room. Pairing lives behind a `MatchmakingPolicy` interface; today there is one
implementation — first come, first served — because there is no rating to match on. Adding
Elo, regions or a ranked split later means writing a new policy, not touching the queue,
the protocol or the room lifecycle.

One ticket per player, always: a duplicate request returns your existing place, switching
modes moves you, and a disconnect or closed tab removes you. Since the ticket lives and
dies with the WebSocket, a closed tab cannot leave a ghost behind; a sweep runs alongside
that for sockets that die without a close frame, and only while somebody is waiting.

**Free For All requires exactly four players.** It waits indefinitely for four real people
and never shrinks the party — no three-player fallback, no bots. Cancel any time.

**Game rooms.** A room owns the question, the clock and the scoreboard. Guesses are held
server-side until every connected player has locked in; they are not sent to other clients
in any form before the reveal, which the test suite asserts. The deadline is a server
timestamp — the visible countdown is a rendering of it, never the source of truth.

**Public vs private.** Matchmade rooms have no host: `hostId` is empty, nobody can start,
configure or rematch them, and the server starts the match itself once the party is seated.
Private rooms keep a party leader who picks settings and presses start. That is a social
role only — the leader's browser has no more authority than anyone else's.

**Where it runs.** A single Cloudflare Worker serves the built client, the HTTP API and the
WebSocket upgrades. Authoritative state lives in Durable Objects:

- **`MatchmakerDO`** — one global instance holding both queues. Matchmaking is a rendezvous
  problem, so a single agreed-upon object is the right answer, and keeping both queues
  together is what makes "one place per player" true by construction.
- **`RoomDO`** — one instance per room code, owning that match. Players connect to it
  directly, so there is no relay hop.

Players hold a queue socket while searching and a room socket while playing — one at a
time, never both.

**Realtime.** Plain WebSockets with a small JSON envelope (`{ i, t, d }` for requests,
`{ i, ok, d }` for acknowledgements, `{ t, d }` for events). Traffic is tiny: queue status,
question ids, guesses, locks, deadlines and score deltas. Reconnection is automatic with
backoff, and a returning player reclaims their seat and score by client id. A public match
that drops below its minimum player count for 25 seconds ends honestly with "your opponent
left" rather than stranding anyone.

**Identity.** No accounts. A random client id in `sessionStorage` identifies you for as
long as the tab lives; your display name and colour persist in `localStorage`. Duplicate
display names are disambiguated for display only ("Ada", "Ada 2") and never affect internal
identity.

**Persistence.** Rooms hold their live state in memory and are kept alive by their open
WebSockets for exactly as long as a match is being played; only a room's claim on its code
is persisted, which is what stops two matches being handed the same code. Personal bests
and settings live in your browser. There is no database.

**The engine is runtime-agnostic.** `packages/engine` — the room state machine and the
matchmaker — is pure TypeScript with no platform imports. It takes callbacks for
broadcasting, which is what lets the same logic run inside a Durable Object and inside the
test harness unchanged, and what would let it move again if it ever needed to.

---

## Environment configuration

There is almost nothing to configure. The Worker serves the client and the backend from one
origin, so there are no URLs to wire together and no CORS to set up.

| Variable | Where | Default | What it does |
| --- | --- | --- | --- |
| `VITE_SERVER_URL` | Client build | empty | Where the browser opens its socket. Empty = same origin, correct for local dev, the launcher and production. Set it **only** if you host the frontend somewhere other than the Worker. |
| `SERVER_PORT` | Dev only | `8787` | Port the Vite dev proxy forwards `/ws` and `/api` to. Change only alongside a matching `--port` for wrangler. |

**There are no secrets, no API keys and no database credentials.** Deployment authenticates
through `wrangler login`, which stores its credential in your user profile, outside this
repository. Nothing sensitive should ever end up in a file here.

The Worker's own shape — its name and its Durable Object bindings — lives in
`apps/worker/wrangler.toml` rather than in environment variables, because it is part of the
application rather than its configuration.

---

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full handoff: recommended free stack,
accounts to create, exact steps, free-tier limits and how to avoid surprise billing.

Short version: the whole game — client, API, matchmaking and live multiplayer — is one
**Cloudflare Worker** with two Durable Object classes. Sign in once with `wrangler login`,
then:

```bash
npm run deploy
```

That runs on the Workers **free plan** at $0/month, and there is no server to keep awake,
so nothing sleeps between games.

---

## Adding questions

Add an entry to a file in `packages/content/src/packs/core/`, or create a new pack file and
register it in `packages/content/src/index.ts`. Then:

```bash
npm run content:check
```

The checker refuses anything malformed — a missing reveal, an answer outside its own range,
a duplicate id, an undated statistic marked as changing over time — and prints the
distribution across difficulty, format and category so gaps are obvious.

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
    citation: 'Schultheiss et al., PNAS',
    year: 2022,
    kind: 'estimated',
  },
}
```

### What makes a good question

- The player should think *"I have no idea — but I can work this out."*
- Not *"I either memorised this or I didn't."*
- And not *"I can just multiply the numbers in the question."*
- The reveal should be worth reading even if you got it right.
- If the honest answer is a range, say **about**.
- Anything that drifts — populations, internet users — gets `volatile: true` and a year.

---

## How scoring works

Being almost right should feel nearly as good as knowing.

Open quantities are scored on **log-ratio** error, so guessing 5 billion against 10 billion
earns exactly what guessing 50 against 100 does:

```
accuracy = exp(-(log10(guess / answer) / tolerance) ^ 1.3)
```

| How far off | Score | Reads as |
| --- | --- | --- |
| within 1.4% | 99.5%+ | Bullseye |
| within 14% | 90% | Ridiculously close |
| within 37% | 72% | Good guess |
| within 2.3× | 30% | In the ballpark |
| within 4× | 10% | Way off |
| 10× out | 1% | Different universe |

Percentages and years use absolute distance instead. Ordering questions get partial credit
from pairwise concordance, rescaled so a random shuffle earns nothing.

Harder rounds pay a multiplier, streaks pay a bonus, and in multiplayer the closest player
takes a bonus — but **everyone still scores on their own accuracy**. Losing a round by a
hair is never worth zero.

---

## Troubleshooting

**"Port 8787 is already in use"** — Trivia Night is probably already running; check your
browser and other windows. Otherwise close whatever is using the port, or set
`TRIVIA_PORT=8788` before launching.

**A `workerd.exe` keeps running after closing the launcher** — on Windows the runtime can
outlive its parent. Close it from Task Manager, or run
`taskkill /IM workerd.exe /F` in a terminal.

**The launcher closes instantly** — Node is not installed or not on your PATH. Install the
LTS build from [nodejs.org](https://nodejs.org) and try again.

**"Matchmaking is unavailable"** — the client cannot reach the Worker. In dev, check that
`npm run dev` is running both processes. Locally, `wrangler dev` takes a few seconds to
boot on first start.

**Quick Match never finds anyone** — Quick 1v1 needs one other real person searching at the
same time, and **Quick FFA needs all four**. There are no bots and no smaller fallback. To
test alone, open several browser tabs and queue in each.

**Two tabs act like the same player** — they shouldn't; identity is per-tab. If it happens,
one tab is probably a duplicate of the other (`Ctrl`+`K`-style tab duplication copies
`sessionStorage`). Open a genuinely new tab instead.

**Changes to questions don't show up** — the launcher runs a production build. Either
relaunch, or use `npm run dev` while editing content.

**Tests time out** — the multiplayer suites start real Worker runtimes and play real rounds
at real speed; the full run takes about two and a half minutes. That is expected.

---

## Project layout

```
packages/
  shared/     Types, scoring, number parsing, difficulty curves, wire protocol
  content/    The question bank, its validator, and the pool selector
  engine/     Room state machine and matchmaker. Pure logic, no platform.
apps/
  worker/     Cloudflare Worker + Durable Objects. Authoritative for everything.
  web/        Vite + React client
scripts/
  launch.mjs  The one-click launcher
```

Workspace packages are consumed straight from TypeScript source — Vite aliases them and
Wrangler bundles them — so there is no build step between editing shared code and seeing it
work.

The split between `engine` and `worker` is the important one: `engine` is the game, and
`worker` is where it happens to run. Keeping platform types out of the engine is what made
this migration a transport change rather than a rewrite.

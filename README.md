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

It checks your setup, installs and builds anything missing, starts the server and opens
your browser at <http://localhost:3001>. Close the window to stop the game.

The first launch takes a minute or two while dependencies install. After that it is a few
seconds.

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
| **Quick FFA** | up to 4 | 10 | 30s | Public matchmaking |
| **Private game** | 2–4 | Configurable | Configurable | Room code |

**Solo Gauntlet** climbs the fastest and runs until three wildly wrong answers end it.
**Quick 1v1** opens around medium difficulty and rises to hard. **Quick FFA** has the
gentlest ramp so a room can settle in. **Private games** are still there for playing with
people you know — they are just no longer what "multiplayer" means by default.

---

## Developer mode

```bash
npm install
```

```bash
npm run dev
```

Vite on <http://localhost:5173> with hot reload, and the game server on `3001`. Vite
proxies `/socket.io` and `/api` through, so everything is same-origin with no config.

To play multiplayer locally, open a **second browser tab**. Each tab is a separate player:
the seat token lives in `sessionStorage`, so tabs do not fight over one identity, while a
refresh still returns you to your own seat with your score intact.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev servers with hot reload |
| `npm run launch` | The one-click launcher, from a terminal |
| `npm test` | Full suite: unit tests plus real multi-client matches |
| `npm run typecheck` | Typechecks every package |
| `npm run content:check` | Validates the question bank and prints its shape |
| `npm run build` | Builds the client |
| `npm run serve` | Build, then run the production server on `3001` |

Set `TRIVIA_DEBUG=1` for verbose room join/leave logging when chasing a multiplayer bug.

## Production build

```bash
npm run serve
```

Builds the client and serves it from the game server on <http://localhost:3001> — one
process, one port, no Vite. This is the same path the launcher uses and the same path
production uses, so if it works here it works deployed.

## Testing

```bash
npm test
```

51 tests. The interesting ones are not unit tests: `apps/server/test/` boots the real
server binary and drives real socket clients through complete matches — matchmaking,
hidden guesses, reveals, disconnects, abandoned games and queue lifecycle.

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
modes moves you, and a disconnect or closed tab removes you. Ghosts are swept on a timer
and on every disconnect.

Free For All wants four players. If the queue is quiet it will start with three after 40
seconds and two after 75, and the UI says so. It never fills seats with bots — every player
in a match is a real person.

**Game rooms.** A room owns the question, the clock and the scoreboard. Guesses are held
server-side until every connected player has locked in; they are not sent to other clients
in any form before the reveal, which the test suite asserts. The deadline is a server
timestamp — the visible countdown is a rendering of it, never the source of truth.

**Public vs private.** Matchmade rooms have no host: `hostId` is empty, nobody can start,
configure or rematch them, and the server starts the match itself once the party is seated.
Private rooms keep a party leader who picks settings and presses start. That is a social
role only — the leader's browser has no more authority than anyone else's.

**Realtime.** Socket.IO over WebSockets, with polling fallback for restrictive networks.
Traffic is tiny: queue status, question ids, guesses, locks, deadlines and score deltas.
Reconnection is automatic, and a returning player reclaims their seat and score by client
id. A public match that drops below its minimum player count for 25 seconds ends honestly
with "your opponent left" rather than stranding anyone.

**Identity.** No accounts. A random client id in `sessionStorage` identifies you for as
long as the tab lives; your display name and colour persist in `localStorage`. Duplicate
display names are disambiguated for display only ("Ada", "Ada 2") and never affect internal
identity.

**Persistence.** None on the server, by design — a party game room is worthless once
everyone has gone home. Personal bests and settings live in your browser. Swapping rooms
for a shared store later touches one file, `apps/server/src/rooms.ts`.

---

## Environment configuration

Every value has a working default. Copy `.env.example` to `.env` only if you want to
override something locally; in production, set these in your host's dashboard.

| Variable | Where | Default | What it does |
| --- | --- | --- | --- |
| `TRIVIA_PORT` | Server | `3001` | Port to listen on. Wins over `PORT` so a launcher's ambient `PORT` cannot collide with the web dev server. |
| `PORT` | Server | — | Used if `TRIVIA_PORT` is unset. Hosts that inject this (Render, Railway, Fly) work unchanged. |
| `NODE_ENV` | Server | `development` | `production` serves the built client from the game server. The npm scripts set it. |
| `ALLOWED_ORIGINS` | Server | unset | Comma-separated origins allowed to open a socket. Only needed for a **split** deployment. Unset means any origin, which is safe here (no cookies, no credentials, no accounts) but worth setting in production. |
| `VITE_SERVER_URL` | Client | empty | Where the browser opens its socket. Empty = same origin, correct for local dev and single-process production. Set it **only** for a split deployment. |

There are no secrets, no API keys and no database credentials. Nothing sensitive should
ever end up in this file.

---

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full handoff: recommended free stack,
accounts to create, exact steps, free-tier limits and how to avoid surprise billing.

Short version: the whole game is one Node process that serves its own client, so any host
that runs Node and keeps a WebSocket open will do. The recommended $0 option is
**Render's free web service**, with the honest caveat that free instances sleep after 15
minutes of inactivity.

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

**"Port 3001 is already in use"** — Trivia Night is probably already running; check your
browser and other windows. Otherwise close whatever is using the port, or set
`TRIVIA_PORT=3002` before launching.

**The launcher closes instantly** — Node is not installed or not on your PATH. Install the
LTS build from [nodejs.org](https://nodejs.org) and try again.

**"Matchmaking is unavailable"** — the client cannot reach the server. In dev, check that
`npm run dev` is running both processes. In production, the backend may be waking from
sleep (see DEPLOYMENT.md); wait ~50 seconds and retry.

**Quick Match never finds anyone** — Quick 1v1 needs one other real person searching at the
same time, and FFA wants up to four. There are no bots. To test alone, open a second
browser tab and queue in both.

**Two tabs act like the same player** — they shouldn't; identity is per-tab. If it happens,
one tab is probably a duplicate of the other (`Ctrl`+`K`-style tab duplication copies
`sessionStorage`). Open a genuinely new tab instead.

**Changes to questions don't show up** — the launcher runs a production build. Either
relaunch, or use `npm run dev` while editing content.

**Tests time out** — the multiplayer suite starts real servers and plays real rounds; the
full run takes about 90 seconds. That is expected.

---

## Project layout

```
packages/
  shared/     Types, scoring, number parsing, difficulty curves, wire protocol
  content/    The question bank, its validator, and the pool selector
apps/
  server/     Express + Socket.IO. Authoritative for matchmaking and every room.
  web/        Vite + React client
scripts/
  launch.mjs  The one-click launcher
```

Workspace packages are consumed straight from TypeScript source — Vite aliases them and the
server runs under `tsx` — so there is no build step between editing shared code and seeing
it work.

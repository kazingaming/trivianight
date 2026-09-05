# Deploying Trivia Night

The whole game — client, API, matchmaking and live multiplayer — deploys as a
**single Cloudflare Worker**. Read "Surprise-billing protection" before you add a
payment method anywhere.

---

## The stack

```
Frontend:     Workers Static Assets (the built client, served from the edge)
Backend:      Cloudflare Workers
Realtime:     WebSockets terminated by Durable Objects
Matchmaking:  MatchmakerDO — one global Durable Object holding the queues
Game rooms:   RoomDO — one Durable Object per match, authoritative
Persistence:  none beyond each room's own lifetime
```

**Initial expected cost: $0/month** on the Workers Free plan.

There is no server to keep awake, so there are **no cold starts of the kind a
sleeping container has**. A Worker starts in single-digit milliseconds, and a
Durable Object wakes on the first request to it.

---

## Why this shape

Authoritative multiplayer needs one place that owns the truth for a match.
Durable Objects are exactly that primitive: a single-threaded, addressable
object that every player in a room routes to, that can hold WebSockets, and that
exists only while it is needed.

- **One `RoomDO` per room code.** It owns the question, the clock, the guesses
  and the scoreboard. Players connect to it directly, so there is no relay hop
  and no shared-state problem.
- **One global `MatchmakerDO`.** Matchmaking is a rendezvous problem, so a
  single agreed-upon object is the correct answer. Keeping both queues in one
  object is also what makes "a player can only hold one place in one queue"
  true by construction.
- **Static assets from the same Worker.** One origin means no CORS, no second
  provider, and no environment variables to keep in sync.

Rooms hold their live state in memory and are kept alive by their open
WebSockets for exactly as long as a match is being played. Only the room's claim
on its code is persisted, which is what stops two matches being handed the same
code.

---

## Accounts you need

Two, both free, neither needs a card:

1. **GitHub** — to host the code. <https://github.com>
2. **Cloudflare** — to run it. <https://dash.cloudflare.com/sign-up>

No domain, no database, no payment method.

---

## Deployment steps

### 1. Push the repository

The repo is already initialised and committed on `main`. See the README for the
exact push commands.

### 2. Sign in to Cloudflare from your machine

```bash
npx wrangler login
```

This opens a browser, asks you to authorise Wrangler, and stores the credential
in your user profile — **not** in this repository. There is no API token to
paste anywhere.

### 3. Deploy

```bash
npm run deploy
```

That builds the client and runs `wrangler deploy`, which uploads the Worker, the
static assets and the Durable Object migration in one step.

The first deploy asks you to confirm creating a `workers.dev` subdomain. Accept
it. You will get a URL like:

```
https://trivianight.<your-subdomain>.workers.dev
```

That URL is the entire game.

### 4. Test production

- Open the URL; play a Solo round.
- Open it on a **second device or browser**, put both into Quick 1v1, and check
  they match, get the same question, and reveal together.
- Refresh mid-match: you should return to your seat with your score.
- Create a private room on one device and join by code on the other.
- `https://your-url/api/health` should return JSON with live queue counts.

### 5. Redeploying

```bash
npm run deploy
```

There is no automatic deploy on push, deliberately — a single explicit command
is less machinery than a CI pipeline for a project this size. If you want
push-to-deploy later, connect the repo under **Workers & Pages → Create → Connect
to Git** in the Cloudflare dashboard.

---

## Free-tier limits that matter

Cloudflare's free plan, at the time of writing. **Verify the current numbers in
your dashboard** — these move, and I would rather you check than trust a doc.

| Resource | Free allowance | What happens at the edge |
| --- | --- | --- |
| Worker requests | 100,000/day | Further requests are rejected until reset |
| Worker CPU | 10 ms per invocation | Long invocations are terminated |
| Durable Objects | Included on the free plan, **SQLite-backed classes only** | Requests rejected past the allowance |
| DO storage | Small free allowance | This game stores almost nothing |
| Static assets | Unlimited requests, not billed | — |

**What counts as a request here.** Each WebSocket *message* to a Durable Object
counts, as does each HTTP request. A single Quick 1v1 match is on the order of a
few hundred messages across both players for all eight rounds. 100,000
requests/day is therefore roughly **a few hundred full matches a day**, which is
far more than a game with no players yet will see.

**What would stress it first.** Request count, long before CPU or storage. The
game does no heavy computation — scoring is arithmetic — and each room holds a
few kilobytes.

**The one real constraint:** `wrangler.toml` uses `new_sqlite_classes` for the
Durable Object migration. That is the class of Durable Object available on the
free plan. Changing it to `new_classes` would require a paid plan, so do not.

---

## Surprise-billing protection

**The Workers Free plan cannot bill you.** It requires no payment method, and
exceeding a limit returns errors rather than generating charges.

To keep it that way:

1. **Do not add a payment method** to your Cloudflare account unless you intend
   to upgrade.
2. **Do not enable the Workers Paid plan** ($5/month). The dashboard will offer
   it; nothing here needs it.
3. If you ever do add a card, check **Workers & Pages → Plans** and confirm you
   are still on Free.

GitHub is free at this scale with no billing path you can trip over.

---

## Scaling later

Roughly in the order you would hit them:

1. **You pass 100,000 requests/day.** Workers Paid, **$5/month**, which raises
   limits by orders of magnitude. No code changes.
2. **You want a custom domain.** Free with any domain on Cloudflare; add it
   under the Worker's **Settings → Domains & Routes**.
3. **You add accounts and Elo.** That is when you need real storage. Matchmaking
   is already behind a `MatchmakingPolicy` interface, and the ticket type
   already carries optional `rating`, `region` and `ranked` fields that nothing
   reads yet. Durable Objects can hold this themselves, or add D1.
4. **Matchmaking becomes a bottleneck.** A single `MatchmakerDO` is nowhere near
   its ceiling at this scale, but sharding it by mode or region is a small
   change: it is one object with one interface.

---

## What is deliberately not here

No CI pipeline, no containers, no monitoring stack, no analytics. A single
Worker deployed by one command is the right amount of infrastructure for a game
with no players yet, and none of those things need application changes to add.

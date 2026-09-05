# Deploying Trivia Night

Everything you need to put the game online for **$0/month**. Read the whole of
"Surprise-billing protection" before you connect a payment method anywhere.

---

## Recommended stack

```
Frontend:     served by the backend (one Node process, one origin)
Backend:      Render — Free Web Service (Node)
Realtime:     Socket.IO over WebSockets, on that same service
Matchmaking:  in-memory, inside the backend process
Persistence:  none server-side; player settings live in the browser
```

**Initial expected cost: $0/month**, no credit card required.

### The one caveat you must know about

Render's free web services **sleep after 15 minutes with no traffic**, and take roughly
**30–60 seconds to wake up**. The first person to arrive after a quiet spell waits for that
cold start before they can queue.

This is the honest price of a genuinely free, always-available-on-the-internet backend that
holds WebSocket connections. It is not a bug and there is no free way around it on Render —
free instances cannot be kept awake, and pinging them yourself burns the same free hours
and is against the spirit of the tier.

If that becomes unacceptable, the upgrade is **$7/month** for a Render Starter instance,
which never sleeps. Nothing in the code changes. See "Scaling later".

---

## Why this architecture

The game is already **one Node process that serves its own client**. Deploying it is
therefore a single service with a single origin: no CORS, no split configuration, no second
provider, no environment variables required at all.

The alternative worth naming is **Cloudflare Workers + Durable Objects**, which would be
always-warm at $0 and is genuinely well-suited to authoritative game rooms — one Durable
Object per room is almost exactly the shape of the existing `Room` class. It was **not**
chosen because it would require replacing Socket.IO with a hand-rolled WebSocket protocol
on both client and server, and rewriting the runtime, in exchange for removing a cold start
on a game with no players yet. That is a rewrite of working, tested code to solve a problem
you do not have.

The code has been kept portable in case you want that later: the game logic is transport-
agnostic (`Room` takes `broadcast`/`notify` callbacks; `Matchmaker` takes hooks), so a
Durable Objects port would mean writing a new transport, not a new game.

Firebase and Supabase were not chosen because neither gives you an authoritative game loop.
You would end up writing the same server anyway and paying a database to relay messages
between players.

---

## Accounts you need to create

Exactly two, both free, neither needs a card:

1. **GitHub** — to host the code. <https://github.com>
2. **Render** — to run the server. <https://render.com> (sign in with GitHub)

That is the complete list. No domain, no database, no payment method.

---

## Deployment sequence

### 1. Create the GitHub repository

On <https://github.com/new>: name it (e.g. `trivia-night`), choose Public or Private, and
**do not** initialise it with a README, .gitignore or licence — the project already has
them.

### 2. Push the project

The repo is already initialised and committed on `main`. From the project folder:

```bash
git remote add origin https://github.com/YOUR-USERNAME/trivia-night.git
```

```bash
git push -u origin main
```

Git will ask you to sign in; use the browser prompt or a personal access token.

> The commit is currently authored as `Kazin <kazin.gaming.gg@gmail.com>` (set for this
> repository only, not globally). To change it:
> ```bash
> git config user.name "Your Name" && git config user.email "you@example.com" && git commit --amend --reset-author --no-edit
> ```

### 3. Create the Render service

1. Go to <https://dashboard.render.com> and sign in with GitHub.
2. **New → Web Service**, then connect your `trivia-night` repository.
3. Fill in:

| Field | Value |
| --- | --- |
| Name | `trivia-night` (this becomes your URL) |
| Region | whichever is closest to your players |
| Branch | `main` |
| Runtime | **Node** |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Instance Type | **Free** |

4. Under **Environment**, add one variable:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |

That is the only variable required. Render provides `PORT` automatically and the server
reads it.

5. Click **Create Web Service**.

The first build takes a few minutes. When it finishes you get a URL like
`https://trivia-night.onrender.com` — that is the whole game, frontend and multiplayer.

### 4. Test production

Open the URL and check:

- Home screen loads, Solo Gauntlet plays a round.
- Open the URL in a **second device or browser**, put both into Quick 1v1, and confirm they
  match, both see the same question, and the reveal happens together.
- Refresh mid-match and confirm you return to your seat with your score.
- Create a private room on one device and join it by code on the other.

Health check: `https://your-app.onrender.com/api/health` should return JSON with room and
queue counts.

### 5. Redeploying

Push to `main`. Render rebuilds and redeploys automatically.

---

## If you later split frontend and backend

You do not need this, but if you ever want the static site on a CDN (Cloudflare Pages,
Netlify, Vercel) with the backend on Render:

1. Deploy the frontend with build command `npm install && npm run build` and publish
   directory `apps/web/dist`.
2. Set `VITE_SERVER_URL=https://your-backend.onrender.com` in the **frontend's** build
   environment.
3. Set `ALLOWED_ORIGINS=https://your-frontend-domain` in the **backend's** environment.

Both variables exist and are wired up; nothing needs code changes.

---

## Free-tier limits that matter

**Render Free Web Service**

| Limit | Value | What happens at the edge |
| --- | --- | --- |
| Instance hours | 750/month across all free services | Service is suspended until the next month |
| Sleep | After 15 min of no traffic | 30–60s cold start on the next request |
| RAM | 512 MB | Process restarts if exceeded |
| CPU | 0.1 shared | Slower under load; no charge |
| Bandwidth | 100 GB/month | Throttled, not billed |
| Build minutes | 500/month | Builds queue until next month |

750 hours is just over a full month for **one** service, so a single free web service can
in principle run continuously — but it will still sleep when idle regardless.

**What would actually stress this**

The game sends tiny messages: a few hundred bytes per player per round. Realistically:

- **RAM** is the first thing you would hit, and it is generous — rooms are small objects
  and there is no database. Hundreds of concurrent matches would fit.
- **Bandwidth** at ~50 KB per player per full match means 100 GB is roughly two million
  matches a month. You will not reach it.
- **Cold starts** are what people will actually notice, from day one, at zero traffic.

In other words: the free tier is limited by *responsiveness*, not by capacity. You are far
more likely to want to escape the sleep than to run out of anything.

---

## Surprise-billing protection

**Render's free tier cannot bill you.** It requires no payment method, and when you exceed
a limit the service is suspended or throttled — never charged. If you never add a card,
there is no path to a bill.

To keep it that way:

1. **Do not add a payment method** to your Render account unless you intend to upgrade.
2. **Do not upgrade the instance type** from Free. The dashboard will offer this.
3. If you do add a card later, check **Account Settings → Billing** and confirm no other
   services are running on paid plans.

GitHub is free for public and private repositories at this scale and has no billing path
you can trip over by accident.

**Do not** enable any provider's "auto-scale", "usage-based pricing" or "spend and grow"
options. Nothing in this project needs them.

---

## Scaling later

Roughly in the order you would hit them:

1. **Cold starts annoy you.** Render Starter, **$7/month**. No code changes, no sleep.
2. **You want it fast worldwide.** Put Cloudflare (free) in front for static assets, or
   move the frontend to Cloudflare Pages and keep the backend on Render — see the split
   section above.
3. **One process is not enough.** Today all rooms live in one process's memory, which is
   correct and simple for this scale. Going multi-instance needs either sticky sessions
   plus a shared matchmaking queue (Redis), or the Durable Objects port described above.
   Both are real work; neither is needed below roughly a thousand concurrent players.
4. **You add accounts and Elo.** That is when you need a real database. Matchmaking is
   already behind a policy interface for exactly this, and the ticket type already carries
   optional `rating`, `region` and `ranked` fields that nothing reads yet.

---

## What is deliberately not here

No CI pipeline, no containers, no monitoring stack, no analytics. A single Node service
that rebuilds on push is the right amount of infrastructure for a game with no players yet,
and every one of those things can be added later without changing the application.

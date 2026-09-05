/**
 * Bindings declared in wrangler.toml.
 *
 * Hand-written rather than generated so the shape is reviewable in the repo
 * and `npm install` is all that is needed before a typecheck.
 */
declare interface Env {
  /** One instance per room code. */
  ROOM: DurableObjectNamespace;
  /** A single global instance holding the public queues. */
  MATCHMAKER: DurableObjectNamespace;
  /** One instance per signed-in account. */
  USER: DurableObjectNamespace;
  /** The built client, served from the edge. */
  ASSETS: Fetcher;

  /*
   * Optional accounts. Absent means sign-in is simply not offered — the game
   * is fully playable either way. See src/auth.ts and .dev.vars.example.
   */
  /** Google OAuth client id. Public by design; safe as a plain var. */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client secret. Set with `wrangler secret put`. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Random string used to sign session cookies. Also a secret. */
  SESSION_SECRET?: string;
}

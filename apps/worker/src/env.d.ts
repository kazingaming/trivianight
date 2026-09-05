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
  /** The built client, served from the edge. */
  ASSETS: Fetcher;
}

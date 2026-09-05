/**
 * The game engine.
 *
 * Pure TypeScript with no runtime dependencies: no Node, no Cloudflare, no
 * transport. A host supplies callbacks for broadcasting and scheduling, which
 * is what lets the same logic run inside a Durable Object in production and
 * inside the test harness unchanged.
 */
export * from './room.js';
export * from './matchmaking.js';

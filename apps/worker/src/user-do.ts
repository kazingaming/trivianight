/**
 * One Durable Object per signed-in player.
 *
 * Addressed by `google:<subject id>`, so a returning player lands on their own
 * object with no lookup and no shared table to contend on. It holds two small
 * records — who you are, and your best runs — and nothing else. There is
 * deliberately no email, no history and no per-match log: none of it would
 * make the game better, and all of it would be something to lose.
 */

import { sanitizeName } from '@trivia/shared';

import { errorResponse, jsonResponse } from './ws.js';
import { MAX_AVATAR_BYTES, validAvatar } from './auth.js';
import { roomError } from '@trivia/shared';

export interface Profile {
  /** Opaque, stable, and never shown: the Durable Object's own name. */
  id: string;
  /** What other players would see. Chosen by the player. */
  username: string;
  /** A small data URL, or null for the initials avatar. */
  avatar: string | null;
  /** Palette index, matching the guest identity colours. */
  color: number;
  createdAt: number;
  updatedAt: number;
}

export interface Records {
  soloScore: number;
  soloRounds: number;
  soloStreak: number;
  /** When the best score was set. */
  at: number;
}

const EMPTY_RECORDS: Records = { soloScore: 0, soloRounds: 0, soloStreak: 0, at: 0 };

export class UserDO {
  private profile: Profile | null = null;
  private records: Records = { ...EMPTY_RECORDS };
  private loaded = false;

  constructor(private readonly state: DurableObjectState) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.profile = (await this.state.storage.get<Profile>('profile')) ?? null;
    this.records = (await this.state.storage.get<Records>('records')) ?? { ...EMPTY_RECORDS };
    this.loaded = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/ensure':
        return this.ensure(request);
      case '/profile':
        return request.method === 'PATCH' ? this.patch(request) : this.read();
      case '/score':
        return this.score(request);
      default:
        return errorResponse(404, roomError('BAD_REQUEST', 'Unknown account endpoint.'));
    }
  }

  private read(): Response {
    if (!this.profile) return errorResponse(404, roomError('BAD_REQUEST', 'No such account.'));
    return jsonResponse({ profile: this.profile, records: this.records });
  }

  /**
   * Called on every sign-in.
   *
   * First time through this creates the profile from what Google supplied.
   * After that it leaves it alone: a player who has chosen a username and a
   * picture should not have them quietly reset because they signed in again.
   */
  private async ensure(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as {
      id?: string;
      name?: string;
      avatar?: string | null;
    } | null;

    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return errorResponse(400, roomError('BAD_REQUEST'));

    if (!this.profile) {
      const now = Date.now();
      this.profile = {
        id,
        username: sanitizeName(body?.name ?? '') || 'Player',
        avatar: validAvatar(body?.avatar),
        // Stable per account rather than random, so the colour is "yours".
        color: colorFor(id),
        createdAt: now,
        updatedAt: now,
      };
      await this.state.storage.put('profile', this.profile);
    }

    return jsonResponse({ profile: this.profile, records: this.records });
  }

  private async patch(request: Request): Promise<Response> {
    if (!this.profile) return errorResponse(404, roomError('BAD_REQUEST', 'No such account.'));

    const body = (await request.json().catch(() => null)) as {
      username?: unknown;
      avatar?: unknown;
      color?: unknown;
    } | null;
    if (!body) return errorResponse(400, roomError('BAD_REQUEST'));

    if (body.username !== undefined) {
      const username = sanitizeName(String(body.username));
      if (username.length < 2) {
        return errorResponse(400, roomError('BAD_REQUEST', 'Names need at least two characters.'));
      }
      this.profile.username = username;
    }

    if (body.avatar !== undefined) {
      if (body.avatar === null) {
        this.profile.avatar = null;
      } else {
        const avatar = validAvatar(body.avatar);
        if (!avatar) {
          return errorResponse(
            400,
            roomError(
              'BAD_REQUEST',
              `Pictures must be PNG, JPEG or WebP and under ${Math.round(MAX_AVATAR_BYTES / 1000)} KB once encoded.`,
            ),
          );
        }
        this.profile.avatar = avatar;
      }
    }

    if (typeof body.color === 'number' && Number.isInteger(body.color)) {
      this.profile.color = Math.abs(body.color) % 8;
    }

    this.profile.updatedAt = Date.now();
    await this.state.storage.put('profile', this.profile);
    return jsonResponse({ profile: this.profile, records: this.records });
  }

  /**
   * Merge a run into the stored bests.
   *
   * Each record improves on its own — a short run can still set a streak best
   * — and nothing ever goes down. That also makes the endpoint idempotent, so
   * a client that retries after a dropped connection cannot corrupt anything.
   */
  private async score(request: Request): Promise<Response> {
    if (!this.profile) return errorResponse(404, roomError('BAD_REQUEST', 'No such account.'));

    const body = (await request.json().catch(() => null)) as {
      score?: unknown;
      rounds?: unknown;
      streak?: unknown;
    } | null;

    const run = {
      score: positiveInt(body?.score),
      rounds: positiveInt(body?.rounds),
      streak: positiveInt(body?.streak),
    };

    const improved = run.score > this.records.soloScore;
    this.records = {
      soloScore: Math.max(this.records.soloScore, run.score),
      soloRounds: Math.max(this.records.soloRounds, run.rounds),
      soloStreak: Math.max(this.records.soloStreak, run.streak),
      at: improved ? Date.now() : this.records.at,
    };
    await this.state.storage.put('records', this.records);

    return jsonResponse({ profile: this.profile, records: this.records, improved });
  }
}

/** A stable palette slot from the account id. */
function colorFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 8;
}

function positiveInt(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  // A guard, not a game rule: a plausible ceiling stops a bad client writing
  // an absurd number into a record that never goes back down.
  return Math.min(Math.floor(number), 10_000_000);
}

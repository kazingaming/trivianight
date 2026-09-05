/**
 * Optional accounts, on the client.
 *
 * The rule this file exists to keep: nothing here may ever block play. The
 * store starts as a guest, asks the server once whether accounts are even
 * offered, and if anything fails it stays a guest and says nothing. Every
 * screen reads it, no screen waits for it.
 */

import { create } from 'zustand';

import { loadSoloRecord, saveSoloRecord, type SoloRecord } from '../lib/storage.js';

export interface Profile {
  id: string;
  username: string;
  avatar: string | null;
  color: number;
  createdAt: number;
  updatedAt: number;
}

export interface Records {
  soloScore: number;
  soloRounds: number;
  soloStreak: number;
  at: number;
}

export interface AuthConfig {
  /** Whether to offer signing in at all. */
  available: boolean;
  google: boolean;
  /** The loopback-only test sign-in. Never true on a deployed Worker. */
  devLogin: boolean;
}

type Status = 'unknown' | 'guest' | 'signed-in';

interface AccountState {
  status: Status;
  config: AuthConfig;
  profile: Profile | null;
  records: Records | null;
  /** Set by a failed sign-in redirect, shown once on the account screen. */
  notice: string | null;
  busy: boolean;

  /** Ask the server who we are. Safe to call repeatedly. */
  refresh: () => Promise<void>;
  signInWithGoogle: (next?: string) => void;
  devSignIn: () => Promise<void>;
  signOut: () => Promise<void>;
  saveProfile: (patch: { username?: string; avatar?: string | null }) => Promise<string | null>;
  /** Push a finished solo run at the account. Never throws, never blocks. */
  reportSoloRun: (run: { score: number; rounds: number; streak: number }) => Promise<void>;
  setNotice: (notice: string | null) => void;
}

const IDLE_CONFIG: AuthConfig = { available: false, google: false, devLogin: false };

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { credentials: 'include' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function sendJson<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;
    if (!response.ok) {
      return { ok: false, message: payload?.error?.message ?? 'That did not work. Try again.' };
    }
    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, message: 'Could not reach the server.' };
  }
}

export const useAccount = create<AccountState>((set, get) => ({
  status: 'unknown',
  config: IDLE_CONFIG,
  profile: null,
  records: null,
  notice: null,
  busy: false,

  refresh: async () => {
    const config = (await getJson<AuthConfig>('/api/auth/config')) ?? IDLE_CONFIG;
    set({ config });
    if (!config.available) {
      set({ status: 'guest', profile: null, records: null });
      return;
    }

    const me = await getJson<{ signedIn: boolean; profile?: Profile; records?: Records }>(
      '/api/auth/me',
    );
    if (!me?.signedIn || !me.profile) {
      set({ status: 'guest', profile: null, records: null });
      return;
    }

    set({ status: 'signed-in', profile: me.profile, records: me.records ?? null });
    void reconcileRecords(me.records ?? null);
  },

  signInWithGoogle: (next = '/account') => {
    window.location.href = `/api/auth/google/start?next=${encodeURIComponent(next)}`;
  },

  devSignIn: async () => {
    set({ busy: true });
    const result = await sendJson<{ ok: boolean }>('/api/auth/dev-login', 'POST');
    set({ busy: false, notice: result.ok ? null : result.message });
    if (result.ok) await get().refresh();
  },

  signOut: async () => {
    set({ busy: true });
    await sendJson('/api/auth/logout', 'POST');
    set({ busy: false, status: 'guest', profile: null, records: null });
  },

  saveProfile: async (patch) => {
    set({ busy: true });
    const result = await sendJson<{ profile: Profile; records: Records }>(
      '/api/account/profile',
      'PATCH',
      patch,
    );
    set({ busy: false });
    if (!result.ok) return result.message;
    set({ profile: result.data.profile, records: result.data.records });
    return null;
  },

  reportSoloRun: async (run) => {
    if (get().status !== 'signed-in') return;
    const result = await sendJson<{ records: Records }>('/api/account/score', 'POST', run);
    if (result.ok) set({ records: result.data.records });
  },

  setNotice: (notice) => set({ notice }),
}));

/**
 * Bring the two copies of a personal best into line.
 *
 * A player has usually played as a guest before signing in, so the device may
 * hold the better run. Both sides take the maximum, and neither ever loses a
 * record — which is the only behaviour that is not upsetting.
 */
async function reconcileRecords(remote: Records | null): Promise<void> {
  const local = loadSoloRecord();
  if (remote) {
    const merged: Omit<SoloRecord, 'at'> = {
      score: Math.max(local.score, remote.soloScore),
      rounds: Math.max(local.rounds, remote.soloRounds),
      streak: Math.max(local.streak, remote.soloStreak),
    };
    saveSoloRecord(merged);
  }

  const better =
    !remote ||
    local.score > remote.soloScore ||
    local.rounds > remote.soloRounds ||
    local.streak > remote.soloStreak;
  if (better && (local.score > 0 || local.rounds > 0 || local.streak > 0)) {
    await useAccount.getState().reportSoloRun({
      score: local.score,
      rounds: local.rounds,
      streak: local.streak,
    });
  }
}

/** The best run to show, wherever it was set. */
export function bestSoloScore(): number {
  const local = loadSoloRecord().score;
  const remote = useAccount.getState().records?.soloScore ?? 0;
  return Math.max(local, remote);
}

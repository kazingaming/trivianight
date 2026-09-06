/**
 * Room client.
 *
 * Holds one WebSocket to the room's Durable Object for as long as the player
 * is in that room. The server owns the game; this owns the latest snapshot and
 * enough local echo (what *I* just locked in) to keep the UI responsive.
 */

import { create } from 'zustand';
import {
  type GameMode,
  type Guess,
  type RoomError,
  type RoomSettings,
  type RoomSnapshot,
} from '@trivia/shared';

import { saveLastRoom } from '../lib/storage.js';
import { useSettings } from './settings.js';
import { sfx } from '../lib/audio.js';
import { apiPost, GameConnection, type Ack, type ConnectionStatus } from '../lib/connection.js';

export type { ConnectionStatus };

interface RoomState {
  status: ConnectionStatus;
  snapshot: RoomSnapshot | null;
  /** serverTime - clientTime, so countdowns survive a wrong device clock. */
  clockOffset: number;
  error: RoomError | null;
  /** The code we believe we belong to. */
  joinedCode: string | null;
  /** What this player locked in, echoed locally until the reveal. */
  myGuess: Guess | null;
  myGuessRound: number;
  allLockedRound: number | null;

  /** Ask the server for a fresh private room. */
  createRoom: (mode: GameMode) => Promise<Ack<{ code: string }>>;
  /** Open (or reuse) a connection to a room. */
  joinRoom: (code: string) => Promise<Ack<RoomSnapshot>>;
  leave: () => void;
  startGame: () => Promise<Ack<RoomSnapshot>>;
  rematch: () => Promise<Ack<RoomSnapshot>>;
  submitGuess: (questionId: string, guess: Guess) => Promise<Ack<{ locked: true }>>;
  markReady: () => void;
  updateSettings: (patch: Partial<RoomSettings>) => Promise<Ack<RoomSnapshot>>;
  rename: (name: string) => void;
  clearError: () => void;
}

let connection: GameConnection | null = null;
/**
 * What the host last asked for, so a reconnect can restate it.
 *
 * The room is authoritative, but a settings change that was in flight when the
 * socket dropped would otherwise be lost without anyone noticing.
 */
let desiredSettings: Partial<RoomSettings> = {};

function disconnect(): void {
  connection?.close();
  connection = null;
  desiredSettings = {};
}

export const useRoom = create<RoomState>((set, get) => ({
  status: 'idle',
  snapshot: null,
  clockOffset: 0,
  error: null,
  joinedCode: null,
  myGuess: null,
  myGuessRound: -1,
  allLockedRound: null,

  createRoom: async (mode) => {
    const result = await apiPost<{ code: string }>('/api/rooms', { mode });
    if (!result.ok) set({ error: result.error });
    return result;
  },

  joinRoom: (code) => {
    const { identity } = useSettings.getState();
    const params = {
      clientId: identity.clientId,
      name: identity.name || 'Player',
      color: identity.color,
    };

    // Already connected to this room: nothing to do.
    if (connection && get().joinedCode === code && get().status === 'connected') {
      const snapshot = get().snapshot;
      if (snapshot) return Promise.resolve({ ok: true, data: snapshot });
    }

    disconnect();
    set({ joinedCode: code, snapshot: null, error: null, myGuess: null, allLockedRound: null });

    connection = new GameConnection({
      path: `/ws/room/${code}`,
      params,
      onStatus: (status) => set({ status }),
      onOpen: () => {
        // Restate anything the host chose that a dropped socket may have eaten.
        const snapshot = get().snapshot;
        const stillMine = snapshot?.phase === 'lobby' || snapshot?.phase === 'final';
        if (stillMine && Object.keys(desiredSettings).length > 0) {
          connection?.send('room:settings', desiredSettings);
        }
      },
    });

    connection.on('room:state', (data) => {
      const snapshot = data as RoomSnapshot;
      const previous = get().snapshot;
      const roundChanged = previous?.round !== snapshot.round || previous?.phase !== snapshot.phase;

      const patch: Partial<RoomState> = {
        snapshot,
        clockOffset: snapshot.serverTime - Date.now(),
        joinedCode: snapshot.code,
      };
      // Clear the local echo when a new question opens.
      if (snapshot.phase === 'question' && roundChanged) {
        patch.myGuess = null;
        patch.myGuessRound = -1;
        patch.allLockedRound = null;
      }
      set(patch);
      announce(previous, snapshot);
    });

    connection.on('round:allLocked', (data) => {
      set({ allLockedRound: (data as { round: number }).round });
    });

    connection.on('room:closed', (data) => {
      const reason = (data as { reason?: string }).reason;
      set({
        snapshot: null,
        joinedCode: null,
        error: { code: 'ROOM_CLOSED', message: reason || 'The room closed.' },
      });
      disconnect();
    });

    connection.connect();
    saveLastRoom(code);

    /*
     * The room pushes its state as soon as it accepts the socket, so "joined"
     * means "the first snapshot arrived". A rejected upgrade closes the socket
     * instead, which surfaces as a failed connection.
     */
    return new Promise<Ack<RoomSnapshot>>((resolve) => {
      let settled = false;
      const finish = (result: Ack<RoomSnapshot>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stop();
        resolve(result);
      };

      const stop = connection!.on('room:state', (data) => {
        finish({ ok: true, data: data as RoomSnapshot });
      });

      const timer = setTimeout(() => {
        const error: RoomError = {
          code: 'ROOM_NOT_FOUND',
          message: 'That room is not available.',
        };
        set({ error, joinedCode: null });
        finish({ ok: false, error });
      }, 9000);
    });
  },

  leave: () => {
    connection?.send('room:leave');
    disconnect();
    set({
      snapshot: null,
      joinedCode: null,
      myGuess: null,
      allLockedRound: null,
      error: null,
      status: 'idle',
    });
  },

  startGame: () => request<RoomSnapshot>('game:start'),
  rematch: () => request<RoomSnapshot>('game:rematch'),

  submitGuess: async (questionId, guess) => {
    const round = get().snapshot?.round ?? -1;
    // Echo immediately: the player should see "Locked in" without a round trip.
    set({ myGuess: guess, myGuessRound: round });

    const result = await connection?.request<{ locked: true }>('round:guess', {
      questionId,
      guess,
    });
    if (!result) {
      set({ myGuess: null, myGuessRound: -1 });
      return { ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'You are not in a room.' } };
    }

    if (!result.ok) {
      set({ myGuess: null, myGuessRound: -1 });
      // If the round has already moved on, the refusal is expected and the
      // player has nothing to act on. Shouting "Too late" at someone whose
      // screen has already changed only reads as a fault.
      const current = get().snapshot;
      const movedOn = !current || current.round !== round || current.phase !== 'question';
      if (!movedOn) set({ error: result.error });
    }
    return result;
  },

  markReady: () => connection?.send('round:ready'),

  /*
   * Acknowledged, not fire-and-forget.
   *
   * This used to be `send()`, which silently does nothing when the socket is
   * mid-reconnect — so on a phone the host's chosen thinking time or round
   * count could vanish with no sign, and the match would quietly run on the
   * mode defaults instead. `desiredSettings` is what the host asked for, and
   * it is re-sent whenever the socket comes back.
   */
  updateSettings: async (patch) => {
    desiredSettings = { ...desiredSettings, ...patch };
    const result = await request<RoomSnapshot>('room:settings', patch);
    if (result.ok) desiredSettings = { ...desiredSettings, ...result.data.settings };
    return result;
  },

  rename: (name) => connection?.send('room:rename', { name }),
  clearError: () => set({ error: null }),
}));

async function request<T>(type: string, data?: unknown): Promise<Ack<T>> {
  if (!connection) {
    return { ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'You are not in a room.' } };
  }
  const result = await connection.request<T>(type, data);
  if (!result.ok) useRoom.setState({ error: result.error });
  return result;
}

/** Small audio cues driven by phase changes rather than by every component. */
function announce(previous: RoomSnapshot | null, next: RoomSnapshot): void {
  if (!previous) return;
  if (previous.phase !== next.phase) {
    if (next.phase === 'reveal') sfx.play('reveal');
    if (next.phase === 'question') sfx.play('advance');
    if (next.phase === 'final') sfx.play('victory');
  }
  if (previous.phase === 'lobby' && next.players.length > previous.players.length) {
    sfx.play('join');
  }
}

/** The current player's seat in the room, if they have one. */
export function useMySeat() {
  const clientId = useSettings((state) => state.identity.clientId);
  const players = useRoom((state) => state.snapshot?.players);
  return players?.find((player) => player.id === clientId) ?? null;
}

export function useIsHost(): boolean {
  const clientId = useSettings((state) => state.identity.clientId);
  const hostId = useRoom((state) => state.snapshot?.hostId);
  return Boolean(hostId && hostId === clientId);
}

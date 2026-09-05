/**
 * Multiplayer client.
 *
 * The server owns the game; this store owns the socket, the latest snapshot
 * and enough local echo (what *I* just locked in) to keep the UI responsive
 * while the room catches up.
 */

import { create } from 'zustand';
import {
  ERROR_MESSAGES,
  type Ack,
  type ClientToServerEvents,
  type GameMode,
  type Guess,
  type RoomError,
  type RoomSettings,
  type RoomSnapshot,
} from '@trivia/shared';

import { saveLastRoom } from '../lib/storage.js';
import { useSettings } from './settings.js';
import { sfx } from '../lib/audio.js';
import {
  closeSocket,
  getSocket,
  getStatus,
  onStatusChange,
  type ConnectionStatus,
  type GameSocket,
} from '../lib/socket.js';

export type { ConnectionStatus };

interface RoomState {
  socket: GameSocket | null;
  status: ConnectionStatus;
  snapshot: RoomSnapshot | null;
  /** serverTime - clientTime, so countdowns survive a wrong device clock. */
  clockOffset: number;
  error: RoomError | null;
  /** The code we believe we belong to, used to re-join after a reconnect. */
  joinedCode: string | null;
  /** What this player locked in, echoed locally until the reveal. */
  myGuess: Guess | null;
  /** Round the echo belongs to, so it clears on the next question. */
  myGuessRound: number;
  allLockedRound: number | null;

  ensureSocket: () => GameSocket;
  createRoom: (mode: GameMode, settings?: Partial<RoomSettings>) => Promise<Ack<RoomSnapshot>>;
  joinRoom: (code: string) => Promise<Ack<RoomSnapshot>>;
  leave: () => void;
  startGame: () => Promise<Ack<RoomSnapshot>>;
  rematch: () => Promise<Ack<RoomSnapshot>>;
  submitGuess: (questionId: string, guess: Guess) => Promise<Ack<{ locked: true }>>;
  markReady: () => void;
  updateSettings: (patch: Partial<RoomSettings>) => void;
  rename: (name: string) => void;
  clearError: () => void;
  reset: () => void;
}

const TIMEOUT_MS = 8000;

function timeoutError<T>(): Ack<T> {
  return { ok: false, error: { code: 'SERVER_ERROR', message: 'The server did not respond.' } };
}

export const useRoom = create<RoomState>((set, get) => ({
  socket: null,
  status: 'idle',
  snapshot: null,
  clockOffset: 0,
  error: null,
  joinedCode: null,
  myGuess: null,
  myGuessRound: -1,
  allLockedRound: null,

  ensureSocket: () => {
    const existing = get().socket;
    if (existing) return existing;

    const socket = getSocket();
    set({ socket, status: getStatus() });
    onStatusChange((status) => set({ status }));

    socket.on('connect', () => {
      // A reconnect gets a new socket id, so reclaim the seat by client id.
      const { joinedCode } = get();
      if (joinedCode) void get().joinRoom(joinedCode);
    });

    socket.on('room:state', (snapshot) => {
      const previous = get().snapshot;
      const clockOffset = snapshot.serverTime - Date.now();

      // Clear the local echo when a new question opens.
      const roundChanged = previous?.round !== snapshot.round || previous?.phase !== snapshot.phase;
      const patch: Partial<RoomState> = { snapshot, clockOffset, joinedCode: snapshot.code };
      if (snapshot.phase === 'question' && roundChanged) {
        patch.myGuess = null;
        patch.myGuessRound = -1;
        patch.allLockedRound = null;
      }
      set(patch);
      announce(previous, snapshot);
    });

    socket.on('round:allLocked', ({ round }) => {
      set({ allLockedRound: round });
    });

    socket.on('room:error', (error) => set({ error }));

    socket.on('room:closed', ({ reason }) => {
      set({
        snapshot: null,
        joinedCode: null,
        error: { code: 'ROOM_CLOSED', message: reason || ERROR_MESSAGES.ROOM_CLOSED },
      });
    });

    return socket;
  },

  createRoom: (mode, settings) => {
    const socket = get().ensureSocket();
    const { identity } = useSettings.getState();
    return request<RoomSnapshot>(socket, 'room:create', {
      mode,
      settings,
      clientId: identity.clientId,
      name: identity.name || 'Player',
      color: identity.color,
    }).then((result) => {
      if (result.ok) {
        set({ snapshot: result.data, joinedCode: result.data.code, error: null });
        saveLastRoom(result.data.code);
      } else {
        set({ error: result.error });
      }
      return result;
    });
  },

  joinRoom: (code) => {
    const socket = get().ensureSocket();
    const { identity } = useSettings.getState();
    return request<RoomSnapshot>(socket, 'room:join', {
      code,
      clientId: identity.clientId,
      name: identity.name || 'Player',
      color: identity.color,
    }).then((result) => {
      if (result.ok) {
        set({ snapshot: result.data, joinedCode: result.data.code, error: null });
        saveLastRoom(result.data.code);
      } else {
        // A failed re-join means the seat is gone; stop trying to reclaim it.
        set({ error: result.error, joinedCode: null });
      }
      return result;
    });
  },

  leave: () => {
    const { socket } = get();
    socket?.emit('room:leave');
    set({ snapshot: null, joinedCode: null, myGuess: null, allLockedRound: null, error: null });
  },

  startGame: () => {
    const socket = get().ensureSocket();
    return request<RoomSnapshot>(socket, 'game:start', undefined).then(withError(set));
  },

  rematch: () => {
    const socket = get().ensureSocket();
    return request<RoomSnapshot>(socket, 'game:rematch', undefined).then(withError(set));
  },

  submitGuess: (questionId, guess) => {
    const socket = get().ensureSocket();
    const round = get().snapshot?.round ?? -1;
    // Echo immediately: the player should see "Locked in" without a round trip.
    set({ myGuess: guess, myGuessRound: round });
    return request<{ locked: true }>(socket, 'round:guess', { questionId, guess }).then((result) => {
      if (!result.ok) set({ myGuess: null, myGuessRound: -1, error: result.error });
      return result;
    });
  },

  markReady: () => {
    get().socket?.emit('round:ready');
  },

  updateSettings: (patch) => {
    get().socket?.emit('room:settings', patch);
  },

  rename: (name) => {
    get().socket?.emit('room:rename', { name });
  },

  clearError: () => set({ error: null }),

  reset: () => {
    closeSocket();
    set({
      socket: null,
      status: 'idle',
      snapshot: null,
      error: null,
      joinedCode: null,
      myGuess: null,
      myGuessRound: -1,
      allLockedRound: null,
    });
  },
}));

/**
 * Promise wrapper around an acknowledged emit, with a timeout.
 * The response type is given explicitly at each call site — it cannot be
 * inferred from the arguments.
 */
function request<R>(
  socket: GameSocket,
  event: keyof ClientToServerEvents,
  payload: unknown,
): Promise<Ack<R>> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: Ack<R>) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => done(timeoutError<R>()), TIMEOUT_MS);
    const callback = (result: Ack<R>) => {
      clearTimeout(timer);
      done(result ?? timeoutError<R>());
    };

    // Events with no payload still take an acknowledgement callback.
    if (payload === undefined) {
      (socket.emit as (name: string, ack: unknown) => void)(event as string, callback);
    } else {
      (socket.emit as (name: string, data: unknown, ack: unknown) => void)(
        event as string,
        payload,
        callback,
      );
    }
  });
}

function withError(set: (patch: Partial<RoomState>) => void) {
  return (result: Ack<RoomSnapshot>) => {
    if (result.ok) set({ snapshot: result.data, error: null });
    else set({ error: result.error });
    return result;
  };
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

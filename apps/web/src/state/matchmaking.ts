/**
 * Matchmaking client.
 *
 * Owns the queue lifecycle only. The server decides who plays whom; this
 * tracks what to show while waiting, and hands off to the room store the
 * moment a match exists.
 */

import { create } from 'zustand';
import {
  MODES,
  type Ack,
  type MatchFound,
  type QueueMode,
  type QueuePhase,
  type QueueStatus,
  type RoomError,
} from '@trivia/shared';

import { getSocket, getStatus, onStatusChange, type ConnectionStatus } from '../lib/socket.js';
import { useSettings } from './settings.js';
import { sfx } from '../lib/audio.js';

interface MatchmakingState {
  phase: QueuePhase | 'idle';
  mode: QueueMode | null;
  status: QueueStatus | null;
  match: MatchFound | null;
  error: RoomError | null;
  connection: ConnectionStatus;
  /** serverTime - clientTime, so the elapsed timer is honest. */
  clockOffset: number;

  join: (mode: QueueMode) => Promise<Ack<QueueStatus>>;
  cancel: () => void;
  /** Clear a finished/failed search without touching the server. */
  reset: () => void;
}

let wired = false;

/** Attach the queue listeners exactly once, to the app's shared socket. */
function ensureWired(): ReturnType<typeof getSocket> {
  const socket = getSocket();
  if (wired) return socket;
  wired = true;

  socket.on('queue:update', (status) => {
    const state = useMatchmaking.getState();
    // Ignore stray updates for a queue we have already left.
    if (state.phase !== 'searching' || state.mode !== status.mode) return;
    useMatchmaking.setState({
      status,
      clockOffset: status.serverTime - Date.now(),
    });
  });

  socket.on('queue:matched', (match) => {
    sfx.play('join');
    useMatchmaking.setState({ phase: 'matched', match, status: null });
  });

  socket.on('disconnect', () => {
    // The ticket dies with the socket, so the search is genuinely over.
    const state = useMatchmaking.getState();
    if (state.phase === 'searching') {
      useMatchmaking.setState({
        phase: 'failed',
        error: {
          code: 'QUEUE_UNAVAILABLE',
          message: 'Lost contact with the server while searching.',
        },
      });
    }
  });

  onStatusChange((connection) => useMatchmaking.setState({ connection }));
  return socket;
}

export const useMatchmaking = create<MatchmakingState>((set, get) => ({
  phase: 'idle',
  mode: null,
  status: null,
  match: null,
  error: null,
  connection: getStatus(),
  clockOffset: 0,

  join: (mode) => {
    const socket = ensureWired();
    const { identity } = useSettings.getState();

    // Already in a match: there is nothing to search for.
    if (get().phase === 'matched') {
      return Promise.resolve({
        ok: false,
        error: { code: 'GAME_IN_PROGRESS', message: 'You are already in a match.' },
      } satisfies Ack<QueueStatus>);
    }

    set({
      phase: 'searching',
      mode,
      match: null,
      error: null,
      // An optimistic first frame so the UI never flashes empty.
      status: {
        mode,
        phase: 'searching',
        found: 1,
        target: MODES[mode].maxPlayers,
        idealTarget: MODES[mode].maxPlayers,
        searchingSince: Date.now(),
        queueDepth: 1,
        serverTime: Date.now(),
      },
    });

    return new Promise<Ack<QueueStatus>>((resolve) => {
      let settled = false;
      const finish = (result: Ack<QueueStatus>) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: { code: 'QUEUE_UNAVAILABLE', message: 'The server did not respond.' },
          }),
        8000,
      );

      socket.emit('queue:join', { mode, ...identity, name: identity.name || 'Player' }, (result) => {
        clearTimeout(timer);
        if (result?.ok) {
          // Only adopt the server's view if we are still searching for it.
          if (get().phase === 'searching' && get().mode === mode) {
            set({ status: result.data, clockOffset: result.data.serverTime - Date.now() });
          }
        } else if (get().phase !== 'matched') {
          // A rejection that arrives after we were matched is stale noise —
          // the match already happened, and it wins.
          set({ phase: 'failed', error: result?.error ?? null });
        }
        finish(result ?? { ok: false, error: { code: 'SERVER_ERROR', message: 'No response.' } });
      });
    });
  },

  cancel: () => {
    const socket = ensureWired();
    socket.emit('queue:leave');
    set({ phase: 'cancelled', status: null, match: null, error: null });
  },

  reset: () => set({ phase: 'idle', mode: null, status: null, match: null, error: null }),
}));

/**
 * Leaving the queue must survive the tab closing.
 *
 * The server also evicts tickets whose socket has gone, so this is belt and
 * braces — but it makes the queue depth other players see accurate instantly.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const state = useMatchmaking.getState();
    if (state.phase === 'searching') state.cancel();
  });
}

/**
 * Matchmaking client.
 *
 * Holds a WebSocket to the matchmaker Durable Object for exactly as long as
 * the player is searching. Closing it is how you leave the queue — which means
 * a closed tab or a dead network removes the ticket without needing a timeout.
 */

import { create } from 'zustand';
import {
  MODES,
  type MatchFound,
  type QueueMode,
  type QueuePhase,
  type QueueStatus,
  type RoomError,
} from '@trivia/shared';

import { GameConnection, type Ack, type ConnectionStatus } from '../lib/connection.js';
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
  reset: () => void;
}

let connection: GameConnection | null = null;

function disconnect(): void {
  connection?.close();
  connection = null;
}

export const useMatchmaking = create<MatchmakingState>((set, get) => ({
  phase: 'idle',
  mode: null,
  status: null,
  match: null,
  error: null,
  connection: 'idle',
  clockOffset: 0,

  join: (mode) => {
    // Already matched: there is nothing left to search for.
    if (get().phase === 'matched') {
      return Promise.resolve({
        ok: false,
        error: { code: 'GAME_IN_PROGRESS', message: 'You are already in a match.' },
      } satisfies Ack<QueueStatus>);
    }

    const { identity } = useSettings.getState();
    const name = identity.name || 'Player';

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

    // Reuse the socket when re-searching; otherwise open a fresh one.
    if (!connection) {
      connection = new GameConnection({
        path: '/ws/queue',
        params: { clientId: identity.clientId, name, color: identity.color },
        onStatus: (status) => {
          set({ connection: status });
          if (status === 'failed' && get().phase === 'searching') {
            set({
              phase: 'failed',
              error: {
                code: 'QUEUE_UNAVAILABLE',
                message: 'Lost contact with the server while searching.',
              },
            });
          }
        },
        // Re-announce after a reconnect: the old ticket died with the socket.
        onOpen: () => {
          const state = useMatchmaking.getState();
          if (state.phase === 'searching' && state.mode) {
            connection?.send('queue:join', { mode: state.mode, name });
          }
        },
      });

      connection.on('queue:update', (data) => {
        const status = data as QueueStatus;
        const state = useMatchmaking.getState();
        if (state.phase !== 'searching' || state.mode !== status.mode) return;
        set({ status, clockOffset: status.serverTime - Date.now() });
      });

      connection.on('queue:matched', (data) => {
        sfx.play('join');
        set({ phase: 'matched', match: data as MatchFound, status: null });
        // The queue has done its job; the room takes over from here.
        disconnect();
      });

      connection.connect();
    }

    return new Promise<Ack<QueueStatus>>((resolve) => {
      // The socket may still be opening; onOpen re-sends, so a failure here is
      // not fatal and the queue:update stream is the real source of truth.
      const attempt = () => {
        if (!connection) {
          resolve({ ok: false, error: { code: 'QUEUE_UNAVAILABLE', message: 'Not connected.' } });
          return;
        }
        void connection.request<QueueStatus>('queue:join', { mode, name }).then((result) => {
          const state = get();
          if (result.ok) {
            if (state.phase === 'searching' && state.mode === mode) {
              set({ status: result.data, clockOffset: result.data.serverTime - Date.now() });
            }
          } else if (state.phase !== 'matched' && state.phase !== 'searching') {
            set({ phase: 'failed', error: result.error });
          }
          resolve(result);
        });
      };

      if (connection?.state === 'connected') attempt();
      else setTimeout(attempt, 350);
    });
  },

  cancel: () => {
    connection?.send('queue:leave');
    disconnect();
    set({ phase: 'cancelled', status: null, match: null, error: null, connection: 'idle' });
  },

  reset: () => {
    set({ phase: 'idle', mode: null, status: null, match: null, error: null });
  },
}));

/**
 * Leaving the queue must survive the tab closing.
 *
 * Closing the socket is itself the cancel, so this mostly just makes the queue
 * depth other players see accurate a fraction sooner.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (useMatchmaking.getState().phase === 'searching') useMatchmaking.getState().cancel();
  });
}

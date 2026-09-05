import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@trivia/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/**
 * Where the game server lives.
 *
 * Empty means same origin, which covers both local development (Vite proxies
 * /socket.io to the server) and a single-process production deploy (the server
 * serves the built client). Set VITE_SERVER_URL only for a split deployment,
 * where the static site and the backend are on different hosts.
 */
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim();

let socket: GameSocket | null = null;
let status: ConnectionStatus = 'idle';
const listeners = new Set<(next: ConnectionStatus) => void>();

function setStatus(next: ConnectionStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(next);
}

export function getStatus(): ConnectionStatus {
  return status;
}

export function onStatusChange(listener: (next: ConnectionStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The one socket the whole app shares.
 *
 * Rooms and matchmaking are different features but the same connection: a
 * player who is queuing and a player who is mid-match are the same person on
 * the same wire, and the server identifies them by socket.
 */
export function getSocket(): GameSocket {
  if (socket) return socket;

  const options = {
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
    timeout: 8000,
  } as const;

  socket = SERVER_URL ? io(SERVER_URL, options) : io(options);
  setStatus('connecting');

  socket.on('connect', () => setStatus('connected'));
  socket.on('disconnect', (reason) => {
    // An intentional close should not look like a network problem.
    setStatus(reason === 'io client disconnect' ? 'idle' : 'reconnecting');
  });
  socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
  socket.io.on('reconnect_failed', () => setStatus('failed'));

  return socket;
}

export function hasSocket(): boolean {
  return socket !== null;
}

/** Tear the connection down. Used by tests and by a hard reset. */
export function closeSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  setStatus('idle');
}

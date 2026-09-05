/**
 * The WebSocket envelope.
 *
 * Socket.IO gave us request/acknowledgement semantics for free; on Cloudflare
 * Workers there is only a raw WebSocket, so the envelope is explicit. It is
 * deliberately tiny — a trivia match sends a few hundred bytes per player per
 * round, and every byte crosses a metered edge.
 *
 *   client -> server   { i: 7, t: 'round:guess', d: {...} }   request with ack
 *   client -> server   { t: 'round:ready' }                    fire and forget
 *   server -> client   { i: 7, ok: true, d: {...} }            acknowledgement
 *   server -> client   { i: 7, ok: false, e: {...} }           rejection
 *   server -> client   { t: 'room:state', d: {...} }           event
 */

import type { RoomError } from './protocol.js';

/** A message from a client. `i` present means the client expects an answer. */
export interface WireRequest<T = unknown> {
  /** Correlation id. Omitted when no acknowledgement is wanted. */
  i?: number;
  /** Message type. */
  t: string;
  /** Payload. */
  d?: T;
}

/** A reply to a `WireRequest` that carried an `i`. */
export type WireAck<T = unknown> =
  | { i: number; ok: true; d: T }
  | { i: number; ok: false; e: RoomError };

/** An unsolicited message from the server. */
export interface WireEvent<T = unknown> {
  t: string;
  d: T;
}

export type WireInbound<T = unknown> = WireAck<T> | WireEvent<T>;

export function isAck(message: WireInbound): message is WireAck {
  return typeof (message as WireAck).i === 'number' && 'ok' in message;
}

/** Parse a frame, returning null rather than throwing on anything malformed. */
export function parseWire<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  // A single oversized frame should not be able to wedge a room.
  if (raw.length > 64_000) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Connection query parameters.
 *
 * Identity travels in the URL so a Durable Object can seat a player at the
 * moment it accepts the socket, without an extra round trip.
 */
export interface ConnectParams {
  clientId: string;
  name: string;
  color: number;
}

export function buildConnectQuery(params: ConnectParams): string {
  const query = new URLSearchParams();
  query.set('cid', params.clientId);
  query.set('n', params.name);
  query.set('c', String(params.color));
  return query.toString();
}

export function readConnectParams(url: URL): ConnectParams | null {
  const clientId = url.searchParams.get('cid');
  const name = url.searchParams.get('n') ?? '';
  const color = Number(url.searchParams.get('c') ?? 0);
  if (!clientId || clientId.length < 6 || clientId.length > 64) return null;
  return {
    clientId,
    name,
    color: Number.isInteger(color) ? ((color % 8) + 8) % 8 : 0,
  };
}

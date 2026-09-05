/**
 * Room registry.
 *
 * In-memory on purpose: a party game room is worthless once everyone has gone
 * home, and keeping it here means no database to run before you can play.
 * Swapping this for a shared store later only touches this file.
 */

import {
  createRoomCode,
  MODES,
  type GameMode,
  type RoomSettings,
  type RoomVisibility,
} from '@trivia/shared';
import { Room } from './room.js';

/** Rooms nobody has touched for this long are collected. */
const IDLE_TTL_MS = 45 * 60_000;
/** Rooms with nobody in them are collected much faster. */
const EMPTY_TTL_MS = 3 * 60_000;
const SWEEP_INTERVAL_MS = 20_000;
const MAX_ROOMS = 500;

export interface RoomHooks {
  broadcast: (room: Room) => void;
  notify: (room: Room, event: 'allLocked', payload: unknown) => void;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(private readonly hooks: RoomHooks) {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Never hold the process open just to garbage-collect rooms.
    this.sweeper.unref?.();
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  create(
    mode: GameMode,
    hostId: string,
    settings?: Partial<RoomSettings>,
    visibility: RoomVisibility = 'private',
  ): Room | null {
    if (this.rooms.size >= MAX_ROOMS) {
      // Try to make space before refusing.
      this.sweep(true);
      if (this.rooms.size >= MAX_ROOMS) return null;
    }
    const code = this.allocateCode();
    if (!code) return null;
    const room = new Room(
      code,
      mode,
      hostId,
      settings,
      this.hooks.broadcast,
      this.hooks.notify,
      visibility,
    );
    this.rooms.set(code, room);
    return room;
  }

  /** A matchmade room: no host, fixed settings, started by the server. */
  createPublic(mode: GameMode): Room | null {
    return this.create(mode, '', { timer: 'standard' }, 'public');
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
  }

  /** Find whichever room this socket belongs to. */
  findBySocket(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.findBySocket(socketId)) return room;
    }
    return undefined;
  }

  private allocateCode(): string | null {
    for (let attempt = 0; attempt < 50; attempt++) {
      // Widen the code space if short codes keep colliding.
      const length = attempt < 30 ? 4 : 5;
      const code = createRoomCode(length);
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private sweep(aggressive = false): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.sweepDisconnected(now)) room.publish();

      const idleFor = now - room.lastActivity;
      const emptyTtl = aggressive ? 30_000 : EMPTY_TTL_MS;
      const expired =
        (room.isEmpty && idleFor > emptyTtl) ||
        (room.connectedCount === 0 && idleFor > emptyTtl) ||
        idleFor > IDLE_TTL_MS;

      if (expired) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  stats() {
    const byMode: Record<string, number> = {};
    let players = 0;
    for (const room of this.rooms.values()) {
      byMode[room.mode] = (byMode[room.mode] ?? 0) + 1;
      players += room.playerCount;
    }
    return { rooms: this.rooms.size, players, byMode, modes: Object.keys(MODES) };
  }

  dispose(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}

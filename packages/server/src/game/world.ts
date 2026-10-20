// The authoritative world. Everything that "is true" in the game lives here.
//
// The client only sends intents; this class is the only place where state changes.

import { TICK_MS, WORLD_PIXELS, dirFromInput, stepPosition } from '@lumiis/shared';
import type { Direction, PlayerSnapshot } from '@lumiis/shared';

/** Seconds the world advances per tick. */
const TICK_SECONDS = TICK_MS / 1000;

export type Player = {
  id: number;
  name: string;
  /** Position in world pixels, measured at the feet. */
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
};

export class World {
  private readonly playersById = new Map<number, Player>();
  private nextPlayerId = 1;
  private tickCount = 0;

  /** Ticks simulated since the server started. */
  get tick(): number {
    return this.tickCount;
  }

  get playerCount(): number {
    return this.playersById.size;
  }

  addPlayer(name: string): Player {
    const spawn = WORLD_PIXELS / 2;
    const player: Player = {
      id: this.nextPlayerId++,
      name,
      x: spawn,
      y: spawn,
      dir: 0,
      moving: false,
    };
    this.playersById.set(player.id, player);
    return player;
  }

  removePlayer(id: number): boolean {
    return this.playersById.delete(id);
  }

  getPlayer(id: number): Player | undefined {
    return this.playersById.get(id);
  }

  /**
   * Applies a movement intent. The client may send this as often as it likes;
   * only the last one before a tick has any effect.
   */
  setInput(id: number, dx: number, dy: number): void {
    const player = this.playersById.get(id);
    if (player === undefined) return;

    const dir = dirFromInput(dx, dy);
    if (dir === null) {
      player.moving = false;
      return;
    }
    player.dir = dir;
    player.moving = true;
  }

  /**
   * One simulation step. Movement, monsters, combat and physics arrive here in
   * later slices; for now every moving player takes one step.
   */
  step(): void {
    this.tickCount += 1;

    for (const player of this.playersById.values()) {
      if (!player.moving) continue;
      const next = stepPosition(player.x, player.y, player.dir, TICK_SECONDS);
      player.x = next.x;
      player.y = next.y;
    }
  }

  /** Everything a client needs to draw the world right now. */
  snapshot(): PlayerSnapshot[] {
    const players: PlayerSnapshot[] = [];
    for (const player of this.playersById.values()) {
      players.push({
        id: player.id,
        name: player.name,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        dir: player.dir,
        moving: player.moving,
      });
    }
    return players;
  }
}

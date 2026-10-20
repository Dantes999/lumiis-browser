// The authoritative world. Everything that "is true" in the game lives here.
//
// The client only sends intents; this class is the only place where state changes.

import type { PlayerSnapshot } from '@lumiis/shared';

export type Player = {
  id: number;
  name: string;
  x: number;
  y: number;
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

  addPlayer(name: string, x = 0, y = 0): Player {
    const player: Player = { id: this.nextPlayerId++, name, x, y };
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
   * One simulation step. Movement, monsters, combat and physics arrive here in
   * later slices; for now a step only advances time.
   */
  step(): void {
    this.tickCount += 1;
  }

  /** Everything a client needs to draw the world right now. */
  snapshot(): PlayerSnapshot[] {
    const players: PlayerSnapshot[] = [];
    for (const player of this.playersById.values()) {
      players.push({ id: player.id, name: player.name, x: player.x, y: player.y });
    }
    return players;
  }
}

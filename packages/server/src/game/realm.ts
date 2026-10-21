// The realm: one world per map, and the players moving between them.
//
// A player id and a character stay the same for a whole session; only the
// world that holds the player changes when he walks through a portal.

import { encode, type MapData } from '@lumiis/shared';
import type {
  AttackResult,
  Player,
  PlayerSeed,
  Warp,
  World,
  WorldEvent,
} from './world.js';
import type { SkillKey } from '@lumiis/shared';
import { World as WorldClass } from './world.js';

export type JoinSeed = PlayerSeed & { map: string };

export class Realm {
  private readonly worlds = new Map<string, World>();
  private readonly worldIdByPlayer = new Map<number, string>();

  constructor(maps: MapData[]) {
    for (const map of maps) this.worlds.set(map.id, new WorldClass(map));
  }

  get mapIds(): string[] {
    return [...this.worlds.keys()];
  }

  /** The first map; used for logging and by tests. */
  get primary(): World | null {
    return this.worlds.values().next().value ?? null;
  }

  worldOf(playerId: number): World | null {
    const id = this.worldIdByPlayer.get(playerId);
    if (id === undefined) return null;
    return this.worlds.get(id) ?? null;
  }

  worldIdOf(playerId: number): string | null {
    return this.worldIdByPlayer.get(playerId) ?? null;
  }

  join(seed: JoinSeed): Player | null {
    const world = this.worlds.get(seed.map) ?? this.worlds.values().next().value;
    if (world === undefined) return null;

    const player = world.addPlayer(seed);
    this.worldIdByPlayer.set(player.id, world.map.id);
    return player;
  }

  leave(playerId: number): void {
    this.worldOf(playerId)?.removePlayer(playerId);
    this.worldIdByPlayer.delete(playerId);
  }

  /** Steps every world; a world reports the players that walked into a portal. */
  tick(): void {
    for (const world of this.worlds.values()) {
      world.step();
      for (const warp of world.drainWarps()) this.transfer(warp);
    }
  }

  /** One encoded snapshot per world, sent once to everyone standing in it. */
  snapshotJson(): Map<string, string> {
    const encoded = new Map<string, string>();

    for (const [id, world] of this.worlds) {
      const snapshot = world.snapshot();
      encoded.set(
        id,
        encode({
          t: 'snapshot',
          tick: world.tick,
          map: id,
          players: snapshot.players,
          monsters: snapshot.monsters,
          ground: snapshot.ground,
        }),
      );
    }
    return encoded;
  }

  // ------------------------------------------------------------- delegation

  setInput(playerId: number, dx: number, dy: number): void {
    this.worldOf(playerId)?.setInput(playerId, dx, dy);
  }

  useSkill(playerId: number, key: SkillKey): { ok: true } | { ok: false; reason: string } {
    const world = this.worldOf(playerId);
    if (world === null) return { ok: false, reason: 'You are not in the world.' };
    return world.useSkill(playerId, key);
  }

  attack(
    playerId: number,
    targetId: number | null,
    direction: number | null = null,
  ): AttackResult {
    const world = this.worldOf(playerId);
    if (world === null) return { ok: false, reason: 'You are not in the world.' };
    return world.attack(playerId, targetId, direction);
  }

  pickup(
    playerId: number,
    itemId: number,
  ): { ok: true; key: string; count: number } | { ok: false; reason: string } {
    const world = this.worldOf(playerId);
    if (world === null) return { ok: false, reason: 'You are not in the world.' };
    return world.pickup(playerId, itemId) as
      | { ok: true; key: string; count: number }
      | { ok: false; reason: string };
  }

  equip(playerId: number, slot: number): { ok: true } | { ok: false; reason: string } {
    const world = this.worldOf(playerId);
    if (world === null) return { ok: false, reason: 'You are not in the world.' };
    return world.equip(playerId, slot);
  }

  unequip(
    playerId: number,
    piece: 'weapon' | 'armor',
  ): { ok: true } | { ok: false; reason: string } {
    const world = this.worldOf(playerId);
    if (world === null) return { ok: false, reason: 'You are not in the world.' };
    return world.unequip(playerId, piece);
  }

  setPickupSettings(playerId: number, autoPickup: boolean, types: string[]): void {
    this.worldOf(playerId)?.setPickupSettings(playerId, autoPickup, types);
  }

  inventoryOf(playerId: number): ReturnType<World['inventoryOf']> {
    return this.worldOf(playerId)?.inventoryOf(playerId) ?? null;
  }

  equipmentOf(playerId: number): ReturnType<World['equipmentOf']> {
    return this.worldOf(playerId)?.equipmentOf(playerId) ?? null;
  }

  saveOf(playerId: number): ReturnType<World['saveOf']> {
    return this.worldOf(playerId)?.saveOf(playerId) ?? null;
  }

  /** Messages from this tick, for every world. */
  drainEvents(): WorldEvent[] {
    const events: WorldEvent[] = [];
    for (const world of this.worlds.values()) events.push(...world.drainEvents());
    return events;
  }

  drainInventoryUpdates(): ReturnType<World['drainInventoryUpdates']> {
    const updates: ReturnType<World['drainInventoryUpdates']> = [];
    for (const world of this.worlds.values()) updates.push(...world.drainInventoryUpdates());
    return updates;
  }

  // ---------------------------------------------------------------- portals

  private transfer(warp: Warp): void {
    const from = this.worldOf(warp.playerId);
    const to = this.worlds.get(warp.to);
    if (from === null || to === undefined) return;

    const player = from.detachPlayer(warp.playerId);
    if (player === undefined) return;

    player.x = warp.x;
    player.y = warp.y;
    player.moving = false;
    to.attachPlayer(player);
    this.worldIdByPlayer.set(player.id, to.map.id);
  }
}

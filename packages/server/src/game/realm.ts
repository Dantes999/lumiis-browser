// The realm: one world per map, and the players moving between them.
//
// A player id and a character stay the same for a whole session; only the
// world that holds the player changes when he walks through a portal.

import { encode, type MapData } from '@lumiis/shared';
import type {
  AttackResult,
  Player,
  PlayerSeed,
  RewardBroadcast,
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
  /** Warps to a map this realm does not own; the shard host forwards them. */
  private readonly outgoingWarps: Warp[] = [];
  /** Player ids must be unique across maps; the gateway looks players up by id. */
  private nextPlayerId = 1;

  constructor(maps: MapData[]) {
    for (const map of maps) this.worlds.set(map.id, new WorldClass(map));
  }

  /** Players in the world, across every map. */
  playerCount(): number {
    let total = 0;
    for (const world of this.worlds.values()) total += world.playerCount;
    return total;
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

  /** The world of one map, by map id. */
  worldOfMap(map: string): World | null {
    return this.worlds.get(map) ?? null;
  }

  join(seed: JoinSeed, id?: number): Player | null {
    const world = this.worlds.get(seed.map) ?? this.worlds.values().next().value;
    if (world === undefined) return null;

    const player = world.addPlayer(seed, id ?? this.nextPlayerId);
    this.nextPlayerId = Math.max(this.nextPlayerId, player.id + 1);
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

  /**
   * One encoded snapshot per player, already cut to what that player can see.
   * Players in the same cell share the same string.
   */
  snapshotJson(): Map<number, string> {
    const encoded = new Map<number, string>();

    for (const world of this.worlds.values()) {
      for (const [playerId, json] of world.cellSnapshots()) encoded.set(playerId, json);
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

  /** Kill rewards from this tick, tagged with the map they happened on. */
  drainRewards(): Array<{ map: string; reward: RewardBroadcast }> {
    const list: Array<{ map: string; reward: RewardBroadcast }> = [];
    for (const world of this.worlds.values()) {
      for (const reward of world.drainRewards()) list.push({ map: world.map.id, reward });
    }
    return list;
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

  /** Portals that lead into another shard, drained by the worker. */
  drainOutgoingWarps(): Warp[] {
    const list = [...this.outgoingWarps];
    this.outgoingWarps.length = 0;
    return list;
  }

  private transfer(warp: Warp): void {
    const from = this.worldOf(warp.playerId);
    const to = this.worlds.get(warp.to);
    if (from === null) return;
    if (to === undefined) {
      // The map belongs to another shard: hand the player over.
      this.outgoingWarps.push(warp);
      return;
    }

    const player = from.detachPlayer(warp.playerId);
    if (player === undefined) return;

    player.x = warp.x;
    player.y = warp.y;
    player.moving = false;
    to.attachPlayer(player);
    this.worldIdByPlayer.set(player.id, to.map.id);
  }
}

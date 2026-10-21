// The realm: one world per map (or per channel of a map), and the players
// moving between them. A player id and a character stay the same for a whole
// session; only the world that holds the player changes at a portal.

import { channelKeysOf, worldKeyOf, type MapData } from '@lumiis/shared';
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
  /** Worlds by key: the map id, or map#ch2 for a channel. */
  private readonly worlds = new Map<string, World>();
  private readonly maps = new Map<string, MapData>();
  private readonly worldIdByPlayer = new Map<number, string>();
  /** Warps into a world this realm does not own; the shard host forwards them. */
  private readonly outgoingWarps: Warp[] = [];
  /** Player ids must be unique across worlds; the gateway looks players up by id. */
  private nextPlayerId = 1;

  /**
   * Builds the worlds of the given maps. With `only` set, a split map is only
   * built for the channels in that set, so a worker can own single channels.
   */
  constructor(
    maps: MapData[],
    only: ReadonlySet<string> | null = null,
    /** How many copies of each map run side by side (channels). */
    private readonly channels = 1,
  ) {
    this.channels = Math.max(1, channels);

    for (const map of maps) {
      this.maps.set(map.id, map);
      for (let channel = 1; channel <= this.channels; channel += 1) {
        const key = worldKeyOf(map, channel, this.channels);
        if (only !== null && !only.has(key)) continue;
        this.worlds.set(key, new WorldClass(map, key, channel));
      }
    }
  }

  /** The channel of this map with the fewest players. */
  private leastLoaded(map: MapData): World | null {
    let best: World | null = null;
    for (const key of channelKeysOf(map, this.channels)) {
      const world = this.worlds.get(key);
      if (world === undefined) continue;
      if (best === null || world.playerCount < best.playerCount) best = world;
    }
    return best;
  }

  /** Players in the world, across every map. */
  playerCount(): number {
    let total = 0;
    for (const world of this.worlds.values()) total += world.playerCount;
    return total;
  }

  get mapIds(): string[] {
    return [...this.maps.keys()];
  }

  /** The world keys this realm owns (one per map, or per channel). */
  worldKeys(): string[] {
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

  /** One world by its key. */
  world(key: string): World | null {
    return this.worlds.get(key) ?? null;
  }

  /** The first world of a map, by map id. */
  worldOfMap(map: string): World | null {
    for (const world of this.worlds.values()) {
      if (world.map.id === map) return world;
    }
    return null;
  }

  join(seed: JoinSeed, id?: number): Player | null {
    // A deleted map must not lock the character out: use the first map.
    const map = this.maps.get(seed.map) ?? this.maps.values().next().value;
    if (map === undefined) return null;

    const world = this.leastLoaded(map) ?? this.worldOfMap(map.id);
    if (world === null) return null;

    return this.joinIn(world.key, seed, id);
  }

  /** Adds a player to one named world (the host resolved map and channel). */
  joinIn(worldKey: string, seed: PlayerSeed, id?: number): Player | null {
    const world = this.worlds.get(worldKey);
    if (world === undefined) return null;

    const player = world.addPlayer(seed, id ?? this.nextPlayerId);
    this.nextPlayerId = Math.max(this.nextPlayerId, player.id + 1);
    this.worldIdByPlayer.set(player.id, world.key);
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
  snapshotBuffers(): Map<number, Uint8Array> {
    const encoded = new Map<number, Uint8Array>();

    for (const world of this.worlds.values()) {
      for (const [playerId, payload] of world.snapshots()) encoded.set(playerId, payload);
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
  drainRewards(): Array<{ worldId: string; reward: RewardBroadcast }> {
    const list: Array<{ worldId: string; reward: RewardBroadcast }> = [];
    for (const world of this.worlds.values()) {
      for (const reward of world.drainRewards()) list.push({ worldId: world.key, reward });
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
    if (from === null) return;

    // A portal keeps the channel: ch2 stays ch2 on the other map.
    const targetMap = this.maps.get(warp.to);
    if (targetMap === undefined) return;
    const key = worldKeyOf(targetMap, from.channel, this.channels);
    const to = this.worlds.get(key);

    if (to === undefined) {
      // The target world belongs to another shard: hand the player over.
      this.outgoingWarps.push({ ...warp, world: key });
      return;
    }

    const player = from.detachPlayer(warp.playerId);
    if (player === undefined) return;

    player.x = warp.x;
    player.y = warp.y;
    player.moving = false;
    to.attachPlayer(player);
    this.worldIdByPlayer.set(player.id, to.key);
  }
}

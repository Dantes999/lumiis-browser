// The boundary between the network gateway and the game logic.
//
// A "host" owns the worlds. Today it is one Realm in this process; the worker
// host below runs each map group in its own thread. The gateway talks only to
// this interface, so splitting the game across threads changes nothing in it.

import type { Equipment, InventorySlot, SkillKey } from '@lumiis/shared';
import type { Player, PlayerSeed, RewardBroadcast } from '../game/world.js';
import type { Realm } from '../game/realm.js';
import type { Store } from '../store/db.js';

/** What the gateway needs to know about a player that just entered the world. */
export type JoinedPlayer = {
  id: number;
  characterId: number;
  name: string;
  /** Map id, for the client. */
  map: string;
  /** World key: the map id, or map#ch2 for a channel. */
  world: string;
};

export type InventoryUpdate = {
  playerId: number;
  slots: InventorySlot[];
  equipment: Equipment;
};

export type HostNotice = { playerId: number; text: string };

export type RewardEvent = { worldId: string; reward: RewardBroadcast };

/** How busy one game thread is; the local host reports none (see index.ts). */
export type ShardStat = { players: number; tickMs: number; tickMsMax: number };

export type JoinRequest = {
  seed: PlayerSeed;
  map: string;
  characterId: number;
  name: string;
};

export interface GameHost {
  readonly mapIds: string[];

  /** Players in the world, across every map. */
  playerCount(): number;

  /** Puts a player into his map. Null when the map does not exist. */
  join(request: JoinRequest): JoinedPlayer | null;

  /** Saves the player (once) and takes him out of the world. */
  leave(playerId: number): void;

  worldIdOf(playerId: number): string | null;

  /** The current tick of one world, for the welcome message. */
  tickOf(world: string): number;

  setInput(playerId: number, dx: number, dy: number): void;
  attack(playerId: number, targetId: number | null, direction: number | null): void;
  useSkill(playerId: number, key: SkillKey): void;
  pickup(playerId: number, itemId: number): void;
  equip(playerId: number, slot: number): void;
  unequip(playerId: number, piece: 'weapon' | 'armor'): void;
  setPickupSettings(playerId: number, autoPickup: boolean, types: string[]): void;

  inventoryOf(playerId: number): InventorySlot[] | null;
  equipmentOf(playerId: number): Equipment | null;

  /** Steps every world once. The worker host does this inside its threads. */
  tick(): void;

  /** One entry per game thread; empty when everything runs in this process. */
  shardStats(): ShardStat[];

  /** The latest encoded snapshot per player, as UTF-8 bytes. */
  drainSnapshots(): Array<[number, Uint8Array]>;
  drainNotices(): HostNotice[];
  drainRewards(): RewardEvent[];
  drainInventoryUpdates(): InventoryUpdate[];

  /** Writes a slice of the players; spread over ticks, no spikes. */
  saveTick(): void;

  /** Writes everyone and resolves when the store is fully up to date. */
  flush(): Promise<void>;

  /** Stops any worker threads; the local host has nothing to stop. */
  close(): Promise<void>;
}

/** The single-process host: one Realm, all maps, exactly as before. */
export class LocalHost implements GameHost {
  private readonly notices: HostNotice[] = [];
  private readonly characters = new Map<number, number>();
  private saveCursor = 0;

  constructor(
    private readonly realm: Realm,
    private readonly store: Store,
  ) {}

  get mapIds(): string[] {
    return this.realm.mapIds;
  }

  playerCount(): number {
    return this.realm.playerCount();
  }

  join(request: JoinRequest): JoinedPlayer | null {
    const player = this.realm.join({ ...request.seed, map: request.map });
    if (player === null) return null;

    const joined = this.realm.worldOf(player.id);
    this.characters.set(player.id, request.characterId);
    return {
      id: player.id,
      characterId: request.characterId,
      name: player.name,
      map: joined?.map.id ?? request.map,
      world: joined?.key ?? request.map,
    };
  }

  leave(playerId: number): void {
    this.savePlayer(playerId);
    this.realm.leave(playerId);
    this.characters.delete(playerId);
  }

  worldIdOf(playerId: number): string | null {
    return this.realm.worldIdOf(playerId);
  }

  tickOf(world: string): number {
    return this.realm.world(world)?.tick ?? 0;
  }

  setInput(playerId: number, dx: number, dy: number): void {
    this.realm.setInput(playerId, dx, dy);
  }

  attack(playerId: number, targetId: number | null, direction: number | null): void {
    const result = this.realm.attack(playerId, targetId, direction);
    if (!result.ok) this.notices.push({ playerId, text: result.reason });
  }

  useSkill(playerId: number, key: SkillKey): void {
    const result = this.realm.useSkill(playerId, key);
    if (!result.ok) this.notices.push({ playerId, text: result.reason });
  }

  pickup(playerId: number, itemId: number): void {
    const result = this.realm.pickup(playerId, itemId);
    if (!result.ok) this.notices.push({ playerId, text: result.reason });
  }

  equip(playerId: number, slot: number): void {
    const result = this.realm.equip(playerId, slot);
    if (!result.ok) this.notices.push({ playerId, text: result.reason });
  }

  unequip(playerId: number, piece: 'weapon' | 'armor'): void {
    const result = this.realm.unequip(playerId, piece);
    if (!result.ok) this.notices.push({ playerId, text: result.reason });
  }

  setPickupSettings(playerId: number, autoPickup: boolean, types: string[]): void {
    this.realm.setPickupSettings(playerId, autoPickup, types);
  }

  inventoryOf(playerId: number): InventorySlot[] | null {
    return this.realm.inventoryOf(playerId);
  }

  equipmentOf(playerId: number): Equipment | null {
    return this.realm.equipmentOf(playerId);
  }

  tick(): void {
    this.realm.tick();
  }

  shardStats(): ShardStat[] {
    return [];
  }

  drainSnapshots(): Array<[number, Uint8Array]> {
    return [...this.realm.snapshotBuffers()];
  }

  drainNotices(): HostNotice[] {
    const list = [...this.notices];
    this.notices.length = 0;
    return list;
  }

  drainRewards(): RewardEvent[] {
    return this.realm.drainRewards();
  }

  drainInventoryUpdates(): InventoryUpdate[] {
    return this.realm.drainInventoryUpdates().map((update) => ({
      playerId: update.playerId,
      slots: update.slots,
      equipment: this.equipmentOf(update.playerId) ?? { weapon: null, armor: null },
    }));
  }

  saveTick(): void {
    const ids = [...this.characters.keys()];
    if (ids.length === 0) return;

    const limit = Math.max(1, Math.ceil(ids.length / 400));
    for (let index = 0; index < limit; index += 1) {
      const playerId = ids[(this.saveCursor + index) % ids.length];
      if (playerId !== undefined) this.savePlayer(playerId);
    }
    this.saveCursor = (this.saveCursor + limit) % ids.length;
  }

  async flush(): Promise<void> {
    for (const playerId of this.characters.keys()) this.savePlayer(playerId);
  }

  async close(): Promise<void> {
    // Nothing to stop: everything runs in this process.
  }

  private savePlayer(playerId: number): void {
    const characterId = this.characters.get(playerId);
    if (characterId === undefined) return;
    const save = this.realm.saveOf(playerId);
    if (save !== null) this.store.saveCharacter(characterId, save);
  }
}

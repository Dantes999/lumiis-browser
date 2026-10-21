// The multi-process host: each worker thread owns a group of maps.
//
// The main thread keeps the sockets, the accounts and the database. It hands
// player intentions to the worker that owns the map and collects the results.
// Neither side blocks the other: everything is a message.

import { Worker } from 'node:worker_threads';
import {
  spawnPosition,
  worldKeyAt,
  worldKeyOf,
  zonesOf,
  type Direction,
  type Equipment,
  type InventorySlot,
  type MapData,
  type SkillKey,
} from '@lumiis/shared';
import type { CharacterSave, Store } from '../store/db.js';
import type { PlayerSeed } from '../game/world.js';
import type {
  GameHost,
  HostNotice,
  InventoryUpdate,
  JoinedPlayer,
  JoinRequest,
  RewardEvent,
  ShardStat,
} from './host.js';
import type { FromWorker, ToWorker } from './protocol.js';

export class WorkerHost implements GameHost {
  readonly mapIds: string[];

  private readonly workers: Worker[] = [];
  /** World key (map id or map#zone) to the worker that runs it. */
  private readonly worldShard = new Map<string, number>();
  private readonly maps = new Map<string, MapData>();
  private readonly playerShard = new Map<number, number>();
  private readonly playerWorld = new Map<number, string>();
  private readonly characters = new Map<
    number,
    { characterId: number; name: string; accountId: number }
  >();
  private readonly snapshots = new Map<number, Uint8Array>();
  private readonly inventories = new Map<number, { slots: InventorySlot[]; equipment: Equipment }>();
  private readonly worldTicks = new Map<string, number>();
  private readonly notices: HostNotice[] = [];
  private readonly rewards: RewardEvent[] = [];
  private readonly inventoryUpdates: InventoryUpdate[] = [];
  private readonly flushWaiters: Array<() => void> = [];
  /** Saves that arrived since the last tick; written together in one go. */
  private readonly pendingSaves: Array<{ characterId: number; save: CharacterSave }> = [];
  /** Latest tick load per worker, as reported by the worker itself. */
  private readonly stats: ShardStat[] = [];
  private nextPlayerId = 1;
  private pendingFlushes = 0;

  constructor(
    maps: MapData[],
    private readonly store: Store,
    shardCount: number,
  ) {
    this.mapIds = maps.map((map) => map.id);
    for (const map of maps) this.maps.set(map.id, map);

    // Split by world: a map without zones is one world, a split map is one
    // world per zone. Each worker gets a share, plus the map data it needs.
    const worlds: Array<{ key: string; map: MapData }> = [];
    for (const map of maps) {
      for (const zone of zonesOf(map)) worlds.push({ key: worldKeyOf(map, zone), map });
    }

    const groups = Array.from({ length: Math.max(1, shardCount) }, () => ({
      keys: [] as string[],
      maps: new Map<string, MapData>(),
    }));

    worlds.forEach((entry, index) => {
      const group = groups[index % groups.length];
      if (group === undefined) return;
      group.keys.push(entry.key);
      group.maps.set(entry.map.id, entry.map);
    });

    groups.forEach((group) => {
      if (group.keys.length === 0) return;

      const shard = this.workers.length;
      const worker = new Worker(new URL('./worker.js', import.meta.url), {
        workerData: { maps: [...group.maps.values()], keys: group.keys },
      });
      worker.on('message', (message: FromWorker) => this.onMessage(shard, message));
      worker.on('error', (error) => console.error(`[shard ${shard}] worker crashed:`, error));
      this.workers.push(worker);
      console.log(`[shard ${shard}] owns ${group.keys.join(', ')}`);

      for (const key of group.keys) this.worldShard.set(key, shard);
    });
  }

  playerCount(): number {
    return this.playerShard.size;
  }

  join(request: JoinRequest): JoinedPlayer | null {
    const map = this.maps.get(request.map);
    if (map === undefined) return null;

    const spawn = spawnPosition(map);
    const world = worldKeyAt(map, request.seed.x ?? spawn.x, request.seed.y ?? spawn.y);
    const shard = this.worldShard.get(world);
    if (shard === undefined) return null;

    const id = this.nextPlayerId;
    this.nextPlayerId += 1;

    this.playerShard.set(id, shard);
    this.playerWorld.set(id, world);
    this.characters.set(id, {
      characterId: request.characterId,
      name: request.name,
      accountId: request.seed.accountId,
    });

    this.post(shard, {
      t: 'join',
      playerId: id,
      characterId: request.characterId,
      name: request.name,
      world,
      seed: request.seed,
    });

    return {
      id,
      characterId: request.characterId,
      name: request.name,
      map: request.map,
      world,
    };
  }

  leave(playerId: number): void {
    const shard = this.playerShard.get(playerId);
    if (shard !== undefined) this.post(shard, { t: 'leave', playerId });

    this.playerShard.delete(playerId);
    this.playerWorld.delete(playerId);
    this.characters.delete(playerId);
    this.snapshots.delete(playerId);
    this.inventories.delete(playerId);
  }

  worldIdOf(playerId: number): string | null {
    return this.playerWorld.get(playerId) ?? null;
  }

  tickOf(world: string): number {
    return this.worldTicks.get(world) ?? 0;
  }

  setInput(playerId: number, dx: number, dy: number): void {
    this.toPlayer(playerId, { t: 'input', playerId, dx, dy });
  }

  attack(playerId: number, targetId: number | null, direction: number | null): void {
    this.toPlayer(playerId, { t: 'attack', playerId, target: targetId, dir: direction });
  }

  useSkill(playerId: number, key: SkillKey): void {
    this.toPlayer(playerId, { t: 'skill', playerId, key });
  }

  pickup(playerId: number, itemId: number): void {
    this.toPlayer(playerId, { t: 'pickup', playerId, target: itemId });
  }

  equip(playerId: number, slot: number): void {
    this.toPlayer(playerId, { t: 'equip', playerId, slot });
  }

  unequip(playerId: number, piece: 'weapon' | 'armor'): void {
    this.toPlayer(playerId, { t: 'unequip', playerId, piece });
  }

  setPickupSettings(playerId: number, autoPickup: boolean, types: string[]): void {
    this.toPlayer(playerId, { t: 'settings', playerId, autoPickup, types });
  }

  inventoryOf(playerId: number): InventorySlot[] | null {
    return this.inventories.get(playerId)?.slots ?? null;
  }

  equipmentOf(playerId: number): Equipment | null {
    return this.inventories.get(playerId)?.equipment ?? null;
  }

  shardStats(): ShardStat[] {
    return this.stats.filter((stat): stat is ShardStat => stat !== undefined);
  }

  /** The workers run their own loops; the main thread only broadcasts. */
  tick(): void {
    // Nothing to do here.
  }

  drainSnapshots(): Array<[number, Uint8Array]> {
    return [...this.snapshots];
  }

  drainNotices(): HostNotice[] {
    return this.notices.splice(0);
  }

  drainRewards(): RewardEvent[] {
    return this.rewards.splice(0);
  }

  drainInventoryUpdates(): InventoryUpdate[] {
    return this.inventoryUpdates.splice(0);
  }

  /** Writes every save that arrived since the last tick, in one transaction. */
  saveTick(): void {
    if (this.pendingSaves.length > 0) this.store.saveCharacters(this.pendingSaves.splice(0));
  }

  flush(): Promise<void> {
    if (this.workers.length === 0) return Promise.resolve();

    this.pendingFlushes = this.workers.length;
    return new Promise((resolve) => {
      this.flushWaiters.push(resolve);
      for (const worker of this.workers) worker.postMessage({ t: 'flush' } satisfies ToWorker);

      // Never hang a shutdown on a silent worker.
      const timer = setTimeout(() => {
        for (const waiter of this.flushWaiters.splice(0)) waiter();
      }, 5000);
      timer.unref?.();
    });
  }

  async close(): Promise<void> {
    this.saveTick();
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers.length = 0;
  }

  private toPlayer(playerId: number, message: ToWorker): void {
    const shard = this.playerShard.get(playerId);
    if (shard !== undefined) this.post(shard, message);
  }

  private post(shard: number, message: ToWorker): void {
    this.workers[shard]?.postMessage(message);
  }

  private onMessage(shard: number, message: FromWorker): void {
    switch (message.t) {
      case 'stats':
        this.stats[shard] = {
          players: message.players,
          tickMs: message.tickMs,
          tickMsMax: message.tickMsMax,
        };
        return;

      case 'joined':
        this.inventories.set(message.playerId, {
          slots: message.slots,
          equipment: message.equipment,
        });
        this.inventoryUpdates.push({
          playerId: message.playerId,
          slots: message.slots,
          equipment: message.equipment,
        });
        this.worldTicks.set(message.world, message.tick);
        return;

      case 'joinFailed':
        this.notices.push({ playerId: message.playerId, text: 'Your map is not available.' });
        return;

      case 'snapshots':
        for (const [world, tick] of message.ticks) this.worldTicks.set(world, tick);
        for (const [playerId, json] of message.entries) this.snapshots.set(playerId, json);
        return;

      case 'notice':
        this.notices.push({ playerId: message.playerId, text: message.text });
        return;

      case 'inventory':
        this.inventories.set(message.playerId, {
          slots: message.slots,
          equipment: message.equipment,
        });
        this.inventoryUpdates.push({
          playerId: message.playerId,
          slots: message.slots,
          equipment: message.equipment,
        });
        return;

      case 'reward':
        this.rewards.push({ worldId: message.worldId, reward: message.reward });
        return;

      case 'save':
        // Batched: the next tick writes all of them in one transaction.
        this.pendingSaves.push({ characterId: message.characterId, save: message.save });
        return;

      case 'transfer':
        this.handOver(message);
        return;

      case 'flushed':
        // Write what the workers handed over before we let shutdown continue.
        this.saveTick();
        this.pendingFlushes = Math.max(0, this.pendingFlushes - 1);
        if (this.pendingFlushes === 0) {
          for (const waiter of this.flushWaiters.splice(0)) waiter();
        }
        return;
    }
  }

  /** A player walked through a portal into a map of another shard. */
  private handOver(message: Extract<FromWorker, { t: 'transfer' }>): void {
    const target = this.worldShard.get(message.to);
    const stored = this.characters.get(message.playerId);
    if (target === undefined || stored === undefined) return;

    this.playerShard.set(message.playerId, target);
    this.playerWorld.set(message.playerId, message.to);

    const save: CharacterSave = message.save;
    const seed: PlayerSeed = {
      accountId: stored.accountId,
      characterId: message.characterId,
      name: message.name,
      x: save.x,
      y: save.y,
      dir: save.dir as Direction,
      hp: save.hp,
      level: save.level,
      exp: save.exp,
      yang: save.yang,
      inventory: save.inventory,
      equipment: save.equipment,
    };

    this.post(target, {
      t: 'join',
      playerId: message.playerId,
      characterId: message.characterId,
      name: message.name,
      world: message.to,
      seed,
    });
  }
}

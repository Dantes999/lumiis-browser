// The authoritative world. Everything that "is true" in the game lives here.
//
// The client only sends intents; this class is the only place where state changes.

import {
  ATTACK_COOLDOWN_TICKS,
  DROP_PROTECT_TICKS,
  INVENTORY_SLOTS,
  ITEMS,
  MAX_LEVEL,
  MONSTER_ATTACK_COOLDOWN_TICKS,
  MONSTER_ATTACK_RANGE,
  MONSTER_GIVE_UP_FACTOR,
  MONSTER_RESPAWN_TICKS,
  MONSTER_TYPES,
  PICKUP_RANGE,
  PLAYER_DAMAGE,
  PLAYER_MAX_HP,
  PLAYER_REGEN_HP,
  PLAYER_REGEN_TICKS,
  PLAYER_RESPAWN_HP_SHARE,
  PLAYER_RESPAWN_TICKS,
  TICK_MS,
  TILE_SIZE,
  dirFromInput,
  expForNextLevel,
  isItemKey,
  moveWithCollision,
  spawnPosition,
  withinAttackRange,
} from '@lumiis/shared';
import type {
  Direction,
  GroundItemSnapshot,
  InventorySlot,
  ItemKey,
  MapData,
  MonsterKey,
  MonsterSnapshot,
  PlayerSnapshot,
} from '@lumiis/shared';

/** Seconds the world advances per tick. */
const TICK_SECONDS = TICK_MS / 1000;

/** Wander timing, in ticks. */
const WANDER_MIN_TICKS = 20;
const WANDER_MAX_TICKS = 60;
const PAUSE_CHANCE = 0.25;
const PAUSE_MIN_TICKS = 20;
const PAUSE_MAX_TICKS = 50;
/** After bumping into something, a monster waits this long before turning. */
const BLOCKED_PAUSE_TICKS = 5;
/** A chasing monster that cannot get closer for this long loses interest. */
const STUCK_LIMIT_TICKS = 40;

export type Player = {
  id: number;
  name: string;
  /** Position in world pixels, measured at the feet. */
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  hp: number;
  maxHp: number;
  /** 0 while alive, otherwise the tick this player stands up again. */
  deadUntil: number;
  /** Tick of the last accepted hit, for the attack cooldown. */
  lastAttackTick: number;
  level: number;
  /** Experience towards the next level, not total experience. */
  exp: number;
  yang: number;
  inventory: InventorySlot[];
  /** Picks up drops on its own, limited to autoPickupTypes when that is set. */
  autoPickup: boolean;
  autoPickupTypes: Set<ItemKey>;
};

/** An item lying on the ground, waiting to be picked up. */
export type GroundItem = {
  id: number;
  key: ItemKey;
  count: number;
  x: number;
  y: number;
  /** The killer may take it first. */
  ownerId: number | null;
  ownerUntil: number;
};

export type Monster = {
  id: number;
  key: MonsterKey;
  x: number;
  y: number;
  dir: Direction;
  hp: number;
  maxHp: number;
  homeX: number;
  homeY: number;
  speed: number;
  chaseSpeed: number;
  leash: number;
  aggro: number;
  damage: number;
  /** 0 while alive, otherwise the tick this monster returns on. */
  respawnAt: number;
  targetId: number | null;
  lastAttackTick: number;
  stuckTicks: number;
  wanderDir: Direction | null;
  wanderUntil: number;
  /** Damage each player dealt to this monster since it last appeared. */
  damageBy: Map<number, number>;
};

/** What one player earned from a kill. */
export type KillReward = {
  playerId: number;
  exp: number;
  yang: number;
  levelUps: number;
};

export type AttackResult =
  | {
      ok: true;
      damage: number;
      killed: boolean;
      /** Only present when the hit killed the monster; one entry per contributor. */
      rewards?: KillReward[];
    }
  | { ok: false; reason: string };

export class World {
  private readonly playersById = new Map<number, Player>();
  private readonly monstersById = new Map<number, Monster>();
  private readonly groundItems = new Map<number, GroundItem>();
  /** Player ids whose inventory changed since the last tick was reported. */
  private readonly inventoryUpdates = new Set<number>();
  private nextPlayerId = 1;
  private nextMonsterId = 1;
  private nextGroundId = 1;
  private tickCount = 0;
  /** Small deterministic generator: the same map always behaves the same way. */
  private rngState = 0x9e3779b9;

  constructor(readonly map: MapData) {
    this.spawnMonsters();
  }

  /** Ticks simulated since the server started. */
  get tick(): number {
    return this.tickCount;
  }

  get playerCount(): number {
    return this.playersById.size;
  }

  get monsterCount(): number {
    return this.monstersById.size;
  }

  getMonster(id: number): Monster | undefined {
    return this.monstersById.get(id);
  }

  addPlayer(name: string): Player {
    const spawn = spawnPosition(this.map);
    const player: Player = {
      id: this.nextPlayerId++,
      name,
      x: spawn.x,
      y: spawn.y,
      dir: 0,
      moving: false,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      deadUntil: 0,
      lastAttackTick: -ATTACK_COOLDOWN_TICKS,
      level: 1,
      exp: 0,
      yang: 0,
      inventory: new Array<InventorySlot>(INVENTORY_SLOTS).fill(null),
      autoPickup: false,
      autoPickupTypes: new Set<ItemKey>(),
    };
    this.playersById.set(player.id, player);
    return player;
  }

  removePlayer(id: number): boolean {
    for (const monster of this.monstersById.values()) {
      if (monster.targetId === id) monster.targetId = null;
    }
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
    if (player === undefined || player.deadUntil > 0) return;

    const dir = dirFromInput(dx, dy);
    if (dir === null) {
      player.moving = false;
      return;
    }
    player.dir = dir;
    player.moving = true;
  }

  /**
   * One melee hit. Every rule is checked here: the target exists, it is alive,
   * the cooldown has passed and it is actually in reach.
   */
  attack(playerId: number, targetId: number): AttackResult {
    const player = this.playersById.get(playerId);
    if (player === undefined) return { ok: false, reason: 'You are not in the world.' };
    if (player.deadUntil > 0) return { ok: false, reason: 'You are down.' };

    const monster = this.monstersById.get(targetId);
    if (monster === undefined || monster.respawnAt > 0) {
      return { ok: false, reason: 'That monster is gone.' };
    }
    if (this.tickCount - player.lastAttackTick < ATTACK_COOLDOWN_TICKS) {
      return { ok: false, reason: 'Not so fast.' };
    }
    if (!withinAttackRange(player, monster)) {
      return { ok: false, reason: 'Out of reach.' };
    }

    player.lastAttackTick = this.tickCount;
    monster.hp -= PLAYER_DAMAGE;
    monster.damageBy.set(playerId, (monster.damageBy.get(playerId) ?? 0) + PLAYER_DAMAGE);

    if (monster.hp <= 0) {
      monster.hp = 0;
      monster.respawnAt = this.tickCount + MONSTER_RESPAWN_TICKS;
      monster.wanderDir = null;
      monster.targetId = null;
      const rewards = this.rewardKill(monster, player);
      monster.damageBy.clear();
      this.dropLoot(monster, player);
      return { ok: true, damage: PLAYER_DAMAGE, killed: true, rewards };
    }

    return { ok: true, damage: PLAYER_DAMAGE, killed: false };
  }

  /** One simulation step: players, monsters, deaths and respawns. */
  step(): void {
    this.tickCount += 1;

    for (const player of this.playersById.values()) {
      if (player.deadUntil > 0) {
        if (this.tickCount >= player.deadUntil) this.revivePlayer(player);
        continue;
      }

      if (this.tickCount % PLAYER_REGEN_TICKS === 0 && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + PLAYER_REGEN_HP);
      }

      if (!player.moving) continue;

      const next = moveWithCollision(this.map, player.x, player.y, player.dir, TICK_SECONDS);
      player.x = next.x;
      player.y = next.y;
    }

    for (const monster of this.monstersById.values()) {
      if (monster.respawnAt > 0) {
        if (this.tickCount >= monster.respawnAt) this.reviveMonster(monster);
        continue;
      }
      if (this.stepMonsterCombat(monster)) continue;
      this.stepMonsterWander(monster);
    }

    this.collectGroundItems();
  }

  snapshot(): {
    players: PlayerSnapshot[];
    monsters: MonsterSnapshot[];
    ground: GroundItemSnapshot[];
  } {
    const players: PlayerSnapshot[] = [];
    for (const player of this.playersById.values()) {
      players.push({
        id: player.id,
        name: player.name,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        dir: player.dir,
        moving: player.moving,
        hp: player.hp,
        maxHp: player.maxHp,
        level: player.level,
        exp: player.exp,
        yang: player.yang,
      });
    }

    const monsters: MonsterSnapshot[] = [];
    for (const monster of this.monstersById.values()) {
      if (monster.respawnAt > 0) continue;
      monsters.push({
        id: monster.id,
        key: monster.key,
        x: Math.round(monster.x * 10) / 10,
        y: Math.round(monster.y * 10) / 10,
        dir: monster.dir,
        hp: monster.hp,
        maxHp: monster.maxHp,
        moving: monster.wanderDir !== null || monster.targetId !== null,
      });
    }

    return { players, monsters, ground: this.groundSnapshot() };
  }

  private groundSnapshot(): GroundItemSnapshot[] {
    const items: GroundItemSnapshot[] = [];
    for (const item of this.groundItems.values()) {
      items.push({
        id: item.id,
        key: item.key,
        x: Math.round(item.x * 10) / 10,
        y: Math.round(item.y * 10) / 10,
        count: item.count,
      });
    }
    return items;
  }

  /** The inventory of one player, for the first message after the handshake. */
  inventoryOf(playerId: number): InventorySlot[] | null {
    const player = this.playersById.get(playerId);
    return player === undefined ? null : player.inventory;
  }

  /** Inventories that changed during the last tick; clears the list. */
  drainInventoryUpdates(): Array<{ playerId: number; slots: InventorySlot[] }> {
    if (this.inventoryUpdates.size === 0) return [];

    const updates: Array<{ playerId: number; slots: InventorySlot[] }> = [];
    for (const playerId of this.inventoryUpdates) {
      const player = this.playersById.get(playerId);
      if (player !== undefined) updates.push({ playerId, slots: player.inventory });
    }
    this.inventoryUpdates.clear();
    return updates;
  }

  // ------------------------------------------------------------------ players

  private hurtPlayer(player: Player, damage: number): void {
    if (player.deadUntil > 0) return;

    player.hp = Math.max(0, player.hp - damage);
    if (player.hp > 0) return;

    player.deadUntil = this.tickCount + PLAYER_RESPAWN_TICKS;
    player.moving = false;
  }

  private revivePlayer(player: Player): void {
    const spawn = spawnPosition(this.map);
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = Math.max(1, Math.round(player.maxHp * PLAYER_RESPAWN_HP_SHARE));
    player.deadUntil = 0;
    player.moving = false;
    player.lastAttackTick = this.tickCount - ATTACK_COOLDOWN_TICKS;
  }

  /**
   * Experience and Yang for a kill, split by damage dealt.
   *
   * Paying only the last hit would let a passer-by steal a fight he did not
   * fight, so every player who touched the monster gets his share.
   */
  private rewardKill(monster: Monster, killer: Player): KillReward[] {
    const type = MONSTER_TYPES[monster.key];
    const yangTotal =
      type.yangMin + Math.floor(this.random() * (type.yangMax - type.yangMin + 1));

    // Contributors who are still in the world; someone who logged out is gone.
    const shares: Array<{ player: Player; damage: number }> = [];
    for (const [playerId, damage] of monster.damageBy) {
      const player = this.playersById.get(playerId);
      if (player !== undefined && damage > 0) shares.push({ player, damage });
    }
    if (shares.length === 0) shares.push({ player: killer, damage: 1 });

    const totalDamage = shares.reduce((sum, share) => sum + share.damage, 0);

    const rewards: KillReward[] = [];
    let expPaid = 0;
    let yangPaid = 0;

    for (const share of shares) {
      const portion = share.damage / totalDamage;
      const exp = Math.floor(type.exp * portion);
      const yang = Math.floor(yangTotal * portion);

      expPaid += exp;
      yangPaid += yang;
      rewards.push(this.payKill(share.player, exp, yang));
    }

    // Rounding leftovers go to the one who landed the killing blow.
    const killerReward = rewards.find((entry) => entry.playerId === killer.id);
    if (killerReward !== undefined) {
      const restExp = type.exp - expPaid;
      const restYang = yangTotal - yangPaid;
      if (restExp > 0 || restYang > 0) {
        const topUp = this.payKill(killer, restExp, restYang);
        killerReward.exp += topUp.exp;
        killerReward.yang += topUp.yang;
        killerReward.levelUps += topUp.levelUps;
      }
    }

    return rewards;
  }

  // ------------------------------------------------------------------- items

  /** Rolls the loot table of a dead monster and lays it on the ground. */
  private dropLoot(monster: Monster, killer: Player): void {
    for (const drop of MONSTER_TYPES[monster.key].drops) {
      if (this.random() >= drop.chance) continue;
      if (!isItemKey(drop.key)) continue;

      const count = drop.min + Math.floor(this.random() * (drop.max - drop.min + 1));
      const angle = this.random() * Math.PI * 2;
      const radius = 8 + this.random() * 14;

      this.groundItems.set(this.nextGroundId, {
        id: this.nextGroundId,
        key: drop.key,
        count,
        x: monster.x + Math.cos(angle) * radius,
        y: monster.y + Math.sin(angle) * radius,
        ownerId: killer.id,
        ownerUntil: this.tickCount + DROP_PROTECT_TICKS,
      });
      this.nextGroundId += 1;
    }
  }

  /** Everyone standing close enough takes what is free for him. */
  private collectGroundItems(): void {
    if (this.groundItems.size === 0) return;

    for (const player of this.playersById.values()) {
      if (!player.autoPickup || player.deadUntil > 0) continue;

      for (const item of [...this.groundItems.values()]) {
        if (!player.autoPickupTypes.has(item.key)) continue;
        this.tryPickup(player, item);
      }
    }
  }

  /** Takes one specific item; used by the pickup order from the client. */
  pickup(
    playerId: number,
    itemId: number,
  ): { ok: true; key: ItemKey; count: number } | { ok: false; reason: string } {
    const player = this.playersById.get(playerId);
    if (player === undefined) return { ok: false, reason: 'You are not in the world.' };
    if (player.deadUntil > 0) return { ok: false, reason: 'You are down.' };

    const item = this.groundItems.get(itemId);
    if (item === undefined) return { ok: false, reason: 'That item is gone.' };

    const reserved =
      item.ownerId !== null && item.ownerId !== player.id && this.tickCount < item.ownerUntil;
    if (reserved) return { ok: false, reason: 'That is still someone else\'s.' };
    if (Math.hypot(player.x - item.x, player.y - item.y) > PICKUP_RANGE) {
      return { ok: false, reason: 'Too far away.' };
    }
    if (this.freeSpace(player, item.key) < item.count) {
      return { ok: false, reason: 'Your inventory is full.' };
    }

    const key = item.key;
    const count = item.count;
    this.tryPickup(player, item);
    return { ok: true, key, count };
  }

  /** Auto pickup and its item filter, as chosen in the client settings. */
  setPickupSettings(playerId: number, autoPickup: boolean, types: string[]): void {
    const player = this.playersById.get(playerId);
    if (player === undefined) return;

    player.autoPickup = autoPickup;
    player.autoPickupTypes = new Set(types.filter(isItemKey));
  }

  private tryPickup(player: Player, item: GroundItem): boolean {
    if (player.deadUntil > 0) return false;

    const reserved =
      item.ownerId !== null && item.ownerId !== player.id && this.tickCount < item.ownerUntil;
    if (reserved) return false;
    if (Math.hypot(player.x - item.x, player.y - item.y) > PICKUP_RANGE) return false;
    if (!this.addToInventory(player, item.key, item.count)) return false;

    this.groundItems.delete(item.id);
    this.inventoryUpdates.add(player.id);
    return true;
  }

  /** Free room for one item type across all slots. */
  private freeSpace(player: Player, key: ItemKey): number {
    const max = ITEMS[key].stackMax;
    let space = 0;

    for (const slot of player.inventory) {
      if (slot === null) space += max;
      else if (slot.key === key) space += max - slot.count;
    }
    return space;
  }

  /** Stacks first, then fills empty slots. Refuses when it does not all fit. */
  private addToInventory(player: Player, key: ItemKey, count: number): boolean {
    if (this.freeSpace(player, key) < count) return false;

    const max = ITEMS[key].stackMax;
    let left = count;

    for (const slot of player.inventory) {
      if (slot === null || slot.key !== key || slot.count >= max) continue;
      const add = Math.min(max - slot.count, left);
      slot.count += add;
      left -= add;
      if (left === 0) return true;
    }

    for (let index = 0; index < player.inventory.length && left > 0; index += 1) {
      if (player.inventory[index] !== null) continue;
      const add = Math.min(max, left);
      player.inventory[index] = { key, count: add };
      left -= add;
    }
    return left === 0;
  }

  /** Books experience and Yang and resolves any level ups. */
  private payKill(player: Player, exp: number, yang: number): KillReward {
    player.exp += exp;
    player.yang += yang;

    let levelUps = 0;
    while (player.level < MAX_LEVEL && player.exp >= expForNextLevel(player.level)) {
      player.exp -= expForNextLevel(player.level);
      player.level += 1;
      levelUps += 1;
    }

    // Levelling up puts the player back on his feet.
    if (levelUps > 0) player.hp = player.maxHp;

    return { playerId: player.id, exp, yang, levelUps };
  }

  // ----------------------------------------------------------------- monsters

  private spawnMonsters(): void {
    for (const spawn of this.map.spawns) {
      const type = MONSTER_TYPES[spawn.key];
      const x = (spawn.tx + 0.5) * TILE_SIZE;
      const y = (spawn.ty + 0.9) * TILE_SIZE;

      this.monstersById.set(this.nextMonsterId, {
        id: this.nextMonsterId,
        key: spawn.key,
        x,
        y,
        dir: 0,
        hp: type.maxHp,
        maxHp: type.maxHp,
        homeX: x,
        homeY: y,
        speed: type.speed,
        chaseSpeed: type.chaseSpeed,
        leash: type.leash,
        aggro: type.aggro,
        damage: type.damage,
        respawnAt: 0,
        targetId: null,
        lastAttackTick: -MONSTER_ATTACK_COOLDOWN_TICKS,
        stuckTicks: 0,
        wanderDir: null,
        wanderUntil: 0,
        damageBy: new Map(),
      });
      this.nextMonsterId += 1;
    }
  }

  /** Returns true when the monster spent the tick on a target. */
  private stepMonsterCombat(monster: Monster): boolean {
    const target = monster.targetId === null ? undefined : this.playersById.get(monster.targetId);

    if (target !== undefined && target.deadUntil === 0) {
      const distance = Math.hypot(target.x - monster.x, target.y - monster.y);
      const fromHome = Math.hypot(target.x - monster.homeX, target.y - monster.homeY);

      if (distance > monster.aggro * MONSTER_GIVE_UP_FACTOR || fromHome > monster.leash * 3) {
        monster.targetId = null;
        return false;
      }

      if (distance <= MONSTER_ATTACK_RANGE) {
        monster.wanderDir = null;
        monster.dir = dirFromInput(target.x - monster.x, target.y - monster.y) ?? monster.dir;

        if (this.tickCount - monster.lastAttackTick >= MONSTER_ATTACK_COOLDOWN_TICKS) {
          monster.lastAttackTick = this.tickCount;
          this.hurtPlayer(target, monster.damage);
        }
        return true;
      }

      const dir = dirFromInput(target.x - monster.x, target.y - monster.y);
      if (dir !== null) {
        monster.dir = dir;
        const beforeX = monster.x;
        const beforeY = monster.y;
        const next = moveWithCollision(
          this.map,
          monster.x,
          monster.y,
          dir,
          TICK_SECONDS,
          monster.chaseSpeed,
        );
        monster.x = next.x;
        monster.y = next.y;

        if (monster.x === beforeX && monster.y === beforeY) {
          monster.stuckTicks += 1;
          if (monster.stuckTicks > STUCK_LIMIT_TICKS) monster.targetId = null;
        } else {
          monster.stuckTicks = 0;
        }
      }
      return true;
    }

    // The target is gone or dead: look for a new one.
    monster.targetId = null;
    const found = this.findTarget(monster);
    if (found === null) return false;

    monster.targetId = found.id;
    return true;
  }

  private findTarget(monster: Monster): Player | null {
    let best: Player | null = null;
    let bestDistance = monster.aggro;

    for (const player of this.playersById.values()) {
      if (player.deadUntil > 0) continue;
      const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (distance <= bestDistance) {
        best = player;
        bestDistance = distance;
      }
    }
    return best;
  }

  private stepMonsterWander(monster: Monster): void {
    if (this.tickCount >= monster.wanderUntil) this.chooseWander(monster);
    if (monster.wanderDir === null) return;

    const next = moveWithCollision(
      this.map,
      monster.x,
      monster.y,
      monster.wanderDir,
      TICK_SECONDS,
      monster.speed,
    );

    if (next.x === monster.x && next.y === monster.y) {
      // Something is in the way; stand still for a moment, then try elsewhere.
      monster.wanderDir = null;
      monster.wanderUntil = this.tickCount + BLOCKED_PAUSE_TICKS;
      return;
    }

    monster.x = next.x;
    monster.y = next.y;

    if (Math.hypot(monster.x - monster.homeX, monster.y - monster.homeY) > monster.leash) {
      monster.wanderDir = dirFromInput(monster.homeX - monster.x, monster.homeY - monster.y) ?? 0;
      monster.wanderUntil = this.tickCount + 10;
    }
  }

  private chooseWander(monster: Monster): void {
    if (this.random() < PAUSE_CHANCE) {
      monster.wanderDir = null;
      monster.wanderUntil = this.tickCount + this.randomTicks(PAUSE_MIN_TICKS, PAUSE_MAX_TICKS);
      return;
    }

    monster.wanderDir = Math.floor(this.random() * 8) as Direction;
    monster.dir = monster.wanderDir;
    monster.wanderUntil = this.tickCount + this.randomTicks(WANDER_MIN_TICKS, WANDER_MAX_TICKS);
  }

  private reviveMonster(monster: Monster): void {
    monster.respawnAt = 0;
    monster.hp = monster.maxHp;
    monster.x = monster.homeX;
    monster.y = monster.homeY;
    monster.wanderDir = null;
    monster.wanderUntil = this.tickCount + 10;
    monster.targetId = null;
    monster.lastAttackTick = this.tickCount - MONSTER_ATTACK_COOLDOWN_TICKS;
    monster.damageBy.clear();
  }

  private randomTicks(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  private random(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
}

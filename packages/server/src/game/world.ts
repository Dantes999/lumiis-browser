// The authoritative world. Everything that "is true" in the game lives here.
//
// The client only sends intents; this class is the only place where state changes.

import {
  ATTACK_COOLDOWN_TICKS,
  isDirection,
  DROP_PROTECT_TICKS,
  INVENTORY_SLOTS,
  ITEMS,
  MAX_LEVEL,
  MONSTER_ATTACK_COOLDOWN_TICKS,
  MONSTER_ATTACK_RANGE,
  MONSTER_DEATH_TICKS,
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
  TILE,
  dirFromInput,
  expForNextLevel,
  facingTowards,
  findPath,
  inSwingArc,
  swingFor,
  canStand,
  EMPTY_EQUIPMENT,
  isItemKey,
  itemDef,
  moveWithCollision,
  nearestWalkable,
  spawnPosition,
  tileAt,
} from '@lumiis/shared';
import type { CharacterSave } from '../store/db.js';
import type { Point, SwingProfile } from '@lumiis/shared';
import type {
  Direction,
  Equipment,
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
/** How often a chasing monster looks for a new route (half a second). */
const PATH_REFRESH_TICKS = 10;
/** Close enough to a waypoint to take the next one. */
const WAYPOINT_REACHED = 8;

export type PlayerSeed = {
  accountId: number;
  characterId: number;
  name: string;
  x?: number;
  y?: number;
  dir?: Direction;
  hp?: number;
  level?: number;
  exp?: number;
  yang?: number;
  inventory?: InventorySlot[];
  equipment?: Equipment;
};

export type Player = {
  id: number;
  /** Row in the accounts table. */
  accountId: number;
  /** Row in the characters table; the save is written under it. */
  characterId: number;
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
  equipment: Equipment;
  /** The swing in progress, if any. */
  swing: SwingState | null;
};

/** One swing: it starts, the blow lands half way, the arm returns. */
export type SwingState = {
  dir: Direction;
  hitAt: number;
  endsAt: number;
  range: number;
  resolved: boolean;
};

/** Something the player should be told, collected during the tick. */
export type WorldEvent = { playerId: number; text: string };

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
  /** 0 while alive, otherwise the tick this monster was slain on. */
  deadAt: number;
  targetId: number | null;
  lastAttackTick: number;
  stuckTicks: number;
  /** Route to the target, recomputed when it gets stale. */
  path: Point[];
  pathStep: number;
  /** Tile the current route leads to. */
  pathTile: number;
  /** Earliest tick for a fresh route. */
  nextPathTick: number;
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

/** A player walking into a portal; the realm moves him. */
export type Warp = { playerId: number; to: string; x: number; y: number };

export type AttackResult = { ok: true; started: true } | { ok: false; reason: string };

export class World {
  private readonly playersById = new Map<number, Player>();
  private readonly monstersById = new Map<number, Monster>();
  private readonly groundItems = new Map<number, GroundItem>();
  /** Player ids whose inventory changed since the last tick was reported. */
  private readonly inventoryUpdates = new Set<number>();
  /** Portals walked into during the last tick. */
  private readonly warps: Warp[] = [];
  /** Messages that came up during the tick, for the players they belong to. */
  private readonly events: WorldEvent[] = [];
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

  addPlayer(seed: PlayerSeed): Player {
    const spawn = spawnPosition(this.map);
    const player: Player = {
      id: this.nextPlayerId++,
      accountId: seed.accountId,
      characterId: seed.characterId,
      name: seed.name,
      x: seed.x ?? spawn.x,
      y: seed.y ?? spawn.y,
      dir: seed.dir ?? 0,
      moving: false,
      hp: seed.hp ?? PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      deadUntil: 0,
      lastAttackTick: -ATTACK_COOLDOWN_TICKS,
      level: seed.level ?? 1,
      exp: seed.exp ?? 0,
      yang: seed.yang ?? 0,
      inventory: seed.inventory
        ? [...seed.inventory]
        : new Array<InventorySlot>(INVENTORY_SLOTS).fill(null),
      autoPickup: false,
      autoPickupTypes: new Set<ItemKey>(),
      equipment: seed.equipment ?? { ...EMPTY_EQUIPMENT },
      swing: null,
    };
    this.recalcStats(player);

    // A fresh or moved character may stand somewhere that is not walkable.
    if (!canStand(this.map, player.x, player.y)) {
      player.x = spawn.x;
      player.y = spawn.y;
    }

    // Even the spawn may be a tree in a bad map; then pick the next free tile.
    if (!canStand(this.map, player.x, player.y)) {
      const spot = nearestWalkable(
        this.map,
        Math.floor(player.x / TILE_SIZE),
        Math.floor(player.y / TILE_SIZE),
      );
      if (spot !== null) {
        player.x = (spot.tx + 0.5) * TILE_SIZE;
        player.y = (spot.ty + 0.9) * TILE_SIZE;
      }
    }

    // A character that was stored dead comes back on his feet at the spawn.
    if (player.hp <= 0) {
      player.hp = Math.max(1, Math.round(player.maxHp * PLAYER_RESPAWN_HP_SHARE));
      player.x = spawn.x;
      player.y = spawn.y;
    }

    this.playersById.set(player.id, player);
    return player;
  }

  /** Everything the store needs to remember about one character. */
  saveOf(playerId: number): CharacterSave | null {
    const player = this.playersById.get(playerId);
    if (player === undefined) return null;

    return {
      name: player.name,
      equipment: { ...player.equipment },
      level: player.level,
      exp: player.exp,
      yang: player.yang,
      hp: player.deadUntil > 0 ? 0 : player.hp,
      map: this.map.id,
      x: player.x,
      y: player.y,
      dir: player.dir,
      inventory: player.inventory.map((slot) =>
        slot === null ? null : { key: slot.key, count: slot.count },
      ),
    };
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
  attack(
    playerId: number,
    targetId: number | null = null,
    direction: number | null = null,
  ): AttackResult {
    const player = this.playersById.get(playerId);
    if (player === undefined) return { ok: false, reason: 'You are not in the world.' };
    if (player.deadUntil > 0) return { ok: false, reason: 'You are down.' };

    if (player.swing !== null && this.tickCount < player.swing.endsAt) {
      return { ok: false, reason: 'Not so fast.' };
    }

    // A swing always happens, even at empty air. It goes where the body faces,
    // or towards the monster that was aimed at if that one still exists.
    const aimed = targetId === null ? undefined : this.monstersById.get(targetId);
    if (aimed !== undefined && aimed.respawnAt <= 0) {
      player.dir = facingTowards(player, aimed, player.dir);
    } else if (direction !== null && isDirection(direction)) {
      player.dir = direction;
    }

    const profile = swingFor(player.equipment.weapon);
    player.swing = {
      dir: player.dir,
      hitAt: this.tickCount + profile.hitAt,
      endsAt: this.tickCount + profile.ticks,
      range: profile.range,
      resolved: false,
    };

    return { ok: true, started: true };
  }


  /** One simulation step: players, monsters, deaths and respawns. */
  step(): void {
    this.tickCount += 1;

    this.resolveSwings();

    for (const player of this.playersById.values()) {
      if (player.deadUntil > 0) {
        if (this.tickCount >= player.deadUntil) this.revivePlayer(player);
        continue;
      }

      if (this.tickCount % PLAYER_REGEN_TICKS === 0 && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + PLAYER_REGEN_HP);
      }

      if (player.moving) {
        const next = moveWithCollision(this.map, player.x, player.y, player.dir, TICK_SECONDS);
        player.x = next.x;
        player.y = next.y;
      }

      this.checkPortal(player);
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

  /** Takes a player out of this world without touching his state. */
  detachPlayer(id: number): Player | undefined {
    const player = this.playersById.get(id);
    if (player === undefined) return undefined;

    this.playersById.delete(id);
    for (const monster of this.monstersById.values()) {
      if (monster.targetId === id) monster.targetId = null;
    }
    return player;
  }

  attachPlayer(player: Player): void {
    this.playersById.set(player.id, player);
  }

  /** Portals this tick; the realm carries them out. */
  drainWarps(): Warp[] {
    const list = [...this.warps];
    this.warps.length = 0;
    return list;
  }

  private checkPortal(player: Player): void {
    const tx = Math.floor(player.x / TILE_SIZE);
    const ty = Math.floor(player.y / TILE_SIZE);
    if (tileAt(this.map, tx, ty) !== TILE.PORTAL) return;

    const portal = this.map.portals.find((entry) => entry.tx === tx && entry.ty === ty);
    if (portal === undefined) return;

    this.warps.push({
      playerId: player.id,
      to: portal.to,
      x: (portal.spawnX + 0.5) * TILE_SIZE,
      y: (portal.spawnY + 0.9) * TILE_SIZE,
    });
  }

  /** Lands every swing whose moment has come. */
  private resolveSwings(): void {
    for (const player of this.playersById.values()) {
      const swing = player.swing;
      if (swing === null) continue;

      if (this.tickCount >= swing.endsAt) {
        player.swing = null;
        continue;
      }
      if (swing.resolved || this.tickCount < swing.hitAt) continue;

      swing.resolved = true;
      this.landSwing(player, swing);
    }
  }

  /** Everything standing in the arc gets hit. */
  private landSwing(player: Player, swing: SwingState): void {
    const damage = this.attackOf(player);

    for (const monster of this.monstersById.values()) {
      if (monster.respawnAt > 0) continue;
      if (!inSwingArc(player, swing.dir, monster, swing.range)) continue;

      monster.hp -= damage;
      monster.damageBy.set(player.id, (monster.damageBy.get(player.id) ?? 0) + damage);

      // Being hit makes a monster notice you.
      if (monster.targetId === null) monster.targetId = player.id;

      if (monster.hp <= 0) this.killMonster(monster, player);
    }
  }

  private killMonster(monster: Monster, killer: Player): void {
    monster.hp = 0;
    monster.deadAt = this.tickCount;
    monster.respawnAt = this.tickCount + MONSTER_RESPAWN_TICKS;
    monster.wanderDir = null;
    monster.targetId = null;

    const rewards = this.rewardKill(monster, killer);
    monster.damageBy.clear();
    this.dropLoot(monster, killer);

    for (const reward of rewards) {
      const level = this.playersById.get(reward.playerId)?.level ?? 1;
      const prefix = reward.levelUps > 0 ? `Level ${level}! ` : '';
      this.events.push({
        playerId: reward.playerId,
        text: `${prefix}+${reward.exp} EXP, +${reward.yang} Yang`,
      });
    }
  }

  /** Messages produced during the tick; the gateway delivers them. */
  drainEvents(): WorldEvent[] {
    const list = [...this.events];
    this.events.length = 0;
    return list;
  }

  /** Weapon, armour and health bonus follow what is equipped. */
  private recalcStats(player: Player): void {
    const armor = player.equipment.armor === null ? null : itemDef(player.equipment.armor);
    player.maxHp = PLAYER_MAX_HP + (armor?.maxHp ?? 0);
    player.hp = Math.min(player.hp, player.maxHp);
  }

  private attackOf(player: Player): number {
    const weapon = player.equipment.weapon === null ? null : itemDef(player.equipment.weapon);
    return PLAYER_DAMAGE + (weapon?.attack ?? 0);
  }

  private defenseOf(player: Player): number {
    const armor = player.equipment.armor === null ? null : itemDef(player.equipment.armor);
    return armor?.defense ?? 0;
  }

  equipmentOf(playerId: number): Equipment | null {
    const player = this.playersById.get(playerId);
    return player === undefined ? null : { ...player.equipment };
  }

  /** Wears the item from a bag slot, trading places with what was worn. */
  equip(playerId: number, slotIndex: number): { ok: true } | { ok: false; reason: string } {
    const player = this.playersById.get(playerId);
    if (player === undefined || player.deadUntil > 0) return { ok: false, reason: 'Not now.' };

    const item = player.inventory[slotIndex] ?? null;
    if (item === null) return { ok: false, reason: 'That slot is empty.' };

    const def = itemDef(item.key);
    if (def.slot === undefined) return { ok: false, reason: 'You cannot wear that.' };

    const previous = player.equipment[def.slot];
    if (previous !== null) {
      const free = player.inventory.findIndex(
        (entry, index) => entry === null && index !== slotIndex,
      );
      if (free === -1) return { ok: false, reason: 'Your inventory is full.' };
      player.inventory[free] = { key: previous, count: 1 };
    }

    player.inventory[slotIndex] = item.count > 1 ? { key: item.key, count: item.count - 1 } : null;
    player.equipment[def.slot] = item.key;
    this.recalcStats(player);
    this.inventoryUpdates.add(player.id);
    return { ok: true };
  }

  unequip(playerId: number, piece: 'weapon' | 'armor'): { ok: true } | { ok: false; reason: string } {
    const player = this.playersById.get(playerId);
    if (player === undefined || player.deadUntil > 0) return { ok: false, reason: 'Not now.' };

    const key = player.equipment[piece];
    if (key === null) return { ok: false, reason: 'Nothing is worn there.' };

    const free = player.inventory.findIndex((entry) => entry === null);
    if (free === -1) return { ok: false, reason: 'Your inventory is full.' };

    player.equipment[piece] = null;
    player.inventory[free] = { key, count: 1 };
    this.recalcStats(player);
    this.inventoryUpdates.add(player.id);
    return { ok: true };
  }

  /** Everything a client needs to draw the world right now. */
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
        weapon: player.equipment.weapon,
        armor: player.equipment.armor,
        ...(player.swing !== null ? { attacking: true } : {}),
      });
    }

    const monsters: MonsterSnapshot[] = [];
    for (const monster of this.monstersById.values()) {
      // A slain monster stays visible for a moment so the death reads on screen.
      const dead = monster.deadAt !== 0;
      if (dead && this.tickCount - monster.deadAt >= MONSTER_DEATH_TICKS) continue;
      monsters.push({
        id: monster.id,
        key: monster.key,
        x: Math.round(monster.x * 10) / 10,
        y: Math.round(monster.y * 10) / 10,
        dir: monster.dir,
        hp: dead ? 0 : monster.hp,
        maxHp: monster.maxHp,
        moving: !dead && (monster.wanderDir !== null || monster.targetId !== null),
        ...(dead ? { dead: true } : {}),
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

    const taken = Math.max(1, damage - this.defenseOf(player));
    player.hp = Math.max(0, player.hp - taken);
    if (player.hp > 0) return;

    player.deadUntil = this.tickCount + PLAYER_RESPAWN_TICKS;
    player.moving = false;
    player.swing = null;
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
        deadAt: 0,
        targetId: null,
        lastAttackTick: -MONSTER_ATTACK_COOLDOWN_TICKS,
        stuckTicks: 0,
        path: [],
        pathStep: 0,
        pathTile: -1,
        nextPathTick: 0,
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

      const dir = this.chaseDirection(monster, target);
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
    monster.path = [];
    monster.pathStep = 0;
    monster.pathTile = -1;
    const found = this.findTarget(monster);
    if (found === null) return false;

    monster.targetId = found.id;
    return true;
  }

  /**
   * The next direction towards the target, following a route around obstacles.
   * The route is rebuilt when the target changes tile or after a short while.
   */
  private chaseDirection(monster: Monster, target: Player): Direction | null {
    const targetTile =
      Math.floor(target.y / TILE_SIZE) * this.map.width + Math.floor(target.x / TILE_SIZE);

    const stale =
      monster.path.length === 0 ||
      monster.pathTile !== targetTile ||
      this.tickCount >= monster.nextPathTick;

    if (stale) {
      monster.path =
        findPath(this.map, { x: monster.x, y: monster.y }, { x: target.x, y: target.y }) ?? [];
      monster.pathStep = 0;
      monster.pathTile = targetTile;
      monster.nextPathTick = this.tickCount + PATH_REFRESH_TICKS;
    }

    while (monster.pathStep < monster.path.length) {
      const point = monster.path[monster.pathStep];
      if (point === undefined) break;
      if (Math.hypot(point.x - monster.x, point.y - monster.y) > WAYPOINT_REACHED) break;
      monster.pathStep += 1;
    }

    const waypoint = monster.path[monster.pathStep];
    if (waypoint === undefined) {
      return dirFromInput(target.x - monster.x, target.y - monster.y);
    }
    return dirFromInput(waypoint.x - monster.x, waypoint.y - monster.y);
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
    monster.deadAt = 0;
    monster.hp = monster.maxHp;
    monster.x = monster.homeX;
    monster.y = monster.homeY;
    monster.wanderDir = null;
    monster.wanderUntil = this.tickCount + 10;
    monster.targetId = null;
    monster.lastAttackTick = this.tickCount - MONSTER_ATTACK_COOLDOWN_TICKS;
    monster.path = [];
    monster.pathStep = 0;
    monster.pathTile = -1;
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

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
  MOVE_ATTACKING,
  MOVE_DEAD,
  MOVE_MOVING,
  MOVE_WHIRLWIND,
  PICKUP_RANGE,
  PLAYER_DAMAGE,
  PLAYER_MAX_HP,
  CLASSES,
  EMPTY_STATS,
  PLAYER_MAX_SP,
  PLAYER_REGEN_HP,
  PLAYER_REGEN_SP,
  PLAYER_REGEN_TICKS,
  POTION_COOLDOWN_TICKS,
  STAT_ATTACK_PER_STR,
  STAT_DEFENSE_PER_DEX,
  STAT_HP_PER_VIT,
  STAT_POINTS_PER_LEVEL,
  STAT_SP_PER_INT,
  PLAYER_RESPAWN_HP_SHARE,
  PLAYER_RESPAWN_TICKS,
  TICK_MS,
  TICK_RATE,
  TILE_SIZE,
  TILE,
  SKILLS,
  encode,
  dirFromInput,
  expForNextLevel,
  facingTowards,
  inSwingArc,
  swingFor,
  canStand,
  EMPTY_EQUIPMENT,
  isItemKey,
  itemDef,
  moveWithCollision,
  requiredLevel,
  nearestWalkable,
  spawnPosition,
  tileAt,
} from '@lumiis/shared';
import type { CharacterSave } from '../store/db.js';
import type {
  ClassKey,
  Point,
  Sex,
  SkillKey,
  StatKey,
  Stats,
  SwingProfile,
} from '@lumiis/shared';
import { chaseDirection, findTarget, randomWalkableDirection } from './monster-ai.js';
import {
  damageTaken,
  magicAttackDamage,
  magicDefense,
  damagePortion,
  regeneratedHp,
  revivedHp,
  rollBetween,
  whirlwindDamage,
} from './formulas.js';
import type {
  Direction,
  Equipment,
  MoveEntry,
  SnapshotMessage,
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
/** Side of one interest cell in pixels; players share a snapshot per cell. */
const CELL_SIZE = 256;
/** Encodes snapshot JSON to UTF-8 bytes once; a TextEncoder is stateless. */
const SNAPSHOT_ENCODER = new TextEncoder();

/** How many cells around a player are visible: 1 means a 3x3 block. */
const VIEW_CELLS = 1;

/** After bumping into something, a monster waits this long before turning. */
const BLOCKED_PAUSE_TICKS = 5;
/** A chasing monster that cannot get closer for this long loses interest. */
const STUCK_LIMIT_TICKS = 40;
export type PlayerSeed = {
  accountId: number;
  characterId: number;
  name: string;
  /** Class and sex; defaults to warrior/m when missing. */
  cls?: ClassKey;
  sex?: Sex;
  /** Look ids of the style pack manifest; empty means "the default". */
  body?: string;
  hair?: string;
  x?: number;
  y?: number;
  dir?: Direction;
  hp?: number;
  level?: number;
  exp?: number;
  yang?: number;
  inventory?: InventorySlot[];
  equipment?: Equipment;
  stats?: Stats;
  points?: number;
};

export type Player = {
  id: number;
  /** Row in the accounts table. */
  accountId: number;
  /** Row in the characters table; the save is written under it. */
  characterId: number;
  name: string;
  cls: ClassKey;
  sex: Sex;
  /** Look ids of the style pack manifest; empty means "the default". */
  body: string;
  hair: string;
  /** Position in world pixels, measured at the feet. */
  x: number;
  y: number;
  /** Where the body faces (sprite and swing). */
  dir: Direction;
  /** Where the player walks; a swing never changes this. */
  moveDir: Direction;
  moving: boolean;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  stats: Stats;
  /** Unspent stat points. */
  points: number;
  /** Derived combat values; recalculated when stats or gear change. */
  attack: number;
  defense: number;
  matk: number;
  mdef: number;
  /** Tick before which no potion may be used again. */
  nextPotionAt: number;
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
  /** Tick when each skill is ready to fire again. */
  skillCooldowns: Map<SkillKey, number>;
  /** Tick when each active buff expires. */
  buffs: Map<SkillKey, number>;
  /** Tick until which the whirlwind is shown to other clients. */
  whirlwindUntil: number;
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

/** A kill everyone in the world may watch: which players earned what. */
export type RewardBroadcast = {
  x: number;
  y: number;
  shares: Array<{ playerId: number; exp: number; yang: number }>;
};

/** What one player was last told about one entity, for the next delta. */
type Seen = {
  sig: string;
  x: number;
  y: number;
  dir: number;
  flags: number;
  hp: number;
  /** Tick this entry was last updated in; stale entries are dropped. */
  at: number;
};

/** The last snapshot a player got: enough to send only what changed next. */
type ViewState = {
  cell: number;
  players: Map<number, Seen>;
  monsters: Map<number, Seen>;
  ground: Set<number>;
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
export type Warp = {
  playerId: number;
  /** Target map id. */
  to: string;
  x: number;
  y: number;
  /** Target world key when the realm does not own it (set by the realm). */
  world?: string;
};

export type AttackResult = { ok: true; started: true } | { ok: false; reason: string };

export class World {
  private readonly playersById = new Map<number, Player>();
  private readonly monstersById = new Map<number, Monster>();
  private readonly groundItems = new Map<number, GroundItem>();
  /** What each occupied cell last sent, so the next snapshot can be a delta. */
  private readonly cellStates = new Map<number, ViewState>();
  /** The cell each player got his last snapshot for. */
  private readonly lastCell = new Map<number, number>();
  /** Bumped per snapshot round; marks state entries that are still in view. */
  private stateStamp = 0;
  /** Player ids whose inventory changed since the last tick was reported. */
  private readonly inventoryUpdates = new Set<number>();
  /** Portals walked into during the last tick. */
  private readonly warps: Warp[] = [];
  /** Messages that came up during the tick, for the players they belong to. */
  private readonly events: WorldEvent[] = [];
  /** Kill rewards to broadcast to everyone in this world. */
  private readonly rewardBroadcasts: RewardBroadcast[] = [];
  private nextPlayerId = 1;
  private nextMonsterId = 1;
  private nextGroundId = 1;
  private tickCount = 0;
  /** Small deterministic generator: the same map always behaves the same way. */
  private rngState = 0x9e3779b9;

  constructor(
    readonly map: MapData,
    /** World key: the map id, or map#ch2 for a channel. */
    readonly key: string = map.id,
    /** Channel number, 1 based; every channel is its own copy of the map. */
    readonly channel = 1,
  ) {
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

  addPlayer(seed: PlayerSeed, id?: number): Player {
    const spawn = spawnPosition(this.map);
    // The realm hands out ids that are unique across all maps; a bare world
    // (tests) still numbers its own players.
    const playerId = id ?? this.nextPlayerId++;
    if (id !== undefined) this.nextPlayerId = Math.max(this.nextPlayerId, id + 1);

    const player: Player = {
      id: playerId,
      accountId: seed.accountId,
      characterId: seed.characterId,
      name: seed.name,
      cls: seed.cls ?? 'warrior',
      sex: seed.sex ?? 'm',
      body: seed.body ?? '',
      hair: seed.hair ?? '',
      x: seed.x ?? spawn.x,
      y: seed.y ?? spawn.y,
      dir: seed.dir ?? 0,
      moveDir: seed.dir ?? 0,
      moving: false,
      hp: seed.hp ?? PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      sp: PLAYER_MAX_SP,
      maxSp: PLAYER_MAX_SP,
      stats: seed.stats === undefined ? { ...EMPTY_STATS } : { ...seed.stats },
      points: seed.points ?? 0,
      attack: 0,
      defense: 0,
      matk: 0,
      mdef: 0,
      nextPotionAt: 0,
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
      skillCooldowns: new Map(),
      buffs: new Map(),
      whirlwindUntil: 0,
    };
    this.recalcStats(player);
    // Skill points are not part of the save; a login starts with full ones.
    player.sp = player.maxSp;

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
      player.hp = revivedHp(player.maxHp, PLAYER_RESPAWN_HP_SHARE);
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
      cls: player.cls,
      sex: player.sex,
      body: player.body,
      hair: player.hair,
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
      stats: { ...player.stats },
      points: player.points,
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

    // A new walking direction turns the body; a repeated input does not, so a
    // swing that aims another way keeps the facing until the player turns.
    if (!player.moving || dir !== player.moveDir) player.dir = dir;
    player.moveDir = dir;
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

      if (this.tickCount % PLAYER_REGEN_TICKS === 0) {
        if (player.hp < player.maxHp) {
          player.hp = regeneratedHp(player.hp, player.maxHp, PLAYER_REGEN_HP);
        }
        if (player.sp < player.maxSp) {
          player.sp = Math.min(player.maxSp, player.sp + PLAYER_REGEN_SP);
        }
      }

      if (player.buffs.size > 0) {
        for (const [key, until] of [...player.buffs]) {
          if (this.tickCount >= until) player.buffs.delete(key);
        }
      }

      if (player.moving) {
        const next = moveWithCollision(
          this.map,
          player.x,
          player.y,
          player.moveDir,
          TICK_SECONDS,
        );
        player.x = next.x;
        player.y = next.y;
      }

      this.checkPortal(player);
    }

    // Monsters sleep unless a player is nearby or they are already chasing one.
    const active = this.activeCells();

    for (const monster of this.monstersById.values()) {
      if (monster.respawnAt > 0) {
        if (this.tickCount >= monster.respawnAt) this.reviveMonster(monster);
        continue;
      }
      if (monster.targetId === null && !active.has(this.cellId(monster.x, monster.y))) {
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

    const shares = rewards
      .filter((reward) => reward.exp > 0 || reward.yang > 0)
      .map((reward) => ({ playerId: reward.playerId, exp: reward.exp, yang: reward.yang }));
    if (shares.length > 0) {
      this.rewardBroadcasts.push({ x: monster.x, y: monster.y, shares });
    }
  }

  /** Kill rewards produced during the tick; the gateway broadcasts them. */
  drainRewards(): RewardBroadcast[] {
    const list = [...this.rewardBroadcasts];
    this.rewardBroadcasts.length = 0;
    return list;
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
    const weapon = player.equipment.weapon === null ? null : itemDef(player.equipment.weapon);
    const growth = CLASSES[player.cls];
    // Primary and secondary stat, like the old project's atkStats (4 : 2 / 3).
    const [primary, secondary] = growth.atkStats;
    const statAttack = Math.floor(
      (4 * player.stats[primary] + 2 * player.stats[secondary]) / 3,
    );
    player.attack = PLAYER_DAMAGE + (weapon?.attack ?? 0) + statAttack;
    player.defense =
      (armor?.defense ?? 0) + Math.floor(player.stats.dex / STAT_DEFENSE_PER_DEX);
    player.matk = magicAttackDamage(weapon?.matk ?? 0, weapon?.attack ?? 0, player.stats.int);
    player.mdef = magicDefense(player.stats.int, player.stats.vit, armor?.defense ?? 0);
    player.maxHp =
      growth.hp +
      growth.hpPerLevel * (player.level - 1) +
      player.stats.vit * STAT_HP_PER_VIT +
      (armor?.maxHp ?? 0);
    player.hp = Math.min(player.hp, player.maxHp);
    player.maxSp =
      growth.sp + growth.spPerLevel * (player.level - 1) + player.stats.int * STAT_SP_PER_INT;
    player.sp = Math.min(player.sp, player.maxSp);
  }

  /** Active buffs as seconds remaining, for the client to draw. */
  private playerBuffs(player: Player): { buffs?: Record<string, number> } {
    if (player.buffs.size === 0) return {};
    const buffs: Record<string, number> = {};
    for (const [key, until] of player.buffs) {
      buffs[key] = Math.max(0, Math.round((until - this.tickCount) / TICK_RATE));
    }
    return { buffs };
  }

  /** Fires a skill: a self-buff or a whirlwind that hits everything around. */
  useSkill(playerId: number, key: SkillKey): { ok: true } | { ok: false; reason: string } {
    const player = this.playersById.get(playerId);
    if (player === undefined) return { ok: false, reason: 'You are not in the world.' };
    if (player.deadUntil > 0) return { ok: false, reason: 'You are down.' };

    const skill = SKILLS[key];
    if ((player.skillCooldowns.get(key) ?? 0) > this.tickCount) {
      return { ok: false, reason: 'Not ready yet.' };
    }
    if (player.sp < skill.spCost) {
      return { ok: false, reason: 'Nicht genug Mana.' };
    }

    if (skill.kind === 'buff') {
      player.buffs.set(key, this.tickCount + (skill.durationTicks ?? 0));
    } else {
      // A short window so other clients can play the same spin.
      player.whirlwindUntil = this.tickCount + 12;
      const base = skill.scaling === 'magical' ? player.matk : this.attackOf(player);
      const damage = whirlwindDamage(base, skill.damageScale ?? 1);
      const radius = skill.radius ?? 0;
      for (const monster of this.monstersById.values()) {
        if (monster.respawnAt > 0) continue;
        if (Math.hypot(monster.x - player.x, monster.y - player.y) > radius) continue;
        // A magic skill has to get through the monster's magic defence.
        const dealt =
          skill.scaling === 'magical'
            ? Math.max(1, damage - (MONSTER_TYPES[monster.key].mdef ?? 0))
            : damage;
        monster.hp -= dealt;
        monster.damageBy.set(player.id, (monster.damageBy.get(player.id) ?? 0) + dealt);
        if (monster.targetId === null) monster.targetId = player.id;
        if (monster.hp <= 0) this.killMonster(monster, player);
      }
    }

    player.sp -= skill.spCost;
    player.skillCooldowns.set(key, this.tickCount + skill.cooldownTicks);
    return { ok: true };
  }

  /** Drinks a potion from the bag: heals, restores skill points, consumes one. */
  useItem(playerId: number, slotIndex: number): { ok: true } | { ok: false; reason: string } {
    const player = this.playersById.get(playerId);
    if (player === undefined) return { ok: false, reason: 'You are not in the world.' };
    if (player.deadUntil > 0) return { ok: false, reason: 'Not now.' };
    if (this.tickCount < player.nextPotionAt) return { ok: false, reason: 'Noch nicht wieder.' };

    const item = player.inventory[slotIndex] ?? null;
    if (item === null) return { ok: false, reason: 'That slot is empty.' };

    const def = itemDef(item.key);
    if (def.type !== 'consumable') return { ok: false, reason: 'Das kann man nicht trinken.' };

    if (def.heal !== undefined) player.hp = Math.min(player.maxHp, player.hp + def.heal);
    if (def.mana !== undefined) player.sp = Math.min(player.maxSp, player.sp + def.mana);

    player.inventory[slotIndex] = item.count > 1 ? { key: item.key, count: item.count - 1 } : null;
    player.nextPotionAt = this.tickCount + POTION_COOLDOWN_TICKS;
    this.inventoryUpdates.add(player.id);
    return { ok: true };
  }

  /** Puts one unspent point into a stat. */
  spendStat(playerId: number, stat: StatKey): { ok: true } | { ok: false; reason: string } {
    const player = this.playersById.get(playerId);
    if (player === undefined) return { ok: false, reason: 'You are not in the world.' };
    if (player.points <= 0) return { ok: false, reason: 'Keine Punkte übrig.' };

    player.points -= 1;
    player.stats[stat] += 1;
    this.recalcStats(player);
    return { ok: true };
  }

  /** Physical attack of one swing: derived attack plus the aura buff. */
  private attackOf(player: Player): number {
    const aura = player.buffs.has('aura') ? (SKILLS.aura.attackBonus ?? 0) : 0;
    return player.attack + aura;
  }

  private defenseOf(player: Player): number {
    return player.defense;
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

    const need = requiredLevel(item.key);
    if (player.level < need) return { ok: false, reason: `You need level ${need}.` };

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

  /** The whole world; used by tests and for debugging. */
  snapshot(): {
    players: PlayerSnapshot[];
    monsters: MonsterSnapshot[];
    ground: GroundItemSnapshot[];
  } {
    return this.buildSnapshot(() => true);
  }

  /** What one player would see: entities inside the 3x3 cells around him. */
  visibleSnapshot(x: number, y: number): {
    players: PlayerSnapshot[];
    monsters: MonsterSnapshot[];
    ground: GroundItemSnapshot[];
  } {
    return this.visibleInCell(this.cellX(x), this.cellY(y));
  }

  /**
   * One ready-to-send snapshot per player, as UTF-8 bytes.
   *
   * Everyone standing in the same cell sees the same 3x3 block, so the delta is
   * built and encoded **once per cell** and shared. The first snapshot of a cell
   * (and the first for anyone who just walked in) is the whole view; afterwards
   * only what changed goes out. An idle cell sends nothing at all.
   */
  snapshots(): Map<number, Uint8Array> {
    const result = new Map<number, Uint8Array>();
    const stamp = (this.stateStamp += 1);

    const byCell = new Map<number, Player[]>();
    for (const player of this.playersById.values()) {
      const cell = this.cellId(player.x, player.y);
      const group = byCell.get(cell);
      if (group === undefined) byCell.set(cell, [player]);
      else group.push(player);
    }

    // Forget cells nobody stands in and players who left.
    for (const cell of this.cellStates.keys()) {
      if (!byCell.has(cell)) this.cellStates.delete(cell);
    }
    for (const id of this.lastCell.keys()) {
      if (!this.playersById.has(id)) this.lastCell.delete(id);
    }

    for (const [cell, group] of byCell) {
      const first = group[0];
      if (first === undefined) continue;

      const view = this.visibleInCell(this.cellX(first.x), this.cellY(first.y));
      const previous = this.cellStates.get(cell);

      let full: Uint8Array | null = null;
      if (previous === undefined || group.some((player) => this.lastCell.get(player.id) !== cell)) {
        full = SNAPSHOT_ENCODER.encode(
          encode({
            t: 'snapshot',
            tick: this.tickCount,
            map: this.map.id,
            full: true,
            players: view.players,
            monsters: view.monsters,
            ground: view.ground,
          }),
        );
      }

      let delta: Uint8Array | null = null;
      if (previous !== undefined) {
        const changed = this.delta(view, previous);
        if (changed !== null) delta = SNAPSHOT_ENCODER.encode(encode(changed));
      }

      if (previous === undefined) this.cellStates.set(cell, this.stateOf(view, cell, stamp));
      else this.updateState(previous, view, cell, stamp);

      for (const player of group) {
        const joined = previous === undefined || this.lastCell.get(player.id) !== cell;
        const payload = joined ? full : delta;
        if (payload !== null) result.set(player.id, payload);
        this.lastCell.set(player.id, cell);
      }
    }

    return result;
  }

  /** What changed in this cell since the last snapshot, or null if nothing did. */
  private delta(
    view: { players: PlayerSnapshot[]; monsters: MonsterSnapshot[]; ground: GroundItemSnapshot[] },
    previous: ViewState,
  ): SnapshotMessage | null {
    const players: PlayerSnapshot[] = [];
    const movePlayers: MoveEntry[] = [];
    const gonePlayers: number[] = [];

    const knownPlayers = new Set<number>();
    for (const entry of view.players) {
      knownPlayers.add(entry.id);
      const before = previous.players.get(entry.id);
      const flags = this.playerFlags(entry);

      if (before === undefined || before.sig !== this.playerSig(entry)) {
        players.push(entry);
      } else if (
        before.x !== entry.x ||
        before.y !== entry.y ||
        before.dir !== entry.dir ||
        before.flags !== flags ||
        before.hp !== entry.hp
      ) {
        movePlayers.push([entry.id, entry.x, entry.y, entry.dir, flags, entry.hp]);
      }
    }
    for (const id of previous.players.keys()) if (!knownPlayers.has(id)) gonePlayers.push(id);

    const monsters: MonsterSnapshot[] = [];
    const moveMonsters: MoveEntry[] = [];
    const goneMonsters: number[] = [];

    const knownMonsters = new Set<number>();
    for (const entry of view.monsters) {
      knownMonsters.add(entry.id);
      const before = previous.monsters.get(entry.id);
      const flags = (entry.dead === true ? MOVE_DEAD : 0) | (entry.moving ? MOVE_MOVING : 0);

      if (before === undefined || before.sig !== this.monsterSig(entry)) {
        monsters.push(entry);
      } else if (
        before.x !== entry.x ||
        before.y !== entry.y ||
        before.dir !== entry.dir ||
        before.flags !== flags ||
        before.hp !== entry.hp
      ) {
        moveMonsters.push([entry.id, entry.x, entry.y, entry.dir, flags, entry.hp]);
      }
    }
    for (const id of previous.monsters.keys()) if (!knownMonsters.has(id)) goneMonsters.push(id);

    // Ground items do not move: new ones go out in full, removed ones as ids.
    const ground: GroundItemSnapshot[] = [];
    const goneGround: number[] = [];
    const knownGround = new Set<number>();
    for (const item of view.ground) {
      knownGround.add(item.id);
      if (!previous.ground.has(item.id)) ground.push(item);
    }
    for (const id of previous.ground) if (!knownGround.has(id)) goneGround.push(id);

    if (
      players.length === 0 &&
      monsters.length === 0 &&
      ground.length === 0 &&
      movePlayers.length === 0 &&
      moveMonsters.length === 0 &&
      gonePlayers.length === 0 &&
      goneMonsters.length === 0 &&
      goneGround.length === 0
    ) {
      return null;
    }

    const message: SnapshotMessage = {
      t: 'snapshot',
      tick: this.tickCount,
      map: this.map.id,
      players,
      monsters,
      ground,
    };
    if (movePlayers.length > 0 || moveMonsters.length > 0) {
      message.move = { players: movePlayers, monsters: moveMonsters };
    }
    if (gonePlayers.length > 0 || goneMonsters.length > 0 || goneGround.length > 0) {
      message.gone = { players: gonePlayers, monsters: goneMonsters, ground: goneGround };
    }

    return message;
  }

  /** The state one cell has now, to compare against on the next tick. */
  private stateOf(
    view: { players: PlayerSnapshot[]; monsters: MonsterSnapshot[]; ground: GroundItemSnapshot[] },
    cell: number,
    stamp: number,
  ): ViewState {
    const players = new Map<number, Seen>();
    for (const entry of view.players) {
      players.set(entry.id, {
        sig: this.playerSig(entry),
        x: entry.x,
        y: entry.y,
        dir: entry.dir,
        flags: this.playerFlags(entry),
        hp: entry.hp,
        at: stamp,
      });
    }

    const monsters = new Map<number, Seen>();
    for (const entry of view.monsters) {
      monsters.set(entry.id, {
        sig: this.monsterSig(entry),
        x: entry.x,
        y: entry.y,
        dir: entry.dir,
        flags: (entry.dead === true ? MOVE_DEAD : 0) | (entry.moving ? MOVE_MOVING : 0),
        hp: entry.hp,
        at: stamp,
      });
    }

    return {
      cell,
      players,
      monsters,
      ground: new Set(view.ground.map((item) => item.id)),
    };
  }

  /**
   * Moves the known state forward to what was just sent, without allocating new
   * maps. Under load this is the difference between 5 and 15 ms per tick.
   */
  private updateState(
    state: ViewState,
    view: { players: PlayerSnapshot[]; monsters: MonsterSnapshot[]; ground: GroundItemSnapshot[] },
    cell: number,
    stamp: number,
  ): void {
    state.cell = cell;

    for (const entry of view.players) {
      const seen = state.players.get(entry.id);
      if (seen === undefined) {
        state.players.set(entry.id, {
          sig: this.playerSig(entry),
          x: entry.x,
          y: entry.y,
          dir: entry.dir,
          flags: this.playerFlags(entry),
          hp: entry.hp,
          at: stamp,
        });
        continue;
      }
      seen.sig = this.playerSig(entry);
      seen.x = entry.x;
      seen.y = entry.y;
      seen.dir = entry.dir;
      seen.flags = this.playerFlags(entry);
      seen.hp = entry.hp;
      seen.at = stamp;
    }
    for (const [id, seen] of state.players) if (seen.at !== stamp) state.players.delete(id);

    for (const entry of view.monsters) {
      const flags = (entry.dead === true ? MOVE_DEAD : 0) | (entry.moving ? MOVE_MOVING : 0);
      const seen = state.monsters.get(entry.id);
      if (seen === undefined) {
        state.monsters.set(entry.id, {
          sig: this.monsterSig(entry),
          x: entry.x,
          y: entry.y,
          dir: entry.dir,
          flags,
          hp: entry.hp,
          at: stamp,
        });
        continue;
      }
      seen.sig = this.monsterSig(entry);
      seen.x = entry.x;
      seen.y = entry.y;
      seen.dir = entry.dir;
      seen.flags = flags;
      seen.hp = entry.hp;
      seen.at = stamp;
    }
    for (const [id, seen] of state.monsters) if (seen.at !== stamp) state.monsters.delete(id);

    state.ground.clear();
    for (const item of view.ground) state.ground.add(item.id);
  }

  /**
   * Everything the client draws about a player that is not movement. A change
   * here sends the full entry again, so the own exp, yang and buffs stay fresh.
   */
  private playerSig(entry: PlayerSnapshot): string {
    const buffs = entry.buffs ?? {};
    const buffSig = Object.keys(buffs)
      .sort()
      .map((key) => `${key}=${buffs[key]}`)
      .join(',');
    return (
      `${entry.name}|${entry.level}|${entry.exp}|${entry.yang}|${entry.maxHp}|${entry.sp}|${entry.maxSp}|` +
      `${entry.stats.str}.${entry.stats.vit}.${entry.stats.int}.${entry.stats.dex}|${entry.points}|` +
      `${entry.weapon ?? ''}|${entry.armor ?? ''}|${entry.body ?? ''}|${entry.hair ?? ''}|${buffSig}`
    );
  }

  private playerFlags(entry: PlayerSnapshot): number {
    return (
      (entry.moving ? MOVE_MOVING : 0) |
      (entry.attacking === true ? MOVE_ATTACKING : 0) |
      (entry.whirlwind === true ? MOVE_WHIRLWIND : 0)
    );
  }

  private monsterSig(entry: MonsterSnapshot): string {
    return `${entry.key}|${entry.maxHp}`;
  }

  private cellX(x: number): number {
    return Math.floor(x / CELL_SIZE);
  }

  private cellY(y: number): number {
    return Math.floor(y / CELL_SIZE);
  }

  private cellId(x: number, y: number): number {
    // Cell coordinates are small (a map is at most 256 tiles), so this cannot collide.
    return this.cellY(y) * 10000 + this.cellX(x);
  }

  /** Entities inside the 3x3 cells around one cell. */
  private visibleInCell(cx: number, cy: number): {
    players: PlayerSnapshot[];
    monsters: MonsterSnapshot[];
    ground: GroundItemSnapshot[];
  } {
    return this.buildSnapshot(
      (x, y) => Math.abs(this.cellX(x) - cx) <= VIEW_CELLS && Math.abs(this.cellY(y) - cy) <= VIEW_CELLS,
    );
  }

  private buildSnapshot(inView: (x: number, y: number) => boolean): {
    players: PlayerSnapshot[];
    monsters: MonsterSnapshot[];
    ground: GroundItemSnapshot[];
  } {
    const players: PlayerSnapshot[] = [];
    for (const player of this.playersById.values()) {
      if (!inView(player.x, player.y)) continue;
      players.push({
        id: player.id,
        name: player.name,
        body: player.body,
        hair: player.hair,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        dir: player.dir,
        moving: player.moving,
        hp: player.hp,
        maxHp: player.maxHp,
        sp: player.sp,
        maxSp: player.maxSp,
        stats: { ...player.stats },
        points: player.points,
        attack: player.attack,
        defense: player.defense,
        matk: player.matk,
        mdef: player.mdef,
        level: player.level,
        exp: player.exp,
        yang: player.yang,
        weapon: player.equipment.weapon,
        armor: player.equipment.armor,
        ...(player.swing !== null ? { attacking: true } : {}),
        ...(player.whirlwindUntil > this.tickCount ? { whirlwind: true } : {}),
        ...this.playerBuffs(player),
      });
    }

    const monsters: MonsterSnapshot[] = [];
    for (const monster of this.monstersById.values()) {
      if (!inView(monster.x, monster.y)) continue;
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

    const ground: GroundItemSnapshot[] = [];
    for (const item of this.groundItems.values()) {
      if (!inView(item.x, item.y)) continue;
      ground.push({
        id: item.id,
        key: item.key,
        x: Math.round(item.x * 10) / 10,
        y: Math.round(item.y * 10) / 10,
        count: item.count,
      });
    }

    return { players, monsters, ground };
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

  private hurtPlayer(player: Player, damage: number, magic = false): void {
    if (player.deadUntil > 0) return;

    // Magic blows meet magic defence, physical blows the armour.
    const taken = damageTaken(damage, magic ? player.mdef : this.defenseOf(player));
    player.hp = Math.max(0, player.hp - taken);
    if (player.hp > 0) return;

    player.deadUntil = this.tickCount + PLAYER_RESPAWN_TICKS;
    player.moving = false;
    player.swing = null;
    this.events.push({
      playerId: player.id,
      text: `Du bist gefallen. In ${Math.ceil(PLAYER_RESPAWN_TICKS / TICK_RATE)} s stehst du wieder.`,
    });
  }

  private revivePlayer(player: Player): void {
    const spawn = spawnPosition(this.map);
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = revivedHp(player.maxHp, PLAYER_RESPAWN_HP_SHARE);
    player.sp = player.maxSp;
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
    const yangTotal = rollBetween(type.yangMin, type.yangMax, () => this.random());

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
      const portion = damagePortion(share.damage, totalDamage);
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

      const count = rollBetween(drop.min, drop.max, () => this.random());
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

    // Levelling up puts the player back on his feet, with full bars and
    // points to spend.
    if (levelUps > 0) {
      player.points += STAT_POINTS_PER_LEVEL * levelUps;
      this.recalcStats(player);
      player.hp = player.maxHp;
      player.sp = player.maxSp;
    }

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

  /** Cells within view of at least one living player; monsters there stay awake. */
  private activeCells(): Set<number> {
    const cells = new Set<number>();

    for (const player of this.playersById.values()) {
      if (player.deadUntil > 0) continue;
      const cx = this.cellX(player.x);
      const cy = this.cellY(player.y);
      for (let dx = -VIEW_CELLS; dx <= VIEW_CELLS; dx += 1) {
        for (let dy = -VIEW_CELLS; dy <= VIEW_CELLS; dy += 1) {
          cells.add((cy + dy) * 10000 + (cx + dx));
        }
      }
    }

    return cells;
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
          this.hurtPlayer(target, monster.damage, MONSTER_TYPES[monster.key].magic);
        }
        return true;
      }

      const dir = chaseDirection(this.map, monster, target, this.tickCount);
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
    const found = findTarget(this.playersById.values(), monster);
    if (found === null) return false;

    monster.targetId = found.id;
    return true;
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

    const dir = randomWalkableDirection(this.map, monster, () => this.random());
    if (dir === null) {
      // Boxed in on every side: stay put for a moment.
      monster.wanderDir = null;
      monster.wanderUntil = this.tickCount + this.randomTicks(PAUSE_MIN_TICKS, PAUSE_MAX_TICKS);
      return;
    }

    monster.wanderDir = dir;
    monster.dir = dir;
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

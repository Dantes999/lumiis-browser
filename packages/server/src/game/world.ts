// The authoritative world. Everything that "is true" in the game lives here.
//
// The client only sends intents; this class is the only place where state changes.

import {
  ATTACK_COOLDOWN_TICKS,
  MONSTER_ATTACK_COOLDOWN_TICKS,
  MONSTER_ATTACK_RANGE,
  MONSTER_GIVE_UP_FACTOR,
  MONSTER_RESPAWN_TICKS,
  MONSTER_TYPES,
  PLAYER_DAMAGE,
  PLAYER_MAX_HP,
  PLAYER_RESPAWN_HP_SHARE,
  PLAYER_RESPAWN_TICKS,
  TICK_MS,
  TILE_SIZE,
  dirFromInput,
  moveWithCollision,
  spawnPosition,
  withinAttackRange,
} from '@lumiis/shared';
import type {
  Direction,
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
};

export type AttackResult =
  | { ok: true; damage: number; killed: boolean }
  | { ok: false; reason: string };

export class World {
  private readonly playersById = new Map<number, Player>();
  private readonly monstersById = new Map<number, Monster>();
  private nextPlayerId = 1;
  private nextMonsterId = 1;
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

    if (monster.hp <= 0) {
      monster.hp = 0;
      monster.respawnAt = this.tickCount + MONSTER_RESPAWN_TICKS;
      monster.wanderDir = null;
      monster.targetId = null;
      return { ok: true, damage: PLAYER_DAMAGE, killed: true };
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
  }

  snapshot(): { players: PlayerSnapshot[]; monsters: MonsterSnapshot[] } {
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

    return { players, monsters };
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
  }

  private randomTicks(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  private random(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
}

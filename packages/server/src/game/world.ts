// The authoritative world. Everything that "is true" in the game lives here.
//
// The client only sends intents; this class is the only place where state changes.

import {
  ATTACK_COOLDOWN_TICKS,
  MONSTER_RESPAWN_TICKS,
  MONSTER_TYPES,
  PLAYER_DAMAGE,
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

export type Player = {
  id: number;
  name: string;
  /** Position in world pixels, measured at the feet. */
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
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
  leash: number;
  wanderDir: Direction | null;
  wanderUntil: number;
  /** 0 while alive, otherwise the tick this monster returns on. */
  respawnAt: number;
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
      lastAttackTick: -ATTACK_COOLDOWN_TICKS,
    };
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
   * Applies a movement intent. The client may send this as often as it likes;
   * only the last one before a tick has any effect.
   */
  setInput(id: number, dx: number, dy: number): void {
    const player = this.playersById.get(id);
    if (player === undefined) return;

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
      return { ok: true, damage: PLAYER_DAMAGE, killed: true };
    }

    return { ok: true, damage: PLAYER_DAMAGE, killed: false };
  }

  /** One simulation step: movement, monsters, respawns. */
  step(): void {
    this.tickCount += 1;

    for (const player of this.playersById.values()) {
      if (!player.moving) continue;
      const next = moveWithCollision(this.map, player.x, player.y, player.dir, TICK_SECONDS);
      player.x = next.x;
      player.y = next.y;
    }

    this.stepMonsters();
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
        moving: monster.wanderDir !== null,
      });
    }

    return { players, monsters };
  }

  // ---------------------------------------------------------------- monsters

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
        leash: type.leash,
        wanderDir: null,
        wanderUntil: 0,
        respawnAt: 0,
      });
      this.nextMonsterId += 1;
    }
  }

  private stepMonsters(): void {
    for (const monster of this.monstersById.values()) {
      if (monster.respawnAt > 0) {
        if (this.tickCount >= monster.respawnAt) this.reviveMonster(monster);
        continue;
      }

      if (this.tickCount >= monster.wanderUntil) this.chooseWander(monster);
      if (monster.wanderDir === null) continue;

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
        continue;
      }

      monster.x = next.x;
      monster.y = next.y;

      if (Math.hypot(monster.x - monster.homeX, monster.y - monster.homeY) > monster.leash) {
        monster.wanderDir = dirFromInput(monster.homeX - monster.x, monster.homeY - monster.y) ?? 0;
        monster.wanderUntil = this.tickCount + 10;
      }
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
  }

  private randomTicks(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  private random(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
}

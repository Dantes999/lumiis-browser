// Monster definitions and combat numbers.
//
// One place for all of it: server and client read the same table, so the health
// bar and the server's decision can never disagree about how tough a wolf is.

export const MONSTER_TYPES = {
  wolf: {
    look: 'alpha_wolf@1.1',
    name: 'Grey wolf',
    maxHp: 40,
    /** Pixels per second while wandering. */
    speed: 48,
    /** How far a monster may wander from its spawn, in pixels. */
    leash: 96,
  },
  boar: {
    look: 'boar',
    name: 'Wild boar',
    maxHp: 70,
    speed: 32,
    leash: 64,
  },
} as const;

export type MonsterKey = keyof typeof MONSTER_TYPES;
export type MonsterType = (typeof MONSTER_TYPES)[MonsterKey];

export const MONSTER_KEYS = Object.keys(MONSTER_TYPES) as MonsterKey[];

export const isMonsterKey = (value: unknown): value is MonsterKey =>
  typeof value === 'string' && Object.hasOwn(MONSTER_TYPES, value);

/** Melee reach between two foot positions, in pixels. */
export const ATTACK_RANGE = 44;

/** 12 ticks at 20 Hz: something over half a second between two hits. */
export const ATTACK_COOLDOWN_TICKS = 12;

/** Damage one player hit does. Stats arrive in a later slice. */
export const PLAYER_DAMAGE = 12;

/** 200 ticks = ten seconds until a killed monster comes back. */
export const MONSTER_RESPAWN_TICKS = 200;

export const withinAttackRange = (
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean => Math.hypot(to.x - from.x, to.y - from.y) <= ATTACK_RANGE;

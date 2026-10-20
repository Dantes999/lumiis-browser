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
    /** Pixels per second while chasing a player. */
    chaseSpeed: 96,
    /** How far a monster may wander from its spawn, in pixels. */
    leash: 96,
    /** A player closer than this becomes the target. */
    aggro: 140,
    /** Damage per bite. */
    damage: 8,
    /** Experience for the player who kills it. */
    exp: 24,
    /** Yang dropped, as a range. */
    yangMin: 6,
    yangMax: 14,
    /** What it leaves behind. */
    drops: [
      { key: 'wolf_fur', chance: 0.65, min: 1, max: 2 },
      { key: 'iron_sword', chance: 0.05, min: 1, max: 1 },
      { key: 'great_sword', chance: 0.05, min: 1, max: 1 },
    ],
  },
  boar: {
    look: 'boar',
    name: 'Wild boar',
    maxHp: 70,
    speed: 32,
    chaseSpeed: 64,
    leash: 64,
    aggro: 100,
    damage: 12,
    exp: 45,
    yangMin: 10,
    yangMax: 22,
    drops: [
      { key: 'boar_tusk', chance: 0.7, min: 1, max: 1 },
      { key: 'padded_armor', chance: 0.08, min: 1, max: 1 },
      { key: 'plate_armor', chance: 0.02, min: 1, max: 1 },
    ],
  },
  /** A standing target for testing swings and reach; never fights back. */
  dummy: {
    look: 'dummy',
    name: 'Training dummy',
    maxHp: 100000,
    speed: 0,
    chaseSpeed: 0,
    leash: 0,
    aggro: 0,
    damage: 0,
    exp: 0,
    yangMin: 0,
    yangMax: 0,
    drops: [],
  },
} as const;

export type MonsterKey = keyof typeof MONSTER_TYPES;
export type MonsterType = (typeof MONSTER_TYPES)[MonsterKey];

export const MONSTER_KEYS = Object.keys(MONSTER_TYPES) as MonsterKey[];

export const isMonsterKey = (value: unknown): value is MonsterKey =>
  typeof value === 'string' && Object.hasOwn(MONSTER_TYPES, value);



/** 12 ticks at 20 Hz: something over half a second between two hits. */
export const ATTACK_COOLDOWN_TICKS = 12;

/** Damage one player hit does. Stats arrive in a later slice. */
export const PLAYER_DAMAGE = 12;

/** 200 ticks = ten seconds until a killed monster comes back. */
export const MONSTER_RESPAWN_TICKS = 200;

/** How close a monster has to be to bite. */
export const MONSTER_ATTACK_RANGE = 40;

/** 20 ticks = one bite per second. */
export const MONSTER_ATTACK_COOLDOWN_TICKS = 20;

/** A monster gives up when the target is this many aggro radii away. */
export const MONSTER_GIVE_UP_FACTOR = 2.5;

/** Player health until character stats arrive. */
export const PLAYER_MAX_HP = 100;

/** 60 ticks = three seconds lying on the ground. */
export const PLAYER_RESPAWN_TICKS = 60;

/** Coming back at full health would make death meaningless. */
export const PLAYER_RESPAWN_HP_SHARE = 0.5;

/** Health regained per regeneration step (one second). */
export const PLAYER_REGEN_HP = 1;

/** 20 ticks = one point of health per second while alive. */
export const PLAYER_REGEN_TICKS = 20;

/** How long a slain monster stays on screen before it disappears. */
export const MONSTER_DEATH_TICKS = 8;


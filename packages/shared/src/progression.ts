// Experience and levels.
//
// The curve is a placeholder until the wiki values are ported; it lives here so
// server and client always agree on how far the next level is.

export const MAX_LEVEL = 99;

/** The four character stats; every point is spent by the player. */
export type Stats = { str: number; vit: number; int: number; dex: number };
export type StatKey = keyof Stats;

export const STAT_KEYS: readonly StatKey[] = ['str', 'vit', 'int', 'dex'];
export const EMPTY_STATS: Stats = { str: 0, vit: 0, int: 0, dex: 0 };

export const isStatKey = (value: unknown): value is StatKey =>
  value === 'str' || value === 'vit' || value === 'int' || value === 'dex';

// EIGENE WAHL: stat weights until the wiki values are ported. They are shared so
// the server and the HUD never disagree about what a point does.
export const STAT_HP_PER_VIT = 8;
export const STAT_SP_PER_INT = 4;
export const STAT_ATTACK_PER_STR = 2;
/** Two points of dexterity give one point of defence. */
export const STAT_DEFENSE_PER_DEX = 2;
export const STAT_POINTS_PER_LEVEL = 3;
/** A new character may already put a few points in. */
export const STAT_START_POINTS = 6;

/**
 * Experience needed to get from `level` to the next one.
 * Level 1 needs 50, level 10 about 2000, level 50 about 27000.
 */
export function expForNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return Math.round(50 * Math.pow(Math.max(1, level), 1.6));
}

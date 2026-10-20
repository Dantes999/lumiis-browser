// Experience and levels.
//
// The curve is a placeholder until the wiki values are ported; it lives here so
// server and client always agree on how far the next level is.

export const MAX_LEVEL = 99;

/**
 * Experience needed to get from `level` to the next one.
 * Level 1 needs 50, level 10 about 2000, level 50 about 27000.
 */
export function expForNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return Math.round(50 * Math.pow(Math.max(1, level), 1.6));
}

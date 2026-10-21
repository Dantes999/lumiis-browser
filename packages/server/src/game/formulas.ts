// All the arithmetic of the game, in one place.
//
// Every number a server tick computes goes through here, so tuning balance or
// hunting a "why did that deal 47 damage?" bug starts in this file instead of
// somewhere in the middle of the world class.
//
// Everything here is a pure function: same input, same output, no state.

import { PLAYER_DAMAGE, SKILLS, type SkillKey } from '@lumiis/shared';

/** Attack of a player: bare hand + weapon + aura buff. */
export function attackDamage(weaponAttack: number, buffs: ReadonlyMap<SkillKey, number>): number {
  const aura = buffs.has('aura') ? (SKILLS.aura.attackBonus ?? 0) : 0;
  return PLAYER_DAMAGE + weaponAttack + aura;
}

/** What a blow really removes after armour. A hit always takes at least one. */
export function damageTaken(rawDamage: number, defense: number): number {
  return Math.max(1, rawDamage - defense);
}

/** A whole number in [min, max], both ends included. */
export function rollBetween(min: number, max: number, random: () => number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One player's share of a reward, as a fraction of the total damage dealt. */
export function damagePortion(part: number, total: number): number {
  return total <= 0 ? 0 : part / total;
}

/** Whirlwind damage: a multiple of the normal attack, rounded. */
export function whirlwindDamage(attack: number, scale: number): number {
  return Math.round(attack * scale);
}

/** Health restored by one regeneration step. */
export function regeneratedHp(hp: number, maxHp: number, amount: number): number {
  return Math.min(maxHp, hp + amount);
}

/** Health a player comes back with after dying. */
export function revivedHp(maxHp: number, share: number): number {
  return Math.max(1, Math.round(maxHp * share));
}

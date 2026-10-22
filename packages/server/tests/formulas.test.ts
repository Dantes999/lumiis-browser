// The pure arithmetic of the game: attack, magic, defence and what a blow
// really removes. These numbers are shared by skills, monsters and the HUD.

import { describe, expect, it } from 'vitest';
import { PLAYER_DAMAGE } from '@lumiis/shared';
import { magicAttackDamage, magicDefense } from '../src/game/formulas.js';

describe('formulas', () => {
  it('builds magic attack from the weapon, or half its physical value', () => {
    // A weapon with its own magic value uses it.
    expect(magicAttackDamage(6, 10, 0)).toBe(PLAYER_DAMAGE + 6);
    // Without one, half the physical attack counts.
    expect(magicAttackDamage(0, 10, 0)).toBe(PLAYER_DAMAGE + 5);
    // INT adds two points per point.
    expect(magicAttackDamage(0, 4, 10)).toBe(PLAYER_DAMAGE + 2 + 20);
    // A bare hand has neither.
    expect(magicAttackDamage(0, 0, 0)).toBe(PLAYER_DAMAGE);
  });

  it('builds magic defence from INT, VIT and half the armour', () => {
    expect(magicDefense(0, 0, 0)).toBe(0);
    expect(magicDefense(10, 3, 4)).toBe(5 + 1 + 2);
    expect(magicDefense(1, 1, 1)).toBe(0);
  });
});

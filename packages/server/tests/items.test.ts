// The item table feeds the tooltip and the server alike; these tests keep the
// data complete enough to describe every item a player can hold.

import { describe, expect, it } from 'vitest';
import { ITEMS, ITEM_KEYS, describeItem, isEquippable, requiredLevel } from '@lumiis/shared';

describe('items', () => {
  it('gives every item a name, a type and a colour', () => {
    for (const key of ITEM_KEYS) {
      const def = ITEMS[key];
      expect(def.name.length, key).toBeGreaterThan(0);
      expect(['weapon', 'armor', 'material'], key).toContain(def.type);
      expect(def.color, key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.stackMax, key).toBeGreaterThan(0);
    }
  });

  it('gives every wearable item a slot, an icon and a level', () => {
    for (const key of ITEM_KEYS) {
      const def = ITEMS[key];
      if (!isEquippable(key)) continue;

      expect(def.slot, key).toBeDefined();
      expect(def.icon, key).toBeTruthy();
      expect(def.level ?? 0, key).toBeGreaterThanOrEqual(0);
      expect((def.attack ?? 0) + (def.defense ?? 0), key).toBeGreaterThan(0);
    }
  });

  it('describes a sword for the tooltip', () => {
    const info = describeItem('iron_sword');
    expect(info.name).toBe('Eisenschwert');
    expect(info.typeName).toBe('Waffe');
    expect(info.level).toBe(1);
    expect(info.stats).toEqual([{ label: 'Angriff', value: 7 }]);
    expect(info.desc.length).toBeGreaterThan(0);
    expect(info.icon).toContain('weapon/');
  });

  it('describes armour with defence and health', () => {
    const info = describeItem('padded_armor');
    expect(info.typeName).toBe('Rüstung');
    expect(info.stats).toEqual([
      { label: 'Verteidigung', value: 3 },
      { label: 'Max. HP', value: 10 },
    ]);
  });

  it('reports the level requirement, zero for materials and starter gear', () => {
    expect(requiredLevel('wooden_sword')).toBe(0);
    expect(requiredLevel('wolf_fur')).toBe(0);
    expect(requiredLevel('plate_armor')).toBe(18);
    expect(describeItem('wolf_fur').typeName).toBe('Material');
  });
});

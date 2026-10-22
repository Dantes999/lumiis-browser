// The class table and its link to the art: every class-and-sex combination must
// exist in the style manifest, otherwise a new character would have no body.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  CLASS_KEYS,
  SEXES,
  bodyIdFor,
  classOfBody,
  isClassKey,
  isSex,
} from '@lumiis/shared';

const styles = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../client/src/styles.json', import.meta.url)),
    'utf8',
  ),
) as { packs: Record<string, { bodies: Array<{ id: string }> }> };

describe('classes', () => {
  it('gives every class a name, base stats and attack stats', () => {
    for (const key of CLASS_KEYS) {
      const def = CLASSES[key];
      expect(def.name.length, key).toBeGreaterThan(0);
      expect(def.hp, key).toBeGreaterThan(0);
      expect(def.sp, key).toBeGreaterThan(0);
      expect(def.hpPerLevel, key).toBeGreaterThanOrEqual(0);
      expect(def.spPerLevel, key).toBeGreaterThanOrEqual(0);
      expect(def.atkStats, key).toHaveLength(2);
      expect(def.base[def.mainStat], key).toBeGreaterThan(0);
      expect(Object.values(def.base).every((value) => value >= 0), key).toBe(true);
    }
  });

  it('has a body for every class and sex in the style manifest', () => {
    const bodies = new Set(
      Object.values(styles.packs).flatMap((pack) => pack.bodies.map((body) => body.id)),
    );
    for (const cls of CLASS_KEYS) {
      for (const sex of SEXES) {
        expect(bodies.has(bodyIdFor(cls, sex)), `${cls}_${sex}`).toBe(true);
      }
    }
  });

  it('reads a look id back into class and sex, with a safe fallback', () => {
    expect(classOfBody('shaman_f')).toEqual({ cls: 'shaman', sex: 'f' });
    expect(classOfBody('ninja_m')).toEqual({ cls: 'ninja', sex: 'm' });
    expect(classOfBody('')).toEqual({ cls: 'warrior', sex: 'm' });
    expect(classOfBody('something_else')).toEqual({ cls: 'warrior', sex: 'm' });
  });

  it('recognises only known classes and sexes', () => {
    for (const cls of CLASS_KEYS) expect(isClassKey(cls)).toBe(true);
    for (const bad of ['archer', '', 1, null, undefined]) expect(isClassKey(bad)).toBe(false);
    expect(isSex('m')).toBe(true);
    expect(isSex('f')).toBe(true);
    for (const bad of ['x', '', 1, null]) expect(isSex(bad)).toBe(false);
  });
});

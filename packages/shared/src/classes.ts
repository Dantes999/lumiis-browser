// The four classes: base stats, primary/secondary attack stats and the health
// and skill-point curves.
//
// Numbers follow the old project (shared/classes.js), scaled to this game's
// smaller damage and health range (base HP 100, base SP 60 instead of 600/200).
// EIGENE WAHL: the scale factor and the per-level values; the relative order
// (shaman tough, ninja fast/agile) is the old one.

import { PLAYER_MAX_HP, PLAYER_MAX_SP } from './monsters.js';
import type { Stats } from './progression.js';

export type ClassKey = 'warrior' | 'ninja' | 'sura' | 'shaman';
export type Sex = 'm' | 'f';

export type ClassDef = {
  key: ClassKey;
  name: string;
  /** Stats a new character starts with (old project: JobInitialPoints). */
  base: Stats;
  /** The stat the class is built around. */
  mainStat: keyof Stats;
  /** Primary and secondary stat for the attack value (old: atkStats). */
  atkStats: [keyof Stats, keyof Stats];
  /** Base health and skill points at level 1. */
  hp: number;
  sp: number;
  /** Added per level after the first. */
  hpPerLevel: number;
  spPerLevel: number;
};

export const CLASSES: Record<ClassKey, ClassDef> = {
  warrior: {
    key: 'warrior',
    name: 'Krieger',
    base: { vit: 4, int: 3, str: 6, dex: 3 },
    mainStat: 'str',
    atkStats: ['str', 'dex'],
    hp: PLAYER_MAX_HP,
    sp: PLAYER_MAX_SP,
    hpPerLevel: 6,
    spPerLevel: 2,
  },
  ninja: {
    key: 'ninja',
    name: 'Ninja',
    base: { vit: 3, int: 3, str: 4, dex: 6 },
    mainStat: 'dex',
    atkStats: ['dex', 'str'],
    hp: 105,
    sp: 60,
    hpPerLevel: 5,
    spPerLevel: 3,
  },
  sura: {
    key: 'sura',
    name: 'Sura',
    base: { vit: 3, int: 5, str: 5, dex: 3 },
    mainStat: 'str',
    atkStats: ['str', 'dex'],
    hp: 108,
    sp: 65,
    hpPerLevel: 6,
    spPerLevel: 3,
  },
  shaman: {
    key: 'shaman',
    name: 'Schamane',
    base: { vit: 4, int: 6, str: 3, dex: 3 },
    mainStat: 'int',
    atkStats: ['int', 'dex'],
    hp: 115,
    sp: 70,
    hpPerLevel: 6,
    spPerLevel: 4,
  },
};

export const CLASS_KEYS: readonly ClassKey[] = ['warrior', 'ninja', 'sura', 'shaman'];
export const SEXES: readonly Sex[] = ['m', 'f'];
export const SEX_NAMES: Record<Sex, string> = { m: 'Mann', f: 'Frau' };

export const isClassKey = (value: unknown): value is ClassKey =>
  typeof value === 'string' && Object.hasOwn(CLASSES, value);

export const isSex = (value: unknown): value is Sex => value === 'm' || value === 'f';

/** Look id of a class and sex, as the style manifest names it (warrior_m). */
export const bodyIdFor = (cls: ClassKey, sex: Sex): string => `${cls}_${sex}`;

/** The class and sex a look id belongs to; falls back to warrior/m. */
export function classOfBody(body: string): { cls: ClassKey; sex: Sex } {
  const match = /^([a-z]+)_([mf])$/.exec(body);
  if (match === null) return { cls: 'warrior', sex: 'm' };
  const cls = match[1];
  const sex = match[2];
  return {
    cls: isClassKey(cls) ? cls : 'warrior',
    sex: isSex(sex) ? sex : 'm',
  };
}

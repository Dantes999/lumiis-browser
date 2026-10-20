// Items, stacks and the inventory size.
//
// One table for both sides: the client draws what the server hands out, and the
// server never invents an item the client cannot name.

export type ItemSlot = 'weapon' | 'armor';

/** Which weapon pose and sheet a weapon uses. */
export type WeaponArt = 'schwert' | 'zweihand';

export type ItemDef = {
  name: string;
  /** How many fit in one slot. */
  stackMax: number;
  /** Placeholder colour until the real icons are ported. */
  color: string;

  /** Present when the item can be worn. */
  slot?: ItemSlot;
  attack?: number;
  defense?: number;
  maxHp?: number;

  /** Weapons: pose and sheet. */
  weaponArt?: WeaponArt;
  stage?: number;

  /** Armour: file name inside ruestungen/<class>_<sex>/, without .png. */
  armorFile?: string;
};

export const ITEMS = {
  wolf_fur: { name: 'Wolf pelt', stackMax: 50, color: '#9aa3ad' },
  boar_tusk: { name: 'Boar tusk', stackMax: 50, color: '#d8c07a' },

  wooden_sword: {
    name: 'Wooden sword',
    stackMax: 1,
    color: '#b08a5a',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 0,
    attack: 4,
  },
  iron_sword: {
    name: 'Iron sword',
    stackMax: 1,
    color: '#c8ccd4',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 2,
    attack: 9,
  },
  // EIGENE WAHL: there was no two-handed weapon yet. Slower than a sword,
  // but it reaches further and one swing can catch three monsters.
  great_sword: {
    name: 'Great sword',
    stackMax: 1,
    color: '#cfd6e0',
    slot: 'weapon',
    weaponArt: 'zweihand',
    stage: 3,
    attack: 14,
  },
  padded_armor: {
    name: 'Padded armour',
    stackMax: 1,
    color: '#8f7a5c',
    slot: 'armor',
    armorFile: '01_moenchsplattenpanzer',
    defense: 3,
    maxHp: 10,
  },
  plate_armor: {
    name: 'Tiger plate armour',
    stackMax: 1,
    color: '#b4623c',
    slot: 'armor',
    armorFile: '03_tiger_plattenpanzer',
    defense: 6,
    maxHp: 25,
  },
} as const satisfies Record<string, ItemDef>;

export type ItemKey = keyof typeof ITEMS;

export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];

export const isItemKey = (value: unknown): value is ItemKey =>
  typeof value === 'string' && Object.hasOwn(ITEMS, value);

export const itemDef = (key: ItemKey): ItemDef => ITEMS[key];

export const isEquippable = (key: ItemKey): boolean => itemDef(key).slot !== undefined;

/** 5 x 4 slots. */
export const INVENTORY_SLOTS = 20;

/** How close a player has to stand to pick something up. */
export const PICKUP_RANGE = 24;

/** A drop belongs to the killer for five seconds before anyone may take it. */
export const DROP_PROTECT_TICKS = 100;

export type InventorySlot = { key: ItemKey; count: number } | null;

export type Equipment = {
  weapon: ItemKey | null;
  armor: ItemKey | null;
};

export const EMPTY_EQUIPMENT: Equipment = { weapon: null, armor: null };

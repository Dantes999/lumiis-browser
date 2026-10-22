// Items, stacks and the inventory size.
//
// One table for both sides: the client draws what the server hands out, and the
// server never invents an item the client cannot name.
//
// Names, levels and looks come from the old project (Metin2): swords follow the
// wiki line, armour follows the first plattenpanzer tiers. The numbers are on
// this game's smaller scale (monsters here have tens of HP, not hundreds).

export type ItemSlot = 'weapon' | 'armor';

/** What an item is; the tooltip shows this word. */
export type ItemType = 'weapon' | 'armor' | 'material' | 'consumable';

/** Which weapon pose and sheet a weapon uses. */
export type WeaponArt = 'schwert' | 'zweihand';

export type ItemDef = {
  name: string;
  type: ItemType;
  /** How many fit in one slot. */
  stackMax: number;
  /** Placeholder colour; shown when there is no icon. */
  color: string;
  /** Icon path below /assets/icons/, e.g. "weapon/sword_5.png". */
  icon?: string;
  /** Level needed to wear it; 0 means anyone. */
  level?: number;
  /** Flavour text, shown in the tooltip. */
  desc?: string;

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

  /** Consumables: hit points and skill points restored. */
  heal?: number;
  mana?: number;
};

export const ITEMS = {
  wolf_fur: {
    name: 'Wolfsfell',
    type: 'material',
    stackMax: 50,
    color: '#9aa3ad',
    icon: 'material/wolf_claw.png',
    desc: 'Dickes Fell. Händler zahlen dafür.',
  },
  boar_tusk: {
    name: 'Keilerhauer',
    type: 'material',
    stackMax: 50,
    color: '#d8c07a',
    icon: 'material/boar_tusk.png',
    desc: 'Ein Hauer, hart wie Stein.',
  },

  wooden_sword: {
    name: 'Holzschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#b08a5a',
    icon: 'weapon/sword_1.png',
    level: 0,
    desc: 'Ein Übungsschwert aus Holz. Besser als die bloße Faust.',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 0,
    attack: 4,
  },
  iron_sword: {
    name: 'Eisenschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#c8ccd4',
    icon: 'weapon/sword_5.png',
    level: 1,
    desc: 'Schlicht, aber scharf genug für die Wölfe am Waldrand.',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 2,
    attack: 7,
  },
  langschwert: {
    name: 'Langschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#d3d8e0',
    icon: 'weapon/sword_10.png',
    level: 5,
    desc: 'Länger als das Eisenschwert, noch mit einer Hand geführt.',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 3,
    attack: 10,
  },
  // EIGENE WAHL: there was no two-handed weapon in the wiki line yet. Slower
  // than a sword, but it reaches further and one swing can catch three monsters.
  great_sword: {
    name: 'Großschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#cfd6e0',
    icon: 'weapon/twohand_10.png',
    level: 10,
    desc: 'Zweihändig, langsam, aber es trifft alles im Bogen.',
    slot: 'weapon',
    weaponArt: 'zweihand',
    stage: 3,
    attack: 14,
  },
  bambusschwert: {
    name: 'Bambusschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#c9d69a',
    icon: 'weapon/sword_15.png',
    level: 15,
    desc: 'Leicht und schnell; die Klinge federt beim Treffer.',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 4,
    attack: 18,
  },
  breitschwert: {
    name: 'Breitschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#b9c2cc',
    icon: 'weapon/sword_20.png',
    level: 20,
    desc: 'Breite Klinge, die auch eine Rüstung nicht gern sieht.',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 5,
    attack: 24,
  },
  silberschwert: {
    name: 'Silberschwert',
    type: 'weapon',
    stackMax: 1,
    color: '#e6eaf2',
    icon: 'weapon/sword_25.png',
    level: 25,
    desc: 'Für die, die es bis an den Rand des Waldes geschafft haben.',
    slot: 'weapon',
    weaponArt: 'schwert',
    stage: 6,
    attack: 30,
  },

  padded_armor: {
    name: 'Mönchsplattenpanzer',
    type: 'armor',
    stackMax: 1,
    color: '#8f7a5c',
    icon: 'armor/armor_warrior_1.png',
    level: 0,
    desc: 'Der erste richtige Schutz: Leder, genietet und gepolstert.',
    slot: 'armor',
    armorFile: '01_moenchsplattenpanzer',
    defense: 3,
    maxHp: 10,
  },
  eisenplattenpanzer: {
    name: 'Eisenplattenpanzer',
    type: 'armor',
    stackMax: 1,
    color: '#9aa4ae',
    icon: 'armor/armor_warrior_9.png',
    level: 9,
    desc: 'Eisen statt Leder; hält auch einem Keiler stand.',
    slot: 'armor',
    armorFile: '02_eisenplattenpanzer',
    defense: 5,
    maxHp: 16,
  },
  plate_armor: {
    name: 'Tiger-Plattenpanzer',
    type: 'armor',
    stackMax: 1,
    color: '#b4623c',
    icon: 'armor/armor_warrior_18.png',
    level: 18,
    desc: 'Mit breiten Schultern und dem Zeichen des Tigers.',
    slot: 'armor',
    armorFile: '03_tiger_plattenpanzer',
    defense: 7,
    maxHp: 25,
  },
  loewenplattenpanzer: {
    name: 'Löwenplattenpanzer',
    type: 'armor',
    stackMax: 1,
    color: '#c8a24a',
    icon: 'armor/armor_warrior_26.png',
    level: 26,
    desc: 'Schwer, aber kaum zu durchschlagen.',
    slot: 'armor',
    armorFile: '04_loewenplattenpanzer',
    defense: 9,
    maxHp: 35,
  },
  // EIGENE WAHL: potion amounts and stack size until the wiki values are set.
  small_hp_potion: {
    name: 'Kleiner Heiltrank',
    type: 'consumable',
    stackMax: 200,
    color: '#b8433f',
    icon: 'material/potion_red.png',
    heal: 40,
    desc: 'Schließt kleine Wunden. Heilt 40 TP.',
  },
  small_sp_potion: {
    name: 'Kleiner Manatrank',
    type: 'consumable',
    stackMax: 200,
    color: '#3f6fb8',
    icon: 'material/potion_blue.png',
    mana: 25,
    desc: 'Klärt den Kopf. Gibt 25 SP.',
  },
} as const satisfies Record<string, ItemDef>;

export type ItemKey = keyof typeof ITEMS;

export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];

export const isItemKey = (value: unknown): value is ItemKey =>
  typeof value === 'string' && Object.hasOwn(ITEMS, value);

export const itemDef = (key: ItemKey): ItemDef => ITEMS[key];

export const isEquippable = (key: ItemKey): boolean => itemDef(key).slot !== undefined;

export const isConsumable = (key: ItemKey): boolean => itemDef(key).type === 'consumable';

/** Level needed to wear an item; 0 when it has no requirement. */
export const requiredLevel = (key: ItemKey): number => itemDef(key).level ?? 0;

/** What the tooltip needs, worked out once from the table. */
export type ItemInfo = {
  name: string;
  typeName: string;
  icon: string;
  level: number;
  stats: Array<{ label: string; value: number }>;
  desc: string;
  stackMax: number;
};

const TYPE_NAMES: Record<ItemType, string> = {
  weapon: 'Waffe',
  armor: 'Rüstung',
  material: 'Material',
  consumable: 'Trank',
};

export function describeItem(key: ItemKey): ItemInfo {
  const def: ItemDef = ITEMS[key];
  const stats: Array<{ label: string; value: number }> = [];

  if (def.attack !== undefined) stats.push({ label: 'Angriff', value: def.attack });
  if (def.defense !== undefined) stats.push({ label: 'Verteidigung', value: def.defense });
  if (def.maxHp !== undefined) stats.push({ label: 'Max. HP', value: def.maxHp });
  if (def.heal !== undefined) stats.push({ label: 'Heilung', value: def.heal });
  if (def.mana !== undefined) stats.push({ label: 'Mana', value: def.mana });

  return {
    name: def.name,
    typeName: TYPE_NAMES[def.type],
    icon: def.icon ?? '',
    level: def.level ?? 0,
    stats,
    desc: def.desc ?? '',
    stackMax: def.stackMax,
  };
}

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

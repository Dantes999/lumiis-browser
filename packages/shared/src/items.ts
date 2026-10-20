// Items, stacks and the inventory size.
//
// One table for both sides: the client draws what the server hands out, and the
// server never invents an item the client cannot name.

export type ItemDef = {
  name: string;
  /** How many fit in one slot. */
  stackMax: number;
  /** Placeholder colour until the real icons are ported. */
  color: string;
};

export const ITEMS = {
  wolf_fur: { name: 'Wolf pelt', stackMax: 50, color: '#9aa3ad' },
  boar_tusk: { name: 'Boar tusk', stackMax: 50, color: '#d8c07a' },
} as const;

export type ItemKey = keyof typeof ITEMS;

export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];

export const isItemKey = (value: unknown): value is ItemKey =>
  typeof value === 'string' && Object.hasOwn(ITEMS, value);

/** 5 x 4 slots. */
export const INVENTORY_SLOTS = 20;

/** How close a player has to stand to pick something up. */
export const PICKUP_RANGE = 24;

/** A drop belongs to the killer for five seconds before anyone may take it. */
export const DROP_PROTECT_TICKS = 100;

export type InventorySlot = { key: ItemKey; count: number } | null;

// The wire format between client and server.
//
// Rule: the client only ever expresses intent. It never states facts about the
// world (no positions, no damage, no inventory). The server validates every
// message here and decides what actually happens.

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  NAME_PATTERN,
  PROTOCOL_VERSION,
} from './constants.js';
import { isItemKey, type InventorySlot } from './items.js';

export type PlayerSnapshot = {
  id: number;
  name: string;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  yang: number;
};

export type MonsterSnapshot = {
  id: number;
  key: string;
  x: number;
  y: number;
  dir: number;
  hp: number;
  maxHp: number;
  moving: boolean;
};

export type GroundItemSnapshot = {
  id: number;
  key: string;
  x: number;
  y: number;
  count: number;
};

/** Messages the client may send. */
export type ClientMessage =
  | { t: 'login'; name: string; password: string; mode: 'login' | 'register' }
  | { t: 'input'; dx: number; dy: number }
  | { t: 'attack'; target: number }
  | { t: 'pickup'; target: number }
  | { t: 'settings'; autoPickup: boolean; autoPickupTypes: string[] }
  | { t: 'ping'; at: number };

/** Messages the server may send. */
export type ServerMessage =
  | { t: 'welcome'; id: number; protocol: number; tickRate: number; tick: number }
  | {
      t: 'snapshot';
      tick: number;
      players: PlayerSnapshot[];
      monsters: MonsterSnapshot[];
      ground: GroundItemSnapshot[];
    }
  | { t: 'inventory'; slots: (InventorySlot | null)[] }
  | { t: 'authError'; reason: string }
  | { t: 'pong'; at: number }
  | { t: 'notice'; text: string };

export type ParsedMessage =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string };

const fail = (reason: string): ParsedMessage => ({ ok: false, reason });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Input components are whole numbers in -1..1. Anything else is not movement. */
const isUnitStep = (value: unknown): value is number =>
  value === -1 || value === 0 || value === 1;

/**
 * Validates one decoded client message.
 * Returns the typed message or a short reason the server can log.
 */
export function parseClientMessage(input: unknown): ParsedMessage {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('message is not an object');
  }

  const message = input as Record<string, unknown>;

  switch (message.t) {
    case 'login': {
      const name = message.name;
      const password = message.password;
      const mode = message.mode;

      if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return fail('invalid name');
      if (
        typeof password !== 'string' ||
        password.length < MIN_PASSWORD_LENGTH ||
        password.length > MAX_PASSWORD_LENGTH
      ) {
        return fail('invalid password');
      }
      if (mode !== 'login' && mode !== 'register') return fail('invalid login mode');

      return { ok: true, message: { t: 'login', name, password, mode } };
    }

    case 'input': {
      const dx = message.dx;
      const dy = message.dy;
      if (!isUnitStep(dx) || !isUnitStep(dy)) {
        return fail('input needs dx and dy in -1..1');
      }
      // (0, 0) is a valid input: it means "stop here".
      return { ok: true, message: { t: 'input', dx, dy } };
    }

    case 'attack': {
      const target = message.target;
      if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) {
        return fail('attack needs a monster id');
      }
      return { ok: true, message: { t: 'attack', target } };
    }

    case 'pickup': {
      const target = message.target;
      if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) {
        return fail('pickup needs an item id');
      }
      return { ok: true, message: { t: 'pickup', target } };
    }

    case 'settings': {
      const autoPickup = message.autoPickup;
      const types = message.autoPickupTypes;

      if (typeof autoPickup !== 'boolean') return fail('settings need autoPickup');
      if (!Array.isArray(types) || types.length > 64) return fail('settings need a type list');
      if (!types.every((entry) => typeof entry === 'string')) {
        return fail('settings types must be strings');
      }

      const autoPickupTypes = types as string[];
      for (const type of autoPickupTypes) {
        if (!isItemKey(type)) return fail(`unknown item type in settings: ${type}`);
      }
      return { ok: true, message: { t: 'settings', autoPickup, autoPickupTypes } };
    }

    case 'ping': {
      if (!isFiniteNumber(message.at)) {
        return fail('ping without timestamp');
      }
      return { ok: true, message: { t: 'ping', at: message.at } };
    }

    default:
      return fail('unknown message type');
  }
}

export const encode = (message: ServerMessage | ClientMessage): string => JSON.stringify(message);

/** Decodes a raw frame. Returns null when the bytes are not JSON at all. */
export function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

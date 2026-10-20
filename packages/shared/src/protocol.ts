// The wire format between client and server.
//
// Rule: the client only ever expresses intent. It never states facts about the
// world (no positions, no damage, no inventory). The server validates every
// message here and decides what actually happens.

import { NAME_PATTERN, PROTOCOL_VERSION } from './constants.js';
import type { InventorySlot } from './items.js';

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
  | { t: 'hello'; v: number; name: string }
  | { t: 'input'; dx: number; dy: number }
  | { t: 'attack'; target: number }
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
    case 'hello': {
      if (message.v !== PROTOCOL_VERSION) {
        return fail(`unsupported protocol version: ${String(message.v)}`);
      }
      if (typeof message.name !== 'string' || !NAME_PATTERN.test(message.name)) {
        return fail('invalid name');
      }
      return { ok: true, message: { t: 'hello', v: PROTOCOL_VERSION, name: message.name } };
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

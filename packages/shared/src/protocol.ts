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
import { isItemKey, type Equipment, type InventorySlot } from './items.js';
import { INVENTORY_SLOTS } from './items.js';
import { isDirection } from './movement.js';
import { isSkillKey, type SkillKey } from './skills.js';

/**
 * One compact update for an entity the client already knows.
 * `[id, x, y, dir, flags, hp]` — flags are the MOVE_* bits below.
 */
export type MoveEntry = [number, number, number, number, number, number];

/** One channel of a map and how many players are in it. */
export type ChannelInfo = { channel: number; players: number };

/** Bit flags inside a MoveEntry. */
export const MOVE_MOVING = 1;
export const MOVE_ATTACKING = 2;
export const MOVE_WHIRLWIND = 4;
export const MOVE_DEAD = 8;

export type PlayerSnapshot = {
  id: number;
  name: string;
  /** Look ids of the style pack manifest (body and headwear). */
  body?: string;
  hair?: string;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  yang: number;
  weapon: string | null;
  armor: string | null;
  /** Present only while a swing is running. */
  attacking?: boolean;
  /** Present briefly after a whirlwind, so other clients can show it. */
  whirlwind?: boolean;
  /** Active buffs with their remaining time in seconds; empty when none. */
  buffs?: Record<string, number>;
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
  /** Present only while the monster is in its short death animation. */
  dead?: boolean;
};

export type GroundItemSnapshot = {
  id: number;
  key: string;
  x: number;
  y: number;
  count: number;
};

/**
 * The server sends the whole view on arrival (`full: true`), afterwards only
 * what changed: new or restyled entities as full entries, movement as compact
 * tuples, and the ids that left. Everything else stays as it was on the client.
 */
export type SnapshotMessage = {
  t: 'snapshot';
  tick: number;
  /** Map this snapshot belongs to. */
  map: string;
  /** The lists are the whole view; the client drops everything first. */
  full?: boolean;
  /** Full entries: new entities (and the player himself, every time). */
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  ground: GroundItemSnapshot[];
  /** Known entities that moved, turned, fought or lost health. */
  move?: { players: MoveEntry[]; monsters: MoveEntry[] };
  /** Ids that left the view. */
  gone?: { players: number[]; monsters: number[]; ground: number[] };
};

/** Messages the client may send. */
export type ClientMessage =
  | { t: 'login'; name: string; password: string; mode: 'login' | 'register' }
  | { t: 'select'; id: number; channel?: number }
  | { t: 'channels'; id?: number }
  | { t: 'switchChannel'; channel: number }
  | { t: 'createCharacter'; name: string; body?: string; hair?: string }
  | { t: 'input'; dx: number; dy: number }
  | { t: 'attack'; target?: number; dir?: number }
  | { t: 'skill'; key: SkillKey }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; text: string }
  /** Chat text; commands /g (global) and /w Name (whisper) are parsed by the server. */
  | { t: 'chat'; text: string }
  | { t: 'resume'; token: string }
  | { t: 'pickup'; target: number }
  | { t: 'equip'; slot: number }
  | { t: 'unequip'; piece: 'weapon' | 'armor' }
  | { t: 'settings'; autoPickup: boolean; autoPickupTypes: string[] }
  | { t: 'ping'; at: number };

/** Messages the server may send. */
export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      protocol: number;
      tickRate: number;
      tick: number;
      /** Map the player is standing on. */
      map: string;
      /** Look ids of the style pack manifest (body and headwear). */
      body: string;
      hair: string;
      /** Channel number, 1 based. */
      channel: number;
      /** How many channels this map has. */
      channelCount: number;
    }
  | SnapshotMessage
  | { t: 'channels'; id: number | null; map: string; list: ChannelInfo[] }
  | { t: 'channel'; channel: number; count: number }
  | { t: 'inventory'; slots: (InventorySlot | null)[]; equipment: Equipment }
  | { t: 'characters'; list: CharacterSummary[]; max: number; token?: string }
  | { t: 'authError'; reason: string }
  | { t: 'pong'; at: number }
  | { t: 'notice'; text: string }
  | {
      t: 'chat';
      kind: 'map' | 'global' | 'whisper' | 'system';
      from: string;
      text: string;
      /** Set for whispers: the other side. */
      to?: string;
    }
  | {
      t: 'reward';
      /** Where the monster fell. */
      x: number;
      y: number;
      /** One entry per player who earned something, with their share. */
      shares: Array<{ id: number; exp: number; yang: number }>;
    };

export type CharacterSummary = { id: number; name: string; level: number };

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

      if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
        return fail('The name needs 3 to 16 letters, digits or underscore.');
      }
      if (
        typeof password !== 'string' ||
        password.length < MIN_PASSWORD_LENGTH ||
        password.length > MAX_PASSWORD_LENGTH
      ) {
        return fail(`The password needs ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`);
      }
      if (mode !== 'login' && mode !== 'register') return fail('That is not a login mode.');

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
      // A swing at nothing is allowed: it just goes wherever the body faces,
      // or wherever the player pointed at.
      const target = message.target;
      const rawDir = message.dir;

      if (rawDir !== undefined && !isDirection(rawDir)) return fail('attack dir must be 0..7');
      const dir = isDirection(rawDir) ? rawDir : undefined;

      if (target !== undefined) {
        if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) {
          return fail('attack target must be a monster id');
        }
        return { ok: true, message: { t: 'attack', target, dir } };
      }
      return { ok: true, message: { t: 'attack', dir } };
    }

    case 'skill': {
      const key = message.key;
      if (!isSkillKey(key)) return fail('skill needs a known skill');
      return { ok: true, message: { t: 'skill', key } };
    }

    case 'resume': {
      const token = message.token;
      if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
        return fail('resume needs a token');
      }
      return { ok: true, message: { t: 'resume', token } };
    }

    case 'log': {
      const level = message.level;
      const text = message.text;
      if (level !== 'info' && level !== 'warn' && level !== 'error') {
        return fail('log needs a level');
      }
      if (typeof text !== 'string' || text.length === 0 || text.length > 500) {
        return fail('log text must be 1 to 500 characters');
      }
      return { ok: true, message: { t: 'log', level, text } };
    }

    case 'chat': {
      const text = message.text;
      if (typeof text !== 'string') return fail('chat needs text');
      // Control characters would let a client paint over other lines.
      const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
      if (clean.length === 0) return fail('chat needs text');
      if (clean.length > 200) return fail('chat text is longer than 200 characters');
      return { ok: true, message: { t: 'chat', text: clean } };
    }

    case 'equip': {
      const slot = message.slot;
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
        return fail('equip needs an inventory slot');
      }
      if (slot >= INVENTORY_SLOTS) return fail('equip slot out of range');
      return { ok: true, message: { t: 'equip', slot } };
    }

    case 'unequip': {
      const piece = message.piece;
      if (piece !== 'weapon' && piece !== 'armor') return fail('unequip needs a piece');
      return { ok: true, message: { t: 'unequip', piece } };
    }

    case 'pickup': {
      const target = message.target;
      if (typeof target !== 'number' || !Number.isInteger(target) || target < 1) {
        return fail('pickup needs an item id');
      }
      return { ok: true, message: { t: 'pickup', target } };
    }

    case 'select': {
      const id = message.id;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
        return fail('select needs a character id');
      }

      const channel = message.channel;
      if (channel !== undefined) {
        if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 1 || channel > 64) {
          return fail('select channel must be 1..64');
        }
        return { ok: true, message: { t: 'select', id, channel } };
      }
      return { ok: true, message: { t: 'select', id } };
    }

    case 'channels': {
      const id = message.id;
      if (id === undefined) return { ok: true, message: { t: 'channels' } };
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
        return fail('channels needs a character id');
      }
      return { ok: true, message: { t: 'channels', id } };
    }

    case 'switchChannel': {
      const channel = message.channel;
      if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 1 || channel > 64) {
        return fail('switchChannel needs a channel in 1..64');
      }
      return { ok: true, message: { t: 'switchChannel', channel } };
    }

    case 'createCharacter': {
      const name = message.name;
      if (typeof name !== 'string' || !NAME_PATTERN.test(name)) return fail('invalid character name');

      // Look ids are chosen from the style pack; the server only checks the shape.
      const look = (value: unknown): string | undefined => {
        if (value === undefined) return undefined;
        if (typeof value !== 'string' || !/^[a-z0-9_]{0,24}$/.test(value)) return undefined;
        return value;
      };
      const body = look(message.body);
      const hair = look(message.hair);
      if (message.body !== undefined && body === undefined) return fail('invalid body id');
      if (message.hair !== undefined && hair === undefined) return fail('invalid hair id');

      return { ok: true, message: { t: 'createCharacter', name, body, hair } };
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

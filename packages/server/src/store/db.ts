// Accounts and character saves in one SQLite file.
//
// One process, one file: WAL mode, one transaction per save, and passwords
// hashed with scrypt. The hash is computed asynchronously, so a login does not
// stall the game loop.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import type { DatabaseSync as Database } from 'node:sqlite';
import { INVENTORY_SLOTS, isItemKey, type InventorySlot, type ItemKey } from '@lumiis/shared';

// node:sqlite is newer than the list of builtins Vite knows, so a static import
// breaks the test runner. Loading it through require works in both worlds.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: typeof Database };
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export type CharacterSave = {
  level: number;
  exp: number;
  yang: number;
  hp: number;
  map: string;
  x: number;
  y: number;
  dir: number;
  inventory: InventorySlot[];
};

export type AuthResult =
  | { ok: true; accountId: number; name: string; save: CharacterSave | null }
  | { ok: false; reason: string };

type AccountRow = { id: number; name: string; salt: string; hash: string };
type CharacterRow = {
  level: number;
  exp: number;
  yang: number;
  hp: number;
  map: string;
  x: number;
  y: number;
  dir: number;
};
type ItemRow = { slot: number; item_key: string; count: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS characters (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  yang INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  map TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  dir INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_items (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (account_id, slot)
);
`;

const hashPassword = async (password: string, salt: string): Promise<Buffer> =>
  (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

export class Store {
  private readonly db: Database;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  async register(name: string, password: string): Promise<AuthResult> {
    const existing = this.db.prepare('SELECT id FROM accounts WHERE name = ?').get(name);
    if (existing !== undefined) return { ok: false, reason: 'That name is already taken.' };

    const salt = randomBytes(16).toString('hex');
    const hash = (await hashPassword(password, salt)).toString('hex');

    try {
      const info = this.db
        .prepare('INSERT INTO accounts (name, salt, hash, created_at) VALUES (?, ?, ?, ?)')
        .run(name, salt, hash, Date.now());

      return { ok: true, accountId: Number(info.lastInsertRowid), name, save: null };
    } catch {
      // Two registrations for the same name at the same moment.
      return { ok: false, reason: 'That name is already taken.' };
    }
  }

  async login(name: string, password: string): Promise<AuthResult> {
    const row = this.db
      .prepare('SELECT id, name, salt, hash FROM accounts WHERE name = ?')
      .get(name) as unknown as AccountRow | undefined;

    if (row === undefined) {
      // Spend the same time as a real check, so a missing account is not faster.
      await hashPassword(password, 'no-such-account');
      return { ok: false, reason: 'Wrong name or password.' };
    }

    const hash = await hashPassword(password, row.salt);
    const expected = Buffer.from(row.hash, 'hex');

    if (hash.length !== expected.length || !timingSafeEqual(hash, expected)) {
      return { ok: false, reason: 'Wrong name or password.' };
    }

    this.db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);

    return { ok: true, accountId: row.id, name: row.name, save: this.loadCharacter(row.id) };
  }

  loadCharacter(accountId: number): CharacterSave | null {
    const row = this.db
      .prepare('SELECT level, exp, yang, hp, map, x, y, dir FROM characters WHERE account_id = ?')
      .get(accountId) as unknown as CharacterRow | undefined;

    if (row === undefined) return null;

    const items = this.db
      .prepare('SELECT slot, item_key, count FROM character_items WHERE account_id = ?')
      .all(accountId) as unknown as ItemRow[];

    const inventory = new Array<InventorySlot>(INVENTORY_SLOTS).fill(null);
    for (const item of items) {
      const slot = Number(item.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SLOTS) continue;
      if (!isItemKey(item.item_key)) continue;
      inventory[slot] = { key: item.item_key as ItemKey, count: Math.max(1, Number(item.count)) };
    }

    return {
      level: Number(row.level),
      exp: Number(row.exp),
      yang: Number(row.yang),
      hp: Number(row.hp),
      map: String(row.map),
      x: Number(row.x),
      y: Number(row.y),
      dir: Number(row.dir),
      inventory,
    };
  }

  /** Character and items in one transaction: a save is never half written. */
  saveCharacter(accountId: number, save: CharacterSave): void {
    const writeCharacter = this.db.prepare(`
      INSERT INTO characters (account_id, level, exp, yang, hp, map, x, y, dir, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        level = excluded.level,
        exp = excluded.exp,
        yang = excluded.yang,
        hp = excluded.hp,
        map = excluded.map,
        x = excluded.x,
        y = excluded.y,
        dir = excluded.dir,
        updated_at = excluded.updated_at
    `);
    const clearItems = this.db.prepare('DELETE FROM character_items WHERE account_id = ?');
    const writeItem = this.db.prepare(
      'INSERT INTO character_items (account_id, slot, item_key, count) VALUES (?, ?, ?, ?)',
    );

    this.db.exec('BEGIN IMMEDIATE');
    try {
      writeCharacter.run(
        accountId,
        save.level,
        save.exp,
        save.yang,
        save.hp,
        save.map,
        save.x,
        save.y,
        save.dir,
        Date.now(),
      );
      clearItems.run(accountId);

      save.inventory.forEach((slot, index) => {
        if (slot === null) return;
        writeItem.run(accountId, index, slot.key, slot.count);
      });

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

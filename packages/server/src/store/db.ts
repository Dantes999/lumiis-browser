// Accounts, characters and their items in one SQLite file.
//
// One process, one file: WAL mode, one transaction per save, and passwords
// hashed with scrypt. The hash is computed asynchronously, so a login does not
// stall the game loop.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import type { DatabaseSync as Database } from 'node:sqlite';
import {
  EMPTY_EQUIPMENT,
  INVENTORY_SLOTS,
  isItemKey,
  type Equipment,
  type InventorySlot,
  type ItemKey,
} from '@lumiis/shared';

// node:sqlite is newer than the list of builtins Vite knows, so a static import
// breaks the test runner. Loading it through require works in both worlds.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: typeof Database };

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/** Character slots per account. */
export const MAX_CHARACTERS = 4;

export type CharacterSummary = { id: number; name: string; level: number };

export type CharacterSave = {
  name: string;
  equipment: Equipment;
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
  | { ok: true; accountId: number; name: string }
  | { ok: false; reason: string };

export type CreateResult = { ok: true; id: number } | { ok: false; reason: string };

type AccountRow = { id: number; name: string; salt: string; hash: string };
type CharacterRow = {
  id: number;
  name: string;
  weapon: string | null;
  armor: string | null;
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  level INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  yang INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  map TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  dir INTEGER NOT NULL,
  weapon TEXT,
  armor TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_items (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (character_id, slot)
);

CREATE INDEX IF NOT EXISTS characters_by_account ON characters (account_id);
`;

const hashPassword = async (password: string, salt: string): Promise<Buffer> =>
  (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

export class Store {
  private readonly db: Database;
  private readonly stmtSaveCharacter: ReturnType<Database['prepare']>;
  private readonly stmtClearItems: ReturnType<Database['prepare']>;
  private readonly stmtWriteItem: ReturnType<Database['prepare']>;
  private written = 0;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    // WAL + NORMAL: a save no longer forces an fsync. A power cut can lose the
    // last seconds, but the file itself stays consistent.
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.db.exec(SCHEMA);
    this.ensureEquipmentColumns();

    // Prepared once. Preparing on every save was a measurable cost under load.
    this.stmtSaveCharacter = this.db.prepare(`
      UPDATE characters SET
        level = ?, exp = ?, yang = ?, hp = ?, map = ?, x = ?, y = ?, dir = ?,
        weapon = ?, armor = ?, updated_at = ?
      WHERE id = ?
    `);
    this.stmtClearItems = this.db.prepare('DELETE FROM character_items WHERE character_id = ?');
    this.stmtWriteItem = this.db.prepare(
      'INSERT INTO character_items (character_id, slot, item_key, count) VALUES (?, ?, ?, ?)',
    );
  }

  /** Saves from before equipment existed get the two new columns. */
  private ensureEquipmentColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info('characters')").all() as unknown as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'weapon')) {
      this.db.exec('ALTER TABLE characters ADD COLUMN weapon TEXT');
    }
    if (!columns.some((column) => column.name === 'armor')) {
      this.db.exec('ALTER TABLE characters ADD COLUMN armor TEXT');
    }
  }

  /**
   * The first version kept one character per account, keyed by account id.
   * Saves from that version are carried over instead of dropped.
   */
  private migrate(): void {
    const columns = this.db.prepare("PRAGMA table_info('characters')").all() as unknown as Array<{
      name: string;
    }>;
    if (columns.length === 0) return;
    if (columns.some((column) => column.name === 'id')) return;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
        ALTER TABLE characters RENAME TO characters_v1;
        ALTER TABLE character_items RENAME TO character_items_v1;

        CREATE TABLE characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
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

        CREATE TABLE character_items (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          slot INTEGER NOT NULL,
          item_key TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (character_id, slot)
        );

        INSERT INTO characters
          (id, account_id, name, level, exp, yang, hp, map, x, y, dir, updated_at)
        SELECT c.account_id, c.account_id, a.name, c.level, c.exp, c.yang, c.hp,
               c.map, c.x, c.y, c.dir, c.updated_at
        FROM characters_v1 c
        JOIN accounts a ON a.id = c.account_id;

        INSERT INTO character_items (character_id, slot, item_key, count)
        SELECT account_id, slot, item_key, count FROM character_items_v1;

        DROP TABLE characters_v1;
        DROP TABLE character_items_v1;
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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

      return { ok: true, accountId: Number(info.lastInsertRowid), name };
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
      return { ok: false, reason: 'Wrong name or password. New here? Use Create account.' };
    }

    const hash = await hashPassword(password, row.salt);
    const expected = Buffer.from(row.hash, 'hex');

    if (hash.length !== expected.length || !timingSafeEqual(hash, expected)) {
      return { ok: false, reason: 'Wrong name or password. New here? Use Create account.' };
    }

    this.db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
    return { ok: true, accountId: row.id, name: row.name };
  }

  listCharacters(accountId: number): CharacterSummary[] {
    const rows = this.db
      .prepare('SELECT id, name, level FROM characters WHERE account_id = ? ORDER BY id')
      .all(accountId) as unknown as Array<{ id: number; name: string; level: number }>;

    return rows.map((row) => ({ id: Number(row.id), name: row.name, level: Number(row.level) }));
  }

  createCharacter(accountId: number, name: string): CreateResult {
    const count = this.listCharacters(accountId).length;
    if (count >= MAX_CHARACTERS) {
      return { ok: false, reason: `You already have ${MAX_CHARACTERS} characters.` };
    }

    const taken = this.db.prepare('SELECT id FROM characters WHERE name = ?').get(name);
    if (taken !== undefined) return { ok: false, reason: 'That character name is taken.' };

    try {
      const info = this.db
        .prepare(
          `INSERT INTO characters
             (account_id, name, level, exp, yang, hp, map, x, y, dir, weapon, armor, updated_at)
           VALUES (?, ?, 1, 0, 0, 100, 'testmap', 0, 0, 0, 'wooden_sword', NULL, ?)`,
        )
        .run(accountId, name, Date.now());

      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch {
      return { ok: false, reason: 'That character name is taken.' };
    }
  }

  /** Only a character of this account may be loaded. */
  characterOwner(characterId: number): number | null {
    const row = this.db
      .prepare('SELECT account_id FROM characters WHERE id = ?')
      .get(characterId) as unknown as { account_id: number } | undefined;

    return row === undefined ? null : Number(row.account_id);
  }

  loadCharacter(characterId: number): CharacterSave | null {
    const row = this.db
      .prepare(
        'SELECT id, name, level, exp, yang, hp, map, x, y, dir, weapon, armor FROM characters WHERE id = ?',
      )
      .get(characterId) as unknown as CharacterRow | undefined;

    if (row === undefined) return null;

    const items = this.db
      .prepare('SELECT slot, item_key, count FROM character_items WHERE character_id = ?')
      .all(characterId) as unknown as ItemRow[];

    const inventory = new Array<InventorySlot>(INVENTORY_SLOTS).fill(null);
    for (const item of items) {
      const slot = Number(item.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SLOTS) continue;
      if (!isItemKey(item.item_key)) continue;
      inventory[slot] = { key: item.item_key as ItemKey, count: Math.max(1, Number(item.count)) };
    }

    const equipment: Equipment = {
      weapon: isItemKey(row.weapon) ? row.weapon : null,
      armor: isItemKey(row.armor) ? row.armor : null,
    };

    return {
      name: row.name,
      equipment,
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

  /** How many character saves have been written; shown in /status. */
  get saves(): number {
    return this.written;
  }

  /**
   * Writes one or many characters in a single transaction. Batching several
   * saves into one commit is much cheaper than one commit per player.
   */
  saveCharacters(entries: Array<{ characterId: number; save: CharacterSave }>): void {
    if (entries.length === 0) return;

    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { characterId, save } of entries) {
        this.stmtSaveCharacter.run(
          save.level,
          save.exp,
          save.yang,
          save.hp,
          save.map,
          save.x,
          save.y,
          save.dir,
          save.equipment.weapon,
          save.equipment.armor,
          now,
          characterId,
        );
        this.stmtClearItems.run(characterId);

        save.inventory.forEach((slot, index) => {
          if (slot === null) return;
          this.stmtWriteItem.run(characterId, index, slot.key, slot.count);
        });
      }

      this.db.exec('COMMIT');
      this.written += entries.length;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Character and items in one transaction: a save is never half written. */
  saveCharacter(characterId: number, save: CharacterSave): void {
    this.saveCharacters([{ characterId, save }]);
  }

  close(): void {
    this.db.close();
  }
}

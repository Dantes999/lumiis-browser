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
  CLASSES,
  EMPTY_EQUIPMENT,
  EMPTY_STATS,
  START_MAP,
  STAT_START_POINTS,
  INVENTORY_SLOTS,
  bodyIdFor,
  classOfBody,
  isClassKey,
  isItemKey,
  type ClassKey,
  type Equipment,
  type InventorySlot,
  type ItemKey,
  type Sex,
  type Stats,
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
  /** Class and sex the character was created with. */
  cls: ClassKey;
  sex: Sex;
  /** Body and headwear ids of the look (see the style pack manifest). */
  body: string;
  hair: string;
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
  stats: Stats;
  /** Unspent stat points. */
  points: number;
};

export type AuthResult =
  | { ok: true; accountId: number; name: string }
  | { ok: false; reason: string };

export type CreateResult = { ok: true; id: number } | { ok: false; reason: string };

type AccountRow = { id: number; name: string; salt: string; hash: string };
type CharacterRow = {
  id: number;
  name: string;
  cls: string | null;
  sex: string | null;
  body: string | null;
  hair: string | null;
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
  stat_str: number;
  stat_vit: number;
  stat_int: number;
  stat_dex: number;
  points: number;
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
  body TEXT NOT NULL DEFAULT '',
  hair TEXT NOT NULL DEFAULT '',
  cls TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT '',
  stat_str INTEGER NOT NULL DEFAULT 0,
  stat_vit INTEGER NOT NULL DEFAULT 0,
  stat_int INTEGER NOT NULL DEFAULT 0,
  stat_dex INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
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
    // Two writers must wait for each other instead of throwing at once.
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.db.exec(SCHEMA);
    this.ensureCharacterColumns();

    // Prepared once. Preparing on every save was a measurable cost under load.
    this.stmtSaveCharacter = this.db.prepare(`
      UPDATE characters SET
        level = ?, exp = ?, yang = ?, hp = ?, map = ?, x = ?, y = ?, dir = ?,
        weapon = ?, armor = ?, body = ?, hair = ?,
        stat_str = ?, stat_vit = ?, stat_int = ?, stat_dex = ?, points = ?, updated_at = ?
      WHERE id = ?
    `);
    this.stmtClearItems = this.db.prepare('DELETE FROM character_items WHERE character_id = ?');
    this.stmtWriteItem = this.db.prepare(
      'INSERT INTO character_items (character_id, slot, item_key, count) VALUES (?, ?, ?, ?)',
    );
  }

  /** Older saves get the new columns, so nothing is lost on an update. */
  private ensureCharacterColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info('characters')").all() as unknown as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'weapon')) {
      this.db.exec('ALTER TABLE characters ADD COLUMN weapon TEXT');
    }
    if (!columns.some((column) => column.name === 'armor')) {
      this.db.exec('ALTER TABLE characters ADD COLUMN armor TEXT');
    }
    if (!columns.some((column) => column.name === 'body')) {
      this.db.exec("ALTER TABLE characters ADD COLUMN body TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.some((column) => column.name === 'hair')) {
      this.db.exec("ALTER TABLE characters ADD COLUMN hair TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.some((column) => column.name === 'cls')) {
      this.db.exec("ALTER TABLE characters ADD COLUMN cls TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.some((column) => column.name === 'sex')) {
      this.db.exec("ALTER TABLE characters ADD COLUMN sex TEXT NOT NULL DEFAULT ''");
    }
    for (const column of ['stat_str', 'stat_vit', 'stat_int', 'stat_dex', 'points']) {
      if (columns.some((entry) => entry.name === column)) continue;
      this.db.exec(`ALTER TABLE characters ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
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

  createCharacter(
    accountId: number,
    name: string,
    cls: ClassKey = 'warrior',
    sex: Sex = 'm',
    hair = '',
  ): CreateResult {
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
             (account_id, name, level, exp, yang, hp, map, x, y, dir, weapon, armor,
              body, hair, cls, sex, points, stat_str, stat_vit, stat_int, stat_dex, updated_at)
           VALUES (?, ?, 1, 0, 0, 100, ?, 0, 0, 0, 'wooden_sword', NULL,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          accountId,
          name,
          START_MAP,
          bodyIdFor(cls, sex),
          hair,
          cls,
          sex,
          STAT_START_POINTS,
          CLASSES[cls].base.str,
          CLASSES[cls].base.vit,
          CLASSES[cls].base.int,
          CLASSES[cls].base.dex,
          Date.now(),
        );

      const id = Number(info.lastInsertRowid);
      // EIGENE WAHL: the starter kit, so the first fights are survivable.
      this.stmtWriteItem.run(id, 0, 'small_hp_potion', 3);
      this.stmtWriteItem.run(id, 1, 'small_sp_potion', 2);

      return { ok: true, id };
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
        'SELECT id, name, level, exp, yang, hp, map, x, y, dir, weapon, armor, body, hair, cls, sex, stat_str, stat_vit, stat_int, stat_dex, points FROM characters WHERE id = ?',
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

    // Characters from before classes only have a look id; that is enough.
    const look = String(row.body ?? '');
    const fallback = classOfBody(look);
    const cls = isClassKey(row.cls) ? row.cls : fallback.cls;
    const sex: Sex = row.sex === 'm' || row.sex === 'f' ? row.sex : fallback.sex;

    return {
      name: row.name,
      cls,
      sex,
      body: look === '' ? bodyIdFor(cls, sex) : look,
      hair: String(row.hair ?? ''),
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
      stats: {
        str: Number(row.stat_str ?? 0),
        vit: Number(row.stat_vit ?? 0),
        int: Number(row.stat_int ?? 0),
        dex: Number(row.stat_dex ?? 0),
      },
      points: Number(row.points ?? 0),
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
          save.body,
          save.hair,
          save.stats.str,
          save.stats.vit,
          save.stats.int,
          save.stats.dex,
          save.points,
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

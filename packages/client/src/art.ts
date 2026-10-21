// Player artwork: sprite layers composed on top of each other.
//
// The asset pack documents the format: 48x48 cells, nine fixed columns and rows
// that are named in the folder's JSON. Rows are looked up by name, never by a
// hard-coded number, so swapping in another class or a new armour keeps working.
//
// Layer order, back to front: weapon behind, body (armour), head, hair, weapon
// in front. The weapon comes in two halves because the hand holds it.

import Phaser from 'phaser';
import { ITEM_KEYS, itemDef, type ItemKey } from '@lumiis/shared';
import type { Direction } from '@lumiis/shared';
import stylesFile from './styles.json';

/** Column order inside every sheet: stand, step 1, step 2, breathe, attack 1-3, hit, dead. */
export const COLUMNS = 9;

/**
 * One graphic style: where its sheets live and how they are cut. A pack can be
 * a class/sex of the old asset pack, or a freshly rendered set (see
 * HOWITWORKS "Grafik-Pakete"). Paths are templates:
 * `{file}` = armor file, `{art}` = weapon art, `{stage2}` = zero-padded stage.
 */
export type StylePack = {
  name: string;
  /** Side of one cell, in pixels. */
  cell: number;
  /** Animation columns per row (9 in the old asset pack). */
  columns: number;
  /** Foot position inside a cell; the sprite is anchored there. */
  footX: number;
  footY: number;
  /** Sheet used when nothing is worn, and the fixed head/hair. */
  body: string;
  head: string;
  hair: string;
  armor: string;
  weapon: string;
  /** Which row set of ruestungen.json describes the body poses. */
  armorRows: string;
  /**
   * Optional row table of the pack itself: names per layer, in the order of the
   * sheet's rows. Without it the old asset tables are used.
   */
  rows?: string;
  /**
   * Fixed pose art for the body (e.g. "faust"). A single-mesh 3D character
   * does not change its arm pose with the weapon, so all weapons share rows.
   */
  bodyArt?: string;
};

const STYLES = stylesFile as { default: string; packs: Record<string, StylePack> };

/** Ids of every style pack the client knows. */
export const STYLE_IDS = Object.keys(STYLES.packs);

const defaultPack = (): StylePack => STYLES.packs[STYLES.default] as StylePack;

/**
 * The pack to draw with: `?style=<id>` wins, then the one remembered in this
 * browser, then the default. An unknown id falls back to the default.
 */
export function activePack(): { id: string; pack: StylePack } {
  let asked: string | null = null;
  try {
    asked =
      new URLSearchParams(window.location.search).get('style') ??
      window.localStorage.getItem('lumiis.style');
  } catch {
    asked = null;
  }

  if (asked !== null && STYLES.packs[asked] !== undefined) {
    return { id: asked, pack: STYLES.packs[asked] as StylePack };
  }
  return { id: STYLES.default, pack: defaultPack() };
}

/** The sheet path of one weapon in a pack. */
export const weaponSheetPath = (pack: StylePack, art: string, stage: number): string =>
  pack.weapon.replace('{art}', art).replace('{stage2}', String(stage).padStart(2, '0'));

/** Health bar above a player's head. */
const PLAYER_BAR_WIDTH = 30;
const PLAYER_BAR_HEIGHT = 4;
const PLAYER_BAR_Y = -50;
/** The name sits just above the health bar. */
const NAME_Y = -62;
export const CELL = 48;
/** Foot position inside a cell. The sprite is anchored here, not at its centre. */
export const FOOT_X = 24;
export const FOOT_Y = 44;

/** Views exist three times; left is the right view mirrored. */
export type View = 0 | 1 | 2; // down, right, up

const VIEW_NAMES = ['unten', 'rechts', 'oben'] as const;

const VIEW_OF_DIR: View[] = [0, 0, 1, 2, 2, 2, 1, 0];
const FLIP_OF_DIR: boolean[] = [false, true, true, true, false, true, false, true];

export const viewOf = (dir: Direction): View => VIEW_OF_DIR[dir] ?? 0;
export const flipOf = (dir: Direction): boolean => FLIP_OF_DIR[dir] ?? false;

/** Row tables read from the asset pack. */
export type ArtTables = {
  /** Row names of one class, e.g. `koerper/schwert/unten`. */
  armor: string[];
  head: string[];
  hair: string[];
  /** Weapon rows: `hinten/unten`, `vorne/unten`, and so on. */
  weapon: string[];
};

const rowIndex = (rows: string[], name: string): number => {
  const index = rows.indexOf(name);
  return index === -1 ? 0 : index;
};

const rowsFor = (rows: string[], names: readonly string[]): number[] =>
  names.map((name) => rowIndex(rows, name));

/** Reads the row tables that ship next to the images. */
export function readTables(scene: Phaser.Scene, pack: StylePack = defaultPack()): ArtTables {
  // A pack can name its own rows; then the old asset tables are not needed.
  const own = scene.cache.json.get('rows_style') as
    | { armor?: string[]; head?: string[]; hair?: string[]; weapon?: string[] }
    | undefined;
  if (own !== undefined && Array.isArray(own.armor)) {
    return {
      armor: own.armor,
      head: own.head ?? [],
      hair: own.hair ?? [],
      weapon: own.weapon ?? [],
    };
  }

  const armor = scene.cache.json.get('rows_armor') as { zeilen: Record<string, string[]> };
  const head = scene.cache.json.get('rows_head') as { zeilen: string[] };
  const hair = scene.cache.json.get('rows_hair') as { zeilen: string[] };
  const weapon = scene.cache.json.get('rows_weapon') as { zeilen: string[] };

  return {
    armor: armor.zeilen[pack.armorRows] ?? [],
    head: head.zeilen,
    hair: hair.zeilen,
    weapon: weapon.zeilen,
  };
}

/** Every texture key the scene has to load for one style pack. */
export function spriteSheets(pack: StylePack = defaultPack()): Array<{ key: string; path: string }> {
  const sheets = [
    { key: 'body', path: pack.body },
    { key: 'head', path: pack.head },
    { key: 'hair', path: pack.hair },
  ];

  for (const key of ITEM_KEYS) {
    const def = itemDef(key);
    if (def.armorFile !== undefined) {
      sheets.push({ key: `armor_${def.armorFile}`, path: pack.armor.replace('{file}', def.armorFile) });
    }
    if (def.weaponArt !== undefined && def.stage !== undefined) {
      sheets.push({
        key: `weapon_${def.weaponArt}_${def.stage}`,
        path: weaponSheetPath(pack, def.weaponArt, def.stage),
      });
    }
  }

  return sheets;
}

export const frameFor = (row: number, column: number, columns = COLUMNS): number =>
  row * columns + column;

export type Look = {
  weapon: ItemKey | null;
  armor: ItemKey | null;
};

/** One player on screen: five layers, anchored at the feet. */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly weaponBack: Phaser.GameObjects.Image;
  private readonly body: Phaser.GameObjects.Image;
  private readonly head: Phaser.GameObjects.Image;
  private readonly hair: Phaser.GameObjects.Image;
  private readonly weaponFront: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;

  private lookSignature = '';
  private shownHp = -1;
  private shownMaxHp = -1;
  private bodyRows: number[] = [0, 0, 0];
  private backRows: number[] = [0, 0, 0];
  private frontRows: number[] = [0, 0, 0];
  private hasWeapon = false;
  private headRows: number[] = [0, 0, 0];
  private hairRows: number[] = [0, 0, 0];

  private readonly columns: number;
  private readonly bodyArt: string | undefined;

  constructor(scene: Phaser.Scene, tables: ArtTables, pack: StylePack = defaultPack()) {
    this.columns = pack.columns;
    this.bodyArt = pack.bodyArt;
    const origin = {
      x: (pack.footX ?? FOOT_X) / pack.cell,
      y: (pack.footY ?? FOOT_Y) / pack.cell,
    };

    this.weaponBack = scene.add.image(0, 0, 'body').setOrigin(origin.x, origin.y);
    this.body = scene.add.image(0, 0, 'body').setOrigin(origin.x, origin.y);
    this.head = scene.add.image(0, 0, 'head').setOrigin(origin.x, origin.y);
    this.hair = scene.add.image(0, 0, 'hair').setOrigin(origin.x, origin.y);
    this.weaponFront = scene.add.image(0, 0, 'body').setOrigin(origin.x, origin.y);

    this.weaponBack.setVisible(false);
    this.weaponFront.setVisible(false);

    this.headRows = rowsFor(tables.head, VIEW_NAMES.map((view) => `kopf/${view}`));
    this.hairRows = rowsFor(tables.hair, VIEW_NAMES.map((view) => `oben/${view}`));

    this.bar = scene.add.graphics();

    this.nameText = scene.add
      .text(0, NAME_Y, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '11px',
        color: '#e6eef6',
        stroke: '#0b0f13',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.container = scene.add.container(0, 0, [
      this.weaponBack,
      this.body,
      this.head,
      this.hair,
      this.weaponFront,
      this.bar,
      this.nameText,
    ]);

    this.applyLook(tables, { weapon: null, armor: null }, true);
  }

  /** A slight forward/backward tilt of the whole figure while swinging. */
  setLean(radians: number): void {
    this.container.setRotation(radians);
  }

  /** The name plaque above the head; empty hides it. */
  setName(name: string): void {
    if (this.nameText.text !== name) this.nameText.setText(name);
  }

  /** The health bar above the head. `always` shows it even at full health. */
  setHealth(hp: number, maxHp: number, always = false): void {
    if (!always && (hp >= maxHp || maxHp <= 0)) {
      if (this.shownHp !== -1) this.bar.clear();
      this.shownHp = -1;
      this.shownMaxHp = -1;
      return;
    }
    if (hp === this.shownHp && maxHp === this.shownMaxHp) return;
    this.shownHp = hp;
    this.shownMaxHp = maxHp;

    this.bar.clear();
    const left = -PLAYER_BAR_WIDTH / 2;
    const y = PLAYER_BAR_Y;
    this.bar.fillStyle(0x000000, 0.55);
    this.bar.fillRect(left - 1, y - 1, PLAYER_BAR_WIDTH + 2, PLAYER_BAR_HEIGHT + 2);
    this.bar.fillStyle(0x3a1414, 1);
    this.bar.fillRect(left, y, PLAYER_BAR_WIDTH, PLAYER_BAR_HEIGHT);

    const filled = Math.max(1, Math.round((PLAYER_BAR_WIDTH * hp) / maxHp));
    this.bar.fillStyle(0xe0473a, 1);
    this.bar.fillRect(left, y, filled, PLAYER_BAR_HEIGHT);
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
    // Lower on screen means in front, so depth follows the feet.
    this.container.setDepth(Math.round(y));
  }

  setLook(tables: ArtTables, look: Look): void {
    this.applyLook(tables, look, false);
  }

  setPose(dir: Direction, column: number): void {
    const view = viewOf(dir);
    const flip = flipOf(dir);

    this.body.setFrame(frameFor(this.bodyRows[view] ?? 0, column, this.columns)).setFlipX(flip);
    this.head.setFrame(frameFor(this.headRows[view] ?? 0, column, this.columns)).setFlipX(flip);
    this.hair.setFrame(frameFor(this.hairRows[view] ?? 0, column, this.columns)).setFlipX(flip);

    if (this.hasWeapon) {
      this.weaponBack
        .setFrame(frameFor(this.backRows[view] ?? 0, column, this.columns))
        .setFlipX(flip);
      this.weaponFront
        .setFrame(frameFor(this.frontRows[view] ?? 0, column, this.columns))
        .setFlipX(flip);
    }
  }

  /** Red flash while a monster is biting. */
  setTint(color: number | null): void {
    for (const layer of [this.weaponBack, this.body, this.head, this.hair, this.weaponFront]) {
      if (color === null) layer.clearTint();
      else layer.setTint(color);
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private applyLook(tables: ArtTables, look: Look, force: boolean): void {
    const signature = `${look.weapon ?? '-'}|${look.armor ?? '-'}`;
    if (!force && signature === this.lookSignature) return;
    this.lookSignature = signature;

    const armorDef = look.armor === null ? null : itemDef(look.armor);
    const weaponDef = look.weapon === null ? null : itemDef(look.weapon);

    this.body.setTexture(armorDef?.armorFile ? `armor_${armorDef.armorFile}` : 'body');

    // The pose of the arms depends on what is held (unless the pack says it
    // does not, as a single-mesh 3D character).
    const art = this.bodyArt ?? weaponDef?.weaponArt ?? 'faust';
    this.bodyRows = rowsFor(
      tables.armor,
      VIEW_NAMES.map((view) => `koerper/${art}/${view}`),
    );

    if (weaponDef?.weaponArt !== undefined && weaponDef.stage !== undefined) {
      const key = `weapon_${weaponDef.weaponArt}_${weaponDef.stage}`;
      this.weaponBack.setTexture(key).setVisible(true);
      this.weaponFront.setTexture(key).setVisible(true);
      this.hasWeapon = true;
      this.backRows = rowsFor(
        tables.weapon,
        VIEW_NAMES.map((view) => `hinten/${view}`),
      );
      this.frontRows = rowsFor(
        tables.weapon,
        VIEW_NAMES.map((view) => `vorne/${view}`),
      );
    } else {
      this.hasWeapon = false;
      this.weaponBack.setVisible(false);
      this.weaponFront.setVisible(false);
    }
  }
}

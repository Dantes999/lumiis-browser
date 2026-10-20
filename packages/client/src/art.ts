// Player artwork: three sprite layers composed on top of each other.
//
// The asset pack documents the format: 48x48 cells, nine fixed columns and rows
// that are named in the folder's JSON. Rows are looked up by name, never by a
// hard-coded number, so swapping in another class or a new armour keeps working.

import Phaser from 'phaser';
import type { Direction } from '@lumiis/shared';

/** Column order inside every sheet: stand, step 1, step 2, breathe, attack 1-3, hit, dead. */
export const COLUMNS = 9;
export const CELL = 48;
/** Foot position inside a cell. The sprite is anchored here, not at its centre. */
export const FOOT_X = 24;
export const FOOT_Y = 44;

/** Views exist three times; left is the right view mirrored. */
export type View = 0 | 1 | 2; // down, right, up

const VIEW_OF_DIR: View[] = [0, 0, 1, 2, 2, 2, 1, 0];
const FLIP_OF_DIR: boolean[] = [false, true, true, true, false, true, false, true];

export const viewOf = (dir: Direction): View => VIEW_OF_DIR[dir] ?? 0;
export const flipOf = (dir: Direction): boolean => FLIP_OF_DIR[dir] ?? false;

export type SpriteRows = {
  /** Row index per view, for each layer. */
  body: number[];
  head: number[];
  hair: number[];
};

const rowsForView = (rows: string[], names: string[]): number[] =>
  names.map((name) => {
    const index = rows.indexOf(name);
    return index === -1 ? 0 : index;
  });

/** Reads the row tables that ship next to the images. */
export function readRows(scene: Phaser.Scene): SpriteRows {
  const armor = scene.cache.json.get('rows_armor') as { zeilen: Record<string, string[]> };
  const head = scene.cache.json.get('rows_head') as { zeilen: string[] };
  const hair = scene.cache.json.get('rows_hair') as { zeilen: string[] };

  const armorRows = armor.zeilen['warrior'] ?? [];

  return {
    body: rowsForView(armorRows, ['koerper/schwert/unten', 'koerper/schwert/rechts', 'koerper/schwert/oben']),
    head: rowsForView(head.zeilen, ['kopf/unten', 'kopf/rechts', 'kopf/oben']),
    hair: rowsForView(hair.zeilen, ['oben/unten', 'oben/rechts', 'oben/oben']),
  };
}

export const frameFor = (row: number, column: number): number => row * COLUMNS + column;

/** One player on screen: a container with the three layers, anchored at the feet. */
export class PlayerView {
  readonly container: Phaser.GameObjects.Container;
  private readonly layers: Phaser.GameObjects.Image[];
  x = 0;
  y = 0;

  constructor(scene: Phaser.Scene, rows: SpriteRows) {
    const body = scene.add.image(0, 0, 'body');
    const head = scene.add.image(0, 0, 'head');
    const hair = scene.add.image(0, 0, 'hair');
    this.layers = [body, head, hair];

    const rowSets = [rows.body, rows.head, rows.hair];
    for (const [index, layer] of this.layers.entries()) {
      const rowSet = rowSets[index] ?? [];
      layer.setOrigin(FOOT_X / CELL, FOOT_Y / CELL);
      const firstRow = rowSet[0] ?? 0;
      layer.setFrame(frameFor(firstRow, 0));
    }

    this.container = scene.add.container(0, 0, this.layers);
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.container.setPosition(x, y);
    // Lower on screen means in front, so depth follows the feet.
    this.container.setDepth(Math.round(y));
  }

  setPose(rows: SpriteRows, dir: Direction, column: number): void {
    const view = viewOf(dir);
    const flip = flipOf(dir);
    const rowSets = [rows.body, rows.head, rows.hair];

    for (const [index, layer] of this.layers.entries()) {
      const rowSet = rowSets[index] ?? [];
      const row = rowSet[view] ?? 0;
      layer.setFrame(frameFor(row, column));
      layer.setFlipX(flip);
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

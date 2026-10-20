// Monster artwork: one sheet per monster type, four views, five frames each.
//
// The sheet layout is fixed by the asset pack: 40 x 32 cells, feet at (20, 29),
// views in the order down, left, right, up.

import Phaser from 'phaser';
import type { Direction } from '@lumiis/shared';

export const MOB_CELL_W = 40;
export const MOB_CELL_H = 32;
export const MOB_FOOT_X = 20;
export const MOB_FOOT_Y = 29;
export const MOB_FRAMES_PER_VIEW = 5;

const VIEW_DOWN = 0;
const VIEW_LEFT = 1;
const VIEW_RIGHT = 2;
const VIEW_UP = 3;

/** Ties between a diagonal's two axes are drawn sideways, which reads better. */
export function monsterViewOf(dir: Direction): number {
  const vectors: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];
  const vector = vectors[dir] ?? [0, 1];

  if (Math.abs(vector[1]) > Math.abs(vector[0])) return vector[1] > 0 ? VIEW_DOWN : VIEW_UP;
  return vector[0] < 0 ? VIEW_LEFT : VIEW_RIGHT;
}

const BAR_WIDTH = 30;
const BAR_HEIGHT = 3;
/** Above the head: the body reaches 29 px above the feet. */
const BAR_Y = -36;

export class MonsterView {
  readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private shownHp = -1;
  private shownMaxHp = -1;

  constructor(scene: Phaser.Scene, textureKey: string) {
    this.sprite = scene.add.image(0, 0, textureKey);
    this.sprite.setOrigin(MOB_FOOT_X / MOB_CELL_W, MOB_FOOT_Y / MOB_CELL_H);

    this.bar = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.sprite, this.bar]);
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
    this.container.setDepth(Math.round(y));
  }

  setPose(dir: Direction, moving: boolean, stepFrame: number): void {
    const view = monsterViewOf(dir);
    const frame = moving ? stepFrame : 0;
    this.sprite.setFrame(view * MOB_FRAMES_PER_VIEW + frame);
  }

  setHealth(hp: number, maxHp: number): void {
    if (hp === this.shownHp && maxHp === this.shownMaxHp) return;
    this.shownHp = hp;
    this.shownMaxHp = maxHp;

    this.bar.clear();
    if (hp >= maxHp || hp <= 0) return;

    const left = -BAR_WIDTH / 2;
    this.bar.fillStyle(0x000000, 0.55);
    this.bar.fillRect(left - 1, BAR_Y - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2);
    this.bar.fillStyle(0x4a1f1f, 1);
    this.bar.fillRect(left, BAR_Y, BAR_WIDTH, BAR_HEIGHT);

    const filled = Math.max(1, Math.round((BAR_WIDTH * hp) / maxHp));
    this.bar.fillStyle(0x6fd07a, 1);
    this.bar.fillRect(left, BAR_Y, filled, BAR_HEIGHT);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

// The white streak a blade leaves in the air.
//
// Three sprite frames alone read as a twitch; the streak is what makes a swing
// visible. It is drawn with a Graphics object, so there is no image and no
// asset: an arc that sweeps through the facing direction and fades away.
//
// The blade points straight ahead exactly when the hit lands, which is half
// way through the swing.

import Phaser from 'phaser';
import { SWING_ARC } from '@lumiis/shared';
import type { Direction } from '@lumiis/shared';

/** Where the blade sits on screen, measured from the feet. */
const BLADE_HEIGHT = 18;
/** How far the streak reaches at least, so a short weapon is still visible. */
const MIN_REACH = 30;
/** How much of the arc is drawn behind the blade, in radians. */
const TAIL = Math.PI / 3;
/** The streak starts after the wind-up and is gone before the arm is back. */
const SWEEP_FROM = 0.2;
const SWEEP_TO = 0.85;

/** Screen angle of a walking direction; 0 points east, angles grow clockwise. */
const angleOf = (dir: Direction): number => {
  // Direction 0 is south (down the screen), so east sits at direction 6.
  return (Math.PI / 4) * dir + Math.PI / 2;
};

export class SwingTrail {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly start: number;
  private readonly end: number;
  private readonly reach: number;
  private readonly follow: () => { x: number; y: number };
  private elapsed = 0;

  constructor(
    scene: Phaser.Scene,
    follow: () => { x: number; y: number },
    dir: Direction,
    sweep: 1 | -1,
    private readonly durationMs: number,
    reach: number,
  ) {
    this.follow = follow;
    this.reach = Math.max(MIN_REACH, reach);
    this.start = angleOf(dir) - SWING_ARC * sweep;
    this.end = angleOf(dir) + SWING_ARC * sweep;

    this.graphics = scene.add.graphics();
    this.graphics.setPosition(follow().x, follow().y - BLADE_HEIGHT);
    // In front of the figure: depth grows with the feet position.
    this.graphics.setDepth(Math.round(follow().y) + 1);
    this.redraw(0);
  }

  get done(): boolean {
    return this.elapsed >= this.durationMs;
  }

  update(deltaMs: number): void {
    // The streak belongs to the swinging figure, so it moves with it.
    const position = this.follow();
    this.graphics.setPosition(position.x, position.y - BLADE_HEIGHT);
    this.graphics.setDepth(Math.round(position.y) + 1);

    this.elapsed += deltaMs;
    const progress = Math.min(1, this.elapsed / this.durationMs);
    this.redraw(progress);
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private redraw(progress: number): void {
    const graphics = this.graphics;
    graphics.clear();

    const swept = Phaser.Math.Clamp((progress - SWEEP_FROM) / (SWEEP_TO - SWEEP_FROM), 0, 1);
    const blade = this.start + (this.end - this.start) * swept;
    // The streak fades as the arm slows down.
    const alpha = swept === 0 ? 0 : 0.85 * (1 - swept) + 0.15;
    if (alpha <= 0.02) return;

    const from = blade - TAIL;
    const inner = this.reach * 0.25;

    // The faint body of the streak.
    graphics.fillStyle(0xbfd8ff, alpha * 0.45);
    graphics.beginPath();
    graphics.arc(0, 0, this.reach, from, blade, false);
    graphics.arc(0, 0, inner, blade, from, true);
    graphics.closePath();
    graphics.fillPath();

    // A bright edge where the blade just passed.
    graphics.lineStyle(2, 0xf2f8ff, alpha);
    graphics.beginPath();
    graphics.arc(0, 0, this.reach, blade - 0.18, blade, false);
    graphics.strokePath();

    // The blade itself, pointing outwards.
    graphics.lineStyle(2, 0xffffff, alpha);
    graphics.lineBetween(
      Math.cos(blade) * inner,
      Math.sin(blade) * inner,
      Math.cos(blade) * this.reach,
      Math.sin(blade) * this.reach,
    );
  }
}

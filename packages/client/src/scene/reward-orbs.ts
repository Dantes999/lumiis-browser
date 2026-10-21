// The little yellow orb that flies from a dead monster to each player who
// earned experience. Its size shows the share: more damage, bigger orb.

import Phaser from 'phaser';

/** Milliseconds from the monster to the player. */
const FLIGHT_MS = 700;
/** How high the orb arcs above the straight line, in pixels. */
const ARC_HEIGHT = 26;
/** Radius of the smallest and largest orb. */
const MIN_RADIUS = 3;
const MAX_RADIUS = 8;

const radiusFor = (amount: number): number =>
  Math.min(MAX_RADIUS, MIN_RADIUS + Math.log10(Math.max(1, amount)) * 4);

export class RewardOrb {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly from: { x: number; y: number };
  private readonly target: () => { x: number; y: number } | null;
  private readonly radius: number;
  private elapsed = 0;

  constructor(
    scene: Phaser.Scene,
    from: { x: number; y: number },
    target: () => { x: number; y: number } | null,
    amount: number,
  ) {
    this.from = { x: from.x, y: from.y - 14 };
    this.target = target;
    this.radius = radiusFor(amount);

    this.graphics = scene.add.graphics();
    this.graphics.setDepth(19000);
    this.graphics.fillStyle(0xffe066, 0.9);
    this.graphics.fillCircle(0, 0, this.radius);
    this.graphics.lineStyle(1, 0xfff6c2, 0.9);
    this.graphics.strokeCircle(0, 0, this.radius);

    this.label = scene.add
      .text(0, 0, `+${amount}`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '10px',
        color: '#ffe58a',
      })
      .setOrigin(0.5)
      .setDepth(19001);

    this.move(0);
  }

  get done(): boolean {
    return this.elapsed >= FLIGHT_MS;
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.move(Math.min(1, this.elapsed / FLIGHT_MS));
  }

  destroy(): void {
    this.graphics.destroy();
    this.label.destroy();
  }

  private move(t: number): void {
    const to = this.target();
    if (to === null) {
      this.graphics.setVisible(false);
      this.label.setVisible(false);
      return;
    }

    const eased = t * t;
    const x = this.from.x + (to.x - this.from.x) * eased;
    const y = this.from.y + (to.y - this.from.y) * eased - Math.sin(t * Math.PI) * ARC_HEIGHT;
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;

    this.graphics.setVisible(true).setAlpha(fade).setPosition(x, y);
    this.label.setVisible(true).setAlpha(fade).setPosition(x, y - this.radius - 8);
  }
}

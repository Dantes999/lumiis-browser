// Skill effects drawn with Graphics, no image assets.
//
// Whirlwind: a few blades spinning a full circle around the caster.
// Aura: a soft ring at the feet that keeps pulsing while the buff is active.

import Phaser from 'phaser';

/** Pixels above the feet where the whirlwind blades sit. */
const WHIRL_HEIGHT = 18;
/** How long the whirlwind is visible. */
const WHIRL_MS = 520;
/** How many arms the whirlwind shows. */
const WHIRL_ARMS = 3;

export class WhirlwindEffect {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly follow: () => { x: number; y: number };
  private readonly reach: number;
  private elapsed = 0;

  constructor(
    scene: Phaser.Scene,
    follow: () => { x: number; y: number },
    reach: number,
    private readonly durationMs: number = WHIRL_MS,
  ) {
    this.follow = follow;
    this.reach = Math.max(36, reach);
    this.graphics = scene.add.graphics();
    this.move();
    this.graphics.setDepth(Math.round(follow().y) + 2);
    this.draw(0);
  }

  get done(): boolean {
    return this.elapsed >= this.durationMs;
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.move();
    this.draw(Math.min(1, this.elapsed / this.durationMs));
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private move(): void {
    const position = this.follow();
    this.graphics.setPosition(position.x, position.y - WHIRL_HEIGHT);
    this.graphics.setDepth(Math.round(position.y) + 2);
  }

  private draw(progress: number): void {
    const graphics = this.graphics;
    graphics.clear();

    // The whole whirl is one full turn; it fades as it ends.
    const spin = progress * Math.PI * 2;
    const alpha = 0.9 * (1 - progress) + 0.1;
    if (alpha <= 0.03) return;

    const inner = this.reach * 0.35;
    for (let arm = 0; arm < WHIRL_ARMS; arm += 1) {
      const angle = spin + (arm * Math.PI * 2) / WHIRL_ARMS;
      const tail = 0.7;
      graphics.fillStyle(0xbfe0ff, alpha * 0.35);
      graphics.beginPath();
      graphics.arc(0, 0, this.reach, angle - tail, angle, false);
      graphics.arc(0, 0, inner, angle, angle - tail, true);
      graphics.closePath();
      graphics.fillPath();

      graphics.lineStyle(2, 0xffffff, alpha);
      graphics.lineBetween(
        Math.cos(angle) * inner,
        Math.sin(angle) * inner,
        Math.cos(angle) * this.reach,
        Math.sin(angle) * this.reach,
      );
    }
  }
}

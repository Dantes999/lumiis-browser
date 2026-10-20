// The world view: ground, players, camera.
// Positions come from the simulation; the server is the final word.

import Phaser from 'phaser';
import { TILE_SIZE, WORLD_PIXELS } from '@lumiis/shared';
import { PlayerView, readRows, type SpriteRows } from '../art';
import { stepLocal } from '../sim';
import { view } from '../state';

/** Milliseconds per walking frame. */
const STEP_FRAME_MS = 180;
/** How much of the remaining distance other players close per frame. */
const OTHERS_SMOOTHING = 0.25;

export class WorldScene extends Phaser.Scene {
  private rows: SpriteRows | null = null;
  private readonly views = new Map<number, PlayerView>();
  private following = false;

  constructor() {
    super('world');
  }

  preload(): void {
    this.load.json('rows_armor', '/assets/ruestungen/ruestungen.json');
    this.load.json('rows_head', '/assets/modelle/spieler/spieler.json');
    this.load.json('rows_hair', '/assets/haare/haare.json');

    // Every sheet uses the same 48x48 grid; only the row tables differ.
    const grid = { frameWidth: 48, frameHeight: 48 };
    this.load.spritesheet('body', '/assets/ruestungen/krieger_m/00_ohne_ruestung.png', grid);
    this.load.spritesheet('head', '/assets/modelle/spieler/krieger_m.png', grid);
    this.load.spritesheet('hair', '/assets/haare/krieger_m_1.png', grid);
  }

  create(): void {
    this.rows = readRows(this);
    this.drawGround();

    this.cameras.main.setBackgroundColor('#0b0f13');
    this.cameras.main.setBounds(0, 0, WORLD_PIXELS, WORLD_PIXELS);
    this.cameras.main.centerOn(WORLD_PIXELS / 2, WORLD_PIXELS / 2);
  }

  override update(_time: number, delta: number): void {
    stepLocal(delta);
    this.renderPlayers();
  }

  private drawGround(): void {
    const checker = this.make.graphics({ x: 0, y: 0 }, false);
    checker.fillStyle(0x16241d, 1);
    checker.fillRect(0, 0, TILE_SIZE * 2, TILE_SIZE * 2);
    checker.fillStyle(0x1a2a22, 1);
    checker.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    checker.fillRect(TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE);
    checker.generateTexture('ground', TILE_SIZE * 2, TILE_SIZE * 2);
    checker.destroy();

    this.add
      .tileSprite(0, 0, WORLD_PIXELS, WORLD_PIXELS, 'ground')
      .setOrigin(0, 0)
      .setDepth(-10);

    const border = this.add.graphics().setDepth(-9);
    border.lineStyle(4, 0x2f4a3a, 1);
    border.strokeRect(0, 0, WORLD_PIXELS, WORLD_PIXELS);
  }

  private renderPlayers(): void {
    const rows = this.rows;
    if (rows === null) return;

    const column = Math.floor(this.time.now / STEP_FRAME_MS) % 2 === 0 ? 1 : 2;
    const seen = new Set<number>();

    for (const player of view.others.values()) {
      seen.add(player.id);
      player.renderX += (player.x - player.renderX) * OTHERS_SMOOTHING;
      player.renderY += (player.y - player.renderY) * OTHERS_SMOOTHING;

      const playerView = this.viewFor(player.id, rows);
      playerView.setPosition(player.renderX, player.renderY);
      playerView.setPose(rows, player.dir, player.moving ? column : 0);
    }

    const selfId = view.selfId;
    if (selfId !== null) {
      seen.add(selfId);
      const self = view.self;
      const selfView = this.viewFor(selfId, rows);
      selfView.setPosition(self.x + self.offsetX, self.y + self.offsetY);
      selfView.setPose(rows, self.dir, self.moving ? column : 0);

      if (!this.following) {
        this.cameras.main.startFollow(selfView.container, true, 0.15, 0.15);
        this.following = true;
      }
    }

    for (const [id, playerView] of this.views) {
      if (seen.has(id)) continue;
      playerView.destroy();
      this.views.delete(id);
    }
  }

  private viewFor(id: number, rows: SpriteRows): PlayerView {
    const existing = this.views.get(id);
    if (existing !== undefined) return existing;

    const created = new PlayerView(this, rows);
    this.views.set(id, created);
    return created;
  }
}

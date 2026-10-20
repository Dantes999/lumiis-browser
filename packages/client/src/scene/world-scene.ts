// The world view. For this first slice it only draws the tile grid and every
// player the server reported. Positions come from snapshots, never from input.

import Phaser from 'phaser';
import { TILE_SIZE } from '@lumiis/shared';
import { view } from '../state';

const COLORS = {
  background: '#101418',
  grid: 0x1d2731,
  origin: 0x2f3d4a,
  self: 0x6fd1c0,
  other: 0x8fa8bd,
};

/**
 * Half the width of the drawn test area in tiles. The grid is static, so it is
 * drawn once around the origin instead of being rebuilt while the camera moves.
 * Real maps replace this with their own extent.
 */
const GRID_RADIUS_TILES = 32;

export class WorldScene extends Phaser.Scene {
  private markers!: Phaser.GameObjects.Graphics;

  constructor() {
    super('world');
  }

  // Phaser's types do not declare create(); it is called by the scene manager.
  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.cameras.main.centerOn(0, 0);

    this.drawGrid();
    this.markers = this.add.graphics();
  }

  override update(): void {
    this.drawMarkers();
  }

  private drawGrid(): void {
    const grid = this.add.graphics();
    const min = -GRID_RADIUS_TILES * TILE_SIZE;
    const max = GRID_RADIUS_TILES * TILE_SIZE;

    grid.lineStyle(1, COLORS.grid, 1);
    for (let offset = min; offset <= max; offset += TILE_SIZE) {
      grid.lineBetween(offset, min, offset, max);
      grid.lineBetween(min, offset, max, offset);
    }

    // Mark the origin so movement later has a visible reference point.
    grid.lineStyle(2, COLORS.origin, 1);
    grid.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
  }

  private drawMarkers(): void {
    this.markers.clear();

    for (const player of view.players) {
      const isSelf = player.id === view.selfId;
      const size = TILE_SIZE - 8;
      this.markers.fillStyle(isSelf ? COLORS.self : COLORS.other, isSelf ? 1 : 0.55);
      this.markers.fillRect(player.x * TILE_SIZE + 4, player.y * TILE_SIZE + 4, size, size);
    }
  }
}

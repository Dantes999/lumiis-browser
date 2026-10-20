// Tile textures. Everything is drawn in code for now: fourteen 32 px tiles that
// are packed into one tileset image, because a real tileset file does not exist
// yet. Replacing this with an imported tileset later changes only this file.

import Phaser from 'phaser';
import { TILE, TILE_COUNT, TILE_SIZE } from '@lumiis/shared';

const C = {
  grass: 0x2f4a33,
  grassLight: 0x35553a,
  path: 0x6b5a3e,
  pathDark: 0x5b4a31,
  water: 0x1c3a5c,
  waterLight: 0x24507a,
  sand: 0x8d7c52,
  sandDark: 0x7c6b45,
  trunk: 0x4a3524,
  canopy: 0x1f3a26,
  canopyLight: 0x27492f,
  rock: 0x5a5f63,
  rockLight: 0x6d7378,
  stone: 0x4a4a4f,
  stoneLine: 0x3b3b40,
  wall: 0x55504a,
  wallDark: 0x46423d,
  bridge: 0x7a5a3a,
  bridgeDark: 0x64482c,
  portal: 0x2a2340,
  portalGlow: 0x6a49b0,
  portalCore: 0xa98cf0,
  cactus: 0x2f6b3a,
  gate: 0x3a3a40,
  gateBar: 0x22222a,
  gateOpen: 0x1f1f24,
};

const paintBase = (graphics: Phaser.GameObjects.Graphics, color: number): void => {
  graphics.fillStyle(color, 1);
  graphics.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
};

/** Deterministic little dots; same picture on every device and every reload. */
const speckle = (
  graphics: Phaser.GameObjects.Graphics,
  color: number,
  count: number,
  seed: number,
): void => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 4294967296;
  };

  graphics.fillStyle(color, 1);
  for (let dot = 0; dot < count; dot += 1) {
    const x = Math.floor(next() * (TILE_SIZE - 2));
    const y = Math.floor(next() * (TILE_SIZE - 2));
    graphics.fillRect(x, y, 2, 2);
  }
};

/**
 * Draws every tile once and packs them into a single texture called "tileset",
 * which the tilemap then uses as its image.
 */
export function buildTilesetTexture(scene: Phaser.Scene): void {
  const paint = (id: number, draw: (graphics: Phaser.GameObjects.Graphics) => void): void => {
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(graphics);
    graphics.generateTexture(`tile_${id}`, TILE_SIZE, TILE_SIZE);
    graphics.destroy();
  };

  paint(TILE.GRASS, (g) => {
    paintBase(g, C.grass);
    speckle(g, C.grassLight, 14, 11);
  });

  paint(TILE.FLOWERS, (g) => {
    paintBase(g, C.grass);
    speckle(g, C.grassLight, 10, 12);
    g.fillStyle(0xd9c86b, 1);
    g.fillRect(8, 10, 2, 2);
    g.fillRect(20, 19, 2, 2);
    g.fillStyle(0xd07a8a, 1);
    g.fillRect(16, 7, 2, 2);
    g.fillRect(25, 13, 2, 2);
  });

  paint(TILE.PATH, (g) => {
    paintBase(g, C.path);
    speckle(g, C.pathDark, 14, 13);
  });

  paint(TILE.WATER, (g) => {
    paintBase(g, C.water);
    g.fillStyle(C.waterLight, 1);
    g.fillRect(0, 8, 14, 2);
    g.fillRect(18, 20, 14, 2);
    g.fillRect(6, 26, 10, 2);
  });

  paint(TILE.SAND, (g) => {
    paintBase(g, C.sand);
    speckle(g, C.sandDark, 12, 14);
  });

  paint(TILE.TREE, (g) => {
    paintBase(g, C.grass);
    g.fillStyle(C.trunk, 1);
    g.fillRect(14, 19, 4, 11);
    g.fillStyle(C.canopy, 1);
    g.fillCircle(16, 14, 11);
    g.fillStyle(C.canopyLight, 1);
    g.fillCircle(13, 11, 6);
  });

  paint(TILE.ROCK, (g) => {
    paintBase(g, C.grass);
    g.fillStyle(C.rock, 1);
    g.fillCircle(16, 20, 9);
    g.fillStyle(C.rockLight, 1);
    g.fillCircle(13, 17, 5);
  });

  paint(TILE.STONE, (g) => {
    paintBase(g, C.stone);
    g.lineStyle(1, C.stoneLine, 1);
    g.lineBetween(0, 16, TILE_SIZE, 16);
    g.lineBetween(0, 0, TILE_SIZE, 0);
    g.lineBetween(16, 0, 16, 16);
    g.lineBetween(8, 16, 8, TILE_SIZE);
    g.lineBetween(24, 16, 24, TILE_SIZE);
  });

  paint(TILE.WALL, (g) => {
    paintBase(g, C.wall);
    g.fillStyle(C.wallDark, 1);
    g.fillRect(0, 15, TILE_SIZE, 2);
    g.fillRect(15, 0, 2, 15);
    g.fillRect(7, 17, 2, 15);
    g.fillRect(23, 17, 2, 15);
  });

  paint(TILE.BRIDGE, (g) => {
    paintBase(g, C.bridge);
    g.fillStyle(C.bridgeDark, 1);
    for (let y = 2; y < TILE_SIZE; y += 8) g.fillRect(0, y, TILE_SIZE, 2);
  });

  paint(TILE.PORTAL, (g) => {
    paintBase(g, C.portal);
    g.fillStyle(C.portalGlow, 1);
    g.fillCircle(16, 16, 10);
    g.fillStyle(C.portalCore, 1);
    g.fillCircle(16, 16, 4);
  });

  paint(TILE.CACTUS, (g) => {
    paintBase(g, C.grass);
    g.fillStyle(C.cactus, 1);
    g.fillRect(14, 7, 4, 21);
    g.fillRect(9, 13, 5, 3);
    g.fillRect(18, 18, 5, 3);
  });

  paint(TILE.GATE, (g) => {
    paintBase(g, C.gate);
    g.fillStyle(C.gateBar, 1);
    for (let x = 4; x < TILE_SIZE; x += 8) g.fillRect(x, 0, 2, TILE_SIZE);
  });

  paint(TILE.GATE_OPEN, (g) => {
    paintBase(g, C.gateOpen);
  });

  const atlas = scene.add
    .renderTexture(0, 0, TILE_COUNT * TILE_SIZE, TILE_SIZE)
    .setVisible(false);

  for (let id = 0; id < TILE_COUNT; id += 1) {
    atlas.draw(`tile_${id}`, id * TILE_SIZE, 0);
    scene.textures.remove(`tile_${id}`);
  }

  atlas.saveTexture('tileset');
}

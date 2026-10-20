import { describe, expect, it } from 'vitest';
import {
  TILE,
  TILE_SIZE,
  canStand,
  isSolidTile,
  mapPixelHeight,
  mapPixelWidth,
  moveWithCollision,
  spawnPosition,
  tileAt,
  validateMap,
  type MapData,
} from '@lumiis/shared';

const mapWith = (changes: Record<number, number> = {}, size = 8): MapData => {
  const tiles = new Array(size * size).fill(TILE.GRASS);
  for (const [index, tile] of Object.entries(changes)) tiles[Number(index)] = tile;
  return { id: 'test', width: size, height: size, spawn: { x: 1, y: 1 }, tiles };
};

const at = (x: number, y: number, size = 8): number => y * size + x;

describe('map validation', () => {
  const valid = {
    id: 'testmap',
    width: 2,
    height: 2,
    spawn: { x: 0, y: 0 },
    tiles: [0, 0, 0, 0],
  };

  it('accepts a well formed map', () => {
    const check = validateMap(valid);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.map.width).toBe(2);
  });

  it('rejects anything that is not an object', () => {
    for (const input of [null, undefined, 5, 'map', []]) {
      expect(validateMap(input).ok).toBe(false);
    }
  });

  it('rejects a tile count that does not match the size', () => {
    expect(validateMap({ ...valid, tiles: [0, 0, 0] }).ok).toBe(false);
  });

  it('rejects unknown tile ids', () => {
    expect(validateMap({ ...valid, tiles: [0, 0, 99, 0] }).ok).toBe(false);
    expect(validateMap({ ...valid, tiles: [0, 0, -1, 0] }).ok).toBe(false);
  });

  it('rejects a spawn outside the map', () => {
    expect(validateMap({ ...valid, spawn: { x: 5, y: 0 } }).ok).toBe(false);
  });

  it('rejects an id that is not a key', () => {
    expect(validateMap({ ...valid, id: 'Sohan 2' }).ok).toBe(false);
  });
});

describe('tiles and solidity', () => {
  it('reads tiles by coordinate', () => {
    const map = mapWith({ [at(2, 3)]: TILE.WATER });
    expect(tileAt(map, 2, 3)).toBe(TILE.WATER);
    expect(tileAt(map, 0, 0)).toBe(TILE.GRASS);
  });

  it('treats everything outside the map as wall', () => {
    const map = mapWith();
    expect(tileAt(map, -1, 0)).toBe(TILE.WALL);
    expect(tileAt(map, 8, 0)).toBe(TILE.WALL);
    expect(isSolidTile(map, 0, -1)).toBe(true);
  });

  it('knows which tiles block a player', () => {
    const map = mapWith();
    for (const tile of [TILE.WATER, TILE.TREE, TILE.ROCK, TILE.WALL, TILE.CACTUS, TILE.GATE]) {
      const single = mapWith({ [at(1, 1)]: tile });
      expect(isSolidTile(single, 1, 1)).toBe(true);
    }
    for (const tile of [TILE.GRASS, TILE.PATH, TILE.SAND, TILE.STONE, TILE.BRIDGE, TILE.GATE_OPEN]) {
      const single = mapWith({ [at(1, 1)]: tile });
      expect(isSolidTile(single, 1, 1)).toBe(false);
    }
  });

  it('reports the pixel size', () => {
    const map = mapWith({}, 10);
    expect(mapPixelWidth(map)).toBe(10 * TILE_SIZE);
    expect(mapPixelHeight(map)).toBe(10 * TILE_SIZE);
  });

  it('spawns at the centre of the spawn tile', () => {
    const spawn = spawnPosition(mapWith());
    expect(spawn.x).toBe(1.5 * TILE_SIZE);
    expect(spawn.y).toBeCloseTo(1.9 * TILE_SIZE, 5);
  });
});

describe('standing and walking', () => {
  it('refuses to stand inside a solid tile', () => {
    const map = mapWith({ [at(2, 2)]: TILE.WATER });
    expect(canStand(map, 2.5 * TILE_SIZE, 2.5 * TILE_SIZE)).toBe(false);
    expect(canStand(map, 4.5 * TILE_SIZE, 4.5 * TILE_SIZE)).toBe(true);
  });

  it('stops at a wall instead of walking through it', () => {
    const map = mapWith({ [at(5, 4)]: TILE.WALL });
    let position = { x: 4.5 * TILE_SIZE, y: 4.9 * TILE_SIZE };

    for (let step = 0; step < 100; step += 1) {
      position = moveWithCollision(map, position.x, position.y, 6, 0.05);
    }

    // The right edge of the foot box stops at the wall tile, never inside it.
    expect(position.x + 7).toBeLessThanOrEqual(5 * TILE_SIZE + 0.001);
    expect(position.x).toBeGreaterThan(4 * TILE_SIZE);
  });

  it('slides along a wall when walking diagonally into it', () => {
    // A wall running the whole height of the map: while the player pushes
    // against it, the sideways movement must still happen.
    const walls: Record<number, number> = {};
    for (let y = 0; y < 16; y += 1) walls[at(5, y, 16)] = TILE.WALL;
    const map = mapWith(walls, 16);

    let position = { x: 4.5 * TILE_SIZE, y: 4.9 * TILE_SIZE };
    const startY = position.y;

    for (let step = 0; step < 20; step += 1) {
      position = moveWithCollision(map, position.x, position.y, 7, 0.05);
    }

    expect(position.x + 7).toBeLessThanOrEqual(5 * TILE_SIZE + 0.001);
    expect(position.y).toBeGreaterThan(startY + 60);
  });

  it('cannot leave the map', () => {
    const map = mapWith();
    let position = { x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE };

    for (let step = 0; step < 200; step += 1) {
      position = moveWithCollision(map, position.x, position.y, 3, 0.05);
    }

    expect(position.x).toBeGreaterThanOrEqual(7);
    expect(position.y).toBeGreaterThanOrEqual(10);
  });

  it('walks freely on grass', () => {
    const map = mapWith();
    const start = { x: 4.5 * TILE_SIZE, y: 4.9 * TILE_SIZE };
    const next = moveWithCollision(map, start.x, start.y, 6, 0.05);
    expect(next.x).toBeGreaterThan(start.x);
  });
});

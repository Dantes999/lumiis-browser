import { describe, expect, it } from 'vitest';
import {
  TILE,
  TILE_SIZE,
  canStand,
  findPath,
  isSolidTile,
  nearestWalkable,
  type MapData,
} from '@lumiis/shared';

const SIZE = 16;

const mapOf = (): MapData => ({
  id: 'test',
  width: SIZE,
  height: SIZE,
  spawn: { x: 1, y: 1 },
  tiles: new Array(SIZE * SIZE).fill(TILE.GRASS),
  spawns: [],
});

const setTile = (map: MapData, x: number, y: number, tile: number): void => {
  map.tiles[y * SIZE + x] = tile;
};

const centre = (tx: number, ty: number): { x: number; y: number } => ({
  x: (tx + 0.5) * TILE_SIZE,
  y: (ty + 0.5) * TILE_SIZE,
});

const start = centre(2, 2);

describe('nearest walkable tile', () => {
  it('returns the tile itself when it is free', () => {
    expect(nearestWalkable(mapOf(), 5, 5)).toEqual({ tx: 5, ty: 5 });
  });

  it('steps aside when the tile is blocked', () => {
    const map = mapOf();
    setTile(map, 5, 5, TILE.WATER);
    const spot = nearestWalkable(map, 5, 5);
    expect(spot).not.toBeNull();
    expect(isSolidTile(map, spot?.tx ?? 0, spot?.ty ?? 0)).toBe(false);
  });
});

describe('finding a route', () => {
  it('walks straight across open ground', () => {
    const map = mapOf();
    const path = findPath(map, start, centre(8, 2));

    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThan(0);

    const last = path?.[path.length - 1];
    expect(last?.x).toBeGreaterThan(7 * TILE_SIZE);
    for (const point of path ?? []) expect(canStand(map, point.x, point.y)).toBe(true);
  });

  it('goes around a wall instead of through it', () => {
    const map = mapOf();
    for (let y = 0; y < 14; y += 1) setTile(map, 6, y, TILE.WALL);

    const path = findPath(map, start, centre(10, 2));
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThan(6);

    for (const point of path ?? []) {
      const tile = map.tiles[Math.floor(point.y / TILE_SIZE) * SIZE + Math.floor(point.x / TILE_SIZE)];
      expect(tile).not.toBe(TILE.WALL);
    }
    // The only way through is the gap at the bottom.
    const lowest = Math.max(...(path ?? []).map((p) => p.y));
    expect(lowest).toBeGreaterThan(13 * TILE_SIZE);
  });

  it('never squeezes between two diagonal walls', () => {
    const map = mapOf();
    for (let i = 0; i < SIZE; i += 1) setTile(map, 8, i, TILE.WALL);
    // Exactly one opening, in row 10.
    setTile(map, 8, 10, TILE.GRASS);

    const path = findPath(map, centre(5, 8), centre(11, 8));
    expect(path).not.toBeNull();

    // The only legal way through is that opening; a corner cut would not be.
    const tiles = (path ?? []).map((p) => ({
      tx: Math.floor(p.x / TILE_SIZE),
      ty: Math.floor(p.y / TILE_SIZE),
    }));
    expect(tiles).toContainEqual({ tx: 8, ty: 10 });
  });

  it('returns nothing when the target is sealed off', () => {
    const map = mapOf();
    setTile(map, 10, 8, TILE.GRASS);
    for (const [x, y] of [
      [9, 8],
      [11, 8],
      [10, 7],
      [10, 9],
    ]) {
      setTile(map, x as number, y as number, TILE.WALL);
    }

    expect(findPath(map, start, centre(10, 8))).toBeNull();
  });

  it('returns nothing when the player is sealed in', () => {
    const map = mapOf();
    for (const [x, y] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ]) {
      setTile(map, x as number, y as number, TILE.WALL);
    }

    expect(findPath(map, start, centre(10, 10))).toBeNull();
  });

  it('aims at the nearest open tile when the target is a tree', () => {
    const map = mapOf();
    setTile(map, 10, 8, TILE.TREE);

    const path = findPath(map, centre(5, 8), centre(10, 8));
    expect(path).not.toBeNull();

    const last = path?.[path.length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) expect(canStand(map, last.x, last.y)).toBe(true);
  });

  it('handles a target on the very tile the player stands on', () => {
    const map = mapOf();
    const path = findPath(map, start, start);
    expect(path).not.toBeNull();
    expect(path?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

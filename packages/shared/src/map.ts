// The map: tile ids, validation, and everything that decides where a player may
// stand. Imported by the server (authority) and the browser (prediction), so a
// wall blocks in exactly the same place on both sides.

import { TILE_SIZE } from './constants.js';
import { WALK_SPEED, stepPosition } from './movement.js';
import type { Direction } from './movement.js';

/** Tile ids are the same as in the map editor, so its overlays stay readable. */
export const TILE = {
  GRASS: 0,
  FLOWERS: 1,
  PATH: 2,
  WATER: 3,
  SAND: 4,
  TREE: 5,
  ROCK: 6,
  STONE: 7,
  WALL: 8,
  BRIDGE: 9,
  PORTAL: 10,
  CACTUS: 11,
  GATE: 12,
  GATE_OPEN: 13,
} as const;

export const TILE_COUNT = 14;

/** Tiles a player cannot stand on. */
export const SOLID: ReadonlySet<number> = new Set<number>([
  TILE.WATER,
  TILE.TREE,
  TILE.ROCK,
  TILE.WALL,
  TILE.CACTUS,
  TILE.GATE,
]);

export type MapData = {
  id: string;
  width: number;
  height: number;
  /** Spawn point in tiles. */
  spawn: { x: number; y: number };
  /** Row-major tile ids, length width * height. */
  tiles: number[];
};

export type MapCheck = { ok: true; map: MapData } | { ok: false; errors: string[] };

const MAX_MAP_TILES = 256;

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/** Validates untrusted map json. A broken map must never reach the game. */
export function validateMap(input: unknown): MapCheck {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['map is not an object'] };
  }

  const raw = input as Record<string, unknown>;
  const id = raw['id'];
  const width = raw['width'];
  const height = raw['height'];
  const spawn = raw['spawn'];
  const tiles = raw['tiles'];

  if (typeof id !== 'string' || !/^[a-z0-9_]{1,32}$/.test(id)) {
    errors.push('id must be lowercase letters, digits and underscore');
  }
  if (!isInteger(width) || width < 1 || width > MAX_MAP_TILES) {
    errors.push(`width must be an integer between 1 and ${MAX_MAP_TILES}`);
  }
  if (!isInteger(height) || height < 1 || height > MAX_MAP_TILES) {
    errors.push(`height must be an integer between 1 and ${MAX_MAP_TILES}`);
  }
  if (!Array.isArray(tiles)) {
    errors.push('tiles must be an array');
  } else if (isInteger(width) && isInteger(height) && tiles.length !== width * height) {
    errors.push(`tiles has ${tiles.length} entries, expected ${width * height}`);
  } else if (tiles.some((tile) => !isInteger(tile) || tile < 0 || tile >= TILE_COUNT)) {
    errors.push(`every tile must be an integer between 0 and ${TILE_COUNT - 1}`);
  }

  if (typeof spawn !== 'object' || spawn === null) {
    errors.push('spawn must be an object with x and y');
  } else {
    const point = spawn as Record<string, unknown>;
    if (!isInteger(point['x']) || !isInteger(point['y'])) {
      errors.push('spawn x and y must be integers');
    } else if (
      isInteger(width) &&
      isInteger(height) &&
      (point['x'] < 0 || point['x'] >= width || point['y'] < 0 || point['y'] >= height)
    ) {
      errors.push('spawn must be inside the map');
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    map: {
      id: id as string,
      width: width as number,
      height: height as number,
      spawn: { x: (spawn as { x: number }).x, y: (spawn as { y: number }).y },
      tiles: tiles as number[],
    },
  };
}

export const mapPixelWidth = (map: MapData): number => map.width * TILE_SIZE;
export const mapPixelHeight = (map: MapData): number => map.height * TILE_SIZE;

/** Tile id at a tile coordinate; outside the map counts as solid ground. */
export function tileAt(map: MapData, tileX: number, tileY: number): number {
  if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return TILE.WALL;
  return map.tiles[tileY * map.width + tileX] ?? TILE.WALL;
}

export function isSolidTile(map: MapData, tileX: number, tileY: number): boolean {
  return SOLID.has(tileAt(map, tileX, tileY));
}

/** The player's foot box. The sprite is 48 px tall, the feet are what collide. */
export const PLAYER_HALF_WIDTH = 7;
export const PLAYER_HEIGHT = 10;

/** True when a player standing at this pixel position fits between walls. */
export function canStand(map: MapData, x: number, y: number): boolean {
  const left = x - PLAYER_HALF_WIDTH;
  const right = x + PLAYER_HALF_WIDTH;
  const top = y - PLAYER_HEIGHT;
  const bottom = y - 0.01;

  const corners: ReadonlyArray<readonly [number, number]> = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];

  for (const [px, py] of corners) {
    if (isSolidTile(map, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE))) return false;
  }
  return true;
}

/**
 * One step with collision. Axes are resolved separately, which is what lets a
 * player slide along a wall instead of sticking to it.
 */
export function moveWithCollision(
  map: MapData,
  x: number,
  y: number,
  dir: Direction,
  deltaSeconds: number,
  speed: number = WALK_SPEED,
): { x: number; y: number } {
  const target = stepPosition(x, y, dir, deltaSeconds, speed);

  const nextX = canStand(map, target.x, y) ? target.x : x;
  const nextY = canStand(map, nextX, target.y) ? target.y : y;

  return { x: nextX, y: nextY };
}

/** Centre of the spawn tile in pixels. */
export function spawnPosition(map: MapData): { x: number; y: number } {
  return {
    x: (map.spawn.x + 0.5) * TILE_SIZE,
    y: (map.spawn.y + 0.9) * TILE_SIZE,
  };
}

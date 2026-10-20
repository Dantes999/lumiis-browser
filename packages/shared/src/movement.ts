// Movement rules. This file is imported by the server *and* the browser, so a
// position that the client predicts is computed by exactly the same code the
// server uses to decide where the player really is.

import { TILE_SIZE } from './constants.js';

/** The test world is a square of tiles. Real maps replace this later. */
export const WORLD_TILES = 64;
export const WORLD_PIXELS = WORLD_TILES * TILE_SIZE;

/** Walking speed in pixels per second. One tile is TILE_SIZE pixels. */
export const WALK_SPEED = TILE_SIZE * 4;

/** Keeps the feet this many pixels away from the world border. */
export const PLAYER_INSET = 8;

export const DIR_COUNT = 8;

/** 0 = south, then clockwise: sw, w, nw, n, ne, e, se. */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DIR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < DIR_COUNT;
}

/**
 * Turns a raw input vector into one of the eight directions.
 * Diagonals are clamped, so "right + up + extra" is still north-east.
 */
export function dirFromInput(dx: number, dy: number): Direction | null {
  const x = Math.sign(Math.max(-1, Math.min(1, Math.trunc(dx))));
  const y = Math.sign(Math.max(-1, Math.min(1, Math.trunc(dy))));
  if (x === 0 && y === 0) return null;

  for (let dir = 0; dir < DIR_COUNT; dir += 1) {
    const vector = DIR_VECTORS[dir];
    if (vector !== undefined && vector[0] === x && vector[1] === y) return dir as Direction;
  }
  return null;
}

const clamp = (value: number): number =>
  Math.min(WORLD_PIXELS - PLAYER_INSET, Math.max(PLAYER_INSET, value));

export type Position = { x: number; y: number };

/**
 * One movement step. Pure function: same input, same result, forever.
 * Diagonals are normalised so walking north-east is not faster than north.
 */
export function stepPosition(
  x: number,
  y: number,
  dir: Direction,
  deltaSeconds: number,
  speed: number = WALK_SPEED,
): Position {
  const vector = DIR_VECTORS[dir];
  if (vector === undefined) return { x, y };

  const length = Math.hypot(vector[0], vector[1]);
  const stepX = (vector[0] / length) * speed * deltaSeconds;
  const stepY = (vector[1] / length) * speed * deltaSeconds;

  return { x: clamp(x + stepX), y: clamp(y + stepY) };
}

// Finding a walking route across the tile grid.
//
// A* with eight directions, no corner cutting and a hard limit on visited
// tiles, so one click can never freeze the game. Pure data in, pure data out.

import { TILE_SIZE } from './constants.js';
import { canStand, isSolidTile, type MapData } from './map.js';

export type Point = { x: number; y: number };

const STRAIGHT_COST = 10;
const DIAGONAL_COST = 14;
const MAX_VISITED = 6000;
const NEAREST_RADIUS = 5;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, STRAIGHT_COST],
  [1, -1, DIAGONAL_COST],
  [1, 0, STRAIGHT_COST],
  [1, 1, DIAGONAL_COST],
  [0, 1, STRAIGHT_COST],
  [-1, 1, DIAGONAL_COST],
  [-1, 0, STRAIGHT_COST],
  [-1, -1, DIAGONAL_COST],
];

const tileX = (x: number): number => Math.floor(x / TILE_SIZE);
const tileY = (y: number): number => Math.floor(y / TILE_SIZE);
const centre = (tx: number, ty: number): Point => ({
  x: (tx + 0.5) * TILE_SIZE,
  y: (ty + 0.5) * TILE_SIZE,
});

/** The closest standable tile to a point, searched ring by ring. */
export function nearestWalkable(
  map: MapData,
  tx: number,
  ty: number,
  radius: number = NEAREST_RADIUS,
): { tx: number; ty: number } | null {
  for (let ring = 0; ring <= radius; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        // Only the border of each ring; the inside was checked already.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (!isSolidTile(map, x, y)) return { tx: x, ty: y };
      }
    }
  }
  return null;
}

/** Binary heap keyed by f-score; small and fast enough for a 64x64 map. */
class MinHeap {
  private readonly ids: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, score: number): void {
    this.ids.push(id);
    this.scores.push(score);
    let index = this.ids.length - 1;

    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((this.scores[parent] ?? 0) <= (this.scores[index] ?? 0)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number | null {
    if (this.ids.length === 0) return null;

    const top = this.ids[0] ?? null;
    const lastId = this.ids.pop();
    const lastScore = this.scores.pop();

    if (this.ids.length > 0 && lastId !== undefined && lastScore !== undefined) {
      this.ids[0] = lastId;
      this.scores[0] = lastScore;

      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;

        if (left < this.ids.length && (this.scores[left] ?? 0) < (this.scores[smallest] ?? 0)) {
          smallest = left;
        }
        if (right < this.ids.length && (this.scores[right] ?? 0) < (this.scores[smallest] ?? 0)) {
          smallest = right;
        }
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }

    return top;
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a];
    const score = this.scores[a];
    this.ids[a] = this.ids[b] as number;
    this.scores[a] = this.scores[b] as number;
    this.ids[b] = id as number;
    this.scores[b] = score as number;
  }
}

const octile = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT_COST * (dx + dy) - 6 * Math.min(dx, dy);
};

/**
 * Route from one pixel position to another.
 * Returns tile-centre waypoints (the last one may be the exact target) or null
 * when there is no way through. The start tile is not part of the result.
 */
export function findPath(map: MapData, from: Point, to: Point): Point[] | null {
  const startTx = tileX(from.x);
  const startTy = tileY(from.y);
  const goalTx = tileX(to.x);
  const goalTy = tileY(to.y);

  if (startTx < 0 || startTy < 0 || startTx >= map.width || startTy >= map.height) return null;

  const goal = isSolidTile(map, goalTx, goalTy)
    ? nearestWalkable(map, goalTx, goalTy)
    : { tx: goalTx, ty: goalTy };
  if (goal === null) return null;

  const width = map.width;
  const height = map.height;
  const startId = startTy * width + startTx;
  const goalId = goal.ty * width + goal.tx;

  if (startId === goalId) {
    return canStand(map, to.x, to.y) ? [to] : [];
  }

  const gScore = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  gScore[startId] = 0;

  const open = new MinHeap();
  open.push(startId, octile(startTx, startTy, goal.tx, goal.ty));

  let visited = 0;

  while (open.size > 0) {
    const currentId = open.pop();
    if (currentId === null) break;
    if (closed[currentId] === 1) continue;
    closed[currentId] = 1;
    visited += 1;
    if (visited > MAX_VISITED) break;

    if (currentId === goalId) {
      return rebuild(map, cameFrom, currentId, to);
    }

    const cx = currentId % width;
    const cy = Math.floor(currentId / width);

    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (isSolidTile(map, nx, ny)) continue;

      // Diagonals may not slip through the corner of two walls.
      if (dx !== 0 && dy !== 0) {
        if (isSolidTile(map, cx + dx, cy) || isSolidTile(map, cx, cy + dy)) continue;
      }

      const neighbourId = ny * width + nx;
      if (closed[neighbourId] === 1) continue;

      const tentative = (gScore[currentId] ?? 0) + cost;
      if (tentative >= (gScore[neighbourId] ?? Number.POSITIVE_INFINITY)) continue;

      gScore[neighbourId] = tentative;
      cameFrom[neighbourId] = currentId;
      open.push(neighbourId, tentative + octile(nx, ny, goal.tx, goal.ty));
    }
  }

  return null;
}

function rebuild(map: MapData, cameFrom: Int32Array, goalId: number, exact: Point): Point[] {
  const width = map.width;
  const tiles: number[] = [];

  let current = goalId;
  while (current !== -1) {
    tiles.push(current);
    current = cameFrom[current] ?? -1;
  }
  tiles.reverse();

  // The first tile is where the player already stands.
  const waypoints = tiles.slice(1).map((id) => centre(id % width, Math.floor(id / width)));

  if (waypoints.length > 0 && canStand(map, exact.x, exact.y)) {
    waypoints[waypoints.length - 1] = exact;
  }
  return waypoints;
}

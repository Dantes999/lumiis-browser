// Monster decisions: whom to chase, which way to go, where to wander.
//
// The world class runs the tick; this file only answers "which direction next",
// so a monster that walks into a rock or refuses to follow a player is debugged
// here. Nothing in here mutates the world — it writes only into the monster it
// is given.

import {
  DIR_VECTORS,
  TILE_SIZE,
  canStand,
  findPath,
  dirFromInput,
  type Direction,
  type MapData,
  type Point,
} from '@lumiis/shared';
import type { Monster, Player } from './world.js';

/** How often a chasing monster looks for a new route (half a second). */
export const PATH_REFRESH_TICKS = 10;
/** Close enough to a waypoint to take the next one. */
export const WAYPOINT_REACHED = 8;

/** The closest living player inside the monster's aggro radius, or null. */
export function findTarget(players: Iterable<Player>, monster: Monster): Player | null {
  let best: Player | null = null;
  let bestDistance = monster.aggro;

  for (const player of players) {
    if (player.deadUntil > 0) continue;
    const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
    if (distance <= bestDistance) {
      best = player;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * The next direction towards a target, following an A* route around obstacles.
 * The route is rebuilt when the target changes tile or after a short while.
 * Writes the route into the monster so the step is remembered between ticks.
 */
export function chaseDirection(
  map: MapData,
  monster: Monster,
  target: Player,
  tick: number,
): Direction | null {
  const targetTile = Math.floor(target.y / TILE_SIZE) * map.width + Math.floor(target.x / TILE_SIZE);

  const stale =
    monster.path.length === 0 ||
    monster.pathTile !== targetTile ||
    tick >= monster.nextPathTick;

  if (stale) {
    monster.path = findPath(map, { x: monster.x, y: monster.y }, { x: target.x, y: target.y }) ?? [];
    monster.pathStep = 0;
    monster.pathTile = targetTile;
    monster.nextPathTick = tick + PATH_REFRESH_TICKS;
  }

  while (monster.pathStep < monster.path.length) {
    const point: Point | undefined = monster.path[monster.pathStep];
    if (point === undefined) break;
    if (Math.hypot(point.x - monster.x, point.y - monster.y) > WAYPOINT_REACHED) break;
    monster.pathStep += 1;
  }

  const waypoint = monster.path[monster.pathStep];
  if (waypoint === undefined) {
    return dirFromInput(target.x - monster.x, target.y - monster.y);
  }
  return dirFromInput(waypoint.x - monster.x, waypoint.y - monster.y);
}

/**
 * A random direction whose next tile the monster can stand on, so it does not
 * wander blindly into a rock and hang there. Null when it is boxed in.
 */
export function randomWalkableDirection(
  map: MapData,
  monster: Monster,
  random: () => number,
): Direction | null {
  const tx = Math.floor(monster.x / TILE_SIZE);
  const ty = Math.floor(monster.y / TILE_SIZE);
  const options: Direction[] = [];

  for (let dir = 0; dir < 8; dir += 1) {
    const vector = DIR_VECTORS[dir];
    if (vector === undefined) continue;
    const cx = (tx + vector[0] + 0.5) * TILE_SIZE;
    const cy = (ty + vector[1] + 0.5) * TILE_SIZE;
    if (canStand(map, cx, cy)) options.push(dir as Direction);
  }

  if (options.length === 0) return null;
  return options[Math.floor(random() * options.length)] ?? null;
}

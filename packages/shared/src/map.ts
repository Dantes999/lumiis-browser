// The map: tile ids, validation, and everything that decides where a player may
// stand. Imported by the server (authority) and the browser (prediction), so a
// wall blocks in exactly the same place on both sides.

import { TILE_SIZE } from './constants.js';
import { WALK_SPEED, stepPosition } from './movement.js';
import type { Direction } from './movement.js';
import { isMonsterKey, type MonsterKey } from './monsters.js';

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

/** A tile that takes the player to another map. */
export type Portal = {
  /** Where the portal tile is. */
  tx: number;
  ty: number;
  /** Map the player arrives on. */
  to: string;
  /** Tile the player arrives at. */
  spawnX: number;
  spawnY: number;
};

export type MonsterSpawn = {
  kind: 'mob';
  key: MonsterKey;
  /** Tile coordinates. */
  tx: number;
  ty: number;
};

/**
 * A rectangular part of one map that runs on its own game thread. Zones are
 * only connected through portals: two zones must keep their walkable ground
 * apart, otherwise a player would see across the border and things would pop.
 */
export type MapZone = {
  /** Short id, unique inside the map. */
  id: string;
  /** Tile bounds, both inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * How far one player can see. The snapshot covers the 3x3 cells around his
 * cell, and a cell is 256 px, so the farthest visible point is 511 px away.
 */
export const ZONE_VIEW_PX = 512;

/** The same distance in tiles; zone ground must be at least this far apart. */
export const ZONE_VIEW_TILES = ZONE_VIEW_PX / TILE_SIZE;

export type MapData = {
  id: string;
  width: number;
  height: number;
  /** Spawn point in tiles. */
  spawn: { x: number; y: number };
  /** Row-major tile ids, length width * height. */
  tiles: number[];
  /** Where monsters start out. */
  spawns: MonsterSpawn[];
  /** Tiles that lead to other maps. */
  portals: Portal[];
  /** Parts of the map that run on separate threads; absent means one zone. */
  zones?: MapZone[];
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

  const rawPortals = raw['portals'];
  const portals: Portal[] = [];

  if (rawPortals !== undefined) {
    if (!Array.isArray(rawPortals)) {
      errors.push('portals must be an array');
    } else {
      rawPortals.forEach((entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
          errors.push(`portal ${index} is not an object`);
          return;
        }
        const point = entry as Record<string, unknown>;
        const tx = point['tx'];
        const ty = point['ty'];
        const to = point['to'];
        const spawnX = point['spawnX'];
        const spawnY = point['spawnY'];

        if (typeof to !== 'string' || !/^[a-z0-9_]{1,32}$/.test(to)) {
          errors.push(`portal ${index} needs a target map`);
        }
        if (![tx, ty, spawnX, spawnY].every(isInteger)) {
          errors.push(`portal ${index} needs integer tiles`);
        } else if (
          isInteger(tx) &&
          isInteger(ty) &&
          isInteger(width) &&
          isInteger(height) &&
          (tx < 0 || ty < 0 || tx >= width || ty >= height)
        ) {
          errors.push(`portal ${index} is outside the map`);
        }

        if (typeof to === 'string' && [tx, ty, spawnX, spawnY].every(isInteger)) {
          portals.push({
            tx: tx as number,
            ty: ty as number,
            to,
            spawnX: spawnX as number,
            spawnY: spawnY as number,
          });
        }
      });
    }
  }

  const rawSpawns = raw['spawns'];
  const spawns: MonsterSpawn[] = [];

  if (rawSpawns !== undefined) {
    if (!Array.isArray(rawSpawns)) {
      errors.push('spawns must be an array');
    } else {
      rawSpawns.forEach((entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
          errors.push(`spawn ${index} is not an object`);
          return;
        }
        const point = entry as Record<string, unknown>;
        const key = point['key'];
        const tx = point['tx'];
        const ty = point['ty'];

        if (point['kind'] !== 'mob') errors.push(`spawn ${index} must have kind "mob"`);
        if (!isMonsterKey(key)) errors.push(`spawn ${index} names an unknown monster`);
        if (!isInteger(tx) || !isInteger(ty)) {
          errors.push(`spawn ${index} needs integer tx and ty`);
        } else if (
          isInteger(width) &&
          isInteger(height) &&
          (tx < 0 || ty < 0 || tx >= width || ty >= height)
        ) {
          errors.push(`spawn ${index} is outside the map`);
        }

        if (isMonsterKey(key) && isInteger(tx) && isInteger(ty)) {
          spawns.push({ kind: 'mob', key, tx, ty });
        }
      });
    }
  }

  // ---------------------------------------------------------------- zones
  let zones: MapZone[] | undefined;

  if (raw['zones'] !== undefined) {
    if (!Array.isArray(raw['zones'])) {
      errors.push('zones must be an array');
    } else {
      const list: MapZone[] = [];
      const seenIds = new Set<string>();

      raw['zones'].forEach((entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
          errors.push(`zone ${index} is not an object`);
          return;
        }
        const zone = entry as Record<string, unknown>;
        const zoneId = zone['id'];
        const x0 = zone['x0'];
        const y0 = zone['y0'];
        const x1 = zone['x1'];
        const y1 = zone['y1'];

        if (typeof zoneId !== 'string' || !/^[a-z0-9_]{1,16}$/.test(zoneId)) {
          errors.push(`zone ${index} needs an id of lowercase letters, digits or underscore`);
        } else if (seenIds.has(zoneId)) {
          errors.push(`zone id "${zoneId}" is used twice`);
        }

        if (![x0, y0, x1, y1].every(isInteger)) {
          errors.push(`zone ${index} needs integer tile bounds`);
        } else if (
          isInteger(width) &&
          isInteger(height) &&
          ((x0 as number) < 0 ||
            (y0 as number) < 0 ||
            (x1 as number) >= width ||
            (y1 as number) >= height ||
            (x0 as number) > (x1 as number) ||
            (y0 as number) > (y1 as number))
        ) {
          errors.push(`zone ${index} is outside the map or has swapped bounds`);
        }

        if (
          typeof zoneId === 'string' &&
          /^[a-z0-9_]{1,16}$/.test(zoneId) &&
          [x0, y0, x1, y1].every(isInteger) &&
          isInteger(width) &&
          isInteger(height) &&
          (x0 as number) >= 0 &&
          (y0 as number) >= 0 &&
          (x1 as number) < width &&
          (y1 as number) < height &&
          (x0 as number) <= (x1 as number) &&
          (y0 as number) <= (y1 as number)
        ) {
          seenIds.add(zoneId);
          list.push({
            id: zoneId,
            x0: x0 as number,
            y0: y0 as number,
            x1: x1 as number,
            y1: y1 as number,
          });
        }
      });

      if (list.length !== raw['zones'].length || list.length === 0) {
        errors.push('every zone must be valid; a split map needs at least one zone');
      }
      zones = list;

      // Coverage and separation only make sense with valid bounds and tiles.
      const mapArea =
        isInteger(width) &&
        isInteger(height) &&
        Array.isArray(tiles) &&
        tiles.length === (width as number) * (height as number);

      if (mapArea && list.length > 0 && errors.length === 0) {
        const w = width as number;
        const h = height as number;
        const grid = tiles as number[];

        let uncovered = 0;
        let shared = 0;
        for (let ty = 0; ty < h; ty += 1) {
          for (let tx = 0; tx < w; tx += 1) {
            if (SOLID.has(grid[ty * w + tx] as number)) continue;
            let hits = 0;
            for (const zone of list) {
              if (tx >= zone.x0 && tx <= zone.x1 && ty >= zone.y0 && ty <= zone.y1) hits += 1;
            }
            if (hits === 0) uncovered += 1;
            else if (hits > 1) shared += 1;
          }
        }
        if (uncovered > 0) errors.push(`${uncovered} walkable tiles are in no zone`);
        if (shared > 0) errors.push(`${shared} walkable tiles are in more than one zone`);

        const spawnX = (spawn as { x: number }).x;
        const spawnY = (spawn as { y: number }).y;
        const spawnZone = list.some(
          (zone) =>
            spawnX >= zone.x0 && spawnX <= zone.x1 && spawnY >= zone.y0 && spawnY <= zone.y1,
        );
        if (!spawnZone) errors.push('the spawn point is not inside a zone');

        // Two zones must not see each other: measure from one zone's walkable
        // tiles to the other's with a capped 8-neighbour flood fill.
        for (let a = 0; a < list.length; a += 1) {
          for (let b = a + 1; b < list.length; b += 1) {
            const first = list[a] as MapZone;
            const second = list[b] as MapZone;
            const distance = new Int16Array(w * h).fill(-1);
            const queue: number[] = [];

            for (let ty = first.y0; ty <= first.y1; ty += 1) {
              for (let tx = first.x0; tx <= first.x1; tx += 1) {
                const index = ty * w + tx;
                if (SOLID.has(grid[index] as number)) continue;
                distance[index] = 0;
                queue.push(index);
              }
            }

            for (let head = 0; head < queue.length; head += 1) {
              const index = queue[head] as number;
              const step = distance[index] as number;
              if (step >= ZONE_VIEW_TILES) continue;
              const tx = index % w;
              const ty = (index - tx) / w;
              for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  if (dx === 0 && dy === 0) continue;
                  const nx = tx + dx;
                  const ny = ty + dy;
                  if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                  const next = ny * w + nx;
                  if (distance[next] !== -1) continue;
                  distance[next] = step + 1;
                  queue.push(next);
                }
              }
            }

            let tooClose = false;
            for (let ty = second.y0; ty <= second.y1 && !tooClose; ty += 1) {
              for (let tx = second.x0; tx <= second.x1; tx += 1) {
                const index = ty * w + tx;
                if (SOLID.has(grid[index] as number)) continue;
                const value = distance[index] as number;
                if (value !== -1 && value < ZONE_VIEW_TILES) {
                  tooClose = true;
                  break;
                }
              }
            }

            if (tooClose) {
              errors.push(
                `zones "${first.id}" and "${second.id}" are closer than ${ZONE_VIEW_TILES} tiles; ` +
                  'players would see across the border',
              );
            }
          }
        }
      }
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
      spawns,
      portals,
      ...(zones !== undefined ? { zones } : {}),
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

/** The zones of a map; a map without zones is one zone named "main". */
export const zonesOf = (map: MapData): MapZone[] =>
  map.zones ?? [{ id: 'main', x0: 0, y0: 0, x1: map.width - 1, y1: map.height - 1 }];

/** The zone a tile lies in, or null when it lies in none (walls, gaps). */
export function zoneAtTile(map: MapData, tx: number, ty: number): MapZone | null {
  for (const zone of zonesOf(map)) {
    if (tx >= zone.x0 && tx <= zone.x1 && ty >= zone.y0 && ty <= zone.y1) return zone;
  }
  return null;
}

/** The zone a pixel position lies in. */
export function zoneAtPixel(map: MapData, x: number, y: number): MapZone | null {
  return zoneAtTile(map, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
}

/**
 * Stable key of the world that runs this zone on this channel. A map without
 * zones and with one channel keeps its map id, so nothing changes for maps
 * that were never split or copied.
 */
export const worldKeyOf = (
  map: MapData,
  zone: MapZone,
  channel = 1,
  channelCount = 1,
): string => {
  const parts = [map.id];
  if (map.zones !== undefined) parts.push(zone.id);
  if (channelCount > 1) parts.push(`ch${channel}`);
  return parts.join('#');
};

/** The keys of all channels of one zone. */
export const channelKeysOf = (
  map: MapData,
  zone: MapZone,
  channelCount: number,
): string[] => {
  const keys: string[] = [];
  for (let channel = 1; channel <= channelCount; channel += 1) {
    keys.push(worldKeyOf(map, zone, channel, channelCount));
  }
  return keys;
};

/** The zone at a pixel position, falling back to the map spawn. */
export function zoneAtOrSpawn(map: MapData, x: number, y: number): MapZone {
  return (
    zoneAtPixel(map, x, y) ??
    zoneAtTile(map, map.spawn.x, map.spawn.y) ??
    (zonesOf(map)[0] as MapZone)
  );
}

/** World key at a pixel position, falling back to the map spawn. */
export function worldKeyAt(
  map: MapData,
  x: number,
  y: number,
  channel = 1,
  channelCount = 1,
): string {
  return worldKeyOf(map, zoneAtOrSpawn(map, x, y), channel, channelCount);
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

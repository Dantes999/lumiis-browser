// Loading a map from disk. A broken map stops the server at startup instead of
// letting players walk through walls that only exist in the file.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { TILE, tileAt, validateMap, zoneAtTile, type MapData } from '@lumiis/shared';

export function loadMap(filePath: string): MapData {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read map ${filePath}: ${(error as Error).message}`);
  }

  const check = validateMap(raw);
  if (!check.ok) {
    throw new Error(`map ${filePath} is invalid:\n  ${check.errors.join('\n  ')}`);
  }
  return check.map;
}

/**
 * Loads every map file next to the given one, so portals can point anywhere.
 * The file the server was started with comes first: it is the default map.
 */
export function loadMaps(filePath: string): MapData[] {
  const folder = dirname(filePath);
  const names = readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const official = names.indexOf(basename(filePath));
  if (official > 0) {
    names.splice(official, 1);
    names.unshift(basename(filePath));
  }

  const maps = names.map((name) => loadMap(join(folder, name)));
  if (maps.length === 0) throw new Error(`no maps in ${folder}`);

  // A player must land in a real world, not in a gap between zones.
  const byId = new Map(maps.map((map) => [map.id, map]));
  for (const map of maps) {
    for (const portal of map.portals) {
      const target = byId.get(portal.to);
      if (target === undefined) {
        throw new Error(`map ${map.id}: portal leads to unknown map "${portal.to}"`);
      }
      if (
        portal.spawnX < 0 ||
        portal.spawnY < 0 ||
        portal.spawnX >= target.width ||
        portal.spawnY >= target.height
      ) {
        throw new Error(`map ${map.id}: portal arrives outside ${target.id}`);
      }
      if (zoneAtTile(target, portal.spawnX, portal.spawnY) === null) {
        throw new Error(
          `map ${map.id}: portal arrives at ${portal.spawnX},${portal.spawnY} on ` +
            `${target.id}, which is in no zone`,
        );
      }
      if (tileAt(target, portal.spawnX, portal.spawnY) === TILE.PORTAL) {
        throw new Error(
          `map ${map.id}: portal arrives on the portal at ${portal.spawnX},${portal.spawnY} ` +
            `on ${target.id}; the player would bounce straight back`,
        );
      }
    }
  }

  return maps;
}

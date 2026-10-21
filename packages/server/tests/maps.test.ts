// Every map that ships must load. This catches the mistakes that would
// otherwise only show up at startup: a bad tile id, a portal into a wall, a
// start map that no longer exists.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { START_MAP } from '@lumiis/shared';
import { loadMaps } from '../src/game/map.js';

const mapsFolder = fileURLToPath(new URL('../../shared/maps/testmap.json', import.meta.url));

describe('shipped maps', () => {
  it('all load, and the start map exists', () => {
    const maps = loadMaps(mapsFolder);
    const ids = maps.map((map) => map.id).sort();

    expect(ids).toEqual(['greenfield', 'grove', 'testmap']);
    expect(ids).toContain(START_MAP);
  });

  it('the start map has ground at its spawn and monsters to fight', () => {
    const maps = loadMaps(mapsFolder);
    const start = maps.find((map) => map.id === START_MAP);
    expect(start).toBeDefined();
    if (start === undefined) return;

    const spawnTile = start.tiles[start.spawn.y * start.width + start.spawn.x] ?? -1;
    // GRASS(0), FLOWERS(1), PATH(2), SAND(4), STONE(7) are walkable.
    expect([0, 1, 2, 4, 7]).toContain(spawnTile);
    expect(start.spawns.length).toBeGreaterThan(0);
  });
});

// A map can be split into zones. Each zone is its own world, in its own thread,
// and the only way from one zone to another is a portal. These tests pin the
// rules down: every walkable tile belongs to exactly one zone, two zones never
// see each other, and a portal moves the player without changing map or id.

import { describe, expect, it } from 'vitest';
import {
  TILE,
  validateMap,
  worldKeyAt,
  zonesOf,
  type MapData,
} from '@lumiis/shared';
import { Realm } from '../src/game/realm.js';

const WIDTH = 96;
const HEIGHT = 48;

/** Two districts, a 16 tile rock band between them, one portal each side. */
const splitMap = (): MapData => {
  const tiles = new Array<number>(WIDTH * HEIGHT).fill(TILE.GRASS);
  for (let ty = 0; ty < HEIGHT; ty += 1) {
    for (let tx = 40; tx <= 55; tx += 1) tiles[ty * WIDTH + tx] = TILE.ROCK;
  }
  tiles[24 * WIDTH + 39] = TILE.PORTAL;
  tiles[24 * WIDTH + 56] = TILE.PORTAL;

  return {
    id: 'split',
    width: WIDTH,
    height: HEIGHT,
    spawn: { x: 8, y: 24 },
    tiles,
    spawns: [
      { kind: 'mob', key: 'wolf', tx: 20, ty: 24 },
      { kind: 'mob', key: 'wolf', tx: 70, ty: 24 },
    ],
    portals: [
      { tx: 39, ty: 24, to: 'split', spawnX: 56, spawnY: 25 },
      { tx: 56, ty: 24, to: 'split', spawnX: 39, spawnY: 25 },
    ],
    zones: [
      { id: 'west', x0: 0, y0: 0, x1: 39, y1: 47 },
      { id: 'east', x0: 56, y0: 0, x1: 95, y1: 47 },
    ],
  };
};

const plain = (map: MapData): unknown => JSON.parse(JSON.stringify(map));
const errorsOf = (check: ReturnType<typeof validateMap>): string =>
  check.ok ? '' : check.errors.join(' | ');

describe('zones', () => {
  it('accepts a map whose walkable ground is split by a wide band', () => {
    const check = validateMap(plain(splitMap()));
    expect(errorsOf(check)).toBe('');
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.map.zones).toHaveLength(2);
  });

  it('rejects walkable ground that belongs to no zone', () => {
    const map = splitMap();
    map.tiles[10 * WIDTH + 45] = TILE.GRASS; // inside the rock band, in no zone

    const check = validateMap(plain(map));
    expect(check.ok).toBe(false);
    expect(errorsOf(check)).toContain('in no zone');
  });

  it('rejects zones closer than one view width', () => {
    const map = splitMap();
    map.tiles[24 * WIDTH + 50] = TILE.GRASS; // walkable, now inside the band
    map.zones = [
      { id: 'west', x0: 0, y0: 0, x1: 50, y1: 47 },
      { id: 'east', x0: 56, y0: 0, x1: 95, y1: 47 },
    ];

    const check = validateMap(plain(map));
    expect(check.ok).toBe(false);
    expect(errorsOf(check)).toContain('closer than');
  });

  it('a map without zones is one world named after the map', () => {
    const map = splitMap();
    delete map.zones;

    expect(zonesOf(map)).toHaveLength(1);
    expect(worldKeyAt(map, 0, 0)).toBe('split');
  });

  it('builds one world per zone', () => {
    const realm = new Realm([splitMap()]);
    expect(realm.worldKeys().sort()).toEqual(['split#east', 'split#west']);
    expect(realm.mapIds).toEqual(['split']);
  });

  it('builds only the zones a shard was given', () => {
    const realm = new Realm([splitMap()], new Set(['split#east']));
    expect(realm.worldKeys()).toEqual(['split#east']);
  });

  it('puts a player into the zone he stands in', () => {
    const realm = new Realm([splitMap()]);
    const west = realm.join({ map: 'split', accountId: 1, characterId: 1, name: 'West' });
    const east = realm.join({
      map: 'split',
      accountId: 2,
      characterId: 2,
      name: 'East',
      x: 70 * 32 + 16,
      y: 24 * 32 + 16,
    });

    expect(west).not.toBeNull();
    expect(east).not.toBeNull();
    expect(realm.worldIdOf(west!.id)).toBe('split#west');
    expect(realm.worldIdOf(east!.id)).toBe('split#east');
  });

  it('spawns only the monsters of its own zone', () => {
    const realm = new Realm([splitMap()]);
    const west = realm.world('split#west');
    const east = realm.world('split#east');

    expect(west?.snapshot().monsters).toHaveLength(1);
    expect(east?.snapshot().monsters).toHaveLength(1);
    expect(west?.snapshot().monsters[0]?.x).toBeLessThan(40 * 32);
    expect(east?.snapshot().monsters[0]?.x).toBeGreaterThan(56 * 32);
  });

  it('carries a player through the portal into the other zone', () => {
    const realm = new Realm([splitMap()]);
    const player = realm.join({
      map: 'split',
      accountId: 1,
      characterId: 1,
      name: 'Hop',
      x: 39 * 32 + 16,
      y: 24 * 32 + 16,
    });
    expect(player).not.toBeNull();
    expect(realm.worldIdOf(player!.id)).toBe('split#west');

    realm.tick();

    // Same player id, same map, only the world changed.
    expect(realm.worldIdOf(player!.id)).toBe('split#east');
    const arrived = realm.world('split#east')?.getPlayer(player!.id);
    expect(arrived).toBeDefined();
    expect(arrived?.x).toBe((56 + 0.5) * 32);
    expect(realm.world('split#east')?.map.id).toBe('split');
    expect(realm.world('split#west')?.getPlayer(player!.id)).toBeUndefined();
  });

  it('keeps the two zones out of each other\'s snapshots', () => {
    const realm = new Realm([splitMap()]);
    const west = realm.join({ map: 'split', accountId: 1, characterId: 1, name: 'West' });
    const east = realm.join({
      map: 'split',
      accountId: 2,
      characterId: 2,
      name: 'East',
      x: 70 * 32 + 16,
      y: 24 * 32 + 16,
    });

    const view = JSON.parse(
      new TextDecoder().decode(realm.snapshotBuffers().get(west!.id)),
    ) as { players: Array<{ id: number }>; monsters: Array<{ x: number }> };

    expect(view.players.map((entry) => entry.id)).toEqual([west!.id]);
    expect(view.monsters.every((entry) => entry.x < 40 * 32)).toBe(true);
    expect(east).not.toBeNull();
  });

  it('reports the zone key at a position, falling back to the spawn', () => {
    const map = splitMap();
    expect(worldKeyAt(map, 39 * 32 + 16, 24 * 32 + 16)).toBe('split#west');
    expect(worldKeyAt(map, 56 * 32 + 16, 24 * 32 + 16)).toBe('split#east');
    // A position inside the rock band falls back to the spawn's zone.
    expect(worldKeyAt(map, 47 * 32 + 16, 24 * 32 + 16)).toBe('split#west');
  });
});

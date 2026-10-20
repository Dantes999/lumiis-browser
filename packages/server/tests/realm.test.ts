import { describe, expect, it } from 'vitest';
import { TILE, type MapData } from '@lumiis/shared';
import { Realm } from '../src/game/realm.js';

const mapOf = (id: string, spawn: { x: number; y: number }): MapData => ({
  id,
  width: 8,
  height: 8,
  spawn,
  tiles: new Array(8 * 8).fill(TILE.GRASS),
  spawns: [],
  portals: [],
});

const setTile = (map: MapData, x: number, y: number, tile: number): void => {
  map.tiles[y * map.width + x] = tile;
};

const twoMaps = (): { a: MapData; b: MapData } => {
  const a = mapOf('a', { x: 1, y: 1 });
  const b = mapOf('b', { x: 6, y: 6 });

  setTile(a, 5, 1, TILE.PORTAL);
  a.portals.push({ tx: 5, ty: 1, to: 'b', spawnX: 3, spawnY: 3 });

  return { a, b };
};

describe('the realm', () => {
  it('puts a player on the map he was saved on', () => {
    const { a, b } = twoMaps();
    const realm = new Realm([a, b]);

    const player = realm.join({ map: 'b', accountId: 1, characterId: 1, name: 'Kain' });
    expect(player).not.toBeNull();
    if (player === null) return;

    expect(realm.worldIdOf(player.id)).toBe('b');
  });

  it('falls back to the first map when the saved one is gone', () => {
    const { a, b } = twoMaps();
    const realm = new Realm([a, b]);

    const player = realm.join({ map: 'deleted', accountId: 1, characterId: 1, name: 'Kain' });
    expect(realm.worldIdOf(player?.id ?? 0)).toBe('a');
  });

  it('carries a player through a portal into the other world', () => {
    const { a, b } = twoMaps();
    const realm = new Realm([a, b]);

    const player = realm.join({ map: 'a', accountId: 1, characterId: 1, name: 'Kain' });
    if (player === null) throw new Error('join failed');

    const id = player.id;
    player.hp = 77;
    player.yang = 12;

    realm.setInput(id, 1, 0);
    for (let tick = 0; tick < 60 && realm.worldIdOf(id) === 'a'; tick += 1) {
      realm.tick();
    }

    // Same player, same id, but on the other map and at its arrival tile.
    expect(realm.worldIdOf(id)).toBe('b');

    const moved = realm.worldOf(id)?.getPlayer(id);
    expect(moved?.id).toBe(id);
    expect(moved?.hp).toBe(77);
    expect(moved?.yang).toBe(12);
    expect(moved?.x).toBeCloseTo(3.5 * 32, 3);
    expect(moved?.y).toBeCloseTo(3.9 * 32, 3);
  });

  it('keeps a separate snapshot per map', () => {
    const { a, b } = twoMaps();
    const realm = new Realm([a, b]);

    const first = realm.join({ map: 'a', accountId: 1, characterId: 1, name: 'One' });
    realm.join({ map: 'b', accountId: 2, characterId: 2, name: 'Two' });

    const snapshots = realm.snapshotJson();
    expect([...snapshots.keys()].sort()).toEqual(['a', 'b']);

    const onA = JSON.parse(snapshots.get('a') ?? '{}') as { players: Array<{ name: string }> };
    const onB = JSON.parse(snapshots.get('b') ?? '{}') as { players: Array<{ name: string }> };

    expect(onA.players.map((entry) => entry.name)).toEqual(['One']);
    expect(onB.players.map((entry) => entry.name)).toEqual(['Two']);
    expect(first).not.toBeNull();
  });
});

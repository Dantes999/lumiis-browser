// The snapshot is a delta after the first one: the client keeps what it knows
// and only receives what changed. These tests pin that contract down.

import { describe, expect, it } from 'vitest';
import { TILE, type MapData } from '@lumiis/shared';
import { World, type Player } from '../src/game/world.js';

/** 60x60 tiles = 1920 px, so the map has several interest cells (one is 256 px). */
const bigMap = (): MapData => ({
  id: 'delta',
  width: 60,
  height: 60,
  spawn: { x: 20, y: 20 },
  tiles: new Array(60 * 60).fill(TILE.GRASS),
  spawns: [],
  portals: [],
});

type MoveEntry = [number, number, number, number, number, number];

type Snapshot = {
  full?: boolean;
  players: Array<{ id: number; name: string; x: number; y: number; exp: number }>;
  monsters: Array<{ id: number; key: string }>;
  ground: Array<{ id: number }>;
  move?: { players: MoveEntry[]; monsters: MoveEntry[] };
  gone?: { players: number[]; monsters: number[]; ground: number[] };
};

const decode = (bytes: Uint8Array | undefined): Snapshot => {
  if (bytes === undefined) throw new Error('no snapshot for this player');
  return JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
};

const join = (world: World, name: string, accountId: number): Player =>
  world.addPlayer({ accountId, characterId: accountId, name });

describe('snapshot deltas', () => {
  it('sends the whole view as the first snapshot', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    join(world, 'B', 2);

    const first = decode(world.snapshots().get(a.id));
    expect(first.full).toBe(true);
    expect(first.players.map((entry) => entry.name).sort()).toEqual(['A', 'B']);
  });

  it('sends only movement afterwards, no repeated full entries', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    const b = join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    b.x += 8;

    const second = decode(world.snapshots().get(a.id));
    expect(second.full).toBeUndefined();
    expect(second.players).toEqual([]);

    const moved = second.move?.players.find((entry) => entry[0] === b.id);
    expect(moved).toBeDefined();
    expect(moved?.[1]).toBe(b.x);
  });

  it('sends nothing at all while nothing changes', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    expect(world.snapshots().get(a.id)).toBeUndefined();
  });

  it('sends the own entry in full when exp changes', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    a.exp += 25;

    const second = decode(world.snapshots().get(a.id));
    const own = second.players.find((entry) => entry.id === a.id);
    expect(own?.exp).toBe(a.exp);
  });

  it('sends the own movement as a move tuple', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    a.x += 8;

    const second = decode(world.snapshots().get(a.id));
    const moved = second.move?.players.find((entry) => entry[0] === a.id);
    expect(moved?.[1]).toBe(a.x);
  });

  it('reports an entity that left the view', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    const b = join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    b.x = 5000;

    const second = decode(world.snapshots().get(a.id));
    expect(second.gone?.players).toEqual([b.id]);
    expect(second.players).toEqual([]);
  });

  it('sends an entity in full again when it enters the view once more', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    const b = join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    b.x = 5000;
    decode(world.snapshots().get(a.id));

    b.x = a.x + 20;
    const third = decode(world.snapshots().get(a.id));
    expect(third.gone).toBeUndefined();
    expect(third.players.find((entry) => entry.id === b.id)?.name).toBe('B');
  });

  it('starts over with a full snapshot after a cell change', () => {
    const world = new World(bigMap());
    const a = join(world, 'A', 1);
    join(world, 'B', 2);

    decode(world.snapshots().get(a.id));
    a.x += 256; // one cell to the right

    const second = decode(world.snapshots().get(a.id));
    expect(second.full).toBe(true);
    expect(second.players.map((entry) => entry.name).sort()).toEqual(['A', 'B']);
  });

  it('sends a monster once, then only when it changes', () => {
    const map = bigMap();
    map.spawns = [{ kind: 'mob', key: 'wolf', tx: 21, ty: 20 }];

    const world = new World(map);
    const a = join(world, 'A', 1);

    const first = decode(world.snapshots().get(a.id));
    expect(first.monsters).toHaveLength(1);
    expect(first.monsters[0]?.key).toBe('wolf');

    // Nothing stepped: the wolf stays still, so no second snapshot goes out.
    expect(world.snapshots().get(a.id)).toBeUndefined();
  });
});

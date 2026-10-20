import { describe, expect, it } from 'vitest';
import { TILE, spawnPosition, type MapData } from '@lumiis/shared';
import { World } from '../src/game/world.js';

const grassMap = (): MapData => ({
  id: 'test',
  width: 16,
  height: 16,
  spawn: { x: 8, y: 8 },
  tiles: new Array(16 * 16).fill(TILE.GRASS),
});

const spawn = spawnPosition(grassMap());

describe('world', () => {
  it('starts empty at tick zero', () => {
    const world = new World(grassMap());
    expect(world.tick).toBe(0);
    expect(world.playerCount).toBe(0);
    expect(world.snapshot()).toEqual([]);
  });

  it('spawns every player on the spawn tile of the map', () => {
    const world = new World(grassMap());
    const player = world.addPlayer('Kain');
    expect(player.x).toBe(spawn.x);
    expect(player.y).toBe(spawn.y);
  });

  it('gives every player a unique id', () => {
    const world = new World(grassMap());
    const first = world.addPlayer('Kain');
    const second = world.addPlayer('Lyra');
    expect(first.id).not.toBe(second.id);
    expect(world.playerCount).toBe(2);
  });

  it('removes players and forgets them in the snapshot', () => {
    const world = new World(grassMap());
    const player = world.addPlayer('Kain');
    expect(world.removePlayer(player.id)).toBe(true);
    expect(world.removePlayer(player.id)).toBe(false);
    expect(world.snapshot()).toEqual([]);
  });

  it('advances one tick per step', () => {
    const world = new World(grassMap());
    world.step();
    world.step();
    expect(world.tick).toBe(2);
  });

  it('moves a player in the pressed direction', () => {
    const world = new World(grassMap());
    const player = world.addPlayer('Kain');
    world.setInput(player.id, 1, 0);
    world.step();

    expect(player.x).toBeGreaterThan(spawn.x);
    expect(player.y).toBe(spawn.y);
    expect(player.moving).toBe(true);
  });

  it('stops a player when the input is zero', () => {
    const world = new World(grassMap());
    const player = world.addPlayer('Kain');
    world.setInput(player.id, 1, 0);
    world.step();
    const afterWalk = player.x;

    world.setInput(player.id, 0, 0);
    world.step();

    expect(player.x).toBe(afterWalk);
    expect(player.moving).toBe(false);
  });

  it('does not walk into water', () => {
    const map = grassMap();
    // A water tile directly east of the spawn tile.
    map.tiles[8 * 16 + 9] = TILE.WATER;

    const world = new World(map);
    const player = world.addPlayer('Kain');
    world.setInput(player.id, 1, 0);

    for (let step = 0; step < 40; step += 1) world.step();

    expect(world.map.tiles[8 * 16 + 9]).toBe(TILE.WATER);
    expect(player.x + 7).toBeLessThanOrEqual(9 * 32);
  });

  it('ignores input for players that do not exist', () => {
    const world = new World(grassMap());
    expect(() => world.setInput(999, 1, 0)).not.toThrow();
    expect(world.playerCount).toBe(0);
  });

  it('snapshots only the values a client needs', () => {
    const world = new World(grassMap());
    world.addPlayer('Kain');
    expect(world.snapshot()).toEqual([
      { id: 1, name: 'Kain', x: spawn.x, y: Math.round(spawn.y * 10) / 10, dir: 0, moving: false },
    ]);
  });
});

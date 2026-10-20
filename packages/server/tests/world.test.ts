import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world.js';

describe('world', () => {
  it('starts empty at tick zero', () => {
    const world = new World();
    expect(world.tick).toBe(0);
    expect(world.playerCount).toBe(0);
    expect(world.snapshot()).toEqual([]);
  });

  it('gives every player a unique id', () => {
    const world = new World();
    const first = world.addPlayer('Kain');
    const second = world.addPlayer('Lyra');
    expect(first.id).not.toBe(second.id);
    expect(world.playerCount).toBe(2);
  });

  it('removes players and forgets them in the snapshot', () => {
    const world = new World();
    const player = world.addPlayer('Kain');
    expect(world.removePlayer(player.id)).toBe(true);
    expect(world.removePlayer(player.id)).toBe(false);
    expect(world.snapshot()).toEqual([]);
  });

  it('advances one tick per step', () => {
    const world = new World();
    world.step();
    world.step();
    expect(world.tick).toBe(2);
  });

  it('snapshots only the values a client needs', () => {
    const world = new World();
    world.addPlayer('Kain', 3, 4);
    expect(world.snapshot()).toEqual([{ id: 1, name: 'Kain', x: 3, y: 4 }]);
  });
});

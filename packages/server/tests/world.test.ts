import { describe, expect, it } from 'vitest';
import { WORLD_PIXELS } from '@lumiis/shared';
import { World } from '../src/game/world.js';

const spawn = WORLD_PIXELS / 2;

describe('world', () => {
  it('starts empty at tick zero', () => {
    const world = new World();
    expect(world.tick).toBe(0);
    expect(world.playerCount).toBe(0);
    expect(world.snapshot()).toEqual([]);
  });

  it('spawns every player in the middle of the world', () => {
    const world = new World();
    const player = world.addPlayer('Kain');
    expect(player.x).toBe(spawn);
    expect(player.y).toBe(spawn);
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

  it('moves a player in the pressed direction', () => {
    const world = new World();
    const player = world.addPlayer('Kain');
    world.setInput(player.id, 1, 0);
    world.step();

    expect(player.x).toBeGreaterThan(spawn);
    expect(player.y).toBe(spawn);
    expect(player.moving).toBe(true);
  });

  it('stops a player when the input is zero', () => {
    const world = new World();
    const player = world.addPlayer('Kain');
    world.setInput(player.id, 1, 0);
    world.step();
    const afterWalk = player.x;

    world.setInput(player.id, 0, 0);
    world.step();

    expect(player.x).toBe(afterWalk);
    expect(player.moving).toBe(false);
  });

  it('ignores input for players that do not exist', () => {
    const world = new World();
    expect(() => world.setInput(999, 1, 0)).not.toThrow();
    expect(world.playerCount).toBe(0);
  });

  it('snapshots only the values a client needs', () => {
    const world = new World();
    world.addPlayer('Kain');
    expect(world.snapshot()).toEqual([
      { id: 1, name: 'Kain', x: spawn, y: spawn, dir: 0, moving: false },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ATTACK_COOLDOWN_TICKS,
  MONSTER_RESPAWN_TICKS,
  MONSTER_TYPES,
  PLAYER_DAMAGE,
  TILE,
  spawnPosition,
  type MapData,
} from '@lumiis/shared';
import { World } from '../src/game/world.js';

const grassMap = (): MapData => ({
  id: 'test',
  width: 16,
  height: 16,
  spawn: { x: 8, y: 8 },
  tiles: new Array(16 * 16).fill(TILE.GRASS),
  spawns: [],
});

const spawn = spawnPosition(grassMap());

describe('world', () => {
  it('starts empty at tick zero', () => {
    const world = new World(grassMap());
    expect(world.tick).toBe(0);
    expect(world.playerCount).toBe(0);
    expect(world.snapshot()).toEqual({ players: [], monsters: [] });
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
    expect(world.snapshot().players).toEqual([]);
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
    expect(world.snapshot().players).toEqual([
      { id: 1, name: 'Kain', x: spawn.x, y: Math.round(spawn.y * 10) / 10, dir: 0, moving: false },
    ]);
  });
});

describe('monsters', () => {
  const withWolf = (tx = 9, ty = 8): MapData => {
    const map = grassMap();
    map.spawns = [{ kind: 'mob', key: 'wolf', tx, ty }];
    return map;
  };

  /**
   * A wolf in a one-tile pocket with the player right below it. The pocket is
   * closed on all eight sides, so the rules can be tested without wandering
   * moving the target out of reach.
   */
  const boxedWolf = (): MapData => {
    const map = grassMap();
    map.spawn = { x: 9, y: 9 };
    for (const [x, y] of [
      [8, 7],
      [9, 7],
      [10, 7],
      [8, 8],
      [10, 8],
      [8, 9],
      [10, 9],
      [9, 10],
    ]) {
      map.tiles[(y as number) * 16 + (x as number)] = TILE.WALL;
    }
    map.spawns = [{ kind: 'mob', key: 'wolf', tx: 9, ty: 8 }];
    return map;
  };

  it('spawns the monsters the map asks for', () => {
    const world = new World(withWolf());
    expect(world.monsterCount).toBe(1);

    const monsters = world.snapshot().monsters;
    expect(monsters).toHaveLength(1);
    expect(monsters[0]?.key).toBe('wolf');
    expect(monsters[0]?.maxHp).toBe(MONSTER_TYPES.wolf.maxHp);
  });

  it('damages a monster in reach', () => {
    const world = new World(withWolf());
    const player = world.addPlayer('Kain');

    expect(world.attack(player.id, 1)).toEqual({
      ok: true,
      damage: PLAYER_DAMAGE,
      killed: false,
    });
    expect(world.getMonster(1)?.hp).toBe(MONSTER_TYPES.wolf.maxHp - PLAYER_DAMAGE);
  });

  it('refuses a second hit before the cooldown is over', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer('Kain');

    expect(world.attack(player.id, 1).ok).toBe(true);
    expect(world.attack(player.id, 1).ok).toBe(false);

    for (let tick = 0; tick < ATTACK_COOLDOWN_TICKS; tick += 1) world.step();
    expect(world.attack(player.id, 1).ok).toBe(true);
  });

  it('refuses a hit on a monster that is far away', () => {
    const world = new World(withWolf(13, 13));
    const player = world.addPlayer('Kain');

    expect(world.attack(player.id, 1).ok).toBe(false);
  });

  it('refuses a hit on a monster that does not exist', () => {
    const world = new World(withWolf());
    const player = world.addPlayer('Kain');

    expect(world.attack(player.id, 999).ok).toBe(false);
  });

  it('kills a monster and brings it back with full health', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer('Kain');

    const hits = Math.ceil(MONSTER_TYPES.wolf.maxHp / PLAYER_DAMAGE);
    let killed = false;

    for (let hit = 0; hit < hits; hit += 1) {
      const result = world.attack(player.id, 1);
      expect(result.ok).toBe(true);
      if (result.ok && result.killed) killed = true;
      for (let tick = 0; tick < ATTACK_COOLDOWN_TICKS; tick += 1) world.step();
    }

    expect(killed).toBe(true);
    expect(world.snapshot().monsters).toHaveLength(0);

    for (let tick = 0; tick < MONSTER_RESPAWN_TICKS; tick += 1) world.step();
    const back = world.snapshot().monsters;
    expect(back).toHaveLength(1);
    expect(back[0]?.hp).toBe(MONSTER_TYPES.wolf.maxHp);
  });

  it('keeps wandering monsters near their spawn', () => {
    const world = new World(withWolf(4, 4));
    const home = { x: 4.5 * 32, y: 4.9 * 32 };

    let furthest = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      world.step();
      const monster = world.getMonster(1);
      if (monster === undefined) continue;
      furthest = Math.max(furthest, Math.hypot(monster.x - home.x, monster.y - home.y));
    }

    // One step beyond the leash is allowed: the turn happens after the step.
    expect(furthest).toBeGreaterThan(0);
    expect(furthest).toBeLessThanOrEqual(MONSTER_TYPES.wolf.leash + 8);
  });
});

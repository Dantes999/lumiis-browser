import { describe, expect, it } from 'vitest';
import {
  swingFor,
  DROP_PROTECT_TICKS,
  MAX_LEVEL,
  MONSTER_RESPAWN_TICKS,
  MONSTER_TYPES,
  PLAYER_DAMAGE,
  PLAYER_MAX_HP,
  PLAYER_RESPAWN_HP_SHARE,
  PLAYER_RESPAWN_TICKS,
  INVENTORY_SLOTS,
  TILE,
  expForNextLevel,
  spawnPosition,
  type InventorySlot,
  type ItemKey,
  type MapData,
} from '@lumiis/shared';
import { World, type Player } from '../src/game/world.js';

const grassMap = (): MapData => ({
  id: 'test',
  width: 16,
  height: 16,
  spawn: { x: 8, y: 8 },
  tiles: new Array(16 * 16).fill(TILE.GRASS),
  spawns: [],
  portals: [],
});

const spawn = spawnPosition(grassMap());

/** Health of a monster as the client sees it; null while it is down. */
const monsterHp = (world: World, id = 1): number | null =>
  world.snapshot().monsters.find((monster) => monster.id === id)?.hp ?? null;

/** Long enough for the slowest swing to land and end. */
const SWING_TICKS = 20;

/** Starts a swing and lets it run through; true when the monster died. */
const strike = (world: World, playerId: number, targetId = 1): boolean => {
  if (!world.attack(playerId, targetId).ok) return false;
  for (let tick = 0; tick < SWING_TICKS; tick += 1) world.step();
  return monsterHp(world, targetId) === null;
};

/** Swings until the player reaches the next level, waiting out respawns. */
const levelUp = (world: World, playerId: number, player: Player): boolean => {
  const target = player.level + 1;
  for (let tick = 0; tick < 8000; tick += 1) {
    if (player.level >= target) return true;
    if (!strike(world, playerId)) world.step();
  }
  return player.level >= target;
};

/** Swings whenever possible, walks the world otherwise, until a kill lands. */
const killOne = (world: World, playerId: number): boolean => {
  for (let tick = 0; tick < 800; tick += 1) {
    if (monsterHp(world) === null) return true;
    if (!strike(world, playerId)) world.step();
  }
  return false;
};

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

describe('world', () => {
  it('starts empty at tick zero', () => {
    const world = new World(grassMap());
    expect(world.tick).toBe(0);
    expect(world.playerCount).toBe(0);
    expect(world.snapshot()).toEqual({ players: [], monsters: [], ground: [] });
  });

  it('spawns every player on the spawn tile of the map', () => {
    const world = new World(grassMap());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    expect(player.x).toBe(spawn.x);
    expect(player.y).toBe(spawn.y);
  });

  it('gives every player a unique id', () => {
    const world = new World(grassMap());
    const first = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    const second = world.addPlayer({ accountId: 0, characterId: 0, name: 'Lyra' });
    expect(first.id).not.toBe(second.id);
    expect(world.playerCount).toBe(2);
  });

  it('removes players and forgets them in the snapshot', () => {
    const world = new World(grassMap());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
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
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    world.setInput(player.id, 1, 0);
    world.step();

    expect(player.x).toBeGreaterThan(spawn.x);
    expect(player.y).toBe(spawn.y);
    expect(player.moving).toBe(true);
  });

  it('stops a player when the input is zero', () => {
    const world = new World(grassMap());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
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
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
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
    world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    expect(world.snapshot().players).toEqual([
      {
        id: 1,
        name: 'Kain',
        x: spawn.x,
        y: Math.round(spawn.y * 10) / 10,
        dir: 0,
        moving: false,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        level: 1,
        exp: 0,
        yang: 0,
        weapon: null,
        armor: null,
      },
    ]);
  });
});

describe('monsters', () => {
  it('spawns the monsters the map asks for', () => {
    const world = new World(withWolf());
    expect(world.monsterCount).toBe(1);

    const monsters = world.snapshot().monsters;
    expect(monsters).toHaveLength(1);
    expect(monsters[0]?.key).toBe('wolf');
    expect(monsters[0]?.maxHp).toBe(MONSTER_TYPES.wolf.maxHp);
  });

  it('starts a swing without damage and lands it half way', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    const profile = swingFor(null);

    expect(world.attack(player.id, 1)).toEqual({ ok: true, started: true });
    expect(world.getMonster(1)?.hp).toBe(MONSTER_TYPES.wolf.maxHp);

    // Until the arm is through, nothing has happened yet.
    for (let tick = 0; tick < profile.hitAt - 1; tick += 1) world.step();
    expect(world.getMonster(1)?.hp).toBe(MONSTER_TYPES.wolf.maxHp);

    world.step();
    expect(world.getMonster(1)?.hp).toBe(MONSTER_TYPES.wolf.maxHp - PLAYER_DAMAGE);
  });

  it('refuses a second hit while the swing is still running', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    const profile = swingFor(null);

    expect(world.attack(player.id, 1).ok).toBe(true);
    expect(world.attack(player.id, 1).ok).toBe(false);

    for (let tick = 0; tick < profile.ticks; tick += 1) world.step();
    expect(world.attack(player.id, 1).ok).toBe(true);
  });

  it('refuses a hit on a monster that is far away', () => {
    const world = new World(withWolf(13, 13));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    expect(world.attack(player.id, 1).ok).toBe(false);
  });

  it('refuses a hit on a monster that does not exist', () => {
    const world = new World(withWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    expect(world.attack(player.id, 999).ok).toBe(false);
  });

  it('kills a monster and brings it back with full health', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    const hits = Math.ceil(MONSTER_TYPES.wolf.maxHp / PLAYER_DAMAGE);

    for (let hit = 0; hit < hits; hit += 1) strike(world, player.id);

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

describe('monsters fighting back', () => {
  const withWolfAt = withWolf;

  const distanceTo = (world: World, playerId: number, monsterId: number): number => {
    const player = world.getPlayer(playerId);
    const monster = world.getMonster(monsterId);
    if (player === undefined || monster === undefined) return Number.POSITIVE_INFINITY;
    return Math.hypot(player.x - monster.x, player.y - monster.y);
  };

  it('notices a player nearby and closes in', () => {
    const world = new World(withWolfAt(12, 8));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    const before = distanceTo(world, player.id, 1);
    for (let tick = 0; tick < 10; tick += 1) world.step();

    expect(world.getMonster(1)?.targetId).toBe(player.id);
    expect(distanceTo(world, player.id, 1)).toBeLessThan(before);
  });

  it('ignores a player that is out of sight', () => {
    const world = new World(withWolfAt(15, 15));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    for (let tick = 0; tick < 10; tick += 1) world.step();
    expect(world.getMonster(1)?.targetId).toBeNull();
    expect(player.hp).toBe(PLAYER_MAX_HP);
  });

  it('bites a player that stands next to it', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    world.step(); // notice the player
    world.step(); // bite

    expect(player.hp).toBe(PLAYER_MAX_HP - MONSTER_TYPES.wolf.damage);
  });

  it('does not bite more often than its cooldown allows', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    world.step();
    world.step();
    const afterFirstBite = player.hp;

    for (let tick = 0; tick < 10; tick += 1) world.step();
    expect(player.hp).toBe(afterFirstBite);
  });

  it('kills a player who just stands there, then revives him at the spawn', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    const spawn = spawnPosition(world.map);

    let ticks = 0;
    while (player.hp > 0 && ticks < 2000) {
      world.step();
      ticks += 1;
    }

    expect(player.hp).toBe(0);
    expect(player.deadUntil).toBeGreaterThan(0);

    // The dead cannot act.
    world.setInput(player.id, 1, 0);
    world.step();
    expect(player.moving).toBe(false);
    expect(world.attack(player.id, 1).ok).toBe(false);

    // And they come back at the spawn with reduced health.
    for (let tick = 0; tick < PLAYER_RESPAWN_TICKS + 1; tick += 1) world.step();
    expect(player.deadUntil).toBe(0);
    expect(player.x).toBe(spawn.x);
    expect(player.y).toBe(spawn.y);
    expect(player.hp).toBeGreaterThan(0);
    expect(player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP * PLAYER_RESPAWN_HP_SHARE);
  });
});

describe('experience and yang', () => {
  it('gives experience and yang for a kill', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    expect(killOne(world, player.id)).toBe(true);

    expect(player.exp).toBe(MONSTER_TYPES.wolf.exp);
    expect(player.yang).toBeGreaterThanOrEqual(MONSTER_TYPES.wolf.yangMin);
    expect(player.yang).toBeLessThanOrEqual(MONSTER_TYPES.wolf.yangMax);
  });

  it('gives nothing for a hit that does not kill', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    expect(strike(world, player.id)).toBe(false);
    expect(player.exp).toBe(0);
    expect(player.yang).toBe(0);
  });

  it('levels up when the experience is enough and heals on the way', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    // The wolf must not bite in between, or the healed health is gone again.
    const wolf = MONSTER_TYPES.wolf as { damage: number };
    const bite = wolf.damage;
    wolf.damage = 0;
    player.hp = 40;

    try {
      expect(levelUp(world, player.id, player)).toBe(true);
    } finally {
      wolf.damage = bite;
    }

    expect(player.level).toBe(2);
    expect(player.hp).toBe(player.maxHp);
    expect(player.exp).toBeLessThan(expForNextLevel(1));
  });

  it('never goes past the maximum level', () => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    player.level = MAX_LEVEL;
    player.exp = expForNextLevel(MAX_LEVEL - 1);

    killOne(world, player.id);
    expect(player.level).toBe(MAX_LEVEL);
  });

  it('splits the reward by damage instead of giving it to the last hit', () => {
    const world = new World(boxedWolf());
    const first = world.addPlayer({ accountId: 0, characterId: 0, name: 'First' });
    const second = world.addPlayer({ accountId: 0, characterId: 0, name: 'Second' });

    let killed = false;
    for (let tick = 0; tick < 400 && !killed; tick += 1) {
      const attacker = tick % 2 === 0 ? first : second;
      world.attack(attacker.id, 1);
      world.step();
      killed = monsterHp(world) === null;
    }

    expect(killed).toBe(true);
    // Two hits each: the experience is shared, not stolen by the final blow.
    expect(first.exp + second.exp).toBe(MONSTER_TYPES.wolf.exp);
    expect(Math.abs(first.exp - second.exp)).toBeLessThanOrEqual(1);
    expect(first.yang + second.yang).toBeGreaterThanOrEqual(MONSTER_TYPES.wolf.yangMin);
  });

  it('gives the whole reward to whoever is left when a contributor logs out', () => {
    const world = new World(boxedWolf());
    const stay = world.addPlayer({ accountId: 0, characterId: 0, name: 'Stay' });
    const leave = world.addPlayer({ accountId: 0, characterId: 0, name: 'Leave' });

    strike(world, stay.id);
    world.attack(leave.id, 1);
    world.step();
    world.removePlayer(leave.id);

    for (let tick = 0; tick < 400 && monsterHp(world) !== null; tick += 1) {
      world.attack(stay.id, 1);
      world.step();
    }

    expect(stay.exp).toBe(MONSTER_TYPES.wolf.exp);
  });

  it('starts the split from scratch when a monster comes back', () => {
    const world = new World(boxedWolf());
    const first = world.addPlayer({ accountId: 0, characterId: 0, name: 'First' });
    const second = world.addPlayer({ accountId: 0, characterId: 0, name: 'Second' });

    // Together: second only gets part of the experience.
    strike(world, first.id);
    for (let tick = 0; tick < 400 && monsterHp(world) !== null; tick += 1) {
      world.attack(second.id, 1);
      world.step();
    }
    const sharedExp = second.exp;
    expect(sharedExp).toBeLessThan(MONSTER_TYPES.wolf.exp);

    for (let tick = 0; tick < MONSTER_RESPAWN_TICKS + 5; tick += 1) world.step();
    expect(killOne(world, second.id)).toBe(true);

    // Alone this time, so the full amount — the old damage is forgotten.
    expect(second.exp - sharedExp).toBe(MONSTER_TYPES.wolf.exp);
  });
});

describe('loot', () => {
  /** Walks a player towards a point, one tick at a time. */
  const walkTo = (world: World, player: Player, x: number, y: number, maxTicks = 300): void => {
    for (let tick = 0; tick < maxTicks; tick += 1) {
      if (Math.hypot(x - player.x, y - player.y) <= 6) break;
      const dx = Math.sign(Math.round(x - player.x));
      const dy = Math.sign(Math.round(y - player.y));
      world.setInput(player.id, dx, dy);
      world.step();
    }
    world.setInput(player.id, 0, 0);
  };

  /** Kills until a drop appears; returns it while it still lies on the ground. */
  const killForDrop = (world: World, playerId: number) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      killOne(world, playerId);
      const item = world.snapshot().ground[0];
      if (item !== undefined) return item;
      for (let tick = 0; tick < MONSTER_RESPAWN_TICKS + 20; tick += 1) world.step();
    }
    return undefined;
  };

  it('leaves drops where they fall until the player asks for them', () => {
    const world = new World(withWolf(9, 8));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    const item = killForDrop(world, player.id);
    expect(item).toBeDefined();
    if (item === undefined) return;

    walkTo(world, player, item.x, item.y);
    for (let tick = 0; tick < 10; tick += 1) world.step();

    // Auto pickup is off by default: standing on it changes nothing.
    expect(world.snapshot().ground.some((entry) => entry.id === item.id)).toBe(true);
    expect(player.inventory.every((slot) => slot === null)).toBe(true);

    // The explicit order takes it.
    expect(world.pickup(player.id, item.id).ok).toBe(true);
    expect(world.snapshot().ground.some((entry) => entry.id === item.id)).toBe(false);
    expect(player.inventory.filter((slot) => slot !== null)).toHaveLength(1);
  });

  it('refuses an item that is out of reach or still reserved', () => {
    const world = new World(withWolf(9, 8));
    const killer = world.addPlayer({ accountId: 0, characterId: 0, name: 'Killer' });
    const stranger = world.addPlayer({ accountId: 0, characterId: 0, name: 'Stranger' });

    const item = killForDrop(world, killer.id);
    expect(item).toBeDefined();
    if (item === undefined) return;

    // The stranger is at the spawn, not next to the drop.
    expect(world.pickup(stranger.id, item.id).ok).toBe(false);

    world.removePlayer(killer.id);
    walkTo(world, stranger, item.x, item.y);

    // In reach now, but the killer's five seconds are still running.
    expect(world.pickup(stranger.id, item.id).ok).toBe(false);

    for (let tick = 0; tick < DROP_PROTECT_TICKS + 5; tick += 1) world.step();
    expect(world.pickup(stranger.id, item.id).ok).toBe(true);
  });

  it('auto pickup only takes the types that were chosen', () => {
    const world = new World(withWolf(9, 8));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    world.setPickupSettings(player.id, true, ['boar_tusk']);

    const item = killForDrop(world, player.id);
    expect(item?.key).toBe('wolf_fur');
    if (item === undefined) return;

    walkTo(world, player, item.x, item.y);
    for (let tick = 0; tick < 10; tick += 1) world.step();
    expect(world.snapshot().ground.some((entry) => entry.id === item.id)).toBe(true);

    // Allow pelts and stand on it again.
    world.setPickupSettings(player.id, true, ['wolf_fur']);
    for (let tick = 0; tick < 5; tick += 1) world.step();
    expect(world.snapshot().ground.some((entry) => entry.id === item.id)).toBe(false);
    expect(player.inventory.some((slot) => slot !== null)).toBe(true);
  });

  it('stacks the same item into one slot', () => {
    const world = new World(withWolf(9, 8));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    let collected = 0;
    for (let attempt = 0; attempt < 40 && collected < 3; attempt += 1) {
      const item = killForDrop(world, player.id);
      if (item === undefined) continue;
      walkTo(world, player, item.x, item.y);
      if (world.pickup(player.id, item.id).ok) collected += 1;
    }

    expect(collected).toBeGreaterThanOrEqual(3);
    const used = player.inventory.filter((slot) => slot !== null);
    expect(used).toHaveLength(1);
    expect(used[0]?.key).toBe('wolf_fur');
    expect(used[0]?.count).toBeGreaterThanOrEqual(3);
  });
});

describe('equipment', () => {
  const inventoryWith = (...entries: Array<[number, ItemKey]>): InventorySlot[] => {
    const inventory = new Array<InventorySlot>(INVENTORY_SLOTS).fill(null);
    for (const [slot, key] of entries) inventory[slot] = { key, count: 1 };
    return inventory;
  };

  const hero = (inventory: InventorySlot[]) => {
    const world = new World(boxedWolf());
    const player = world.addPlayer({
      accountId: 0,
      characterId: 0,
      name: 'Kain',
      inventory,
    });
    return { world, player };
  };

  it('wears a weapon from the bag and hits harder', () => {
    const { world, player } = hero(inventoryWith([0, 'wooden_sword']));

    expect(world.equip(player.id, 0).ok).toBe(true);
    expect(player.equipment.weapon).toBe('wooden_sword');
    expect(player.inventory[0]).toBeNull();

    const monster = world.getMonster(1);
    if (monster === undefined) throw new Error('no monster');
    const before = monster.hp;

    expect(world.attack(player.id, 1).ok).toBe(true);
    for (let tick = 0; tick < SWING_TICKS; tick += 1) world.step();
    expect(monster.hp).toBe(before - (PLAYER_DAMAGE + 4));
  });

  it('raises health with armour and softens bites', () => {
    const { world, player } = hero(inventoryWith([0, 'padded_armor']));

    expect(world.equip(player.id, 0).ok).toBe(true);
    expect(player.maxHp).toBe(PLAYER_MAX_HP + 10);

    world.step(); // the wolf notices
    world.step(); // and bites

    // 8 damage minus 3 defence. Armour raises the ceiling, it does not heal.
    expect(player.hp).toBe(PLAYER_MAX_HP - 5);
  });

  it('puts the worn piece back into the bag when swapping', () => {
    const { world, player } = hero(inventoryWith([0, 'wooden_sword'], [1, 'iron_sword']));

    world.equip(player.id, 0);
    expect(world.equip(player.id, 1).ok).toBe(true);

    expect(player.equipment.weapon).toBe('iron_sword');
    expect(player.inventory[1]).toBeNull();
    expect(player.inventory.find((slot) => slot?.key === 'wooden_sword')).toBeDefined();
  });

  it('takes a piece off again', () => {
    const { world, player } = hero(inventoryWith([0, 'wooden_sword']));
    world.equip(player.id, 0);

    expect(world.unequip(player.id, 'weapon').ok).toBe(true);
    expect(player.equipment.weapon).toBeNull();
    expect(player.inventory.some((slot) => slot?.key === 'wooden_sword')).toBe(true);
  });

  it('refuses to wear things that are not equipment', () => {
    const { world, player } = hero(inventoryWith([0, 'wolf_fur']));
    expect(world.equip(player.id, 0).ok).toBe(false);
  });

  it('refuses to take off what is not worn', () => {
    const { world, player } = hero(inventoryWith());
    expect(world.unequip(player.id, 'weapon').ok).toBe(false);
  });
});

describe('chasing around walls', () => {
  /** A wall between player and wolf, with a gap low on the map. */
  const walledMap = (gap: boolean): MapData => {
    const map = grassMap();
    map.spawn = { x: 6, y: 8 };
    for (let y = 0; y <= 12; y += 1) map.tiles[y * 16 + 8] = TILE.WALL;
    if (gap) {
      for (let y = 13; y <= 15; y += 1) map.tiles[y * 16 + 8] = TILE.GRASS;
    } else {
      for (let y = 13; y <= 15; y += 1) map.tiles[y * 16 + 8] = TILE.WALL;
    }
    map.spawns = [{ kind: 'mob', key: 'wolf', tx: 10, ty: 8 }];
    return map;
  };

  it('walks around a wall to reach the player', () => {
    const world = new World(walledMap(true));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    for (let tick = 0; tick < 900; tick += 1) {
      world.step();
      if (player.hp < PLAYER_MAX_HP) break;
    }

    expect(player.hp).toBeLessThan(PLAYER_MAX_HP);
  });

  it('does not reach a player behind a closed wall', () => {
    const world = new World(walledMap(false));
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    for (let tick = 0; tick < 900; tick += 1) world.step();

    expect(player.hp).toBe(PLAYER_MAX_HP);
  });
});

describe('swings', () => {
  /** Player on the middle tile, wolves around him as listed. */
  const arena = (spawns: Array<[number, number]>, weapon: ItemKey | null) => {
    const map = grassMap();
    map.spawns = spawns.map(([tx, ty]) => ({ kind: 'mob', key: 'wolf', tx, ty }));
    const world = new World(map);
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });
    if (weapon !== null) player.equipment.weapon = weapon;
    return { world, player };
  };

  /** Runs the swing just past the moment the blow lands. */
  const land = (world: World, playerId: number, targetId: number): void => {
    expect(world.attack(playerId, targetId).ok).toBe(true);
    const profile = swingFor(world.getPlayer(playerId)?.equipment.weapon ?? null);
    for (let tick = 0; tick < profile.hitAt; tick += 1) world.step();
  };

  it('a one-handed sword only hits the closest of three', () => {
    const { world, player } = arena(
      [
        [9, 8],
        [9, 7],
        [9, 9],
      ],
      'wooden_sword',
    );

    land(world, player.id, 1);

    const hurt = world
      .snapshot()
      .monsters.filter((monster) => monster.hp < monster.maxHp)
      .map((monster) => monster.id);
    expect(hurt).toHaveLength(1);
  });

  it('a two-handed sword sweeps up to three monsters at once', () => {
    const { world, player } = arena(
      [
        [9, 8],
        [9, 7],
        [9, 9],
      ],
      'great_sword',
    );

    land(world, player.id, 1);

    const hurt = world.snapshot().monsters.filter((monster) => monster.hp < monster.maxHp);
    expect(hurt).toHaveLength(3);
  });

  it('a two-handed sword reaches further than a one-handed one', () => {
    // Diagonal neighbours are about 45 pixels apart: out of a sword's reach,
    // inside a great sword's.
    const sword = arena([[9, 9]], 'wooden_sword');
    expect(sword.world.attack(sword.player.id, 1).ok).toBe(false);

    const great = arena([[9, 9]], 'great_sword');
    expect(great.world.attack(great.player.id, 1).ok).toBe(true);
  });

  it('turns the body towards the target', () => {
    const { world, player } = arena([[9, 8]], null);
    player.dir = 4;

    expect(world.attack(player.id, 1).ok).toBe(true);
    expect(player.dir).toBe(6);
  });

  it('misses a monster that walked out of the swing before the blow lands', () => {
    const map = grassMap();
    map.spawns = [{ kind: 'mob', key: 'wolf', tx: 9, ty: 8 }];
    const world = new World(map);
    const player = world.addPlayer({ accountId: 0, characterId: 0, name: 'Kain' });

    expect(world.attack(player.id, 1).ok).toBe(true);

    // The monster is gone (killed elsewhere, or it fled) before the arm is through.
    const monster = world.getMonster(1);
    if (monster === undefined) throw new Error('no monster');
    monster.respawnAt = world.tick + 1;

    for (let tick = 0; tick < 20; tick += 1) world.step();
    expect(player.exp).toBe(0);
  });
});

// Generates packages/shared/maps/greenfield.json — the first real world: a
// village in the south-west, a pond with a bridge in the north-west, forest
// round the edges, and an open field with wolves and boars in the east.
//
// Deterministic: the same seed always gives the same map, and the json is
// committed, so nobody has to run this to play. Rerun after changing the
// layout:   node tools/make-world.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 80;
const HEIGHT = 80;
const SEED = 20261021;

const T = {
  GRASS: 0,
  FLOWERS: 1,
  PATH: 2,
  WATER: 3,
  SAND: 4,
  TREE: 5,
  ROCK: 6,
  STONE: 7,
  WALL: 8,
  BRIDGE: 9,
  PORTAL: 10,
  CACTUS: 11,
  GATE: 12,
  GATE_OPEN: 13,
};

const random = (() => {
  let state = SEED >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
})();

const tiles = new Array(WIDTH * HEIGHT).fill(T.GRASS);

const inside = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const set = (x, y, tile) => {
  if (inside(x, y)) tiles[y * WIDTH + x] = tile;
};
const get = (x, y) => (inside(x, y) ? tiles[y * WIDTH + x] : T.WALL);

/** A filled rectangle, used for floors and buildings. */
const rect = (x0, y0, x1, y1, tile) => {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) set(x, y, tile);
  }
};

/** A house: stone floor inside, wall around, one gap facing the plaza. */
const house = (x0, y0, x1, y1, door) => {
  rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, T.STONE);
  for (let x = x0; x <= x1; x += 1) {
    set(x, y0, T.WALL);
    set(x, y1, T.WALL);
  }
  for (let y = y0; y <= y1; y += 1) {
    set(x0, y, T.WALL);
    set(x1, y, T.WALL);
  }

  // door: 'n' | 's' | 'w' | 'e', two tiles wide
  if (door === 'n') {
    set(x0 + 2, y0, T.PATH);
    set(x0 + 3, y0, T.PATH);
  } else if (door === 's') {
    set(x0 + 2, y1, T.PATH);
    set(x0 + 3, y1, T.PATH);
  } else if (door === 'w') {
    set(x0, y0 + 2, T.PATH);
    set(x0, y0 + 3, T.PATH);
  } else {
    set(x1, y0 + 2, T.PATH);
    set(x1, y0 + 3, T.PATH);
  }
};

// 1. Meadow: grass with patches of flowers.
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (random() < 0.05) set(x, y, T.FLOWERS);
  }
}

// 2. Village square: paved plaza with a ring road around it.
const SPAWN = { x: 20, y: 58 };
for (let y = SPAWN.y - 12; y <= SPAWN.y + 12; y += 1) {
  for (let x = SPAWN.x - 12; x <= SPAWN.x + 12; x += 1) {
    const distance = Math.hypot(x - SPAWN.x, y - SPAWN.y);
    if (distance <= 5.5) set(x, y, T.STONE);
    else if (distance <= 7.5) set(x, y, T.PATH);
  }
}

// 3. Village houses, doors towards the square.
house(9, 48, 15, 53, 'e');
house(27, 48, 33, 53, 'w');
house(9, 63, 15, 68, 'e');
house(27, 63, 33, 68, 'w');
house(24, 36, 30, 41, 's');

// 4. Roads: east to the field, north to the pond, and a lane to the gate.
rect(28, 57, WIDTH - 6, 59, T.PATH); // east road (3 tiles wide)
rect(19, 22, 21, 52, T.PATH); // north road

// 5. Pond in the north-west, with a sandy shore and a wooden bridge.
const POND = { x: 20, y: 14 };
for (let y = POND.y - 10; y <= POND.y + 10; y += 1) {
  for (let x = POND.x - 10; x <= POND.x + 10; x += 1) {
    const distance = Math.hypot(x - POND.x, y - POND.y);
    if (distance <= 6.5) set(x, y, T.WATER);
    else if (distance <= 8) set(x, y, T.SAND);
  }
}
// The north road crosses the pond on a bridge.
rect(19, 7, 21, 21, T.BRIDGE);

// 6. Forest round the edges; the middle stays open for fighting.
const reserved = new Set([T.PATH, T.WATER, T.SAND, T.STONE, T.WALL, T.BRIDGE, T.PORTAL]);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (reserved.has(get(x, y))) continue;

    const edge = Math.min(x, y, WIDTH - 1 - x, HEIGHT - 1 - y);
    const density = edge < 5 ? 0.5 : edge < 11 ? 0.18 : 0.05;
    const roll = random();
    if (roll < density) set(x, y, T.TREE);
    else if (roll < density + 0.02) set(x, y, T.ROCK);
  }
}

// 7. A little clearing south of the east road holds the gate; stepping down
// from the road is deliberate, so walking east does not teleport anyone.
rect(34, 61, 38, 65, T.PATH);
rect(35, 59, 37, 61, T.PATH);
set(36, 63, T.PORTAL);
// And one on the far shore so the bridge leads somewhere.
rect(16, 2, 24, 6, T.PATH);

// 8. Monsters on free ground, never inside the village or on a road.
const SOLID = new Set([T.WATER, T.TREE, T.ROCK, T.WALL, T.CACTUS, T.GATE, T.PORTAL]);
const findFree = (x, y, maxRadius = 6) => {
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        if (!SOLID.has(get(nx, ny))) return { x: nx, y: ny };
      }
    }
  }
  return null;
};

const WANTED = [
  ['wolf', 46, 36],
  ['wolf', 52, 46],
  ['wolf', 58, 34],
  ['wolf', 64, 50],
  ['wolf', 70, 42],
  ['wolf', 50, 60],
  ['wolf', 60, 64],
  ['wolf', 68, 30],
  ['wolf', 74, 58],
  ['boar', 42, 70],
  ['boar', 56, 72],
  ['boar', 66, 72],
  ['boar', 48, 26],
];

const spawns = [];
for (const [key, x, y] of WANTED) {
  const spot = findFree(x, y);
  if (spot !== null) spawns.push({ kind: 'mob', key, tx: spot.x, ty: spot.y });
}

const map = {
  id: 'greenfield',
  width: WIDTH,
  height: HEIGHT,
  spawn: SPAWN,
  tiles,
  spawns,
  portals: [{ tx: 36, ty: 63, to: 'testmap', spawnX: 40, spawnY: 37 }],
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'packages', 'shared', 'maps', 'greenfield.json');
writeFileSync(target, JSON.stringify(map));
console.log(`wrote ${target}: ${spawns.length} monsters, spawn at ${SPAWN.x},${SPAWN.y}`);

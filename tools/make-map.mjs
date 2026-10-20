// Generates packages/shared/maps/testmap.json.
//
// This is a placeholder world, not a design: it exists so the map pipeline
// (tile layer, collision, spawn) can be built and tested. Real maps come out of
// the map editor later and only need to follow the same json shape.
//
// Deterministic: the same seed always produces the same map, and the file is
// committed, so nobody has to run this to play.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 64;
const HEIGHT = 64;
const SEED = 20261020;

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

/** Small deterministic generator; no Math.random, so runs are reproducible. */
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

// 1. Meadow: mostly grass with patches of flowers.
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (random() < 0.06) set(x, y, T.FLOWERS);
  }
}

// 2. A lake in the south-west, with a sandy shore.
const LAKE_X = 17;
const LAKE_Y = 47;
const LAKE_RADIUS = 7.5;
for (let y = LAKE_Y - 11; y <= LAKE_Y + 11; y += 1) {
  for (let x = LAKE_X - 11; x <= LAKE_X + 11; x += 1) {
    const distance = Math.hypot(x - LAKE_X, y - LAKE_Y);
    if (distance <= LAKE_RADIUS) set(x, y, T.WATER);
    else if (distance <= LAKE_RADIUS + 1.6) set(x, y, T.SAND);
  }
}

// 3. Two roads crossing in the middle, four tiles wide.
for (let x = 0; x < WIDTH; x += 1) {
  for (let y = 30; y <= 33; y += 1) set(x, y, T.PATH);
}
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 30; x <= 33; x += 1) set(x, y, T.PATH);
}

// 4. A walled village in the north-west, open towards the road in the south.
for (let y = 8; y <= 19; y += 1) {
  for (let x = 8; x <= 22; x += 1) set(x, y, T.STONE);
}
for (let x = 8; x <= 22; x += 1) {
  set(x, 8, T.WALL);
  set(x, 19, T.WALL);
}
for (let y = 8; y <= 19; y += 1) {
  set(8, y, T.WALL);
  set(22, y, T.WALL);
}
for (let x = 14; x <= 16; x += 1) set(x, 19, T.PATH); // gate gap
for (let x = 14; x <= 16; x += 1) set(x, 8, T.PATH); // north exit

// 5. Forest and rocks, but never on roads, shore, water or village floor.
const reserved = new Set([T.PATH, T.WATER, T.SAND, T.STONE, T.WALL, T.BRIDGE, T.PORTAL]);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    if (reserved.has(get(x, y))) continue;
    const edge = Math.min(x, y, WIDTH - 1 - x, HEIGHT - 1 - y);
    const density = edge < 6 ? 0.42 : edge < 12 ? 0.16 : 0.04;
    const roll = random();
    if (roll < density) set(x, y, T.TREE);
    else if (roll < density + 0.02) set(x, y, T.ROCK);
  }
}

// 6. Clear the spawn square so two players never start inside a tree.
const SPAWN = { x: 32, y: 32 };
for (let y = SPAWN.y - 2; y <= SPAWN.y + 2; y += 1) {
  for (let x = SPAWN.x - 2; x <= SPAWN.x + 2; x += 1) set(x, y, T.PATH);
}

// One row per line keeps the file diffable.
const rows = [];
for (let y = 0; y < HEIGHT; y += 1) {
  rows.push(`    ${tiles.slice(y * WIDTH, (y + 1) * WIDTH).join(',')}`);
}

const json = `{
  "id": "testmap",
  "width": ${WIDTH},
  "height": ${HEIGHT},
  "spawn": { "x": ${SPAWN.x}, "y": ${SPAWN.y} },
  "tiles": [
${rows.join(',\n')}
  ]
}
`;

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../packages/shared/maps/testmap.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, json, 'utf8');

const counts = new Map();
for (const tile of tiles) counts.set(tile, (counts.get(tile) ?? 0) + 1);
const names = Object.fromEntries(Object.entries(T).map(([name, id]) => [id, name]));
const summary = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([tile, count]) => `${names[tile]} ${count}`)
  .join(', ');

console.log(`wrote ${target}`);
console.log(summary);

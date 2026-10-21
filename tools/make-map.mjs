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

// 7. Monsters, placed on free ground near chosen spots. The spiral finds the
// nearest walkable tile, so a forest that grew over a spot does not hide a mob.
const SOLID_TILES = new Set([T.WATER, T.TREE, T.ROCK, T.WALL, T.CACTUS, T.GATE]);

const findFree = (x, y, maxRadius = 6) => {
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        if (!SOLID_TILES.has(get(nx, ny))) return { x: nx, y: ny };
      }
    }
  }
  return null;
};

const WANTED = [
  ['wolf', 12, 26],
  ['wolf', 18, 27],
  ['wolf', 25, 22],
  ['wolf', 42, 22],
  ['wolf', 47, 28],
  ['wolf', 52, 36],
  ['wolf', 44, 40],
  ['wolf', 30, 24],
  ['boar', 20, 52],
  ['boar', 24, 56],
  ['boar', 14, 58],
  ['boar', 38, 46],
];

const spawns = [];
for (const [key, x, y] of WANTED) {
  const spot = findFree(x, y);
  if (spot !== null) spawns.push({ kind: 'mob', key, tx: spot.x, ty: spot.y });
}

// A second, small map to show that maps can be more than one.
const GROVE_W = 24;
const GROVE_H = 24;
const grove = new Array(GROVE_W * GROVE_H).fill(T.GRASS);
const gset = (x, y, t) => {
  if (x >= 0 && y >= 0 && x < GROVE_W && y < GROVE_H) grove[y * GROVE_W + x] = t;
};

for (let i = 0; i < GROVE_W; i += 1) {
  gset(i, 0, T.TREE);
  gset(i, GROVE_H - 1, T.TREE);
  gset(0, i, T.TREE);
  gset(GROVE_W - 1, i, T.TREE);
}
for (let y = 2; y < GROVE_H - 2; y += 1) {
  for (let x = 2; x < GROVE_W - 2; x += 1) {
    const roll = random();
    if (roll < 0.08) gset(x, y, T.TREE);
    else if (roll < 0.1) gset(x, y, T.FLOWERS);
  }
}
// A ring of stones with a clearing in the middle.
for (let step = 0; step < 16; step += 1) {
  const angle = (step / 16) * Math.PI * 2;
  gset(Math.round(12 + Math.cos(angle) * 5), Math.round(12 + Math.sin(angle) * 5), T.ROCK);
}
for (let y = 10; y <= 15; y += 1) {
  for (let x = 10; x <= 14; x += 1) gset(x, y, T.PATH);
}

const testmap = {
  id: 'testmap',
  width: WIDTH,
  height: HEIGHT,
  spawn: SPAWN,
  portals: [
    { tx: 36, ty: 32, to: 'grove', spawnX: 12, spawnY: 15 },
    { tx: 40, ty: 36, to: 'greenfield', spawnX: 36, spawnY: 64 },
  ],
  tiles,
  spawns,
};

for (let y = 34; y <= 37; y += 1) {
  for (let x = 38; x <= 42; x += 1) set(x, y, T.PATH);
}
set(36, 32, T.PORTAL);
set(40, 36, T.PORTAL);
testmap.tiles = tiles;

// Keep the spawn square and the way to the portal clear.
for (let y = 15; y <= 17; y += 1) {
  for (let x = 11; x <= 13; x += 1) gset(x, y, T.PATH);
}
for (let y = 13; y <= 15; y += 1) gset(12, y, T.PATH);
gset(12, 13, T.PORTAL);

const groveMap = {
  id: 'grove',
  width: GROVE_W,
  height: GROVE_H,
  spawn: { x: 12, y: 16 },
  portals: [{ tx: 12, ty: 13, to: 'testmap', spawnX: 36, spawnY: 33 }],
  tiles: grove,
  spawns: [
    { kind: 'mob', key: 'wolf', tx: 8, ty: 8 },
    { kind: 'mob', key: 'wolf', tx: 16, ty: 9 },
    { kind: 'mob', key: 'boar', tx: 14, ty: 17 },
  ],
};

const formatMap = (map) => {
  const rows = [];
  for (let y = 0; y < map.height; y += 1) {
    rows.push(`    ${map.tiles.slice(y * map.width, (y + 1) * map.width).join(',')}`);
  }

  const spawnLines = map.spawns
    .map((entry) => `    { "kind": "mob", "key": "${entry.key}", "tx": ${entry.tx}, "ty": ${entry.ty} }`)
    .join(',\n');
  const portalLines = map.portals
    .map(
      (entry) =>
        `    { "tx": ${entry.tx}, "ty": ${entry.ty}, "to": "${entry.to}", "spawnX": ${entry.spawnX}, "spawnY": ${entry.spawnY} }`,
    )
    .join(',\n');

  return `{
  "id": "${map.id}",
  "width": ${map.width},
  "height": ${map.height},
  "spawn": { "x": ${map.spawn.x}, "y": ${map.spawn.y} },
  "portals": [
${portalLines}
  ],
  "tiles": [
${rows.join(',\n')}
  ],
  "spawns": [
${spawnLines}
  ]
}
`;
};

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../packages/shared/maps');
mkdirSync(target, { recursive: true });

for (const map of [testmap, groveMap]) {
  const file = resolve(target, `${map.id}.json`);
  writeFileSync(file, formatMap(map), 'utf8');
  console.log(`wrote ${file} (${map.width}x${map.height})`);
}

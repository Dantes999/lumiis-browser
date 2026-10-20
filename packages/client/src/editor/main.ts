// A small map editor: paint tiles, set the player spawn, place monsters and
// save the result as a complete map file the game loads.
//
// It writes the same json shape as shared/maps/testmap.json, so the server and
// the browser keep reading one file.

import {
  MONSTER_KEYS,
  MONSTER_TYPES,
  TILE,
  TILE_COUNT,
  validateMap,
  type MapData,
  type MonsterKey,
} from '@lumiis/shared';

const MAP_PATH = '/maps/testmap.json';
const CELL = 12;
const SAVE_PATH = '/maps/';

const TILE_NAMES: Record<number, string> = {
  [TILE.GRASS]: 'Grass',
  [TILE.FLOWERS]: 'Flowers',
  [TILE.PATH]: 'Path',
  [TILE.WATER]: 'Water',
  [TILE.SAND]: 'Sand',
  [TILE.TREE]: 'Tree',
  [TILE.ROCK]: 'Rock',
  [TILE.STONE]: 'Stone',
  [TILE.WALL]: 'Wall',
  [TILE.BRIDGE]: 'Bridge',
  [TILE.PORTAL]: 'Portal',
  [TILE.CACTUS]: 'Cactus',
  [TILE.GATE]: 'Gate',
  [TILE.GATE_OPEN]: 'Gate open',
};

const TILE_COLORS: Record<number, string> = {
  [TILE.GRASS]: '#2f4a33',
  [TILE.FLOWERS]: '#3a5a3c',
  [TILE.PATH]: '#6b5a3e',
  [TILE.WATER]: '#1c3a5c',
  [TILE.SAND]: '#8d7c52',
  [TILE.TREE]: '#1f3a26',
  [TILE.ROCK]: '#5a5f63',
  [TILE.STONE]: '#4a4a4f',
  [TILE.WALL]: '#55504a',
  [TILE.BRIDGE]: '#7a5a3a',
  [TILE.PORTAL]: '#6a49b0',
  [TILE.CACTUS]: '#2f6b3a',
  [TILE.GATE]: '#3a3a40',
  [TILE.GATE_OPEN]: '#1f1f24',
};

type Tool = 'paint' | 'spawn' | 'mob';

const mustFind = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element as T;
};

const canvas = mustFind<HTMLCanvasElement>('board');
const context = canvas.getContext('2d');
if (context === null) throw new Error('canvas without 2d context');

let map: MapData | null = null;
let tool: Tool = 'paint';
let tile: number = TILE.GRASS;
let mobKey: string = MONSTER_KEYS[0] ?? 'wolf';
let dirty = false;

const status = mustFind('status');
const say = (text: string): void => {
  status.textContent = text;
};

const markDirty = (): void => {
  dirty = true;
  say('Unsaved changes.');
};

const draw = (): void => {
  if (map === null) return;

  canvas.width = map.width * CELL;
  canvas.height = map.height * CELL;
  context.imageSmoothingEnabled = false;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const value = map.tiles[y * map.width + x] ?? TILE.GRASS;
      context.fillStyle = TILE_COLORS[value] ?? '#000000';
      context.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // Player spawn.
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.strokeRect(map.spawn.x * CELL + 1, map.spawn.y * CELL + 1, CELL - 2, CELL - 2);

  // Monster spawns.
  for (const spawn of map.spawns) {
    context.fillStyle = spawn.key === 'boar' ? '#d8c07a' : '#d05f5f';
    context.beginPath();
    context.arc(
      spawn.tx * CELL + CELL / 2,
      spawn.ty * CELL + CELL / 2,
      CELL / 3,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
};

const tileAt = (event: PointerEvent): { tx: number; ty: number } | null => {
  if (map === null) return null;

  const rect = canvas.getBoundingClientRect();
  const tx = Math.floor(((event.clientX - rect.left) / rect.width) * map.width);
  const ty = Math.floor(((event.clientY - rect.top) / rect.height) * map.height);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;

  return { tx, ty };
};

const apply = (event: PointerEvent): void => {
  if (map === null) return;
  const cell = tileAt(event);
  if (cell === null) return;

  if (tool === 'paint') {
    const index = cell.ty * map.width + cell.tx;
    if (map.tiles[index] === tile) return;
    map.tiles[index] = tile;
  } else if (tool === 'spawn') {
    if (map.spawn.x === cell.tx && map.spawn.y === cell.ty) return;
    map.spawn = { x: cell.tx, y: cell.ty };
  } else {
    const existing = map.spawns.findIndex(
      (spawn) => spawn.tx === cell.tx && spawn.ty === cell.ty,
    );
    if (existing >= 0) {
      map.spawns.splice(existing, 1);
    } else {
      map.spawns.push({ kind: 'mob', key: mobKey as MonsterKey, tx: cell.tx, ty: cell.ty });
    }
  }

  markDirty();
  draw();
};

const load = async (): Promise<void> => {
  say('Loading…');
  const response = await fetch(MAP_PATH, { cache: 'no-store' });
  const parsed = validateMap(await response.json());

  if (!parsed.ok) {
    say(`Map is invalid:\n${parsed.errors.join('\n')}`);
    return;
  }

  map = { ...parsed.map, tiles: [...parsed.map.tiles], spawns: [...parsed.map.spawns] };
  dirty = false;
  mustFind('map-name').textContent = `${map.id} (${map.width}×${map.height})`;
  say(`${map.tiles.length} tiles, ${map.spawns.length} monsters.`);
  draw();
};

const save = async (): Promise<void> => {
  if (map === null) return;

  say('Saving…');
  const response = await fetch(`${SAVE_PATH}${map.id}.json`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(map),
  });

  const answer = (await response.json()) as { ok?: boolean; errors?: string[] };
  if (!response.ok) {
    say(`Could not save:\n${(answer.errors ?? []).join('\n')}`);
    return;
  }

  dirty = false;
  say('Saved. Restart the game server to walk the new map.');
};

const palette = mustFind('palette');
for (let id = 0; id < TILE_COUNT; id += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.tile = String(id);
  button.classList.toggle('active', id === tile);

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = TILE_COLORS[id] ?? '#000000';

  const name = document.createElement('span');
  name.textContent = TILE_NAMES[id] ?? `Tile ${id}`;

  button.append(swatch, name);
  button.addEventListener('click', () => {
    tile = id;
    tool = 'paint';
    for (const entry of palette.querySelectorAll('button')) entry.classList.remove('active');
    button.classList.add('active');
    for (const entry of document.querySelectorAll('.editor-tools button')) {
      entry.classList.toggle('active', (entry as HTMLElement).dataset['tool'] === 'paint');
    }
  });
  palette.append(button);
}

const mobPicker = mustFind('mob-picker');
for (const key of MONSTER_KEYS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.mob = key;
  button.classList.toggle('active', key === mobKey);
  button.textContent = MONSTER_TYPES[key].name;

  button.addEventListener('click', () => {
    mobKey = key;
    tool = 'mob';
    for (const entry of mobPicker.querySelectorAll('button')) entry.classList.remove('active');
    button.classList.add('active');
    for (const entry of document.querySelectorAll('.editor-tools button')) {
      entry.classList.toggle('active', (entry as HTMLElement).dataset['tool'] === 'mob');
    }
  });
  mobPicker.append(button);
}

for (const button of document.querySelectorAll<HTMLElement>('.editor-tools button')) {
  button.addEventListener('click', () => {
    tool = (button.dataset['tool'] as Tool) ?? 'paint';
    for (const entry of document.querySelectorAll('.editor-tools button')) {
      entry.classList.toggle('active', entry === button);
    }
  });
}

let painting = false;
canvas.addEventListener('pointerdown', (event) => {
  painting = true;
  canvas.setPointerCapture(event.pointerId);
  apply(event);
});
canvas.addEventListener('pointermove', (event) => {
  if (painting) apply(event);
});
canvas.addEventListener('pointerup', () => {
  painting = false;
});
canvas.addEventListener('pointercancel', () => {
  painting = false;
});

mustFind('save').addEventListener('click', () => {
  void save();
});
mustFind('reload').addEventListener('click', () => {
  if (dirty && !window.confirm('Discard the unsaved changes?')) return;
  void load();
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

void load();

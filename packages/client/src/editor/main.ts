// A small map editor: pick a map, paint tiles, set the player spawn, place
// monsters and portals, then save it as a complete map file the game loads.
//
// It writes the same json shape the server reads, so there is one source.

import {
  MONSTER_KEYS,
  MONSTER_TYPES,
  TILE,
  TILE_COUNT,
  validateMap,
  type MapData,
  type MonsterKey,
} from '@lumiis/shared';

const CELL = 12;
const DEFAULT_MAP = 'testmap';

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

type Tool = 'paint' | 'spawn' | 'mob' | 'portal';

const mustFind = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element as T;
};

const canvas = mustFind<HTMLCanvasElement>('board');
const context = canvas.getContext('2d');
if (context === null) throw new Error('canvas without 2d context');

const mapSelect = mustFind<HTMLSelectElement>('map-select');
const portalTarget = mustFind<HTMLSelectElement>('portal-target');
const portalX = mustFind<HTMLInputElement>('portal-x');
const portalY = mustFind<HTMLInputElement>('portal-y');
const status = mustFind('status');

let map: MapData | null = null;
let mapIds: string[] = [];
let tool: Tool = 'paint';
let tile: number = TILE.GRASS;
let mobKey: string = MONSTER_KEYS[0] ?? 'wolf';
let dirty = false;

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

  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.strokeRect(map.spawn.x * CELL + 1, map.spawn.y * CELL + 1, CELL - 2, CELL - 2);

  const dot = (tx: number, ty: number, colour: string, radius: number): void => {
    context.fillStyle = colour;
    context.beginPath();
    context.arc(tx * CELL + CELL / 2, ty * CELL + CELL / 2, radius, 0, Math.PI * 2);
    context.fill();
  };

  for (const spawn of map.spawns) dot(spawn.tx, spawn.ty, spawn.key === 'boar' ? '#d8c07a' : '#d05f5f', CELL / 3);
  for (const portal of map.portals) dot(portal.tx, portal.ty, '#a98cf0', CELL / 2.4);
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
  } else if (tool === 'mob') {
    const existing = map.spawns.findIndex((entry) => entry.tx === cell.tx && entry.ty === cell.ty);
    if (existing >= 0) {
      map.spawns.splice(existing, 1);
    } else {
      map.spawns.push({ kind: 'mob', key: mobKey as MonsterKey, tx: cell.tx, ty: cell.ty });
    }
  } else {
    const existing = map.portals.findIndex((entry) => entry.tx === cell.tx && entry.ty === cell.ty);
    if (existing >= 0) {
      map.portals.splice(existing, 1);
      map.tiles[cell.ty * map.width + cell.tx] = TILE.PATH;
    } else {
      map.portals.push({
        tx: cell.tx,
        ty: cell.ty,
        to: portalTarget.value,
        spawnX: Number(portalX.value) || 0,
        spawnY: Number(portalY.value) || 0,
      });
      map.tiles[cell.ty * map.width + cell.tx] = TILE.PORTAL;
    }
  }

  markDirty();
  draw();
};

const fillSelect = (select: HTMLSelectElement, entries: string[], selected: string): void => {
  select.replaceChildren();
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry;
    option.textContent = entry;
    option.selected = entry === selected;
    select.append(option);
  }
};

const load = async (id: string): Promise<void> => {
  say('Loading…');

  const response = await fetch(`/maps/${id}.json`, { cache: 'no-store' });
  const parsed = validateMap(await response.json());

  if (!parsed.ok) {
    say(`Map is invalid:\n${parsed.errors.join('\n')}`);
    return;
  }

  map = { ...parsed.map, tiles: [...parsed.map.tiles], spawns: [...parsed.map.spawns], portals: [...parsed.map.portals] };
  dirty = false;
  fillSelect(mapSelect, mapIds, map.id);
  fillSelect(
    portalTarget,
    mapIds.filter((entry) => entry !== map?.id),
    portalTarget.value || mapIds.find((entry) => entry !== map?.id) || '',
  );
  say(`${map.id}: ${map.width}×${map.height}, ${map.spawns.length} monsters, ${map.portals.length} portals.`);
  draw();
};

const loadList = async (): Promise<void> => {
  const response = await fetch('/maps/', { cache: 'no-store' });
  const body = (await response.json()) as { maps?: string[] };
  mapIds = body.maps ?? [];

  if (mapIds.length === 0) {
    say('The server knows no maps. Is it running?');
    return;
  }

  await load(mapIds.includes(DEFAULT_MAP) ? DEFAULT_MAP : (mapIds[0] as string));
};

const save = async (): Promise<void> => {
  if (map === null) return;

  for (const portal of map.portals) {
    if (!mapIds.includes(portal.to)) {
      say(`Portal at ${portal.tx},${portal.ty} points at "${portal.to}", which does not exist. Save with a new map first.`);
      return;
    }
  }

  say('Saving…');
  const response = await fetch(`/maps/${map.id}.json`, {
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
  if (!mapIds.includes(map.id)) {
    mapIds.push(map.id);
    mapIds.sort();
  }
  fillSelect(mapSelect, mapIds, map.id);
  say('Saved. Restart the game server to load the new map.');
};

const newMap = (): void => {
  const id = window.prompt('Map id (lowercase letters, digits, underscore):', 'newmap');
  if (id === null) return;
  if (!/^[a-z0-9_]{1,32}$/.test(id)) {
    say('The id may only use a-z, 0-9 and underscore.');
    return;
  }
  if (mapIds.includes(id)) {
    say(`A map called ${id} already exists.`);
    return;
  }

  const size = Number(window.prompt('Size in tiles:', '32')) || 32;
  const side = Math.max(8, Math.min(128, Math.floor(size)));

  map = {
    id,
    width: side,
    height: side,
    spawn: { x: 1, y: 1 },
    tiles: new Array(side * side).fill(TILE.GRASS),
    spawns: [],
    portals: [],
  };

  markDirty();
  fillSelect(mapSelect, [...mapIds, id], id);
  say(`New map ${id} (${side}×${side}). Press Save to write it.`);
  draw();
};

const palette = mustFind('palette');
for (let id = 0; id < TILE_COUNT; id += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset['tile'] = String(id);
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
  button.dataset['mob'] = key;
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

mapSelect.addEventListener('change', () => {
  if (dirty && !window.confirm('Discard the unsaved changes?')) {
    fillSelect(mapSelect, mapIds, map?.id ?? '');
    return;
  }
  void load(mapSelect.value);
});

mustFind('save').addEventListener('click', () => {
  void save();
});
mustFind('reload').addEventListener('click', () => {
  if (map === null) return;
  if (dirty && !window.confirm('Discard the unsaved changes?')) return;
  void load(map.id);
});
mustFind('new-map').addEventListener('click', newMap);

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

void loadList();

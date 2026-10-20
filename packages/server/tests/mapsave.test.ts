import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TILE, type MapData } from '@lumiis/shared';
import { createGameServer, type GameServer } from '../src/index.js';

let server: GameServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const grassMap = (id: string): MapData => ({
  id,
  width: 8,
  height: 8,
  spawn: { x: 1, y: 1 },
  tiles: new Array(8 * 8).fill(TILE.GRASS),
  spawns: [],
  portals: [],
});

const setup = async (): Promise<{ mapPath: string; port: number }> => {
  const root = mkdtempSync(join(tmpdir(), 'lumiis-map-'));
  mkdirSync(join(root, 'maps'), { recursive: true });

  const mapPath = join(root, 'maps', 'testmap.json');
  writeFileSync(mapPath, JSON.stringify(grassMap('testmap')), 'utf8');

  server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: '/nonexistent',
    mapPath,
    dataFile: ':memory:',
  });

  return { mapPath, port: server.port };
};

const put = (port: number, path: string, body: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('saving maps from the editor', () => {
  it('writes a valid map to the file the game loads', async () => {
    const { mapPath, port } = await setup();

    const painted = grassMap('testmap');
    painted.tiles[0] = TILE.WATER;
    painted.spawn = { x: 4, y: 4 };
    painted.portals = [{ tx: 2, ty: 2, to: 'grove', spawnX: 1, spawnY: 1 }];

    const response = await put(port, '/maps/testmap.json', painted);
    expect(response.status).toBe(200);

    const written = JSON.parse(readFileSync(mapPath, 'utf8')) as MapData;
    expect(written.tiles[0]).toBe(TILE.WATER);
    expect(written.spawn).toEqual({ x: 4, y: 4 });
    expect(written.portals).toEqual([{ tx: 2, ty: 2, to: 'grove', spawnX: 1, spawnY: 1 }]);
  });

  it('refuses a map that does not validate', async () => {
    const { mapPath, port } = await setup();
    const before = readFileSync(mapPath, 'utf8');

    const broken = await put(port, '/maps/testmap.json', { id: 'testmap', width: 8, height: 8 });
    expect(broken.status).toBe(400);
    expect(readFileSync(mapPath, 'utf8')).toBe(before);
  });

  it('refuses a map whose id does not match the file name', async () => {
    const { port } = await setup();
    const response = await put(port, '/maps/other.json', grassMap('testmap'));
    expect(response.status).toBe(400);
  });

  it('refuses a file name that is not a map key', async () => {
    const { port } = await setup();
    expect((await put(port, '/maps/Bad Name.json', grassMap('testmap'))).status).toBe(400);
  });

  it('refuses a body that is not json', async () => {
    const { port } = await setup();
    expect((await put(port, '/maps/testmap.json', 'not json')).status).toBe(400);
  });
});

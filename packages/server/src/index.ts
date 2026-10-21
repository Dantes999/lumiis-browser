// Entry point: wires HTTP, WebSocket, world and tick loop together.
//
// Nothing in this file knows about game rules. It only decides *when* things
// happen; the rules live in the world and its systems.

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SNAPSHOT_EVERY_TICKS, TICK_MS, TICK_RATE } from '@lumiis/shared';
import type { World } from './game/world.js';
import { FixedStepLoop } from './game/loop.js';
import { loadMaps } from './game/map.js';
import { Realm } from './game/realm.js';
import { Store } from './store/db.js';
import { attachGateway, type Gateway } from './net/gateway.js';
import { handleMapSave } from './http/mapsave.js';
import { createStaticHandler } from './http/static.js';

export type GameServerOptions = {
  port?: number;
  host?: string;
  staticDir?: string;
  mapPath?: string;
  /** SQLite file for accounts and characters; ':memory:' in tests. */
  dataFile?: string;
};

export type GameServer = {
  readonly port: number;
  readonly realm: Realm;
  /** The first map, for logs and tests. */
  readonly world: World;
  readonly loop: FixedStepLoop;
  readonly gateway: Gateway;
  readonly store: Store;
  close(): Promise<void>;
};

const here = dirname(fileURLToPath(import.meta.url));

const defaultStaticDir = (): string => resolve(here, '../../client/dist');
const defaultMapPath = (): string => resolve(here, '../../shared/maps/testmap.json');
const defaultDataFile = (): string => resolve(here, '../../../data/lumiis.db');

/** How often every logged in character is written to disk. */
const SAVE_EVERY_SECONDS = 30;

export async function createGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  const port = options.port ?? Number(process.env['PORT'] ?? 3000);
  const host = options.host ?? process.env['HOST'] ?? '0.0.0.0';
  const staticDir = options.staticDir ?? defaultStaticDir();
  const mapPath = options.mapPath ?? defaultMapPath();
  const dataFile = options.dataFile ?? defaultDataFile();

  if (dataFile !== ':memory:') mkdirSync(dirname(dataFile), { recursive: true });
  const store = new Store(dataFile);

  const maps = loadMaps(mapPath);
  // The map is served from the same file the server loaded, so server and
  // browser can never disagree about where the walls are.
  const sharedRoot = dirname(dirname(mapPath));

  const serveClient = createStaticHandler(staticDir);
  const serveShared = createStaticHandler(sharedRoot);

  const httpServer = createServer((req, res) => {
    const path = req.url ?? '/';

    if (req.method === 'PUT' && path.startsWith('/maps/')) {
      void handleMapSave(req, res, sharedRoot);
      return;
    }

    if (req.method === 'GET' && (path === '/maps/' || path === '/maps')) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ maps: realm.mapIds }));
      return;
    }

    void (path.startsWith('/maps/') ? serveShared : serveClient)(req, res);
  });

  const realm = new Realm(maps);
  const world = realm.primary;
  if (world === null) throw new Error('no map loaded');

  const gateway = attachGateway(httpServer, realm, store);

  const loop = new FixedStepLoop(TICK_MS, () => {
    realm.tick();

    for (const update of realm.drainInventoryUpdates()) {
      gateway.sendInventory(update.playerId);
    }

    for (const event of realm.drainEvents()) {
      gateway.notify(event.playerId, event.text);
    }

    const tick = realm.primary?.tick ?? 0;
    if (tick % SNAPSHOT_EVERY_TICKS === 0) gateway.broadcastSnapshot();
    if (tick % (TICK_RATE * SAVE_EVERY_SECONDS) === 0) gateway.saveAll();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: boundPort,
    realm,
    world,
    loop,
    gateway,
    store,
    async close(): Promise<void> {
      loop.stop();
      gateway.saveAll();
      await gateway.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      store.close();
    },
  };
}

async function main(): Promise<void> {
  const server = await createGameServer();
  server.loop.start();

  console.log(`Lumiis server listening on port ${server.port} (${TICK_RATE} ticks/s)`);
  console.log(`Maps: ${server.realm.mapIds.join(', ')}`);
  console.log(`Open http://localhost:${server.port} in a browser.`);

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}, shutting down.`);
    void server.close().then(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A bug must not kill the process without a trace and without saving. This
  // logs what broke, writes every character to disk, and only then exits.
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception, saving and stopping:', error);
    void server
      .close()
      .catch((closeError: unknown) => console.error('Saving during crash failed:', closeError))
      .finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  });
}

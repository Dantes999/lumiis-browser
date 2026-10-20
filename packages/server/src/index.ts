// Entry point: wires HTTP, WebSocket, world and tick loop together.
//
// Nothing in this file knows about game rules. It only decides *when* things
// happen; the rules live in the world and its systems.

import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SNAPSHOT_EVERY_TICKS, TICK_MS, TICK_RATE } from '@lumiis/shared';
import { World } from './game/world.js';
import { FixedStepLoop } from './game/loop.js';
import { attachGateway, type Gateway } from './net/gateway.js';
import { createStaticHandler } from './http/static.js';

export type GameServerOptions = {
  port?: number;
  host?: string;
  staticDir?: string;
};

export type GameServer = {
  readonly port: number;
  readonly world: World;
  readonly loop: FixedStepLoop;
  readonly gateway: Gateway;
  close(): Promise<void>;
};

const defaultStaticDir = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export async function createGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  const port = options.port ?? Number(process.env['PORT'] ?? 3000);
  const host = options.host ?? process.env['HOST'] ?? '0.0.0.0';
  const staticDir = options.staticDir ?? defaultStaticDir();

  const serveStatic = createStaticHandler(staticDir);
  const httpServer = createServer((req, res) => {
    void serveStatic(req, res);
  });

  const world = new World();
  const gateway = attachGateway(httpServer, world);

  const loop = new FixedStepLoop(TICK_MS, () => {
    world.step();
    if (world.tick % SNAPSHOT_EVERY_TICKS === 0) gateway.broadcastSnapshot();
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
    world,
    loop,
    gateway,
    async close(): Promise<void> {
      loop.stop();
      await gateway.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

async function main(): Promise<void> {
  const server = await createGameServer();
  server.loop.start();

  console.log(`Lumiis server listening on port ${server.port} (${TICK_RATE} ticks/s)`);
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
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  });
}

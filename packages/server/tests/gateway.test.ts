import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@lumiis/shared';
import { createGameServer, type GameServer } from '../src/index.js';

let server: GameServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const openSocket = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

const nextMessage = (socket: WebSocket, timeoutMs = 2000): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message within timeout')), timeoutMs);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });

const closedWith = (socket: WebSocket, timeoutMs = 2000): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

const nextOfType = async (socket: WebSocket, type: string): Promise<Record<string, unknown>> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const message = (await nextMessage(socket)) as Record<string, unknown>;
    if (message['t'] === type) return message;
  }
  throw new Error(`no ${type} message`);
};

/** Registers or logs in, creates the character and waits for the welcome. */
const enterAs = async (socket: WebSocket, name = 'Kain'): Promise<Record<string, unknown>> => {
  socket.send(JSON.stringify({ t: 'login', name, password: 'secret123', mode: 'register' }));
  await nextOfType(socket, 'characters');
  socket.send(JSON.stringify({ t: 'createCharacter', name }));
  return nextOfType(socket, 'welcome');
};

const startServer = async (): Promise<number> => {
  server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: '/nonexistent',
    dataFile: ':memory:',
  });
  server.loop.start();
  return server.port;
};

describe('gateway', () => {
  it('lists characters and welcomes the player after choosing one', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    const welcome = await enterAs(socket);

    expect(welcome['t']).toBe('welcome');
    expect(welcome['protocol']).toBe(PROTOCOL_VERSION);
    expect(typeof welcome['id']).toBe('number');
    expect(server?.world.playerCount).toBe(1);

    socket.close();
  });

  it('sends snapshots while the world runs', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    await enterAs(socket);

    const snapshot = (await nextMessage(socket)) as Record<string, unknown>;
    expect(snapshot['t']).toBe('snapshot');
    expect(Array.isArray(snapshot['players'])).toBe(true);

    socket.close();
  });

  it('answers a ping with the same timestamp', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    await enterAs(socket);

    socket.send(JSON.stringify({ t: 'ping', at: 4242 }));
    let pong: Record<string, unknown> | null = null;
    while (pong === null) {
      const message = (await nextMessage(socket)) as Record<string, unknown>;
      if (message['t'] === 'pong') pong = message;
    }
    expect(pong['at']).toBe(4242);

    socket.close();
  });

  it('closes the connection on an unknown message instead of guessing', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    socket.send(JSON.stringify({ t: 'teleport', x: 999, y: 999 }));
    expect(await closedWith(socket)).toBe(1002);
  });

  it('moves the player the client is steering', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    const welcome = (await enterAs(socket)) as { id: number };

    const ownPosition = async (): Promise<number | null> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const message = (await nextMessage(socket)) as Record<string, unknown>;
        if (message['t'] !== 'snapshot') continue;
        const players = message['players'] as Array<{ id: number; x: number }>;
        const me = players.find((player) => player.id === welcome.id);
        if (me !== undefined) return me.x;
      }
      return null;
    };

    const before = await ownPosition();
    socket.send(JSON.stringify({ t: 'input', dx: 1, dy: 0 }));
    const after = await ownPosition();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after as number).toBeGreaterThan(before as number);

    socket.close();
  });

  it('rejects movement input that is not a whole step', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    await enterAs(socket);

    socket.send(JSON.stringify({ t: 'input', dx: 2, dy: 0 }));
    expect(await closedWith(socket)).toBe(1002);
  });

  it('closes the connection on broken json', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    socket.send('not json at all');
    expect(await closedWith(socket)).toBe(1002);
  });

  it('forgets a player when the socket closes', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    await enterAs(socket);
    expect(server?.world.playerCount).toBe(1);

    socket.close();
    await closedWith(socket);

    // The close handler runs before the socket event reaches the test.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server?.world.playerCount).toBe(0);
  });
});

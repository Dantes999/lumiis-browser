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

/** Fails when a message of `type` arrives within `ms`; resolves when it stays quiet. */
const silenceOfType = (socket: WebSocket, type: string, ms = 500): Promise<void> =>
  new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message['t'] !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      reject(new Error(`unexpected ${type}: ${JSON.stringify(message)}`));
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, ms);
    socket.on('message', onMessage);
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

const startServer = async (options: { channels?: number } = {}): Promise<number> => {
  server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: '/nonexistent',
    dataFile: ':memory:',
    ...options,
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

    // Snapshots are deltas: the own position is in the full list on arrival and
    // afterwards in the compact move tuples.
    const ownPosition = async (): Promise<number | null> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const message = (await nextMessage(socket)) as Record<string, unknown>;
        if (message['t'] !== 'snapshot') continue;

        const players = (message['players'] ?? []) as Array<{ id: number; x: number }>;
        const me = players.find((player) => player.id === welcome.id);
        if (me !== undefined) return me.x;

        const move = message['move'] as
          | { players?: Array<[number, number, number]> }
          | undefined;
        const moved = move?.players?.find((entry) => entry[0] === welcome.id);
        if (moved !== undefined) return moved[1];
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

  it('lets the player pick and switch a channel', async () => {
    const port = await startServer({ channels: 2 });

    // Create the character (this enters the world once), then come back.
    const first = await openSocket(port);
    const welcome = await enterAs(first, 'Kain');
    expect(welcome['channelCount']).toBe(2);
    expect([1, 2]).toContain(welcome['channel']);

    const closed = new Promise<void>((resolve) => first.once('close', () => resolve()));
    first.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await openSocket(port);
    second.send(JSON.stringify({ t: 'login', name: 'Kain', password: 'secret123', mode: 'login' }));
    const list = (await nextOfType(second, 'characters')) as { list: Array<{ id: number }> };
    const id = list.list[0]?.id;
    expect(id).toBeDefined();

    // The login picker asks for the channels of that character's map.
    second.send(JSON.stringify({ t: 'channels', id: id as number }));
    const channels = (await nextOfType(second, 'channels')) as {
      map: string;
      list: Array<{ channel: number; players: number }>;
    };
    expect(channels.map).toBe('greenfield');
    expect(channels.list).toHaveLength(2);

    // Enter on channel 2.
    second.send(JSON.stringify({ t: 'select', id: id as number, channel: 2 }));
    const chosen = await nextOfType(second, 'welcome');
    expect(chosen['channel']).toBe(2);
    expect(chosen['channelCount']).toBe(2);

    // And switch back to 1 without leaving the world.
    second.send(JSON.stringify({ t: 'switchChannel', channel: 1 }));
    const switched = await nextOfType(second, 'channel');
    expect(switched['channel']).toBe(1);
    expect(switched['count']).toBe(2);

    second.close();
  });

  it('answers a rejected login instead of closing the socket', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    socket.send(JSON.stringify({ t: 'login', name: 'Kain', password: 'test', mode: 'login' }));
    const answer = (await nextMessage(socket)) as Record<string, unknown>;

    expect(answer['t']).toBe('authError');
    expect(String(answer['reason'])).toContain('6');
    expect(socket.readyState).toBe(WebSocket.OPEN);

    // And the same socket can try again.
    socket.send(JSON.stringify({ t: 'login', name: 'Kain', password: 'secret123', mode: 'register' }));
    const characters = (await nextOfType(socket, 'characters')) as Record<string, unknown>;
    expect(characters['t']).toBe('characters');

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

  it('hands out a session token that logs in again without the password', async () => {
    const port = await startServer();
    const first = await openSocket(port);

    first.send(JSON.stringify({ t: 'login', name: 'Kain', password: 'secret123', mode: 'register' }));
    const characters = await nextOfType(first, 'characters');
    const token = characters['token'];
    expect(typeof token).toBe('string');
    first.close();
    await closedWith(first);

    const second = await openSocket(port);
    second.send(JSON.stringify({ t: 'resume', token }));
    const resumed = await nextOfType(second, 'characters');
    expect(resumed['list']).toEqual([]);
    second.close();
  });

  it('refuses a session token that was tampered with', async () => {
    const port = await startServer();
    const socket = await openSocket(port);

    socket.send(JSON.stringify({ t: 'resume', token: 'header.payload.signature' }));
    const error = await nextOfType(socket, 'authError');
    expect(String(error['reason'])).toContain('Session expired');
    socket.close();
  });

  /** Two players on purpose on the same channel (the server spreads them out). */
  const enterTwo = async (): Promise<{ kain: WebSocket; bora: WebSocket; channel: number }> => {
    const port = await startServer({ channels: 2 });
    const kain = await openSocket(port);
    const bora = await openSocket(port);
    const first = await enterAs(kain, 'Kain');
    const second = await enterAs(bora, 'Bora');
    const channel = first['channel'] as number;
    if (second['channel'] !== channel) {
      bora.send(JSON.stringify({ t: 'switchChannel', channel }));
      await nextOfType(bora, 'channel');
    }
    return { kain, bora, channel };
  };

  it('sends map chat to everyone in the same channel', async () => {
    const { kain, bora } = await enterTwo();

    // Listen before sending: ws drops messages that arrive with no listener.
    const onKain = nextOfType(kain, 'chat');
    const onBora = nextOfType(bora, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: 'hallo' }));

    expect(await onKain).toMatchObject({ kind: 'map', from: 'Kain', text: 'hallo' });
    expect(await onBora).toMatchObject({ kind: 'map', from: 'Kain', text: 'hallo' });
  });

  it('keeps map chat in its channel and lets /g cross it', async () => {
    const { kain, bora, channel } = await enterTwo();
    bora.send(JSON.stringify({ t: 'switchChannel', channel: channel === 1 ? 2 : 1 }));
    await nextOfType(bora, 'channel');

    const onKain = nextOfType(kain, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: 'nur kanal eins' }));
    expect(await onKain).toMatchObject({ kind: 'map', text: 'nur kanal eins' });
    await silenceOfType(bora, 'chat', 450);

    const onKainGlobal = nextOfType(kain, 'chat');
    const onBoraGlobal = nextOfType(bora, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: '/g alle' }));
    expect(await onKainGlobal).toMatchObject({ kind: 'global', from: 'Kain', text: 'alle' });
    expect(await onBoraGlobal).toMatchObject({ kind: 'global', from: 'Kain', text: 'alle' });
  });

  it('whispers to one name and tells the sender when nobody has it', async () => {
    const { kain, bora } = await enterTwo();

    const onSystem = nextOfType(kain, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: '/w Niemand hallo' }));
    expect(await onSystem).toMatchObject({ kind: 'system', text: expect.stringContaining('Niemand') });

    // The chat throttle is 400 ms; wait it out between two lines.
    await new Promise((resolve) => setTimeout(resolve, 450));
    const onBora = nextOfType(bora, 'chat');
    const onKain = nextOfType(kain, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: '/w bora geheim' }));

    expect(await onBora).toMatchObject({
      kind: 'whisper',
      from: 'Kain',
      to: 'Bora',
      text: 'geheim',
    });
    expect(await onKain).toMatchObject({ kind: 'whisper', to: 'Bora', text: 'geheim' });
  });

  it('throttles chat', async () => {
    const { kain } = await enterTwo();

    const onFirst = nextOfType(kain, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: 'eins' }));
    expect(await onFirst).toMatchObject({ text: 'eins' });

    const onThrottle = nextOfType(kain, 'chat');
    kain.send(JSON.stringify({ t: 'chat', text: 'zwei' }));
    expect(await onThrottle).toMatchObject({ kind: 'system', text: expect.stringContaining('Langsamer') });
  });

  it('spends a stat point and reports it in the next snapshot', async () => {
    const port = await startServer();
    const kain = await openSocket(port);
    const welcome = await enterAs(kain, 'Kain');
    const id = welcome['id'] as number;

    kain.send(JSON.stringify({ t: 'spendStat', stat: 'vit' }));

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const message = await nextOfType(kain, 'snapshot');
      const players = (message['players'] ?? []) as Array<Record<string, unknown>>;
      const self = players.find((entry) => entry['id'] === id);
      if (self === undefined) continue;
      const stats = self['stats'] as { vit?: number } | undefined;
      if (stats?.vit === 1) {
        expect(self['points']).toBe(5);
        return;
      }
    }
    throw new Error('no snapshot with the spent point');
  });
});

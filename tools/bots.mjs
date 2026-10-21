// Connects N bots and lets them play, to see what the server does under load.
//
//   node tools/seed-bots.mjs 100      # once, server stopped
//   node tools/bots.mjs 100 60        # 100 bots, 60 seconds
//
// Every bot logs in, picks its character, then walks in random directions,
// swings and pings. The tool prints snapshots per second, bandwidth and ping,
// and finally the server's own /status numbers.

import WebSocket from 'ws';

const count = Number(process.argv[2] ?? 20);
const seconds = Number(process.argv[3] ?? 60);
const host = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? 3000);
const password = 'botpass123';

if (!Number.isInteger(count) || count < 1) {
  console.error('usage: node tools/bots.mjs <count> [seconds]');
  process.exit(1);
}

/** Same order as DIR_VECTORS in shared/movement. */
const DIRECTIONS = [
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
];

let inWorld = 0;
let closed = 0;
let snapshots = 0;
let snapshotBytes = 0;
let pongs = 0;
let authErrors = 0;
const latencies = [];

const statusUrl = `http://${host}:${port}/status`;

const readStatus = async () => {
  try {
    const response = await fetch(statusUrl);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

const bots = [];

for (let index = 1; index <= count; index += 1) {
  const name = `bot${index}`;
  const socket = new WebSocket(`ws://${host}:${port}/ws`);
  const bot = { name, socket, playing: false, timer: null, ticks: 0 };
  bots.push(bot);

  socket.on('open', () => {
    socket.send(JSON.stringify({ t: 'login', name, password, mode: 'login' }));
  });

  socket.on('message', (data) => {
    const text = data.toString();
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }

    switch (message.t) {
      case 'characters':
        if (Array.isArray(message.list) && message.list.length > 0) {
          socket.send(JSON.stringify({ t: 'select', id: message.list[0].id }));
        }
        break;

      case 'welcome':
        bot.playing = true;
        inWorld += 1;
        bot.timer = setInterval(() => play(bot), 500);
        break;

      case 'snapshot':
        snapshots += 1;
        snapshotBytes += text.length;
        break;

      case 'pong':
        pongs += 1;
        latencies.push(Math.max(0, Date.now() - bot.lastPing));
        break;

      case 'authError':
        authErrors += 1;
        if (authErrors <= 3) console.error(`${name}: ${message.reason}`);
        break;
    }
  });

  socket.on('close', () => {
    closed += 1;
    if (bot.playing) inWorld -= 1;
    bot.playing = false;
    if (bot.timer !== null) clearInterval(bot.timer);
  });

  socket.on('error', () => {
    // The close handler reports it.
  });
}

function play(bot) {
  if (!bot.playing) return;

  bot.ticks += 1;
  const [dx, dy] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];

  bot.socket.send(JSON.stringify({ t: 'input', dx, dy }));
  if (Math.random() < 0.6) bot.socket.send(JSON.stringify({ t: 'attack' }));

  if (bot.ticks % 4 === 0) {
    bot.lastPing = Date.now();
    bot.socket.send(JSON.stringify({ t: 'ping', at: 0 }));
  }
}

const average = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

let lastSnapshots = 0;
let lastBytes = 0;
const report = setInterval(async () => {
  const snapshotsPerSecond = (snapshots - lastSnapshots) / 5;
  const bytesPerSecond = (snapshotBytes - lastBytes) / 5;
  lastSnapshots = snapshots;
  lastBytes = snapshotBytes;

  const status = await readStatus();
  const tick = status === null ? '-' : `${status.tickMs}/${status.tickMsMax}`;
  const shards =
    status === null
      ? '-'
      : (status.shards ?? []).map((shard) => `${shard.players}p ${shard.tickMs}/${shard.tickMsMax}`).join(' | ') || '-';

  console.log(
    `in world ${inWorld}/${count}  snapshots ${snapshotsPerSecond.toFixed(1)}/s  ` +
      `traffic ${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s  ` +
      `ping ${average(latencies.slice(-200)).toFixed(0)}ms  main ${tick}ms  shards ${shards}`,
  );
  latencies.length = 0;
}, 5000);

const before = await readStatus();
console.log(`bots: ${count}, ${seconds}s against ${host}:${port}`);
console.log('status before:', JSON.stringify(before));

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

clearInterval(report);
const after = await readStatus();
console.log('status under load:', JSON.stringify(after));

for (const bot of bots) {
  if (bot.timer !== null) clearInterval(bot.timer);
  bot.playing = false;
  try {
    bot.socket.close();
  } catch {
    // Already gone.
  }
}

console.log(
  `summary: in world ${inWorld}/${count}, closed ${closed}, snapshots ${snapshots}, ` +
    `avg snapshot ${(snapshotBytes / Math.max(1, snapshots)).toFixed(0)} B, ` +
    `pings ${pongs}, auth errors ${authErrors}`,
);

setTimeout(() => process.exit(0), 300);

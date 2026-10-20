// Development runner.
//
// Builds the packages once, then keeps four processes alive:
//   shared  – TypeScript watch (the server imports compiled output)
//   server  – TypeScript watch
//   node    – the game server itself, restarted on change
//   client  – Vite dev server with hot reload
//
// Ctrl+C stops everything. Nothing here is needed in production.

import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const running = [];

const start = (label, args) => {
  const child = spawn(npmCommand, args, { stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] ${label} stopped with exit code ${code}`);
  });
  running.push(child);
  return child;
};

const runOnce = (label, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });

const shutdown = () => {
  for (const child of running) child.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await runOnce('shared build', ['run', 'build', '--workspace', '@lumiis/shared']);
  await runOnce('server build', ['run', 'build', '--workspace', '@lumiis/server']);
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

start('shared watch', ['run', 'watch', '--workspace', '@lumiis/shared']);
start('server watch', ['run', 'watch', '--workspace', '@lumiis/server']);
start('server', ['run', 'watch:run', '--workspace', '@lumiis/server']);
start('client', ['run', 'dev', '--workspace', '@lumiis/client']);

console.log('[dev] server on http://localhost:3000, client with hot reload on http://localhost:5173');

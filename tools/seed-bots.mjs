// Creates N bot accounts with one character each, straight in the database.
//
//   node tools/seed-bots.mjs 100
//
// Stop the game server first: two writers on one SQLite file fight each other.
// The password is fixed so tools/bots.mjs can log in without asking.

import { Store } from '../packages/server/dist/store/db.js';

const count = Number(process.argv[2] ?? 50);
if (!Number.isInteger(count) || count < 1) {
  console.error('usage: node tools/seed-bots.mjs <count>');
  process.exit(1);
}

const dbFile = process.env['DB'] ?? new URL('../data/lumiis.db', import.meta.url).pathname;
const password = 'botpass123';

const store = new Store(dbFile);
let created = 0;

try {
  for (let index = 1; index <= count; index += 1) {
    const name = `bot${index}`;
    const account = await store.register(name, password);
    if (!account.ok) continue;
    store.createCharacter(account.accountId, name);
    created += 1;
  }
} finally {
  store.close();
}

console.log(`seeded ${created} bots in ${dbFile} (password "${password}")`);

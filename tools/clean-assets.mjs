// Moves every file under packages/client/public/assets that the game does not use into an archive folder.
//
//   node tools/clean-assets.mjs            # dry run: lists what would move
//   node tools/clean-assets.mjs --move     # moves them to ../lumiis-assets-archiv/ (same sub-paths)
//
// "Used" means referenced by the game's data or code:
//   - every sheet of every style pack in styles.json (check-art.mjs styleSheets), plus the packs' rows files
//   - item icons (items.ts `icon`) and monster sheets (monsters.ts `look`)
//   - literal "/assets/..." paths in the client sources (e.g. the row tables in world-scene.ts)
// Nothing is deleted: to undo, move the files back from the archive.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_KEYS, itemDef, MONSTER_KEYS, MONSTER_TYPES } from '../packages/shared/dist/index.js';
import { styleSheets } from './check-art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const PUBLIC_DIR = join(ROOT, 'packages', 'client', 'public');
const ASSETS = join(PUBLIC_DIR, 'assets');
const ARCHIVE = resolve(ROOT, '..', 'lumiis-assets-archiv');
const SRC = join(ROOT, 'packages', 'client', 'src');

const used = new Set();
const use = (url) => used.add(url.replace(/^\//, ''));

// Style packs.
const styles = JSON.parse(readFileSync(join(SRC, 'styles.json'), 'utf8'));
for (const pack of Object.values(styles.packs)) {
  for (const sheet of styleSheets(pack)) use(sheet.path);
  if (typeof pack.rows === 'string') use(pack.rows);
}

// Items and monsters.
for (const key of ITEM_KEYS) {
  const icon = itemDef(key).icon;
  if (icon) use(`/assets/icons/${icon}`);
}
for (const key of MONSTER_KEYS) use(`/assets/monster/${MONSTER_TYPES[key].look}.png`);

// Literal paths in the client sources and pages.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const sources = [...walk(SRC), join(ROOT, 'packages', 'client', 'index.html')];
for (const file of sources) {
  for (const match of readFileSync(file, 'utf8').matchAll(/["'`](\/assets\/[^"'`$]+?\.(?:png|json|webp|jpg|mp3|ogg))["'`]/g)) {
    if (!match[1].includes('{')) use(match[1]);
  }
}

// Everything on disk that nobody uses.
const files = walk(ASSETS).map((file) => relative(PUBLIC_DIR, file).split('\\').join('/'));
const unused = files.filter((file) => !used.has(file));
const missing = [...used].filter((file) => !existsSync(join(PUBLIC_DIR, file)));

const size = (list) => list.reduce((sum, file) => sum + statSync(join(PUBLIC_DIR, file)).size, 0);
console.log(`used: ${files.length - unused.length} files, unused: ${unused.length} files (${Math.round(size(unused) / 1024)} KB)`);
if (missing.length > 0) {
  console.log(`\nreferenced but missing (${missing.length}):`);
  for (const file of missing) console.log(`  ${file}`);
}

if (!process.argv.includes('--move')) {
  const folders = new Map();
  for (const file of unused) {
    const folder = file.split('/').slice(0, 3).join('/');
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  console.log('\nwould move (by folder):');
  for (const [folder, count] of [...folders].sort()) console.log(`  ${String(count).padStart(4)}  ${folder}`);
  console.log('\nrun with --move to move them to', ARCHIVE);
  process.exit(0);
}

for (const file of unused) {
  const target = join(ARCHIVE, file);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(PUBLIC_DIR, file), target);
}
// Remove folders left empty.
const prune = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) prune(join(dir, entry.name));
  if (dir !== ASSETS && readdirSync(dir).length === 0) rmdirSync(dir);
};
prune(ASSETS);
console.log(`moved ${unused.length} files to ${ARCHIVE}`);

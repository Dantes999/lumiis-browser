// Watches the asset folders and re-checks every sheet after each save.
//
//   node tools/watch-art.mjs
//
// Keep it in a second terminal while drawing: every save prints the grid,
// anchor, empty-frame, edge and layer-alignment problems of the changed pack
// and the monster sheets. Ctrl+C stops it.
//
// The Vite dev server (npm run dev) already reloads the game page when a file
// under public/ changes, so the browser shows the new frame right away.

import { watch } from 'node:fs';
import { join, relative } from 'node:path';
import { checkAll, checkMonsters, ROOT } from './check-art.mjs';

const ASSETS = join(ROOT, 'packages', 'client', 'public', 'assets');
const DEBOUNCE_MS = 250;

let timer;
let runs = 0;

function report() {
  const startedAt = Date.now();
  const packs = checkAll();
  const monsters = checkMonsters();
  const errors = [...packs.flatMap((pack) => pack.errors), ...monsters.errors];
  const warnings = [...packs.flatMap((pack) => pack.warnings), ...monsters.warnings];
  const stamp = new Date().toLocaleTimeString('de-DE', { hour12: false });
  runs += 1;

  console.log(`\n[${stamp}] Prüfung #${runs} — ${Date.now() - startedAt} ms`);
  if (errors.length === 0 && warnings.length === 0) {
    console.log('  alles ok');
    return;
  }
  for (const error of errors) console.log(`  FEHLER  ${error}`);
  for (const warning of warnings) console.log(`  ~       ${warning}`);
  console.log(`  ${errors.length} Fehler, ${warnings.length} Hinweis(e)`);
}

function schedule(file) {
  if (file !== null && !/\.(png|json)$/i.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(report, DEBOUNCE_MS);
}

console.log(`beobachte ${relative(ROOT, ASSETS)} (Ctrl+C beendet)`);
report();

try {
  watch(ASSETS, { recursive: true }, (_event, file) => schedule(file ?? null));
} catch (error) {
  console.error(`rekursives Beobachten nicht möglich (${error.message}); beobachte nur die Ordner`);
  for (const folder of ['body', 'head', 'hair', 'armor', 'weapon', 'monster']) {
    watch(join(ASSETS, folder), (_event, file) => schedule(file ?? null));
  }
}

// Checks the sprite sheets of a graphic style pack.
//
//   node tools/check-art.mjs                    # every pack in styles.json
//   node tools/check-art.mjs krieger_m          # one pack
//   node tools/check-art.mjs some.png --cell=48 --columns=9
//
// A sheet must be `cell * columns` pixels wide and a whole number of cells
// high. Rows are looked up by name at runtime, so the height only has to match
// the row table (the tool prints how many rows it found).
//
// No image library: the width and height sit in the PNG header.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_KEYS, itemDef } from '../packages/shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');
const STYLES_FILE = join(ROOT, 'packages', 'client', 'src', 'styles.json');
const PUBLIC_DIR = join(ROOT, 'packages', 'client', 'public');

/** Width and height from a PNG header. */
export function pngSize(file) {
  const data = readFileSync(file);
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Maps a `/assets/...` URL to the file on disk. */
export const assetFile = (url) => join(PUBLIC_DIR, url.replace(/^\//, ''));

/** One sheet: does it exist, and does its grid match the pack? */
export function checkSheet(file, cell, columns) {
  if (!existsSync(file)) return { file, errors: ['missing'], rows: 0, width: 0, height: 0 };

  let size;
  try {
    size = pngSize(file);
  } catch (error) {
    return { file, errors: [error.message], rows: 0, width: 0, height: 0 };
  }

  const errors = [];
  if (size.width !== cell * columns) errors.push(`width ${size.width}, expected ${cell * columns}`);
  if (size.height % cell !== 0) errors.push(`height ${size.height} is not a multiple of ${cell}`);

  return { file, errors, rows: Math.floor(size.height / cell), width: size.width, height: size.height };
}

/** Every sheet a pack needs for the current item table. */
export function styleSheets(pack) {
  const sheets = [];
  const add = (list, single, prefix) => {
    if (Array.isArray(list) && list.length > 0) {
      for (const part of list) sheets.push({ key: `${prefix}_${part.id}`, path: part.sheet });
    } else if (typeof single === 'string' && single !== '') {
      sheets.push({ key: `${prefix}_default`, path: single });
    }
  };
  add(pack.bodies, pack.body, 'body');
  add(pack.heads, pack.head, 'head');
  add(pack.hairs, pack.hair, 'hair');

  for (const key of ITEM_KEYS) {
    const def = itemDef(key);
    if (def.armorFile !== undefined) {
      sheets.push({ key: `armor_${def.armorFile}`, path: pack.armor.replace('{file}', def.armorFile) });
    }
    if (def.weaponArt !== undefined && def.stage !== undefined) {
      sheets.push({
        key: `weapon_${def.weaponArt}_${def.stage}`,
        path: pack.weapon
          .replace('{art}', def.weaponArt)
          .replace('{stage2}', String(def.stage).padStart(2, '0')),
      });
    }
  }

  return sheets;
}

/** Checks one pack from styles.json. */
export function checkPack(id, pack) {
  const sheets = styleSheets(pack).map((sheet) => ({
    key: sheet.key,
    url: sheet.path,
    ...checkSheet(assetFile(sheet.path), pack.cell, pack.columns),
  }));

  const errors = sheets.flatMap((sheet) =>
    sheet.errors.map((error) => `${sheet.key} (${sheet.url}): ${error}`),
  );

  return { id, name: pack.name, cell: pack.cell, columns: pack.columns, sheets, errors };
}

/** Reads styles.json and checks every pack in it. */
export function checkAll() {
  const styles = JSON.parse(readFileSync(STYLES_FILE, 'utf8'));
  return Object.entries(styles.packs).map(([id, pack]) => checkPack(id, pack));
}

// ---------------------------------------------------------------- command line
const isCommandLine =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCommandLine) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const hit = args.find((arg) => arg.startsWith(`--${name}=`));
    return hit === undefined ? fallback : Number(hit.split('=')[1]);
  };

  const sheetArg = args.find((arg) => !arg.startsWith('--'));
  const packIds = new Set(
    Object.keys(JSON.parse(readFileSync(STYLES_FILE, 'utf8')).packs),
  );

  if (sheetArg !== undefined && !packIds.has(sheetArg)) {
    // Single file: only the grid can be checked, not the pack.
    const cell = flag('cell', 48);
    const columns = flag('columns', 9);
    const result = checkSheet(resolve(sheetArg), cell, columns);
    const name = sheetArg.split('/').pop() ?? sheetArg;
    console.log(
      `${result.errors.length === 0 ? 'ok  ' : 'FAIL'} ${name}: ` +
        `${result.width}x${result.height}, ${result.rows} rows of ${cell}px, ${columns} columns`,
    );
    for (const error of result.errors) console.log(`     ${error}`);
    process.exit(result.errors.length === 0 ? 0 : 1);
  }

  const reports = sheetArg === undefined ? checkAll() : [checkAll().find((r) => r.id === sheetArg)].filter(Boolean);
  let failed = 0;

  for (const report of reports) {
    console.log(`\n${report.id} — ${report.name} (${report.cell}px, ${report.columns} columns)`);
    for (const sheet of report.sheets) {
      const status = sheet.errors.length === 0 ? 'ok  ' : 'FAIL';
      console.log(
        `  ${status} ${sheet.key}: ${sheet.rows} rows` +
          (sheet.errors.length === 0 ? '' : ` — ${sheet.errors.join('; ')}`),
      );
    }
    if (report.errors.length > 0) failed += 1;
  }

  console.log(failed === 0 ? '\nall sheets ok' : `\n${failed} pack(s) with problems`);
  process.exit(failed === 0 ? 0 : 1);
}

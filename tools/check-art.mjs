// Checks the sprite sheets of the graphic packs and the monster sheets.
//
//   node tools/check-art.mjs                    # every pack and every monster
//   node tools/check-art.mjs pixel              # one pack
//   node tools/check-art.mjs some.png --cell=48 --columns=9
//
// Hard errors: a sheet is missing, not a PNG, or its grid does not match.
// Warnings (artistic, never fail the build): a body frame is empty, feet off
// the ground line, a layer that never touches the body, a body that does not
// move across the nine columns.
//
// No image library: the PNG is decoded by hand (8-bit, non-interlaced), which
// covers everything Aseprite and our tools write.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { ITEM_KEYS, itemDef, MONSTER_KEYS, MONSTER_TYPES } from '../packages/shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');
const STYLES_FILE = join(ROOT, 'packages', 'client', 'src', 'styles.json');
const PUBLIC_DIR = join(ROOT, 'packages', 'client', 'public');

/** Anything below this alpha counts as transparent (kills anti-alias crumbs). */
const OPAQUE = 8;

/** Mesh grid of the monster sheets, mirrors client/src/mobart.ts. */
const MOB = { cellW: 40, cellH: 32, frames: 5, views: 4, footY: 29 };

/** Width and height from a PNG header. */
export function pngSize(file) {
  const data = readFileSync(file);
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/**
 * Decodes an 8-bit, non-interlaced PNG into RGBA bytes.
 * Returns null for formats this tool does not read instead of guessing.
 */
export function decodePng(file) {
  const fileData = readFileSync(file);
  if (fileData.length < 8 || fileData.readUInt32BE(0) !== 0x89504e47) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  while (offset + 8 <= fileData.length) {
    const length = fileData.readUInt32BE(offset);
    const type = fileData.toString('ascii', offset + 4, offset + 8);
    const body = fileData.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }

  if (bitDepth !== 8 || interlace !== 0) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) return null;

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (width * channels + 1)) return null;

  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let position = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const current = new Uint8Array(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const above = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += (left + above) >> 1;
      else if (filter === 4) {
        const estimate = left + above - corner;
        const dl = Math.abs(estimate - left);
        const da = Math.abs(estimate - above);
        const dc = Math.abs(estimate - corner);
        value += dl <= da && dl <= dc ? left : da <= dc ? above : corner;
      }
      current[x] = value & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (colorType === 6) {
        data[target] = current[x * 4];
        data[target + 1] = current[x * 4 + 1];
        data[target + 2] = current[x * 4 + 2];
        data[target + 3] = current[x * 4 + 3];
      } else if (colorType === 2) {
        data[target] = current[x * 3];
        data[target + 1] = current[x * 3 + 1];
        data[target + 2] = current[x * 3 + 2];
        data[target + 3] = 255;
      } else if (colorType === 0) {
        data[target] = current[x];
        data[target + 1] = current[x];
        data[target + 2] = current[x];
        data[target + 3] = 255;
      } else if (colorType === 4) {
        data[target] = current[x * 2];
        data[target + 1] = current[x * 2];
        data[target + 2] = current[x * 2];
        data[target + 3] = current[x * 2 + 1];
      } else if (colorType === 3 && palette !== null) {
        const index = current[x];
        data[target] = palette[index * 3] ?? 0;
        data[target + 1] = palette[index * 3 + 1] ?? 0;
        data[target + 2] = palette[index * 3 + 2] ?? 0;
        data[target + 3] = trns !== null && index < trns.length ? trns[index] : 255;
      }
    }

    previous = current;
  }

  return { width, height, data };
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

/** Bounding box of one cell, plus a cheap hash so identical frames can be spotted. */
function frameInfo(image, cell, view, column) {
  const { data, width } = image;
  const x0 = column * cell;
  const y0 = view * cell;
  let minX = cell;
  let minY = cell;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  let hash = 0x811c9dc5;

  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const index = ((y0 + y) * width + (x0 + x)) * 4;
      const alpha = data[index + 3];
      if (alpha > OPAQUE) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hash ^= (data[index] << 16) ^ (data[index + 1] << 8) ^ data[index + 2] ^ alpha;
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }

  return { empty: count === 0, count, minX, minY, maxX, maxY, hash: hash >>> 0 };
}

const overlaps = (a, b, margin = 1) =>
  !a.empty &&
  !b.empty &&
  a.minX <= b.maxX + margin &&
  a.maxX >= b.minX - margin &&
  a.minY <= b.maxY + margin &&
  a.maxY >= b.minY - margin;

/**
 * Artistic checks of one pack: feet on the ground line, empty frames, layers
 * that miss the body, a body that never moves.
 */
function analyzePack(pack, sheets) {
  const warnings = [];
  const byPrefix = (prefix) => sheets.filter((sheet) => sheet.key.startsWith(`${prefix}_`));
  const bodies = byPrefix('body');
  const heads = byPrefix('head');
  const hairs = byPrefix('hair');
  const armors = byPrefix('armor');
  const weapons = byPrefix('weapon');

  /** Decoded frames per sheet key, so the layer test can compare boxes. */
  const boxes = new Map();

  for (const sheet of sheets) {
    if (sheet.errors.length > 0) continue;
    const image = decodePng(sheet.file);
    if (image === null) {
      sheet.warnings.push('format not readable (needs 8-bit, non-interlaced) — checks skipped');
      continue;
    }
    const views = sheet.rows;
    const frames = [];
    for (let view = 0; view < views; view += 1) {
      const row = [];
      for (let column = 0; column < pack.columns; column += 1) {
        row.push(frameInfo(image, pack.cell, view, column));
      }
      frames.push(row);
    }
    sheet.frames = frames;
    boxes.set(sheet.key, frames);
  }

  for (const sheet of sheets) {
    const frames = sheet.frames;
    if (frames === undefined) continue;
    const kind = sheet.key.split('_')[0];
    const isBody = kind === 'body';
    const emptyFrames = [];
    const lowFeet = [];
    const touchingEdges = [];

    for (let view = 0; view < frames.length; view += 1) {
      for (let column = 0; column < pack.columns; column += 1) {
        const info = frames[view][column];
        const label = `${['unten', 'rechts', 'oben'][view] ?? `Zeile ${view}`}, Spalte ${column}`;
        if (info.empty) {
          // Weapons may be hidden behind the body; other layers should be drawn.
          if (kind !== 'weapon') emptyFrames.push(label);
          continue;
        }
        if (isBody) lowFeet.push({ lowest: info.maxY + 1, label });
        // Pixels on the cell border are probably clipped (the ground line is
        // below the cell, so the bottom edge is allowed).
        if (info.minX <= 0 || info.maxX >= pack.cell - 1 || info.minY <= 0) {
          touchingEdges.push(label);
        }
      }
    }

    if (emptyFrames.length > 0) {
      const text = `${emptyFrames.length} leere Frame(s), z. B. ${emptyFrames[0]}`;
      if (isBody) sheet.errors.push(text);
      else sheet.warnings.push(text);
    }

    if (touchingEdges.length > 0) {
      sheet.warnings.push(
        `${touchingEdges.length} Frame(s) berühren den Kachelrand (abgeschnitten?), z. B. ${touchingEdges[0]}`,
      );
    }

    if (isBody) {
      const off = lowFeet.filter((entry) => Math.abs(entry.lowest - pack.footY) > 2);
      if (off.length > 0) {
        const range = `${Math.min(...off.map((entry) => entry.lowest))}..${Math.max(...off.map((entry) => entry.lowest))}`;
        sheet.warnings.push(
          `Füße bei y=${range}, erwartet ${pack.footY} (${off.length} Frame(s), z. B. ${off[0].label})`,
        );
      }
    }
  }

  // A body whose nine columns are pixel-identical never animates.
  for (const body of bodies) {
    const frames = boxes.get(body.key);
    if (frames === undefined) continue;
    const staticViews = [];
    for (let view = 0; view < frames.length; view += 1) {
      const first = frames[view][0];
      if (first.empty) continue;
      if (frames[view].every((frame) => frame.hash === first.hash)) staticViews.push(view);
    }
    if (staticViews.length > 0 && pack.columns > 1) {
      body.warnings.push(
        `Spalten 1–${pack.columns - 1} sind identisch (keine Animation) in Ansicht ${staticViews.join(', ')}`,
      );
    }
  }

  // Every overlay should touch the body it is worn on, in the same pose.
  const overlayChecks = [
    ...heads.map((sheet) => ({ sheet, margin: 2, name: 'Kopf' })),
    ...hairs.map((sheet) => ({ sheet, margin: 2, name: 'Haare' })),
    ...armors.map((sheet) => ({ sheet, margin: 2, name: 'Rüstung' })),
    ...weapons.map((sheet) => ({ sheet, margin: 6, name: 'Waffe' })),
  ];

  // Bodies share one rig; a head/hairstyle is compared to its own body when the
  // id matches (warrior_f_1 -> warrior_f), everything else to the first body.
  const reference = bodies.find((body) => !body.key.endsWith('_default')) ?? bodies[0];
  const bodyFrames = reference === undefined ? undefined : boxes.get(reference.key);
  const byKey = new Map(sheets.map((sheet) => [sheet.key, boxes.get(sheet.key)]));
  /** The layer each overlay must touch: hair its head, head/armour the body. */
  const partnerFor = (sheet) => {
    const kind = sheet.key.split('_')[0];
    const id = sheet.key.replace(/^(head|hair|armor|weapon)_/, '');
    const candidates =
      kind === 'hair'
        ? [`head_${id}`, `head_${id.replace(/_[12]$/, '')}`]
        : kind === 'head'
          ? [`body_${id}`, `body_${id.replace(/_[12]$/, '')}`]
          : [];
    for (const key of candidates) {
      const frames = byKey.get(key);
      if (frames !== undefined) return { key, frames };
    }
    if (kind === 'hair') return undefined;
    return reference === undefined || bodyFrames === undefined
      ? undefined
      : { key: reference.key, frames: bodyFrames };
  };

  if (bodyFrames !== undefined) {
    for (const { sheet, margin, name } of overlayChecks) {
      const frames = boxes.get(sheet.key);
      if (frames === undefined) continue;
      const partner = partnerFor(sheet);
      if (partner === undefined) continue;
      const otherFrames = partner.frames;
      const weapon = sheet.key.startsWith('weapon_');
      let misses = 0;
      let example = '';
      for (let view = 0; view < otherFrames.length; view += 1) {
        for (let column = 0; column < pack.columns; column += 1) {
          const bodyFrame = otherFrames[view][column];
          const frame = frames[weapon ? view + 3 : view]?.[column];
          if (frame === undefined || frame.empty || bodyFrame.empty) continue;
          if (!overlaps(bodyFrame, frame, margin)) {
            misses += 1;
            if (example === '') example = `Ansicht ${view}, Spalte ${column}`;
          }
        }
      }
      if (misses > 0) {
        sheet.warnings.push(
          `${name} berührt ${partner.key} nicht in ${misses} Frame(s), z. B. ${example}`,
        );
      }
    }
  }

  return { warnings };
}

/** Checks one pack from styles.json. */
export function checkPack(id, pack) {
  const sheets = styleSheets(pack).map((sheet) => ({
    key: sheet.key,
    url: sheet.path,
    warnings: [],
    frames: undefined,
    ...checkSheet(assetFile(sheet.path), pack.cell, pack.columns),
  }));

  const analyzed = analyzePack(pack, sheets);
  const errors = sheets.flatMap((sheet) =>
    sheet.errors.map((error) => `${sheet.key} (${sheet.url}): ${error}`),
  );
  const warnings = [
    ...analyzed.warnings,
    ...sheets.flatMap((sheet) => sheet.warnings.map((warning) => `${sheet.key}: ${warning}`)),
  ];

  return { id, name: pack.name, cell: pack.cell, columns: pack.columns, sheets, errors, warnings };
}

/** Reads styles.json and checks every pack in it. */
export function checkAll() {
  const styles = JSON.parse(readFileSync(STYLES_FILE, 'utf8'));
  return Object.entries(styles.packs).map(([id, pack]) => checkPack(id, pack));
}

/**
 * Monster sheets: 40x32 cells, four views (down, left, right, up), five frames.
 * Feet sit at (20, 29); a frame whose lowest pixel is far above that floats.
 */
export function checkMonsters() {
  const sheets = [];
  const errors = [];
  const warnings = [];

  for (const key of MONSTER_KEYS) {
    const url = `/assets/monster/${MONSTER_TYPES[key].look}.png`;
    const file = assetFile(url);
    const entry = { key: `mob_${key}`, url, warnings: [], frames: undefined };
    sheets.push(entry);

    if (!existsSync(file)) {
      entry.errors = ['missing'];
      errors.push(`${entry.key} (${url}): missing`);
      continue;
    }

    const size = pngSize(file);
    entry.width = size.width;
    entry.height = size.height;
    entry.errors = [];
    if (size.width !== MOB.cellW * MOB.frames) {
      entry.errors.push(`width ${size.width}, expected ${MOB.cellW * MOB.frames}`);
    }
    if (size.height !== MOB.cellH * MOB.views) {
      entry.errors.push(`height ${size.height}, expected ${MOB.cellH * MOB.views}`);
    }
    for (const error of entry.errors) errors.push(`${entry.key} (${url}): ${error}`);
    if (entry.errors.length > 0) continue;

    const image = decodePng(file);
    if (image === null) {
      entry.warnings.push('format not readable — frame checks skipped');
      warnings.push(`${entry.key}: format not readable`);
      continue;
    }

    const frames = [];
    for (let view = 0; view < MOB.views; view += 1) {
      const row = [];
      for (let column = 0; column < MOB.frames; column += 1) {
        row.push(monsterFrame(image, view, column));
      }
      frames.push(row);
    }
    entry.frames = frames;

    for (let view = 0; view < MOB.views; view += 1) {
      for (let column = 0; column < MOB.frames; column += 1) {
        const info = frames[view][column];
        const label = `${entry.key}: Ansicht ${view}, Bild ${column}`;
        if (info.empty) {
          entry.warnings.push(`${label} ist leer`);
          warnings.push(`${label} ist leer`);
          continue;
        }
        const lowest = info.maxY + 1;
        if (lowest < MOB.footY - 2) {
          entry.warnings.push(`${label}: Füße bei y=${lowest}, erwartet ${MOB.footY} (schwebt)`);
          warnings.push(`${label}: Füße bei y=${lowest}, erwartet ${MOB.footY} (schwebt)`);
        }
      }
    }
  }

  return { cellW: MOB.cellW, cellH: MOB.cellH, views: MOB.views, frames: MOB.frames, sheets, errors, warnings };
}

/** Bounding box of one monster cell (40 wide, 32 high). */
function monsterFrame(image, view, column) {
  const { data, width } = image;
  const x0 = column * MOB.cellW;
  const y0 = view * MOB.cellH;
  let minX = MOB.cellW;
  let minY = MOB.cellH;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < MOB.cellH; y += 1) {
    for (let x = 0; x < MOB.cellW; x += 1) {
      const index = ((y0 + y) * width + (x0 + x)) * 4;
      if (data[index + 3] > OPAQUE) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return { empty: count === 0, count, minX, minY, maxX, maxY };
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
  const packIds = new Set(Object.keys(JSON.parse(readFileSync(STYLES_FILE, 'utf8')).packs));

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
      for (const warning of sheet.warnings) console.log(`       ~ ${warning}`);
    }
    if (report.errors.length > 0) failed += 1;
  }

  let monstersReport;
  if (sheetArg === undefined) {
    const monsters = checkMonsters();
    monstersReport = monsters;
    console.log(`\nmonster — ${monsters.cellW}x${monsters.cellH}, ${monsters.views} views x ${monsters.frames} frames`);
    for (const sheet of monsters.sheets) {
      const status = (sheet.errors ?? []).length === 0 ? 'ok  ' : 'FAIL';
      console.log(`  ${status} ${sheet.key}: ${sheet.width ?? 0}x${sheet.height ?? 0}`);
      for (const warning of sheet.warnings) console.log(`       ~ ${warning}`);
    }
    if (monsters.errors.length > 0) failed += 1;
  }

  const warnings =
    reports.reduce((sum, report) => sum + report.warnings.length, 0) +
    (typeof monstersReport === 'undefined' ? 0 : monstersReport.warnings.length);
  console.log(
    failed === 0
      ? `\nall sheets ok${warnings > 0 ? ` (${warnings} warning(s))` : ''}`
      : `\n${failed} part(s) with problems`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

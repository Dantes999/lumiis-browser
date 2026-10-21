// Bakes the code-drawn player art of lumiis-2d into the layered PNG sheets of the `pixel` style pack.
//
//   node tools/bake-lumiis2d.mjs [path/to/lumiis-2d]      (default: ../lumiis-2d)
//
// lumiis-2d draws each figure as one image (client/pcart/*). This tool copies that code into a temp folder, adds two
// small hooks (hair on/off, raw rasters out) and renders every pose twice, with and without hair. The layers are the
// differences between those renders, so stacking body → armour → head → hair gives back the lumiis-2d picture:
//
//   body   figure without hair, minus the head
//   head   head pixels plus the outline touching them
//   hair   what the hair changes (full render vs. render without hair)
//   armor  what the armour changes (warrior m, armour levels 1–4)
//   weapon back rows = weapon behind the body, front rows = weapon in front (warrior m pose)
//
// Grid as ART.md: 48 × 48 cells, 9 columns, rows down/right/up, feet at (24, 44). lumiis-2d has the same cell and
// anchor; its death frame lies on its back and is the same in every view.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SRC = resolve(process.argv[2] ?? join(ROOT, '..', 'lumiis-2d'));
const OUT = join(ROOT, 'packages', 'client', 'public', 'assets');

const CELL = 48, COLS = 9, VIEWS = [0, 2, 3]; // lumiis-2d views: 0 down, 2 right, 3 up
const DEATH = 8;

// ---------------------------------------------------------------- load lumiis-2d with two hooks
const work = mkdtempSync(join(tmpdir(), 'lumiis2d-'));
cpSync(join(SRC, 'client', 'pcart'), join(work, 'client', 'pcart'), { recursive: true });
cpSync(join(SRC, 'client', 'pcart.js'), join(work, 'client', 'pcart.js'));
cpSync(join(SRC, 'shared', 'costumes.js'), join(work, 'shared', 'costumes.js'));
writeFileSync(join(work, 'package.json'), '{"type":"module"}');

const patch = (file, edits) => {
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!text.includes(from)) throw new Error(`${file}: hook point not found: ${from}`);
    text = text.replace(from, to);
  }
  writeFileSync(file, text);
};
patch(join(work, 'client', 'pcart', 'kit.js'), [
  ['function drawHairTop(f) {', 'export const BAKE = { noHair: false };\nfunction drawHairTop(f) {\n  if (BAKE.noHair) return;'],
  ['function drawHairLayer(f, layer) {', 'function drawHairLayer(f, layer) {\n  if (BAKE.noHair) return;'],
]);
patch(join(work, 'client', 'pcart.js'), [
  ["from '/shared/costumes.js'", "from '../shared/costumes.js'"],
]);
writeFileSync(
  join(work, 'client', 'pcart.js'),
  readFileSync(join(work, 'client', 'pcart.js'), 'utf8') +
    `
// ---- bake hook (tools/bake-lumiis2d.mjs): raw rasters of one pose
export function bakeParts(pal, v, frame) {
  const cls = clsOf(pal);
  const dead = frame === F_DEATH;
  const f = drawFigure(BODY, pal, dead ? V_DOWN : v, frame, cls);
  WB.clear(); WF.clear();
  const k = pal.weapon;
  const hands = [];
  if (k && k !== 'fist') {
    if (dead) {
      weaponInto(WB, pal, k, k === 'twohand' ? [18, 4] : [26, 6], 176, 0, 40);
    } else {
      const pose = f.pose;
      weaponInto(pose.behind ? WB : WF, pal, k, pose.hand, pose.ang, pose.pull, 40);
      f.arms.forEach((a, i) => { if (a.weapon && !pose.behind) hands.push(i ? P.HAND1 : P.HAND0); });
    }
  }
  return { c: BODY.c.slice(), k: BODY.k.slice(), t: BODY.t.slice(), wb: WB.c.slice(), wf: WF.c.slice(), hands, dead };
}
`,
);

const pcart = await import(pathToFileURL(join(work, 'client', 'pcart.js')).href);
const kit = await import(pathToFileURL(join(work, 'client', 'pcart', 'kit.js')).href);
const { HEAD } = kit.P;

// ---------------------------------------------------------------- helpers
/** lumiis-2d death frame: the figure is turned on its back (head to the left). */
function lieDown(buf) {
  const out = new Uint32Array(CELL * CELL);
  for (let Y = 0; Y < CELL; Y++) for (let X = 0; X < CELL; X++) {
    const c = buf[Y * CELL + X];
    if (!c) continue;
    const nx = Y - 2, ny = 54 - X;
    if (nx >= 1 && nx < CELL - 1 && ny >= 1 && ny < 44) out[ny * CELL + nx] = c;
  }
  return out;
}

function render(cls, look, extra, noHair) {
  kit.BAKE.noHair = noHair;
  const pal = { ...pcart.pcLook(cls, look), cls, ...extra };
  const cells = [];
  for (const v of VIEWS) for (let frame = 0; frame < COLS; frame++) cells.push(pcart.bakeParts(pal, v, frame));
  kit.BAKE.noHair = false;
  return cells;
}

/** Which pixels of a hairless render belong to the head (head parts + lines touching them). */
function headMask(p) {
  const mask = new Uint8Array(CELL * CELL);
  for (let i = 0; i < mask.length; i++) {
    if (!p.c[i]) continue;
    if (p.k[i] === HEAD) { mask[i] = 1; continue; }
    if (p.k[i] !== 0 || p.t[i] !== 0) continue; // only outline / seam pixels can join the head
    const x = i % CELL;
    const near = [x > 0 ? i - 1 : -1, x < CELL - 1 ? i + 1 : -1, i - CELL, i + CELL];
    if (near.some((j) => j >= 0 && j < mask.length && p.c[j] && p.k[j] === HEAD)) mask[i] = 1;
  }
  return mask;
}

const finish = (buf, dead) => (dead ? lieDown(buf) : buf);

function layer(cellsList, pick) {
  const sheetRows = cellsList.rows ?? 3;
  const sheet = new Uint32Array(CELL * COLS * CELL * sheetRows);
  cellsList.forEach((buf, n) => {
    if (!buf) return;
    const row = Math.floor(n / COLS), col = n % COLS;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const c = buf[y * CELL + x];
      if (c) sheet[(row * CELL + y) * CELL * COLS + col * CELL + x] = c;
    }
  });
  return sheet;
}

// ---------------------------------------------------------------- PNG writer (RGBA, no dependencies)
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function writePng(file, pixels, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = pixels[y * width + x], o = y * (width * 4 + 1) + 1 + x * 4;
    raw[o] = c & 255; raw[o + 1] = (c >>> 8) & 255; raw[o + 2] = (c >>> 16) & 255; raw[o + 3] = c >>> 24;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`wrote ${file.slice(ROOT.length + 1)}`);
}
const save = (name, sheet, rows = 3) => writePng(join(OUT, name), sheet, CELL * COLS, CELL * rows);

// ---------------------------------------------------------------- bake
const SWORD = { weapon: 'sword', wt: 0 };
const FEMALE = 1 << 16, HAIR2 = 1 << 17;
const CLASSES = { warrior: 'Krieger', ninja: 'Ninja', sura: 'Sura', shaman: 'Schamane' };
const manifest = { bodies: [], heads: [], hairs: [] };

for (const [cls, label] of Object.entries(CLASSES)) {
  for (const [g, gLabel, gBit] of [['m', 'Mann', 0], ['f', 'Frau', FEMALE]]) {
    const id = `${cls}_${g}`;
    const bare = render(cls, gBit, SWORD, true);
    const masks = bare.map(headMask);
    save(`body/${id}.png`, layer(bare.map((p, n) => finish(p.c.map((c, i) => (masks[n][i] ? 0 : c)), p.dead))));
    save(`head/${id}.png`, layer(bare.map((p, n) => finish(p.c.map((c, i) => (masks[n][i] ? c : 0)), p.dead))));
    manifest.bodies.push({ id, name: `${label} (${gLabel})`, sheet: `/assets/body/${id}.png` });
    manifest.heads.push({ id, name: `${label} (${gLabel})`, sheet: `/assets/head/${id}.png` });

    for (const [n, hBit] of [[1, 0], [2, HAIR2]]) {
      const full = render(cls, gBit | hBit, SWORD, false);
      const bareH = hBit ? render(cls, gBit | hBit, SWORD, true) : bare;
      const hid = `${id}_${n}`;
      save(`hair/${hid}.png`, layer(full.map((p, k) => finish(p.c.map((c, i) => (c !== bareH[k].c[i] ? c : 0)), p.dead))));
      manifest.hairs.push({ id: hid, name: `${label} (${gLabel}) ${n}`, sheet: `/assets/hair/${hid}.png` });
    }
  }
}

// Armour overlays (warrior m, levels 1–4 = the four plate armours of the item table).
const ARMORS = ['01_moenchsplattenpanzer', '02_eisenplattenpanzer', '03_tiger_plattenpanzer', '04_loewenplattenpanzer'];
const bareWarrior = render('warrior', 0, SWORD, true);
ARMORS.forEach((file, a) => {
  const dressed = render('warrior', (a + 1) << 3, SWORD, true);
  save(`armor/${file}.png`, layer(dressed.map((p, k) => {
    const mask = headMask(p);
    return finish(p.c.map((c, i) => (c !== bareWarrior[k].c[i] && !mask[i] ? c : 0)), p.dead);
  })));
});

// Weapons: rows 0–2 behind the body, rows 3–5 in front (hands holding the grip stay on top).
const WEAPONS = [
  ['schwert_00', 'sword', 0], ['schwert_02', 'sword', 2], ['schwert_03', 'sword', 3], ['schwert_04', 'sword', 4],
  ['schwert_05', 'sword', 5], ['schwert_06', 'sword', 6], ['zweihand_03', 'twohand', 3],
];
for (const [file, weapon, wt] of WEAPONS) {
  const cells = render('warrior', 0, { weapon, wt }, true);
  const back = cells.map((p) => p.wb);
  const front = cells.map((p) => p.wf.map((c, i) => (c && p.hands.includes(p.k[i]) ? 0 : c)));
  const all = [...back, ...front];
  all.rows = 6;
  save(`weapon/${file}.png`, layer(all), 6);
}

// Register the bodies, heads and hairs in styles.json (pack `pixel`); existing ids are kept.
const STYLES_FILE = join(ROOT, 'packages', 'client', 'src', 'styles.json');
const styles = JSON.parse(readFileSync(STYLES_FILE, 'utf8'));
const pack = styles.packs.pixel;
for (const key of ['bodies', 'heads', 'hairs']) {
  const known = new Set(pack[key].map((entry) => entry.id));
  pack[key].push(...manifest[key].filter((entry) => !known.has(entry.id)));
}
writeFileSync(STYLES_FILE, `${JSON.stringify(styles, null, 2)}\n`);
console.log('updated packages/client/src/styles.json');

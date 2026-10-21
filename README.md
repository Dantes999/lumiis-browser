# Lumiis

A real-time 2D MMORPG that runs in the browser and on phones. Server-authoritative,
tick-based, TypeScript on both sides.

This is a deliberate fresh start: the previous project (`lumiis-2d`) is kept as a
reference for content, balance and artwork, but none of its code is carried over.

## Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) everywhere |
| Server | Node.js 22+, `ws`, fixed 20 Hz loop |
| Client | Phaser 3 for the world, plain HTML/CSS for the interface |
| Build | Vite for the client, `tsc` for shared and server |
| Tests | Vitest |

## Quick start

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

Development with hot reload:

```bash
npm run dev          # client on http://localhost:5173, server on :3000
```

Tests and type checks:

```bash
npm test
npm run typecheck
```

To try it on a phone in the same network, open `http://<your-ip>:3000`. The
server binds to `0.0.0.0` by default; set `HOST` to narrow that.

## Sound

There are no audio files: every sound is generated in the browser with the Web
Audio API (swing, hit, kill, hurt, pickup, level up). The settings panel has a
switch and a volume slider. The browser only starts audio after a click, so the
context is created when the login button is pressed.

## Maps

Start with `CHANNELS=2` to run every map twice (CH1/CH2, like Metin2) and
`SHARDS=2` to spread the worlds over worker threads. With channels on, pick one
when you choose your character (with the player counts) and switch in the HUD.

Three maps ship with the project:

- **`greenfield` (80x80)** – the first real world and the start map: a village
  with a paved square and five houses, a pond with a wooden bridge, woods round
  the edges, and an open field with wolves and boars in the east.
- **`testmap` (64x64)** – the small test map (road, lake, village, grove gate).
- **`grove` (24x24)** – the even smaller test map with a stone circle.

A new character starts on `greenfield` (`START_MAP` in
`packages/shared/src/constants.ts`). The gate south of the east road (tile
36,63) leads to `testmap`, whose own gate at (40,36) leads back; `testmap` also
has a gate to `grove`. Regenerate the maps with `node tools/make-world.mjs`
(greenfield) and `node tools/make-map.mjs` (the two test maps).

The map a character stands on is part of his save, so logging in puts him back
where he left.

## Items and inventory

Press **I** (or click *Bag*) for the inventory: 20 slots, a weapon and an armour
piece on top. Items use the icons and German names from the old project
(*Eisenschwert*, *Mönchsplattenpanzer*, …). Hover an item (on a phone: tap once)
for the tooltip with type, required level, attack/defence/health and a short
description. Click a bag slot to wear it; gear above your level is refused.

Wolves and boars drop materials and low-level gear; see `drops` in
`packages/shared/src/monsters.ts`. The item table lives in
`packages/shared/src/items.ts`.

## Graphics: modular pixel art

Characters are made of separate PNG layers — body, head, hair, armour, weapon —
that the game stacks. You draw in Paint/Aseprite, drop the file in, done. The
grid, columns, anchors and file names are in **`ART.md`**:

- cell **48×48**, **9 columns**, **3 views**; 432×144 px per layer
  (weapon 432×288, the top three rows are the empty "behind" pass)
- feet at **(24, 44)** in every cell
- folders: `packages/client/public/assets/{body,head,hair,armor,weapon}/`
  (monsters: `assets/monster/`, icons: `assets/icons/`)
- armour is a transparent layer over the body, so every armour fits every body

Tools: `node tools/check-art.mjs` (checks the grid), `/look.html` (stack the
layers and pick a pose), `/sheet.html` (a single sheet with the grid). Open the
game with `?style=pixel`.

## Map editor

Open <http://localhost:3000/editor.html> while the server runs. Paint tiles,
set the player spawn, place monsters, press Save. The editor writes
`packages/shared/maps/<id>.json`, which the server and the browser both load;
restart the server to walk the new map.

## Structure

```
packages/shared   rules, constants and the wire protocol (server + browser)
packages/server   authoritative world, tick loop, WebSocket gateway, static files
packages/client   Phaser scene, network client, HTML interface
scripts/dev.mjs   development runner
```

The server serves the built client, so production is a single process and a
single port.

## What works today

- A client connects, says hello, and receives a welcome plus snapshots.
- The server runs a fixed 20 Hz loop; every 2 ticks it broadcasts the world.
- Walking with WASD, the arrow keys or a touch joystick; the server decides
  where you end up, the client predicts and smooths in between.
- Several maps, linked by portals; every map is its own world on the server.
- Monsters that wander, notice you, follow a route around obstacles and bite.
- Fighting: a swing has a wind-up, lands half way through and only hits what
  stands inside its arc. A sword hits one monster, a great sword up to three.
- Items on the ground, inventory with stacks, equipment with its own values.
- Experience and Yang shared by damage dealt, levelling, dying and respawning.
- Accounts and characters in SQLite; saves after login, on a timer and on exit.
- Map editor at `/editor.html`.
- Invalid or unknown messages close the connection instead of being guessed at.
- Reconnect with backoff, ping measurement, mobile-safe layout, generated sound.

See `AGENTS.md` for the rules that keep the codebase readable.

## History

Seven earlier attempts exist (`lumiis-2d`, `lumiis_game`, `lumiis-game`,
`lumiis-web-2`, `Lumiis-web`, `Lumiis2`, `Lumiis`). They are reference material,
not a base. Content (items, monsters, maps, balance) will be ported from
`lumiis-2d` deliberately, file by file, with the owner reviewing each table.

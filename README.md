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

## Maps

Two maps ship with the project: `testmap` (64x64) and `grove` (24x24), linked by
portals in both directions. The map a character stands on is part of his save,
so logging in puts him back where he left.

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
- The client draws a tile grid and every player the server reports.
- Invalid or unknown messages close the connection instead of being guessed at.
- Reconnect with backoff, ping measurement, mobile-safe layout.

There is no movement, combat, inventory or persistence yet. Those arrive as
vertical slices; see `AGENTS.md` for the rules that keep the codebase readable.

## History

Seven earlier attempts exist (`lumiis-2d`, `lumiis_game`, `lumiis-game`,
`lumiis-web-2`, `Lumiis-web`, `Lumiis2`, `Lumiis`). They are reference material,
not a base. Content (items, monsters, maps, balance) will be ported from
`lumiis-2d` deliberately, file by file, with the owner reviewing each table.

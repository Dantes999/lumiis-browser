// Saving a map that was painted in the editor.
//
// Only from this machine: the editor runs in the same browser session as the
// developer, nobody else should be able to replace the world.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateMap, type MapData } from '@lumiis/shared';

const MAX_BODY_BYTES = 1024 * 1024;
const FILE_PATTERN = /^[a-z0-9_]{1,32}\.json$/;

const isLocal = (address: string | undefined): boolean =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

const readBody = async (req: IncomingMessage): Promise<string | null> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** One row of tiles per line, so the file stays readable in a diff. */
export function formatMap(map: MapData): string {
  const rows: string[] = [];
  for (let y = 0; y < map.height; y += 1) {
    rows.push(`    ${map.tiles.slice(y * map.width, (y + 1) * map.width).join(',')}`);
  }

  const spawns = map.spawns
    .map((spawn) => `    { "kind": "mob", "key": "${spawn.key}", "tx": ${spawn.tx}, "ty": ${spawn.ty} }`)
    .join(',\n');

  return `{
  "id": "${map.id}",
  "width": ${map.width},
  "height": ${map.height},
  "spawn": { "x": ${map.spawn.x}, "y": ${map.spawn.y} },
  "tiles": [
${rows.join(',\n')}
  ],
  "spawns": [
${spawns}
  ]
}
`;
}

const reply = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

export async function handleMapSave(
  req: IncomingMessage,
  res: ServerResponse,
  sharedRoot: string,
): Promise<void> {
  if (!isLocal(req.socket.remoteAddress)) {
    reply(res, 403, { errors: ['saving maps is allowed from this machine only'] });
    return;
  }

  const name = (req.url ?? '').replace(/^\/maps\//, '');
  if (!FILE_PATTERN.test(name)) {
    reply(res, 400, { errors: ['file name must be <id>.json'] });
    return;
  }

  const body = await readBody(req);
  if (body === null) {
    reply(res, 413, { errors: ['map is too large'] });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    reply(res, 400, { errors: ['map is not json'] });
    return;
  }

  const check = validateMap(parsed);
  if (!check.ok) {
    reply(res, 400, { errors: check.errors });
    return;
  }
  if (`${check.map.id}.json` !== name) {
    reply(res, 400, { errors: ['the map id must match the file name'] });
    return;
  }

  try {
    writeFileSync(join(sharedRoot, 'maps', name), formatMap(check.map), 'utf8');
  } catch (error) {
    reply(res, 500, { errors: [(error as Error).message] });
    return;
  }

  reply(res, 200, { ok: true, id: check.map.id });
}

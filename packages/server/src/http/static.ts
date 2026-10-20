// HTTP side: serves the built client and nothing else.
//
// Security note: every path is resolved and checked against the static root, so
// a request like /../../package.json can never leave the client folder.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

export type StaticHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createStaticHandler(staticRoot: string): StaticHandler {
  const root = resolve(staticRoot);

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const filePath = resolve(join(root, normalize(pathname)));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('not a file');

      const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, {
        'content-type': type,
        'content-length': info.size,
        // The client is rebuilt on every deploy, so revalidate instead of caching hard.
        'cache-control': 'no-cache',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      createReadStream(filePath)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch {
      // A missing build is the most likely cause on a fresh checkout.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found. Run "npm run build" to build the client.\n');
    }
  };
}

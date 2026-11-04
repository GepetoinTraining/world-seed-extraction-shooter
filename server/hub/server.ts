/**
 * The deployed server's one listener: the landing page from its folder, and the hub at /api/hub.
 * Nothing of play is here: no /api/db, no /api/intelligence (DEPLOY.md).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { send } from './http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

/** The landing page loads only its own files and posts only to its own hub. */
const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

export interface IHubListenerParts {
  api: (req: IncomingMessage, res: ServerResponse, path: string) => Promise<void>;
  landingDir: string;
}

export function createHubListener({ api, landingDir }: IHubListenerParts) {
  const root = resolve(landingDir);
  return (req: IncomingMessage, res: ServerResponse) => {
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      return send(res, 400, { ok: false, reason: 'That address does not read.' });
    }
    if (path === '/api/hub' || path.startsWith('/api/hub/')) return void api(req, res, path.slice('/api/hub'.length) || '/');
    if (path.startsWith('/api/')) return send(res, 404, { ok: false, reason: 'This server holds accounts and receipts. The game runs on your own machine.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, reason: 'GET only.' });

    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    const inside = (file === root || file.startsWith(root + sep)) && existsSync(file) && statSync(file).isFile();
    if (!inside) return send(res, 404, { ok: false, reason: 'Nothing here.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    for (const [k, v] of Object.entries(PAGE_HEADERS)) res.setHeader(k, v);
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}

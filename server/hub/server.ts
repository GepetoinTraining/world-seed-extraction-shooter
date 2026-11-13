/**
 * The deployed server's one listener: the landing page from its folder, and the hub at /api/hub.
 * Nothing of play is here: no /api/db, no /api/intelligence (DEPLOY.md).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { send } from './http';
import { hostHeaders, pageHeaders } from './pagePolicy';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.map': 'application/json', '.woff2': 'font/woff2',
  '.ps1': 'text/plain; charset=utf-8', '.sh': 'text/plain; charset=utf-8'
};

// What a page may load and who may frame it: pagePolicy.ts, the same function the built site's pages
// are written with, so the stand-in and the host cannot drift.

export interface IHubListenerParts {
  api: (req: IncomingMessage, res: ServerResponse, path: string) => Promise<void>;
  landingDir: string;
  /** Paths under which any address is that folder's index.html: the game's own routes. */
  pages?: string[];
  /** The address Clerk's own script and API answer at, when this hub's accounts are Clerk's. */
  clerkHost?: string | null;
}

export function createHubListener({ api, landingDir, pages = [], clerkHost }: IHubListenerParts) {
  const root = resolve(landingDir);
  const PAGE_HEADERS = pageHeaders(clerkHost);
  const GAME_HEADERS = hostHeaders();
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

    const asked = path.endsWith('/') ? `${path}index.html` : path;
    let file = normalize(join(root, asked));
    const within = (f: string) => f === root || f.startsWith(root + sep);
    let inside = within(file) && existsSync(file) && statSync(file).isFile();
    const page = pages.find(p => path === p.replace(/\/$/, '') || path.startsWith(p));
    if (!inside && page) {
      file = normalize(join(root, page, 'index.html'));
      inside = within(file) && existsSync(file);
    }
    if (!inside) return send(res, 404, { ok: false, reason: 'Nothing here.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    // The landing page's strict policy; the game sets its own needs (WebAssembly for its store) and gets what
    // the host gives every address (vercel.json): no framing, no sniffing, no referrer
    for (const [k, v] of Object.entries(page ? GAME_HEADERS : PAGE_HEADERS)) res.setHeader(k, v);
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}

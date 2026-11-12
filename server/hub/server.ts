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
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.map': 'application/json', '.woff2': 'font/woff2',
  '.ps1': 'text/plain; charset=utf-8', '.sh': 'text/plain; charset=utf-8'
};

/**
 * The landing page loads only its own files and posts only to its own hub. Where the hub's accounts
 * are Clerk's (clerk.ts), the page also loads Clerk's script from that instance's own address and
 * talks to it, and Clerk's sign-up form brings its own styles, pictures and bot check.
 */
const pageHeaders = (clerkHost?: string | null): Record<string, string> => {
  const clerk = clerkHost ? ` https://${clerkHost}` : '';
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self'${clerk}${clerk ? ' https://challenges.cloudflare.com' : ''}`,
      `style-src 'self'${clerk ? " 'unsafe-inline'" : ''}`,
      `img-src 'self' data:${clerk ? ' https://img.clerk.com' : ''}`,
      `connect-src 'self'${clerk}`,
      ...(clerk ? ['frame-src https://challenges.cloudflare.com', "worker-src 'self' blob:"] : []),
      "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  };
};

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
    // The landing page's strict policy; the game sets its own needs (WebAssembly for its store)
    if (!page) for (const [k, v] of Object.entries(PAGE_HEADERS)) res.setHeader(k, v);
    else { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); }
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}

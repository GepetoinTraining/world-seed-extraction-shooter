/**
 * The small server, standing alone: the database door, and the built game if
 * there is one. The dev server mounts the same handler; this is the deploy shape.
 *
 *   npm run build
 *   npm run serve
 *
 * WS_DATABASE_URL   pglite://<folder> (default data/test-claude) or postgres://…
 * WS_PORT           default 3900
 * WS_HOST           default 127.0.0.1. There is no authentication: see http.ts.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbHandler, lazyStore } from './http';
import { openStore } from './SqlStore';
import { defaultDatabaseUrl } from './connection';
import { createIntelligenceHandler, openDoor } from './intelligence';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.WS_DATABASE_URL ?? defaultDatabaseUrl(root);
const port = Number(process.env.WS_PORT ?? 3900);
const host = process.env.WS_HOST ?? '127.0.0.1';
const dist = join(root, 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm'
};

const store = lazyStore(() => openStore(url));
const intelligence = createIntelligenceHandler(openDoor());
const handle = createDbHandler(store.get, { allowRemote: process.env.WS_DB_ALLOW_REMOTE === '1' });

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path.startsWith('/api/intelligence')) {
    void intelligence(req, res, path.slice('/api/intelligence'.length) || '/');
    return;
  }
  if (path.startsWith('/api/db')) {
    void handle(req, res, path.slice('/api/db'.length) || '/');
    return;
  }
  if (process.env.WS_NO_STATIC === '1') {
    res.statusCode = 404;
    res.end();
    return;
  }
  const file = normalize(join(dist, path === '/' ? 'index.html' : path));
  const inside = file.startsWith(dist) && existsSync(file) && statSync(file).isFile();
  const chosen = inside ? file : join(dist, 'index.html');
  if (!existsSync(chosen)) {
    res.statusCode = 404;
    res.end('No build here. Run npm run build, or npm run dev for the dev server.');
    return;
  }
  res.setHeader('Content-Type', MIME[extname(chosen)] ?? 'application/octet-stream');
  createReadStream(chosen).pipe(res);
});

server.listen(port, host, () => console.log(`[DB] World Seed's database answers on http://${host}:${port}/api/db (${url.split(':')[0]})`));
void store.get().catch(e => console.error(`[DB] The database did not open: ${e?.message ?? e}`));
// A clean close leaves nothing to replay. A kill loses nothing either, and the next open pays for it.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void store.close().finally(() => process.exit(0)); });

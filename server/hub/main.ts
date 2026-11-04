/**
 * THE HUB'S LOCAL STAND-IN: the hub's one function (function.ts) behind a plain Node server, with
 * the landing page beside it, as a function host would serve them. It runs nobody's play and holds
 * no model key (DEPLOY.md).
 *
 *   npm run hub
 *
 * WS_HUB_DATABASE_URL   postgres://… when served; default a folder at data/hub-test
 * WS_PUBLIC_URL         this hub's own address, named in what it signs (the domain is configuration)
 * WS_HUB_KEY            its signing key, PKCS#8 PEM (Ed25519), from the host's secret store
 * WS_HUB_KEY_FILE       or a file holding it; with neither, one is made in data/ for a local test
 * WS_RECORD             1 to keep the hub's record on Turso (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
 * WS_HOST, WS_PORT      default 127.0.0.1:3950; a host sets 0.0.0.0 and its own port (PORT is read too)
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderUrl } from '../connection';
import { hubKeyFrom } from './keys';
import { createHubFunction, hubPathOf } from './function';
import { createHubListener } from './server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.WS_PORT ?? process.env.PORT ?? 3950);
const host = process.env.WS_HOST ?? '127.0.0.1';
const databaseUrl = process.env.WS_HUB_DATABASE_URL ?? folderUrl(join(root, 'data', 'hub-test'));
const publicUrl = (process.env.WS_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, '');
const key = hubKeyFrom(process.env, join(root, 'data', 'hub-key.pem'), line => console.log(line));

// The same function a host runs per request, here behind one local server: the stand-in (DEPLOY.md)
const hub = createHubFunction({ databaseUrl, key, publicUrl });
// The built site when there is one (npm run build:site: the landing page, and the game at /play/), else the landing page alone
const site = existsSync(join(root, 'dist-site', 'index.html')) ? join(root, 'dist-site') : join(root, 'landing');
const server = createServer(createHubListener({ api: (req, res) => hub(req, res, hubPathOf(req.url)), landingDir: site, pages: ['/play/'] }));
server.listen(port, host, () => console.log(`[HUB] ${key.id} answers on http://${host}:${port} as ${publicUrl} (${databaseUrl.split(':')[0]}), the function's local stand-in`));

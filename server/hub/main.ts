/**
 * THE HUB, deployed: accounts, sessions, characters and receipts, and the landing page. It runs
 * nobody's play and holds no model key (DEPLOY.md).
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lazyStore } from '../http';
import { openLiveStore } from '../record';
import { folderUrl } from '../connection';
import { Hub } from './Hub';
import { hubKeyFrom } from './keys';
import { createHubHandler } from './http';
import { createHubListener } from './server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.WS_PORT ?? process.env.PORT ?? 3950);
const host = process.env.WS_HOST ?? '127.0.0.1';
const url = process.env.WS_HUB_DATABASE_URL ?? folderUrl(join(root, 'data', 'hub-test'));
const publicUrl = (process.env.WS_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, '');
const key = hubKeyFrom(process.env, join(root, 'data', 'hub-key.pem'), line => console.log(line));

const store = lazyStore(() => openLiveStore(url));
type Handler = ReturnType<typeof createHubHandler>;
let opening: Promise<Handler> | null = null;
const handlerNow = () => (opening ??= store.get().then(s => createHubHandler(new Hub(s, key, { publicUrl }))).catch(e => { opening = null; throw e; }));

const handler: Handler = async (req, res, path) => {
  let handle: Handler;
  try {
    handle = await handlerNow();
  } catch (e) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, reason: `The hub's store did not open: ${e instanceof Error ? e.message : String(e)}` }));
    return;
  }
  return handle(req, res, path);
};

const server = createServer(createHubListener({ api: handler, landingDir: join(root, 'landing') }));
server.listen(port, host, () => console.log(`[HUB] ${key.id} answers on http://${host}:${port} as ${publicUrl} (${url.split(':')[0]})`));
void handlerNow().catch(e => console.error(`[HUB] The store did not open: ${e?.message ?? e}`));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { void store.close().finally(() => process.exit(0)); });

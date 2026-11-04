/**
 * THE RUNNER, standing alone, on the person's own machine (DEPLOY.md): the built game, the
 * database door, the door to their model, and the bridge to a hub. The dev server mounts the
 * same doors.
 *
 *   npm run play      (builds, then this)
 *   npm run serve     (this, on a build already made)
 *
 * WS_DATABASE_URL   pglite://<folder> (default data/test-claude) or postgres://…
 * WS_RECORD         1 to keep this game's record on Turso (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
 * WS_PORT           default 3900
 * WS_HOST           default 127.0.0.1. There is no authentication: see http.ts.
 * WS_HUB_URL        the hub to sign in to and send receipts to (https, or http on this machine)
 */
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbHandler, lazyStore } from './http';
import { openLiveStore } from './record';
import { carryOldSave } from './carryDoor';
import { defaultDatabaseUrl } from './connection';
import { createIntelligenceHandler, openDoor } from './intelligence';
import { createHubBridge, createRunnerListener, hubUrlProblem } from './runner';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.WS_DATABASE_URL ?? defaultDatabaseUrl(root);
const port = Number(process.env.WS_PORT ?? 3900);
const host = process.env.WS_HOST ?? '127.0.0.1';
const dist = join(root, 'dist');

const store = lazyStore(() => openLiveStore(url));
const intelligence = createIntelligenceHandler(openDoor());
const handle = createDbHandler(store.get, { allowRemote: process.env.WS_DB_ALLOW_REMOTE === '1', carry: carryOldSave });

const hubUrl = process.env.WS_HUB_URL?.trim() || undefined;
const server = createServer(createRunnerListener({
  db: handle,
  intelligence,
  hub: createHubBridge({ hubUrl }),
  dist,
  noStatic: process.env.WS_NO_STATIC === '1'
}));

server.listen(port, host, () => {
  console.log(`[DB] World Seed's database answers on http://${host}:${port}/api/db (${url.split(':')[0]})`);
  console.log(`[RUNNER] The game is at http://${host}:${port}/`);
  console.log(hubUrl ? (hubUrlProblem(hubUrl) ?? `[RUNNER] Its hub is ${hubUrl}`) : '[RUNNER] No hub is set (WS_HUB_URL): this game plays here alone.');
});
void store.get().catch(e => console.error(`[DB] The database did not open: ${e?.message ?? e}`));
// A clean close writes down and leaves nothing to replay. A kill loses nothing either: the next open replays, and the marks are still there.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { void store.close().finally(() => process.exit(0)); });

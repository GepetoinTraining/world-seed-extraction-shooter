/**
 * THE RUNNER, standing alone, on the person's own machine (DEPLOY.md): the built game, the
 * database door, the door to their model, and the bridge to a hub. The dev server mounts the
 * same doors. The runner itself is `server/standalone.ts`; this starts it from the environment
 * and stops it on a signal.
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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDatabaseUrl } from './connection';
import { startStandalone } from './standalone';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.WS_DATABASE_URL ?? defaultDatabaseUrl(root);
const port = Number(process.env.WS_PORT ?? 3900);
const host = process.env.WS_HOST ?? '127.0.0.1';

const runner = await startStandalone({ root, url, port, host });
// A clean close writes down and leaves nothing to replay. A kill loses nothing either: the next open replays, and the marks are still there.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { void runner.close().finally(() => process.exit(0)); });

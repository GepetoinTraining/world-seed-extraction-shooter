/**
 * Pedro's own game: test-pedro, on a port of its own.
 *
 *   npm run pedro      syncs the shared base, then starts the game
 *   npm run db:sync    syncs the shared base and stops
 *
 * The port matters: a browser's old saves are imported the first time it opens an
 * origin, and no browser has saves on this one, so nothing can arrive uninvited.
 * Everything else (`npm run dev`, every launch entry) uses test-claude.
 *
 * A database folder has one opener at a time. If a server is running on test-claude,
 * the sync cannot run: `npm run pedro` says so and plays on, and `npm run db:sync`
 * says so and fails. WS_DATA_ROOT moves both folders, so that a bar can run this
 * script on databases of its own.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderUrl } from '../server/connection';
import { syncAtStart } from '../server/syncBase';

const PEDRO_PORT = 3200;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.WS_DATA_ROOT ?? root;
const PEDRO_DB = folderUrl(resolve(dataRoot, 'data/test-pedro'));
const CLAUDE_DB = folderUrl(resolve(dataRoot, 'data/test-claude'));

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? args[portAt + 1] : String(PEDRO_PORT);

const synced = await syncAtStart(CLAUDE_DB, PEDRO_DB, line => console.log(line));

if (args.includes('--sync-only')) {
  process.exit(synced ? 0 : 1);
} else {
  console.log(`[DB] Playing on test-pedro: http://localhost:${port}`);
  const vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WS_DATABASE_URL: PEDRO_DB }
  });
  vite.on('exit', code => process.exit(code ?? 0));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => vite.kill(signal));
}

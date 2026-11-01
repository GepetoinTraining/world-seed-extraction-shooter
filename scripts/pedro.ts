/**
 * Pedro's own game: test-pedro, on a port of its own.
 *
 *   npm run pedro      syncs the shared base, then starts the game
 *   npm run db:sync    syncs the shared base and stops
 *
 * The port matters: a browser's old saves are imported the first time it opens an
 * origin, and no browser has saves on this one, so nothing can arrive uninvited.
 * Everything else (`npm run dev`, every launch entry) uses test-claude.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBase } from '../server/syncBase';

const PEDRO_PORT = 3200;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileUrl = (relative: string) => `file:${resolve(root, relative).replace(/\\/g, '/')}`;
const PEDRO_DB = fileUrl('data/test-pedro.db');
const CLAUDE_DB = fileUrl('data/test-claude.db');

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? args[portAt + 1] : String(PEDRO_PORT);

const report = await syncBase(CLAUDE_DB, PEDRO_DB);
console.log(`[DB] Shared base synced: ${report.toTarget} into test-pedro, ${report.toSource} into test-claude.`);

if (!args.includes('--sync-only')) {
  console.log(`[DB] Playing on test-pedro: http://localhost:${port}`);
  const vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WS_DATABASE_URL: PEDRO_DB }
  });
  vite.on('exit', code => process.exit(code ?? 0));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => vite.kill(signal));
}

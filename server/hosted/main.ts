/**
 * THE WORLD WE HOST, LIVE (Pedro, 2026-11-04: "The server still needs it for the world we'll host
 * for everyone, that one is the solid deploy plan, we do want to hold a live server for this").
 * One Node process:
 *   - the hub as a function host runs it (server/hub/app.ts: accounts, checks, the pool, the hosted
 *     world's routes, online play and its socket), always on;
 *   - the site (dist-site/: the landing page, the game at /play/);
 *   - the door on our own key (/api/intelligence), answering this machine only, for the operator's
 *     tools that write the hosted world's content. The key is read from this process's environment
 *     (the host's secret store), never from a file in a checkout, never sent to a browser or a log.
 *
 * Online play (server/live/room.ts) keeps the hosted world's shared documents in the hub's own
 * database unless WS_LIVE_DATABASE_URL names another, which then keeps a record of its own
 * (TURSO_LIVE_DATABASE_URL) or none: two stores cannot share one record.
 *
 * The same hub runs on a function host with nothing kept running (api/hub.ts, DEPLOY.md). This
 * process is its stand-in on one machine, and the way anyone else runs a hub of their own.
 *
 *   npm run hosted
 *
 * The hub's settings as in server/hub/app.ts; ANTHROPIC_API_KEY for the door. Money is a later
 * problem: no billing or limits are built for it.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderUrl } from '../connection';
import { hubKeyFrom } from '../hub/keys';
import { createHubApp } from '../hub/app';
import { clerkFrontendHost } from '../hub/clerk';
import { createHubListener } from '../hub/server';
import { createIntelligenceHandler, chooseProvider } from '../intelligence';
import { IntelligenceDoor } from '../../shared/intelligence/door';
import { LocalProvider } from '../../shared/intelligence/local';
import { localRuntimeFrom } from '../intelligence/localDisk';
import { DoorSetting, SETTINGS } from '../../shared/intelligence/setting';
import { readDoorOptions } from '../intelligence/optionsFile';
import { HOST } from '../intelligence/machineHost';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.WS_PORT ?? process.env.PORT ?? 3960);
const host = process.env.WS_HOST ?? '127.0.0.1';
const databaseUrl = process.env.WS_HUB_DATABASE_URL ?? folderUrl(join(root, 'data', 'hosted-test'));
const publicUrl = (process.env.WS_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, '');
const key = hubKeyFrom(process.env, join(root, 'data', 'hosted-key.pem'), line => console.log(line));

const app = createHubApp({ databaseUrl, key, publicUrl, liveDatabaseUrl: process.env.WS_LIVE_DATABASE_URL, liveListenUrl: process.env.WS_LIVE_LISTEN_URL });
const site = existsSync(join(root, 'dist-site', 'index.html')) ? join(root, 'dist-site') : join(root, 'landing');
const clerkHost = process.env.CLERK_PUBLISHABLE_KEY ? clerkFrontendHost(process.env.CLERK_PUBLISHABLE_KEY.trim()) : null;
const pages = createHubListener({ api: (req, res) => app.handle(req, res), landingDir: site, pages: ['/play/'], clerkHost });

// Our key, from this process's own environment only: no .env is read here
const local = new LocalProvider(localRuntimeFrom(process.env));
const setting = new DoorSetting(chooseProvider(process.env, local), local, readDoorOptions(), HOST, process.env.WS_LLM_PROVIDER === 'none');
const door = new IntelligenceDoor(setting);
SETTINGS.set(door, setting);
const voice = createIntelligenceHandler(door, { allowRemote: false });

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/api/intelligence' || path.startsWith('/api/intelligence/')) return void voice(req, res, path.slice('/api/intelligence'.length) || '/');
  pages(req, res);
});
server.on('upgrade', (req, raw) => app.upgrade(req, raw));
// Opened before the first player asks, so a database that will not open says so here
await app.ready();
server.listen(port, host, () => console.log(`[HOSTED] ${key.id} hosts on http://${host}:${port} as ${publicUrl}; its door answers this machine only`));

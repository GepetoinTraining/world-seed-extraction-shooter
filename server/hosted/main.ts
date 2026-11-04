/**
 * THE WORLD WE HOST, LIVE (Pedro, 2026-11-04: "The server still needs it for the world we'll host
 * for everyone, that one is the solid deploy plan, we do want to hold a live server for this").
 * The one place a running service is allowed. One Node process:
 *   - the hub's function (accounts, checks, the pool, the hosted world's routes), as a function
 *     host would run it, always on;
 *   - the site (dist-site/: the landing page, the game at /play/);
 *   - the door on our own key (/api/intelligence), answering this machine only, for the operator's
 *     tools that write the hosted world's content. The key is read from this process's environment
 *     (the host's secret store), never from a file in a checkout, never sent to a browser or a log.
 *
 *   npm run hosted
 *
 * The hub's settings as in server/hub/function.ts; ANTHROPIC_API_KEY for the door. Money is a later
 * problem: no billing or limits are built for it.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderUrl } from '../connection';
import { hubKeyFrom } from '../hub/keys';
import { createHubFunction, hubPathOf } from '../hub/function';
import { createHubListener } from '../hub/server';
import { createIntelligenceHandler, chooseProvider } from '../intelligence';
import { IntelligenceDoor } from '../intelligence/door';
import { LocalProvider, localRuntimeFrom } from '../intelligence/local';
import { DoorSetting, SETTINGS } from '../intelligence/setting';
import { readDoorOptions } from '../intelligence/optionsFile';
import { HOST } from '../intelligence/machineHost';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.WS_PORT ?? process.env.PORT ?? 3960);
const host = process.env.WS_HOST ?? '127.0.0.1';
const databaseUrl = process.env.WS_HUB_DATABASE_URL ?? folderUrl(join(root, 'data', 'hosted-test'));
const publicUrl = (process.env.WS_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, '');
const key = hubKeyFrom(process.env, join(root, 'data', 'hosted-key.pem'), line => console.log(line));

const hub = createHubFunction({ databaseUrl, key, publicUrl });
const site = existsSync(join(root, 'dist-site', 'index.html')) ? join(root, 'dist-site') : join(root, 'landing');
const pages = createHubListener({ api: (req, res) => hub(req, res, hubPathOf(req.url)), landingDir: site, pages: ['/play/'] });

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
server.listen(port, host, () => console.log(`[HOSTED] ${key.id} hosts on http://${host}:${port} as ${publicUrl}; its door answers this machine only`));

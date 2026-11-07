/**
 * THE WORLD WE HOST, LIVE (Pedro, 2026-11-04: "The server still needs it for the world we'll host
 * for everyone, that one is the solid deploy plan, we do want to hold a live server for this").
 * The one place a running service is allowed. One Node process:
 *   - the hub's function (accounts, checks, the pool, the hosted world's routes), as a function
 *     host would run it, always on;
 *   - the site (dist-site/: the landing page, the game at /play/);
 *   - the door on our own key (/api/intelligence), answering this machine only, for the operator's
 *     tools that write the hosted world's content. The key is read from this process's environment
 *     (the host's secret store), never from a file in a checkout, never sent to a browser or a log;
 *   - online play (server/live/room.ts): the hosted world's shared documents in their own Postgres,
 *     kept by the keeper that writes them down to Turso when WS_RECORD=1, commits at
 *     /api/hub/live/commit and events on the socket at /api/hub/live/socket.
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
import { LocalProvider } from '../intelligence/local';
import { localRuntimeFrom } from '../intelligence/localDisk';
import { DoorSetting, SETTINGS } from '../intelligence/setting';
import { readDoorOptions } from '../intelligence/optionsFile';
import { HOST } from '../intelligence/machineHost';
import { openLiveStore } from '../record';
import { LiveRoom, type LiveAccess } from '../live/room';
import { tokenOf } from '../hub/http';

/** Under the hub's mount, so the hub's own cookie (Path=/api/hub) rides with every live request. */
const LIVE_MOUNT = '/api/hub/live';
/** How long the hub's word on a character is taken before it is asked again: a barred character is out within this. */
const LIVE_WORD_MS = 30_000;

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

// Online play: who may is the hub's own word (HostedWorld.connect), asked over its route, kept a little while
const liveUrl = process.env.WS_LIVE_DATABASE_URL ?? folderUrl(join(root, 'data', 'hosted-live'));
const liveStore = await openLiveStore(liveUrl);
const heard = new Map<string, { until: number; answer: Awaited<ReturnType<LiveAccess>> }>();
const access: LiveAccess = async (token, uid) => {
  if (!token) return { ok: false, status: 401, reason: 'Sign in to the hub first.' };
  const key = `${token}|${uid}`;
  const kept = heard.get(key);
  if (kept && kept.until > Date.now()) return kept.answer;
  const res = await fetch(`http://127.0.0.1:${port}/api/hub/hosted/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ uid }) });
  const out = await res.json().catch(() => ({})) as any;
  const answer = out.ok && out.manifest?.world?.worldUid
    ? { ok: true as const, worldUid: String(out.manifest.world.worldUid) }
    : { ok: false as const, status: res.status === 200 ? 403 : res.status, reason: String(out.reason ?? 'The hub did not let this character in.') };
  heard.set(key, { until: Date.now() + LIVE_WORD_MS, answer });
  return answer;
};
const live = new LiveRoom(liveStore, access);

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/api/intelligence' || path.startsWith('/api/intelligence/')) return void voice(req, res, path.slice('/api/intelligence'.length) || '/');
  if (path.startsWith(LIVE_MOUNT)) return void live.http(req, res, path.slice(LIVE_MOUNT.length), tokenOf(req)).catch(e => { res.statusCode = 500; res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); });
  pages(req, res);
});
server.on('upgrade', (req, raw) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path !== `${LIVE_MOUNT}/socket`) return void raw.destroy();
  void live.upgrade(req, raw, tokenOf(req)).catch(() => raw.destroy());
});
server.listen(port, host, () => console.log(`[HOSTED] ${key.id} hosts on http://${host}:${port} as ${publicUrl}; its door answers this machine only`));

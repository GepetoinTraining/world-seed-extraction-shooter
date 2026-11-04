/**
 * The database inside the dev server: `npm run dev` and every launch entry bring
 * up the game and its store with one command and one port. `vite preview` too.
 * One process holds a database folder at a time, so a second port in one checkout
 * needs its own WS_DATABASE_URL, and is told so plainly if it has none.
 */
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { createDbHandler, lazyStore } from './http';
import { openLiveStore } from './record';
import { carryOldSave } from './carryDoor';
import { defaultDatabaseUrl } from './connection';
import { createIntelligenceHandler, openDoor } from './intelligence';
import { createHubBridge } from './runner';
import { createClockDoor } from './clock';

export const databaseUrl = (root: string) => process.env.WS_DATABASE_URL ?? defaultDatabaseUrl(root);

export function worldSeedDatabase(root: string): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    const store = lazyStore(() => openLiveStore(databaseUrl(root)));
    const handle = createDbHandler(store.get, { allowRemote: process.env.WS_DB_ALLOW_REMOTE === '1', carry: carryOldSave });
    server.middlewares.use('/api/db', (req, res) => {
      void handle(req, res, (req.url ?? '/').split('?')[0]);
    });
    // The door to the intelligence, on the server, so a key never reaches a browser (D46)
    const door = createIntelligenceHandler(openDoor(), { allowRemote: false });
    server.middlewares.use('/api/intelligence', (req, res) => {
      void door(req, res, (req.url ?? '/').split('?')[0]);
    });
    // The bridge to a hub, holding its session here and not in the browser (DEPLOY.md)
    const hub = createHubBridge({ hubUrl: process.env.WS_HUB_URL });
    server.middlewares.use('/api/hub', (req, res) => {
      void hub(req, res, (req.url ?? '/').split('?')[0]);
    });
    // The game's clock: the hub's when there is one (D135)
    const clock = createClockDoor({ hubUrl: process.env.WS_HUB_URL });
    server.middlewares.use('/api/clock', (req, res) => { void clock(req, res); });
    server.httpServer?.on('close', () => { void store.close(); });
    // A dev server stopped from its terminal never reaches that close: this is its clean stop, with the write-down in it.
    const stopping = () => { void store.close().finally(() => process.exit(0)); };
    process.once('SIGINT', stopping);
    process.once('SIGHUP', stopping);
    server.httpServer?.on('close', () => { process.off('SIGINT', stopping); process.off('SIGHUP', stopping); });
    void store.get().catch(e => console.error(`[DB] The database did not open: ${e?.message ?? e}`));
  };
  return { name: 'world-seed-database', configureServer: mount, configurePreviewServer: mount };
}

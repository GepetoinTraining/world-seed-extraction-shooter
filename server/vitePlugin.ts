/**
 * The database inside the dev server: `npm run dev` and every launch entry bring
 * up the game and its store with one command and one port. `vite preview` too.
 * One process holds a database folder at a time, so a second port in one checkout
 * needs its own WS_DATABASE_URL, and is told so plainly if it has none.
 */
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { createDbHandler, lazyStore } from './http';
import { openStore } from './SqlStore';
import { defaultDatabaseUrl } from './connection';
import { createIntelligenceHandler, openDoor } from './intelligence';

export const databaseUrl = (root: string) => process.env.WS_DATABASE_URL ?? defaultDatabaseUrl(root);

export function worldSeedDatabase(root: string): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    const store = lazyStore(() => openStore(databaseUrl(root)));
    const handle = createDbHandler(store.get, { allowRemote: process.env.WS_DB_ALLOW_REMOTE === '1' });
    server.middlewares.use('/api/db', (req, res) => {
      void handle(req, res, (req.url ?? '/').split('?')[0]);
    });
    // The door to the intelligence, on the server, so a key never reaches a browser (D46)
    const door = createIntelligenceHandler(openDoor(), { allowRemote: false });
    server.middlewares.use('/api/intelligence', (req, res) => {
      void door(req, res, (req.url ?? '/').split('?')[0]);
    });
    server.httpServer?.on('close', () => { void store.close(); });
    void store.get().catch(e => console.error(`[DB] The database did not open: ${e?.message ?? e}`));
  };
  return { name: 'world-seed-database', configureServer: mount, configurePreviewServer: mount };
}

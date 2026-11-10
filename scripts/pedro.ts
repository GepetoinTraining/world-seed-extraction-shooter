/**
 * Pedro's own game: test-pedro, on a port of its own.
 *
 *   npm run pedro           syncs the shared base, then starts the game on the dev server
 *   npm run pedro:window    the same game, built, in a window of its own (--window --built)
 *   npm run db:sync         syncs the shared base and stops
 *
 * The port matters: a browser's old saves are imported the first time it opens an
 * origin, and no browser has saves on this one, so nothing can arrive uninvited.
 * Everything else (`npm run dev`, every launch entry) uses test-claude.
 *
 * A database folder has one opener at a time. If a server is running on test-claude,
 * the sync cannot run: `npm run pedro` says so and plays on, and `npm run db:sync`
 * says so and fails. WS_DATA_ROOT moves both folders, so that a bar can run this
 * script on databases of its own.
 *
 * This is the one game that keeps a record on Turso (D133), which is what WS_RECORD says
 * below. With no URL in `.env` it plays on and says so. A folder that does not exist yet
 * is not synced into first, or the shared base would make it look like a save of its own
 * when the record is about to load the real one.
 *
 * --window opens the game in a Chromium browser already on this machine, as an app window on a
 * profile folder of its own (data/window-pedro, server/window.ts), and stops the game when that
 * window closes. That folder is where the window keeps a character's certificate and key.
 * --built serves the built game from the runner in this process (server/standalone.ts) instead
 * of the dev server: lighter in the browser, and a closed window is then a clean stop with the
 * write-down in it. --no-build serves the build already made. `npm run pedro -- --window` is the
 * dev server in the same window, on the same profile.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderUrl } from '../server/connection';
import { syncAtStart } from '../server/syncBase';
import { loadLocalEnv } from '../server/intelligence';
import { startStandalone } from '../server/standalone';
import { findBrowser, openWindow, type IGameWindow } from '../server/window';

const PEDRO_PORT = 3200;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.WS_DATA_ROOT ?? root;
const PEDRO_DB = folderUrl(resolve(dataRoot, 'data/test-pedro'));
const CLAUDE_DB = folderUrl(resolve(dataRoot, 'data/test-claude'));
const WINDOW_PROFILE = resolve(dataRoot, 'data/window-pedro');

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? args[portAt + 1] : String(PEDRO_PORT);
const address = `http://localhost:${port}`;
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');

loadLocalEnv(resolve(root, '.env'));
const recordMayLoad = !!process.env.TURSO_DATABASE_URL?.trim() && !existsSync(resolve(dataRoot, 'data/test-pedro/PG_VERSION'));
if (recordMayLoad) console.log('[DB] Shared base not synced this time: test-pedro comes up from the record first.');
const synced = recordMayLoad || await syncAtStart(CLAUDE_DB, PEDRO_DB, line => console.log(line));

/** The game's window, or null when this machine has no browser to open it in. `stop` is what a closed window does. */
function show(stop: () => unknown): IGameWindow | null {
  const browser = findBrowser();
  if (!browser) {
    console.log(`[WINDOW] No Chromium browser was found here (Chrome, Edge, Chromium or Brave; WS_BROWSER names another). The game stays up at ${address}: open it in any browser, and stop it with Ctrl+C.`);
    return null;
  }
  mkdirSync(WINDOW_PROFILE, { recursive: true });
  const view = openWindow({ address, profile: WINDOW_PROFILE, browser, extra: process.env.WS_WINDOW_ARGS });
  console.log(`[WINDOW] The game is in a window of its own (${basename(browser)}). Close the window to stop the game.`);
  console.log(`[WINDOW] Its profile, with the key of any character made in it, is ${WINDOW_PROFILE}`);
  void view.closed.then(end => {
    if (end.stayed) {
      console.log('[WINDOW] The window closed. Stopping the game.');
      void stop();
    } else {
      console.log(`[WINDOW] The window's browser ended at once${end.error ? ` (${end.error})` : ''}: it handed over to one already open on this profile, or it did not start. The game stays up at ${address}; stop it with Ctrl+C.`);
    }
  });
  return view;
}

/** Any answer at all from the address: the dev server is up. */
async function answers(): Promise<void> {
  for (let i = 0; i < 600; i++) {
    try { await fetch(address); return; } catch { /* still rising */ }
    await new Promise(r => setTimeout(r, 100));
  }
}

if (args.includes('--sync-only')) {
  process.exit(synced ? 0 : 1);
} else {
  console.log(`[DB] Playing on test-pedro: ${address}`);
  const playEnv = { ...process.env, WS_DATABASE_URL: PEDRO_DB, WS_RECORD: '1' };
  const wantsWindow = args.includes('--window');
  let view: IGameWindow | null = null;

  if (args.includes('--built')) {
    if (!args.includes('--no-build')) {
      const made = spawnSync(process.execPath, [viteBin, 'build'], { cwd: root, stdio: 'inherit' });
      if (made.status !== 0) process.exit(made.status ?? 1);
    }
    const runner = await startStandalone({ root, url: PEDRO_DB, port: Number(port), host: process.env.WS_HOST ?? '127.0.0.1', env: playEnv }).catch(e => {
      console.error((e as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `[RUNNER] Port ${port} is taken: the game is probably running already. Close it first.`
        : `[RUNNER] The game did not start: ${(e as Error).message}`);
      process.exit(1);
    });
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      view?.close();
      await runner.close().catch(e => console.error(`[DB] The close did not finish: ${(e as Error).message}`));
      process.exit(0);
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { void stop(); });
    if (wantsWindow) view = show(stop);
  } else {
    const vite = spawn(process.execPath, [viteBin, '--port', port, '--strictPort'], {
      cwd: root,
      stdio: 'inherit',
      env: playEnv
    });
    vite.on('exit', code => { view?.close(); process.exit(code ?? 0); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => vite.kill(signal));
    if (wantsWindow) {
      await answers();
      // A kill is all one process can do to another here. It loses nothing: the next open replays, and the marks are still there.
      view = show(() => vite.kill());
    }
  }
}

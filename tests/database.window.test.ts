// @vitest-environment node
/**
 * PEDRO'S GAME IN A WINDOW OF ITS OWN, run as he runs it. Registered before the build.
 *
 * `scripts/pedro.ts --window --built` on two databases of its own (WS_DATA_ROOT), with a stand-in for the
 * browser (tests/fixtures/fake-browser.mjs) that takes a real one's flags, asks the address for the game's
 * store, stays a while and closes. The record is named and left blank, so a run of this file in a checkout
 * that holds a `.env` reaches no record: a file never replaces what the environment already says.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { folderUrl, openDatabase } from '../server/connection';

const ROOT = resolve(__dirname, '..');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let dir = '';
let child: ChildProcess | null = null;

const freePort = () => new Promise<number>((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => done(port)); });
});

function play(port: number, staysMs: number) {
  let said = '';
  child = spawn(process.execPath, ['--import', 'tsx', 'scripts/pedro.ts', '--window', '--built', '--no-build', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WS_DATA_ROOT: dir,
      WS_NO_STATIC: '1',
      WS_BROWSER: process.execPath,
      WS_WINDOW_ARGS: 'tests/fixtures/fake-browser.mjs',
      FAKE_BROWSER_STAYS_MS: String(staysMs),
      TURSO_DATABASE_URL: ' ',
      TURSO_AUTH_TOKEN: ' '
    }
  });
  child.stdout!.on('data', d => { said += String(d); });
  child.stderr!.on('data', d => { said += String(d); });
  const ended = new Promise<number | null>(done => child!.on('exit', code => done(code)));
  return { said: () => said, ended };
}

async function until(what: () => boolean, ms: number, why: () => string) {
  const began = Date.now();
  while (!what()) {
    if (Date.now() - began > ms) throw new Error(why());
    await sleep(100);
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-window-'));
  mkdirSync(join(dir, 'data'));
});

afterEach(async () => {
  const c = child;
  child = null;
  if (c && c.exitCode === null) await new Promise<void>(done => { c.on('exit', () => done()); c.kill('SIGKILL'); });
  for (let i = 0; i < 20; i++) {
    try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(250); }
  }
});

describe('npm run pedro:window', () => {
  it('opens the window on the game\'s own address with a profile beside his database, and closing it stops the game', async () => {
    const port = await freePort();
    const game = play(port, 5_000);
    const code = await Promise.race([game.ended, sleep(100_000).then(() => 'still running' as const)]);
    expect(code, game.said()).toBe(0);

    expect(game.said()).toContain(`[DB] Playing on test-pedro: http://localhost:${port}`);
    expect(game.said()).toMatch(/\[WINDOW\] The window closed/);

    const profile = join(dir, 'data', 'window-pedro');
    const seen = JSON.parse(readFileSync(join(profile, 'fake-browser.json'), 'utf8'));
    expect(seen.address).toBe(`http://localhost:${port}`);
    expect(resolve(seen.profile)).toBe(resolve(profile));
    // The store answered the window while it was open, on the address the window was given
    expect(seen.health).toBe(200);

    // The game is gone from its port, and it let go of the database: the folder opens for the next one
    await expect(fetch(`http://127.0.0.1:${port}/api/db/health`)).rejects.toThrow();
    expect(existsSync(join(dir, 'data', 'test-pedro', 'PG_VERSION'))).toBe(true);
    const again = await openDatabase(folderUrl(join(dir, 'data', 'test-pedro')));
    await again.close();
  }, 150_000);

  it('a window that ends at once is taken as handed over to one already open: the game stays up, and says so', async () => {
    const port = await freePort();
    const game = play(port, 0);
    await until(() => /\[WINDOW\] .*stays up/.test(game.said()), 100_000, () => `it never said the game stays up:\n${game.said()}`);
    let health = 0;
    for (let i = 0; i < 300 && health !== 200; i++) {
      try { health = (await fetch(`http://127.0.0.1:${port}/api/db/health`)).status; } catch { /* still rising */ }
      if (health !== 200) await sleep(100);
    }
    expect(health, game.said()).toBe(200);
    expect(child!.exitCode).toBeNull();
    expect(game.said()).not.toMatch(/The window closed/);
  }, 150_000);
});

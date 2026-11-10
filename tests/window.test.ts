// @vitest-environment node
/**
 * THE GAME IN A WINDOW OF ITS OWN (Pedro, 2026-11-10: "use chromium or electron for my run ... moving away from
 * the browser inside the Claude code for my attempts because it's painful on memory").
 *
 * A Chromium browser already on the machine, opened as an app window on a profile folder of its own. Nothing is
 * installed, and the address stays the one the game always had. `tests/database.window.test.ts` runs the script itself.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, windowArgs, openWindow, WINDOW_SETTLES_MS } from '../server/window';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

const WINDOWS = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' };
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const only = (...paths: string[]) => (path: string) => paths.includes(path);

describe('a browser already on the machine', () => {
  it('on Windows, Chrome is taken before Edge', () => {
    expect(findBrowser({ env: WINDOWS, platform: 'win32', exists: only(CHROME, EDGE) })).toBe(CHROME);
  });

  it('Edge, which every Windows has, is taken when there is no Chrome', () => {
    expect(findBrowser({ env: WINDOWS, platform: 'win32', exists: only(EDGE) })).toBe(EDGE);
  });

  it('one installed for a single person is found too', () => {
    const own = 'C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    expect(findBrowser({ env: WINDOWS, platform: 'win32', exists: only(own, EDGE) })).toBe(own);
  });

  it('on a Mac it is the app itself', () => {
    const app = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowser({ env: {}, platform: 'darwin', exists: only(app) })).toBe(app);
  });

  it('elsewhere it is the first one on the PATH', () => {
    expect(findBrowser({ env: { PATH: '/usr/local/bin:/usr/bin' }, platform: 'linux', exists: only('/usr/bin/chromium', '/usr/bin/microsoft-edge') })).toBe('/usr/bin/chromium');
  });

  it('the one a person names is the one used', () => {
    const mine = 'D:\\tools\\browser.exe';
    expect(findBrowser({ env: { ...WINDOWS, WS_BROWSER: mine }, platform: 'win32', exists: only(mine, CHROME) })).toBe(mine);
  });

  it('a named one that is not there finds nothing: no other is taken in its place', () => {
    expect(findBrowser({ env: { ...WINDOWS, WS_BROWSER: 'D:\\gone\\browser.exe' }, platform: 'win32', exists: only(CHROME) })).toBeNull();
  });

  it('with none, nothing is found', () => {
    expect(findBrowser({ env: WINDOWS, platform: 'win32', exists: () => false })).toBeNull();
  });
});

describe('what the window is opened with', () => {
  const args = windowArgs('http://localhost:3200', 'D:\\game\\data\\window-pedro');

  it('the game\'s own address, as an app: no tabs and no address bar', () => {
    expect(args).toContain('--app=http://localhost:3200');
  });

  it('a profile folder of its own, so it shares nothing with the person\'s browsing', () => {
    expect(args).toContain('--user-data-dir=D:\\game\\data\\window-pedro');
  });

  it('no first-run page, nothing left running behind a closed window, and no bubble after a hard stop', () => {
    for (const flag of ['--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--hide-crash-restore-bubble']) expect(args, flag).toContain(flag);
  });

  it('no extension is loaded beside the game, the machine\'s own or the browser\'s', () => {
    for (const flag of ['--disable-extensions', '--disable-component-extensions-with-background-pages']) expect(args, flag).toContain(flag);
  });

  it('no port is opened for another program to drive it', () => {
    expect(args.filter(a => a.startsWith('--remote-debugging'))).toEqual([]);
  });

  it('a person\'s own flags come first, split on spaces', () => {
    expect(windowArgs('http://localhost:3200', 'p', '  --start-fullscreen   --force-device-scale-factor=1.25 ').slice(0, 2)).toEqual(['--start-fullscreen', '--force-device-scale-factor=1.25']);
  });
});

/** A browser's process, as the launcher sees one. */
class FakeProcess extends EventEmitter {
  pid = 4242;
  killed: string[] = [];
  kill(signal?: string) { this.killed.push(signal ?? 'default'); return true; }
}

function fakeMachine(platform: NodeJS.Platform) {
  const started: { command: string; args: string[] }[] = [];
  const browser = new FakeProcess();
  let clock = 1_000;
  const spawn = ((command: string, args: string[]) => {
    started.push({ command, args });
    return started.length === 1 ? browser : new FakeProcess();
  }) as any;
  const view = openWindow({ address: 'http://localhost:3200', profile: 'p', browser: 'the-browser', spawn, platform, now: () => clock });
  return { started, browser, view, pass: (ms: number) => { clock += ms; } };
}

describe('a window, from open to closed', () => {
  it('starts the browser that was found, with the window\'s flags', () => {
    const { started } = fakeMachine('win32');
    expect(started[0].command).toBe('the-browser');
    expect(started[0].args).toEqual(windowArgs('http://localhost:3200', 'p'));
  });

  it('closed after it was open a while: it stayed, and the game can stop', async () => {
    const { browser, view, pass } = fakeMachine('win32');
    pass(WINDOW_SETTLES_MS + 1);
    browser.emit('exit', 0);
    expect(await view.closed).toEqual({ stayed: true });
  });

  it('ended at once: it handed over to a browser already open on that profile, and did not stay', async () => {
    const { browser, view, pass } = fakeMachine('win32');
    pass(200);
    browser.emit('exit', 0);
    expect(await view.closed).toEqual({ stayed: false });
  });

  it('a browser that cannot start says why', async () => {
    const { browser, view } = fakeMachine('win32');
    browser.emit('error', new Error('spawn the-browser ENOENT'));
    const end = await view.closed;
    expect(end.stayed).toBe(false);
    expect(end.error).toMatch(/ENOENT/);
  });

  it('on Windows, closing asks the window to close as a person would, with no force', () => {
    const { started, browser, view } = fakeMachine('win32');
    view.close();
    expect(started[1]).toEqual({ command: 'taskkill', args: ['/PID', '4242'] });
    expect(browser.killed).toEqual([]);
  });

  it('elsewhere, closing is the signal a browser closes cleanly on', () => {
    const { started, browser, view } = fakeMachine('linux');
    view.close();
    expect(started).toHaveLength(1);
    expect(browser.killed).toEqual(['SIGTERM']);
  });

  it('a window already closed is not closed again', async () => {
    const { started, browser, view, pass } = fakeMachine('win32');
    pass(WINDOW_SETTLES_MS + 1);
    browser.emit('exit', 0);
    await view.closed;
    view.close();
    expect(started).toHaveLength(1);
    expect(browser.killed).toEqual([]);
  });
});

describe('where it is wired', () => {
  it('npm run pedro:window is Pedro\'s game, built, in a window', () => {
    expect(JSON.parse(read('package.json')).scripts['pedro:window']).toBe('node --import tsx scripts/pedro.ts --window --built');
  });

  it('npm run pedro itself is as it was: the dev server, and no window', () => {
    expect(JSON.parse(read('package.json')).scripts.pedro).toBe('node --import tsx scripts/pedro.ts');
  });

  it('the window\'s profile sits beside his database, under the folder git never sees', () => {
    expect(read('scripts/pedro.ts')).toContain("'data/window-pedro'");
    expect(read('.gitignore')).toMatch(/^\/data\/\r?$/m);
  });

  it('the runner alone and the runner behind a window are one runner', () => {
    expect(read('server/main.ts')).toContain('startStandalone(');
    expect(read('scripts/pedro.ts')).toContain('startStandalone(');
  });

  it('the page asks a browser not to translate it, which a fresh profile in another language would offer', () => {
    const page = read('index.html');
    expect(page).toMatch(/<html[^>]*translate="no"/);
    expect(page).toMatch(/<meta name="google" content="notranslate"/);
  });
});

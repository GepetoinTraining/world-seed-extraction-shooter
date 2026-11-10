/**
 * THE GAME IN A WINDOW OF ITS OWN (Pedro, 2026-11-10: "use chromium or electron for my run ... moving away from
 * the browser inside the Claude code for my attempts because it's painful on memory").
 *
 * A Chromium browser already on the machine (Chrome, Edge, Chromium, Brave) is opened as an app window: no
 * tabs, no address bar, and a profile folder of its own. Nothing is installed and nothing is downloaded.
 * The address is the one the game always had, so whatever a person allowed for that origin, such as their
 * local model's allow list, still holds.
 *
 * THE PROFILE FOLDER is where that window's browser keeps a character's certificate and key
 * (src/entities/identity). A character made in another browser comes over with the game's own BACKUP and
 * RESTORE A BACKUP. Deleting the folder deletes what was made in it, as clearing a browser's data does.
 *
 * No port is opened for another program to drive the window. WS_BROWSER names another browser, and
 * WS_WINDOW_ARGS adds a person's own flags (--start-fullscreen, a scale factor), which come first.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface IBrowserSearch {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

/** Where each is installed, in the order they are tried. An install path is a fact about a machine, which is why WS_BROWSER overrides it. */
const WINDOWS_INSTALLS = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']
];
const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
];
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];

/** A Chromium browser on this machine, or null. One a person names is the only one tried. */
export function findBrowser(search: IBrowserSearch = {}): string | null {
  const env = search.env ?? process.env;
  const platform = search.platform ?? process.platform;
  const exists = search.exists ?? existsSync;

  const named = env.WS_BROWSER?.trim();
  if (named) return exists(named) ? named : null;

  if (platform === 'win32') {
    // Paths are built with a backslash whatever machine reads this, so a bar on another system reads a Windows machine the same way
    const bases = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((b): b is string => !!b);
    for (const install of WINDOWS_INSTALLS) {
      for (const base of bases) {
        const path = [base, ...install].join('\\');
        if (exists(path)) return path;
      }
    }
    return null;
  }
  if (platform === 'darwin') return MAC_APPS.find(exists) ?? null;

  const folders = (env.PATH ?? '').split(':').filter(Boolean);
  for (const name of PATH_NAMES) {
    for (const folder of folders) {
      const path = `${folder.replace(/\/+$/, '')}/${name}`;
      if (exists(path)) return path;
    }
  }
  return null;
}

/** What the browser is started with. A person's own flags come first. */
export function windowArgs(address: string, profile: string, extra = ''): string[] {
  return [
    ...extra.split(/\s+/).filter(Boolean),
    `--app=${address}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    // An extension installed for the whole machine would be loaded into this profile too, each in a process of its own
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    // Nothing stays running behind a closed window, so a closed window is a browser that has ended
    '--disable-background-mode',
    // A hard stop of the launcher is not a crash the person should be asked about
    '--hide-crash-restore-bubble'
  ];
}

/**
 * A browser that ends sooner than this after it was started did not show a window that someone then closed.
 * It handed the address to a browser already open on the same profile, or it never started.
 */
export const WINDOW_SETTLES_MS = 3000;

export interface IWindowEnd {
  /** True when the window was open for a while and then closed, which is the person stopping the game. */
  stayed: boolean;
  error?: string;
}

export interface IGameWindow {
  closed: Promise<IWindowEnd>;
  /** Asks the window to close, as a person would. */
  close(): void;
}

export interface IWindowOptions {
  address: string;
  profile: string;
  browser: string;
  extra?: string;
  spawn?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
  now?: () => number;
}

export function openWindow(options: IWindowOptions): IGameWindow {
  const spawn = options.spawn ?? nodeSpawn;
  const platform = options.platform ?? process.platform;
  const now = options.now ?? Date.now;

  const began = now();
  const child: ChildProcess = spawn(options.browser, windowArgs(options.address, options.profile, options.extra), { stdio: 'ignore' });
  let ended = false;

  const closed = new Promise<IWindowEnd>(done => {
    child.once('exit', () => { ended = true; done({ stayed: now() - began >= WINDOW_SETTLES_MS }); });
    child.once('error', e => { ended = true; done({ stayed: false, error: e.message }); });
  });

  return {
    closed,
    close: () => {
      if (ended) return;
      if (platform === 'win32' && child.pid) {
        // Without /F this is the close message a window gets from its own X: the browser saves its profile and ends.
        // A signal here would end it mid-write, and that profile holds a character's key.
        const ask = spawn('taskkill', ['/PID', String(child.pid)], { stdio: 'ignore' });
        ask.once('error', () => { if (!ended) child.kill(); });
        return;
      }
      child.kill('SIGTERM');
    }
  };
}

/**
 * THE GAME'S CLOCK, in the browser (D135). Every day the game reads comes from here, and not from
 * `Date.now()`, which a person moves by moving their computer's clock.
 *
 * It takes its time from this game's own server (/api/clock), which takes it from its hub when it
 * has one (DEPLOY.md), and between readings it counts on the browser's steady counter
 * (`performance.now()`), which changing the wall clock does not move. It never runs backward.
 *
 * Until it has been read once (a test, or a page with no server yet) it reads the browser's clock,
 * as the game always did, and says so: its source is 'browser'.
 */
import { addressOf, DAY_MS, IClockAddress } from './RadixClock';

export interface IClockReading {
  ok: boolean;
  now: number;
  /** Whose time this is: the hub's, the machine the game runs on, or nobody's yet. */
  source: 'hub' | 'machine';
  hub?: string;
  reason?: string;
}

export type ClockSource = 'hub' | 'machine' | 'browser';

/** What a row's signed text carries: the moment's address, and whose clock read it. */
export interface IClockStamp extends IClockAddress { by: string }

const REFRESH_MS = 10 * 60_000;

const defaultMonotonic = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function defaultRead(): Promise<IClockReading | null> {
  try {
    const res = await fetch('/api/clock', { cache: 'no-store' });
    const said = await res.json();
    return said?.ok && Number.isFinite(said.now) ? said : null;
  } catch {
    return null;
  }
}

let monotonic = defaultMonotonic;
let read = defaultRead;
let anchor: { now: number; mono: number; source: 'hub' | 'machine'; hub?: string } | null = null;
let last = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export const GameClock = {
  /** Test seams: the steady counter, and how a reading is taken. */
  configure(options: { monotonic?: () => number; read?: () => Promise<IClockReading | null> }) {
    if (options.monotonic) monotonic = options.monotonic;
    if (options.read) read = options.read;
  },

  /** Back to never having been read. */
  reset() {
    monotonic = defaultMonotonic;
    read = defaultRead;
    anchor = null;
    last = 0;
    if (timer) clearInterval(timer);
    timer = undefined;
  },

  /** Ask the server once. A reading that fails leaves the clock where it was. */
  async sync(): Promise<IClockReading | null> {
    const reading = await read();
    if (!reading?.ok || !Number.isFinite(reading.now)) return null;
    anchor = { now: reading.now, mono: monotonic(), source: reading.source === 'hub' ? 'hub' : 'machine', ...(reading.hub ? { hub: reading.hub } : {}) };
    return reading;
  },

  /** Read now, and again every so often, so a long session follows its hub. */
  keepInStep(everyMs = REFRESH_MS): Promise<IClockReading | null> {
    if (!timer && typeof setInterval !== 'undefined') timer = setInterval(() => { void GameClock.sync(); }, everyMs);
    return GameClock.sync();
  },

  now(): number {
    // Unread, it is the browser's clock exactly as before, wherever that clock is set
    if (!anchor) return Date.now();
    // Never backward: a reading behind the last one waits for time to catch up
    last = Math.max(last, Math.floor(anchor.now + (monotonic() - anchor.mono)));
    return last;
  },

  /** The game's day number: the Unix day, read from this clock. */
  day(): number {
    return Math.floor(GameClock.now() / DAY_MS);
  },

  source(): ClockSource {
    return anchor?.source ?? 'browser';
  },

  /** For a row's signed text. */
  stamp(ms = GameClock.now()): IClockStamp {
    return { ...addressOf(ms), by: anchor?.source === 'hub' ? anchor.hub ?? 'hub' : GameClock.source() };
  }
};

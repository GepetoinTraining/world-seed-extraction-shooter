/**
 * THE TIMER BARS: registered before the timer was built.
 * Line 124: no wait looks like a freeze. A wait with a known end fills a stepped bar and
 * says the time left; a wait with no known end moves a block and counts what has passed,
 * and never shows a percentage it cannot know.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { WAIT_STEPS, WaitClock, SWEEP_CELLS } from '../src/logic/systems/WaitClock';
import { WorldClock } from '../src/entities/world/WorldClock';
import { useWaits, whileWaiting, useHotbar } from '../src/components/ui/stores';
import { StatusClock } from '../shared/logic/systems/EffectSystem';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { usePlayerStore } from '../src/entities/player/store';
import { deployToWorld, OPENING_WORLD } from '../src/logic/systems/Deploy';
import { Busy, CycleRibbon, TimerBar } from '../src/components/ui/kit';
import { WaitStrip } from '../src/components/WaitStrip';
import { IPlayer } from '../shared/types';
import { worldPort } from '../src/entities/world/store';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const render = async (el: React.ReactElement) => { await act(async () => { root.render(el); }); };

beforeEach(() => {
  useWaits.setState({ waits: [] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.useRealTimers();
});

describe('a wait with a known end', () => {
  it('reads from empty to full, and the time left only falls', () => {
    expect(WaitClock.read(1000, 6000, 1000)).toEqual({ share: 0, leftMs: 5000, done: false });
    expect(WaitClock.read(1000, 6000, 3500).share).toBe(0.5);
    expect(WaitClock.read(1000, 6000, 6000)).toEqual({ share: 1, leftMs: 0, done: true });
    let share = -1, left = Infinity;
    for (let now = 0; now < 8000; now += 137) {
      const r = WaitClock.read(1000, 6000, now);
      expect(r.share).toBeGreaterThanOrEqual(share);
      expect(r.leftMs).toBeLessThanOrEqual(left);
      expect(r.share).toBeGreaterThanOrEqual(0);
      expect(r.share).toBeLessThanOrEqual(1);
      expect(r.leftMs).toBeGreaterThanOrEqual(0);
      share = r.share; left = r.leftMs;
    }
  });

  it('survives a wait of no length', () => {
    expect(WaitClock.read(500, 500, 500).done).toBe(true);
    expect(WaitClock.read(500, 400, 500).share).toBe(1);
  });

  it('redraws as often as a step moves, and no more than it must', () => {
    expect(WaitClock.tickMs(0, 5000)).toBe(5000 / WAIT_STEPS);
    expect(WaitClock.tickMs(0, 100)).toBeGreaterThanOrEqual(100);
    expect(WaitClock.tickMs(0, 86_400_000)).toBeLessThanOrEqual(1000); // the number still counts
  });

  it('the bar is a real meter, and says the time left', async () => {
    const now = Date.now();
    await render(React.createElement(TimerBar, { label: 'CHANNEL', startedAt: now - 2500, until: now + 2500 }));
    const meter = host.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-label')).toBe('CHANNEL');
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(2500);
    expect(Number(meter.getAttribute('aria-valuemax'))).toBe(5000);
    expect(host.textContent).toContain('0:03');
    const fill = host.querySelector('.ws-bar__fill') as HTMLElement;
    expect(parseInt(fill.style.width, 10) % 5).toBe(0); // twentieths: read, not eased
  });

  it('it moves by itself, with nobody rendering it', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await render(React.createElement(TimerBar, { startedAt: now, until: now + 5000 }));
    expect((host.querySelector('.ws-bar__fill') as HTMLElement).style.width).toBe('0%');
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect((host.querySelector('.ws-bar__fill') as HTMLElement).style.width).toBe('50%');
    expect(host.textContent).toContain('0:03');
  });
});

describe('a wait with no known end', () => {
  it('the block stays on the track, moves, and always lands the same', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 20_000; t += 90) {
      const cell = WaitClock.sweepAt(t);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(SWEEP_CELLS);
      expect(WaitClock.sweepAt(t)).toBe(cell);
      seen.add(cell);
    }
    expect(seen.size).toBe(SWEEP_CELLS);
  });

  it('counts what has passed, and offers no number it cannot know', async () => {
    const now = Date.now();
    await render(React.createElement(Busy, { label: 'WRITING', startedAt: now - 12_000 }));
    expect(host.textContent).toContain('WRITING');
    expect(host.textContent).toContain('0:12');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelector('[aria-valuenow]')).toBeNull();
    expect(host.querySelector('.ws-bar__fill')).toBeNull(); // a block, not a fill: they differ by shape
    expect(host.querySelector('.ws-busy__block')).not.toBeNull();
  });

  it('a wait too short to notice draws nothing', async () => {
    vi.useFakeTimers();
    await render(React.createElement(Busy, { label: 'OPENING', quietForMs: 300 }));
    expect(host.textContent).toBe('');
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(host.textContent).toContain('OPENING');
  });
});

describe('the gate has a cycle, and the card shows where in it you stand', () => {
  const world = { createdAt: 1000, size: 32 };

  it('the bands are the whole cycle, in the order the clock runs', () => {
    const { bands } = WorldClock.cycleAt(world, 1000)!;
    expect(bands.map(b => b.phase)).toEqual(['UP', 'OFF', 'SCAN']);
    expect(bands.reduce((sum, b) => sum + b.share, 0)).toBeCloseTo(1);
  });

  it('where it stands always lands in the band the clock says, at every size', () => {
    for (const size of [16, 24, 32, 64, 128]) {
      const w = { createdAt: 1000, size };
      const c = WorldClock.cadenceFor(size);
      const period = c.upMs + c.offMs + c.scanMs;
      for (let i = 0; i < 400; i++) {
        const now = 1000 + (period * 3 * i) / 400;
        const { bands, at } = WorldClock.cycleAt(w, now)!;
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThan(1);
        let edge = 0;
        const band = bands.find(b => { edge += b.share; return at < edge; })!;
        expect(band.phase).toBe(WorldClock.momentAt(w, now).phase);
      }
    }
  });

  it('a simulation stands outside the clock, and has no cycle', () => {
    expect(WorldClock.cycleAt({ createdAt: 0, size: 16, isDebug: true }, 5000)).toBeNull();
  });

  it('the ribbon tells its bands apart by shape, and marks the spot', async () => {
    await render(React.createElement(CycleRibbon, { cycle: WorldClock.cycleAt(world, 1000)! }));
    expect(host.querySelectorAll('.ws-ribbon__band--UP').length).toBe(1);
    expect(host.querySelectorAll('.ws-ribbon__band--OFF').length).toBe(1);
    expect(host.querySelectorAll('.ws-ribbon__band--SCAN').length).toBe(1);
    expect(host.querySelector('.ws-ribbon__at')).not.toBeNull();
  });
});

describe('what the city is working on', () => {
  const craft = (over: object) => ({ id: 'c', lotId: 'lot1', recipeId: 'plank', ownerCertUid: 'me', queuedAt: 0, finishesAt: 1000, collected: false, ...over }) as any;
  const build = (over: object) => ({ id: 'b', lotId: 'lot2', kind: 'PIECE', ownerCertUid: 'me', queuedAt: 0, finishesAt: 1000, applied: false, consumedIds: [], consumedDefIds: [], ...over }) as any;
  const name = (id: string) => `recipe ${id}`;

  it('one row a lot, spanning from the first start to the last finish', () => {
    const rows = WaitClock.hubWaits([
      craft({ id: 'a', queuedAt: 100, finishesAt: 900 }),
      craft({ id: 'b', queuedAt: 50, finishesAt: 2000 })
    ], [], 'me', name, 500);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt).toBe(50);
    expect(rows[0].until).toBe(2000);
  });

  it('a lone job goes by its own name', () => {
    expect(WaitClock.hubWaits([craft({})], [], 'me', name, 500)[0].label).toContain('RECIPE PLANK');
    expect(WaitClock.hubWaits([], [build({ kind: 'SHELL', structureType: 'HOUSE' })], 'me', name, 500)[0].label).toContain('HOUSE');
  });

  it('only what is yours, and only what is still running', () => {
    expect(WaitClock.hubWaits([craft({ ownerCertUid: 'them' })], [], 'me', name, 500)).toEqual([]);
    expect(WaitClock.hubWaits([craft({ finishesAt: 400 })], [], 'me', name, 500)).toEqual([]);
    expect(WaitClock.hubWaits([craft({ collected: true })], [], 'me', name, 500)).toEqual([]);
    expect(WaitClock.hubWaits([], [build({ applied: true })], 'me', name, 500)).toEqual([]);
  });

  it('nothing caps how many lots can be working', () => {
    const jobs = Array.from({ length: 500 }, (_, i) => craft({ id: `c${i}`, lotId: `lot${i}` }));
    expect(WaitClock.hubWaits(jobs, [], 'me', name, 500)).toHaveLength(500);
  });

  it('a finished job is told once, and a later one still is', () => {
    const told = new Set<string>();
    const jobs = [craft({ id: 'one', finishesAt: 100 }), craft({ id: 'two', finishesAt: 900 })];
    expect(WaitClock.newlyReady(jobs, 'me', told, 50)).toEqual([]);
    expect(WaitClock.newlyReady(jobs, 'me', told, 200).map(j => j.id)).toEqual(['one']);
    expect(WaitClock.newlyReady(jobs, 'me', told, 300)).toEqual([]);
    expect(WaitClock.newlyReady(jobs, 'me', told, 1000).map(j => j.id)).toEqual(['two']);
  });
});

describe('the waits the game is making right now', () => {
  it('begun and ended by name, and a second begin replaces the first', () => {
    useWaits.getState().begin({ id: 'x', label: 'A', startedAt: 1, until: 2 });
    useWaits.getState().begin({ id: 'x', label: 'B', startedAt: 1, until: 3 });
    expect(useWaits.getState().waits.map(w => w.label)).toEqual(['B']);
    useWaits.getState().end('x');
    expect(useWaits.getState().waits).toEqual([]);
  });

  it('a wait that fails still ends', async () => {
    await expect(whileWaiting('y', 'Y', async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(useWaits.getState().waits).toEqual([]);
    expect(await whileWaiting('y', 'Y', async () => 7)).toBe(7);
    expect(useWaits.getState().waits).toEqual([]);
  });

  it('the strip draws what is waiting, with the sheet shut or open, and goes when it ends', async () => {
    const now = Date.now();
    useWaits.getState().begin({ id: 'lock', label: 'BREAKING THE LOCKS', startedAt: now, until: now + 10_000 });
    await render(React.createElement(WaitStrip));
    expect(host.textContent).toContain('BREAKING THE LOCKS');
    await act(async () => { useWaits.getState().end('lock'); });
    expect(host.textContent).toBe('');
  });

  it('a wait past its end stops drawing, even if nobody ended it', async () => {
    const now = Date.now();
    useWaits.getState().begin({ id: 'old', label: 'STALE', startedAt: now - 2000, until: now - 1000 });
    await render(React.createElement(WaitStrip));
    expect(host.textContent).not.toContain('STALE');
  });
});

describe('what has a clock remembers when it started, so it can be drawn', () => {
  it('a status on the body', () => {
    const [s] = StatusClock.add([], { kind: 'slow', magnitude: 0.5, durationMs: 1000 }, 400);
    expect(s.startedAt).toBe(400);
    expect(s.until).toBe(1400);
  });

  it('a rest, with the same length it always had', () => {
    const p = usePlayerStore.getState().player;
    const tired: IPlayer = { ...p, currentSession: undefined, energyToday: 0 };
    const lying = RestSystem.beginRest(tired, 'INN', 5000);
    expect(lying.rest!.startedAt).toBe(5000);
    expect(lying.rest!.until - lying.rest!.startedAt!).toBe(RestSystem.restMs(tired));
  });
});

describe('the hand has a cooldown, and it reads on the hotbar', () => {
  it('a slow weapon says so; a shot too quick to see does not flicker', () => {
    useHotbar.setState({ cooldown: null });
    useHotbar.getState().fired('RIGHT_HAND', 100, 1200);
    expect(useHotbar.getState().cooldown).toEqual({ slot: 'RIGHT_HAND', startedAt: 100, ms: 1200 });
    useHotbar.setState({ cooldown: null });
    useHotbar.getState().fired('RIGHT_HAND', 100, 80);
    expect(useHotbar.getState().cooldown).toBeNull();
  });
});

describe('opening a world', () => {
  it('a second press while one is opening does nothing at all', async () => {
    useWaits.getState().begin({ id: OPENING_WORLD, label: 'OPENING', startedAt: Date.now() });
    expect(await deployToWorld('anything', worldPort)).toEqual({ ok: false });
  });
});

describe('no screen goes back to a bare number', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
  });
  const screens = [...files('src'), 'App.tsx'].map(path => ({ path, text: readFileSync(path, 'utf8') }));

  it.each([
    ['a bench counting seconds in words', /}s on the bench/],
    ['a build counting seconds in words', /}s on the clock/],
    ['a rest as a label alone', /AT REST \{WorldClock\.say/],
    ['a field rest as a label alone', /AT REST FOR \{WorldClock\.say/]
  ])('%s', (_name, pattern) => {
    expect(screens.filter(s => pattern.test(s.text)).map(s => s.path)).toEqual([]);
  });

  it('the identify clock lives where the HUD can read it, not in a window that can close', () => {
    const sheet = screens.find(s => s.path.endsWith('CharacterSheet.tsx'))!.text;
    expect(sheet).not.toMatch(/useState<\{ id: string; until: number \}/);
    expect(sheet).toMatch(/useWaits/);
  });

  it('the strip stands on every screen the game can be played from', () => {
    const app = screens.find(s => s.path === 'App.tsx')!.text;
    expect((app.match(/<WaitStrip \/>/g) ?? []).length).toBe(2);
  });
});

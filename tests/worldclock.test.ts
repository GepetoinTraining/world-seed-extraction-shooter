/**
 * THE WORLD CLOCK: lines 100–104, 119, 120. Registered before the build.
 * A world runs on its own clock, never a person's; a character's rest is its own loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IPlayer } from '../types';
import { WorldClock, IClockedWorld } from '../src/entities/world/WorldClock';
import { SurveySystem } from '../src/logic/systems/SurveySystem';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { StatSystem } from '../src/logic/systems/StatSystem';
import { Director, emptyDirectorRecord } from '../src/entities/world/Director';
import { EntityType, IWorldEntity } from '../src/entities/world/types';
import { useWorldStore, IWorldCard } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';
import { deployToWorld } from '../src/logic/systems/Deploy';
import { WorldCard } from '../src/components/MissionControl';
import { quickDeployTargetId } from '../src/entities/hub/dialogue';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';

installShippedThemes();

const M = 60_000, H = 60 * M, D = 24 * H;
const MINT = 1_000_000_000;
const small: IClockedWorld = { createdAt: MINT, size: 16 };
const at = (world: IClockedWorld, ms: number) => WorldClock.momentAt(world, MINT + ms);
const SRC = (p: string) => readFileSync(p, 'utf8');

describe("line 100: a world's phase is a pure function of its certificate and the time", () => {
  it('opens at mint, closes, goes dark, boots, opens again', () => {
    expect(at(small, 0).phase).toBe('UP');
    expect(at(small, H - 1).phase).toBe('UP');
    expect(at(small, H).phase).toBe('OFF');
    expect(at(small, H + 90 * M - 1).phase).toBe('OFF');
    expect(at(small, H + 90 * M).phase).toBe('SCAN');
    expect(at(small, 3 * H - 1).phase).toBe('SCAN');
    expect(at(small, 3 * H).phase).toBe('UP');
  });

  it('alpha is generation 0, and the world regenerates when it starts to boot', () => {
    expect(at(small, 0).generation).toBe(0);
    expect(at(small, H + M).generation).toBe(0);
    expect(at(small, H + 90 * M).generation).toBe(1);
    expect(at(small, 3 * H).generation).toBe(1);
    expect(at(small, 3 * H + H + 90 * M).generation).toBe(2);
  });

  it('every machine agrees, and it says how long is left and what comes next', () => {
    expect(at(small, 7 * H + 123)).toEqual(at(small, 7 * H + 123));
    const moment = at(small, 10 * M);
    expect(moment.msLeft).toBe(50 * M);
    expect(moment.next).toBe('OFF');
    expect(at(small, H).next).toBe('SCAN');
    expect(at(small, H + 90 * M).next).toBe('UP');
  });

  it('a clock running behind the mint reads as the moment of minting', () => {
    expect(WorldClock.momentAt(small, MINT - H).phase).toBe('UP');
    expect(WorldClock.momentAt(small, MINT - H).generation).toBe(0);
  });

  it('a world nobody watched catches up on opening, in one step, keeping what its fights said', () => {
    const fought = Director.report(emptyDirectorRecord(), 'FELLED_A_PERSON', 'kind');
    const caught = Director.catchUp(fought, 40);
    expect(caught.generation).toBe(40);
    expect(caught.weights.kind).toBeGreaterThan(1);
    expect(caught.felled).toEqual({});
    expect(Director.catchUp(caught, 40)).toBe(caught);
    expect(Director.catchUp(caught, 3)).toBe(caught);
  });

  it('a rest no longer turns a world', () => {
    expect(SRC('src/logic/systems/RestDoor.ts')).not.toMatch(/evolveAll/);
    expect(SRC('src/entities/world/store.ts')).toMatch(/DirectorStore\.catchUp/);
  });

  it('the simulation stands outside the clock', () => {
    const dev: IClockedWorld = { createdAt: MINT, size: 32, isDebug: true };
    for (const ms of [0, H, 5 * H, 40 * H]) {
      expect(at(dev, ms).phase).toBe('UP');
      expect(at(dev, ms).canDeploy).toBe(true);
      expect(at(dev, ms).warning).toBe('NONE');
    }
  });
});

describe("line 102: Pedro's cadences", () => {
  it.each([
    [16, H, 30 * M, 90 * M],
    [32, 4 * H, H, 5 * H],
    [64, 12 * H, 4 * H, 16 * H],
    [128, 5 * D, 2 * D, 7 * D]
  ])('size %i runs its own', (size, upMs, scanMs, offMs) => {
    expect(WorldClock.cadenceFor(size)).toEqual({ upMs, scanMs, offMs });
  });

  it('off equals up plus scan at every size he set', () => {
    for (const size of [16, 32, 64, 128]) {
      const c = WorldClock.cadenceFor(size);
      expect(c.offMs).toBe(c.upMs + c.scanMs);
    }
  });

  it('any other size reads the curve through them, and size has no ceiling', () => {
    const between = WorldClock.cadenceFor(24);
    expect(between.upMs).toBeGreaterThan(H);
    expect(between.upMs).toBeLessThan(4 * H);
    expect(WorldClock.cadenceFor(256).upMs).toBeGreaterThan(5 * D);
    expect(WorldClock.cadenceFor(8).upMs).toBeLessThan(H);
    expect(WorldClock.cadenceFor(8).upMs).toBeGreaterThan(0);
  });

  it('a cadence signed at mint is the one that runs, whatever a later build thinks', () => {
    const pinned: IClockedWorld = { createdAt: MINT, size: 16, cadence: { upMs: M, scanMs: M, offMs: M } };
    expect(at(pinned, 90_000).phase).toBe('OFF');
  });

  it('worlds on different mints stand at different phases, so somewhere can be open', () => {
    const later: IClockedWorld = { createdAt: MINT + 90 * M, size: 16 };
    const now = MINT + 95 * M;
    expect(WorldClock.momentAt(small, now).phase).toBe('OFF');
    expect(WorldClock.momentAt(later, now).phase).toBe('UP');
  });
});

describe('line 101: the gate', () => {
  const card = (over: Partial<IWorldCard>): IWorldCard => ({
    id: 'w1', seed: 'clock-world', size: 16, createdAt: MINT, playerCount: 0, name: 'CLOCK', difficulty: 'E', creator: 'x',
    extractionTaxRate: 0.05, deathPenalty: 'INVENTORY_LOSS', themeId: FIRST_THEME_PACK.themeId, ...over
  });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('during scan and off nobody can deploy, and it says why', async () => {
    useWorldStore.setState({ availableWorlds: [card({})] });
    vi.setSystemTime(MINT + H + M);
    const off = await deployToWorld('w1');
    expect(off.ok).toBe(false);
    expect(off.reason).toMatch(/gate/i);
    vi.setSystemTime(MINT + H + 90 * M + M);
    const scan = await deployToWorld('w1');
    expect(scan.ok).toBe(false);
    expect(scan.reason).toMatch(/boot|recon/i);
  });

  it('the card shows the state and the time left for every phase, in words', () => {
    const read = () => renderToStaticMarkup(createElement(WorldCard, { world: card({}), onDeploy: () => {}, onSurvey: () => {} }));
    vi.setSystemTime(MINT + 10 * M);
    expect(read()).toMatch(/GATE OPEN/);
    expect(read()).toMatch(/50:00/);
    expect(read()).toMatch(/DEPLOY/);
    vi.setSystemTime(MINT + H + M);
    expect(read()).toMatch(/GATE DOWN/);
    vi.setSystemTime(MINT + H + 90 * M + M);
    expect(read()).toMatch(/BOOTING/);
    expect(read()).toMatch(/RECON/);
    expect(read()).not.toMatch(/DEPLOY/);
  });

  it('quick deploy never sends anyone at a closed gate', () => {
    useWorldStore.setState({ availableWorlds: [card({ id: 'closed' }), card({ id: 'open', createdAt: MINT + H + M })] });
    vi.setSystemTime(MINT + H + 2 * M);
    expect(quickDeployTargetId()).toBe('open');
  });

  it('the collapse timer is gone', () => {
    expect(SRC('src/components/WorldCreator.tsx')).not.toMatch(/COLLAPSE TIMER/);
    expect(SRC('src/components/MissionControl.tsx')).not.toMatch(/REALITY COLLAPSE/);
    expect(SRC('src/entities/world/store.ts')).not.toMatch(/collapseTime/);
  });

  it('the mint signs a cadence and a sky', () => {
    const src = SRC('src/entities/world/WorldCertificate.ts');
    expect(src).toMatch(/cadence: WorldClock\.cadenceFor\(size\)/);
    expect(SRC('src/components/WorldCreator.tsx')).toMatch(/LOCKED/);
  });
});

describe('line 103: scanning decays', () => {
  const body = (id: string, over: Partial<IWorldEntity> = {}): IWorldEntity => ({
    id, type: EntityType.MOB, definitionId: 'mob_secret_name', position: { x: 0, y: 0 }, rank: 'E' as never, rarity: 'COMMON' as never, isHostile: true, ...over
  });

  it('what was scanned holds for the regeneration it was scanned in', () => {
    const entry = SurveySystem.entry(3, 5, [body('a')]);
    expect(SurveySystem.levelNow(entry, 5)).toBe(3);
  });

  it('the land keeps; who stands on it goes stale', () => {
    const entry = SurveySystem.entry(3, 5, [body('a')]);
    expect(SurveySystem.levelNow(entry, 6)).toBe(1);
    expect(SurveySystem.levelNow(entry, 60)).toBe(1);
    expect(SurveySystem.levelNow(SurveySystem.entry(1, 5, []), 6)).toBe(1);
  });

  it('it remembers what it saw and how long ago, and scanning again shows the change', () => {
    const old = SurveySystem.entry(3, 5, [body('a'), body('b')]);
    expect(SurveySystem.staleBy(old, 8)).toBe(3);
    expect(old.contacts).toEqual({ MOB: 2 });
    const next = SurveySystem.entry(3, 8, [body('a'), body('b'), body('c', { learned: ['spell'] })], old);
    expect(next.prior).toEqual({ contacts: { MOB: 2 }, changed: 0, generation: 5 });
    expect(next.contacts).toEqual({ MOB: 3 });
    expect(next.changed).toBe(1);
  });

  it('it belongs to the character and survives a save', () => {
    const player = { id: 'p', survey: {} } as unknown as IPlayer;
    const next = SurveySystem.record(player, 'w1', '2,3', SurveySystem.entry(2, 1, []));
    expect(next.survey!.w1['2,3'].level).toBe(2);
    expect(player.survey).toEqual({});
  });

  it('an unscanned sector stays unknown', () => {
    expect(SurveySystem.levelNow(undefined, 3)).toBe(0);
  });

  it('D60: the manifest never gives away a name or a kind', () => {
    const lines = SurveySystem.manifest([body('a'), body('b'), body('c', { displayName: 'Honored Hound' })]);
    const text = JSON.stringify(lines);
    expect(text).not.toContain('secret');
    expect(text).toContain('Honored Hound');
    expect(text).toContain('Unknown contact');
    expect(lines.find(l => l.label === 'Unknown contact')!.count).toBe(2);
  });
});

describe('line 104: day, night and the sky', () => {
  const turning = small;
  const skyAt = (world: IClockedWorld, ms: number, x = 0.5) => WorldClock.skyAt(world, MINT + ms, x);

  it("a day is half the up time, so a full visit sees exactly two, and it runs from the gate's opening", () => {
    expect(WorldClock.dayMs(WorldClock.cadenceFor(16))).toBe(30 * M);
    expect(skyAt(turning, 0).state).toBe('DAWN');
    expect(skyAt(turning, 10 * M).state).toBe('DAY');
    expect(skyAt(turning, 20 * M).state).toBe('NIGHT');
    expect(skyAt(turning, 40 * M).state).toBe('DAY');
    expect(skyAt(turning, 3 * H + 10 * M).state).toBe('DAY');
  });

  it('day is brighter than night', () => {
    expect(skyAt(turning, 10 * M).light).toBeGreaterThan(skyAt(turning, 20 * M).light);
  });

  it('a world of only night stays night', () => {
    const night: IClockedWorld = { ...small, sky: 'NIGHT' };
    for (const ms of [0, 10 * M, 40 * M, 9 * H]) {
      expect(skyAt(night, ms).state).toBe('NIGHT');
    }
  });

  it('a world that does not spin is decided by where you stand, never by the time', () => {
    const locked: IClockedWorld = { ...small, sky: 'LOCKED' };
    for (const ms of [0, 10 * M, 20 * M]) {
      expect(skyAt(locked, ms, 0.1).state).toBe('NIGHT');
      expect(skyAt(locked, ms, 0.5).state).toBe('DUSK');
      expect(skyAt(locked, ms, 0.9).state).toBe('DAY');
    }
  });

  it('the dark changes play: things notice you from further away', () => {
    const def = Object.values(MOB_DEFINITIONS).find(d => (d as { behavior: string }).behavior === 'AGGRESSIVE') as { id: string; baseHealth: number; viewRange: number };
    const reach = def.viewRange * 20 * 1.2;
    const chunks = () => ({
      '0,0': { id: 'c', x: 0, y: 0, biome: 'RUINS', entities: [{ id: `seen_${Math.random()}`, type: EntityType.MOB, definitionId: def.id, position: { x: 0, y: 0 }, rank: 'E', rarity: 'COMMON', health: def.baseHealth, isHostile: true }] }
    }) as never;
    const woke = (light: number) => {
      const world = chunks() as Record<string, { entities: IWorldEntity[] }>;
      MobAI.tick(world as never, { x: reach, y: 0 }, 0.05, undefined, { light });
      return MobAI.isActive(world['0,0'].entities[0].id);
    };
    expect(woke(1)).toBe(false);
    expect(woke(0)).toBe(true);
    expect(WorldClock.noticeFactor(0)).toBeGreaterThan(WorldClock.noticeFactor(1));
  });

  it('the field draws the dark, and reads it from the clock', () => {
    const src = SRC('src/components/WorldCanvas.tsx');
    expect(src).toMatch(/WorldClock\.skyAt/);
    expect(SRC('src/render/FieldRenderer.ts')).toMatch(/drawDark/);
  });
});

describe('line 119: a closing gate warns, gives time, and keeps who stays', () => {
  it('warns over the last sixth of the up time, then more loudly over its last tenth', () => {
    expect(at(small, 49 * M).warning).toBe('NONE');
    expect(at(small, 51 * M).warning).toBe('CLOSING');
    expect(at(small, 60 * M - 30_000).warning).toBe('FINAL');
    expect(at(small, H).warning).toBe('NONE');
  });

  it('the warning scales with the world', () => {
    const large: IClockedWorld = { createdAt: MINT, size: 64 };
    expect(at(large, 9 * H).warning).toBe('NONE');
    expect(at(large, 11 * H).warning).toBe('CLOSING');
  });

  it('the field reads the clock each frame and ends a run the gate closed on, through the one death path', () => {
    const src = SRC('src/components/WorldCanvas.tsx');
    expect(src).toMatch(/phase !== 'UP'/);
    expect(src).toMatch(/endRun\('GATE'\)/);
    expect(src).toMatch(/endRun\('HURT'\)/);
    expect(src).toMatch(/restAndCredit\('DIED'\)/);
  });

  it('the warning is drawn by shape, and the receipt says what happened', () => {
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/dashed/);
    expect(SRC('src/components/ReceiptScreen.tsx')).toMatch(/THE GATE CLOSED/);
  });
});

describe("line 120: a character's rest takes real time, scaled by what that character can carry", () => {
  const base = (over: Partial<IPlayer> = {}) => {
    const p = usePlayerStore.getState().player;
    return { ...p, currentSession: undefined, energyToday: undefined, rest: undefined, ...over } as IPlayer;
  };

  it('a rest takes time for the energy that was spent: quick from the start, and 500 is about 8 hours', () => {
    const trained = base();
    const hardy = { ...trained, equipment: { slots: { CHEST: 'long_day' }, frames: {}, items: [{ id: 'long_day', stats: { max_energy: 600 } }] } } as unknown as IPlayer;
    const full = StatSystem.maxEnergy(hardy.attributes, hardy.equipment);
    expect(full).toBeGreaterThan(500);
    const spent = (n: number) => RestSystem.restMs({ ...hardy, energyToday: full - n });
    expect(RestSystem.restMs(hardy)).toBe(0);
    expect(spent(3)).toBeLessThan(M);
    expect(spent(20)).toBeLessThan(5 * M);
    expect(spent(50)).toBeGreaterThanOrEqual(3 * M);
    expect(spent(50)).toBeLessThanOrEqual(4 * M);
    expect(spent(500)).toBe(8 * H);
    // Each further point costs more than the one before it
    expect(spent(20) - spent(10)).toBeGreaterThan(spent(10) - spent(0));
  });

  it('a character trained for a long shift has a long rest', () => {
    const p = base({ energyToday: 0 });
    const hardy = { ...p, attributes: { ...p.attributes, endurance: p.attributes.endurance + 90 } };
    expect(RestSystem.restMs(hardy)).toBeGreaterThan(RestSystem.restMs(p) * 1.5);
  });

  it('a rest begins, holds the character, and refuses a second', () => {
    const resting = RestSystem.beginRest(base({ energyToday: 0 }), 'INN', 1000);
    expect(RestSystem.isResting(resting, 1000)).toBe(true);
    expect(RestSystem.isResting(resting, 1000 + RestSystem.restMs(base({ energyToday: 0 })))).toBe(false);
    expect(RestSystem.canRest(resting, 'BED', 1001).ok).toBe(false);
  });

  it('energy returns on waking, not on lying down', () => {
    const resting = RestSystem.beginRest(base({ energyToday: 0, dayCount: 2 }), 'INN', 1000);
    expect(resting.energyToday).toBe(0);
    const awake = RestSystem.wake(resting);
    expect(awake.energyToday).toBeUndefined();
    expect(awake.rest).toBeUndefined();
    expect(awake.dayCount).toBe(3);
  });

  it('a hurt breaks a rest in the field, and nothing is restored', () => {
    const session = { energy: 1 } as NonNullable<IPlayer['currentSession']>;
    const resting = RestSystem.beginRest(base({ currentSession: session }), 'FIELD', 1000);
    const broken = RestSystem.breakRest(resting);
    expect(broken.rest).toBeUndefined();
    expect(broken.currentSession!.energy).toBe(1);
  });

  it('a resting character cannot deploy, and another can play', async () => {
    useWorldStore.setState({ availableWorlds: [{ id: 'dev', seed: 's', size: 32, createdAt: 0, playerCount: 0, isDebug: true, name: 'D', difficulty: 'D', creator: 'x', extractionTaxRate: 0, deathPenalty: 'NONE' }] });
    usePlayerStore.setState(s => ({ player: { ...s.player, rest: { until: Date.now() + H, place: 'INN' as const } } }));
    const refused = await deployToWorld('dev');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/rest/i);
    usePlayerStore.setState(s => ({ player: { ...s.player, rest: undefined } }));
  });

  it('it files to the door when it begins and collects on waking: its downtime is its own batch', () => {
    const src = SRC('src/logic/systems/RestDoor.ts');
    expect(src.indexOf('RestDoor.file(')).toBeLessThan(src.indexOf('async wakeIfDue'));
    expect(src.slice(src.indexOf('async wakeIfDue'))).toMatch(/RestDoor\.collect\(\)/);
  });
});

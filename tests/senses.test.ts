/**
 * STREAM A5: lines 109 and 127, registered before the build. Do not lower them to get a pass.
 *
 * Line 109 (N6): a hit is always felt, from any distance. Pedro: "I can literally kill
 * some beyond their line of sight, apparently even their pain receptors need generations."
 * What can evolve later is how it responds, never whether it notices.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { MobBehavior } from '../src/entities/mob/types';
import { EntityType, IChunk, IMap, IWorldEntity } from '../src/entities/world/types';
import { PROJECTILE_RANGE_PX } from '../src/entities/combat/projectileSystem';
import { TILE_PX } from '../src/entities/world/grid';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { GenreType, IPlayer, Rarity, UniversalRank } from '../types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Director, IDirectorRecord, emptyDirectorRecord } from '../src/entities/world/Director';
import { IClockedWorld, WorldClock } from '../src/entities/world/WorldClock';
import { ProgressionSystem } from '../src/entities/player/systems/ProgressionSystem';
import { TuningReadout } from '../src/logic/systems/TuningReadout';
import { MASTERY_RUNGS, RUNG_XP } from '../src/logic/systems/WebSystem';
import { PROCESS_SKILL_XP_PER_JOB } from '../src/logic/systems/ProcessSystem';
import { REST_MARK_ENERGY, REST_MARK_MS, RestSystem } from '../src/logic/systems/RestSystem';
import { StatSystem } from '../src/logic/systems/StatSystem';
import { TuningView } from '../src/components/debug/TuningPanel';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { installShippedThemes, FIRST_THEME_PACK } from '../src/logic/theme/boot';

/** Line 25's frame, and this tick's share of it. A guess registered before the build. */
const AWAKE_TICK_P95_MS = 4;
const AWAKE_BODIES = 300;

const KINDS: Record<string, { behavior: MobBehavior; viewRange: number; speed: number }> = {
  sense_aggressive: { behavior: MobBehavior.AGGRESSIVE, viewRange: 8, speed: 3 },
  sense_swarm: { behavior: MobBehavior.SWARM, viewRange: 8, speed: 3 },
  sense_siege: { behavior: MobBehavior.SIEGE, viewRange: 8, speed: 2 },
  sense_neutral: { behavior: MobBehavior.NEUTRAL, viewRange: 8, speed: 3 },
  sense_passive: { behavior: MobBehavior.PASSIVE, viewRange: 8, speed: 3 },
  sense_turret: { behavior: MobBehavior.TURRET, viewRange: 8, speed: 0 },
  sense_far: { behavior: MobBehavior.AGGRESSIVE, viewRange: 100, speed: 3 },
  sense_mid: { behavior: MobBehavior.AGGRESSIVE, viewRange: 50, speed: 3 }
};

beforeAll(() => {
  for (const [id, k] of Object.entries(KINDS)) {
    (MOB_DEFINITIONS as Record<string, unknown>)[id] = {
      id, name: id, genre: GenreType.FANTASY, rank: UniversalRank.F, rarity: Rarity.COMMON, size: 'MEDIUM',
      baseHealth: 100, baseDamage: 5, ...k
    };
  }
});
afterAll(() => { for (const id of Object.keys(KINDS)) delete (MOB_DEFINITIONS as Record<string, unknown>)[id]; });

const tiles = (n: number) => n * TILE_PX;
const body = (definitionId: string, x = 0, y = 0, id = 'body'): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId, position: { x, y },
  rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: true, health: 100
} as IWorldEntity);
const worldOf = (...bodies: IWorldEntity[]): Record<string, IChunk> => ({
  '0,0': { id: 'c', x: 0, y: 0, biome: 'RUINS', entities: bodies } as unknown as IChunk
});

type Spot = { x: number; y: number };
/** Runs the tick over a stretch of time, with the person where `at` says at each moment. */
const run = (chunks: Record<string, IChunk>, at: Spot | ((ms: number) => Spot), ms: number, senses = {}) => {
  const patterns: unknown[] = [];
  const step = 50;
  for (let t = 0; t < ms; t += step) {
    vi.advanceTimersByTime(step);
    const out = MobAI.tick(chunks, typeof at === 'function' ? at(t) : at, step / 1000, undefined, senses);
    patterns.push(...out.spawnedPatterns);
    chunks = { ...chunks, ...out.updatedChunks };
  }
  return { chunks, patterns, mob: chunks['0,0'].entities[0] };
};
const from = (mob: IWorldEntity, spot: Spot) => Math.hypot(mob.position.x - spot.x, mob.position.y - spot.y);

describe('line 109: a hit is always felt, from any distance', () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const shooter = { x: PROJECTILE_RANGE_PX, y: 0 };

  it('the field still calls the door on a hit, so there is one way a creature learns of it', () => {
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/event\.type === 'HIT'[^\n]*MobAI\.provoke\(event\.entityId/);
  });

  for (const kind of Object.keys(KINDS)) {
    it(`${kind}: hit from as far as a weapon reaches, it wakes and stays awake`, () => {
      const world = worldOf(body(kind));
      run(world, shooter, 200);
      MobAI.provoke('body');
      const after = run(world, shooter, 5000);
      expect(MobAI.isActive('body')).toBe(true);
      expect(after.mob.health).toBe(100);
    });
  }

  it('the distance does not matter: a hit from a very long way off is still felt', () => {
    const world = worldOf(body('sense_aggressive'));
    const far = { x: tiles(4000), y: 0 };
    MobAI.provoke('body');
    const { mob } = run(world, far, 4000);
    expect(MobAI.isActive('body')).toBe(true);
    expect(mob.position.x).toBeGreaterThan(0);
  });

  it('an aggressive thing heads for where the hit came from, at its own pace', () => {
    MobAI.provoke('body');
    const { mob } = run(worldOf(body('sense_aggressive')), shooter, 2000);
    expect(mob.position.x).toBeCloseTo(KINDS.sense_aggressive.speed * TILE_PX * 2, -1);
    expect(mob.position.y).toBe(0);
  });

  it('it goes to where the hit came from, not to where you went after it', () => {
    MobAI.provoke('body');
    const spot = shooter;
    const gone = { x: PROJECTILE_RANGE_PX, y: tiles(300) };
    const { mob } = run(worldOf(body('sense_aggressive')), t => (t === 0 ? spot : gone), 12_000);
    expect(from(mob, spot)).toBeLessThan(tiles(1));
    expect(MobAI.isActive('body')).toBe(true);
  });

  it('when it gets there and you have gone, it stays there, awake', () => {
    MobAI.provoke('body');
    const gone = { x: tiles(300), y: tiles(300) };
    const first = run(worldOf(body('sense_aggressive')), t => (t === 0 ? shooter : gone), 12_000);
    const later = run(first.chunks, gone, 5000);
    expect(later.mob.position).toEqual(first.mob.position);
    expect(MobAI.isActive('body')).toBe(true);
  });

  it('once you are in its sight it comes for you, wherever the hit came from', () => {
    const world = worldOf(body('sense_aggressive'));
    MobAI.provoke('body');
    const near = { x: tiles(4), y: tiles(4) };
    const { mob } = run(world, t => (t === 0 ? shooter : near), 2500);
    expect(from(mob, near)).toBeLessThan(tiles(3));
  });

  it('when it loses sight of you it goes where it last saw you, not back to the old hit', () => {
    const hit = { x: -tiles(100), y: 0 };
    const seen = { x: tiles(5), y: 0 };
    const gone = { x: tiles(5), y: tiles(300) };
    MobAI.provoke('body');
    const { mob } = run(worldOf(body('sense_aggressive')), t => (t === 0 ? hit : t < 500 ? seen : gone), 6000);
    expect(from(mob, seen)).toBeLessThan(tiles(1));
    expect(mob.position.x).toBeGreaterThan(0);
  });

  it('a second hit from a new place sends it there instead', () => {
    const first = run(worldOf(body('sense_aggressive')), { x: tiles(100), y: 0 }, 50);
    MobAI.provoke('body');
    const a = run(first.chunks, { x: tiles(100), y: 0 }, 1000);
    MobAI.provoke('body');
    const other = { x: 0, y: tiles(100) };
    const b = run(a.chunks, other, 2000);
    expect(b.mob.position.y).toBeGreaterThan(tiles(4));
    expect(b.mob.position.x).toBeLessThan(a.mob.position.x);
  });

  it('a passive thing flees from it, and never attacks', () => {
    MobAI.provoke('body');
    const { mob, patterns } = run(worldOf(body('sense_passive')), shooter, 2000);
    expect(mob.position.x).toBeLessThan(0);
    expect(patterns).toEqual([]);
    expect(MobAI.isActive('body')).toBe(true);
  });

  it('a passive thing stops running once it is well away, and stays awake', () => {
    MobAI.provoke('body');
    const first = run(worldOf(body('sense_passive')), shooter, 20_000);
    const later = run(first.chunks, shooter, 2000);
    expect(later.mob.position).toEqual(first.mob.position);
    expect(MobAI.isActive('body')).toBe(true);
  });

  it('a neutral thing turns on you from out of its sight', () => {
    MobAI.provoke('body');
    const { mob } = run(worldOf(body('sense_neutral')), shooter, 2000);
    expect(mob.position.x).toBeGreaterThan(tiles(3));
    expect(MobAI.isActive('body')).toBe(true);
  });

  it('a neutral thing still ignores you, however near, until you harm it', () => {
    const { mob, patterns } = run(worldOf(body('sense_neutral')), { x: tiles(1), y: 0 }, 4000);
    expect(mob.position).toEqual({ x: 0, y: 0 });
    expect(patterns).toEqual([]);
    expect(MobAI.isActive('body')).toBe(false);
  });

  it('a turret stays put and looks where the hit came from', () => {
    MobAI.provoke('body');
    const { mob } = run(worldOf(body('sense_turret')), { x: 0, y: -tiles(20) }, 1000);
    expect(mob.position).toEqual({ x: 0, y: 0 });
    expect(MobAI.pose('body')?.facing).toBe('up');
    MobAI.provoke('body');
    run(worldOf(body('sense_turret')), { x: tiles(20), y: 0 }, 1000);
    expect(MobAI.pose('body')?.facing).toBe('right');
  });

  it('a swarm and a siege head there as well', () => {
    for (const kind of ['sense_swarm', 'sense_siege']) {
      MobAI.reset();
      MobAI.provoke('body');
      const { mob } = run(worldOf(body(kind)), shooter, 2000);
      expect(mob.position.x, kind).toBeGreaterThan(tiles(2));
    }
  });

  it('being woken is not being struck: what is hit in reach still winds up first', () => {
    MobAI.provoke('body');
    const { patterns } = run(worldOf(body('sense_neutral')), { x: tiles(1), y: 0 }, 300);
    expect(patterns).toEqual([]);
  });

  it('a trunk on the line does not stop it: it turns aside and still gets there', () => {
    const refused = (x: number, y: number) => x > tiles(3) && x < tiles(4) && Math.abs(y) < tiles(2);
    // As the real resolver does: each axis on its own, so a line nearly along a wall still creeps.
    const spy = vi.spyOn(WorldGenerator, 'resolveMove').mockImplementation((_map, x, y, dx, dy) => {
      const nx = refused(x + dx, y) ? x : x + dx;
      return { x: nx, z: refused(nx, y + dy) ? y : y + dy, speedMod: 1 };
    });
    const map = { generatedAt: 7 } as unknown as IMap;
    const spot = { x: tiles(8), y: 0 };
    let world = worldOf(body('sense_aggressive', 0, 0.5));
    const gone = { x: tiles(8), y: tiles(300) };
    MobAI.tick(world, spot, 0.05, map);
    MobAI.provoke('body');
    let crossed = false;
    for (let i = 0; i < 400; i++) {
      vi.advanceTimersByTime(50);
      const out = MobAI.tick(world, i === 0 ? spot : gone, 0.05, map);
      world = { ...world, ...out.updatedChunks };
      const at = world['0,0'].entities[0].position;
      expect(refused(at.x, at.y)).toBe(false);
      crossed = crossed || at.x > tiles(4);
    }
    spy.mockRestore();
    expect(crossed).toBe(true);
    expect(from(world['0,0'].entities[0], spot)).toBeLessThan(tiles(1));
  });

  it('water between it and the spot: it tries, then stands awake instead of pacing the shore', () => {
    const spy = vi.spyOn(WorldGenerator, 'resolveMove').mockImplementation((_map, x, y, dx, dy) => {
      const nx = x + dx > tiles(3) ? x : x + dx;
      return { x: nx, z: y + dy, speedMod: 1 };
    });
    const map = { generatedAt: 8 } as unknown as IMap;
    const spot = { x: tiles(9), y: 0 };
    const gone = { x: tiles(9), y: tiles(300) };
    let world = worldOf(body('sense_aggressive', 0, 0.5));
    MobAI.tick(world, spot, 0.05, map);
    MobAI.provoke('body');
    const step = () => {
      vi.advanceTimersByTime(50);
      const out = MobAI.tick(world, gone, 0.05, map);
      world = { ...world, ...out.updatedChunks };
      return { ...world['0,0'].entities[0].position };
    };
    MobAI.tick(world, spot, 0.05, map);
    let at = step();
    for (let i = 0; i < 400; i++) at = step();
    expect(at.x).toBeGreaterThan(tiles(2.5));
    for (let i = 0; i < 60; i++) expect(step()).toEqual(at);
    expect(MobAI.pose('body')?.moving).toBe(false);
    expect(MobAI.isActive('body')).toBe(true);
    spy.mockRestore();
  });

  it('nothing harmed, nothing changes: a chase that loses you still gives up', () => {
    const world = worldOf(body('sense_aggressive'));
    run(world, { x: tiles(4), y: 0 }, 100);
    expect(MobAI.isActive('body')).toBe(true);
    run(world, { x: tiles(100), y: 0 }, 100);
    expect(MobAI.isActive('body')).toBe(false);
  });

  it('a hit does not carry to another opening of the world: a new map, new memory', () => {
    const land = WorldGenerator.generate('senses-memory', 16);
    const mapOf = (generatedAt: number): IMap => ({ ...land, generatedAt });
    const world = worldOf(body('sense_aggressive'));
    MobAI.tick(world, shooter, 0.05, mapOf(1));
    MobAI.provoke('body');
    MobAI.tick(world, shooter, 0.05, mapOf(1));
    expect(MobAI.isActive('body')).toBe(true);
    MobAI.tick(world, shooter, 0.05, mapOf(2));
    expect(MobAI.isActive('body')).toBe(false);
  });
});

describe('line 109: sight has no fixed cap', () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const wakes = (kind: string, at: number, senses = {}) => {
    MobAI.reset();
    run(worldOf(body(kind)), { x: tiles(at), y: 0 }, 50, senses);
    return MobAI.isActive('body');
  };

  it('a creature with long sight sees as far as its definition says', () => {
    expect(wakes('sense_mid', 40)).toBe(true);
    expect(wakes('sense_mid', 60)).toBe(false);
    expect(wakes('sense_far', 90)).toBe(true);
    expect(wakes('sense_far', 110)).toBe(false);
  });

  it('short sight stays short', () => {
    expect(wakes('sense_aggressive', 7)).toBe(true);
    expect(wakes('sense_aggressive', 9)).toBe(false);
  });

  it('the noise and light factors still move it, past the old cap too', () => {
    expect(wakes('sense_mid', 45, { noiseReduction: 20 })).toBe(false);
    expect(wakes('sense_mid', 60, { light: 0 })).toBe(true);
  });

  it('the source holds no ceiling on sight', () => {
    const src = readFileSync('src/entities/mob/ai/MobAI.ts', 'utf8');
    expect(src).not.toMatch(/Math\.min\([^)]*viewRange/);
  });

  it('the give-up distance is not a hidden cap: it grows with sight', () => {
    const world = worldOf(body('sense_far'));
    run(world, { x: tiles(90), y: 0 }, 50);
    expect(MobAI.isActive('body')).toBe(true);
    run(world, { x: tiles(190), y: 0 }, 50);
    expect(MobAI.isActive('body')).toBe(true);
    run(world, { x: tiles(210), y: 0 }, 50);
    expect(MobAI.isActive('body')).toBe(false);
  });

  it('short sight keeps its floor: a chase holds to at least sixteen tiles', () => {
    const world = worldOf(body('sense_aggressive'));
    run(world, { x: tiles(7), y: 0 }, 50);
    run(world, { x: tiles(15), y: 0 }, 50);
    expect(MobAI.isActive('body')).toBe(true);
  });
});

describe('line 25: awake bodies stay inside the frame', () => {
  it(`${AWAKE_BODIES} bodies that have all been hit take a small share of a frame`, () => {
    MobAI.reset();
    const map = WorldGenerator.generate('senses-budget', 16);
    const center = 8 * 512 * TILE_PX;
    // What was born knowing magic asks more of each tick, so they stand in the count too
    installShippedThemes();
    const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
    const casters = Object.values(compiled.mobs).filter(m => m.innate.length > 0);
    expect(casters.length).toBeGreaterThan(0);
    for (const c of casters) (MOB_DEFINITIONS as Record<string, unknown>)[c.id] = c;
    const kinds = [...Object.keys(KINDS), ...casters.map(c => c.id)];
    const bodies = Array.from({ length: AWAKE_BODIES }, (_, i) =>
      body(kinds[i % kinds.length], center + (i % 20) * tiles(3), center + Math.floor(i / 20) * tiles(3), `b${i}`));
    bodies.forEach(b => MobAI.provoke(b.id));
    let world = worldOf(...bodies);
    const person = { x: center - tiles(200), y: center };
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const started = performance.now();
      const out = MobAI.tick(world, person, 1 / 60, map);
      times.push(performance.now() - started);
      world = { ...world, ...out.updatedChunks };
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    for (const c of casters) delete (MOB_DEFINITIONS as Record<string, unknown>)[c.id];
    console.log(`AWAKE TICK ${AWAKE_BODIES} bodies: p95 ${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThan(AWAKE_TICK_P95_MS);
  });
});

// ---------------------------------------------------------------------------
// Line 127: D84, "add this for us to check the chance of things changing"
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const small: IClockedWorld = { createdAt: 1_000_000, size: 16 };
const fresh = (over: Partial<IDirectorRecord> = {}): IDirectorRecord => ({ ...emptyDirectorRecord(), ...over });
const KINDS_READ = [{ id: 'kind_a', name: 'A' }, { id: 'kind_b', name: 'B' }];

describe('line 127: the chance of a body changing', () => {
  it('a small world makes 8 regenerations a day, and a larger one fewer', () => {
    expect(TuningReadout.regenerationsPerDay(small)).toBe(8);
    expect(TuningReadout.regenerationsPerDay({ createdAt: 0, size: 64 })).toBeLessThan(8);
    expect(TuningReadout.regenerationsPerDay({ createdAt: 0, size: 16, isDebug: true })).toBe(0);
  });

  it('says when each generation begins, as the clock itself reads it', () => {
    for (const generation of [1, 2, 9, 40]) {
      const start = TuningReadout.whenGeneration(small, generation);
      expect(WorldClock.momentAt(small, start).generation).toBe(generation);
      expect(WorldClock.momentAt(small, start).phase).toBe('SCAN');
      expect(WorldClock.momentAt(small, start - 1).generation).toBe(generation - 1);
    }
    expect(TuningReadout.whenGeneration(small, 0)).toBe(small.createdAt);
  });

  it('reads the Director itself, per kind, now and ahead', () => {
    const record = fresh({ generation: 4, weights: { kind_a: 2, kind_b: 0.5 } });
    const now = TuningReadout.whenGeneration(small, 4);
    const read = TuningReadout.readWorld(small, record, KINDS_READ, now, [0, 1, 8]);
    expect(read.generation).toBe(4);
    for (const kind of read.kinds) {
      for (const at of kind.at) {
        expect(at.generation).toBe(4 + at.ahead);
        expect(at.chance).toBe(Director.traitChance({ ...record, generation: at.generation }, kind.id));
      }
    }
    expect(read.kinds[0].at[0].chance).toBeGreaterThan(read.kinds[1].at[0].chance);
    expect(read.kinds[0].weight).toBe(2);
    expect(read.kinds[1].weight).toBe(0.5);
  });

  it('a kind nobody has fought reads weight 1', () => {
    const read = TuningReadout.readWorld(small, fresh(), [{ id: 'kind_new', name: 'New' }], small.createdAt, [0]);
    expect(read.kinds[0].weight).toBe(1);
  });

  it('in a small world, a fresh kind passes certainty in about three days', () => {
    const read = TuningReadout.readWorld(small, fresh(), KINDS_READ, small.createdAt, [0]);
    const certain = read.kinds[0].certainAt!;
    expect(Director.traitChance(fresh({ generation: certain.generation }), 'kind_a')).toBeGreaterThanOrEqual(1);
    expect(Director.traitChance(fresh({ generation: certain.generation - 1 }), 'kind_a')).toBeLessThan(1);
    expect(certain.msFromNow / DAY).toBeGreaterThan(2.5);
    expect(certain.msFromNow / DAY).toBeLessThan(3.5);
  });

  it('what wore people down gets there sooner, and what fell at once later', () => {
    const record = fresh({ weights: { kind_a: 3, kind_b: 0.25 } });
    const read = TuningReadout.readWorld(small, record, KINDS_READ, small.createdAt, [0]);
    const baseline = TuningReadout.firstCertain(fresh(), 'kind_a')!;
    expect(read.kinds[0].certainAt!.generation).toBeLessThan(baseline);
    expect(read.kinds[1].certainAt!.generation).toBeGreaterThan(baseline);
  });

  it('a kind already past certainty says so now, and the chance is shown past 1 rather than held there', () => {
    const record = fresh({ generation: 40, weights: { kind_a: 2 } });
    const read = TuningReadout.readWorld(small, record, KINDS_READ, TuningReadout.whenGeneration(small, 40), [0]);
    expect(read.kinds[0].at[0].chance).toBeGreaterThan(1);
    expect(read.kinds[0].certainAt).toEqual({ generation: 40, msFromNow: 0 });
  });

  it('a world nobody watched reads where it stands by the clock, with its fights counted once, as opening it would', () => {
    const record = fresh({ generation: 2, felled: { kind_a: 3 } });
    const now = TuningReadout.whenGeneration(small, 7);
    const read = TuningReadout.readWorld(small, record, KINDS_READ, now, [0]);
    expect(read.generation).toBe(7);
    expect(read.recordGeneration).toBe(2);
    const opened = Director.catchUp(record, 7);
    expect(read.kinds[0].at[0].chance).toBe(Director.traitChance(opened, 'kind_a'));
  });

  it('a simulation stands outside the clock: no regeneration, no date', () => {
    const read = TuningReadout.readWorld({ ...small, isDebug: true }, fresh(), KINDS_READ, small.createdAt, [0, 4]);
    expect(read.clocked).toBe(false);
    expect(read.nextRegenerationMs).toBeNull();
    expect(read.kinds[0].certainAt).toBeNull();
  });

  it('says how long until the next regeneration', () => {
    const read = TuningReadout.readWorld(small, fresh(), KINDS_READ, small.createdAt, [0]);
    expect(read.nextRegenerationMs).toBe(HOUR + 1.5 * HOUR);
  });

  it('the learn chance is what the Director really does, measured through its door', () => {
    const share = TuningReadout.learnShare();
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    const id = 'kind_real';
    const record = fresh({ generation: 5, weights: { [id]: 1.5 } });
    const chance = Director.traitChance(record, id);
    const bodies = 20_000;
    let learned = 0;
    for (let i = 0; i < bodies; i++) {
      if (Director.variantOf('another_seed', `check_${i}`, id, id, record, { affixes: [], abilities: ['x'] }).learned.length > 0) learned++;
    }
    expect(Math.abs(learned / bodies - chance * share)).toBeLessThan(0.01);
    const at = TuningReadout.readWorld(small, record, [{ id, name: id }], TuningReadout.whenGeneration(small, 5), [0]).kinds[0].at[0];
    expect(at.learn).toBeCloseTo(chance * share, 6);
  });
});

describe('line 127: how long skills, levels and a rest take', () => {
  it('each rung reads RUNG_XP: a total, its own gap, and rising gaps', () => {
    const rows = TuningReadout.skillRungs(60);
    expect(rows.map(r => r.name)).toEqual([...MASTERY_RUNGS]);
    expect(rows.map(r => r.totalXp)).toEqual([...RUNG_XP]);
    rows.forEach((r, i) => { if (i > 0) expect(r.xp).toBe(RUNG_XP[i] - RUNG_XP[i - 1]); });
    expect(rows[3].xp).toBeGreaterThan(rows[2].xp);
    expect(rows[1].jobs).toBe(Math.ceil(rows[1].xp / PROCESS_SKILL_XP_PER_JOB));
  });

  it('going twice as fast takes half as long, so the pace is only ever an assumption', () => {
    const slow = TuningReadout.skillRungs(30), fast = TuningReadout.skillRungs(60);
    expect(slow[1].ms).toBe(fast[1].ms * 2);
    expect(fast[1].ms).toBe((fast[1].jobs / 60) * HOUR);
  });

  it('each level reads getXpToNextLevel and getXpForLevel', () => {
    const rows = TuningReadout.levels([1, 2, 10], 60);
    rows.forEach(r => {
      expect(r.xp).toBe(ProgressionSystem.getXpToNextLevel(r.level));
      expect(r.totalXp).toBe(ProgressionSystem.getXpForLevel(r.level + 1));
    });
    expect(rows[2].ms).toBeGreaterThan(rows[1].ms);
  });

  it('a level counts the kills it takes, at a chosen rank, from the real reward', () => {
    const atF = TuningReadout.levels([5], 60, UniversalRank.F)[0];
    const atA = TuningReadout.levels([5], 60, UniversalRank.A)[0];
    expect(atF.kills).toBe(Math.ceil(atF.xp / ProgressionSystem.calculateKillXp(UniversalRank.F, Rarity.COMMON)));
    expect(atA.kills).toBeLessThan(atF.kills);
  });

  it('the rest curve is RestSystem.restMs, at real energy, for this body', () => {
    const player = { attributes: { endurance: 10 }, equipment: undefined } as unknown as IPlayer;
    const full = StatSystem.maxEnergy(player.attributes, player.equipment);
    const rows = TuningReadout.restCurve(player, [0, 0.5, 1]);
    expect(rows[0]).toEqual({ spent: 0, share: 0, ms: 0 });
    const half = rows.find(r => r.spent === Math.round(full / 2))!;
    expect(half.ms).toBe(RestSystem.restMs({ ...player, energyToday: full - half.spent }));
    expect(rows.find(r => r.spent === full)!.ms).toBeGreaterThan(half.ms);
  });

  it('the rest curve holds the mark it is anchored on', () => {
    const player = { attributes: { endurance: 10 }, equipment: undefined } as unknown as IPlayer;
    const mark = TuningReadout.restCurve(player, [1]).find(r => r.spent === REST_MARK_ENERGY)!;
    expect(mark.ms).toBe(REST_MARK_MS);
  });
});

describe('line 127: it reads, it tunes nothing, and it copies nothing', () => {
  const SOURCE = readFileSync('src/logic/systems/TuningReadout.ts', 'utf8');
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

  it('imports its numbers by name from the modules that own them', () => {
    for (const name of ['Director', 'RUNG_XP', 'MASTERY_RUNGS', 'ProgressionSystem', 'RestSystem', 'WorldClock', 'PROCESS_SKILL_XP_PER_JOB']) {
      expect(code).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b`));
    }
  });

  it('holds none of their numbers', () => {
    for (const copied of [/\b0\.08\b/, /\b0\.04\b/, /\b0\.15\b/, /\b420\b/, /\b180\b/, /\b2\.1\b/, /BASE_LEVEL_XP/, /\b1\.5\b/]) {
      expect(code).not.toMatch(copied);
    }
  });

  it('writes nothing: no store, no save, no database', () => {
    expect(code).not.toMatch(/setState|\.save\(|VectorStore|DirectorStore|usePlayerStore|useWorldStore/);
    const record = fresh({ generation: 2, felled: { kind_a: 3 } });
    const before = JSON.stringify(record);
    TuningReadout.readWorld(small, record, KINDS_READ, TuningReadout.whenGeneration(small, 7), [0, 1]);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('the panel only loads the record, and never catches it up in the database', () => {
    const panel = readFileSync('src/components/debug/TuningPanel.tsx', 'utf8');
    expect(panel).toMatch(/DirectorStore\.load\(/);
    expect(panel).not.toMatch(/DirectorStore\.(save|catchUp)\(|setState/);
  });

  it('sits behind the dev switch, beside the other dev tabs', () => {
    const app = readFileSync('App.tsx', 'utf8');
    expect(app).toMatch(/DEV_TABS[\s\S]*\{ id: 'TUNING', label: 'TUNING' \}/);
    expect(app).toMatch(/view === 'TUNING' && devMode && <TuningPanel/);
  });

  it('turning the dev switch off on that tab does not leave a blank screen', () => {
    const app = readFileSync('App.tsx', 'utf8');
    expect(app).toMatch(/\(view === 'HUB' \|\| \(view === 'TUNING' && !devMode\)\) && <HubCanvas/);
  });

  it('draws past certainty by shape and words, never by hue alone', () => {
    const markup = renderToStaticMarkup(createElement(TuningView, {
      name: 'THE WORLD',
      read: TuningReadout.readWorld(small, fresh({ generation: 40 }), KINDS_READ, TuningReadout.whenGeneration(small, 40), [0, 1]),
      learnShare: 0.2, rungs: TuningReadout.skillRungs(60), levels: TuningReadout.levels([1], 60), rest: [], jobsPerHour: 60, killsPerHour: 60
    }));
    expect(markup).toMatch(/PAST 1/);
    expect(markup).toMatch(/an assumption/i);
    expect(markup).toMatch(/role="meter"/);
  });
});

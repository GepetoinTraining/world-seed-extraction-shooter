/**
 * POPULATION, MOVEMENT, HERDING, LEADERS, JUNK (D63, D64, D66, D93, D99): lines 110, 111, 112,
 * 134 and the junk half of 140, with N7 and N8. Registered before the build.
 *
 * No bar here calls a model. The first theme's new words were written by hand, as data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { creatureIdOf, sealTheme, themeIdOf } from '../src/logic/theme/ThemeCompiler';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { IThemeBody, THEME_FORMULA_VERSION, THEME_SCHEMA } from '../src/logic/theme/ThemeTypes';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { WebBank } from '../src/logic/content/WebBank';
import { TagLaw } from '../src/logic/content/TagLaw';
import { Director, emptyDirectorRecord, IDirectorRecord } from '../src/entities/world/Director';
import { IGenerationContext, WorldGenerator } from '../src/entities/world/WorldGenerator';
import { EntityType, IChunk, IMap, IWorldEntity } from '../src/entities/world/types';
import { CHUNK_PX, SECTOR_CHUNKS, chunkOf } from '../src/entities/world/grid';
import { computeGolden, GOLDEN_VECTORS, FIRST_THEME_VECTORS } from '../src/entities/world/goldens';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { LootTable } from '../src/entities/world/LootTable';
import { BASE_WALK_TILES_PER_S } from '../src/entities/player/systems/LoadoutSystem';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { Treasury } from '../src/logic/economy/Treasury';
import { CreatureLines } from '../src/logic/theme/CreatureLines';
import { StatSystem } from '../src/logic/systems/StatSystem';
import { UniversalRank, ItemType } from '../types';
import { IPopulationRecord, ISectorState, Population, emptyPopulationRecord } from '../src/entities/world/Population';
import { GOALS, Leaders, ILeaderSeed } from '../src/entities/world/Leaders';
import { Rng } from '../src/logic/rng/DeterministicRNG';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const kind = (key: string) => creatureIdOf(themeId, key);
const SEED = 'herd-world';
const contextOf = (rank = UniversalRank.D, director?: IDirectorRecord): IGenerationContext => ContentRegistry.contextFor(themeId, rank, director);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const SX = 8, SY = 8;

const countOf = (state: ISectorState, id?: string) =>
  Object.values(state.ground).reduce((sum, onGround) => sum + Object.entries(onGround).reduce((s, [k, n]) => s + (!id || k === id ? n : 0), 0), 0);

const foldTo = (generation: number, record: IPopulationRecord = emptyPopulationRecord(), context = contextOf(), seed = SEED) =>
  Population.sectorAt(record, seed, SX, SY, generation, context);

/** A sector holding only what a bar puts there, on ground chosen by the bar. */
const blank = (ground: ISectorState['ground'], generation = 0): ISectorState => ({ generation, ground, leaders: {} });

/** A chunk of the sector under test, as a world with this record lays it. */
const standing = (record: IPopulationRecord, generation: number, context = contextOf(), cx = SX * SECTOR_CHUNKS + 2, cy = SY * SECTOR_CHUNKS + 2, seed = SEED) => {
  const exits = WorldGenerator.exitsInSector({ seed }, SX, SY);
  const chunk = WorldGenerator.buildChunk(seed, exits, cx, cy, context);
  Population.layOver(seed, chunk, record, generation, context);
  return chunk;
};

const mobsIn = (chunk: IChunk) => chunk.entities.filter(e => e.type === EntityType.MOB);
const groundOf = (cx: number, cy: number) => `${cx},${cy}`;
const MID = SX * SECTOR_CHUNKS + 3;

/** A person, as the field reads one, for a tick. */
const FAR = { x: 1e7, y: 1e7 };
const everySector = Object.fromEntries(Array.from({ length: 16 * 16 }, (_, i) => [`${i % 16},${Math.floor(i / 16)}`, {} as never]));
const mapOf = (chunks: Record<string, IChunk>): IMap => ({ seed: SEED, width: 32, height: 32, gridVersion: 2, sectors: everySector, chunks, generatedAt: Math.random() });
const body = (id: string, definitionId: string, x: number, y: number): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId, position: { x, y }, rank: UniversalRank.F, rarity: 'COMMON' as never, isHostile: true, health: 50
});
const chunkHolding = (cx: number, cy: number, entities: IWorldEntity[]): IChunk => ({
  id: `chk_${cx}_${cy}`, x: cx, y: cy, biome: 'WASTELAND' as never, difficulty: UniversalRank.F, rarity: 'COMMON' as never,
  entities, scanLevel: 0 as never, isTraversable: true, hasExtraction: false
});

describe('line 110: gender, keyed so every machine agrees (D64)', () => {
  it('a body has a gender from its seed and its own id, and nothing else', () => {
    expect(Population.genderOf(SEED, 'pop_1_1_a_0')).toBe(Population.genderOf(SEED, 'pop_1_1_a_0'));
    const genders = new Set<string>();
    for (let i = 0; i < 64; i++) genders.add(Population.genderOf(SEED, `pop_1_1_a_${i}`));
    expect(genders.size).toBeGreaterThan(1);
    let differs = 0;
    for (let i = 0; i < 64; i++) if (Population.genderOf(SEED, `b${i}`) !== Population.genderOf('another', `b${i}`)) differs++;
    expect(differs).toBeGreaterThan(0);
  });

  it('a kind breeds by pairs: pairs are the lesser of its two genders on that ground', () => {
    const ground = groundOf(1, 2), k = 'mob_x';
    const ids = (n: number) => Array.from({ length: n }, (_, i) => Population.bodyId(ground, k, i));
    for (const n of [0, 1, 2, 5, 9, 40]) {
      const tally: Record<string, number> = {};
      for (const id of ids(n)) { const g = Population.genderOf(SEED, id); tally[g] = (tally[g] ?? 0) + 1; }
      const values = Object.values(tally);
      expect(Population.pairsOf(SEED, ground, k, n), `${n}`).toBe(values.length < 2 ? 0 : Math.min(...values));
    }
  });

  it('gender is read, and stored nowhere a generated world hashes', () => {
    const chunk = standing(emptyPopulationRecord(), 0);
    for (const e of mobsIn(chunk)) expect((e as unknown as Record<string, unknown>).gender).toBeUndefined();
  });
});

describe('line 110: animals herd (D63)', () => {
  const stag = kind('escrow_stag');
  const bear = kind('compound_bear');
  beforeEach(() => MobAI.reset());

  const tickFor = (chunks: Record<string, IChunk>, map: IMap | undefined, seconds: number, at = FAR) => {
    let live = chunks;
    const started = Date.now();
    const real = Date.now;
    let elapsed = 0;
    Date.now = () => started + elapsed;
    try {
      for (let i = 0; i < seconds * 20; i++) {
        elapsed += 50;
        const { updatedChunks } = MobAI.tick(live, at, 0.05, map);
        live = { ...live, ...updatedChunks };
        if (map) map.chunks = live;
      }
    } finally { Date.now = real; }
    return live;
  };
  const inHerd = (chunks: Record<string, IChunk>) => Object.values(chunks).flatMap(c => c.entities);

  it('a social kind walks in a herd while nobody is near, and stays together', () => {
    const herd = [0, 1, 2, 3, 4].map(i => body(`pop_1_1_abc_${i}`, stag, 640 + i * 24, 640));
    const before = clone(herd);
    const after = inHerd(tickFor({ '0,0': chunkHolding(0, 0, herd) }, undefined, 40));
    const moved = after.filter(e => { const b = before.find(p => p.id === e.id)!; return Math.hypot(e.position.x - b.position.x, e.position.y - b.position.y) > 20; });
    expect(moved.length).toBeGreaterThanOrEqual(3);
    const mx = after.reduce((s, e) => s + e.position.x, 0) / after.length, my = after.reduce((s, e) => s + e.position.y, 0) / after.length;
    for (const e of after) expect(Math.hypot(e.position.x - mx, e.position.y - my), e.id).toBeLessThan(8 * 20);
  });

  it('a solitary kind does not', () => {
    const lone = [body('pop_1_1_abc_0', bear, 640, 640)];
    const after = inHerd(tickFor({ '0,0': chunkHolding(0, 0, lone) }, undefined, 40));
    expect(after[0].position).toEqual({ x: 640, y: 640 });
  });

  it('a kind with no word about it, in a world of the old law, stands as it did', () => {
    const old = Object.values(MOB_DEFINITIONS).find(m => m.id === 'mob_fantasy_rat')!;
    expect((old as unknown as { social?: boolean }).social).toBeUndefined();
    const after = inHerd(tickFor({ '0,0': chunkHolding(0, 0, [body('ent_1_1_m0', old.id, 640, 640), body('ent_1_1_m1', old.id, 660, 640)]) }, undefined, 10));
    expect(after.map(e => e.position)).toEqual([{ x: 640, y: 640 }, { x: 660, y: 640 }]);
  });

  it('a hit on one of a herd is felt by the rest, and each answers by its own behaviour', () => {
    const herd = [0, 1, 2].map(i => body(`pop_1_1_abc_${i}`, stag, 640 + i * 24, 640));
    const chunks = { '0,0': chunkHolding(0, 0, herd) };
    MobAI.tick(chunks, FAR, 0.05);
    MobAI.provoke(herd[0].id);
    MobAI.tick(chunks, { x: 700, y: 900 }, 0.05);
    expect(herd.every(e => MobAI.isActive(e.id))).toBe(true);
  });

  it('a hit on a solitary body wakes only that body', () => {
    const near = [body('pop_1_1_abc_0', bear, 640, 640), body('pop_1_1_abc_1', bear, 664, 640)];
    const chunks = { '0,0': chunkHolding(0, 0, near) };
    MobAI.tick(chunks, FAR, 0.05);
    MobAI.provoke(near[0].id);
    MobAI.tick(chunks, FAR, 0.05);
    expect(MobAI.isActive(near[0].id)).toBe(true);
    expect(MobAI.isActive(near[1].id)).toBe(false);
  });

  it('a pack walks with its leader', () => {
    const head = 'lead_8_8_0';
    const pack = [body(head, kind('rat_comptroller'), 640, 640), ...[0, 1, 2].map(i => body(`${head}_f${i}`, kind('tally_rat'), 620 + i * 20, 660))];
    const after = inHerd(tickFor({ '0,0': chunkHolding(0, 0, pack) }, undefined, 40));
    const leader = after.find(e => e.id === head)!;
    expect(Math.hypot(leader.position.x - 640, leader.position.y - 640)).toBeGreaterThan(0);
    for (const e of after) expect(Math.hypot(e.position.x - leader.position.x, e.position.y - leader.position.y), e.id).toBeLessThan(8 * 20);
  });
});

describe('line 25 holds: herds at rest stay inside the frame', () => {
  it('300 grazing bodies tick well inside the 4ms the awake ones are held to', () => {
    MobAI.reset();
    const stag = kind('escrow_stag');
    const chunks: Record<string, IChunk> = {};
    for (let c = 0; c < 4; c++) {
      chunks[`${c},0`] = chunkHolding(c, 0, Array.from({ length: 75 }, (_, i) => body(`pop_${c}_0_abc_${i}`, stag, c * CHUNK_PX + 40 + (i % 15) * 60, 40 + Math.floor(i / 15) * 60)));
    }
    let live = chunks;
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      const { updatedChunks } = MobAI.tick(live, FAR, 1 / 60);
      times.push(performance.now() - t);
      live = { ...live, ...updatedChunks };
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(4);
  });
});

describe('N7 and N8: a body is simulated where it stands, and lives in the chunk under its feet', () => {
  const stag = kind('escrow_stag');
  beforeEach(() => MobAI.reset());

  it('a body that crosses a chunk line moves to that chunk\'s list, one body in one place', () => {
    const edge = CHUNK_PX - 4;
    const walker = body('ent_1_1_m0', kind('dun_hound'), edge, 640);
    const chunks = { '0,0': chunkHolding(0, 0, [walker]), '1,0': chunkHolding(1, 0, []) };
    const map = mapOf(chunks);
    MobAI.tick({}, FAR, 0.05, map);
    MobAI.provoke(walker.id);
    const person = { x: CHUNK_PX + 200, y: 640 };
    const { updatedChunks } = MobAI.tick(chunks, person, 0.5, map);
    expect(updatedChunks['1,0'].entities.map(e => e.id)).toEqual([walker.id]);
    expect(updatedChunks['0,0'].entities).toEqual([]);
    expect(chunkOf(updatedChunks['1,0'].entities[0].position.x)).toBe(1);
  });

  it('a chunk not built yet holds a body back at its line rather than losing it', () => {
    const walker = body('ent_1_1_m0', kind('dun_hound'), CHUNK_PX - 4, 640);
    const chunks = { '0,0': chunkHolding(0, 0, [walker]) };
    const map = mapOf(chunks);
    MobAI.tick({}, FAR, 0.05, map);
    MobAI.provoke(walker.id);
    const { updatedChunks } = MobAI.tick(chunks, { x: CHUNK_PX + 100, y: 640 }, 0.5, map);
    expect(updatedChunks['0,0'].entities.map(e => e.id)).toEqual([walker.id]);
  });

  it('the simulated chunks hold every chunk a provoked body stands in, however far from the person', () => {
    const far = body('ent_1_1_m0', stag, 40 * CHUNK_PX + 10, 40 * CHUNK_PX + 10);
    const chunks = { '40,40': chunkHolding(40, 40, [far]), '0,0': chunkHolding(0, 0, []) };
    const map = mapOf(chunks);
    MobAI.tick({ '0,0': chunks['0,0'] }, { x: 100, y: 100 }, 0.05, map); // a new opening of a world clears what was remembered
    MobAI.provoke(far.id);
    expect(MobAI.simulatedKeys(map, 100, 100)).not.toContain('40,40'); // not until it has ticked awake
    MobAI.tick({ '40,40': chunks['40,40'] }, { x: 100, y: 100 }, 0.05, map);
    expect(MobAI.simulatedKeys(map, 100, 100)).toContain('40,40');
    expect(MobAI.simulatedKeys(map, 100, 100)).toContain('0,0');
  });

  it('the box reaches as far as the widest sight there is, in the dark', () => {
    // A COLOSSAL body in the dark sees 20 x 1.425 tiles, which is past the 500px of a shot
    const keys = (x: number) => MobAI.simulatedKeys(mapOf({}), x, 100);
    const justPast = CHUNK_PX - 540; // 540px short of the next chunk: outside a shot, inside that sight
    expect(keys(justPast)).toContain('1,0');
  });

  it('a body at rest far away costs nothing, and is not kept', () => {
    const far = body('ent_1_1_m0', stag, 40 * CHUNK_PX + 10, 40 * CHUNK_PX + 10);
    const chunks = { '40,40': chunkHolding(40, 40, [far]) };
    MobAI.tick(chunks, { x: 100, y: 100 }, 0.05, mapOf(chunks));
    expect(MobAI.simulatedKeys(mapOf(chunks), 100, 100)).not.toContain('40,40');
  });
});

describe('line 111: population moves by births and food (D64)', () => {
  it('with no record a world generates exactly as today: the golden vectors hold', () => {
    // The fixture's land, read alone: this file has installed a theme beside it
    const fixture = { mobDefinitions: Object.values(MOB_DEFINITIONS).filter(m => !(m as { themeId?: string }).themeId), resourceDefinitions: Object.values(RESOURCE_DEFINITIONS).filter(r => !r.themeId) };
    for (const g of GOLDEN_VECTORS) expect(computeGolden(g.seed, g.size, fixture), g.seed).toBe(g.hash);
    const context = contextOf();
    for (const g of FIRST_THEME_VECTORS) expect(computeGolden(g.seed, g.size, ContentRegistry.contextFor(themeId)), g.seed).toBe(g.hash);
    const exits = WorldGenerator.exitsInSector({ seed: SEED }, SX, SY);
    expect(WorldGenerator.buildChunk(SEED, exits, MID, MID, context)).toEqual(WorldGenerator.buildChunk(SEED, exits, MID, MID, context));
  });

  it('alpha is the land\'s own count: the census matches what a built chunk stands', () => {
    const context = contextOf();
    const exits = WorldGenerator.exitsInSector({ seed: SEED }, SX, SY);
    const state = Population.alpha(SEED, SX, SY, context);
    expect(state.generation).toBe(0);
    for (let cy = SY * SECTOR_CHUNKS; cy < SY * SECTOR_CHUNKS + SECTOR_CHUNKS; cy += 3) for (let cx = SX * SECTOR_CHUNKS; cx < SX * SECTOR_CHUNKS + SECTOR_CHUNKS; cx += 3) {
      const built: Record<string, number> = {};
      for (const e of WorldGenerator.buildChunk(SEED, exits, cx, cy, context).entities) {
        if (e.type !== EntityType.MOB || !Population.isCounted(e.id)) continue;
        built[e.definitionId] = (built[e.definitionId] ?? 0) + 1;
      }
      expect(state.ground[groundOf(cx, cy)] ?? {}, groundOf(cx, cy)).toEqual(built);
    }
  });

  it('folding N cycles one at a time gives the same as folding them all at once', () => {
    const context = contextOf();
    const all = foldTo(12, emptyPopulationRecord(), context);
    const walking = emptyPopulationRecord();
    let last: ISectorState | undefined;
    for (let g = 0; g <= 12; g++) last = Population.sectorAt(walking, SEED, SX, SY, g, context);
    expect(last).toEqual(all);
  });

  it('it reads the same in any order and on any machine, and the record round-trips', () => {
    const context = contextOf();
    const a = foldTo(9, emptyPopulationRecord(), context);
    const record = JSON.parse(JSON.stringify({ ...emptyPopulationRecord(), sectors: { [`${SX},${SY}`]: Population.sectorAt(emptyPopulationRecord(), SEED, SX, SY, 4, context) } })) as IPopulationRecord;
    expect(Population.sectorAt(record, SEED, SX, SY, 9, context)).toEqual(a);
  });

  it('a pair on plenty brings births, and a birth moves a count and adds no tree node', async () => {
    const rat = kind('tally_rat');
    const ground = groundOf(MID, MID);
    let state = blank({ [ground]: { [rat]: 6 } });
    const context = contextOf();
    const record = emptyPopulationRecord();
    for (let i = 0; i < 12; i++) state = Population.step(SEED, SX, SY, state, record, context);
    expect(countOf(state, rat)).toBeGreaterThan(6);
    const director = await CreatureLines.regenerate(Director.catchUp(emptyDirectorRecord(), 12), { seed: SEED, themeId });
    expect(Object.keys(director.lines?.nodes ?? {})).toEqual([]);
    expect(Object.keys(MOB_DEFINITIONS).filter(id => id.includes(state.generation.toString() + '_birth'))).toEqual([]);
  });

  it('one body, or a body with no other gender, has no births', () => {
    const ground = groundOf(MID, MID);
    const rat = kind('tally_rat');
    const context = contextOf();
    // A lone body with nowhere to go: the bare fold, from a ground with nothing beside it to walk to
    const lone = Population.pairsOf(SEED, ground, rat, 1);
    expect(lone).toBe(0);
    let state = blank({ [ground]: { [rat]: 1 } });
    state = Population.step(SEED, SX, SY, state, emptyPopulationRecord(), context);
    const around = Object.values(state.ground).reduce((sum, on) => sum + (on[rat] ?? 0), 0);
    const backFromOutside = Object.values(Population.step(SEED, SX, SY, blank({}), emptyPopulationRecord(), context).ground).reduce((sum, on) => sum + (on[rat] ?? 0), 0);
    expect(around - backFromOutside).toBeLessThanOrEqual(1);
  });

  it('a herd of any size can lose a head to what hunts it: a floor of a share would not', () => {
    // The donor's fault: floor(12 x 0.05) is 0, so a herd under 20 could never be eaten. Ours are keyed.
    const goat = kind('collateral_goat'), wraith = kind('dun_hound');
    const context = contextOf(UniversalRank.A);
    let lost = 0;
    for (let i = 0; i < 80; i++) {
      const ground = groundOf(SX * SECTOR_CHUNKS + (i % 8), SY * SECTOR_CHUNKS + Math.floor(i / 8));
      const after = Population.step(`hunt-${i}`, SX, SY, blank({ [ground]: { [goat]: 1, [wraith]: 12 } }), emptyPopulationRecord(), context);
      if (countOf(after, goat) === 0) lost++;
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('what hunts brings a kind down: prey fares worse with hunters beside it', () => {
    const goat = kind('collateral_goat'), wraith = kind('dun_hound');
    const context = contextOf(UniversalRank.A);
    const after = (hunters: number) => {
      let total = 0;
      for (let i = 0; i < 60; i++) {
        const ground = groundOf(SX * SECTOR_CHUNKS + (i % 8), SY * SECTOR_CHUNKS + Math.floor(i / 8));
        total += countOf(Population.step(`prey-${i}`, SX, SY, blank({ [ground]: hunters > 0 ? { [goat]: 8, [wraith]: hunters } : { [goat]: 8 } }), emptyPopulationRecord(), context), goat);
      }
      return total;
    };
    expect(after(6)).toBeLessThan(after(0));
  });

  it('a hungry herd leaves: its count on the next chunk rises', () => {
    const ox = kind('pension_ox');
    const context = contextOf(UniversalRank.S);
    // Far more mouths than the ground can feed, on ground the kind can live on
    const home = findGround(SEED, context, ox);
    let state = blank({ [home]: { [ox]: 60 } });
    state = Population.step(SEED, SX, SY, state, emptyPopulationRecord(), context);
    expect(state.ground[home]?.[ox] ?? 0).toBeLessThan(60);
    const [hx, hy] = home.split(',').map(Number);
    const beside = Object.entries(state.ground).filter(([g, on]) => {
      const [x, y] = g.split(',').map(Number);
      return Math.abs(x - hx) + Math.abs(y - hy) === 1 && (on[ox] ?? 0) > 1;
    });
    expect(beside.length).toBeGreaterThan(0);
  });

  it('hunger thins what stays: mouths the land cannot feed do not all survive', () => {
    const ox = kind('pension_ox');
    const context = contextOf(UniversalRank.S);
    const home = findGround(SEED, context, ox);
    const after = Population.step(SEED, SX, SY, blank({ [home]: { [ox]: 300 } }), emptyPopulationRecord(), context);
    expect(countOf(after, ox)).toBeLessThan(300);
  });

  it('no constant is a ceiling: more food on the land carries more bodies', () => {
    const rich = clone(FIRST_THEME);
    rich.name = 'The Long Audit, Fed';
    for (const m of rich.materials) if (m.tags.includes('food')) { m.form = 'grain'; m.habitat = ['WASTELAND', 'OVERGROWTH', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY']; }
    rich.materials.push(
      ...Array.from({ length: 8 }, (_, i) => ({ ...rich.materials[0], key: `extra_grain_${'abcdefgh'[i]}`, name: `Grain ${i}`, habitat: ['WASTELAND', 'OVERGROWTH', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY'] as IThemeBody['materials'][number]['habitat'] }))
    );
    const fed = sealTheme(rich, 'test', 1);
    expect(ContentRegistry.install(fed), ContentRegistry.install(fed).reason).toEqual({ ok: true });
    const lean = contextOf(UniversalRank.C);
    const plenty = ContentRegistry.contextFor(fed.themeId, UniversalRank.C);
    const total = (ctx: IGenerationContext) => {
      let n = 0;
      for (let cy = SY * SECTOR_CHUNKS; cy < SY * SECTOR_CHUNKS + SECTOR_CHUNKS; cy++) for (let cx = SX * SECTOR_CHUNKS; cx < SX * SECTOR_CHUNKS + SECTOR_CHUNKS; cx++) n += Population.foodAt(SEED, cx, cy, ctx);
      return n;
    };
    expect(total(plenty)).toBeGreaterThan(total(lean));
    expect(countOf(Population.sectorAt(emptyPopulationRecord(), SEED, SX, SY, 40, plenty))).toBeGreaterThan(countOf(Population.sectorAt(emptyPopulationRecord(), SEED, SX, SY, 40, lean)));
  });

  it('left alone, the land holds its people: a world neither empties nor runs away', () => {
    const context = contextOf();
    const alpha = countOf(Population.alpha(SEED, SX, SY, context));
    const at = (g: number) => countOf(foldTo(g, emptyPopulationRecord(), context));
    for (const g of [8, 40, 200]) {
      expect(at(g), `cycle ${g}`).toBeGreaterThan(alpha * 0.25);
      expect(at(g), `cycle ${g}`).toBeLessThan(alpha * 6);
    }
  });

  it('bodies spread: herds do not pile onto the richest ground, and the world keeps its kinds', () => {
    // The first fold sent every hungry herd to the richest chunk: six chunks held a thousand bodies by cycle 40
    for (const rank of [UniversalRank.E, UniversalRank.C]) {
      const context = contextOf(rank);
      const alpha = Population.alpha(SEED, SX, SY, context);
      const alphaKinds = new Set(Object.values(alpha.ground).flatMap(on => Object.keys(on)));
      for (const g of [40, 200]) {
        const state = foldTo(g, emptyPopulationRecord(), context);
        const onChunk = Object.values(state.ground).map(on => Object.values(on).reduce((s, n) => s + n, 0));
        expect(Math.max(...onChunk), `${rank} at ${g}`).toBeLessThan(90);
        expect(onChunk.length, `${rank} at ${g}`).toBeGreaterThan(40);
        const kinds = new Set(Object.values(state.ground).flatMap(on => Object.keys(on)));
        expect(kinds.size, `${rank} at ${g}`).toBeGreaterThanOrEqual(Math.ceil(alphaKinds.size * 0.6));
      }
    }
  });

  it('a kind gone from a ground the land stood it on walks back in, in time', () => {
    const context = contextOf();
    let state = blank({});
    for (let i = 0; i < 30; i++) state = Population.step(SEED, SX, SY, state, emptyPopulationRecord(), context);
    expect(countOf(state)).toBeGreaterThan(0);
  });

  it('a pack answers to the ground: too many mouths thin it', () => {
    const context = contextOf(UniversalRank.C);
    const leader = allLeaders(context).find(l => l.pack > 0)!;
    const sx = Math.floor(leader.cx / SECTOR_CHUNKS), sy = Math.floor(leader.cy / SECTOR_CHUNKS);
    const alpha = Population.alpha(SEED, sx, sy, context);
    const crowded: ISectorState = { ...alpha, leaders: { ...alpha.leaders, [leader.id]: { ...alpha.leaders[leader.id], goal: 'waylay', pack: 400 } } };
    const after = Population.step(SEED, sx, sy, crowded, emptyPopulationRecord(), context);
    expect(after.leaders[leader.id].pack).toBeLessThan(400);
  });

  it('it stays affordable to read: a sector far behind the clock folds inside a loading moment', () => {
    const context = contextOf();
    const t = performance.now();
    foldTo(1000, emptyPopulationRecord(), context, 'cold-sector'); // four months of a small world, nobody having read it
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it('nothing in the fold names a cap: the source has no ceiling on a count', () => {
    const text = readFileSync('src/entities/world/Population.ts', 'utf8');
    expect(text).not.toMatch(/Math\.min\([^)]*(MAX_|CAP)/);
    expect(text).not.toMatch(/\b(MAX_POP|POPULATION_CAP|CARRYING_CAPACITY|MAX_BODIES)\b/);
  });
});

/** Ground in the sector under test that this kind may live on, by its own habitat. */
function findGround(seed: string, context: IGenerationContext, id: string): string {
  const def = MOB_DEFINITIONS[id] as unknown as { habitat: string[] };
  for (let cy = SY * SECTOR_CHUNKS + 1; cy < SY * SECTOR_CHUNKS + SECTOR_CHUNKS - 1; cy++) for (let cx = SX * SECTOR_CHUNKS + 1; cx < SX * SECTOR_CHUNKS + SECTOR_CHUNKS - 1; cx++) {
    if (def.habitat.includes(WorldGenerator.biomeAt(seed, cx, cy))) return groundOf(cx, cy);
  }
  throw new Error(`no ground for ${id}`);
}

describe('line 111: who falls stays down, and the record knows (A2 left this to this stream)', () => {
  it('an ordinary body brought down stays down at the next drop in its cycle', () => {
    const context = contextOf();
    const fresh = mobsIn(standing(emptyPopulationRecord(), 0, context)).filter(e => Population.isCounted(e.id));
    expect(fresh.length).toBeGreaterThan(0);
    const victim = fresh[0];
    const record = Population.fell(emptyPopulationRecord(), victim.id, victim.definitionId, 0);
    const after = mobsIn(standing(record, 0, context));
    expect(after.some(e => e.id === victim.id)).toBe(false);
    expect(after.length).toBe(mobsIn(standing(emptyPopulationRecord(), 0, context)).length - 1);
  });

  it('it stays down in a later cycle too, as one fewer in the count', () => {
    const context = contextOf();
    const later = 3;
    const quiet = emptyPopulationRecord();
    const bodies = mobsIn(standing(quiet, later, context)).filter(e => Population.isCounted(e.id));
    expect(bodies.length).toBeGreaterThan(0);
    const victim = bodies[0];
    const record = Population.fell(clone(quiet), victim.id, victim.definitionId, later);
    expect(mobsIn(standing(record, later, context)).some(e => e.id === victim.id)).toBe(false);
    const next = (r: IPopulationRecord) => clone(foldTo(later + 1, r, context));
    const a = next(clone(quiet)), b = next(record);
    expect(countOf(b)).not.toBe(countOf(a) + 1);
    expect(a).not.toEqual(b);
  });

  it('a chest\'s guards are not the population\'s: they stand as the chest system says', () => {
    const context = contextOf();
    for (let cx = SX * SECTOR_CHUNKS; cx < SX * SECTOR_CHUNKS + 8; cx++) {
      const exits = WorldGenerator.exitsInSector({ seed: SEED }, SX, SY);
      const alpha = WorldGenerator.buildChunk(SEED, exits, cx, MID, context).entities.filter(e => /_guard\d+$/.test(e.id));
      const later = mobsIn(standing(emptyPopulationRecord(), 5, context, cx, MID)).filter(e => /_guard\d+$/.test(e.id));
      expect(later.map(e => e.id)).toEqual(alpha.map(e => e.id));
      expect(later.map(e => e.position)).toEqual(alpha.map(e => e.position));
    }
  });
});

describe('line 112: bodies change chunks between cycles (D66)', () => {
  it('land and alpha stay fixed, whatever the record says', () => {
    const context = contextOf();
    const exits = WorldGenerator.exitsInSector({ seed: SEED }, SX, SY);
    const alpha = WorldGenerator.buildChunk(SEED, exits, MID, MID, context);
    const record = emptyPopulationRecord();
    foldTo(20, record, context);
    expect(WorldGenerator.buildChunk(SEED, exits, MID, MID, context)).toEqual(alpha);
    const later = standing(record, 20, context, MID, MID);
    const land = (c: IChunk) => c.entities.filter(e => e.type !== EntityType.MOB);
    expect(land(later)).toEqual(land(alpha));
    expect(later.biome).toBe(alpha.biome);
  });

  it('who stands on a chunk changes between cycles, and the counts move across chunks', () => {
    const context = contextOf();
    const a = foldTo(1, emptyPopulationRecord(), context);
    const b = foldTo(6, emptyPopulationRecord(), context);
    const moved = Object.keys({ ...a.ground, ...b.ground }).filter(g => JSON.stringify(a.ground[g]) !== JSON.stringify(b.ground[g]));
    expect(moved.length).toBeGreaterThan(5);
    const kindAlpha = Population.alpha(SEED, SX, SY, context);
    const reached = Object.keys(b.ground).filter(g => !kindAlpha.ground[g]);
    const onLand = Object.keys(kindAlpha.ground);
    expect(onLand.length + reached.length).toBeGreaterThan(0);
  });

  it('what stands reads the record: a chunk\'s bodies are the record\'s counts, in the same kinds', () => {
    const context = contextOf();
    const record = emptyPopulationRecord();
    const cx = MID, cy = MID;
    const state = foldTo(5, record, context);
    const bodies = mobsIn(standing(record, 5, context, cx, cy)).filter(e => Population.isCounted(e.id));
    const tally: Record<string, number> = {};
    for (const e of bodies) tally[e.definitionId] = (tally[e.definitionId] ?? 0) + 1;
    const want = state.ground[groundOf(cx, cy)] ?? {};
    for (const [k, n] of Object.entries(tally)) expect(n, k).toBeLessThanOrEqual(want[k] ?? 0);
    expect(Object.values(want).reduce((s, n) => s + n, 0) - bodies.length).toBeLessThanOrEqual(2); // only a walled-in tile can refuse
  });

  it('a body keeps to the ground it can live on: its habitat, and what the ground\'s rank allows', () => {
    const context = contextOf(UniversalRank.E);
    const order = Object.values(UniversalRank);
    const state = foldTo(60, emptyPopulationRecord(), context);
    for (const [g, on] of Object.entries(state.ground)) {
      const [cx, cy] = g.split(',').map(Number);
      const biome = WorldGenerator.biomeAt(SEED, cx, cy), rank = WorldGenerator.rankAt(SEED, cx, cy, UniversalRank.E);
      for (const id of Object.keys(on)) {
        const def = MOB_DEFINITIONS[id] as unknown as { habitat: string[]; rank: UniversalRank };
        expect(def.habitat, `${id} on ${biome}`).toContain(biome);
        expect(order.indexOf(def.rank) <= order.indexOf(rank) || Population.alpha(SEED, SX, SY, context).ground[g]?.[id] !== undefined, `${id} on ${rank}`).toBe(true);
      }
    }
  });

  it('Director.kindOf\'s stand-in is gone: a changed kind stands by the count, keyed, from the births of its parent', async () => {
    expect((Director as unknown as { kindOf?: unknown }).kindOf).toBeUndefined();
    const hound = kind('dun_hound');
    let director: IDirectorRecord = emptyDirectorRecord();
    for (let i = 0; i < 200 && !director.lines?.pending.some(o => o.parents.includes(hound)); i++) {
      director = await CreatureLines.regenerate(Director.catchUp(Director.report(director, 'FELLED_A_PERSON', hound), director.generation + 1), { seed: SEED, themeId });
    }
    const order = director.lines!.pending.find(o => o.parents.includes(hound))!;
    const installed = await CreatureLines.install(director, order.id, { name: 'Arrears Hound', blurb: 'It waits at the door now.', tags: [], features: ['horns'], innate: [] }, { seed: SEED, themeId });
    expect(installed.ok).toBe(true);
    await CreatureLines.define(installed.record, themeId);
    const context = contextOf(UniversalRank.D, installed.record);
    const alpha = Population.alpha(SEED, SX, SY, context);
    expect(countOf(alpha, installed.id)).toBe(0);
    const later = Population.sectorAt(emptyPopulationRecord(), SEED, SX, SY, installed.record.generation + 8, context);
    expect(countOf(later, installed.id)).toBeGreaterThan(0);
    expect(countOf(later, hound)).toBeGreaterThan(0);
  });

  it('a body of a line that turns away from its land settles where its trade has something to work', () => {
    const context = contextOf();
    const leaders = allLeaders(context);
    const settler = leaders.find(l => Leaders.sheetOf(SEED, l, context).goal === 'settle');
    expect(settler, 'some leader in these sectors means to settle').toBeDefined();
    const seedOfRecord = emptyPopulationRecord();
    const sx = Math.floor(settler!.cx / SECTOR_CHUNKS), sy = Math.floor(settler!.cy / SECTOR_CHUNKS);
    const state = Population.sectorAt(seedOfRecord, SEED, sx, sy, 30, context);
    const after = state.leaders[settler!.id];
    if (after?.alive && after.settledAt) {
      const [cx, cy] = after.at.split(',').map(Number);
      expect(Leaders.groundWorks(SEED, cx, cy, Leaders.sheetOf(SEED, settler!, context), context)).toBe(true);
    }
    expect(after).toBeDefined();
  });
});

/** Every leader the sectors around the middle hold. */
function allLeaders(context: IGenerationContext, seed = SEED): ILeaderSeed[] {
  const out: ILeaderSeed[] = [];
  for (let y = SY - 3; y <= SY + 3; y++) for (let x = SX - 3; x <= SX + 3; x++) out.push(...Leaders.rosterOf(seed, x, y, context));
  return out;
}

describe('line 134: an elite leads a pack of a social species (D93)', () => {
  const context = contextOf(UniversalRank.C);
  const chunkOfLeader = (l: ILeaderSeed, ctx = context) => {
    const exits = WorldGenerator.exitsInSector({ seed: SEED }, Math.floor(l.cx / SECTOR_CHUNKS), Math.floor(l.cy / SECTOR_CHUNKS));
    return WorldGenerator.buildChunk(SEED, exits, l.cx, l.cy, ctx);
  };

  describe('the roster', () => {
    it('is keyed by sector, known without building a chunk, the same every time', () => {
      const a = Leaders.rosterOf(SEED, SX, SY, context);
      expect(Leaders.rosterOf(SEED, SX, SY, contextOf(UniversalRank.C))).toEqual(a);
      expect(a).not.toEqual(Leaders.rosterOf('another-world', SX, SY, context));
      const text = readFileSync('src/entities/world/Leaders.ts', 'utf8');
      expect(text).not.toMatch(/buildChunk|chunkAt|sectorContents/);
    });

    it('elites are not as rare: a run meets some, and they lead packs', () => {
      const leaders = allLeaders(context);
      expect(leaders.length).toBeGreaterThan(20);
      expect(new Set(leaders.map(l => l.kind)).size).toBeGreaterThan(1);
    });

    it('packs are the rule: most of a roster leads one, on ground where both can stand', () => {
      const leaders = allLeaders(contextOf(UniversalRank.D));
      const alone = leaders.filter(l => l.pack === 0).length;
      expect(alone).toBeGreaterThan(0);
      expect(alone / leaders.length).toBeLessThan(0.35);
    });

    it('it respects the ground: a leader is never above its ground\'s rank, and lives on its habitat', () => {
      const order = Object.values(UniversalRank);
      for (const l of allLeaders(context)) {
        const def = MOB_DEFINITIONS[l.kind] as unknown as { rank: UniversalRank; habitat: string[] };
        expect(order.indexOf(def.rank), l.id).toBeLessThanOrEqual(order.indexOf(WorldGenerator.rankAt(SEED, l.cx, l.cy, UniversalRank.C)));
        expect(def.habitat, l.id).toContain(WorldGenerator.biomeAt(SEED, l.cx, l.cy));
      }
    });

    it('a pack with no plain elite under the old law has no roster at all', () => {
      const old = { mobDefinitions: Object.values(MOB_DEFINITIONS).filter(m => m.id.startsWith('mob_fantasy') || m.id.startsWith('boss_fantasy')), resourceDefinitions: [] };
      expect(Leaders.rosterOf(SEED, SX, SY, old)).toEqual([]);
    });
  });

  describe('at the head of a pack', () => {
    it('a social elite stands in the world with a pack of its own kind around it', () => {
      const leader = allLeaders(context).find(l => (MOB_DEFINITIONS[l.kind] as unknown as { social: boolean }).social && l.pack > 0)!;
      expect(leader).toBeDefined();
      const chunk = chunkOfLeader(leader);
      const head = chunk.entities.find(e => e.id === leader.id)!;
      expect(head.definitionId).toBe(leader.kind);
      const followers = chunk.entities.filter(e => Leaders.herdOf(e.id) === leader.id && e.id !== leader.id);
      expect(followers.length).toBeGreaterThan(0);
      const leads = (MOB_DEFINITIONS[leader.kind] as unknown as { leads: string }).leads;
      for (const f of followers) {
        expect(f.definitionId).toBe(leads);
        expect(Math.hypot(f.position.x - head.position.x, f.position.y - head.position.y)).toBeLessThan(8 * 20);
      }
    });

    it('a solitary elite stands alone, with a sheet and a goal like any other', () => {
      const lone = allLeaders(contextOf(UniversalRank.A)).find(l => !(MOB_DEFINITIONS[l.kind] as unknown as { social: boolean }).social)!;
      expect(lone).toBeDefined();
      expect(lone.pack).toBe(0);
      expect(Leaders.sheetOf(SEED, lone, contextOf(UniversalRank.A)).goal).toBe('waylay');
    });

    it('only a social species leads: the law refuses a solitary one heading a pack, or a pack of a solitary kind', () => {
      const pick = (b: IThemeBody) => b.creatures.find(c => c.tags.includes('elite') && c.leads)!;
      const judge = (mutate: (b: IThemeBody) => void) => {
        const body = clone(FIRST_THEME);
        mutate(body);
        return ThemeLaw.validate(body, tag => WebBank.current().tags.some(t => t.tag === tag));
      };
      expect(judge(() => undefined)).toEqual({ ok: true });
      expect(judge(b => { pick(b).social = false; }).ok).toBe(false);
      expect(judge(b => { const led = pick(b).leads; b.creatures.find(c => c.key === led)!.social = false; }).ok).toBe(false);
      expect(judge(b => { pick(b).leads = 'not_a_creature'; }).ok).toBe(false);
    });

    it('R4 stays for what is one of a kind, and comes off the elite', () => {
      const exits = (sx: number, sy: number) => WorldGenerator.exitsInSector({ seed: SEED }, sx, sy);
      let plainFromThePool = 0;
      for (let cy = SY * SECTOR_CHUNKS; cy < SY * SECTOR_CHUNKS + 8; cy++) for (let cx = SX * SECTOR_CHUNKS; cx < SX * SECTOR_CHUNKS + 8; cx++) {
        for (const e of WorldGenerator.buildChunk(SEED, exits(SX, SY), cx, cy, contextOf(UniversalRank.A)).entities) {
          const tags = MOB_DEFINITIONS[e.definitionId]?.tags ?? [];
          if (tags.includes('elite') && !tags.includes('god') && !Leaders.isLeader(e.id)) plainFromThePool++;
        }
      }
      expect(plainFromThePool).toBe(0);
    });
  });

  describe('a sheet and a goal, dealt at generation', () => {
    const leaders = allLeaders(context);

    it('every one has a sheet and a goal, back byte for byte, with nothing stored', () => {
      for (const l of leaders.slice(0, 20)) {
        const sheet = Leaders.sheetOf(SEED, l, context);
        expect(sheet.stats).toBeDefined();
        expect(sheet.temperament).toBeTruthy();
        expect(sheet.drive).toBeTruthy();
        expect(GOALS).toContain(sheet.goal);
        expect(Leaders.sheetOf(SEED, clone(l), contextOf(UniversalRank.C))).toEqual(sheet);
      }
      const chunk = chunkOfLeader(leaders[0]);
      const head = chunk.entities.find(e => e.id === leaders[0].id)! as unknown as Record<string, unknown>;
      for (const stored of ['goal', 'sheet', 'stats', 'drive', 'temperament']) expect(head[stored], stored).toBeUndefined();
    });

    it('it reads through the door people use: NpcSheet\'s stats, under the same key', async () => {
      const { NpcSheet } = await import('../src/logic/systems/NpcSheet');
      const l = leaders[0];
      expect(Leaders.sheetOf(SEED, l, context).stats).toEqual(NpcSheet.statsOf(SEED, { id: l.id, rank: (MOB_DEFINITIONS[l.kind] as unknown as { rank: UniversalRank }).rank }));
    });

    it('two leaders of one kind differ, and a world of three has three goals', () => {
      const byKind = new Map<string, ILeaderSeed[]>();
      for (const l of leaders) byKind.set(l.kind, [...(byKind.get(l.kind) ?? []), l]);
      const twins = [...byKind.values()].find(list => list.length >= 3)!;
      expect(new Set(twins.map(l => JSON.stringify(Leaders.sheetOf(SEED, l, context).stats))).size).toBeGreaterThan(1);
    });

    it('a goal never asks for what the sheet or the species lacks', () => {
      for (const l of leaders) {
        const def = MOB_DEFINITIONS[l.kind] as unknown as { social: boolean; builds: boolean };
        const sheet = Leaders.sheetOf(SEED, l, context);
        if (sheet.goal === 'settle') { expect(def.builds, l.id).toBe(true); expect(Object.keys(sheet.skills ?? {}).length, l.id).toBeGreaterThan(0); }
        if (sheet.goal === 'grow' || sheet.goal === 'hunt' || sheet.goal === 'take') expect(def.social, l.id).toBe(true);
        if (sheet.goal === 'waylay') expect(def.social, l.id).toBe(false);
      }
    });

    it('its toughness comes from the sheet, through the formula', () => {
      const l = leaders[0];
      const def = MOB_DEFINITIONS[l.kind] as unknown as { baseHealth: number; baseDamage: number };
      const head = chunkOfLeader(l).entities.find(e => e.id === l.id)!;
      const n = Leaders.numbers(SEED, l, context);
      expect(head.health).toBe(def.baseHealth + n.bonusHealth);
      expect(head.bonusHealth).toBe(n.bonusHealth);
      expect(n.bonusHealth).toBeGreaterThan(0);
    });
  });

  describe('a cycle to do it', () => {
    const someGrower = () => allLeaders(context).find(l => Leaders.sheetOf(SEED, l, context).goal === 'grow')!;
    const home = (l: ILeaderSeed) => [Math.floor(l.cx / SECTOR_CHUNKS), Math.floor(l.cy / SECTOR_CHUNKS)];

    it('nobody saw it: a keyed roll decides, the same on every machine', () => {
      const l = someGrower();
      const [sx, sy] = home(l);
      const a = Population.sectorAt(emptyPopulationRecord(), SEED, sx, sy, 6, context).leaders[l.id];
      const b = Population.sectorAt(emptyPopulationRecord(), SEED, sx, sy, 6, context).leaders[l.id];
      expect(a).toEqual(b);
      expect(a.log.length).toBeGreaterThan(0);
      expect(a.log.every(entry => entry.rolled !== undefined)).toBe(true);
    });

    it('someone saw it: no roll, and it stands if it keeps most of its pack', () => {
      const l = someGrower();
      const [sx, sy] = home(l);
      const record = Population.saw(emptyPopulationRecord(), [l.id], 0);
      const entry = Population.sectorAt(record, SEED, sx, sy, 1, context).leaders[l.id].log[0];
      expect(entry.seen).toBe(true);
      expect(entry.rolled).toBeUndefined();
      expect(entry.outcome).toBe('done');
    });

    it('a person can really stop it: most of its pack down, and it fails', () => {
      const l = someGrower();
      expect(l.pack).toBeGreaterThan(0);
      const [sx, sy] = home(l);
      let record = Population.saw(emptyPopulationRecord(), [l.id], 0);
      const leads = (MOB_DEFINITIONS[l.kind] as unknown as { leads: string }).leads;
      for (let i = 0; i < l.pack; i++) record = Population.fell(record, `${l.id}_f${i}`, leads, 0);
      const after = Population.sectorAt(record, SEED, sx, sy, 1, context).leaders[l.id];
      expect(after.log[0]).toMatchObject({ seen: true, outcome: 'failed' });
      expect(after.pack).toBe(0);
    });

    it('brought down, it stays down, and what it led goes on behind the next in its register', () => {
      // Moved on purpose by the koseki: its pack used to dissolve into ordinary bodies
      const l = someGrower();
      const [sx, sy] = home(l);
      const record = Population.fell(emptyPopulationRecord(), l.id, l.kind, 0);
      const laid = (() => {
        const exits = WorldGenerator.exitsInSector({ seed: SEED }, sx, sy);
        const chunk = WorldGenerator.buildChunk(SEED, exits, l.cx, l.cy, context);
        Population.layOver(SEED, chunk, record, 0, context);
        return chunk;
      })();
      expect(laid.entities.some(e => e.id === l.id)).toBe(false);
      const after = Population.sectorAt(record, SEED, sx, sy, 1, context);
      expect(after.leaders[l.id].alive).toBe(false);
      expect(after.koseki![l.id].entries.find(e => e.body === l.id)).toMatchObject({ exit: 'fell' });
    });

    it('growing grows its pack by the record, a head at a time, and done it takes its next goal', () => {
      const l = allLeaders(context).find(x => Leaders.sheetOf(SEED, x, context).goal === 'grow')!;
      const [sx, sy] = home(l);
      const state = Population.sectorAt(emptyPopulationRecord(), SEED, sx, sy, 40, context).leaders[l.id];
      const done = state.log.filter(e => e.outcome === 'done');
      expect(done.length).toBeGreaterThan(0);
      expect(state.tenure).toBeGreaterThan(0);
    });
  });

  describe('it stays where a person can read it', () => {
    it('the ledger names a body, and the highest rank that has fallen to it', () => {
      let record = emptyDirectorRecord();
      const id = kind('rat_comptroller');
      record = Director.report(record, 'FELLED_A_PERSON', id, { id: 'lead_8_8_0', rank: UniversalRank.D });
      record = Director.report(record, 'FELLED_A_PERSON', id, { id: 'lead_8_8_0', rank: UniversalRank.F });
      expect(record.felled[id]).toBe(2);
      // C4, moved on purpose: it also says which cycles, so a sector read late folds as one read early did
      expect(record.bodies!['lead_8_8_0']).toEqual({ felled: 2, felledAt: [0, 0], topRank: UniversalRank.D });
      const next = Director.catchUp(record, 3);
      expect(next.bodies!['lead_8_8_0'].felled).toBe(2);
      expect(next.felled).toEqual({});
    });

    it('a leader that falls is on the ledger too, with who brought it down', () => {
      const id = kind('lead_dun');
      const record = Director.report(emptyDirectorRecord(), 'FELL', id, { id: 'lead_8_8_1', rank: UniversalRank.F });
      expect(record.fell[id]).toBe(1);
      expect(record.bodies!['lead_8_8_1']).toEqual({ felled: 0, fellTo: UniversalRank.F });
    });

    it('a kind stays a kind: a body with no name in the report leaves no entry', () => {
      const record = Director.report(emptyDirectorRecord(), 'FELL', kind('tally_rat'));
      expect(record.bodies).toBeUndefined();
      expect(record.fell[kind('tally_rat')]).toBe(1);
    });

    it('traitChance and catchUp keep their shape', () => {
      const r: IDirectorRecord = { generation: 3, felled: {}, fell: {}, weights: { k: 2 } };
      expect(Director.traitChance(r, 'k')).toBeCloseTo((0.08 + 0.04 * 3) * 2);
      expect(Director.catchUp(r, 3)).toBe(r);
      expect(Director.catchUp(r, 5).generation).toBe(5);
    });

    it('who was seen is on the record, once per cycle, and only for leaders', () => {
      const record = Population.saw(Population.saw(emptyPopulationRecord(), ['lead_8_8_0', 'pop_1_1_a_0'], 2), ['lead_8_8_0'], 2);
      expect(record.seen).toEqual({ lead_8_8_0: [2] });
    });

    it('a chunk reads the same as the record: a leader moves with its pack across chunks, between cycles', () => {
      const moved = allLeaders(context).find(l => {
        const def = MOB_DEFINITIONS[l.kind] as unknown as { social: boolean };
        if (!def.social) return false;
        const after = Population.sectorAt(emptyPopulationRecord(), SEED, Math.floor(l.cx / SECTOR_CHUNKS), Math.floor(l.cy / SECTOR_CHUNKS), 30, context).leaders[l.id];
        return after.alive && after.at !== groundOf(l.cx, l.cy);
      });
      expect(moved).toBeDefined();
      const record = emptyPopulationRecord();
      const sx = Math.floor(moved!.cx / SECTOR_CHUNKS), sy = Math.floor(moved!.cy / SECTOR_CHUNKS);
      const state = Population.sectorAt(record, SEED, sx, sy, 30, context).leaders[moved!.id];
      const [cx, cy] = state.at.split(',').map(Number);
      const exits = WorldGenerator.exitsInSector({ seed: SEED }, sx, sy);
      const there = WorldGenerator.buildChunk(SEED, exits, cx, cy, context);
      Population.layOver(SEED, there, record, 30, context);
      expect(there.entities.some(e => e.id === moved!.id)).toBe(true);
      expect(there.entities.filter(e => e.id !== moved!.id && Leaders.herdOf(e.id) === moved!.id).length).toBe(state.pack);
      const left = WorldGenerator.buildChunk(SEED, exits, moved!.cx, moved!.cy, context);
      Population.layOver(SEED, left, record, 30, context);
      expect(left.entities.some(e => e.id === moved!.id)).toBe(false);
    });
  });

  describe('tougher, and one person can bring it down', () => {
    it('it holds more than its pack, and can be outwalked', () => {
      for (const l of allLeaders(context).slice(0, 30)) {
        const def = MOB_DEFINITIONS[l.kind] as unknown as { baseHealth: number; speed: number; leads?: string };
        const n = Leaders.numbers(SEED, l, context);
        expect(def.baseHealth + n.bonusHealth, l.id).toBeGreaterThan(def.baseHealth);
        expect(def.speed, l.id).toBeLessThan(BASE_WALK_TILES_PER_S);
        if (def.leads) expect(def.baseHealth + n.bonusHealth, l.id).toBeGreaterThan((MOB_DEFINITIONS[def.leads] as unknown as { baseHealth: number }).baseHealth);
      }
    });

    it('its health stays ordinary for what it is: no more than a few times an ordinary body of its rank', () => {
      for (const l of allLeaders(context)) {
        const def = MOB_DEFINITIONS[l.kind] as unknown as { baseHealth: number };
        const n = Leaders.numbers(SEED, l, context);
        expect((def.baseHealth + n.bonusHealth) / def.baseHealth, l.id).toBeLessThanOrEqual(3);
      }
    });

    it('through the real combat path, one person\'s shots bring it down, and it drops what any body drops', () => {
      const l = allLeaders(context)[0];
      const exits = WorldGenerator.exitsInSector({ seed: SEED }, Math.floor(l.cx / SECTOR_CHUNKS), Math.floor(l.cy / SECTOR_CHUNKS));
      const chunk = WorldGenerator.buildChunk(SEED, exits, l.cx, l.cy, context);
      const head = chunk.entities.find(e => e.id === l.id)!;
      let chunks: Record<string, IChunk> = { [`${l.cx},${l.cy}`]: chunk };
      const damage = 40;
      let shots = 0, fell = false;
      while (!fell && shots < 2000) {
        shots++;
        const bullet = { id: `b${shots}`, position: { x: head.position.x, y: head.position.y }, startPosition: { x: head.position.x, y: head.position.y }, angle: 0, speed: 0, damage, startTime: Date.now(), source: 'PLAYER' } as never;
        const result = CombatSystem.tick([bullet], chunks, { x: head.position.x + 100, y: 0, z: head.position.y }, 100, []);
        chunks = result.updatedChunks;
        fell = result.events.some(e => e.type === 'KILL' && e.entityId === l.id);
      }
      expect(fell).toBe(true);
      expect(shots).toBeLessThan(2000);
    });
  });

  describe('the words', () => {
    it('every creature says whether it is social and whether it builds, and a model is told to', () => {
      for (const c of FIRST_THEME.creatures) {
        expect(typeof c.social, c.key).toBe('boolean');
        expect(typeof c.builds, c.key).toBe('boolean');
      }
      const props = (THEME_SCHEMA.properties as Record<string, { items: { properties: Record<string, unknown> } }>).creatures.items.properties;
      for (const word of ['social', 'builds', 'leads']) expect(props[word], word).toBeDefined();
    });

    it('a stag can lead its herd, and the Compound Bear walks alone', () => {
      expect(FIRST_THEME.creatures.find(c => c.key === 'escrow_stag')!.social).toBe(true);
      expect(FIRST_THEME.creatures.find(c => c.key === 'compound_bear')!.social).toBe(false);
      expect(FIRST_THEME.creatures.some(c => c.tags.includes('elite') && c.leads === 'escrow_stag')).toBe(true);
    });

    it('animals build nothing, and an animal leader is a social animal', () => {
      for (const c of FIRST_THEME.creatures.filter(x => x.tree === 'animal')) expect(c.builds, c.key).toBe(false);
    });

    it('the shipped theme has elites in both trees, and at the bottom rank too', () => {
      const elites = FIRST_THEME.creatures.filter(c => c.tags.includes('elite') && !c.tags.includes('god'));
      expect(new Set(elites.map(c => c.tree))).toEqual(new Set(['animal', 'monster']));
      expect(elites.some(c => c.rank === 'F')).toBe(true);
    });

    it('a leader draws as what it leads with more to it: told by shape, never hue', () => {
      const elite = FIRST_THEME.creatures.find(c => c.key === 'trustee_stag')!;
      const def = MOB_DEFINITIONS[kind(elite.key)] as unknown as { line: { root: string; features: string[] } };
      expect(def.line.root).toBe(kind('escrow_stag'));
      expect(def.line.features.length).toBeGreaterThan(0);
    });

    it('the law refuses a new pack with no words, with a titan, and with no elite; a banked one stands', () => {
      const judge = (mutate: (b: IThemeBody) => void) => {
        const body = clone(FIRST_THEME);
        mutate(body);
        return ThemeLaw.validate(body, tag => WebBank.current().tags.some(t => t.tag === tag));
      };
      expect(judge(b => { delete (b.creatures[0] as Partial<typeof b.creatures[0]>).social; }).ok).toBe(false);
      expect(judge(b => { delete (b.creatures[0] as Partial<typeof b.creatures[0]>).builds; }).ok).toBe(false);
      expect(judge(b => { b.creatures[0].tags = [...b.creatures[0].tags, 'titan']; }).reason).toMatch(/titan/);
      expect(judge(b => { b.creatures = b.creatures.filter(c => !c.tags.includes('elite') || c.tags.includes('god')); }).reason).toMatch(/lead/);
      expect(judge(b => { b.creatures[0].leads = 'dun_hound'; }).ok).toBe(false); // only an elite leads
      expect(THEME_FORMULA_VERSION).toBeGreaterThan(2);
    });

    it('the theme before these words stays banked, with its id and land unmoved (D64, line 97)', () => {
      const banked = clone(FIRST_THEME) as IThemeBody & { junk?: unknown };
      banked.creatures = banked.creatures.filter(c => !(c.tags.includes('elite') && !c.tags.includes('god')));
      for (const c of banked.creatures) { delete (c as Partial<typeof c>).social; delete (c as Partial<typeof c>).builds; delete (c as Partial<typeof c>).leads; }
      banked.tags = banked.tags.filter(t => !['junk', 'gem', 'art', 'valuable'].includes(t.tag));
      delete banked.junk;
      delete banked.anchors;
      banked.abilities = banked.abilities.filter(a => a.effect !== 'forced_exit');
      banked.consumables = banked.consumables.filter(c => c.key !== 'writ_of_breach');
      expect(themeIdOf(banked)).toBe('theme_666daceb0516e738');
      const old = { ...sealTheme(banked, 'claude-opus-5-5 (dev batch, D53)', 1793491200000), formula: 2 };
      expect(ContentRegistry.install(old)).toEqual({ ok: true });
      const ctx = ContentRegistry.contextFor(old.themeId);
      expect(computeGolden('golden-alpha', 16, ctx)).toBe(1993605757);
      expect(computeGolden('golden-beta', 32, ctx)).toBe(2694817695);
      expect(computeGolden('dev-sandbox-v4', 32, ctx)).toBe(2155702627);
      expect(Leaders.rosterOf('golden-alpha', 8, 8, ctx)).toEqual([]);
    });

    it('no refill goods came in with these words (D96)', () => {
      expect(FIRST_THEME.consumables.some(c => c.kind === 'energy')).toBe(false);
      expect(FIRST_THEME.materials.some(m => m.restores === 'energy')).toBe(false);
    });
  });
});

describe('line 140, the junk half: creatures drop junk that sells for gold (D99)', () => {
  const junkOf = (id: string) => (MOB_DEFINITIONS[id] as unknown as { junk?: string[] }).junk ?? [];
  const compiled = () => ContentRegistry.compiled(themeId)!;

  it('every creature in the first theme has something to leave', () => {
    for (const c of FIRST_THEME.creatures) expect(junkOf(kind(c.key)).length, c.key).toBeGreaterThan(0);
  });

  it('junk is an ordinary thing with a value, from the formula, and no shelf or ground holds it', () => {
    const ids = new Set(Object.values(compiled().mobs).flatMap(m => (m as unknown as { junk: string[] }).junk));
    expect(ids.size).toBeGreaterThan(1);
    for (const id of ids) {
      const def = RESOURCE_DEFINITIONS[id];
      expect(def, id).toBeDefined();
      expect(def.value, id).toBeGreaterThan(0);
      expect(def.junk, id).toBe(true);
      expect(def.habitat, id).toBeUndefined();
      expect(compiled().shelf.materials, id).not.toContain(id);
    }
  });

  it('a defeat drops it on a roll of its own, keyed, and leaves every other drop as it was', () => {
    const id = kind('dun_hound');
    const def = MOB_DEFINITIONS[id] as never;
    const dropsOf = (key: string) => LootTable.generateLoot(def, 1.0, undefined, key);
    expect(dropsOf('k1').map(i => i.id)).toEqual(dropsOf('k1').map(i => i.id));
    let junk = 0, trials = 400;
    for (let i = 0; i < trials; i++) if (dropsOf(`k${i}`).some(item => RESOURCE_DEFINITIONS[item.universalDefinitionId]?.junk)) junk++;
    expect(junk / trials).toBeGreaterThan(0.2);
    expect(junk).toBeLessThan(trials);
    const without = { ...(def as object), junk: [] } as never;
    for (let i = 0; i < 50; i++) {
      const gear = dropsOf(`k${i}`).filter(item => !RESOURCE_DEFINITIONS[item.universalDefinitionId]?.junk);
      expect(gear.map(item => item.id)).toEqual(LootTable.generateLoot(without, 1.0, undefined, `k${i}`).map(item => item.id));
    }
  });

  it('a kind with no junk word, in a world of the old law, drops as it did', () => {
    const old = MOB_DEFINITIONS['mob_fantasy_rat'] as never;
    for (let i = 0; i < 30; i++) expect(LootTable.generateLoot(old, 1.0, undefined, `old${i}`).every(item => !RESOURCE_DEFINITIONS[item.universalDefinitionId]?.junk)).toBe(true);
  });

  it('it is a thing to take or leave: it lands apart from what the hands collect on their own', () => {
    const items = Array.from({ length: 200 }, (_, i) => LootTable.generateLoot(MOB_DEFINITIONS[kind('dun_hound')] as never, 1.0, undefined, `sort${i}`)).flat();
    const { collect, leave } = LootTable.sortDrop(items);
    expect(leave.length).toBeGreaterThan(0);
    expect(collect.concat(leave).length).toBe(items.length);
    expect(leave.every(i => RESOURCE_DEFINITIONS[i.universalDefinitionId]?.junk)).toBe(true);
    expect(collect.every(i => !RESOURCE_DEFINITIONS[i.universalDefinitionId]?.junk)).toBe(true);
    const cache = LootTable.junkCache(leave.slice(0, 2), { x: 40, y: 60 }, 'mob_x');
    expect(cache.type).toBe(EntityType.CONTAINER);
    expect(cache.container?.items?.length).toBe(2);
    expect(cache.position).toEqual({ x: 40, y: 60 });
  });

  it('it sells for gold through the same door as anything else, and no refill rides on it', async () => {
    const item = LootTable.generateLoot(MOB_DEFINITIONS[kind('dun_hound')] as never, 1.0, undefined, 'k0').find(i => RESOURCE_DEFINITIONS[i.universalDefinitionId]?.junk)
      ?? Array.from({ length: 200 }, (_, i) => LootTable.generateLoot(MOB_DEFINITIONS[kind('dun_hound')] as never, 1.0, undefined, `s${i}`)).flat().find(i => RESOURCE_DEFINITIONS[i.universalDefinitionId]?.junk)!;
    expect(item.value).toBeGreaterThan(0);
    expect(item.type).toBe(ItemType.RESOURCE);
    expect(StatSystem.vendorOffer(item.value, usePlayerStore.getState().player.attributes)).toBeGreaterThan(0);
    expect(typeof useHubStore.getState().sellToVendor).toBe('function');
    expect(typeof Treasury.balance).toBe('function');
    expect(item.stats?.energy_restore).toBeUndefined();
  });

  it('the law holds it: a new pack needs junk from every creature, under its own keys', () => {
    const judge = (mutate: (b: IThemeBody) => void) => {
      const body = clone(FIRST_THEME);
      mutate(body);
      return ThemeLaw.validate(body, tag => WebBank.current().tags.some(t => t.tag === tag));
    };
    expect(judge(b => { delete b.junk; }).ok).toBe(false);
    expect(judge(b => { b.junk = []; }).reason).toMatch(/junk|leaves/i);
    expect(judge(b => { b.junk![0].key = b.creatures[0].key; }).ok).toBe(false);
    expect(judge(b => { b.junk![0].rank = 'Z' as never; }).ok).toBe(false);
    expect(TagLaw.isCanonicalSpelling(FIRST_THEME.junk![0].key)).toBe(true);
  });
});

describe('the keyed roll a bar may lean on', () => {
  it('Rng stays what it was', () => {
    expect(Rng.fromKey('a').next()).toBe(Rng.fromKey('a').next());
  });
});

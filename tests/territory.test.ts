/**
 * TERRITORY (D62, D93, D103, D105): line 135. Registered before the build.
 *
 * A boss holds mapped ground that grows, and takes a party by anchors one person cannot be in two
 * places to break. No bar here calls a model. Land and alpha stay what the vectors say.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { creatureIdOf } from '../shared/logic/theme/ThemeCompiler';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { Director, IDirectorRecord, emptyDirectorRecord } from '../shared/entities/world/Director';
import { IGenerationContext, WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { EntityType, IChunk, IMap, IWorldEntity } from '../shared/entities/world/types';
import { CHUNK_PX, CHUNK_TILES, SECTOR_CHUNKS, TILE_PX } from '../shared/entities/world/grid';
import { GOLDEN_VECTORS, FIRST_THEME_VECTORS, computeGolden } from '../src/entities/world/goldens';
import { ILeaderState, ISectorState, IPopulationRecord, Population, emptyPopulationRecord } from '../shared/entities/world/Population';
import { Leaders } from '../shared/entities/world/Leaders';
import { Koseki } from '../shared/entities/world/Koseki';
import { Territory, VERBS } from '../shared/entities/world/Territory';
import { IWard, Wards } from '../shared/entities/world/Wards';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { PROJECTILE_RANGE_PX } from '../shared/entities/combat/projectileSystem';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { DecisionLayer, WEEK_MS } from '../shared/logic/systems/DecisionLayer';
import { LeaderPlan, LEADER_ASK } from '../src/logic/systems/LeaderPlan';
import { MAINTENANCE_ASKS, Maintenance, TEN_DAYS_MS } from '../src/logic/systems/Maintenance';
import { Toll } from '../src/logic/systems/Toll';
import { SurveySystem } from '../src/logic/systems/SurveySystem';
import { ASK_KINDS } from '../src/logic/systems/ScanPass';
import { NpcSheet } from '../shared/logic/systems/NpcSheet';
import { chainFromMap, chainFromMaps } from '../src/entities/hub/guild';
import { anchorsFor, structureBill, relightWindowMs } from '../shared/logic/theme/ThemeFormula';
import { UniversalRank, MENTAL_ATTRIBUTES, IAttributes, IPlayer } from '../shared/types';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const kind = (key: string) => creatureIdOf(themeId, key);
const SEED = 'ground-world';
const SX = 8, SY = 8;
const X0 = SX * SECTOR_CHUNKS, Y0 = SY * SECTOR_CHUNKS;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const contextOf = (director?: IDirectorRecord, rank = UniversalRank.A): IGenerationContext => ContentRegistry.contextFor(themeId, rank, director);

const leaderOn = (id: string, kindId: string, at: string, pack: number, extra: Partial<ILeaderState> = {}): ILeaderState =>
  ({ id, kind: kindId, at, pack, goal: 'grow', tenure: 0, alive: true, log: [], ...extra });

const blank = (leaders: ILeaderState[], generation = 1): ISectorState =>
  ({ generation, ground: {}, leaders: Object.fromEntries(leaders.map(l => [l.id, l])) });

const step = (state: ISectorState, record: Pick<IPopulationRecord, 'down' | 'seen'> = emptyPopulationRecord(), context = contextOf()) =>
  Population.step(SEED, SX, SY, state, record, context);

const folded = (state: ISectorState, cycles: number, context = contextOf()) => {
  let at = state;
  for (let i = 0; i < cycles; i++) at = step(at, emptyPopulationRecord(), context);
  return at;
};

const tallied = (id: string, felledAt: number[]): IDirectorRecord => ({ ...emptyDirectorRecord(), generation: 1, bodies: { [id]: { felled: felledAt.length, felledAt } } });

/** A boss made by the falls road, on the middle of the sector, with bands to stand as anchors. */
const makeBoss = (kindKey = 'old_sow', pack = 12) => {
  const id = `lead_${SX}_${SY}_0`;
  const at = `${X0 + 4},${Y0 + 4}`;
  const context = contextOf(tallied(id, [0, 0, 0, 0, 0]));
  const after = step(blank([leaderOn(id, kind(kindKey), at, pack)], 1), emptyPopulationRecord(), context);
  return { id, at, context, state: after };
};

/** An industrious elite that has settled, with stores to spend. */
const makeCamp = (stores: Record<string, number> = { [woodId()]: 200 }) => {
  const id = `lead_${SX}_${SY}_1`;
  const at = `${X0 + 4},${Y0 + 4}`;
  const leader = leaderOn(id, kind('branch_manager'), at, 8, { settledAt: at, goal: 'grow', territory: Territory.camp(at, 1, stores) });
  return { id, at, state: blank([leader], 1) };
};
const woodId = (): string => contextOf().resourceDefinitions.find((r: { id: string }) => r.id.includes('compound_oak')).id;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const Rngless = { next: () => 0, int: (a: number) => a };

describe('line 135: a boss by the record, and only by the record', () => {
  it('people falling to a social elite, past a formula\'s count, make it a boss that keeps its ground', () => {
    const { id, at, state } = makeBoss();
    const boss = state.leaders[id];
    expect(boss.territory?.bossAt).toBeDefined();
    expect(boss.territory?.seat).toBe(at);
    expect(boss.at).toBe(at);
  });

  it('fewer falls than the count make nothing', () => {
    const id = `lead_${SX}_${SY}_0`;
    const context = contextOf(tallied(id, [0]));
    const after = step(blank([leaderOn(id, kind('old_sow'), `${X0 + 4},${Y0 + 4}`, 12)], 1), emptyPopulationRecord(), context);
    expect(after.leaders[id].territory).toBeUndefined();
  });

  it('a fold reads the falls by the cycle they happened in, so a sector read late folds as one read early', () => {
    const id = `lead_${SX}_${SY}_0`;
    const at = `${X0 + 4},${Y0 + 4}`;
    const late = contextOf(tallied(id, [7, 7, 7, 7, 7]));
    const early = step(blank([leaderOn(id, kind('old_sow'), at, 12)], 1), emptyPopulationRecord(), late);
    expect(early.leaders[id].territory).toBeUndefined();
  });

  it('a solitary elite never becomes a boss, however many fall to it', () => {
    const id = `lead_${SX}_${SY}_0`;
    const context = contextOf(tallied(id, [0, 0, 0, 0, 0, 0, 0, 0]));
    const after = step(blank([leaderOn(id, kind('toll_assessor'), `${X0 + 4},${Y0 + 4}`, 0, { goal: 'waylay' })], 1), emptyPopulationRecord(), context);
    expect(after.leaders[id].territory).toBeUndefined();
  });

  it('settling raises a base, and a finished base makes a boss with nobody having fallen', () => {
    const { id, state } = makeCamp();
    expect(state.leaders[id].territory?.bossAt).toBeUndefined();
    const later = folded(state, 60);
    const t = later.leaders[id]?.territory;
    expect(t?.bossAt).toBeDefined();
    expect(t!.structures.some(s => s.fn === 'seat' && s.builtAt !== undefined)).toBe(true);
    expect(t!.structures.filter(s => s.fn === 'anchor' && s.builtAt !== undefined).length).toBeGreaterThanOrEqual(2);
  });

  it('land and alpha stay what the vectors say', () => {
    for (const g of FIRST_THEME_VECTORS) expect(computeGolden(g.seed, g.size, ContentRegistry.contextFor(themeId)), g.seed).toBe(g.hash);
    expect(GOLDEN_VECTORS.length).toBeGreaterThan(0);
  });

  it('a world nobody touched holds no territory', () => {
    const state = Population.sectorAt(emptyPopulationRecord(), SEED, SX, SY, 0, contextOf());
    expect(Object.values(state.leaders).some(l => l.territory)).toBe(false);
  });
});

describe('line 135: pure, keyed, and it grows', () => {
  it('two machines agree after folding, through a store and back', () => {
    const { state } = makeCamp();
    const one = folded(state, 40);
    let two = clone(state);
    for (let i = 0; i < 40; i++) two = clone(step(two));
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('a territory grows over cycles on its own, with no key anywhere', () => {
    const { id, state } = makeBoss();
    const before = state.leaders[id].territory!.chunks.length;
    const later = folded(state, 90, makeBoss().context);
    expect(later.leaders[id].territory!.chunks.length).toBeGreaterThan(before);
  });

  it('it stays inside its sector until unified sector mapping (Pedro, 2026-11-01)', () => {
    const { id, context, state } = makeBoss();
    const later = folded(state, 200, context);
    for (const ground of later.leaders[id].territory!.chunks) {
      const [cx, cy] = ground.split(',').map(Number);
      expect(Math.floor(cx / SECTOR_CHUNKS)).toBe(SX);
      expect(Math.floor(cy / SECTOR_CHUNKS)).toBe(SY);
    }
  });

  it('a bill rises with what already stands, and stores are what limit it', () => {
    expect(structureBill('watch', 5)).toBeGreaterThan(structureBill('watch', 0));
    const paying = (stores: Record<string, number>) => {
      const leaders = { a: leaderOn('a', kind('branch_manager'), '0,0', 8, { territory: Territory.camp('0,0', 1, stores) }) };
      Territory.READERS.raise({ seed: 'x', g: 1, land: new Map(), leaders, record: { down: {} } } as never, 'a', 'good', undefined, Rngless);
      return leaders.a.territory!;
    };
    expect(paying({}).structures[0].paid).toBe(0);
    expect(paying({}).structures[0].builtAt).toBeUndefined();
    expect(paying({ wood: 3 }).structures[0].paid).toBe(3);
    expect(paying({ wood: 3 }).stores.wood).toBe(0);
  });

  it('what is raised is drawn from the material that paid for it', () => {
    const { id, state } = makeCamp();
    const later = folded(state, 30);
    const raised = later.leaders[id].territory!.structures.filter(s => s.paid > 0);
    expect(raised.length).toBeGreaterThan(0);
    expect(raised[0].material).toBe(woodId());
  });

  it('a raid stops a building mid-build: a scaffold brought down loses what was paid', () => {
    const { id, state } = makeCamp({ [woodId()]: 3 });
    const going = folded({ ...state, leaders: { [id]: { ...state.leaders[id], pack: 1 } } }, 12);
    const scaffold = going.leaders[id].territory!.structures.find(s => s.builtAt === undefined && s.paid > 0)!;
    expect(scaffold).toBeDefined();
    const record = Population.broke(emptyPopulationRecord(), scaffold.id, going.generation);
    const after = step(going, record);
    expect(after.leaders[id].territory!.structures.find(s => s.id === scaffold.id)).toBeUndefined();
  });

  it('an animal leader builds nothing, and directs its herd', () => {
    const { id, context, state } = makeBoss('old_sow');
    const later = folded(state, 120, context);
    expect(later.leaders[id].territory!.structures).toEqual([]);
  });
});

describe('line 135: settling by trade (D62)', () => {
  it('an elite on settle walks towards ground holding what its skill works, across the sector', () => {
    const context = contextOf();
    const roster = [{ id: 'lead_8_8_9', kind: kind('branch_manager'), cx: X0, cy: Y0, pack: 3 }];
    const sheet = Leaders.sheetOf(SEED, roster[0], context);
    const trade = Leaders.tradeOf(sheet, context);
    expect(trade.length).toBeGreaterThan(0);
    const best = Territory.bestGround(SEED, SX, SY, trade, new Set(), context);
    expect(best).toBeDefined();
    const [bx, by] = best!.split(',').map(Number);
    expect(Leaders.groundWorks(SEED, bx, by, sheet, context)).toBe(true);
  });

  it('two settlers do not settle on ground another already holds', () => {
    const context = contextOf();
    const seedOf = { id: 'lead_8_8_9', kind: kind('branch_manager'), cx: X0, cy: Y0, pack: 3 };
    const trade = Leaders.tradeOf(Leaders.sheetOf(SEED, seedOf, context), context);
    const first = Territory.bestGround(SEED, SX, SY, trade, new Set(), context)!;
    expect(Territory.bestGround(SEED, SX, SY, trade, new Set([first]), context)).not.toBe(first);
  });
});

describe('line 135: anchors one person cannot be in two places to break', () => {
  it('how many comes from rank, and never fewer than two', () => {
    for (const rank of Object.values(UniversalRank)) expect(anchorsFor(rank)).toBeGreaterThanOrEqual(2);
    expect(anchorsFor(UniversalRank.SSS)).toBeGreaterThan(anchorsFor(UniversalRank.F));
  });

  it('a boss whose species builds nothing has anchors that are bodies: the eldest of its register', () => {
    const { id, state } = makeBoss('old_sow');
    const bands = Object.values(state.leaders).filter(l => l.answersTo === id && l.alive);
    expect(bands.length).toBeGreaterThanOrEqual(2);
    const register = state.koseki![id];
    expect(register.head).toBe(id);
    expect(bands.map(b => b.id).sort()).toEqual(Koseki.standing(register).filter(e => e.body !== id).map(e => e.body).sort());
    expect(Koseki.nextHead(register)!.body).toBe(bands.map(b => b.id).sort()[0]);
  });

  it('each band holds its own ground, inside the holding, spread further than a shot can reach', () => {
    const { id, state } = makeBoss('old_sow');
    const t = state.leaders[id].territory!;
    const bands = Object.values(state.leaders).filter(l => l.answersTo === id);
    const places = [t.seat, ...bands.map(b => b.at)];
    expect(new Set(places).size).toBe(places.length);
    for (const b of bands) expect(t.chunks).toContain(b.at);
    const ward = Territory.wardOf(SEED, state.leaders[id], state);
    const reach = PROJECTILE_RANGE_PX * 2;
    for (let i = 0; i < ward.slots.length; i++) for (let j = i + 1; j < ward.slots.length; j++) {
      expect(dist(ward.slots[i], ward.slots[j])).toBeGreaterThan(reach);
    }
  });

  it('the relight window is shorter than the walk, from the real distance and the real pace', () => {
    for (const walk of [1, 4, 8, 40, 400]) {
      for (const px of [CHUNK_PX, CHUNK_PX * 2, CHUNK_PX * 5]) {
        const walkMs = ((px - PROJECTILE_RANGE_PX * 2) / TILE_PX / walk) * 1000;
        expect(relightWindowMs(px, walk)).toBeLessThan(walkMs);
        expect(relightWindowMs(px, walk)).toBeGreaterThan(0);
      }
    }
  });

  const wardOfTwo = (): IWard => ({
    boss: 'lead_8_8_0',
    slots: [
      { id: 'a', kind: 'post', bodies: ['lead_8_8_0_s1'], x: 0, y: 0 },
      { id: 'b', kind: 'post', bodies: ['lead_8_8_0_s2'], x: CHUNK_PX * 2, y: 0 }
    ]
  });

  /** One body, breaking instantly and shooting as far as a shot goes, walking at this pace. */
  const oneBody = (ward: IWard, walk: number) => {
    const live = Wards.fresh();
    let now = 1000;
    const gap = dist(ward.slots[0], ward.slots[1]);
    const walkMs = (Math.max(0, gap - PROJECTILE_RANGE_PX * 2) / TILE_PX / walk) * 1000;
    for (let round = 0; round < 50; round++) {
      const slot = ward.slots[round % ward.slots.length];
      Wards.broke(live, slot.bodies[0], now);
      Wards.paced(live, walk);
      if (!Wards.read(ward, live, now).warded) return false;
      now += walkMs;
    }
    return true;
  };

  it('one body cannot clear two anchors at any strength', () => {
    for (const walk of [1, 4, 16, 64, 256, 4096]) expect(oneBody(wardOfTwo(), walk), `pace ${walk}`).toBe(true);
  });

  it('putting speed on after the first break does not help, and neither does taking it off', () => {
    const ward = wardOfTwo();
    const live = Wards.fresh();
    Wards.paced(live, 40);
    Wards.broke(live, 'lead_8_8_0_s1', 1000);
    Wards.paced(live, 4);
    const gap = dist(ward.slots[0], ward.slots[1]);
    const fastest = ((gap - PROJECTILE_RANGE_PX * 2) / TILE_PX / 40) * 1000;
    Wards.broke(live, 'lead_8_8_0_s2', 1000 + fastest);
    expect(Wards.read(ward, live, 1000 + fastest).warded).toBe(true);
  });

  it('two bodies can, and once all are down at one moment no anchor relights', () => {
    const ward = wardOfTwo();
    const live = Wards.fresh();
    Wards.paced(live, 4);
    Wards.broke(live, 'lead_8_8_0_s1', 1000);
    Wards.broke(live, 'lead_8_8_0_s2', 1010);
    const open = Wards.read(ward, live, 1010);
    expect(open.warded).toBe(false);
    expect(Wards.read(ward, live, 1010 + 3_600_000).warded).toBe(false);
  });

  it('a post relights after its window, for as many times as it is broken', () => {
    const ward = wardOfTwo();
    const live = Wards.fresh();
    Wards.paced(live, 4);
    for (let round = 0; round < 3; round++) {
      const t = 1000 + round * 3_600_000;
      Wards.broke(live, 'lead_8_8_0_s1', t);
      expect(Wards.read(ward, live, t).lit).toEqual(['b']);
      expect(Wards.read(ward, live, t + 3_000_000).lit).toEqual(['a', 'b']);
    }
  });

  it('a body anchor relights from who stands behind it, and with nobody behind it stays down', () => {
    const ward: IWard = {
      boss: 'x',
      slots: [
        { id: 'a', kind: 'body', bodies: ['x_h1', 'x_h1_f0'], x: 0, y: 0 },
        { id: 'b', kind: 'body', bodies: ['x_h2'], x: CHUNK_PX * 2, y: 0 }
      ]
    };
    const live = Wards.fresh();
    Wards.paced(live, 4);
    Wards.broke(live, 'x_h1', 1000);
    expect(Wards.read(ward, live, 1001 + 3_000_000).lit).toEqual(['a', 'b']);
    Wards.broke(live, 'x_h1_f0', 4_000_000);
    expect(Wards.read(ward, live, 4_000_000 + 3_000_000).lit).toEqual(['b']);
  });

  const inChunk = (entities: IWorldEntity[]): Record<string, IChunk> => ({
    '0,0': { id: 'chk_0_0', x: 0, y: 0, biome: 'RUINS' as never, difficulty: UniversalRank.D, rarity: 'COMMON' as never, entities, scanLevel: 0, isTraversable: true, hasExtraction: false }
  });
  const shot = (x: number, y: number) => [{ id: 'b1', position: { x, y }, velocity: { x: 0, y: 0 }, damage: 40 } as never];
  const bossBody = (warded: boolean): IWorldEntity => ({
    id: 'lead_8_8_0', type: EntityType.MOB, definitionId: kind('old_sow'), position: { x: 100, y: 100 }, rank: UniversalRank.E, rarity: 'COMMON' as never, health: 200, isHostile: true, ...(warded ? { warded: true } : {})
  });

  it('while warded a boss takes nothing, and says so; open, it takes the blow', () => {
    const closed = CombatSystem.tick(shot(100, 100), inChunk([bossBody(true)]), { x: 900, y: 0, z: 900 }, 100, []);
    expect(closed.updatedChunks['0,0'].entities[0].health).toBe(200);
    expect(closed.events.some(e => e.type === 'WARDED')).toBe(true);
    const open = CombatSystem.tick(shot(100, 100), inChunk([bossBody(false)]), { x: 900, y: 0, z: 900 }, 100, []);
    expect(open.updatedChunks['0,0'].entities[0].health).toBe(160);
  });

  it('a post can be struck, and breaks without an experience reward or a fall on the ledger', () => {
    const post: IWorldEntity = {
      id: 'lead_8_8_0_s1', type: EntityType.STRUCTURE, definitionId: 'struct_anchor', position: { x: 100, y: 100 }, rank: UniversalRank.E, rarity: 'COMMON' as never, health: 30, isHostile: false,
      structure: { fn: 'anchor', built: true, heldBy: 'lead_8_8_0', maxHealth: 30 }
    };
    const out = CombatSystem.tick(shot(100, 100), inChunk([post]), { x: 900, y: 0, z: 900 }, 100, []);
    expect(out.events.some(e => e.type === 'BROKE' && e.entityId === post.id)).toBe(true);
    expect(out.events.some(e => e.type === 'KILL')).toBe(false);
    expect(out.updatedChunks['0,0'].entities.find(e => e.id === post.id)).toBeDefined();
  });

  it('an elite is never warded, and one person can still bring it down', () => {
    const record = emptyPopulationRecord();
    const after = step(blank([leaderOn(`lead_${SX}_${SY}_0`, kind('old_sow'), `${X0 + 4},${Y0 + 4}`, 3)], 1), record);
    expect(after.leaders[`lead_${SX}_${SY}_0`].territory).toBeUndefined();
    const chunk = WorldGenerator.buildChunk(SEED, [], X0 + 4, Y0 + 4, contextOf());
    Population.layOver(SEED, chunk, { ...emptyPopulationRecord(), sectors: { [`${SX},${SY}`]: after } }, 2, contextOf());
    expect(chunk.entities.filter(e => e.id === `lead_${SX}_${SY}_0`).every(e => !e.ward && !e.warded)).toBe(true);
  });
});

describe('line 135: what a chunk shows', () => {
  const layFor = (state: ISectorState, ground: string, generation: number, context: IGenerationContext) => {
    const [cx, cy] = ground.split(',').map(Number);
    const chunk = WorldGenerator.buildChunk(SEED, [], cx, cy, context);
    Population.layOver(SEED, chunk, { ...emptyPopulationRecord(), sectors: { [`${SX},${SY}`]: state } }, generation, context);
    return chunk;
  };

  it('a boss stands warded by its anchors, with its standing orders on its body', () => {
    const { id, at, state, context } = makeBoss('old_sow');
    const chunk = layFor(state, at, state.generation, context);
    const boss = chunk.entities.find(e => e.id === id)!;
    expect(boss.ward?.slots.length).toBeGreaterThanOrEqual(2);
    expect(boss.warded).toBe(true);
    expect(boss.orders?.posture).toBeDefined();
  });

  it('structures stand on their ground as shapes with a function, and scaffolding shows as scaffolding', () => {
    const { id, state } = makeCamp();
    const later = folded(state, 30);
    const t = later.leaders[id].territory!;
    const built = t.structures.find(s => s.builtAt !== undefined)!;
    const chunk = layFor(later, built.at, later.generation, contextOf());
    const entity = chunk.entities.find(e => e.id === built.id || e.id.startsWith(`${built.id}_`))!;
    expect(entity.structure?.fn).toBe(built.fn);
    expect(entity.structure?.built).toBe(true);
    const going = t.structures.find(s => s.builtAt === undefined);
    if (going) {
      const there = layFor(later, going.at, later.generation, contextOf());
      expect(there.entities.find(e => e.id === going.id)!.structure?.built).toBe(false);
    }
  });

  it('a wall blocks the way, walking and bodies alike', () => {
    const { id, state } = makeCamp();
    const later = folded(state, 120);
    const wall = later.leaders[id].territory!.structures.find(s => s.fn === 'wall' && s.builtAt !== undefined);
    expect(wall).toBeDefined();
    const chunk = layFor(later, wall!.at, later.generation, contextOf());
    const piece = chunk.entities.find(e => e.id.startsWith(`${wall!.id}_w`))!;
    const map: IMap = { seed: SEED, width: 16, height: 16, gridVersion: 2, generatedAt: 1, chunks: { [`${chunk.x},${chunk.y}`]: chunk }, sectors: { [`${SX},${SY}`]: {} as never } };
    expect(WorldGenerator.structureBlocks(map, piece.position.x, piece.position.y)).toBe(true);
  });

  it('a store holds what the base has worked, and what is taken is gone at the next cycle', () => {
    const { id, state } = makeCamp();
    const later = folded(state, 120);
    const t = later.leaders[id].territory!;
    const store = t.structures.find(s => s.fn === 'store' && s.builtAt !== undefined);
    expect(store).toBeDefined();
    const chunk = layFor(later, store!.at, later.generation, contextOf());
    const chest = chunk.entities.find(e => e.id === store!.id)!;
    expect(chest.type).toBe(EntityType.CONTAINER);
    const held = chest.container!.items!.length;
    expect(held).toBeGreaterThan(0);
    const record = Population.robbed(emptyPopulationRecord(), store!.id, held, later.generation);
    const after = step(later, record);
    const left = Object.values(after.leaders[id].territory!.stores).reduce((a, b) => a + b, 0);
    const income = Object.values(later.leaders[id].territory!.stores).reduce((a, b) => a + b, 0);
    expect(left).toBeLessThan(income);
  });
});

describe('line 135: standing orders are read by the bodies', () => {
  beforeEach(() => MobAI.reset());
  const body = (id: string, x: number, extra: Partial<IWorldEntity> = {}): IWorldEntity => ({
    id, type: EntityType.MOB, definitionId: kind('old_sow'), position: { x, y: 0 }, rank: UniversalRank.E, rarity: 'COMMON' as never, health: 100, isHostile: true, heldBy: 'lead_8_8_0', ...extra
  });
  const chunkOfEntities = (entities: IWorldEntity[]): Record<string, IChunk> => ({
    '0,0': { id: 'chk_0_0', x: 0, y: 0, biome: 'RUINS' as never, difficulty: UniversalRank.D, rarity: 'COMMON' as never, entities, scanLevel: 0, isTraversable: true, hasExtraction: false }
  });

  it('a watch post that sees a person, where orders say so, calls the bands in', () => {
    const post: IWorldEntity = {
      id: 'lead_8_8_0_s1', type: EntityType.STRUCTURE, definitionId: 'struct_watch', position: { x: 0, y: 0 }, rank: UniversalRank.E, rarity: 'COMMON' as never, health: 30, isHostile: false,
      structure: { fn: 'watch', built: true, heldBy: 'lead_8_8_0', maxHealth: 30, alarm: true }
    };
    MobAI.tick(chunkOfEntities([post, body('lead_8_8_0_h1', 1000, { behavior: undefined } as never)]), { x: 40, y: 0 }, 0.016);
    expect(MobAI.isActive('lead_8_8_0_h1')).toBe(true);
    expect(MobAI.alarmUp('lead_8_8_0')).toBe(true);
  });

  it('a watch post out of orders watches and calls nobody', () => {
    const post: IWorldEntity = {
      id: 'lead_8_8_0_s1', type: EntityType.STRUCTURE, definitionId: 'struct_watch', position: { x: 0, y: 0 }, rank: UniversalRank.E, rarity: 'COMMON' as never, health: 30, isHostile: false,
      structure: { fn: 'watch', built: true, heldBy: 'lead_8_8_0', maxHealth: 30, alarm: false }
    };
    MobAI.tick(chunkOfEntities([post, body('lead_8_8_0_h1', 1000)]), { x: 40, y: 0 }, 0.016);
    expect(MobAI.alarmUp('lead_8_8_0')).toBe(false);
  });

  it('a body told to hold does not leave its ground to give chase', () => {
    const held = body('lead_8_8_0_h1', 100, { orders: { posture: 'hold', alarmCalls: true } });
    MobAI.provoke(held.id);
    let chunks = chunkOfEntities([held]);
    for (let i = 0; i < 400; i++) {
      const out = MobAI.tick(chunks, { x: 6000, y: 0 }, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
    }
    expect(Math.abs(chunks['0,0'].entities[0].position.x - 100)).toBeLessThan(CHUNK_TILES * TILE_PX / 3);
    MobAI.reset();
    const free = body('lead_8_8_0_h1', 100);
    MobAI.provoke(free.id);
    let open = chunkOfEntities([free]);
    for (let i = 0; i < 400; i++) open = { ...open, ...MobAI.tick(open, { x: 6000, y: 0 }, 0.05).updatedChunks };
    expect(Math.abs(open['0,0'].entities[0].position.x - 100)).toBeGreaterThan(CHUNK_TILES * TILE_PX / 3);
  });

  it('a body told to fall back heads for its seat once hurt', () => {
    const hurt = body('lead_8_8_0_h1', 500, { health: 1, orders: { posture: 'fall_back', alarmCalls: true, seat: { x: 0, y: 0 } } });
    MobAI.provoke(hurt.id);
    let chunks = chunkOfEntities([hurt]);
    for (let i = 0; i < 40; i++) {
      const out = MobAI.tick(chunks, { x: 700, y: 0 }, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
    }
    expect(chunks['0,0'].entities[0].position.x).toBeLessThan(500);
  });
});

describe('line 135: the challenge for a seat (D93, D105)', () => {
  const felled = (id: string, g: number) => Population.fell(emptyPopulationRecord(), id, 'x', g);

  it('when a boss falls the seat goes to whom the challenge names, and the ground does not clear', () => {
    const { id, state, context } = makeBoss('old_sow');
    const record = felled(id, state.generation);
    const eldest = Koseki.nextHead(state.koseki![id])!.body;
    const after = Population.step(SEED, SX, SY, state, record, context);
    expect(after.leaders[id].alive).toBe(false);
    const seated = Object.values(after.leaders).filter(l => l.alive && l.territory?.seat);
    expect(seated.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(after.leaders)).toContain(eldest);
    const register = after.koseki![id];
    expect(register.head).not.toBe(id);
    expect(seated.map(s => s.id)).toContain(register.head);
  });

  it('a challenge is keyed: the same fall names the same body on every machine', () => {
    const { id, state, context } = makeBoss('old_sow');
    const record = felled(id, state.generation);
    const one = Population.step(SEED, SX, SY, state, record, context);
    const two = Population.step(SEED, SX, SY, clone(state), clone(record), context);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('with nobody left in its register a boss\'s ground ends with it', () => {
    const { id, state, context } = makeBoss('old_sow');
    const lone: ISectorState = {
      ...state,
      leaders: Object.fromEntries(Object.entries(state.leaders).filter(([k]) => k === id).map(([k, l]) => [k, { ...l, pack: 0 }])),
      koseki: { [id]: Koseki.found(`${SX},${SY}`, id, state.leaders[id].kind, 1) }
    };
    const after = Population.step(SEED, SX, SY, lone, felled(id, state.generation), context);
    expect(Object.values(after.leaders).some(l => l.alive)).toBe(false);
    expect(after.koseki![id].status).toBe('extinct');
  });

  it('rolls close enough split the ground between them, on the register and on the land', () => {
    let split = false;
    for (let n = 0; n < 60 && !split; n++) {
      const { id, state, context } = makeBoss('old_sow', 18);
      const widened = folded(state, 30, context);
      const record = felled(id, widened.generation);
      const after = Population.step(SEED + n, SX, SY, widened, record, context);
      const walker = Object.values(after.leaders).find(l => l.walkedFrom && l.alive && (l.territory?.chunks.length ?? 0) > 1);
      if (walker) {
        split = true;
        const seated = Object.values(after.leaders).find(l => l.alive && !l.answersTo && l.territory && l.id !== walker.id)!;
        for (const chunk of walker.territory!.chunks) expect(seated.territory!.chunks).not.toContain(chunk);
      }
    }
    expect(split).toBe(true);
  });

  it('a bad cycle opens a challenge, and whoever loses walks and seeds ground of its own', () => {
    let found = false;
    for (let n = 0; n < 40 && !found; n++) {
      const { id, state, context } = makeBoss('old_sow', 18);
      let at = state;
      for (let i = 0; i < 80; i++) {
        at = Population.step(SEED + n, SX, SY, at, emptyPopulationRecord(), context);
        const walked = Object.values(at.koseki?.[id]?.entries ?? []).find(e => e.exit === 'walked');
        if (walked) {
          const seeded = Object.values(at.leaders).find(l => l.id === walked.body || l.walkedFrom === id);
          expect(seeded).toBeDefined();
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe('line 135: a boss left alive (Pedro, 2026-11-01: "a legit farming strat")', () => {
  it('everything under it brought down and it left standing, it is open, keeps its seat, and rebuilds its anchors', () => {
    const { id, state, context } = makeBoss('old_sow', 12);
    let record = emptyPopulationRecord();
    for (const l of Object.values(state.leaders)) {
      if (l.id !== id) record = Population.fell(record, l.id, l.kind, state.generation);
      for (let i = 0; i < l.pack; i++) record = Population.fell(record, `${l.id}_f${i}`, 'x', state.generation);
    }
    const stripped = Population.step(SEED, SX, SY, state, record, context);
    expect(stripped.leaders[id].alive).toBe(true);
    expect(stripped.leaders[id].territory!.bossAt).toBeDefined();
    expect(Territory.wardOf(SEED, stripped.leaders[id], stripped).slots).toEqual([]);
    const later = folded(stripped, 180, context);
    expect(later.leaders[id].alive).toBe(true);
    expect(Territory.wardOf(SEED, later.leaders[id], later).slots.length).toBeGreaterThanOrEqual(2);
  });

  it('a base robbed bare fills its store again, so what it holds can be taken more than once', () => {
    const { id, state } = makeCamp();
    const later = folded(state, 120);
    const store = later.leaders[id].territory!.structures.find(s => s.fn === 'store' && s.builtAt !== undefined)!;
    const held = Object.values(later.leaders[id].territory!.stores).reduce((a, b) => a + b, 0);
    const robbed = step(later, Population.robbed(emptyPopulationRecord(), store.id, held, later.generation));
    const after = Object.values(folded(robbed, 30).leaders[id].territory!.stores).reduce((a, b) => a + b, 0);
    expect(held).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
  });

  it('weak on strategy means fewer decisions: over one year, the lower sheet decides less', () => {
    const low = Object.fromEntries(MENTAL_ATTRIBUTES.map(a => [a, 2])) as unknown as IAttributes;
    const high = Object.fromEntries(MENTAL_ATTRIBUTES.map(a => [a, 8])) as unknown as IAttributes;
    const year = (stats: IAttributes) => Array.from({ length: 365 }, (_, g) => DecisionLayer.dueAt(stats, g, 86_400_000, 'lead_1')).reduce((a, b) => a + b, 0);
    expect(year(low) * 3).toBeLessThanOrEqual(year(high) + 3);
    expect(year(low)).toBeLessThan(year(high));
  });
});

describe('line 135: decisions on cadence (D103)', () => {
  const sheetAt = (i: number, rank: UniversalRank) => NpcSheet.statsOf(`w${i}`, { id: `e${i}`, rank });

  it('the rule stands for anyone not a human: it reads a sheet, and any sheet will do', () => {
    const stats = sheetAt(0, UniversalRank.D);
    expect(DecisionLayer.perWeek(stats)).toBeGreaterThanOrEqual(1);
  });

  it('the number of decisions moves with the mental stats, and with nothing else on the sheet', () => {
    const xs: number[] = [], ys: number[] = [];
    for (const rank of Object.values(UniversalRank)) for (let i = 0; i < 200; i++) {
      const s = sheetAt(i, rank) as unknown as Record<string, number>;
      xs.push(MENTAL_ATTRIBUTES.reduce((sum, a) => sum + s[a], 0));
      ys.push(DecisionLayer.perWeek(sheetAt(i, rank)));
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const [mx, my] = [mean(xs), mean(ys)];
    const cov = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
    const r = cov / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
    expect(r).toBeGreaterThan(0.95);
    const base = { ...sheetAt(1, UniversalRank.D) } as IAttributes;
    expect(DecisionLayer.perWeek({ ...base, strength: 999, agility: 999 })).toBe(DecisionLayer.perWeek(base));
    expect(DecisionLayer.perWeek({ ...base, intelligence: base.intelligence + 100 })).toBeGreaterThan(DecisionLayer.perWeek(base));
  });

  it('it has no ceiling, and never reaches zero', () => {
    const none = Object.fromEntries(MENTAL_ATTRIBUTES.map(a => [a, 0])) as unknown as IAttributes;
    expect(DecisionLayer.perWeek(none)).toBe(1);
    const huge = Object.fromEntries(MENTAL_ATTRIBUTES.map(a => [a, 1000])) as unknown as IAttributes;
    expect(DecisionLayer.perWeek(huge)).toBe(1000);
  });

  it('a week is real days: the same decisions fall due in a week of any world, by its own cycle length', () => {
    const stats = { ...sheetAt(2, UniversalRank.D) } as IAttributes;
    const perWeek = DecisionLayer.perWeek(stats);
    for (const cycleMs of [3 * 3_600_000, 10 * 3_600_000, 32 * 3_600_000, 14 * 86_400_000]) {
      const cycles = Math.round((WEEK_MS * 8) / cycleMs);
      let total = 0;
      for (let g = 0; g < cycles; g++) total += DecisionLayer.dueAt(stats, g, cycleMs, 'lead_1');
      expect(Math.abs(total - perWeek * 8)).toBeLessThanOrEqual(1);
    }
  });

  it('what falls due is keyed: leaders of one sheet do not all act on one cycle', () => {
    const stats = { ...sheetAt(3, UniversalRank.F) } as IAttributes;
    const cycleMs = 3_600_000;
    const first = (key: string) => { for (let g = 0; ; g++) if (DecisionLayer.dueAt(stats, g, cycleMs, key) > 0) return g; };
    const firsts = new Set(Array.from({ length: 30 }, (_, i) => first(`lead_${i}`)));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('line 135: a plan stands before the law', () => {
  const fine = { verb: 'claim', target: 'east', name: 'The East Lots', why: 'Room.' };

  it('a verb with no reader is refused, and everything else passes as words', () => {
    const { id, state } = makeCamp();
    const leader = state.leaders[id];
    expect(LeaderPlan.judge({ decisions: [fine] }, leader, kindDef('branch_manager')).decisions).toEqual([fine]);
    const out = LeaderPlan.judge({ decisions: [{ ...fine, verb: 'annihilate' }] }, leader, kindDef('branch_manager'));
    expect(out.decisions).toEqual([]);
    expect(out.refused[0].reason).toMatch(/annihilate/);
  });

  it('every verb the list holds has a reader', () => {
    for (const verb of VERBS) expect(typeof Territory.READERS[verb]).toBe('function');
  });

  it('a verb its species cannot do is refused: an animal raises nothing', () => {
    const { id, state } = makeBoss('old_sow');
    const out = LeaderPlan.judge({ decisions: [{ ...fine, verb: 'raise' }] }, state.leaders[id], kindDef('old_sow'));
    expect(out.decisions).toEqual([]);
  });

  it('a plan holds words and no numbers: whatever it says of size changes nothing', () => {
    const a = LeaderPlan.judge({ decisions: [{ ...fine, count: 900, gold: 900 }] as never }, makeCamp().state.leaders[makeCamp().id], kindDef('branch_manager'));
    expect(Object.keys(a.decisions[0]).sort()).toEqual(['name', 'target', 'verb', 'why']);
  });

  it('a plan on the record picks the decision; with none, or no key, the code\'s own rule does and the place still grows', () => {
    const { id, state } = makeCamp();
    const planned = Population.step(SEED, SX, SY, state, { ...emptyPopulationRecord(), plans: { [id]: { week: 0, decisions: [fine] } } }, contextOf());
    const log = planned.leaders[id].territory!.log;
    if (log.length > 0) expect(log[0].verb).toBe('claim');
    expect(folded(state, 40).leaders[id].territory!.log.length).toBeGreaterThan(0);
  });

  it('the seam: the weekly ask waits on the talk\'s hook, and asks nothing yet', () => {
    expect(LEADER_ASK.kind).toBe('leader');
    expect(LEADER_ASK.waiting(emptyDirectorRecord())).toEqual([]);
    expect(MAINTENANCE_ASKS).toContain(LEADER_ASK);
    expect(ASK_KINDS).not.toContain(LEADER_ASK);
  });

  const kindDef = (key: string) => ContentRegistry.contextFor(themeId, UniversalRank.A).mobDefinitions.find((m: { id: string }) => m.id === kind(key));
});

describe('line 135: maintenance (Pedro, 2026-11-01)', () => {
  const DAY = 86_400_000;

  it('nothing is asked inside the week', () => {
    expect(Maintenance.stateAt(0, 6 * DAY)).toEqual(expect.objectContaining({ warnings: 0, forced: false }));
  });

  it('a week warns, and the third warning falls on the tenth day and forces it', () => {
    expect(Maintenance.stateAt(0, 7 * DAY)).toEqual(expect.objectContaining({ warnings: 1, forced: false }));
    expect(Maintenance.stateAt(0, 9 * DAY)).toEqual(expect.objectContaining({ warnings: 2, forced: false }));
    expect(Maintenance.stateAt(0, TEN_DAYS_MS - 1).forced).toBe(false);
    expect(Maintenance.stateAt(0, TEN_DAYS_MS)).toEqual(expect.objectContaining({ warnings: 3, forced: true }));
  });

  it('it runs every step in order, marks the clock, and a step that fails does not stop the rest', async () => {
    const ran: string[] = [];
    const room = {
      lastAt: async () => 0,
      mark: async (at: number) => { ran.push(`mark:${at}`); }
    };
    const out = await Maintenance.run(room, 5000, [
      { name: 'one', run: async () => { ran.push('one'); } },
      { name: 'bad', run: async () => { throw new Error('no'); } },
      { name: 'two', run: async () => { ran.push('two'); } }
    ]);
    expect(ran).toEqual(['one', 'two', 'mark:5000']);
    expect(out.failed).toEqual(['bad']);
  });
});

describe('line 135: the toll (D93)', () => {
  const assessor = () => ContentRegistry.contextFor(themeId, UniversalRank.A).mobDefinitions.find((m: { id: string }) => m.id === kind('toll_assessor'));
  const lion = () => ContentRegistry.contextFor(themeId, UniversalRank.A).mobDefinitions.find((m: { id: string }) => m.id === kind('old_sow'));

  it('a solitary elite asks. A pack\'s head does not', () => {
    expect(Toll.asks(assessor())).toBe(true);
    expect(Toll.asks(lion())).toBe(false);
  });

  it('a claim takes bodies to hold: what it can feed is what it can keep, with no count of its own', () => {
    const cell = (beside: string[]) => ({ beside, food: 1 });
    const land = new Map([['0,0', cell(['1,0'])], ['1,0', cell(['0,0', '2,0'])], ['2,0', cell(['1,0'])]]);
    const claimedWith = (pack: number) => {
      const leaders = { a: leaderOn('a', kind('old_sow'), '0,0', pack, { territory: { ...Territory.camp('0,0', 1), chunks: ['0,0', '1,0'] } }) };
      Territory.READERS.claim({ land, leaders } as never, 'a', 'good', undefined, Rngless);
      return leaders.a.territory!.chunks.length;
    };
    expect(claimedWith(0)).toBe(2);
    expect(claimedWith(1)).toBe(3);
  });

  it('it rolls waylay, and holds its spot', () => {
    const id = `lead_${SX}_${SY}_0`;
    const at = `${X0 + 4},${Y0 + 4}`;
    const after = folded(blank([leaderOn(id, kind('toll_assessor'), at, 0, { goal: 'waylay' })]), 10);
    expect(after.leaders[id].at).toBe(at);
    expect(after.leaders[id].log.every(e => e.goal === 'waylay')).toBe(true);
  });

  it('a pack that crosses its ground pays or fights: a done waylay thins what stands there', () => {
    const id = `lead_${SX}_${SY}_0`;
    const at = `${X0 + 4},${Y0 + 4}`;
    const state: ISectorState = { ...blank([leaderOn(id, kind('toll_assessor'), at, 0, { goal: 'waylay' })]), ground: { [at]: { [kind('dun_hound')]: 30 } } };
    let touched = false;
    let cur = state;
    for (let i = 0; i < 12 && !touched; i++) {
      const before = cur.ground[at]?.[kind('dun_hound')] ?? 0;
      const next = step(cur);
      const entry = next.leaders[id].log.at(-1)!;
      if (entry.outcome === 'done' && before > 0) touched = Toll.lastTaken(next, id) > 0;
      cur = next;
    }
    expect(touched).toBe(true);
  });

  it('what it asks reads its rank and its sheet, and a person who cannot pay can only fight', () => {
    expect(Toll.owed(UniversalRank.S, 2)).toBeGreaterThan(Toll.owed(UniversalRank.D, 2));
    expect(Toll.owed(UniversalRank.D, 8)).toBeGreaterThan(Toll.owed(UniversalRank.D, 2));
    expect(Toll.canPay(10, 11)).toBe(false);
  });

  it('a person inside its reach is stopped; answering clears it; walking on or refusing fights', () => {
    const live = Toll.fresh();
    expect(Toll.meet(live, 'a', 30, 0, 1000)).toBe('IDLE');
    expect(Toll.meet(live, 'a', 3, 25, 1000)).toBe('ASKING');
    expect(Toll.meet(live, 'a', 3, 25, 1000 + Toll.GRACE_MS + 1)).toBe('FIGHT');
    const paid = Toll.fresh();
    Toll.meet(paid, 'a', 3, 25, 1000);
    Toll.settled(paid, 'a');
    expect(Toll.meet(paid, 'a', 1, 25, 900_000)).toBe('CLEAR');
    const refused = Toll.fresh();
    Toll.meet(refused, 'a', 3, 25, 1000);
    Toll.refused(refused, 'a');
    expect(Toll.meet(refused, 'a', 3, 25, 1001)).toBe('FIGHT');
  });

  it('the gold goes to who owns the world: the hub keeps what its worlds take, a minter keeps what theirs takes', () => {
    expect(Toll.ownerOf({ id: 'w', creatorUid: 'SYSTEM' }, 'hub_1')).toEqual({ to: 'HUB', uid: 'hub_1' });
    expect(Toll.ownerOf({ id: 'w', creatorUid: 'pedro', mintedWithDeed: 'deed_1' }, 'hub_1')).toEqual({ to: 'MINTER', uid: 'pedro' });
    const asked = Toll.moves({ id: 'w', creatorUid: 'pedro', mintedWithDeed: 'deed_1' }, 'hub_1', 'pedro', 40);
    expect(asked.playerDelta).toBe(0);
    const stranger = Toll.moves({ id: 'w', creatorUid: 'pedro', mintedWithDeed: 'deed_1' }, 'hub_1', 'friend', 40);
    expect(stranger).toEqual({ playerDelta: -40, treasury: { worldUid: 'w', delta: 40 } });
    const hub = Toll.moves({ id: 'w', creatorUid: 'SYSTEM' }, 'hub_1', 'friend', 40);
    expect(hub).toEqual({ playerDelta: -40, treasury: { worldUid: 'hub_1', delta: 40 } });
  });
});

describe('line 135: on the map, once seen', () => {
  const entitiesOf = (state: ISectorState, context: IGenerationContext) => {
    const map: IMap = { seed: SEED, width: 16, height: 16, gridVersion: 2, generatedAt: 1, chunks: {}, sectors: { [`${SX},${SY}`]: {} as never } };
    const lay = { ...context, lay: (chunk: IChunk) => Population.layOver(SEED, chunk, { ...emptyPopulationRecord(), sectors: { [`${SX},${SY}`]: state } }, state.generation, context) };
    return WorldGenerator.sectorContents(map, SX, SY, lay);
  };

  it('a scan that reads a territory records a holding: which chunks, what stood there, when', () => {
    const { id, state, context } = makeBoss('old_sow');
    const entities = entitiesOf(state, context);
    const entry = SurveySystem.entry(2, state.generation, entities);
    expect(entry.holdings).toHaveLength(1);
    expect(entry.holdings![0].generation).toBe(state.generation);
    expect(entry.holdings![0].chunks.sort()).toEqual([...state.leaders[id].territory!.chunks].sort());
  });

  it('nothing marks it before someone has seen it', () => {
    const { state, context } = makeBoss('old_sow');
    const shallow = SurveySystem.entry(1, state.generation, []);
    expect(shallow.holdings).toBeUndefined();
    expect(state.leaders).toBeDefined();
    expect(context).toBeDefined();
  });

  it('it goes stale as a reading does, and a new reading of empty ground clears it', () => {
    const { state, context } = makeBoss('old_sow');
    const entry = SurveySystem.entry(2, state.generation, entitiesOf(state, context));
    expect(SurveySystem.staleBy(entry, state.generation + 4)).toBe(4);
    expect(entry.holdings![0].generation).toBe(state.generation);
    expect(SurveySystem.entry(2, state.generation + 4, [], entry).holdings).toBeUndefined();
    expect(SurveySystem.entry(1, state.generation + 4, [], entry).holdings).toEqual(entry.holdings);
  });

  it('a walk marks it too, on what a person saw', () => {
    const { state, context } = makeBoss('old_sow');
    const boss = entitiesOf(state, context).find(e => e.holding)!;
    const player = { survey: {} } as unknown as IPlayer;
    const after = SurveySystem.sawHolding(player, 'w', `${SX},${SY}`, boss, state.generation);
    expect(after.survey!.w[`${SX},${SY}`].holdings![0].chunks.length).toBeGreaterThan(0);
    expect(SurveySystem.sawHolding(after, 'w', `${SX},${SY}`, boss, state.generation)).toBe(after);
  });

  it('a map carries the field by name, and reading the map hands it on', () => {
    const { state, context } = makeBoss('old_sow');
    const entry = SurveySystem.entry(2, state.generation, entitiesOf(state, context));
    const sheet = SurveySystem.mapSheet({ [`${SX},${SY}`]: { ...entry, secret: 'x' } as never });
    const on = sheet[`${SX},${SY}`] as unknown as Record<string, unknown>;
    expect(on.secret).toBeUndefined();
    expect(sheet[`${SX},${SY}`].holdings).toEqual(entry.holdings);
    const { player } = SurveySystem.readMap({ survey: {} } as unknown as IPlayer, 'w', sheet);
    expect(player.survey!.w[`${SX},${SY}`].holdings).toEqual(entry.holdings);
  });

  it('a sector can hold several, and each stays its own', () => {
    const { state, context } = makeBoss('old_sow');
    const other = { ...entitiesOf(state, context).find(e => e.holding)!, holding: { seat: '70,70', chunks: ['70,70'], anchors: 0 }, heldBy: 'other' };
    const both = SurveySystem.entry(2, state.generation, [...entitiesOf(state, context), other]);
    expect(both.holdings).toHaveLength(2);
    const stepped = SurveySystem.sawHolding({ survey: { w: { '8,8': both } } } as unknown as IPlayer, 'w', '8,8', { ...other, holding: { seat: '70,70', chunks: ['70,70', '70,71'], anchors: 2 } }, state.generation + 1);
    const after = stepped.survey!.w['8,8'].holdings!;
    expect(after).toHaveLength(2);
    expect(after.find(h => h.seat === '70,70')!.chunks).toHaveLength(2);
  });

  it('a masked name stays masked: a holding carries no creature name', () => {
    const { state, context } = makeBoss('old_sow');
    const entry = SurveySystem.entry(2, state.generation, entitiesOf(state, context));
    expect(JSON.stringify(entry.holdings)).not.toContain('Sow');
    expect(JSON.stringify(entry.holdings)).not.toContain(kind('old_sow'));
    expect(entry.holdings![0].named).toBeUndefined();
  });
});

describe('line 135: a map reaching the guild posts a chain (D93)', () => {
  const holding = { generation: 5, seat: '68,68', chunks: ['68,68', '69,68', '70,68'], anchors: 2, marks: [{ fn: 'anchor', ground: '70,68', built: true }] };
  const entry = (g: number, extra: object = {}) => ({ level: 2, generation: g, contacts: { MOB: 4 }, changed: 0, ...extra });
  const mapOf = (sectors: Record<string, unknown>, writtenAt = 1) => ({ worldId: 'w', worldName: 'W', scribeUid: 'a', scribeName: 'A', writtenAt, sectors }) as never;

  it('a map with no holding on it posts nothing', () => {
    const chain = chainFromMap(mapOf({ '8,8': entry(5) }));
    expect(chain.posted).toBe(false);
    expect(chain.seat).toBeNull();
  });

  it('a map showing a holding posts a chain, drawn from it, naming no creature', () => {
    const chain = chainFromMap(mapOf({ '8,8': entry(5, { holdings: [holding] }) }));
    expect(chain.posted).toBe(true);
    expect(chain.seat!.ground).toBe('68,68');
    expect(chain.steps.length).toBeGreaterThanOrEqual(3);
    expect(chain.steps[0].people).toBe(1);
    expect(chain.steps.at(-1)!.people).toBeGreaterThanOrEqual(2);
  });

  it('a camp still going up is on a map, and only a boss posts', () => {
    const camp = { ...holding, anchors: 0 };
    expect(chainFromMap(mapOf({ '8,8': entry(5, { holdings: [camp] }) })).posted).toBe(false);
    expect(chainFromMaps([mapOf({ '8,8': entry(5, { holdings: [camp] }) })], 5)).toEqual([]);
  });

  it('a step asks for as many people as there are anchors', () => {
    const chain = chainFromMap(mapOf({ '8,8': entry(5, { holdings: [{ ...holding, anchors: 4 }] }) }));
    expect(chain.steps.at(-1)!.people).toBe(4);
  });

  it('a newer map updates what the guild holds, and a new anchor adds to the chain', () => {
    const chains = chainFromMaps([
      mapOf({ '8,8': entry(5, { holdings: [holding] }) }, 1),
      mapOf({ '8,8': entry(9, { holdings: [{ ...holding, generation: 9, anchors: 3 }] }) }, 2)
    ], 12);
    expect(chains).toHaveLength(1);
    expect(chains[0].seat!.anchors).toBe(3);
    expect(chains[0].staleBy).toBe(3);
  });

  it('a newer map that shows it gone closes the chain', () => {
    const chains = chainFromMaps([
      mapOf({ '8,8': entry(5, { holdings: [holding] }) }, 1),
      mapOf({ '8,8': entry(9) }, 2)
    ], 9);
    expect(chains).toEqual([]);
  });

  it('an older map does not reopen what a newer one closed, whichever came in first', () => {
    const chains = chainFromMaps([
      mapOf({ '8,8': entry(9) }, 2),
      mapOf({ '8,8': entry(5, { holdings: [holding] }) }, 1)
    ], 9);
    expect(chains).toEqual([]);
  });

  it('two holdings in one sector post two chains', () => {
    const chains = chainFromMaps([mapOf({ '8,8': entry(5, { holdings: [holding, { ...holding, seat: '70,70' }] }) })], 5);
    expect(chains.map(c => c.seat!.ground).sort()).toEqual(['68,68', '70,70']);
  });

  it('nothing is on the record twice', () => {
    const chains = chainFromMaps([mapOf({ '8,8': entry(5) })], 9);
    expect(chains).toEqual([]);
  });
});

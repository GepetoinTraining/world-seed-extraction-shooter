/**
 * WHAT IS TAKEN FROM THE GROUND COMES BACK (RG). Pedro, 2026-11-12, after playing a good while: "The
 * worlds need to regenerate the materials, even the tutorial one, right now it's not a lot of variance."
 *
 * A world's land is a pure function of its seed, built again at every opening, and until this nothing
 * remembered what was taken from it: a stripped vein stood whole at the next visit, the same in the same
 * place. Now a place remembers the turn of the gate it was taken in, comes back after a wait the formula
 * reads from what it is, and what comes back is rolled anew, keyed by the place, the seed and the turn
 * it came back in. Nothing runs while nobody is there: whoever looks next reads it off the record.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { IAttributes, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, UniversalRank } from '../shared/types';
import { EntityType, IChunk, IWorldEntity } from '../shared/entities/world/types';
import { CHUNK_QUADRANTS, SECTOR_CHUNKS } from '../shared/entities/world/grid';
import { GROUND_VERSION, IGenerationContext, WorldGenerator, isTimber } from '../shared/entities/world/WorldGenerator';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { isLooseStone } from '../shared/entities/item/Throwable';
import { MaterialPropertyType } from '../shared/entities/economy/types';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { groundReturnTurns } from '../shared/logic/theme/ThemeFormula';
import { QUALITY_SPAN } from '../shared/logic/systems/PairCraft';
import { GroundReturn, IGroundRecord, emptyGroundRecord } from '../shared/entities/world/GroundReturn';
import { spent, worldForm } from '../shared/render/atoms/atoms';
import { WorldClock } from '../src/entities/world/WorldClock';
import { Tutorial } from '../src/logic/systems/Tutorial';
import { inspectEntity } from '../src/render/atoms/inspect';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { useWorldStore } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const SEED = 'dev-sandbox-v4';
const ctx = (): IGenerationContext => ({ ...ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.F), groundVersion: GROUND_VERSION });
const defOf = (id: string) => RESOURCE_DEFINITIONS[id] as any;
const hardness = (id: string) => defOf(id).materialProps?.[MaterialPropertyType.HARDNESS];
const keyOf = (id: string) => id.replace(/^res_[0-9a-f]+_/, '');

/** Built chunks of the tutorial's land, enough to hold places of every role. */
const chunks: IChunk[] = (() => {
  const map = WorldGenerator.generate(SEED, 32, ctx());
  const out: IChunk[] = [];
  const sectors = Object.keys(map.sectors).sort().slice(0, 40);
  for (const s of sectors) {
    const [sx, sy] = s.split(',').map(Number);
    out.push(WorldGenerator.buildChunk(SEED, WorldGenerator.exitsInSector(map, sx, sy), sx * SECTOR_CHUNKS + 3, sy * SECTOR_CHUNKS + 4, ctx()));
  }
  return out;
})();
const places = (role: string) => chunks.flatMap(c => c.entities.filter(e => GroundReturn.roleOf(e.id) === role).map(e => ({ e, biome: c.biome })));

describe('RG1: how long a place takes to come back is read from what it is, in turns of its gate', () => {
  it('a whole number of turns, never fewer than one, and never fewer for what is harder', () => {
    let last = 0;
    for (const h of [0, 0.5, 1, 2, 3, 4, 5, 12, 15, 16, 25, 40, 64, 80, 256, 1000]) {
      const turns = groundReturnTurns(h);
      expect(Number.isInteger(turns)).toBe(true);
      expect(turns).toBeGreaterThanOrEqual(1);
      expect(turns).toBeGreaterThanOrEqual(last);
      last = turns;
    }
  });

  it('in the shipped pack, what grows comes back sooner than what is dug', () => {
    const own = ctx().resourceDefinitions.filter((d: any) => d.habitat && !d.junk && !d.anchor);
    const waits = Object.fromEntries(own.map((d: any) => [keyOf(d.id), GroundReturn.waitOf(d)]));
    // Measured, and pinned: one turn for the plants a hand picks, more for what lies, most for what is mined
    expect(waits).toEqual({
      chaffwheat: 1, accrual_berry: 1, gall_of_the_ledger: 1, tellers_reed: 1,
      compound_oak: 2, counting_sand: 2, tally_pebble: 2,
      vault_stone: 3, collateral_iron: 3, sovereign_silver: 4
    });
    const grown = own.filter((d: any) => (d.tags ?? []).includes('flora')).map((d: any) => GroundReturn.waitOf(d));
    const dug = own.filter((d: any) => (d.harvestConfig?.requiredToolTags ?? []).some((t: string) => /mine|pick/.test(t))).map((d: any) => GroundReturn.waitOf(d));
    expect(dug.length).toBeGreaterThan(0);
    expect(Math.max(...grown)).toBeLessThan(Math.min(...dug));
  });

  it('reads how hard it is, never its name: a thing written twice under two names waits alike', () => {
    const wheat = ctx().resourceDefinitions.find((d: any) => d.id.endsWith('_chaffwheat'))!;
    expect(GroundReturn.waitOf({ ...wheat, id: 'res_other_name', name: 'Another Name' })).toBe(GroundReturn.waitOf(wheat));
    expect(GroundReturn.waitOf({ ...wheat, materialProps: { [MaterialPropertyType.HARDNESS]: hardness(wheat.id) * 64 } })).toBeGreaterThan(GroundReturn.waitOf(wheat));
  });

  it('is never full again in the visit it was stripped in: the next turn begins after its gate has shut', () => {
    for (const size of [16, 32, 64, 128]) {
      const card = { createdAt: 1_000_000, size };
      const cadence = WorldClock.cadenceFor(size);
      const period = cadence.upMs + cadence.offMs + cadence.scanMs;
      for (const g of [0, 1, 7]) {
        const opens = card.createdAt + g * period;
        expect(WorldClock.momentAt(card, opens + 1).generation).toBe(g);
        const next = WorldClock.turnStartsAt(card, g + 1);
        expect(next - opens).toBeGreaterThanOrEqual(cadence.upMs);
        expect(WorldClock.momentAt(card, next).generation).toBe(g + 1);
        expect(WorldClock.momentAt(card, next - 1).generation).toBe(g);
      }
    }
    // The tutorial's gate never shuts, and its turns are counted all the same
    const tutorial = Tutorial.card(0, 5_000);
    const t3 = WorldClock.turnStartsAt(tutorial, 3);
    expect(WorldClock.momentAt(tutorial, t3).generation).toBe(3);
    expect(WorldClock.momentAt(tutorial, t3 - 1).generation).toBe(2);
  });
});

describe('RG2: a stripped place stands bare until its turn comes, then stands again', () => {
  it('bare through every turn before its wait is up, back on the turn it is', () => {
    const { e, biome } = places('scatter')[0];
    const wait = GroundReturn.waitOf(defOf(e.definitionId));
    const record = GroundReturn.took(emptyGroundRecord(), e, 0, 3);
    expect(record.taken[e.id]).toMatchObject({ at: 3, left: 0, kind: e.definitionId });
    for (let turn = 3; turn < 3 + wait; turn++) {
      const now = GroundReturn.standing(SEED, e, biome, record, turn, ctx());
      expect(now.usesRemaining).toBe(0);
      expect(now.definitionId).toBe(e.definitionId);
      expect(now.returning?.turn).toBe(3 + wait);
    }
    const back = GroundReturn.standing(SEED, e, biome, record, 3 + wait, ctx());
    expect(back.usesRemaining).toBeGreaterThan(0);
    expect(back.returning).toBeUndefined();
  });

  it('a place nobody took stands as it was built', () => {
    const { e, biome } = places('scatter')[1];
    expect(GroundReturn.standing(SEED, e, biome, emptyGroundRecord(), 9, ctx())).toEqual(e);
  });

  it('a part taken is remembered, and its clock runs from the first taking', () => {
    const { e, biome } = places('scatter').find(p => (defOf(p.e.definitionId).uses ?? 1) >= 2 && GroundReturn.waitOf(defOf(p.e.definitionId)) >= 2)!;
    const wait = GroundReturn.waitOf(defOf(e.definitionId));
    const once = GroundReturn.took(emptyGroundRecord(), e, 1, 3);
    expect(GroundReturn.standing(SEED, e, biome, once, 3, ctx()).usesRemaining).toBe(1);
    const twice = GroundReturn.took(once, { ...e, usesRemaining: 1 }, 0, 4);
    expect(twice.taken[e.id]).toMatchObject({ at: 3, left: 0 });
    expect(GroundReturn.standing(SEED, e, biome, twice, 3 + wait, ctx()).usesRemaining).toBeGreaterThan(0);
  });

  it('only a place the land laid is remembered: what a person threw or dropped is not ground', () => {
    const thrown: IWorldEntity = { ...places('loose')[0].e, id: 'thrown_stone_17' };
    const cache: IWorldEntity = { ...places('scatter')[0].e, id: 'cache_abc' };
    const empty = emptyGroundRecord();
    expect(GroundReturn.took(empty, thrown, 0, 1)).toBe(empty);
    expect(GroundReturn.took(empty, cache, 0, 1)).toBe(empty);
    expect(GroundReturn.isPlace('ent_12_40_r2')).toBe(true);
    expect(GroundReturn.isPlace('ent_12_40_t11')).toBe(true);
    expect(GroundReturn.isPlace('ent_12_40_loose1')).toBe(true);
    expect(GroundReturn.isPlace('ent_12_40_rare')).toBe(true);
    expect(GroundReturn.isPlace('ent_12_40_chest')).toBe(false);
    expect(GroundReturn.isPlace('ent_12_40_m0')).toBe(false);
  });
});

describe('RG3: what comes back is rolled anew, keyed by the place, the seed and the turn it came back in', () => {
  const back = (seed: string, e: IWorldEntity, biome: any, record: IGroundRecord, turn: number) => GroundReturn.standing(seed, e, biome, record, turn, ctx());

  it('the same three give the same, on any machine and whenever it is looked at', () => {
    for (const { e, biome } of places('scatter').slice(0, 20)) {
      const record = GroundReturn.took(emptyGroundRecord(), e, 0, 2);
      const r = 2 + GroundReturn.waitOf(defOf(e.definitionId));
      const a = back(SEED, e, biome, record, r), b = back(SEED, e, biome, record, r);
      const later = back(SEED, e, biome, record, r + 6);
      expect(a).toEqual(b);
      expect([later.definitionId, later.usesRemaining, later.quality]).toEqual([a.definitionId, a.usesRemaining, a.quality]);
    }
  });

  it('another world, or another turn, gives another', () => {
    const scatter = places('scatter').slice(0, 30);
    const roll = (seed: string, at: number) => scatter.map(({ e, biome }) => {
      const s = back(seed, e, biome, GroundReturn.took(emptyGroundRecord(), e, 0, at), at + GroundReturn.waitOf(defOf(e.definitionId)));
      return `${s.definitionId}:${s.usesRemaining}:${s.quality}`;
    });
    expect(roll('another-seed', 2)).not.toEqual(roll(SEED, 2));
    expect(roll(SEED, 5)).not.toEqual(roll(SEED, 2));
  });

  it('two returns of one place differ: the kind, how much and its quality are each rolled', () => {
    const pairs = places('scatter').map(({ e, biome }) => {
      const r1 = 1 + GroundReturn.waitOf(defOf(e.definitionId));
      const first = back(SEED, e, biome, GroundReturn.took(emptyGroundRecord(), e, 0, 1), r1);
      const again = GroundReturn.took(GroundReturn.took(emptyGroundRecord(), e, 0, 1), first, 0, r1);
      const r2 = r1 + GroundReturn.waitOf(defOf(first.definitionId));
      return { first, second: back(SEED, e, biome, again, r2), built: e };
    });
    expect(pairs.length).toBeGreaterThan(30);
    expect(pairs.some(p => p.first.definitionId !== p.second.definitionId)).toBe(true);
    expect(pairs.some(p => p.first.usesRemaining !== p.second.usesRemaining)).toBe(true);
    expect(pairs.filter(p => p.first.quality !== p.second.quality).length).toBe(pairs.length);
    // What comes back is not the same thing the land laid there
    expect(pairs.some(p => p.first.definitionId !== p.built.definitionId)).toBe(true);
  });
});

describe('RG4: a place keeps its role, and draws only from its own land', () => {
  const roll = (role: string) => places(role).map(({ e, biome }) => ({
    biome,
    s: GroundReturn.standing(SEED, e, biome, GroundReturn.took(emptyGroundRecord(), e, 0, 4), 4 + GroundReturn.waitOf(defOf(e.definitionId)), ctx())
  }));

  it('a tree comes back a tree of its land; a scattered find one of its land\'s own; a loose stone a loose stone', () => {
    const own = new Set(ctx().resourceDefinitions.map((d: any) => d.id));
    const trees = roll('tree');
    expect(trees.length).toBeGreaterThan(0);
    for (const { s } of trees) expect(isTimber(defOf(s.definitionId))).toBe(true);
    for (const { s, biome } of roll('scatter')) {
      expect(BIOME_RESOURCES[biome]).toContain(s.definitionId);
      expect(own.has(s.definitionId)).toBe(true);
    }
    const loose = roll('loose');
    expect(loose.length).toBeGreaterThan(0);
    for (const { s } of loose) expect(isLooseStone(defOf(s.definitionId))).toBe(true);
  });

  it('how much is half again either way of what the kind holds, and the quality is on the gear scale', () => {
    let sum = 0, full = 0;
    for (const { s } of [...roll('scatter'), ...roll('tree'), ...roll('loose')]) {
      const uses = defOf(s.definitionId).uses ?? 1;
      expect(s.usesRemaining).toBeGreaterThanOrEqual(Math.ceil(uses / 2));
      expect(s.usesRemaining).toBeLessThanOrEqual(uses + Math.floor(uses / 2));
      expect(Math.abs(s.quality!)).toBeLessThanOrEqual(QUALITY_SPAN);
      expect(s.rank).toBe(defOf(s.definitionId).rank);
      sum += s.usesRemaining!; full += uses;
    }
    // Around what the kind holds, not above it
    expect(sum / full).toBeGreaterThan(0.85);
    expect(sum / full).toBeLessThan(1.15);
  });
});

describe('RG5: the land a world pinned is untouched', () => {
  it('an empty record lays nothing over a chunk: it is the pure build, byte for byte', () => {
    for (const c of chunks.slice(0, 8)) {
      const laid = structuredClone(c);
      GroundReturn.layOver(SEED, laid, emptyGroundRecord(), 12, ctx());
      expect(laid).toEqual(c);
    }
  });

  it('a record lays over the places it names and nothing else', () => {
    const c = structuredClone(chunks.find(ch => ch.entities.some(e => GroundReturn.roleOf(e.id) === 'scatter'))!);
    const target = c.entities.find(e => GroundReturn.roleOf(e.id) === 'scatter')!;
    const record = GroundReturn.took(emptyGroundRecord(), target, 0, 2);
    const before = structuredClone(c);
    GroundReturn.layOver(SEED, c, record, 2, ctx(), turn => 1_000 * turn);
    expect(c.entities.length).toBe(before.entities.length);
    for (let i = 0; i < c.entities.length; i++) {
      if (c.entities[i].id === target.id) {
        expect(c.entities[i].usesRemaining).toBe(0);
        expect(c.entities[i].returning).toEqual({ turn: 2 + GroundReturn.waitOf(defOf(target.definitionId)), at: 1_000 * (2 + GroundReturn.waitOf(defOf(target.definitionId))) });
      } else expect(c.entities[i]).toEqual(before.entities[i]);
    }
  });

  it('two readings of one world\'s ground are one, in either order: the later taking stands', () => {
    const [a, b] = places('scatter').slice(0, 2).map(p => p.e);
    const one = GroundReturn.took(GroundReturn.took(emptyGroundRecord(), a, 0, 2), b, 1, 3);
    const two = GroundReturn.took(GroundReturn.took(emptyGroundRecord(), a, 0, 5), b, 0, 3);
    const merged = GroundReturn.merge(one, two);
    expect(GroundReturn.merge(two, one)).toEqual(merged);
    expect(merged.taken[a.id].at).toBe(5);
    expect(merged.taken[b.id]).toMatchObject({ at: 3, left: 0 });
  });
});

const spread = (): IAttributes => Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 4])) as unknown as IAttributes;

describe('RG6: in the field, a taking is written down, and the place comes back by the game\'s clock', () => {
  const tutorial = Tutorial.card(0, 0);
  const handPlace = () => chunks.flatMap(c => c.entities.filter(e => GroundReturn.roleOf(e.id) === 'scatter' && (defOf(e.definitionId).harvestConfig?.requiredToolTags ?? []).length === 0)
    .map(e => ({ e, c })))[0];

  const stage = (chunk: IChunk) => {
    useWorldStore.setState({
      currentMap: { seed: tutorial.seed, width: 32, height: 32, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { [`${chunk.x},${chunk.y}`]: structuredClone(chunk) } } as any,
      availableWorlds: [tutorial], activeWorldId: tutorial.id, groundRecord: emptyGroundRecord()
    } as any);
    usePlayerStore.setState(s => ({
      player: {
        ...s.player, id: 'uid_ground', username: 'GATHERER', attributes: spread(), baseAttributes: spread(),
        currentSession: { sessionId: 'sess_ground', layerId: 'l', inventory: [], kitItemIds: [], health: 100, maxHealth: 100, energy: 1000, maxEnergy: 1000, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
      }
    }));
  };
  const live = (id: string) => Object.values(useWorldStore.getState().currentMap!.chunks).flatMap(c => c.entities).find(e => e.id === id);

  beforeEach(() => useWorldStore.setState({ groundRecord: null } as any));

  it('stripping a place writes the turn down and leaves it standing bare, saying when it comes back, then it comes back rolled anew', () => {
    const { e, c } = handPlace();
    stage(c);
    const full = e.usesRemaining ?? 1;
    for (let i = 0; i < full; i++) usePlayerStore.getState().performInteraction(`int_harvest_${e.id}`, e.id);
    const taken = useWorldStore.getState().groundRecord!.taken[e.id];
    expect(taken).toMatchObject({ left: 0, kind: e.definitionId });
    const bare = live(e.id)!;
    expect(bare).toBeDefined();
    expect(bare.usesRemaining).toBe(0);
    expect(bare.regrowAt).toBeUndefined();
    const turn = taken.at + GroundReturn.waitOf(defOf(e.definitionId));
    expect(bare.returning?.turn).toBe(turn);
    expect(bare.returning?.at).toBe(WorldClock.turnStartsAt(tutorial, turn));

    // Walking up to it: the card says, in words, that it comes back and when
    const card = inspectEntity(bare, { player: usePlayerStore.getState().player, dist: 1, level: WebSystem.knowledgeReader(usePlayerStore.getState().player), now: bare.returning!.at! - 3_600_000 } as any);
    expect(card.needs[0]).toMatch(/comes back/i);
    expect(card.needs[0]).toMatch(/1:00:00/);
    expect(card.compact).toMatch(/comes back/);

    // A moment before its turn, still bare; at its turn, back, as the record and the seed say
    useWorldStore.getState().sweepGround(bare.returning!.at! - 1);
    expect(live(e.id)!.usesRemaining).toBe(0);
    useWorldStore.getState().sweepGround(bare.returning!.at!);
    const back = live(e.id)!;
    expect(back.usesRemaining).toBeGreaterThan(0);
    expect(back.returning).toBeUndefined();
    expect(back).toEqual(GroundReturn.standing(tutorial.seed, e, c.biome, useWorldStore.getState().groundRecord!, turn, ctx()));
  });

  it('a harvest from a place come back carries its quality', () => {
    const { e, c } = handPlace();
    stage(c);
    const record = GroundReturn.took(emptyGroundRecord(), e, 0, 0);
    const turn = GroundReturn.waitOf(defOf(e.definitionId));
    const back = GroundReturn.standing(tutorial.seed, e, c.biome, record, turn, ctx());
    useWorldStore.setState({ groundRecord: record } as any);
    useWorldStore.getState().updateEntity(e.id, back);
    usePlayerStore.getState().performInteraction(`int_harvest_${e.id}`, e.id);
    const got = usePlayerStore.getState().player.currentSession!.inventory.filter(i => i.universalDefinitionId === back.definitionId);
    expect(got.length).toBeGreaterThan(0);
    for (const item of got) expect(item.quality).toBe(back.quality);
  });

  it('a world that keeps no record does as it always did', () => {
    const { e, c } = handPlace();
    stage(c);
    useWorldStore.setState({ groundRecord: null } as any);
    for (let i = 0; i < (e.usesRemaining ?? 1); i++) usePlayerStore.getState().performInteraction(`int_harvest_${e.id}`, e.id);
    const def = defOf(e.definitionId);
    if (def.regrowMs) expect(live(e.id)?.regrowAt).toBeGreaterThan(0);
    else expect(live(e.id)).toBeUndefined();
  });
});

describe('RG7: a place coming back says so by shape, never by hue alone', () => {
  const mask = (s: { data: Uint8Array }) => Array.from(s.data, v => (v ? 1 : 0)).join('');

  it('a spent find that comes back keeps a sprout at its middle; one that does not, none', () => {
    const rock = ctx().resourceDefinitions.find((d: any) => d.id.endsWith('_vault_stone'))!;
    const live = worldForm(rock);
    expect(mask(spent(live, true))).not.toBe(mask(spent(live, false)));
    expect(mask(worldForm(rock, { uses: 0, returns: true }))).not.toBe(mask(worldForm(rock, { uses: 0, returns: false })));
  });

  it('a felled tree that comes back shows a shoot on its stump', () => {
    const oak = ctx().resourceDefinitions.find(isTimber)!;
    expect(mask(worldForm(oak, { uses: 0, returns: true }))).not.toBe(mask(worldForm(oak, { uses: 0, returns: false })));
  });
});

describe('RG8: wiring', () => {
  it('the world store reads the ground record where the world turns, lays it, and reads the turn off the game\'s clock', () => {
    const store = SRC('src/entities/world/store.ts');
    expect(store).toMatch(/GroundStore\.load/);
    expect(store).toMatch(/GroundReturn\.layOver/);
    expect(store).toMatch(/GameClock\.now\(\)/);
    expect(store).not.toMatch(/momentAt\(worldCard, Date\.now\(\)\)/);
  });

  it('the field sweeps the ground by the record, and a taking goes through the world\'s one door', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    expect(field).toMatch(/sweepGround\(/);
    // Seen in the hidden window: swept after the frame read its chunks, the creatures' copies written back at its end undid it
    expect(field.indexOf('sweepGround()')).toBeLessThan(field.indexOf('const liveMap = useWorldStore.getState().currentMap'));
    expect(SRC('src/entities/player/store.ts')).toMatch(/kind: 'GROUND_TAKEN'/);
  });
});

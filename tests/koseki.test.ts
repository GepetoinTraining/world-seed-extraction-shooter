/**
 * THE KOSEKI: a line's register, from the TTRPG engine's shape, on World Seed's rules.
 * Registered before the build. Nothing here calls a model.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { IKoseki, Koseki } from '../shared/entities/world/Koseki';
import { Leaders, ILeaderSeed, GOALS } from '../shared/entities/world/Leaders';
import { Population, emptyPopulationRecord } from '../shared/entities/world/Population';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { SECTOR_CHUNKS } from '../shared/entities/world/grid';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { computeGolden, FIRST_THEME_VECTORS } from '../src/entities/world/goldens';
import { UniversalRank } from '../shared/types';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const SEED = 'koseki-world';
const context = ContentRegistry.contextFor(themeId, UniversalRank.C);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const leaders = (): ILeaderSeed[] => {
  const out: ILeaderSeed[] = [];
  for (let y = 5; y <= 11; y++) for (let x = 5; x <= 11; x++) out.push(...Leaders.rosterOf(SEED, x, y, context));
  return out;
};
const sectorOf = (l: ILeaderSeed) => [Math.floor(l.cx / SECTOR_CHUNKS), Math.floor(l.cy / SECTOR_CHUNKS)];
const slotOf = (l: ILeaderSeed, generation: number, fellAt = 0, extra: string[] = []) => {
  const [sx, sy] = sectorOf(l);
  let record = Population.fell(emptyPopulationRecord(), l.id, l.kind, fellAt);
  for (const id of extra) record = Population.fell(record, id, (MOB_DEFINITIONS[l.kind] as unknown as { leads: string }).leads, fellAt);
  return { state: Population.sectorAt(record, SEED, sx, sy, generation, context), record };
};
const withPack = () => leaders().find(l => l.pack >= 2)!;

const founded = () => Koseki.found('8,8', 'a', 'kind_a', 0);

describe('the register itself', () => {
  it('is filed at a place, with one head, and its id is that place and its founder', () => {
    const r = founded();
    expect(r.filedAt).toBe('8,8');
    expect(r.head).toBe('a');
    expect(r.entries).toEqual([{ body: 'a', kind: 'kind_a', word: 'head', enteredAt: 0, parents: [] }]);
    expect(r).toEqual(founded());
  });

  it('reads no clock and no chance, and changes nothing it is handed', () => {
    const text = readFileSync('shared/entities/world/Koseki.ts', 'utf8');
    expect(text).not.toMatch(/Date\.now\(|Math\.random\(/);
    const r = founded();
    const before = clone(r);
    Koseki.exit(Koseki.bear(r, 'b', 'kind_a', ['a'], 1), 'a', 'fell', 2);
    expect(r).toEqual(before);
  });

  it('an exit marks an entry and never deletes it', () => {
    const r = Koseki.exit(Koseki.bear(founded(), 'b', 'kind_a', ['a'], 1), 'b', 'fell', 3);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[1]).toMatchObject({ body: 'b', exitedAt: 3, exit: 'fell' });
    expect(Koseki.standing(r).map(e => e.body)).toEqual(['a']);
  });

  it('cycle 0 is a cycle: what left then has left (the donor reads a day 0 exit as no exit)', () => {
    const r = Koseki.exit(Koseki.bear(founded(), 'b', 'kind_a', ['a'], 0), 'b', 'fell', 0);
    expect(Koseki.standing(r).map(e => e.body)).toEqual(['a']);
    const again = Koseki.exit(r, 'b', 'fell', 5);
    expect(again.entries[1].exitedAt).toBe(0);
  });

  it('a head that goes is followed by the eldest, and the tie is the same on every machine', () => {
    let r = founded();
    r = Koseki.bear(r, 'late', 'kind_a', ['a'], 4);
    r = Koseki.bear(r, 'z_early', 'kind_a', ['a'], 1);
    r = Koseki.bear(r, 'b_early', 'kind_a', ['a'], 1);
    const after = Koseki.exit(r, 'a', 'fell', 6);
    expect(after.head).toBe('b_early');
    expect(after.entries.find(e => e.body === 'b_early')!.word).toBe('head');
    expect(after.status).toBe('active');
  });

  it('with nobody to follow the line is extinct, and the register stands', () => {
    const r = Koseki.exit(founded(), 'a', 'fell', 2);
    expect(r).toMatchObject({ head: null, status: 'extinct' });
    expect(r.entries).toHaveLength(1);
  });

  it('an adoption moves a body in one step, says where it came from, and can head its new line', () => {
    const from = Koseki.bear(founded(), 'pup', 'kind_a', ['a'], 1);
    const to = Koseki.found('9,9', 'x', 'kind_x', 0);
    const moved = Koseki.adopt(from, to, 'pup', 'x', 3);
    expect(moved.from.entries[1]).toMatchObject({ exit: 'adopted_out', exitedAt: 3 });
    expect(moved.to.entries[1]).toMatchObject({ body: 'pup', word: 'adopted', parents: ['x'], from: from.id, kind: 'kind_a' });
    expect(Koseki.standing(moved.from).map(e => e.body)).toEqual(['a']);
    expect(Koseki.exit(moved.to, 'x', 'fell', 4).head).toBe('pup');
  });

  it('an adoption of a body not standing there moves nothing', () => {
    const from = founded(), to = Koseki.found('9,9', 'x', 'kind_x', 0);
    expect(Koseki.adopt(from, to, 'nobody', 'x', 3)).toEqual({ from, to });
  });

  it('a line reads as far back as it goes, and a child of two lines has two parents', () => {
    let r: IKoseki = founded();
    let parent = 'a';
    for (let i = 0; i < 40; i++) { r = Koseki.bear(r, `g${i}`, 'kind_a', [parent], i + 1); parent = `g${i}`; }
    expect(Koseki.lineage(r, 'g39')).toHaveLength(40);
    expect(Koseki.lineage(r, 'g39')[0]).toBe('g38');
    expect(Koseki.lineage(r, 'g39')[39]).toBe('a');
    const two = Koseki.bear(founded(), 'c', 'kind_a', ['a', 'outsider'], 1);
    expect(Koseki.lineage(two, 'c')).toEqual(['a', 'outsider']);
  });
});

describe('a leader falls, and its register answers (D93)', () => {
  it('the next of its pack takes its place: the same kind at the head, one fewer behind it', () => {
    const l = withPack();
    const { state } = slotOf(l, 1);
    expect(state.leaders[l.id]).toMatchObject({ alive: false, pack: 0 });
    const register = state.koseki![l.id];
    expect(register.status).toBe('active');
    const heir = state.leaders[register.head!];
    expect(heir).toMatchObject({ alive: true, kind: l.kind, at: `${l.cx},${l.cy}` });
    expect(heir.pack).toBeLessThan(l.pack);
    expect(Leaders.isLeader(heir.id)).toBe(true);
    expect(register.entries.find(e => e.body === l.id)).toMatchObject({ exit: 'fell', exitedAt: 0 });
    expect(Koseki.lineage(register, heir.id)).toEqual([l.id]);
  });

  it('it has its own sheet and goal, keyed by its own id, and nothing stored for them', () => {
    const l = withPack();
    const { state } = slotOf(l, 1);
    const heir = state.leaders[state.koseki![l.id].head!];
    const seedOf = { id: heir.id, kind: heir.kind, cx: 0, cy: 0, pack: 0 };
    const sheet = Leaders.sheetOf(SEED, seedOf, context);
    expect(GOALS).toContain(sheet.goal);
    expect(sheet.stats).not.toEqual(Leaders.sheetOf(SEED, l, context).stats);
    expect(Object.keys(state.koseki![l.id].entries[1]).sort()).toEqual(['body', 'enteredAt', 'kind', 'parents', 'word']);
  });

  it('it stands on the land with what is left behind it, and the fallen body does not', () => {
    const l = withPack();
    const { state, record } = slotOf(l, 1);
    const heirId = state.koseki![l.id].head!;
    const [sx, sy] = sectorOf(l);
    const chunk = WorldGenerator.buildChunk(SEED, WorldGenerator.exitsInSector({ seed: SEED }, sx, sy), l.cx, l.cy, context);
    Population.layOver(SEED, chunk, record, 1, context);
    expect(chunk.entities.some(e => e.id === l.id)).toBe(false);
    const head = chunk.entities.find(e => e.id === heirId)!;
    expect(head.definitionId).toBe(l.kind);
    expect(head.health).toBe((MOB_DEFINITIONS[l.kind] as unknown as { baseHealth: number }).baseHealth + Leaders.numbers(SEED, { id: heirId, kind: l.kind, cx: 0, cy: 0, pack: 0 }, context).bonusHealth);
    expect(chunk.entities.filter(e => e.id !== heirId && Leaders.herdOf(e.id) === heirId)).toHaveLength(state.leaders[heirId].pack);
  });

  it('bring down the whole of it and the line ends: a person\'s work holds', () => {
    const l = withPack();
    const followers = Array.from({ length: l.pack }, (_, i) => `${l.id}_f${i}`);
    const { state } = slotOf(l, 3, 0, followers);
    expect(state.koseki![l.id]).toMatchObject({ head: null, status: 'extinct' });
    expect(Object.values(state.leaders).filter(s => s.alive && s.id.startsWith(l.id))).toEqual([]);
  });

  it('a solitary elite has no line to follow it', () => {
    const lone = leaders().find(l => l.pack === 0)!;
    expect(lone).toBeDefined();
    const { state } = slotOf(lone, 1);
    expect(state.koseki![lone.id].status).toBe('extinct');
  });

  it('the heir can fall in turn, and the register keeps each of them', () => {
    const l = withPack();
    const [sx, sy] = sectorOf(l);
    let record = Population.fell(emptyPopulationRecord(), l.id, l.kind, 0);
    const first = Population.sectorAt(record, SEED, sx, sy, 1, context).koseki![l.id].head!;
    record = Population.fell(record, first, l.kind, 1);
    const state = Population.sectorAt(record, SEED, sx, sy, 2, context);
    const register = state.koseki![l.id];
    expect(register.entries.length).toBeGreaterThanOrEqual(2);
    expect(register.entries.find(e => e.body === first)).toMatchObject({ exit: 'fell', exitedAt: 1 });
    if (register.head) expect(Koseki.lineage(register, register.head)).toEqual([first, l.id]);
    else expect(register.status).toBe('extinct');
  });

  it('the fold stays pure with it: one cycle at a time, and read back from a store, the same', () => {
    const l = withPack();
    const [sx, sy] = sectorOf(l);
    const all = () => Population.fell(emptyPopulationRecord(), l.id, l.kind, 0);
    const atOnce = Population.sectorAt(all(), SEED, sx, sy, 8, context);
    const walking = all();
    for (let g = 0; g < 8; g++) Population.sectorAt(walking, SEED, sx, sy, g, context);
    expect(Population.sectorAt(clone(walking), SEED, sx, sy, 8, context)).toEqual(atOnce);
  });
});

describe('what it does not touch', () => {
  it('a birth in a herd changes a count and writes no register (D64)', () => {
    const l = leaders()[0];
    const [sx, sy] = sectorOf(l);
    const state = Population.sectorAt(emptyPopulationRecord(), SEED, sx, sy, 30, context);
    expect(state.koseki).toBeUndefined();
    expect(Object.keys(state.ground).length).toBeGreaterThan(0);
  });

  it('a world nothing has touched stores none, and land and alpha do not move', () => {
    const l = leaders()[0];
    const [sx, sy] = sectorOf(l);
    expect(Population.alpha(SEED, sx, sy, context).koseki).toBeUndefined();
    for (const g of FIRST_THEME_VECTORS) expect(computeGolden(g.seed, g.size, ContentRegistry.contextFor(themeId)), g.seed).toBe(g.hash);
  });
});

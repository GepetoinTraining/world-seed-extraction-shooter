/**
 * THE SCAN PASS (D69, D64, D70, D87): line 108, registered before the build.
 *
 * "First we always use the local or compute ... then what's NEW ... That's what gets
 * batched to the LLM." No bar here calls a model: the network is a fake client behind
 * the real provider, or a fake door. The prompts have never met a real model.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { creatureIdOf } from '../src/logic/theme/ThemeCompiler';
import { CreatureLines, ILineWords } from '../src/logic/theme/CreatureLines';
import { IThemeGrowth, WorldGrowth } from '../src/logic/theme/WorldGrowth';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { Director, IDirectorRecord, emptyDirectorRecord } from '../src/entities/world/Director';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { DirectorStore } from '../src/entities/world/DirectorStore';
import { useWorldStore, IWorldCard } from '../src/entities/world/store';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { IAskKind, IScanDoor, IScanRoom, IWindowAnswer, IWindowBatch, ASK_KINDS, COMPUTE_STEPS, ScanPass, SLOTS_PER_WINDOW } from '../src/logic/systems/ScanPass';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { AbsentProvider, IDoorRequest, IIntelligenceProvider, IntelligenceDoor, WINDOW_SPEND_LIMIT_USD } from '../server/intelligence/door';
import { ClaudeProvider } from '../server/intelligence/claude';
import { createIntelligenceHandler } from '../server/intelligence/http';
import { buildGrowthRequest, buildLineRequest, buildRestRequest, GROWTH_SCHEMA, REST_SCHEMA, WINDOW_REQUESTS } from '../server/intelligence/prompts';
import { UniversalRank } from '../types';

installShippedThemes();

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const SRC = (p: string) => readFileSync(p, 'utf8');
const themeId = FIRST_THEME_PACK.themeId;

const M = 60_000, H = 60 * M;
const MINT = 1_000_000_000;
/** A small world: up 1h, dark 1h30, scan 30m. Its first window opens at 2h30. */
const WINDOW_OPENS = 2.5 * H + MINT;
const CARD: IWorldCard = {
  id: 'wld_scan', seed: 'scan-world', size: 16, createdAt: MINT, playerCount: 0, name: 'SCAN WORLD', difficulty: 'F',
  creator: 'TEST', extractionTaxRate: 0.05, deathPenalty: 'NONE', themeId
};
const WORLD = { seed: CARD.seed, themeId };

const kind = (key: string) => creatureIdOf(themeId, key);
const HOUND = kind(FIRST_THEME_PACK.creatures[0].key);
const SECOND = kind(FIRST_THEME_PACK.creatures[1].key);

const words = (order: string, over: Partial<ILineWords> = {}) => ({
  order, name: `Word for ${order}`, blurb: 'It has stopped following debtors home and started waiting there.',
  tags: [], features: ['horns'] as ILineWords['features'], innate: [], ...over
});

const emptyGrowth = (over: Partial<IThemeGrowth> = {}): IThemeGrowth => ({ creatures: [], materials: [], affixes: [], abilities: [], tags: [], lore: [], ...over });
const grownCreature = (over = {}) => ({
  ...FIRST_THEME_PACK.creatures[0], key: 'late_arrival', name: 'Late Arrival', blurb: 'It came after the first count.', innate: [], ...over
});

/** One database, however many clients: writes guarded the way the real store guards them. */
function fakeRoom(start: IDirectorRecord = emptyDirectorRecord()) {
  const state = { record: clone(start), batches: new Map<string, IWindowBatch>(), answers: new Map<string, IWindowAnswer>(), saves: 0, claims: 0 };
  const room: IScanRoom = {
    load: async () => clone(state.record),
    save: async (_id, record) => { state.saves++; state.record = clone(record); },
    catchUp: async (_id, generation, world) => {
      const caught = Director.catchUp(state.record, generation);
      const next = caught !== state.record ? await CreatureLines.regenerate(caught, world) : caught;
      if (next !== state.record) { state.saves++; state.record = clone(next); }
      await CreatureLines.define(next, world.themeId);
      return clone(next);
    },
    define: (record, id) => CreatureLines.define(record, id),
    papers: async () => ({ batches: clone([...state.batches.values()]), answers: clone([...state.answers.values()]) }),
    claim: async (_id, batch) => {
      state.claims++;
      if (state.batches.has(batch.id)) return false;
      state.batches.set(batch.id, clone(batch));
      return true;
    },
    update: async (_id, batch) => { state.batches.set(batch.id, clone(batch)); },
    answer: async (_id, answer) => {
      if (state.answers.has(answer.batch)) return false;
      state.answers.set(answer.batch, clone(answer));
      return true;
    }
  };
  return { room, state };
}

/** A door whose model writes what it is told, and answers on the next collect. */
function fakeDoor(answer: (batch: { kind: string; asks: any[] }) => unknown = linesAnswer) {
  const filed: { id: string; kind: string; asks: any[]; spent: number }[] = [];
  const door: IScanDoor = {
    open: async () => true,
    file: async (id, kindName, asks, _theme, spent) => {
      filed.push({ id, kind: kindName, asks, spent });
      return { status: 'PENDING', batchId: `batch_${filed.length}`, ceiling: 0.01 };
    },
    collect: async batchId => {
      const batch = filed[Number(batchId.slice('batch_'.length)) - 1];
      return { status: 'OK', data: answer(batch), usage: { model: 'fake', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0.001 } };
    }
  };
  return { door, filed };
}
const linesAnswer = (batch: { kind: string; asks: any[] }) => batch.kind === 'line'
  ? { lines: batch.asks.map((a: any) => words(a.order, { name: `Word ${a.order.slice(-6)}` })) }
  : { order: batch.asks[0].order, ...emptyGrowth(), tags: undefined };

/** A record that has pressed these kinds until each has an order waiting. */
async function pressed(ids: string[], world = WORLD): Promise<IDirectorRecord> {
  let at = emptyDirectorRecord();
  for (let i = 0; i < 200; i++) {
    const pending = at.lines?.pending ?? [];
    if (ids.every(id => pending.some(o => o.parents.includes(id)))) return { ...at, generation: 0 };
    let next = at;
    for (const id of ids) if (!pending.some(o => o.parents.includes(id))) next = Director.report(next, 'FELLED_A_PERSON', id);
    at = await CreatureLines.regenerate(Director.catchUp(next, at.generation + 1), world);
  }
  throw new Error('never changed');
}

afterEach(() => { vi.restoreAllMocks(); });

describe('line 108: compute settles first', () => {
  it('a window that opens computes before anything reaches a door', async () => {
    const { room, state } = fakeRoom();
    const { door, filed } = fakeDoor();
    const report = await ScanPass.step(CARD, WINDOW_OPENS, room, door);
    expect(report.phase).toBe('SCAN');
    expect(state.record.generation).toBe(1);
    expect(filed).toEqual([]); // nothing new in a world nobody touched
  });

  it('compute needs no door at all: a closed one leaves the world regenerated, and nothing written about filing', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    const closed = { ...door, open: async () => false };
    await ScanPass.step(CARD, WINDOW_OPENS, room, closed);
    expect(state.record.generation).toBe(1);
    expect(filed).toEqual([]);
    expect(state.claims).toBe(0);
    expect(state.batches.size).toBe(0);
  });

  it('outside a window the pass does nothing at all', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    expect((await ScanPass.step(CARD, MINT + 10 * M, room, door)).phase).toBe('UP');
    expect((await ScanPass.step(CARD, MINT + 2 * H, room, door)).phase).toBe('OFF');
    expect(filed).toEqual([]);
    expect(state.saves).toBe(0);
  });

  it('a simulation stands outside the clock, and the pass leaves it alone', async () => {
    const { room, state } = fakeRoom();
    const { door } = fakeDoor();
    await ScanPass.step({ ...CARD, isDebug: true }, WINDOW_OPENS, room, door);
    expect(state.saves).toBe(0);
  });

  it('compute is idempotent: run twice, it writes once and decides the same', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const closed: IScanDoor = { ...fakeDoor().door, open: async () => false };
    await ScanPass.step(CARD, WINDOW_OPENS, room, closed);
    const first = clone(state.record);
    const saves = state.saves;
    await ScanPass.step(CARD, WINDOW_OPENS + M, room, closed);
    expect(state.record).toEqual(first);
    expect(state.saves).toBe(saves);
  });

  it('there is a clean place for further compute steps and asks: a list, each pure', () => {
    expect(COMPUTE_STEPS.map(s => s.name)).toEqual(expect.arrayContaining(['growth', 'plain']));
    expect(ASK_KINDS.map(k => k.kind)).toEqual(expect.arrayContaining(['line', 'growth']));
    expect(SRC('src/logic/systems/ScanPass.ts')).not.toMatch(/useWorldStore|usePlayerStore|useHubStore|VectorStore|fetch\(/);
  });

  it('a further ask joins by registering, and the pass carries it with no other change', async () => {
    const seen: string[][] = [];
    const goals: IAskKind = {
      kind: 'goal', perBatch: 2,
      waiting: () => ['goal_a', 'goal_b', 'goal_c'],
      asks: ids => { seen.push(ids); return ids.map(order => ({ order })); },
      settle: async record => ({ record, installed: [], refused: [] })
    };
    const { room } = fakeRoom();
    const { door, filed } = fakeDoor(() => ({}));
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door, [goals]);
    expect(filed.map(f => f.kind)).toEqual(['goal', 'goal']);
    expect(seen).toEqual([['goal_a', 'goal_b'], ['goal_c']]);
  });
});

describe('line 108: a changed kind stands on a plain name until its words come', () => {
  const standing = async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    await ScanPass.step(CARD, WINDOW_OPENS, room, { ...fakeDoor().door, open: async () => false });
    return { room, state };
  };

  it('with no key the kind already stands, as a node of the record, on plain words', async () => {
    const { state } = await standing();
    const order = state.record.lines!.pending[0];
    const node = Object.values(state.record.lines!.nodes).find(n => n.plain === order.id)!;
    expect(node.parents).toEqual(order.parents);
    expect(node.change.bands).toEqual(order.bands);
    expect(node.change.name).toContain(FIRST_THEME_PACK.creatures[0].name);
    expect(node.change.features.length).toBeGreaterThan(0);
    expect(await CreatureLines.verify(state.record.lines!)).toEqual([]);
  });

  it('every machine stands the same plain kind, and signs the same root', async () => {
    const a = await standing();
    const b = await standing();
    expect(a.state.record.lines!.nodes).toEqual(b.state.record.lines!.nodes);
    expect(a.state.record.lines!.roots).toEqual(b.state.record.lines!.roots);
  });

  it('a body can stand as the plain kind, and it reads as its own definition', async () => {
    const { state } = await standing();
    const node = Object.values(state.record.lines!.nodes).find(n => n.plain)!;
    await CreatureLines.define(state.record, themeId);
    expect(ContentRegistry.compiled(themeId)!.mobs[HOUND]).toBeDefined();
    expect((MOB_DEFINITIONS[node.id] as unknown as { name: string }).name).toBe(node.change.name);
  });

  it("the words replace it: its fitness comes along, the plain kind is gone, and the order is settled", async () => {
    const { state } = await standing();
    const order = state.record.lines!.pending[0];
    const plain = Object.values(state.record.lines!.nodes).find(n => n.plain === order.id)!;
    const worn = Director.report({ ...state.record, weights: { ...state.record.weights, [plain.id]: 3 } }, 'FELLED_A_PERSON', plain.id);
    const out = await CreatureLines.settle(worn, { lines: [words(order.id)] }, WORLD);
    expect(out.installed).toHaveLength(1);
    const id = out.installed[0];
    expect(out.record.lines!.nodes[plain.id]).toBeUndefined();
    expect(out.record.lines!.nodes[id].plain).toBeUndefined();
    expect(out.record.lines!.pending).toEqual([]);
    expect(out.record.weights[id]).toBe(3);
    expect(out.record.felled[id]).toBe(1);
    expect(out.record.weights[plain.id]).toBeUndefined();
  });

  it('refused words leave the plain kind standing and the order waiting', async () => {
    const { state } = await standing();
    const order = state.record.lines!.pending[0];
    const out = await CreatureLines.settle(state.record, { lines: [words(order.id, { features: [] })] }, WORLD);
    expect(out.installed).toEqual([]);
    expect(out.refused).toHaveLength(1);
    expect(out.record).toBe(state.record);
    expect(Object.values(out.record.lines!.nodes).some(n => n.plain === order.id)).toBe(true);
  });

  it('a plain kind takes no order of its own: an id that will move has nothing hanging from it', async () => {
    const { state } = await standing();
    const plain = Object.values(state.record.lines!.nodes).find(n => n.plain)!;
    const pressedOn = { ...state.record, generation: 9, weights: { ...state.record.weights, [plain.id]: 1e6 } };
    expect(CreatureLines.decide(pressedOn, CARD.seed, FIRST_THEME_PACK).filter(o => o.parents.includes(plain.id))).toEqual([]);
  });

  it('the seam for B1 still holds on a record with no plain kind in it', async () => {
    const at = await pressed([HOUND]);
    const order = at.lines!.pending[0];
    const out = await CreatureLines.install(at, order.id, words(order.id), WORLD);
    expect(out.ok).toBe(true);
    expect(out.record.lines!.nodes[out.id!].parents).toEqual(order.parents);
  });
});

describe('line 108: only what is new goes to the door, in small batches across the window', () => {
  const many = async () => {
    let at = await pressed([HOUND, SECOND]);
    // More orders than a batch holds: fan one order out by hand, as if many kinds had changed
    const order = at.lines!.pending[0];
    const extra = Array.from({ length: 9 }, (_, i) => ({ ...order, id: `${order.id}_x${i}` }));
    at = { ...at, lines: { ...at.lines!, pending: [...at.lines!.pending, ...extra] } };
    return at;
  };

  it('asks carry only what changed, and never the whole world', async () => {
    const { room } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    const line = filed.find(f => f.kind === 'line')!;
    expect(line.asks).toHaveLength(1);
    expect(Object.keys(line.asks[0]).sort()).toEqual(['bands', 'kind', 'order', 'pressure']);
  });

  it('no batch is over its size, however much waits', async () => {
    const { room } = fakeRoom(await many());
    const { door, filed } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    const lineKind = ASK_KINDS.find(k => k.kind === 'line')!;
    const lines = filed.filter(f => f.kind === 'line');
    expect(lines.length).toBeGreaterThan(1);
    for (const f of lines) expect(f.asks.length).toBeLessThanOrEqual(lineKind.perBatch);
    expect(lines.flatMap(f => f.asks).length).toBe(11);
  });

  it('they spread across the window, rather than all going at its start', async () => {
    const { room } = fakeRoom(await many());
    const { door, filed } = fakeDoor(() => ({ lines: [] }));
    await ScanPass.step(CARD, WINDOW_OPENS, room, door);
    const atStart = filed.length;
    expect(atStart).toBe(1);
    await ScanPass.step(CARD, WINDOW_OPENS + 15 * M, room, door);
    const halfway = filed.length;
    expect(halfway).toBeGreaterThan(atStart);
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    expect(filed.length).toBeGreaterThan(halfway);
  });

  it('what is due is a pure function of the window, so a server can drive it later', () => {
    expect(ScanPass.dueCount(0, 3, 30 * M, 30 * M)).toBe(1);
    expect(ScanPass.dueCount(0, 3, 15 * M, 30 * M)).toBe(2);
    expect(ScanPass.dueCount(1, 2, 1, 30 * M)).toBe(3);
    expect(ScanPass.dueCount(0, 0, 1, 30 * M)).toBe(0);
  });

  it('a slot is a share of the window, on the world\'s clock', () => {
    expect(ScanPass.slotAt(CARD, WINDOW_OPENS)).toBe(0);
    expect(ScanPass.slotAt(CARD, WINDOW_OPENS + 30 * M / SLOTS_PER_WINDOW)).toBe(1);
  });

  it('an id a door sends on fits what the batches API takes', async () => {
    const { room } = fakeRoom(await many());
    const { door, filed } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    for (const f of filed) expect(f.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe('line 108: what does not finish waits, and is never lost', () => {
  it('words come back on a later step, and the kind joins the record', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    expect(state.record.lines!.pending).toHaveLength(1);
    const report = await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door);
    expect(report.installed).toHaveLength(1);
    expect(state.record.lines!.pending).toEqual([]);
    expect(Object.values(state.record.lines!.nodes).every(n => !n.plain)).toBe(true);
  });

  it('a batch that has not come back by the end of the window waits for the next, and is not filed again', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    const slow = { ...door, collect: async () => ({ status: 'PENDING' as const }) };
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, slow);
    const before = filed.length;
    expect(before).toBeGreaterThan(0);
    await ScanPass.step(CARD, WINDOW_OPENS + 29.9 * M, room, slow);
    // The gate is up: nothing moves while people are in it
    expect((await ScanPass.step(CARD, WINDOW_OPENS + 31 * M, room, door)).phase).toBe('UP');
    expect(state.record.lines!.pending).toHaveLength(1);
    // The next window: the same batch is collected, not filed again
    const next = WINDOW_OPENS + 3 * H;
    const report = await ScanPass.step(CARD, next, room, door);
    expect(report.installed).toHaveLength(1);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(before);
  });

  it.each(['NO_KEY', 'OFFLINE', 'BUSY', 'OUTAGE'] as const)('a door saying %s at filing loses nothing, and the next slot tries again', async status => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    let closed = true;
    const flaky: IScanDoor = { ...door, file: async (...args) => (closed ? { status } : door.file(...args)) };
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, flaky);
    expect(state.record.lines!.pending).toHaveLength(1);
    expect(filed).toEqual([]);
    closed = false;
    await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, flaky);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(1);
  });

  it.each(['REFUSED', 'CUT_OFF'] as const)('a batch that came back %s waits for the next window, with its kinds on plain names', async status => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    const told: IScanDoor = { ...door, collect: async () => ({ status }) };
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, told);
    await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, told);
    await ScanPass.step(CARD, WINDOW_OPENS + 29.9 * M, room, told);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(1);
    expect(state.record.lines!.pending).toHaveLength(1);
    expect(Object.values(state.record.lines!.nodes).some(n => n.plain)).toBe(true);
    await ScanPass.step(CARD, WINDOW_OPENS + 3 * H, room, told);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(2);
  });

  it('words the law refuses keep the order waiting; the next window asks again and the same words are not installed', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor(b => ({ lines: b.asks.map((a: any) => words(a.order, { features: [] })) }));
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    const report = await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door);
    expect(report.refused.length).toBeGreaterThan(0);
    expect(state.record.lines!.pending).toHaveLength(1);
    await ScanPass.step(CARD, WINDOW_OPENS + 29.9 * M, room, door);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(1);
    await ScanPass.step(CARD, WINDOW_OPENS + 3 * H, room, door);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(2);
  });

  it('junk from a door never throws', async () => {
    const { room } = fakeRoom(await pressed([HOUND]));
    for (const junk of [null, 7, 'words', [], {}, { lines: 'no' }, { lines: [null, 5, {}] }]) {
      const { door } = fakeDoor(() => junk);
      await expect((async () => {
        await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
        await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door);
      })()).resolves.toBeUndefined();
    }
  });

  it('a window over its spend stops filing, and the rest waits for the next', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND, SECOND]));
    const { door, filed } = fakeDoor();
    const dear: IScanDoor = { ...door, file: async () => ({ status: 'OVER_LIMIT', reason: 'too dear' }) };
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, dear);
    const claims = state.claims;
    await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, dear);
    expect(state.claims).toBe(claims);
    await ScanPass.step(CARD, WINDOW_OPENS + 3 * H, room, door);
    expect(filed.length).toBeGreaterThan(0);
  });

  it('what was spent in a window goes back to the door as it files', async () => {
    let at = await pressed([HOUND]);
    const order = at.lines!.pending[0];
    at = { ...at, lines: { ...at.lines!, pending: Array.from({ length: 12 }, (_, i) => ({ ...order, id: `${order.id}_x${i}` })) } };
    const { room } = fakeRoom(at);
    const { door, filed } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    expect(filed[0].spent).toBe(0);
    expect(filed[1].spent).toBeCloseTo(0.01);
    expect(filed[2].spent).toBeCloseTo(0.02);
  });
});

describe('line 108: safe if two clients run it, and resumable', () => {
  it('two clients in one slot file once, and the first to touch it owns it', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    await Promise.all([ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door), ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door)]);
    expect(filed.length).toBeGreaterThan(0);
    expect(filed.length).toBe(state.batches.size);
    expect(new Set(filed.map(f => f.id)).size).toBe(filed.length);
  });

  it('a second client collects what the first one filed, and both end on one record', async () => {
    const start = await pressed([HOUND]);
    const { room, state } = fakeRoom(start);
    const first = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, first.door);
    const second: IScanDoor = { ...fakeDoor().door, collect: first.door.collect };
    const report = await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, second);
    expect(report.installed).toHaveLength(1);
    expect(state.record.lines!.pending).toEqual([]);
    expect(first.filed.filter(f => f.kind === 'line')).toHaveLength(1);
  });

  it('the first answer to a batch owns it, and only that client counts what it cost', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    const [one, two] = await Promise.all([ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door), ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door)]);
    expect(one.used.length + two.used.length).toBe(state.answers.size);
  });

  it('a save from a client that had not seen the words does not lose them: the next step installs the same kind again', async () => {
    const stale = await pressed([HOUND]);
    const { room, state } = fakeRoom(stale);
    const { door } = fakeDoor();
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    const beforeWords = clone(state.record);
    await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door);
    const installed = Object.keys(state.record.lines!.nodes).sort();
    state.record = beforeWords;
    await ScanPass.step(CARD, WINDOW_OPENS + 29.7 * M, room, door);
    expect(Object.keys(state.record.lines!.nodes).sort()).toEqual(installed);
    expect(state.record.lines!.pending).toEqual([]);
  });

  it('a client gone between claiming and filing holds nothing: the next slot files it', async () => {
    const { room, state } = fakeRoom(await pressed([HOUND]));
    const { door, filed } = fakeDoor();
    const lost: IScanDoor = { ...door, file: () => new Promise(() => {}) };
    void ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, lost);
    await vi.waitFor(() => expect(state.batches.size).toBeGreaterThan(0));
    await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door);
    expect(filed.filter(f => f.kind === 'line')).toHaveLength(1);
  });
});

describe('D64: growth reaches the living world, and the pinned pack never moves', () => {
  const orderedGrowth = async () => {
    let at = await pressed([HOUND]);
    at = await CreatureLines.orderGrowth(at, { ...at, felled: { [HOUND]: 200 } }, WORLD, 1);
    return at;
  };

  it('a regeneration people fought through can order growth, by a keyed roll; one nobody touched never does', async () => {
    const quiet = await CreatureLines.orderGrowth(emptyDirectorRecord(), emptyDirectorRecord(), WORLD, 1);
    expect(quiet.lines?.growing ?? []).toEqual([]);
    const busy = await orderedGrowth();
    expect(busy.lines!.growing).toHaveLength(1);
    expect(busy.lines!.growing![0].generation).toBe(1);
    const again = await CreatureLines.orderGrowth(busy, { ...busy, felled: { [HOUND]: 200 } }, WORLD, 1);
    expect(again.lines!.growing).toEqual(busy.lines!.growing);
  });

  it('the roll is keyed: every machine orders the same', async () => {
    const roll = (g: number) => CreatureLines.rollGrowth(WORLD.seed, g, 3);
    expect(Array.from({ length: 50 }, (_, i) => roll(i))).toEqual(Array.from({ length: 50 }, (_, i) => roll(i)));
    expect(new Set(Array.from({ length: 50 }, (_, i) => roll(i))).size).toBe(2);
  });

  it('the ask names what happened, and asks for no numbers', async () => {
    const at = await orderedGrowth();
    const pack = WorldGrowth.packWith(FIRST_THEME_PACK, at.lines);
    const ask = CreatureLines.askForGrowth(at.lines!.growing![0], pack, at.lines!);
    expect(JSON.stringify(ask)).toContain(FIRST_THEME_PACK.creatures[0].name);
    expect(ask.order).toBe(at.lines!.growing![0].id);
  });

  const grown = async (over: Partial<IThemeGrowth> = {}) => {
    const at = await orderedGrowth();
    const order = at.lines!.growing![0].id;
    return CreatureLines.settleGrowth(at, { order, ...emptyGrowth({ creatures: [grownCreature()], ...over }) }, WORLD);
  };

  it('what grew stands in the record, and the order is settled', async () => {
    const out = await grown();
    expect(out.installed).toHaveLength(1);
    expect(out.record.lines!.growing).toEqual([]);
    expect(out.record.lines!.grown![0].growth.creatures[0].key).toBe('late_arrival');
  });

  it('the world it grew in reads it, and no other world on that pack does', async () => {
    const { record } = await grown();
    await CreatureLines.define(record, themeId);
    const scope = record.lines!.grown![0].scope;
    const id = creatureIdOf(scope, 'late_arrival');
    const inWorld = ContentRegistry.contextFor(themeId, 'F', record).mobDefinitions.map((m: any) => m.id);
    const elsewhere = ContentRegistry.contextFor(themeId, 'F', { ...emptyDirectorRecord(), generation: 1 }).mobDefinitions.map((m: any) => m.id);
    expect(inWorld).toContain(id);
    expect(elsewhere).not.toContain(id);
    expect(inWorld.length).toBe(elsewhere.length + 1);
  });

  it('two worlds growing the same words do not share ids', async () => {
    const a = await grown();
    const at = await orderedGrowth();
    const other = await CreatureLines.settleGrowth(at, { order: at.lines!.growing![0].id, ...emptyGrowth({ creatures: [grownCreature()] }) }, { seed: 'another-world', themeId });
    expect(other.record.lines!.grown![0].scope).not.toBe(a.record.lines!.grown![0].scope);
  });

  it("the pinned pack's bytes, id and definitions do not move", async () => {
    const bytes = JSON.stringify(ContentRegistry.get(themeId));
    const mobs = Object.keys(ContentRegistry.compiled(themeId)!.mobs).sort();
    const { record } = await grown();
    await CreatureLines.define(record, themeId);
    expect(JSON.stringify(ContentRegistry.get(themeId))).toBe(bytes);
    expect(Object.keys(ContentRegistry.compiled(themeId)!.mobs).sort()).toEqual(mobs);
    expect(ContentRegistry.get(record.lines!.grown![0].scope)).toBeUndefined();
  });

  it('with no growth a world generates exactly as it did', () => {
    const plain = ContentRegistry.contextFor(themeId, 'F', { ...emptyDirectorRecord(), generation: 3 });
    const none = ContentRegistry.contextFor(themeId, 'F', { ...emptyDirectorRecord(), generation: 3, lines: CreatureLines.empty() });
    expect(none.mobDefinitions.map((m: any) => m.id)).toEqual(plain.mobDefinitions.map((m: any) => m.id));
    expect(none.resourceDefinitions.map((m: any) => m.id)).toEqual(plain.resourceDefinitions.map((m: any) => m.id));
  });

  it('a chunk stands on the same land with growth in the record, and its own bodies can be what grew', async () => {
    const { record } = await grown();
    await CreatureLines.define(record, themeId);
    const id = creatureIdOf(record.lines!.grown![0].scope, 'late_arrival');
    const before = ContentRegistry.contextFor(themeId, UniversalRank.F, { ...record, lines: CreatureLines.empty() });
    const after = ContentRegistry.contextFor(themeId, UniversalRank.F, record);
    let seen = false;
    for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) {
      const a = WorldGenerator.buildChunk(CARD.seed, [], x, y, before);
      const b = WorldGenerator.buildChunk(CARD.seed, [], x, y, after);
      expect(b.biome).toBe(a.biome);
      expect(b.isTraversable).toBe(a.isTraversable);
      if (b.entities.some((e: any) => e.definitionId === id)) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('a grown material joins its ground, only in that world, and a first timber stays the first', async () => {
    const material = { ...FIRST_THEME_PACK.materials.find(m => m.form === 'tree')!, key: 'late_timber', name: 'Late Timber', blurb: 'Grew after the first count.', onShelf: false };
    const { record } = await grown({ materials: [material] });
    await CreatureLines.define(record, themeId);
    const inWorld = ContentRegistry.contextFor(themeId, 'F', record).resourceDefinitions.map((r: any) => r.id).sort();
    const elsewhere = ContentRegistry.contextFor(themeId, 'F', { ...emptyDirectorRecord(), generation: 1 }).resourceDefinitions.map((r: any) => r.id).sort();
    const grownId = inWorld.find((id: string) => id.endsWith('late_timber'))!;
    expect(grownId).toBeDefined();
    expect(elsewhere).not.toContain(grownId);
    expect(inWorld[inWorld.length - 1]).toBe(grownId); // sorts after everything pinned
  });

  it("a grown ability is known by id, and a grown creature's innate reads a pinned ability's real id", async () => {
    const pinned = FIRST_THEME_PACK.abilities[0];
    const newAbility = { ...pinned, key: 'late_trick', name: 'Late Trick' };
    const { record } = await grown({ abilities: [newAbility], creatures: [grownCreature({ innate: [pinned.key, 'late_trick'] })] });
    await CreatureLines.define(record, themeId);
    const scope = record.lines!.grown![0].scope;
    const def = ContentRegistry.contextFor(themeId, 'F', record).mobDefinitions.find((m: any) => m.id === creatureIdOf(scope, 'late_arrival')) as { innate: string[] };
    expect(def.innate).toHaveLength(2);
    expect(ContentRegistry.ability(def.innate[0])?.name).toBe(pinned.name);
    expect(ContentRegistry.ability(def.innate[1])?.name).toBe('Late Trick');
  });

  it('new lore is found in that world only', async () => {
    const { record } = await grown({ lore: ['A note found after the first count.'] });
    expect(ContentRegistry.lore(themeId, record)).toContain('A note found after the first count.');
    expect(ContentRegistry.lore(themeId)).not.toContain('A note found after the first count.');
    expect(ContentRegistry.lore(themeId, record).length).toBe(ContentRegistry.lore(themeId).length + 1);
  });

  it('a grown affix reaches that world\'s dream and no shared bank', async () => {
    const affix = { ...FIRST_THEME_PACK.affixes[0], key: 'late_affix', name: 'of the Late Count' };
    const { record } = await grown({ affixes: [affix] });
    const names = (ContentRegistry.dreamPack(themeId, record)?.entries ?? []).map(e => e.name);
    const pinned = (ContentRegistry.dreamPack(themeId)?.entries ?? []).map(e => e.name);
    expect(names).toContain('of the Late Count');
    expect(pinned).not.toContain('of the Late Count');
  });

  it('a kind that grew can change later, down the same lines', async () => {
    const { record } = await grown();
    const id = creatureIdOf(record.lines!.grown![0].scope, 'late_arrival');
    const living = CreatureLines.living(FIRST_THEME_PACK, record.lines!);
    expect(living).toContain(id);
    const orders = CreatureLines.decide({ ...record, generation: 4, weights: { [id]: 1e6 } }, CARD.seed, FIRST_THEME_PACK);
    expect(orders.some(o => o.parents.includes(id))).toBe(true);
  });

  it('what grew is signed: the root moves with it, and a record altered afterwards keeps it out', async () => {
    const at = await orderedGrowth();
    const out = await CreatureLines.settleGrowth(at, { order: at.lines!.growing![0].id, ...emptyGrowth({ creatures: [grownCreature()] }) }, WORLD);
    const before = at.lines!.roots[at.lines!.roots.length - 1].root;
    const after = out.record.lines!.roots[out.record.lines!.roots.length - 1].root;
    expect(after).not.toBe(before);
    const altered = clone(out.record);
    altered.lines!.grown![0].growth.creatures[0].name = 'Tampered';
    expect(await CreatureLines.verifyGrown(altered.lines!, WORLD.seed)).toHaveLength(1);
  });

  it('nothing grew is an answer: the order is settled and the record gains nothing', async () => {
    const at = await orderedGrowth();
    const out = await CreatureLines.settleGrowth(at, { order: at.lines!.growing![0].id, ...emptyGrowth() }, WORLD);
    expect(out.record.lines!.growing).toEqual([]);
    expect(out.record.lines!.grown ?? []).toEqual([]);
    expect(out.installed).toEqual([]);
  });

  it.each([
    ['a word nothing has registered', { creatures: [grownCreature({ tags: ['never_registered_word'] })] }],
    ['a key already in the pack', { creatures: [grownCreature({ key: FIRST_THEME_PACK.creatures[0].key })] }],
    ['a number where a word belongs', { creatures: [grownCreature({ health: 900 })] }],
    ['a new word of its own', { tags: [{ tag: 'wholly_new_word', kind: 'descriptive', meaning: 'x' }] }]
  ])('%s is refused whole, and the order waits', async (_why, over) => {
    const at = await orderedGrowth();
    const order = at.lines!.growing![0].id;
    const out = await CreatureLines.settleGrowth(at, { order, ...emptyGrowth(over as Partial<IThemeGrowth>) }, WORLD);
    expect(out.installed).toEqual([]);
    expect(out.refused).toHaveLength(1);
    expect(out.record).toBe(at);
  });

  it('junk growth never throws', async () => {
    const at = await orderedGrowth();
    for (const junk of [null, 5, 'x', [], {}, { order: at.lines!.growing![0].id }, { order: at.lines!.growing![0].id, creatures: 'no' }, { order: 'nobody' }]) {
      const out = await CreatureLines.settleGrowth(at, junk, WORLD);
      expect(out.record).toBe(at);
    }
  });

  it('the hold is gone: no prompt or comment sends growth only to worlds signed later', () => {
    for (const file of ['server/intelligence/prompts.ts', 'src/logic/systems/RestSystem.ts', 'src/logic/systems/RestDoor.ts']) {
      expect(SRC(file), file).not.toMatch(/signed later|signed from now on|never moves|only reach worlds/i);
    }
  });

  it("RestSystem.grownTheme still reads pack and growth together, for the law", () => {
    const merged = RestSystem.grownTheme(FIRST_THEME_PACK, emptyGrowth({ creatures: [grownCreature()] }))!;
    expect(merged.creatures).toHaveLength(FIRST_THEME_PACK.creatures.length + 1);
    expect(ContentRegistry.judge(merged).ok).toBe(true);
  });
});

describe('D87: a character keeps its own queue, and the world keeps the window', () => {
  it('a rest no longer asks for growth, and still asks for gifts', () => {
    const properties = (REST_SCHEMA.properties as Record<string, unknown>);
    expect(properties.growth).toBeUndefined();
    expect(properties.gifts).toBeDefined();
    const request = buildRestRequest({ gifts: [{ id: 'skill_a', owed: 1 }] }, {});
    expect(request.system).toMatch(/gifts/);
    expect(request.system).not.toMatch(/"growth"/);
    expect(request.kind).toBe('rest');
  });

  it('a rest does not bank a theme any more, and a character files its own queue', () => {
    const rest = SRC('src/logic/systems/RestDoor.ts');
    expect(rest).not.toMatch(/ThemeStore|sealTheme|grownTheme/);
    expect(rest).toMatch(/gifts: gifts\.map/);
    expect(rest).toMatch(/fileRest/);
  });

  it('the Director turns on the window, never at a rest', () => {
    const rest = SRC('src/logic/systems/RestDoor.ts');
    expect(rest).not.toMatch(/DirectorStore|CreatureLines|ScanPass/);
  });
});

describe('the door: one more road, the same rules', () => {
  const providerWith = (client: unknown) => new ClaudeProvider(client as never);
  const answerMessage = (json: unknown) => ({
    id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(json) }],
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 100 }
  });

  it('a window batch goes as a Message Batch with its own model and effort, and a schema', async () => {
    let sent: any;
    const client = { messages: { batches: { create: async (p: unknown) => { sent = p; return { id: 'batch_1' }; } } } };
    const at = await pressed([HOUND]);
    const asks = at.lines!.pending.map(o => CreatureLines.askFor(o, FIRST_THEME_PACK, at.lines!));
    const door = new IntelligenceDoor(providerWith(client));
    const out = await door.fileWindow('line_1_2_abc', buildLineRequest(asks, FIRST_THEME_PACK), 0);
    expect(out.status).toBe('PENDING');
    expect((out as { ceiling?: number }).ceiling).toBeGreaterThan(0);
    expect(sent.requests[0].custom_id).toBe('line_1_2_abc');
    expect(sent.requests[0].params.model).toBe('claude-sonnet-5-5');
    expect(sent.requests[0].params.output_config.format.type).toBe('json_schema');
    expect(sent.requests[0].params.fallbacks).toBeUndefined();
    expect(sent.requests[0].params.thinking).toBeUndefined();
    expect(sent.requests[0].params.temperature).toBeUndefined();
  });

  it('a faked network answer comes all the way back through the real provider and installs', async () => {
    const at = await pressed([HOUND]);
    const order = at.lines!.pending[0];
    const client = {
      messages: {
        batches: {
          create: async () => ({ id: 'batch_9' }),
          retrieve: async () => ({ processing_status: 'ended' }),
          results: async () => (async function* () {
            yield { custom_id: 'x', result: { type: 'succeeded', message: answerMessage({ lines: [words(order.id)] }) } };
          })()
        }
      }
    };
    const real = new IntelligenceDoor(providerWith(client));
    const door: IScanDoor = {
      open: async () => true,
      file: (id, kindName, asks, theme, spent) => real.fileWindow(id, WINDOW_REQUESTS[kindName](asks as never[], theme as never), spent) as never,
      collect: batchId => real.collectRest(batchId) as never
    };
    const { room, state } = fakeRoom(at);
    await ScanPass.step(CARD, WINDOW_OPENS + 29 * M, room, door);
    const report = await ScanPass.step(CARD, WINDOW_OPENS + 29.5 * M, room, door);
    expect(report.installed).toHaveLength(1);
    expect(report.used[0].usd).toBeGreaterThan(0);
    expect(state.record.lines!.pending).toEqual([]);
  });

  it('a window over its limit does not go', async () => {
    const stand: IIntelligenceProvider = {
      name: 'stand-in', status: async () => ({ available: true, provider: 'stand-in' }),
      ask: async () => ({ status: 'OK' }), file: async () => ({ status: 'PENDING', batchId: 'b' }), collect: async () => ({ status: 'PENDING' }),
      ceiling: () => WINDOW_SPEND_LIMIT_USD / 2 + 0.01
    };
    const door = new IntelligenceDoor(stand);
    const request: IDoorRequest = { kind: 'window', system: 's', messages: [], maxTokens: 1 };
    expect((await door.fileWindow('a', request, 0)).status).toBe('PENDING');
    expect((await door.fileWindow('b', request, WINDOW_SPEND_LIMIT_USD / 2 + 0.01)).status).toBe('OVER_LIMIT');
  });

  it('with no key every road still answers', async () => {
    const door = new IntelligenceDoor(new AbsentProvider());
    expect((await door.fileWindow('a', { kind: 'window', system: 's', messages: [], maxTokens: 1 }, 0)).status).toBe('NO_KEY');
  });

  it('each ask has a prompt that says what stands and writes no numbers, and a frozen system text', async () => {
    const at = await pressed([HOUND]);
    const ask = CreatureLines.askFor(at.lines!.pending[0], FIRST_THEME_PACK, at.lines!);
    const line = buildLineRequest([ask], FIRST_THEME_PACK);
    const other = buildLineRequest([ask, ask], FIRST_THEME_PACK);
    expect(line.kind).toBe('window');
    expect(other.system).toBe(line.system);
    expect(line.maxTokens).toBeGreaterThanOrEqual(8000);
    const growth = buildGrowthRequest([{ order: 'g', generation: 1, happened: [] }], WorldGrowth.summary(FIRST_THEME_PACK));
    expect(growth.kind).toBe('window');
    expect(growth.schema).toBe(GROWTH_SCHEMA);
    expect(growth.system).toMatch(/NEVER write numbers/);
    expect(growth.system).toMatch(/stands in this world/);
    expect(JSON.stringify((GROWTH_SCHEMA as any).properties.tags)).toBeUndefined();
  });

  it('the route answers a kind it knows, refuses one it does not, and keeps to this machine', async () => {
    const stand: IIntelligenceProvider = {
      name: 'stand-in', status: async () => ({ available: true, provider: 'stand-in' }),
      ask: async () => ({ status: 'OK' }), file: async () => ({ status: 'PENDING', batchId: 'b1' }), collect: async () => ({ status: 'PENDING' }),
      ceiling: () => 0.01
    };
    const handle = createIntelligenceHandler(new IntelligenceDoor(stand));
    const call = async (path: string, body: unknown, remoteAddress = '127.0.0.1') => {
      const socket = new Socket();
      Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress });
      const req = new IncomingMessage(socket);
      req.method = 'POST';
      let text = '';
      const res = { statusCode: 200, setHeader() {}, end: (t: string) => { text = t; } } as unknown as ServerResponse;
      const done = handle(req, res, path);
      req.push(JSON.stringify(body));
      req.push(null);
      await done;
      return JSON.parse(text);
    };
    expect((await call('/window/file', { id: 'x', kind: 'line', asks: [], theme: WorldGrowth.summary(FIRST_THEME_PACK), spent: 0 })).status).toBe('PENDING');
    expect((await call('/window/file', { id: 'x', kind: 'nothing', asks: [], theme: {}, spent: 0 })).status).toBe('REFUSED');
    expect((await call('/window/collect', { batchId: 'b1' })).status).toBe('PENDING');
    expect((await call('/window/file', { id: 'x', kind: 'line' }, '10.0.0.9')).status).toBe('REFUSED');
  });
});

describe('the trap: closing a world never erases what was saved while it was open', () => {
  const held: { record: IDirectorRecord } = { record: emptyDirectorRecord() };
  const spyStore = () => {
    vi.spyOn(DirectorStore, 'load').mockImplementation(async () => clone(held.record));
    vi.spyOn(DirectorStore, 'save').mockImplementation(async (_id, record) => { held.record = clone(record); });
  };
  const openWith = (record: IDirectorRecord) => useWorldStore.setState({ activeWorldId: CARD.id, directorRecord: record, availableWorlds: [CARD] });

  it('words installed in the database while the world is open survive its closing', async () => {
    spyStore();
    const opened = await pressed([HOUND]);
    held.record = opened;
    openWith(opened);
    const order = opened.lines!.pending[0];
    const { record: installed } = await CreatureLines.settle(opened, { lines: [words(order.id)] }, WORLD);
    held.record = installed;
    useWorldStore.getState().exitWorld();
    await useWorldStore.getState().settled();
    expect(Object.keys(held.record.lines!.nodes)).toEqual(Object.keys(installed.lines!.nodes));
    expect(held.record.lines!.pending).toEqual([]);
  });

  it('and what this session reported still lands on top of them', async () => {
    spyStore();
    const opened = await pressed([HOUND]);
    held.record = opened;
    openWith(opened);
    useWorldStore.getState().reportToDirector('FELL', HOUND);
    useWorldStore.getState().reportToDirector('FELLED_A_PERSON', HOUND);
    const order = opened.lines!.pending[0];
    held.record = (await CreatureLines.settle(opened, { lines: [words(order.id)] }, WORLD)).record;
    useWorldStore.getState().exitWorld();
    await useWorldStore.getState().settled();
    expect(held.record.fell[HOUND]).toBe((opened.fell[HOUND] ?? 0) + 1);
    expect(held.record.felled[HOUND]).toBe((opened.felled[HOUND] ?? 0) + 1);
    expect(held.record.lines!.pending).toEqual([]);
  });

  it('a generation that moved while the world was open is not put back', async () => {
    spyStore();
    const opened = { ...emptyDirectorRecord(), generation: 2 };
    held.record = opened;
    openWith(opened);
    useWorldStore.getState().reportToDirector('FELL', HOUND);
    held.record = { ...opened, generation: 3 };
    useWorldStore.getState().exitWorld();
    await useWorldStore.getState().settled();
    expect(held.record.generation).toBe(3);
  });

  it('closing with nothing reported writes nothing', async () => {
    spyStore();
    held.record = emptyDirectorRecord();
    openWith(held.record);
    useWorldStore.getState().exitWorld();
    await useWorldStore.getState().settled();
    expect(DirectorStore.save).not.toHaveBeenCalled();
  });

  it('the store takes words while a world is open, so a scan reads them at once', async () => {
    spyStore();
    const opened = await pressed([HOUND]);
    openWith(opened);
    const order = opened.lines!.pending[0];
    const { record: installed } = await CreatureLines.settle(opened, { lines: [words(order.id)] }, WORLD);
    useWorldStore.getState().adoptRecord(CARD.id, installed);
    expect(useWorldStore.getState().directorRecord).toEqual(installed);
    useWorldStore.getState().adoptRecord('some_other_world', opened);
    expect(useWorldStore.getState().directorRecord).toEqual(installed);
    useWorldStore.setState({ activeWorldId: null, directorRecord: null });
  });

  it('a person reading the window sees counts, and never a masked name (D60)', async () => {
    const at = await pressed([HOUND]);
    const stood = await CreatureLines.standPlain(at, WORLD);
    const read = ScanPass.readout(stood);
    expect(read).toEqual({ words: 0, plain: 1, grown: 0, writing: 0 });
    const panel = SRC('src/components/ReconView.tsx');
    expect(panel).toMatch(/ScanPass\.readout/);
  });
});

describe('it is driven from a client, with nothing blocking play', () => {
  it('the app ticks the door on a timer, and the tick is never awaited by play', () => {
    expect(SRC('App.tsx')).toMatch(/ScanDoor\.tick\(\)/);
    expect(SRC('src/logic/systems/Deploy.ts')).not.toMatch(/ScanDoor/);
    expect(SRC('src/entities/world/WorldGenerator.ts')).not.toMatch(/ScanDoor|ScanPass|IntelligenceClient/);
  });

  it('the browser holds no key and calls the one door', () => {
    const door = SRC('src/logic/systems/ScanDoor.ts');
    expect(door).toMatch(/IntelligenceClient/);
    expect(door).not.toMatch(/anthropic|ANTHROPIC/i);
    expect(SRC('src/logic/intelligence/IntelligenceClient.ts')).toMatch(/\/window\/file/);
  });

  it('the first-writer guard is the real store\'s own', () => {
    const room = SRC('src/logic/systems/ScanRoom.ts');
    expect(room).toMatch(/onlyIfAbsent/);
    expect(room).toMatch(/VectorNamespace\.TERRITORIES/);
  });
});

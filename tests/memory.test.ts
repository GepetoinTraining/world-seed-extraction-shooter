/**
 * NPC MEMORY (Pedro, 2026-11-06) — test lines, stated plainly:
 *   - memories are stored as atoms: words, runs of words and clauses, each written once in a
 *     world's book under an id hashed from its words, so every browser agrees without talking
 *   - a memory is a set of role slots, and each slot fades on its own on a φ-life of 90 days;
 *     an atom that recurs in a person's own memories is rehearsed and stays, a one-off fades
 *   - a dead slot reads as "?", and its strength flows on to the same atom elsewhere, counted
 *   - the needs ladder, turned over: what would leave someone lower on it weighs more
 *   - the ledger keeps what is open (debts, promises, threats, secrets) until it is settled
 *   - recall replaces a fixed tail of the talk log
 *   - one person's memories weigh on another: the read the koseki's people half will use
 */

import { describe, it, expect } from 'vitest';
import { AtomBook, emptyBook } from '../src/logic/memory/AtomBook';
import {
  BASE_PHI_LIFE_DAYS, FALL_ROLES, freshMind, IMind, LadderWeight, MemoryLaw, PHI, PHI_CAP, PHI_FLOOR, PHI_FLOW
} from '../src/logic/memory/MemoryLaw';
import { LADDER, NpcAgenda } from '../src/logic/systems/NpcAgenda';
import { Deeds } from '../src/logic/memory/Deeds';
import { NpcContext } from '../src/logic/memory/NpcContext';
import { MeetLaw } from '../src/logic/systems/MeetLaw';
import { HabitLaw, IUsual, USUAL_MARK } from '../src/logic/systems/HabitLaw';
import { ResidentDay } from '../src/entities/hub/residentDay';
import { WINDOW_REQUESTS, buildNpcMeetRequest } from '../server/intelligence/prompts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Koseki } from '../src/entities/world/Koseki';

const sold = (day: number, buyer: string, seller: string, extra: Record<string, string> = {}) => ({
  day, slots: { who: { person: buyer }, did: 'bought bread from', toWhom: { person: seller }, when: `day ${day}`, ...extra }
});

describe('the book', () => {
  it('an id comes from the words, so two books agree on it without talking', () => {
    const a = AtomBook.write(emptyBook(), 'Bought the old bread').encoded;
    const b = AtomBook.write(AtomBook.write(emptyBook(), 'something else first').book, 'bought  the OLD bread!').encoded;
    expect(a.id).toBe(b.id);
    expect(AtomBook.wordId('bread')).toBe(AtomBook.wordId('bread'));
    expect(AtomBook.personId('npc_1')).not.toBe(AtomBook.wordId('npc_1'));
  });

  it('a stretch of words seen twice becomes a run, and is matched longest first', () => {
    let book = AtomBook.write(emptyBook(), 'with a rusty knife').book;
    book = AtomBook.write(book, 'cut it with a rusty knife').book;
    const encoded = AtomBook.write(book, 'stabbed him with a rusty knife').encoded;
    const run = AtomBook.runId(['with', 'a', 'rusty', 'knife']);
    expect(encoded.parts).toContain(run);
    expect(encoded.parts).toHaveLength(3);
    expect(AtomBook.read(book, run)).toBe('with a rusty knife');
  });

  it('what fits no word goes to the side channel and is kept', () => {
    const encoded = AtomBook.write(emptyBook(), 'paid — 3 gold?!').encoded;
    expect(encoded.rest).toEqual(['—', '?!']);
    expect(AtomBook.words('paid — 3 gold?!')).toEqual(['paid', '3', 'gold']);
  });

  it('a person reads by name where one is given, and by id where not', () => {
    const { book, id } = AtomBook.person(emptyBook(), 'npc_mara');
    expect(AtomBook.read(book, id, e => (e === 'npc_mara' ? 'Mara' : undefined))).toBe('Mara');
    expect(AtomBook.read(book, id)).toBe('npc_mara');
  });
});

describe('the φ law', () => {
  it('two φ-lives untouched leave a slot at the floor, and past it, it reads as "?"', () => {
    const { mind, book } = MemoryLaw.remember(freshMind('a', 0), emptyBook(), { day: 0, slots: { did: 'saw a comet', how: 'through the smoke' } });
    const one = MemoryLaw.fold(mind, BASE_PHI_LIFE_DAYS);
    expect(one.memories[0].slots.how!.strength).toBeCloseTo(PHI_FLOW, 6);
    const gone = MemoryLaw.fold(mind, 2 * BASE_PHI_LIFE_DAYS + 1);
    expect(gone.memories).toHaveLength(0);
    const near = MemoryLaw.fold(mind, 2 * BASE_PHI_LIFE_DAYS - 1);
    expect(MemoryLaw.words(near.memories[0], book).how).toBe('through the smoke');
  });

  it('folding a day at a time reaches the same place as folding all at once', () => {
    let { mind } = MemoryLaw.remember(freshMind('a', 0), emptyBook(), sold(0, 'b', 'a'));
    const once = MemoryLaw.fold(mind, 400);
    for (let d = 1; d <= 400; d++) mind = MemoryLaw.fold(mind, d);
    expect(mind).toEqual(once);
  });

  it('a name met every day stays, and a one-off "how" goes first', () => {
    let mind: IMind = freshMind('seller', 0);
    let book = emptyBook();
    ({ mind, book } = MemoryLaw.remember(mind, book, sold(0, 'buyer', 'seller', { how: 'in a hurry, shouting' })));
    for (let d = 1; d <= 200; d++) ({ mind, book } = MemoryLaw.remember(mind, book, sold(d, 'buyer', 'seller')));
    const first = mind.memories.find(m => m.slots.how !== undefined)!;
    const read = MemoryLaw.words(first, book);
    expect(read.how).toBe('?');
    expect(read.who).toBe('buyer');
    expect(read.did).toBe('bought bread from');
  });

  it('the same happening again is rehearsed, not written twice', () => {
    let { mind, book } = MemoryLaw.remember(freshMind('s', 0), emptyBook(), { day: 0, slots: { who: { person: 'b' }, did: 'bought bread from' } });
    ({ mind, book } = MemoryLaw.remember(mind, book, { day: 5, slots: { who: { person: 'b' }, did: 'bought bread from' } }));
    expect(mind.memories).toHaveLength(1);
    expect(mind.memories[0].slots.who!.gravity).toBeGreaterThan(0);
    expect(mind.memories[0].slots.who!.at).toBe(5);
  });

  it('a dying slot gives φ⁻¹ to the same atom elsewhere and φ⁻² to the loss, and nothing vanishes', () => {
    const slot = (atom: string, strength: number) => ({ atom, keys: [atom], strength, at: 0, gravity: 0 });
    const pruned = MemoryLaw.prune([
      { id: 'x', day: 0, fall: 0, slots: { who: slot('p1', 0.2), what: slot('w1', 0.9) } },
      { id: 'y', day: 0, fall: 0, slots: { who: slot('p1', 0.9) } },
      { id: 'z', day: 0, fall: 0, slots: { what: slot('w9', 0.1) } }
    ]);
    expect(pruned.memories.map(m => m.id)).toEqual(['x', 'y']);
    expect(pruned.memories[0].slots.who).toBeNull();
    expect(pruned.memories[1].slots.who!.gravity).toBeCloseTo(0.2 * PHI_FLOW, 9);
    // The orphan's flow joins the tax: φ⁻¹ + φ⁻² = 1
    expect(pruned.taxed + pruned.flowed).toBeCloseTo(0.2 + 0.1, 9);
    expect(PHI_FLOW + PHI_FLOOR).toBeCloseTo(1, 12);
  });

  it('a fold that loses something counts it', () => {
    const { mind } = MemoryLaw.remember(freshMind('a', 0), emptyBook(), { day: 0, slots: { did: 'heard a song' } });
    const gone = MemoryLaw.fold(mind, 3 * BASE_PHI_LIFE_DAYS);
    expect(gone.loss.length).toBe(1);
    expect(gone.loss[0]).toBeGreaterThan(0);
  });
});

describe('the needs ladder, turned over', () => {
  const unfed = { ...NpcAgenda.fresh(0), needs: { ...NpcAgenda.fresh(0).needs, survival: 10 } };
  const atTheTop = { ...NpcAgenda.fresh(0), needs: { survival: 90, safety: 90, belonging: 90, esteem: 90, purpose: 90 } };

  it('the lower the rung a loss leaves unmet, the heavier it is, and the bottom weighs φ²', () => {
    const weights = LADDER.map((_, i) => LadderWeight.ofRung(i));
    expect(weights[0]).toBeCloseTo(PHI_CAP, 9);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThan(weights[i - 1]);
  });

  it('the same 3 gold is light at the top and heavy to someone it leaves unfed', () => {
    const light = LadderWeight.of({ loss: true, after: { agenda: atTheTop, facts: { house: true, money: true, family: true } } });
    const heavy = LadderWeight.of({ loss: true, after: { agenda: unfed } });
    expect(heavy).toBeCloseTo(PHI_CAP, 9);
    expect(light).toBeLessThan(heavy / 2);
  });

  it('a gain adds nothing, so a loss always weighs more', () => {
    expect(LadderWeight.of({ loss: false, after: { agenda: unfed } })).toBe(0);
    expect(LadderWeight.of({ loss: true, after: { agenda: atTheTop, facts: { house: true, money: true, family: true } } })).toBeGreaterThan(0);
  });

  it('the weight goes to who did what to whom, and the day and the manner still fade', () => {
    const { mind, book } = MemoryLaw.remember(freshMind('a', 0), emptyBook(), {
      day: 0, fall: PHI_CAP,
      slots: { who: { person: 'stranger' }, did: 'took', what: 'my last coin', toWhom: { person: 'a' }, when: 'day 0', how: 'with a grin' }
    });
    for (const role of FALL_ROLES) expect(mind.memories[0].slots[role]!.gravity).toBeGreaterThanOrEqual(PHI_CAP - 1e-9);
    const later = MemoryLaw.fold(mind, 2 * BASE_PHI_LIFE_DAYS + 1);
    const read = MemoryLaw.words(later.memories[0], book);
    expect(read.how).toBe('?');
    expect(read.when).toBe('?');
    expect(read.who).toBe('stranger');
    expect(read.what).toBe('my last coin');
  });
});

describe('the ledger', () => {
  it('an open debt does not fade, and once paid it fades at its rung\'s pace', () => {
    let { mind, book } = MemoryLaw.remember(freshMind('a', 0), emptyBook(), {
      day: 0, fall: LadderWeight.ofRung(2), ledger: { kind: 'debt', key: 'debt_1' },
      slots: { who: { person: 'b' }, did: 'owes', what: 'ten gold', when: 'day 0' }
    });
    mind = MemoryLaw.fold(mind, 1000);
    expect(mind.memories[0].slots.when!.strength).toBe(1);
    mind = MemoryLaw.settle(mind, 'debt_1', 1000);
    expect(mind.memories[0].ledger).toMatchObject({ open: false, settledAt: 1000 });
    const faded = MemoryLaw.fold(mind, 1000 + 2 * BASE_PHI_LIFE_DAYS + 1);
    expect(MemoryLaw.words(faded.memories[0], book).when).toBe('?');
    expect(MemoryLaw.words(faded.memories[0], book).who).toBe('b');
  });
});

describe('recall', () => {
  it('sends the strongest memories until they hold φ⁻¹ of the mass, in order, with "?" kept', () => {
    let mind: IMind = freshMind('k', 0);
    let book = emptyBook();
    for (let d = 0; d < 30; d++) ({ mind, book } = MemoryLaw.remember(mind, book, { day: d * 10, slots: { who: { person: `p${d}` }, did: `asked about thing ${d}`, how: `manner ${d}` } }));
    const recalled = MemoryLaw.recall(mind, book, 300);
    const all = MemoryLaw.fold(mind, 300).memories;
    const total = all.reduce((s, m) => s + MemoryLaw.weight(m), 0);
    const held = recalled.reduce((s, m) => s + MemoryLaw.weight(m), 0);
    expect(held).toBeGreaterThanOrEqual(PHI_FLOW * total);
    expect(recalled.length).toBeLessThan(all.length);
    expect(recalled.map(m => m.day)).toEqual([...recalled.map(m => m.day)].sort((a, b) => a - b));
    // The newest are the strongest
    expect(recalled[recalled.length - 1].day).toBe(290);
  });

  it('an open ledger entry the talk touches always comes to mind', () => {
    let { mind, book } = MemoryLaw.remember(freshMind('k', 0), emptyBook(), {
      day: 0, ledger: { kind: 'secret', key: 's1' }, slots: { who: { person: 'k' }, did: 'let slip', what: 'wanting a forge', toWhom: { person: 'player' } }
    });
    for (let d = 1; d < 60; d++) ({ mind, book } = MemoryLaw.remember(mind, book, { day: d, slots: { who: { person: `p${d}` }, did: 'chatted', what: `topic ${d}` } }));
    const recalled = MemoryLaw.recall(mind, book, 60, { people: ['player'] });
    expect(recalled.some(m => m.ledger?.key === 's1')).toBe(true);
    expect(recalled.length).toBeLessThan(mind.memories.length);
  });
});

describe('one person on another', () => {
  it('weighs nothing for a stranger, more for someone met often, and more again for a loss they caused', () => {
    let mind: IMind = freshMind('a', 0);
    let book = emptyBook();
    expect(MemoryLaw.regard(mind, 'b', 0)).toBe(0);
    ({ mind, book } = MemoryLaw.remember(mind, book, sold(0, 'b', 'a')));
    const once = MemoryLaw.regard(mind, 'b', 1);
    for (let d = 1; d < 10; d++) ({ mind, book } = MemoryLaw.remember(mind, book, sold(d, 'b', 'a')));
    const often = MemoryLaw.regard(mind, 'b', 10);
    expect(often).toBeGreaterThan(once);
    ({ mind, book } = MemoryLaw.remember(mind, book, { day: 10, fall: PHI_CAP, slots: { who: { person: 'c' }, did: 'took from', toWhom: { person: 'a' } } }));
    expect(MemoryLaw.regard(mind, 'c', 11)).toBeGreaterThan(MemoryLaw.regard(freshMind('a', 0), 'c', 11));
    expect(PHI).toBeCloseTo(1.618034, 6);
  });
});

describe('deeds', () => {
  it('a register says who followed whom, for whoever writes the memories of a line', () => {
    let reg = Koseki.found('1,1', 'wolf_a', 'wolf', 0);
    reg = Koseki.bear(reg, 'wolf_a_h1', 'wolf', ['wolf_a'], 4);
    reg = Koseki.exit(reg, 'wolf_a', 'fell', 4);
    expect(Deeds.successionsIn(reg)).toEqual([{ heir: 'wolf_a_h1', fallen: 'wolf_a', at: 4 }]);
    const { mind, book } = MemoryLaw.remember(freshMind('wolf_a_h1', 4), emptyBook(), Deeds.succeeded({ day: 4, heir: 'wolf_a_h1', fallen: 'wolf_a' }));
    expect(MemoryLaw.words(mind.memories[0], book)).toMatchObject({ did: 'took the place of', toWhom: 'wolf_a' });
  });

  it('harm taken weighs the most, on who did it and what was done', () => {
    const hit = Deeds.hit({ day: 1, by: 'p', owner: 'm' });
    expect(hit.fall).toBeCloseTo(PHI_CAP, 9);
    expect(hit.ledger).toEqual({ kind: 'threat', key: 'threat_m_p' });
  });

  it('a round with no words from a model keeps what was said and how it sat', () => {
    const r = Deeds.talkRound({ day: 2, speaker: 'p', listener: 'n', said: 'Hello there', landed: false });
    expect(r.slots).toMatchObject({ did: 'said', what: 'Hello there', how: 'and it did not sit well' });
    expect(r.fall).toBeUndefined();
  });
});

describe('the context a model is given (Pedro: memory is mounted for the model, never shown)', () => {
  const met = (mind: IMind, book: ReturnType<typeof emptyBook>, day: number, who: string) =>
    MemoryLaw.remember(mind, book, { day, slots: { who: { person: who }, did: 'chatted with', toWhom: { person: mind.owner } } });

  it('a stranger, someone known, and someone well known, each read against their own life', () => {
    let mind: IMind = freshMind('k', 0);
    let book = emptyBook();
    expect(NpcContext.toward(mind, book, 'p', 0).knows).toBe('stranger');
    for (let d = 0; d < 10; d++) ({ mind, book } = met(mind, book, d, 'regular'));
    ({ mind, book } = MemoryLaw.remember(mind, book, { day: 10, slots: { who: { person: 'passer' }, did: 'asked the way', toWhom: { person: 'k' } } }));
    expect(NpcContext.toward(mind, book, 'regular', 10).knows).toBe('well known');
    expect(NpcContext.toward(mind, book, 'passer', 10).knows).toBe('known');
    expect(NpcContext.toward(mind, book, 'nobody', 10).knows).toBe('stranger');
  });

  it('what is unsettled with the speaker is mounted, and nothing unsettled with anyone else', () => {
    let { mind, book } = MemoryLaw.remember(freshMind('k', 0), emptyBook(), { ...Deeds.hit({ day: 0, by: 'p', owner: 'k' }) });
    ({ mind, book } = MemoryLaw.remember(mind, book, Deeds.hit({ day: 0, by: 'q', owner: 'k' })));
    const mounted = NpcContext.mount({ mind, book, today: 3, speaker: 'p', said: 'hello', name: id => (id === 'p' ? 'Pedro' : undefined) });
    expect(mounted.toward.open).toHaveLength(1);
    expect(mounted.toward.open[0]).toMatchObject({ who: 'Pedro', did: 'hurt', ledger: 'threat, open' });
    expect(mounted.memory.length).toBeGreaterThan(0);
  });

  it('no screen reads memory: nothing under src/components mounts, recalls or reads a mind', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
      const full = join(dir, f);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
    for (const file of files('src/components')) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/MemoryStore\.(mount|recall|mind|regard)|MemoryLaw\.(words|recall)|NpcContext/);
    }
  });
});

describe('two people meeting', () => {
  const side = (band: string) => ({ band, remember: { did: 'asked after', what: 'the 3 harvests', how: 'warmly', why: '' } });

  it('one pair, one key a day, whichever way round', () => {
    expect(MeetLaw.key('b', 'a', 4)).toBe(MeetLaw.key('a', 'b', 4));
    expect(MeetLaw.key('a', 'b', 4)).not.toBe(MeetLaw.key('a', 'b', 5));
  });

  it('the law takes bands and words, drops numbers, and keeps only lines that are theirs', () => {
    const verdict = MeetLaw.judge({ id: 'm1', a: side('lands') as any, b: side('grates') as any, lines: [{ by: 'a', text: ' Morning. ' }, { by: 'c', text: 'x' } as any, { by: 'b', text: '' }] }, { id: 'm1' });
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome!.a.remember.what).toBe('the harvests');
    expect(verdict.outcome!.lines).toEqual([{ by: 'a', text: 'Morning.' }]);
    expect(MeetLaw.judge({ id: 'm2', a: side('lands') as any, b: side('lands') as any, lines: [] }, { id: 'm1' }).ok).toBe(false);
    expect(MeetLaw.judge({ id: 'm1', a: side('loud') as any, b: side('lands') as any, lines: [] }, { id: 'm1' }).ok).toBe(false);
  });

  it('a batch is judged meeting by meeting, and carries no lines', () => {
    const out = MeetLaw.judgeBatch({ meetings: [{ id: 'm1', a: side('moves'), b: side('idle'), lines: [{ by: 'a', text: 'hi' }] }, { id: 'm2', a: side('nope'), b: side('idle'), lines: [] }] }, [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]);
    expect(out.outcomes.map(o => o.id)).toEqual(['m1']);
    expect(out.outcomes[0].lines).toEqual([]);
    expect(out.refused.map(r => r.id)).toEqual(['m2', 'm3']);
  });

  it('belonging moves by the bands\' own order, a day\'s fall a band, and only a meeting gone badly is a loss', () => {
    const day = NpcAgenda.dailyFall('belonging');
    expect(MeetLaw.fillOf('idle')).toEqual({});
    expect(MeetLaw.fillOf('moves')).toEqual({ belonging: 2 * day });
    expect(MeetLaw.fillOf('repels')).toEqual({ belonging: -2 * day });
    expect(MeetLaw.isLoss('grates')).toBe(true);
    expect(MeetLaw.isLoss('lands')).toBe(false);
  });

  it('two people standing still near each other meet; someone walking past does not', () => {
    const at = (x: number, y: number, moving = false) => ({ x, y, moving });
    expect(ResidentDay.meetings([
      { id: 'a', at: at(5, 5) }, { id: 'b', at: at(7, 5) }, { id: 'c', at: at(5.5, 5, true) }, { id: 'd', at: at(30, 30) }
    ])).toEqual([['a', 'b']]);
  });

  it('a meeting nobody watched rides the window\'s batch, and one being watched is spoken live, on the talk\'s model', () => {
    const asks = [{ id: 'm1', where: 'by the tavern', why: 'waiting', a: {}, b: {} } as any];
    const batch = WINDOW_REQUESTS.meet(asks as never[], {} as any);
    expect(batch.kind).toBe('window');
    expect(batch.system).toMatch(/"lines" stays empty/);
    expect(JSON.stringify(batch.schema)).toContain('meetings');
    const live = buildNpcMeetRequest(asks[0]);
    expect(live.kind).toBe('npc_talk');
    expect(live.system).toMatch(/"lines" is what they say to each other/);
  });
});


describe('the usual (Pedro: "hey glenda! want the usual?" "yes bob!")', () => {
  const WHERE = 'at the counter', WHY = 'buying a day of food';
  const sides = { bob: { band: 'lands' as const, remember: { did: 'joked about', what: 'the weather', how: 'warmly', why: '' } }, glenda: { band: 'idle' as const, remember: { did: 'asked for', what: 'the usual', how: 'briskly', why: '' } } };
  const last = (over: Partial<IUsual> = {}): IUsual => ({ sides, lines: [{ by: 'bob', text: 'The usual?' }, { by: 'glenda', text: 'Yes, Bob.' }], rung: { bob: 2, glenda: 4 }, goal: {}, day: 0, ...over });
  const now = { bob: { rung: 2 }, glenda: { rung: 4 } };

  /** Bob and Glenda meet the same way each day from day 0 to `days - 1`. */
  const habit = (days: number) => {
    let book = emptyBook();
    let bob: IMind = freshMind('bob', 0), glenda: IMind = freshMind('glenda', 0);
    for (let d = 0; d < days; d++) {
      ({ mind: bob, book } = MemoryLaw.remember(bob, book, HabitLaw.routine({ day: d, owner: 'bob', other: 'glenda', where: WHERE, why: WHY })));
      ({ mind: glenda, book } = MemoryLaw.remember(glenda, book, HabitLaw.routine({ day: d, owner: 'glenda', other: 'bob', where: WHERE, why: WHY })));
    }
    return { book, minds: { bob, glenda } };
  };
  const decide = (h: ReturnType<typeof habit>, today: number, over: Record<string, unknown> = {}) =>
    HabitLaw.decide({ a: 'bob', b: 'glenda', where: WHERE, why: WHY, today, ...h, now, last: last(), ...over } as any);

  it('the mark is φ² on strength × (1 + gravity): at full strength, gravity at the ledger bar φ', () => {
    expect(USUAL_MARK).toBeCloseTo(1 + PHI, 12);
  });

  it('a routine grows into the usual by being met, not by a count: held rises with each meeting until it is past the mark', () => {
    let previous = 0, crossed = -1;
    for (let days = 1; days <= 12; days++) {
      const h = habit(days);
      const held = Math.min(HabitLaw.held(h.minds.bob, 'glenda', WHERE, WHY, days - 1), HabitLaw.held(h.minds.glenda, 'bob', WHERE, WHY, days - 1));
      expect(held).toBeGreaterThanOrEqual(previous);
      previous = held;
      if (crossed < 0 && held >= USUAL_MARK) crossed = days;
    }
    expect(crossed).toBeGreaterThan(1);
    expect(decide(habit(crossed), crossed - 1)).toEqual({ usual: true });
    expect(decide(habit(crossed - 1), crossed - 2)).toEqual({ usual: false, because: 'faded' });
  });

  it('without a meeting a model wrote, there is nothing to say again', () => {
    expect(decide(habit(12), 11, { last: undefined })).toEqual({ usual: false, because: 'unwritten' });
  });

  it('stopping meeting fades it, and a deep habit outlasts a fresh one', () => {
    const fresh = habit(6), deep = habit(40);
    const lasts = (h: ReturnType<typeof habit>, from: number) => {
      let d = from;
      while (decide(h, d).usual) d += 1;
      return d - from;
    };
    expect(decide(fresh, 5).usual).toBe(true);
    expect(lasts(deep, 39)).toBeGreaterThan(lasts(fresh, 5));
    expect(decide(fresh, 5 + lasts(fresh, 5))).toEqual({ usual: false, because: 'faded' });
  });

  it('anything open between them sends it back to a model', () => {
    const h = habit(12);
    const owed = MemoryLaw.remember(h.minds.glenda, h.book, Deeds.secret({ day: 11, owner: 'glenda', to: 'bob', want: 'a house of her own' }));
    expect(decide({ book: owed.book, minds: { ...h.minds, glenda: owed.mind } }, 11)).toEqual({ usual: false, because: 'open' });
  });

  it('either of them lower on the ladder than when it was written sends it back: the bartender notices when Bob looks rough', () => {
    expect(decide(habit(12), 11, { now: { bob: { rung: 0 }, glenda: { rung: 4 } } })).toEqual({ usual: false, because: 'fell' });
    expect(decide(habit(12), 11, { now: { bob: { rung: 3 }, glenda: { rung: 4 } } })).toEqual({ usual: true });
  });

  it('a new goal sends it back', () => {
    expect(decide(habit(12), 11, { now: { bob: { rung: 2, goal: 'Save for a house.' }, glenda: { rung: 4 } } })).toEqual({ usual: false, because: 'goal' });
  });

  it('what is kept says itself again either way round, and a batch with no lines keeps the last lines heard', () => {
    const outcome = { id: 'm', a: sides.bob, b: sides.glenda, lines: [{ by: 'a' as const, text: 'The usual?' }, { by: 'b' as const, text: 'Yes, Bob.' }] };
    const kept = HabitLaw.keep(outcome, 'bob', 'glenda', now, 3);
    const again = HabitLaw.replay(kept, 'm2', 'glenda', 'bob');
    expect(again.a).toEqual(sides.glenda);
    expect(again.lines).toEqual([{ by: 'b', text: 'The usual?' }, { by: 'a', text: 'Yes, Bob.' }]);
    const batch = HabitLaw.keep({ ...outcome, lines: [] }, 'bob', 'glenda', now, 4, kept);
    expect(batch.lines).toEqual(kept.lines);
    expect(HabitLaw.key('bob', 'glenda', WHERE, WHY)).toBe(HabitLaw.key('glenda', 'bob', 'At the counter.', WHY));
  });
});

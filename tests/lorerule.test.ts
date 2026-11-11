/**
 * THE LORE RULE (the lore pass, BALANCE_RUN.md 3.8, its calls made on Pedro's word). Registered before the build.
 *
 * Pedro, 2026-11-11: "needs a balancing pass, lore should be slower than exp but fixed... like, a person should be able
 * to target farm lore itself". "It needs to use the d100 idea and scales for what the roll gives you, you never lose lore,
 * but we can add a debuff for a critical failure that you miss read something, it shows up as a high lore amount and
 * decreases over new lore read." "in the same category yes, general lore no, and general lore is the overall resource".
 * And, handed the eight calls: "is there any reason for you to not make the calls? we pretty much think the same about
 * the game, and the first time I called you in here you jumped in, read meele and played it... so I guess you truly can
 * make the calls". The coordinator made them; each is a line he can strike.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IItem, IPlayer, IStudySitting, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { LORE_STRETCHES, LoreLaw } from '../shared/logic/systems/LoreLaw';
import { LoreDrops } from '../shared/logic/systems/LoreDrops';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { ChainWeb, IChainGround, IChainRound, emptyChain } from '../shared/logic/theme/ChainWeb';
import { GROUND_VERSION } from '../shared/entities/world/WorldGenerator';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { LoreSystem } from '../src/logic/systems/LoreSystem';
import { RestSystem, emptyQueue } from '../src/logic/systems/RestSystem';
import { REST_SCHEMA } from '../shared/intelligence/prompts';

const FAIR_LINE = 41;
const bank = (general: number, kinds: Record<string, { name: string; held: number; misread: number }> = {}) =>
  ({ loreHeld: general, loreKinds: Object.fromEntries(Object.entries(kinds).map(([key, k]) => [key, { key, ...k }])) });

describe('the roll of a hundred and its scale (call 1)', () => {
  it('each stretch pays its fixed share of the base, over every face of the roll', () => {
    const seen: Record<string, number> = {};
    for (let face = 1; face <= 100; face++) {
      const { stretch, times } = LoreLaw.stretchOf(face);
      seen[stretch] = (seen[stretch] ?? 0) + 1;
      const want = face <= 5 ? ['misread', 0] : face <= 40 ? ['little', 0.5] : face <= 85 ? ['fair', 1] : ['deep', 2];
      expect([stretch, times]).toEqual(want);
      for (const rank of [0, 1, 2]) expect(LoreLaw.pay(rank, times)).toBe(Math.round(10 * Math.pow(1.5, rank) * (want[1] as number)));
    }
    expect(seen).toEqual({ misread: 5, little: 35, fair: 45, deep: 15 });
    // Above a hundred it is insight, and it has no top
    expect(LoreLaw.stretchOf(101)).toEqual({ stretch: 'insight', times: 3 });
    expect(LoreLaw.stretchOf(116)).toEqual({ stretch: 'insight', times: 4 });
    expect(LoreLaw.stretchOf(400).times).toBeGreaterThan(LoreLaw.stretchOf(300).times);
    expect([...LORE_STRETCHES]).toEqual(['misread', 'little', 'fair', 'deep', 'insight']);
  });

  it('five a point of the eye and of intelligence above 1 moves the person; fifteen a rank above moves the bar', () => {
    const person = (intelligence: number, eye = 0) => ({ id: 'roller', attributes: { intelligence }, studyCount: 0, studyMarks: {},
      bank: { universalSkills: eye ? { [StudySystem.scopeSkillId('weapon')]: { ...WebSystem.freshSkill(StudySystem.scopeSkillId('weapon'), ['identify_weapon'], 0), level: eye } } : {}, stashTabs: [] } } as unknown as IPlayer);
    const same = StudySystem.targetOfThing({ id: 'log', name: 'A log', tags: ['flora', 'wood'], rank: UniversalRank.F });
    const above = { ...same, rank: UniversalRank.E };
    const a = StudySystem.rollSitting(person(1), same);
    expect(a.d100).toBeGreaterThanOrEqual(1);
    expect(a.d100).toBeLessThanOrEqual(100);
    expect(StudySystem.rollSitting(person(5), same).total).toBe(a.d100 + 20);
    expect(StudySystem.rollSitting(person(5, 1), same).total).toBe(a.d100 + 25);
    expect(a.dc).toBe(FAIR_LINE);
    expect(StudySystem.rollSitting(person(1), above).dc).toBe(FAIR_LINE + 15);
    expect(a.stretch).toBe(LoreLaw.stretchOf(a.total - a.dc + FAIR_LINE).stretch);
  });

  it('what happens to the thing keeps today\'s rules, paired with the stretches', () => {
    expect(LoreLaw.outcomeOf('misread')).toBe('major_failure');
    expect(LoreLaw.outcomeOf('little')).toBe('failure');
    expect(LoreLaw.outcomeOf('fair')).toBe('success');
    expect(LoreLaw.outcomeOf('deep')).toBe('major_win');
    expect(LoreLaw.outcomeOf('insight')).toBe('major_win');
  });

  it('the same roll key replays the same', () => {
    const p = { id: 'replay', attributes: { intelligence: 3 }, studyCount: 4, studyMarks: {}, bank: { universalSkills: {}, stashTabs: [] } } as unknown as IPlayer;
    const t = StudySystem.targetOfWords('the weather');
    expect(StudySystem.rollSitting(p, t)).toEqual(StudySystem.rollSitting(p, t));
  });
});

describe('two kinds of lore, and lore held is never taken (calls 3 and 4)', () => {
  const wood = { key: 'material:wood', name: 'wood' };

  it('a sitting pays two thirds, rounded down, to its category and the rest general', () => {
    const after = LoreLaw.credit(bank(0), wood, 10, 0);
    expect(after.loreKinds!['material:wood'].held).toBe(6);
    expect(after.loreHeld).toBe(4);
    expect(LoreLaw.split(9, true)).toEqual({ category: 6, general: 3 });
  });

  it('a thing that shows nothing pays all of it general', () => {
    const after = LoreLaw.credit(bank(5), null, 10, 0);
    expect(after.loreHeld).toBe(15);
    expect(Object.keys(after.loreKinds ?? {})).toEqual([]);
    expect(LoreLaw.split(9, false)).toEqual({ category: 0, general: 9 });
  });

  it('no outcome ever lowers lore held, of either kind', () => {
    let b = bank(20, { 'material:wood': { name: 'wood', held: 12, misread: 0 } });
    for (const stretch of LORE_STRETCHES) {
      const amount = LoreLaw.pay(0, LoreLaw.timesOf(stretch));
      const next = LoreLaw.credit(b, wood, amount, stretch === 'misread' ? LoreLaw.misreadOf(0) : 0);
      expect(next.loreHeld!).toBeGreaterThanOrEqual(b.loreHeld!);
      expect(next.loreKinds!['material:wood'].held).toBeGreaterThanOrEqual(b.loreKinds!['material:wood'].held);
      b = next;
    }
  });

  it('a misreading locks its own category and no other, and never general', () => {
    const b = LoreLaw.credit(bank(10, { 'material:wood': { name: 'wood', held: 12, misread: 0 }, 'family:mineral': { name: 'mineral', held: 9, misread: 0 } }), wood, 0, LoreLaw.misreadOf(0));
    expect(b.loreKinds!['material:wood'].misread).toBe(30);
    expect(LoreLaw.shown(b.loreKinds!['material:wood'])).toBe(42);
    expect(LoreLaw.spendable(b, 'material:wood')).toBe(10);
    expect(LoreLaw.spendable(b, 'family:mineral')).toBe(19);
    expect(LoreLaw.spendable(b, null)).toBe(10);
    // A price inside the general pool is paid from it; past it, the locked category does not answer
    expect(LoreLaw.spend(b, 'material:wood', 8)!.loreKinds!['material:wood'].held).toBe(12);
    expect(LoreLaw.spend(b, 'material:wood', 11)).toBeNull();
  });

  it('new lore of the category wears a misreading down by exactly what is read, and the new lore is kept', () => {
    const locked = LoreLaw.credit(bank(0), wood, 0, 30);
    const read = LoreLaw.credit(locked, wood, 15, 0);
    expect(read.loreKinds!['material:wood'].misread).toBe(30 - 10);
    expect(read.loreKinds!['material:wood'].held).toBe(10);
    expect(read.loreHeld).toBe(5);
    const clear = LoreLaw.credit(LoreLaw.credit(read, wood, 30, 0), wood, 0, 0);
    expect(clear.loreKinds!['material:wood'].misread).toBe(0);
    expect(LoreLaw.spendable(clear, 'material:wood')).toBe(clear.loreHeld! + clear.loreKinds!['material:wood'].held);
  });

  it('a sink takes its own category first, then general', () => {
    const b = bank(20, { 'material:wood': { name: 'wood', held: 25, misread: 0 } });
    const paid = LoreLaw.spend(b, 'material:wood', 40)!;
    expect(paid.loreKinds!['material:wood'].held).toBe(0);
    expect(paid.loreHeld).toBe(5);
    expect(LoreLaw.spend(b, 'family:flora', 40)).toBeNull();
  });

  it('a save from before reads its purse as general lore, and nothing is lost', () => {
    const old = { loreHeld: 55 };
    expect(LoreLaw.general(old)).toBe(55);
    expect(LoreLaw.spendable(old, 'material:wood')).toBe(55);
    expect(LoreLaw.spend(old, 'material:wood', 40)!.loreHeld).toBe(15);
  });
});

describe('what a category is: the hub\'s web, and the family where it says nothing (call 2)', () => {
  const good = (key: string, tags: string[], station: string, from: string[], answers: string): IChainRound['goods'][number] => ({
    key, name: key, blurb: 'x', tags, rank: 'E', weight: 'light', trade: 'smithing', station, from: from.map(k => ({ key: k, count: 1 })), makes: 1, answers
  });
  const station = (key: string, tool: string[], material: string[]): IChainRound['stations'][number] => ({ key, name: key, blurb: 'x', tool, material, bill: [] });
  const GROUND: IChainGround = {
    things: [{ key: 'palm', name: 'Palm', tags: ['flora', 'wood'], rank: 'F' }, { key: 'flint', name: 'Flint', tags: ['mineral', 'stone'], rank: 'F' }],
    stations: [], tools: []
  };
  const hub = { ground: GROUND, chain: ChainWeb.merge(emptyChain(), { tags: [], materials: [], gear: [], stations: [station('glasshouse', ['sickle'], ['flora']), station('tube_shop', ['blunt'], ['metal'])],
    goods: [good('spit_plant', ['flora'], 'glasshouse', ['palm'], 'fireball'), good('tube', ['metal'], 'tube_shop', ['flint'], 'fireball')] }) };

  it('two roads to one concept are one category', () => {
    const plant = WebSystem.categoryOf(['flora'], hub, ['spit_plant']);
    const tube = WebSystem.categoryOf(['metal'], hub, ['tube']);
    expect(plant).toBeTruthy();
    expect(plant!.key).toBe(tube!.key);
  });

  it('with no hub web the family is the category, then the material, and nothing worked has none', () => {
    expect(WebSystem.categoryOf(['flora'], undefined, ['spit_plant'])!.key).toBe('family:flora');
    expect(WebSystem.categoryOf(['flora', 'wood'])!.key).toBe('family:flora');
    expect(WebSystem.categoryOf(['wood'])!.key).toBe('material:wood');
    expect(WebSystem.categoryOf([])).toBeNull();
  });

  it('what a person is shown of a category is what they studied, never the hub\'s concept (D125)', () => {
    const p = { id: 'shown', attributes: { intelligence: 1 }, studyCount: 0, studyMarks: {}, bank: { universalSkills: {}, stashTabs: [] } } as unknown as IPlayer;
    const plant = StudySystem.targetOfThing({ id: 'spit_plant', name: 'A fire-spitting plant', tags: ['flora'] });
    const lore = StudySystem.loreOf(p, plant, { stretch: 'fair', times: 1 }, hub);
    expect(lore.category!.key).toBe(WebSystem.categoryOf(['flora'], hub, ['spit_plant'])!.key);
    expect(lore.category!.name).toBe('A fire-spitting plant');
    expect(JSON.stringify(lore.category!.name)).not.toContain('fireball');
    expect(StudySystem.loreOf(p, plant, { stretch: 'fair', times: 1 }).category).toEqual({ key: 'family:flora', name: 'flora' });
  });
});

describe('paper, documents, and what a sitting records (calls 5 and 7)', () => {
  const p = (items: IItem[] = []) => ({ id: 'reader', attributes: { intelligence: 1 }, studyCount: 0, studyMarks: {}, bank: { universalSkills: {}, stashTabs: [{ name: 't', items }] } } as unknown as IPlayer);
  const item = (over: Partial<IItem>): IItem => ({
    id: 'itm', universalDefinitionId: 'def_x', name: 'Thing', description: '', type: ItemType.RESOURCE, slot: SlotType.MAIN_HAND, rank: UniversalRank.F, rarity: Rarity.COMMON,
    quality: 0.5, level: 1, value: 10, itemPower: 1, tags: ['wood'], affixes: [], dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'm', colorHex: '#000' }, icon: 'i', ...over
  } as IItem);

  it('a document pays twice its stretch, and a thing of paper half again', () => {
    const plain = item({ id: 'plain' });
    const doc = item({ id: 'doc', type: ItemType.LORE, tags: ['lore', 'document'] });
    const paper = item({ id: 'paper', tags: ['paper'] });
    const fair = { stretch: 'fair' as const, times: 1 };
    const who = p([plain, doc, paper]);
    expect(StudySystem.loreOf(who, StudySystem.targetOfItem(plain), fair).amount).toBe(10);
    expect(StudySystem.loreOf(who, StudySystem.targetOfItem(doc), fair).amount).toBe(20);
    expect(StudySystem.loreOf(who, StudySystem.targetOfItem(paper), fair).amount).toBe(15);
  });

  it('an unread piece pays plain and all general, whatever it is (D32)', () => {
    const doc = item({ id: 'hidden_doc', type: ItemType.LORE, tags: ['lore', 'document', 'paper'], isIdentified: false });
    const lore = StudySystem.loreOf(p([doc]), StudySystem.targetOfItem(doc), { stretch: 'fair', times: 1 });
    expect(lore.amount).toBe(10);
    expect(lore.category).toBeNull();
  });

  it('a misreading is three times the base, and pays nothing now', () => {
    const lore = StudySystem.loreOf(p(), StudySystem.targetOfThing({ id: 'log', name: 'A log', tags: ['flora', 'wood'], rank: UniversalRank.E }), { stretch: 'misread', times: 0 });
    expect(lore.amount).toBe(0);
    expect(lore.misread).toBe(45);
  });

  it('a sitting records what it pays, and the dream is told the stretch, not asked for a depth', () => {
    const who = p();
    const { sitting } = StudySystem.sit(who, StudySystem.targetOfThing({ id: 'log', name: 'A log', tags: ['flora', 'wood'] }), 15, 0);
    expect(LORE_STRETCHES).toContain(sitting.lore!.stretch);
    const props = (REST_SCHEMA.properties as any).studied.items;
    expect(props.required).not.toContain('depth');
    expect(props.properties.depth).toBeUndefined();
  });

  it('the dream lands what the sitting recorded, by kind, whatever it says', () => {
    const sitting: IStudySitting = {
      id: 'sit_9', outcome: 'success', rankIndex: 0, energy: 15, at: 0, before: 0,
      target: { kind: 'thing', ref: 'log', name: 'A log', tags: ['flora', 'wood'] },
      lore: { stretch: 'fair', amount: 9, misread: 0, category: { key: 'family:flora', name: 'flora' } }
    };
    const player = { id: 'dreamer', bank: { loreHeld: 1, lore: {}, universalSkills: {}, stashTabs: [] }, restQueue: { ...emptyQueue(), sittings: [sitting] }, skillGifts: {} } as unknown as IPlayer;
    const after = RestSystem.applyDream(player, { skills: [], weaves: [], gifts: [], studied: [{ id: 'sit_9', topics: ['wood'], line: 'Wood.' }], taught: [], raised: [] } as never);
    expect(after.bank.loreHeld).toBe(1 + 3);
    expect(after.bank.loreKinds!['family:flora'].held).toBe(6);
  });

  it('a person is told what a sitting gave, by kind, and a misreading reads as high lore', () => {
    const gave = LoreSystem.saidOf('A log', 'Wood.', { stretch: 'fair', amount: 9, misread: 0, category: { key: 'family:flora', name: 'flora' } });
    expect(gave).toContain('+6 lore of flora');
    expect(gave).toContain('+3 general');
    const misread = LoreSystem.saidOf('A log', 'Wood.', { stretch: 'misread', amount: 0, misread: 30, category: { key: 'family:flora', name: 'flora' } });
    expect(misread).toContain('+30 lore of flora');
    expect(misread).not.toMatch(/misread/i);
    expect(LoreSystem.saidOf('The weather', 'Rain.', { stretch: 'fair', amount: 10, misread: 0 })).toContain('+10 general');
  });
});

describe('lore pieces drop a lot, in a world pinned to it (call 6)', () => {
  it('a fragment drops on its own stream, sometimes from a mind and often from a hoard', () => {
    const runs = 20000;
    const count = (source: 'creature' | 'hoard', version: number) => {
      let n = 0;
      for (let i = 0; i < runs; i++) if (LoreDrops.fragment(source, `drop:${i}`, version)) n++;
      return n / runs;
    };
    expect(count('creature', GROUND_VERSION)).toBeCloseTo(0.25, 1);
    expect(count('hoard', GROUND_VERSION)).toBeCloseTo(0.6, 1);
    expect(LoreDrops.fragment('creature', 'drop:7', GROUND_VERSION)).toBe(LoreDrops.fragment('creature', 'drop:7', GROUND_VERSION));
  });

  it('a world that stands gives what it gave', () => {
    expect(GROUND_VERSION).toBeGreaterThan(2);
    for (let i = 0; i < 200; i++) {
      expect(LoreDrops.fragment('creature', `old:${i}`, 2)).toBe(false);
      expect(LoreDrops.fragment('hoard', `old:${i}`, undefined)).toBe(false);
    }
  });
});

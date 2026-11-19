/**
 * WHAT A PERSON WANTS TO MAKE (D119; Pedro, 2026-11-01: "componet + component and input to send to haiku what the person
 * wants to make"; 2026-11-19: "i hate hard coded stuf... it takes input materials that the user adds, or, input study things
 * that they list, and sends them as a list with the skills for the next long sleep... and when they log back in they receive
 * the updates from the LLM that already have been settled as tech").
 *
 * What these bars hold:
 *  - laying: at home only, with words and something put in; the components leave the vault and come back when taken back;
 *  - what a sleep carries: each ask as its words and its bill, what the hands know, what this hub could raise;
 *  - the law over an answer: nothing a model says passes unjudged, and a "no" is a sound answer;
 *  - a technology is its three parts and its name is apart; its numbers are the law's; the first to come to it names it;
 *  - once settled, the same components make it with nobody asked, set one on the other or made at once;
 *  - a snare is nothing code wrote: it is what came back from an ask carrying the registry's word, and the capture law reads it;
 *  - at the door: the ask goes with the sleep, and on return the technology is in the hub and the thing is in the vault.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, IMakeWords, IPlayer, ITech, TagKind, UniversalRank } from '../shared/types';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useHubStore, hubPort } from '../src/entities/hub/store';
import { worldPort } from '../src/entities/world/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { useFeed } from '../src/components/ui/stores';
import { emptyTech } from '../src/entities/hub/hubTech';
import { ASK_WORDS, IMakeGround, MakeAsk, TRIES } from '../shared/logic/systems/MakeAsk';
import { MakeDoor } from '../src/logic/systems/MakeDoor';
import { PairCraft, IMaker } from '../shared/logic/systems/PairCraft';
import { Capture } from '../shared/logic/systems/Capture';
import { Downtime } from '../shared/logic/systems/Downtime';
import { RestDoor } from '../src/logic/systems/RestDoor';
import { IDreamResult, RestSystem } from '../src/logic/systems/RestSystem';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';
import { REST_SCHEMA, buildRestRequest } from '../shared/intelligence/prompts';
import { TECH_WAYS, CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { WebBank } from '../shared/logic/content/WebBank';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { DowntimePanel } from '../src/components/DowntimePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const materialId = (key: string) => {
  const m = Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === themeId && d.id.endsWith(key));
  if (!m) throw new Error(`no ${key}`);
  return m.id;
};
const REED = () => materialId('tellers_reed');
const STONE = () => materialId('vault_stone');
let n = 0;
const harvested = (defId: string): IItem => ItemFactory.createResourceItem(RESOURCE_DEFINITIONS[defId], Rng.fromKey(`make-test:${++n}`));

const player = () => usePlayerStore.getState().player;
const set = (change: (p: IPlayer) => IPlayer) => usePlayerStore.setState(s => ({ player: change(s.player) }));
const vault = () => player().bank.stashTabs[0].items;
const inVault = (...items: IItem[]) => set(p => ({ ...p, bank: { ...p.bank, stashTabs: [{ ...p.bank.stashTabs[0], items, layout: {} }] } }));
const feedSaid = () => useFeed.getState().lines.map(l => l.text).join(' | ');

const ground = (): IMakeGround => {
  const tags = WebBank.current().tags;
  return { kindOf: (tag: string): TagKind | undefined => tags.find(t => t.tag === tag && !t.retired)?.kind, stations: WebBank.current().stations.map(s => ({ key: s.id, name: s.name })) };
};
const aTrade = () => WebBank.current().tags.find(t => t.kind === 'trade' && !t.retired)!.tag;
const aTool = () => WebBank.current().tags.find(t => t.kind === 'tool' && !t.retired)!.tag;

/** A maker whose hands always carry the making through: these bars are about what is made, not about the dice. */
const steady: IMaker = { rank: UniversalRank.F, dexterity: 40, skillLevel: () => 0, hasBench: () => true };

const snareWords = (id: string, over: Partial<IMakeWords> = {}): IMakeWords => ({
  id, makes: true, line: 'You tied a loop that closes on a leg and holds.', name: 'Reed Snare', is: 'A loop of twisted reed that holds a small thing alive.',
  tags: ['snare', 'fiber'], trade: '', station: '', tools: [], ...over
});
const answer = (over: Partial<IDreamResult> = {}): IDreamResult => ({ skills: [], weaves: [], gifts: [], studied: [], taught: [], raised: [], made: [], ...over });

/** Two kinds the shipped world makes nothing of, so what an ask settles for them is the only making they have. */
const loosePair = (): [string, string] => {
  const ids = Object.values(RESOURCE_DEFINITIONS).filter(d => d.themeId === themeId && !(d as { junk?: boolean }).junk).map(d => d.id).sort();
  for (const a of ids) for (const b of ids) if (a < b && !PairCraft.recipeFor(a, b)) return [a, b];
  throw new Error('every pair makes something');
};
/** One of each of those laid, on the player in the store. */
const layLoose = (words = 'a weighted loop to catch a bird alive') => {
  const [x, y] = loosePair();
  const a = harvested(x), b = harvested(y);
  inVault(a, b);
  const out = MakeAsk.lay(player(), words, [a.id, b.id], 1000);
  set(() => out.player!);
  return out.ask!;
};

/** Two reeds laid for a snare, on the player in the store. */
const laySnare = (words = 'something to catch a bird alive') => {
  const a = harvested(REED()), b = harvested(REED());
  inVault(a, b);
  const out = MakeAsk.lay(player(), words, [a.id, b.id], 1000);
  set(() => out.player!);
  return out.ask!;
};

beforeEach(() => {
  db.clear();
  vi.restoreAllMocks();
  useFeed.setState({ lines: [] });
  for (const id of Object.keys(TECH_WAYS)) { delete CRAFTED_DEFINITIONS[TECH_WAYS[id].output.id]; delete TECH_WAYS[id]; }
  useIdentityStore.setState({ certificate: { metadata: { uid: 'make_tester', displayName: 'TESTER', createdAt: 0 }, publicKey: {} } as never });
  useHubStore.setState({ activeHubId: 'hub_make', rooms: {}, lots: [] as never, tech: emptyTech() });
  set(p => ({
    ...p, currentSession: undefined, energyToday: undefined, rest: undefined, restQueue: undefined, pendingDream: undefined, makeAsks: undefined,
    bank: { ...p.bank, gold: 1000, universalSkills: {}, stashTabs: [{ ...p.bank.stashTabs[0], items: [], layout: {} }] }
  }));
});

// =============================================================================
describe('laying: components and what is wanted, at home', () => {
  it('needs words and something put in, and is laid where a character rests', () => {
    const a = harvested(REED());
    inVault(a);
    expect(MakeAsk.lay(player(), '   ', [a.id], 0).reason).toMatch(/Say what you want/);
    expect(MakeAsk.lay(player(), 'a snare', [], 0).reason).toMatch(/Put in what it is to be made of/);
    expect(MakeAsk.lay(player(), 'a snare', ['itm_nowhere'], 0).reason).toMatch(/Put in/);
    expect(MakeAsk.lay({ ...player(), currentSession: {} as never }, 'a snare', [a.id], 0).reason).toMatch(/at home/);
    expect(MakeAsk.lay(player(), 'a snare', [a.id], 0).ok).toBe(true);
  });

  it('takes one component or many, and never what is unread or is not a material', () => {
    const a = harvested(REED()), b = harvested(REED()), c = harvested(STONE());
    inVault(a, b, c, { ...harvested(REED()), id: 'itm_unread', isIdentified: false });
    expect(MakeAsk.lay(player(), 'a stake', [a.id], 0).ask!.parts).toHaveLength(1);
    expect(MakeAsk.lay(player(), 'a weighted net', [a.id, b.id, c.id], 0).ask!.parts).toHaveLength(3);
    expect(MakeAsk.lay(player(), 'a thing', ['itm_unread'], 0).reason).toMatch(/do not know what one of those is/);
  });

  it('the components leave the vault and their places, and come back whole when it is taken back', () => {
    const a = harvested(REED()), b = harvested(REED()), c = harvested(STONE());
    set(p => ({ ...p, bank: { ...p.bank, stashTabs: [{ ...p.bank.stashTabs[0], items: [a, b, c], layout: { [a.id]: { x: 0, y: 0, rotated: false }, [c.id]: { x: 1, y: 0, rotated: false } } }] } }));
    const out = MakeAsk.lay(player(), 'something to catch a bird alive', [a.id, b.id], 5);
    expect(out.player!.bank.stashTabs[0].items.map(i => i.id)).toEqual([c.id]);
    expect(Object.keys(out.player!.bank.stashTabs[0].layout ?? {})).toEqual([c.id]);
    expect(out.player!.makeAsks).toEqual([{ id: out.ask!.id, words: 'something to catch a bird alive', parts: [a, b], at: 5 }]);
    const back = MakeAsk.takeBack(out.player!, out.ask!.id);
    expect(back.makeAsks).toEqual([]);
    expect(back.bank.stashTabs[0].items.map(i => i.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('what is said is kept as said, trimmed, and no longer than a sleep\'s bill allows', () => {
    const a = harvested(REED());
    inVault(a);
    expect(MakeAsk.lay(player(), '  a   loop \n for birds ', [a.id], 0).ask!.words).toBe('a loop for birds');
    expect(MakeAsk.lay(player(), 'x'.repeat(ASK_WORDS + 50), [a.id], 0).ask!.words).toHaveLength(ASK_WORDS);
  });

  it('as many wait as focus holds, as a stack does', () => {
    const holds = Downtime.capacity(player().attributes);
    expect(MakeAsk.holds(player())).toBe(holds);
    for (let i = 0; i < holds; i++) {
      const piece = harvested(REED());
      set(p => ({ ...p, bank: { ...p.bank, stashTabs: [{ ...p.bank.stashTabs[0], items: [...p.bank.stashTabs[0].items, piece] }] } }));
      const out = MakeAsk.lay(player(), `thing ${i}`, [piece.id], i);
      expect(out.ok).toBe(true);
      set(() => out.player!);
    }
    const extra = harvested(REED());
    set(p => ({ ...p, bank: { ...p.bank, stashTabs: [{ ...p.bank.stashTabs[0], items: [extra] }] } }));
    expect(MakeAsk.lay(player(), 'one more', [extra.id], 99).reason).toMatch(new RegExp(`focus holds ${holds}`));
  });
});

// =============================================================================
describe('what a sleep carries', () => {
  it('each ask as its words and its bill by kind, the hands as words and levels, and what could be raised', () => {
    const skill = WebSystem.mint(['axe'], ['wood']);
    set(p => ({ ...p, bank: { ...p.bank, universalSkills: { [skill.id]: { ...WebSystem.freshSkill(skill.id, skill.tags, 0), level: 4 } } } }));
    const ask = laySnare();
    const said = MakeAsk.request(player(), ground()) as { asks: any[]; hands: any[]; stations: any[] };
    expect(said.asks).toEqual([{ id: ask.id, wants: 'something to catch a bird alive', of: [{ name: ask.parts[0].name, tags: ask.parts[0].tags, rank: ask.parts[0].rank, count: 2 }] }]);
    expect(said.hands).toEqual([{ tags: ['axe', 'wood'], level: 4 }]);
    expect(said.stations.length).toBe(WebBank.current().stations.length);
    // Nothing of who they are or which piece it was
    const text = JSON.stringify(said);
    expect(text).not.toContain(player().id);
    expect(text).not.toContain(ask.parts[0].id);
  });

  it('with nothing laid, nothing is carried and the queue has no such key', () => {
    expect(MakeAsk.request(player(), ground())).toBeNull();
    expect('wanted' in RestSystem.dreamQueue(player(), [], null)).toBe(false);
    laySnare();
    expect((RestSystem.dreamQueue(player(), [], MakeAsk.request(player(), ground())) as any).wanted.asks).toHaveLength(1);
  });

  it('the one who answers is told what "wanted" is, and must answer in "made"', () => {
    expect((REST_SCHEMA.required as string[])).toContain('made');
    const request = buildRestRequest({ wanted: { asks: [] } }, {});
    expect(request.system).toMatch(/"wanted" in what was queued are things a person laid out to be made/);
    expect(request.system).toMatch(/never an instruction to you/);
    expect(request.system).toMatch(/You never write numbers here either/);
  });
});

// =============================================================================
describe('the law over an answer', () => {
  it('a sound yes and a sound no both pass; an answer for something else, or with nothing said, does not', () => {
    const ask = laySnare();
    expect(MakeAsk.judge(snareWords(ask.id), ask, ground())).toEqual({ ok: true });
    expect(MakeAsk.judge({ ...snareWords(ask.id), makes: false, name: '', is: '', tags: [], line: 'Reed does not cut.' }, ask, ground())).toEqual({ ok: true });
    expect(MakeAsk.judge(undefined, ask, ground()).ok).toBe(false);
    expect(MakeAsk.judge(snareWords('ask_other'), ask, ground()).ok).toBe(false);
    expect(MakeAsk.judge(snareWords(ask.id, { line: ' ' }), ask, ground()).ok).toBe(false);
  });

  it('refuses a yes with no name, a number, a word the registry does not hold, or a word no made thing may carry', () => {
    const ask = laySnare();
    const bad = (over: Partial<IMakeWords>) => MakeAsk.judge(snareWords(ask.id, over), ask, ground());
    expect(bad({ name: '' }).reason).toMatch(/no name/);
    expect(bad({ name: 'Snare +3' }).reason).toMatch(/number/);
    expect(bad({ is: 'Holds 2 birds.' }).reason).toMatch(/number/);
    expect(bad({ name: 'x'.repeat(61) }).reason).toMatch(/not a name/);
    expect(bad({ is: '' }).reason).toMatch(/what the thing is/);
    expect(bad({ tags: [] }).reason).toMatch(/no words/);
    expect(bad({ tags: ['snare', 'sharknado_bait'] }).reason).toMatch(/not a word the registry holds/);
    expect(bad({ tags: ['snare', 'station'] }).reason).toMatch(/never "station"/);
  });

  it('a trade is a trade, a station is one this hub could raise, a tool is a tool', () => {
    const ask = laySnare();
    const judged = (over: Partial<IMakeWords>) => MakeAsk.judge(snareWords(ask.id, over), ask, ground());
    expect(judged({ trade: aTrade() }).ok).toBe(true);
    expect(judged({ trade: 'snare' }).reason).toMatch(/not a trade/);
    expect(judged({ station: ground().stations[0].key }).ok).toBe(true);
    expect(judged({ station: 'stn_nowhere' }).reason).toMatch(/Nobody here could raise/);
    expect(judged({ tools: [aTool()] }).ok).toBe(true);
    expect(judged({ tools: ['fiber'] }).reason).toMatch(/not a tool/);
  });
});

// =============================================================================
describe('a technology: three parts, the name apart, the numbers the law\'s', () => {
  it('its id is minted from where, with what, and from what into what; the name and who asked do not move it', () => {
    const ask = laySnare();
    const one = MakeAsk.techOf(ask, snareWords(ask.id), { by: 'p1', at: 1 });
    const renamed = MakeAsk.techOf({ ...ask, words: 'a bird catcher' }, snareWords(ask.id, { name: 'Birdloop', is: 'Another way of saying it.', line: 'x' }), { by: 'p2', at: 2 });
    expect(renamed.id).toBe(one.id);
    expect(renamed.output.id).toBe(one.output.id);
    expect(MakeAsk.techOf(ask, snareWords(ask.id, { tags: ['fiber'] }), { by: 'p1', at: 1 }).id).not.toBe(one.id);
    expect(MakeAsk.techOf(ask, snareWords(ask.id, { station: ground().stations[0].key }), { by: 'p1', at: 1 }).id).not.toBe(one.id);
    expect(MakeAsk.techOf(ask, snareWords(ask.id, { tools: [aTool()] }), { by: 'p1', at: 1 }).id).not.toBe(one.id);
    expect(MakeAsk.techOf({ ...ask, parts: [ask.parts[0]] }, snareWords(ask.id), { by: 'p1', at: 1 }).id).not.toBe(one.id);
    // The order words came in does not matter
    expect(MakeAsk.techOf(ask, snareWords(ask.id, { tags: ['fiber', 'snare'] }), { by: 'p1', at: 1 }).id).toBe(one.id);
  });

  it('it says its bill by kind, ranks as the best thing in it, weighs what went in, and takes a good\'s time', () => {
    const reed = harvested(REED()), stone = { ...harvested(STONE()), rank: UniversalRank.D };
    const ask = { id: 'ask_x', words: 'a weighted loop', parts: [reed, { ...reed, id: 'r2' }, stone], at: 0 };
    const tech = MakeAsk.techOf(ask, snareWords('ask_x'), { by: 'p1', at: 7 });
    expect(tech.inputs).toEqual([{ itemId: REED(), quantity: 2 }, { itemId: STONE(), quantity: 1 }].sort((a, b) => (a.itemId < b.itemId ? -1 : 1)));
    expect(tech.output.rank).toBe(UniversalRank.D);
    expect(tech.output.weight).toBeCloseTo(Math.round((reed.weight * 2 + stone.weight) * 10) / 10, 5);
    expect(tech.laborSeconds).toBe(10 + 2 * 15);
    expect(tech).toMatchObject({ name: 'Reed Snare', station: '', tools: [], trade: '', wanted: 'a weighted loop', by: 'p1', at: 7 });
  });

  it('settled, the thing is made of what was laid and comes back read, carrying the words the answer gave it', () => {
    const ask = laySnare();
    const { tech, fresh, made } = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    expect(fresh).toBe(true);
    expect(made.outcome).not.toBe('major_failure');
    expect(made.item).toMatchObject({ name: 'Reed Snare', universalDefinitionId: tech.output.id, isIdentified: true });
    expect(made.item.tags).toEqual(expect.arrayContaining(['snare', 'fiber']));
    // What it is made of is on it: the two that went in, and the technology as its one step
    expect(made.item.composition!.steps.map(st => st.recipeId)).toContain(tech.id);
    expect(made.item.composition!.materials.reduce((sum, m) => sum + m.count, 0)).toBe(2);
    expect(TECH_WAYS[tech.id]).toBe(tech);
    expect(CRAFTED_DEFINITIONS[tech.output.id]).toMatchObject({ name: 'Reed Snare', tags: ['fiber', 'snare'] });
  });

  it('the first to come to its parts named it: a second answer with another name settles nothing new', () => {
    const first = laySnare();
    const one = MakeAsk.settle(first, snareWords(first.id), steady, { by: 'p1', at: 1 });
    const second = laySnare('a loop for rabbits');
    const two = MakeAsk.settle(second, snareWords(second.id, { name: 'Rabbit Loop' }), steady, { by: 'p2', at: 2 }, [one.tech]);
    expect(two.fresh).toBe(false);
    expect(two.tech).toBe(one.tech);
    expect(two.made.item.name).toBe('Reed Snare');
  });

  it('the same making, the same hands and the same ask come to the same thing on any machine', () => {
    const ask = laySnare();
    const a = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    const b = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    expect(b.made.item).toEqual(a.made.item);
    expect(b.made.roll).toEqual(a.made.roll);
  });
});

// =============================================================================
describe('once it exists it is determined: the same components make it with nobody asked', () => {
  it('one set on the other is that making now, where before the two made nothing', () => {
    const [x, y] = loosePair();
    expect(PairCraft.recipeFor(x, y)).toBeNull();
    const ask = layLoose();
    const { tech } = MakeAsk.settle(ask, snareWords(ask.id, { name: 'Weighted Snare' }), steady, { by: 'p1', at: 1 });
    expect(PairCraft.recipeFor(x, y)).toMatchObject({ id: tech.id, name: 'Weighted Snare', output: tech.output.id, asks: null });
    expect(PairCraft.recipeFor(y, x)?.id).toBe(tech.id);
    const made = PairCraft.make(harvested(x), harvested(y), steady, 'k');
    expect(made.recipe?.id).toBe(tech.id);
    expect(made.item.tags).toContain('snare');
    expect(made.item.isIdentified).toBe(false);
  });

  it('components the world already makes something of keep that making under the hand, and what was asked is reached by name', () => {
    // Two reeds are cloth in the shipped world. A snare asked of two reeds stands beside it, and neither takes the other's place
    const cloth = PairCraft.recipeFor(REED(), REED());
    expect(cloth).not.toBeNull();
    const ask = laySnare();
    const { tech } = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    expect(PairCraft.recipeFor(REED(), REED())?.id).toBe(cloth!.id);
    expect(MakeAsk.knownFor([harvested(REED()), harvested(REED())], [tech])).toEqual([tech]);
  });

  it('what is put in is matched to what stands by its kinds, and made at once from the vault', () => {
    const ask = laySnare();
    const { tech } = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    const a = harvested(REED()), b = harvested(REED()), c = harvested(STONE());
    expect(MakeAsk.knownFor([a, b], [tech])).toEqual([tech]);
    // The bill is the bill: one reed is not two, and three are not two
    expect(MakeAsk.knownFor([a], [tech])).toEqual([]);
    expect(MakeAsk.knownFor([a, b, harvested(REED())], [tech])).toEqual([]);
    expect(MakeAsk.knownFor([a, c], [tech])).toEqual([]);
    expect(MakeAsk.knownFor([], [tech])).toEqual([]);
    inVault(a, b, c);
    const out = MakeAsk.makeNow(player(), tech.id, [a.id, b.id], steady, 50, [tech]);
    expect(out.ok).toBe(true);
    expect(out.player!.bank.stashTabs[0].items.map(i => i.universalDefinitionId).sort()).toEqual([STONE(), tech.output.id].sort());
    expect(MakeAsk.makeNow(player(), tech.id, [a.id, c.id], steady, 50, [tech]).reason).toMatch(/not what those make/);
  });
});

// =============================================================================
describe('a snare is nothing code wrote', () => {
  it('no file ties one, names one or gives one a bill any more', () => {
    for (const file of ['shared/logic/systems/Capture.ts', 'src/logic/systems/FieldCapture.ts', 'src/components/FarmWindow.tsx', 'shared/logic/economy/gameWays.ts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/tieSnare|tieAtHome|itm_snare|SNARE_WAY|SNARE_PARTS|TIE A SNARE/);
    }
  });

  it('what came back from an ask with the registry\'s word is one, and the capture law takes it', () => {
    expect(ground().kindOf('snare')).toBeTruthy();
    const ask = laySnare();
    const { made } = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    expect(Capture.canSnare([made.item], 'pop_1_1_bird_0', { tags: ['beast'] })).toBe(true);
    // And a thing that came back without the word is not, whatever it was called
    const rope = laySnare('a length of rope');
    const other = MakeAsk.settle(rope, snareWords(rope.id, { name: 'Snare Rope', tags: ['fiber'] }), steady, { by: 'p1', at: 1 });
    expect(Capture.canSnare([other.made.item], 'pop_1_1_bird_0', { tags: ['beast'] })).toBe(false);
  });
});

// =============================================================================
describe('an answer nobody can read', () => {
  it('leaves the ask waiting, and after enough of them gives the components back', () => {
    const ask = laySnare();
    let p = player();
    for (let i = 1; i < TRIES; i++) {
      const out = MakeAsk.unread(p, ask.id);
      expect(out.givenBack).toBe(false);
      expect(out.player.makeAsks![0].tries).toBe(i);
      p = out.player;
    }
    const last = MakeAsk.unread(p, ask.id);
    expect(last.givenBack).toBe(true);
    expect(last.player.makeAsks).toEqual([]);
    expect(last.player.bank.stashTabs[0].items.map(i => i.id).sort()).toEqual(ask.parts.map(i => i.id).sort());
  });
});

// =============================================================================
describe('at the door: it goes with the sleep and is settled on return', () => {
  it('laying says so, and the ask is what a sleep files even with nothing else queued', async () => {
    const a = harvested(REED()), b = harvested(REED());
    inVault(a, b);
    expect(MakeDoor.lay('something to catch a bird alive', [a.id, b.id], playerPort).ok).toBe(true);
    expect(vault()).toEqual([]);
    expect(feedSaid()).toMatch(/Laid for your next rest: "something to catch a bird alive"/);
    const file = vi.spyOn(IntelligenceClient, 'fileRest').mockResolvedValue({ status: 'PENDING', batchId: 'b1' } as never);
    await RestDoor.file([], worldPort, playerPort, hubPort);
    expect(file).toHaveBeenCalledOnce();
    const queue = file.mock.calls[0][1] as { wanted: { asks: { wants: string }[] } };
    expect(queue.wanted.asks[0].wants).toBe('something to catch a bird alive');
    expect(player().pendingDream!.asked.made).toEqual([player().makeAsks![0].id]);
    expect(feedSaid()).toMatch(/went with you into sleep/);
  });

  it('with no key it waits, whole, and the person is told so', async () => {
    const ask = laySnare();
    vi.spyOn(IntelligenceClient, 'fileRest').mockResolvedValue({ status: 'NO_KEY' } as never);
    await RestDoor.file([], worldPort, playerPort, hubPort);
    expect(player().pendingDream).toBeUndefined();
    expect(player().makeAsks!.map(a => a.id)).toEqual([ask.id]);
    expect(feedSaid()).toMatch(/What you laid to be made waits/);
  });

  it('on return a yes is a technology in the hub, the thing in the vault, and the ask gone', async () => {
    const ask = laySnare();
    set(p => ({ ...p, attributes: { ...p.attributes, dexterity: 40 } as never, pendingDream: { batchId: 'b1', asked: { skills: [], weaves: [], gifts: [], sittings: [], made: [ask.id] } } }));
    vi.spyOn(IntelligenceClient, 'collectRest').mockResolvedValue({ status: 'OK', data: answer({ made: [snareWords(ask.id)] }) } as never);
    await RestDoor.collect(playerPort, hubPort);
    const made: ITech[] = useHubStore.getState().tech.made;
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: 'Reed Snare', inputs: [{ itemId: REED(), quantity: 2 }], by: player().id, wanted: 'something to catch a bird alive' });
    expect(player().makeAsks).toEqual([]);
    expect(player().pendingDream).toBeUndefined();
    expect(vault().map(i => i.name)).toEqual(['Reed Snare']);
    expect(vault()[0].tags).toContain('snare');
    expect(feedSaid()).toMatch(/Reed Snare: A loop of twisted reed that holds a small thing alive\. Nobody here had made one\. It is known here now/);
    expect(feedSaid()).toMatch(/Reed Snare is in your vault/);
    // And the hub saved it: the technology is on the hub's own record
    expect(JSON.stringify([...db.values()])).toContain(made[0].id);
  });

  it('a no gives back what was laid and settles nothing', async () => {
    const ask = laySnare('a sword');
    set(p => ({ ...p, pendingDream: { batchId: 'b1', asked: { skills: [], weaves: [], gifts: [], sittings: [], made: [ask.id] } } }));
    vi.spyOn(IntelligenceClient, 'collectRest').mockResolvedValue({ status: 'OK', data: answer({ made: [{ id: ask.id, makes: false, line: 'Reed bends. A sword does not.', name: '', is: '', tags: [], trade: '', station: '', tools: [] }] }) } as never);
    await RestDoor.collect(playerPort, hubPort);
    expect(useHubStore.getState().tech.made).toEqual([]);
    expect(player().makeAsks).toEqual([]);
    expect(vault().map(i => i.id).sort()).toEqual(ask.parts.map(i => i.id).sort());
    expect(feedSaid()).toMatch(/"a sword": Reed bends\. A sword does not\. What you laid is back in your vault\./);
  });

  it('a broken answer spoils nothing else: the ask waits, and one taken back while away is let go', async () => {
    const ask = laySnare();
    set(p => ({ ...p, pendingDream: { batchId: 'b1', asked: { skills: [], weaves: [], gifts: [], sittings: [], made: [ask.id, 'ask_taken_back'] } } }));
    vi.spyOn(IntelligenceClient, 'collectRest').mockResolvedValue({ status: 'OK', data: answer({ made: [snareWords(ask.id, { tags: ['snare', 'not_a_word_anywhere'] })] }) } as never);
    await RestDoor.collect(playerPort, hubPort);
    expect(useHubStore.getState().tech.made).toEqual([]);
    expect(player().makeAsks).toMatchObject([{ id: ask.id, tries: 1 }]);
    expect(player().pendingDream).toBeUndefined();
    expect(feedSaid()).toMatch(/It waits for your next rest/);
  });

  it('what a hub already holds is made at once from the door, unread until a rest, for what a making costs', async () => {
    const ask = laySnare();
    const { tech } = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    useHubStore.getState().applyTech({ kind: 'TECH_SETTLED', tech });
    const a = harvested(REED()), b = harvested(REED());
    inVault(a, b);
    const before = RestSystem.energyHeld(player());
    expect((await MakeDoor.makeNow(tech.id, [a.id, b.id], playerPort, hubPort)).ok).toBe(true);
    expect(vault()).toHaveLength(1);
    expect(vault()[0].isIdentified).toBe(false);
    expect(RestSystem.queueOf(player()).made.map(m => m.id)).toEqual([vault()[0].id]);
    expect(RestSystem.energyHeld(player())).toBeLessThan(before);
    expect(feedSaid()).toMatch(/Something came of it\. A rest will say what\./);
  });

  it('a hub loaded with technologies on its record makes them again: the registry is filled from the hub\'s tech', () => {
    const [x, y] = loosePair();
    const ask = layLoose();
    const tech = MakeAsk.techOf(ask, snareWords(ask.id), { by: 'p1', at: 1 });
    expect(TECH_WAYS[tech.id]).toBeUndefined();
    useHubStore.getState().applyTech({ kind: 'TECH', tech: { ...emptyTech(), made: [tech] } });
    expect(TECH_WAYS[tech.id]).toEqual(tech);
    expect(PairCraft.recipeFor(x, y)?.id).toBe(tech.id);
    // Settled twice is settled once
    useHubStore.getState().applyTech({ kind: 'TECH_SETTLED', tech }, { kind: 'TECH_SETTLED', tech });
    expect(useHubStore.getState().tech.made).toHaveLength(1);
  });
});

// =============================================================================
describe('on the screen, where a character lies down', () => {
  let host: HTMLDivElement;
  let root: Root;
  const buttons = () => [...host.querySelectorAll('button')] as HTMLButtonElement[];
  const button = (name: RegExp) => buttons().find(b => name.test(b.textContent ?? ''))!;
  const click = async (name: RegExp) => {
    expect(button(name), `a button ${name}`).toBeTruthy();
    await act(async () => { button(name).click(); await Promise.resolve(); });
  };
  const type = async (label: string, value: string) => {
    const box = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    expect(box, `a line for ${label}`).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });
  const mount = () => act(async () => { root.render(React.createElement(DowntimePanel, { place: 'BED' })); });

  it('asks both in words: what to study joins the stack, and what to make is laid with what is put in', async () => {
    const a = harvested(REED()), b = harvested(REED());
    inVault(a, b);
    await mount();
    expect(host.textContent).toMatch(/WHAT DO YOU WANT TO STUDY/);
    expect(host.textContent).toMatch(/WHAT DO YOU WANT TO MAKE/);

    await type('What do you want to study', 'how pigeons roost');
    await click(/ADD TO THE STACK/);
    expect(host.querySelector('[data-downtime-act]')?.textContent).toMatch(/sitting with how pigeons roost/);

    // Nothing is laid with no words or nothing put in
    expect(button(/LAY IT FOR THE NIGHT/).disabled).toBe(true);
    await type('What do you want to make', 'something to catch a bird alive');
    expect(button(/LAY IT FOR THE NIGHT/).disabled).toBe(true);
    const picks = buttons().filter(x => /^\+ /.test(x.textContent ?? ''));
    expect(picks).toHaveLength(2);
    await act(async () => { picks[0].click(); });
    await act(async () => { buttons().filter(x => /^\+ /.test(x.textContent ?? ''))[0].click(); });
    // What is put in says so in a word, never by colour alone
    expect(buttons().filter(x => /^IN: /.test(x.textContent ?? ''))).toHaveLength(2);
    await click(/LAY IT FOR THE NIGHT/);

    expect(player().makeAsks).toMatchObject([{ words: 'something to catch a bird alive', parts: [{ id: a.id }, { id: b.id }] }]);
    expect(vault()).toEqual([]);
    expect(host.querySelector('[data-make-laid]')?.textContent).toMatch(/LAID: "something to catch a bird alive", of /);
    await click(/TAKE BACK/);
    expect(player().makeAsks).toEqual([]);
    expect(vault()).toHaveLength(2);
  });

  it('components that already make something this hub knows offer it at once', async () => {
    const ask = laySnare();
    const { tech } = MakeAsk.settle(ask, snareWords(ask.id), steady, { by: 'p1', at: 1 });
    set(p => ({ ...p, makeAsks: [] }));
    useHubStore.getState().applyTech({ kind: 'TECH_SETTLED', tech });
    const a = harvested(REED()), b = harvested(REED());
    inVault(a, b);
    await mount();
    expect(button(/MAKE IT NOW/)).toBeFalsy();
    await act(async () => { buttons().filter(x => /^\+ /.test(x.textContent ?? ''))[0].click(); });
    // One reed is not the bill
    expect(button(/MAKE IT NOW/)).toBeFalsy();
    await act(async () => { buttons().filter(x => /^\+ /.test(x.textContent ?? ''))[0].click(); });
    await click(/THESE MAKE REED SNARE HERE ALREADY: MAKE IT NOW/);
    expect(vault()).toHaveLength(1);
    expect(vault().some(i => i.universalDefinitionId === tech.output.id)).toBe(true);
  });
});

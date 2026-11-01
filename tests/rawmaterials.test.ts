/**
 * THE RAW MATERIALS LEG BARS — registered before the leg was built (guardrail 1).
 * Test lines 60, 61, 62 and 45:
 *   60 a fresh origin raises a house and its first bench from raw logs and
 *      stone alone
 *   61 each transformation step adds something the raw material lacks, drawn
 *      deterministically from pools that grow with rarity and rank, with
 *      ranges, on buildings and furniture as on gear
 *   62 what a step added stays unknown until study, lore or the skill itself
 *      reveals it
 *   45 every gameplay material can be sourced, refined and consumed, and the
 *      gold audit balances over the full loop
 * Plus the one-way door (PLAN, the raw materials leg): finished houses, stored
 * rooms and pinned worlds do not change — the hashes below were captured from
 * the code BEFORE this leg touched anything — and a raw-built house reads apart
 * from a plank-built one in grayscale.
 */

import { RestSystem } from '../src/logic/systems/RestSystem';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();
vi.mock('../src/entities/data/VectorStore', () => ({
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
    signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IAffix, IItem, ItemType, Rarity, UniversalRank, MENTAL_ATTRIBUTES, ROOM_ACTING_STATS } from '../types';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, GEAR_RECIPES } from '../src/entities/economy/data/recipeDefinitions';
import { AFFIX_BATCHES } from '../src/entities/generation/packs/affixBatches';
import { AffixBank } from '../src/logic/content/AffixBank';
import { DreamingSystem } from '../src/entities/world/Dreaming';
import { CompositionSystem, fnv1a } from '../src/logic/economy/CompositionSystem';
import { MintRegistry } from '../src/logic/economy/MintRegistry';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { SourcingAudit } from '../src/logic/economy/SourcingAudit';
import { ProcessSystem, PROCESS_THEME, PROCESS_FAMILIES } from '../src/logic/systems/ProcessSystem';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { improvise } from '../src/logic/systems/ImprovisedCrafting';
import { LoadoutSystem } from '../src/entities/player/systems/LoadoutSystem';
import {
  IRoomState, emptyRoom, pickBill, answersTag, materialLabel, shellBillFor, ownerHasBench, roomProcessBonus, salvageFor,
  PIECE_BILLS, SHELL_BILLS
} from '../src/entities/hub/room';
import { ITemplate, SYSTEM_TEMPLATES, defaultSheet, templateBill, templateToRoom } from '../src/entities/hub/template';
import { composeRoom, ROOM_TILE, rawWallKind } from '../src/render/atoms/room';
import { composeHub, lotArt, HUB_GENRE } from '../src/render/atoms/hub';
import { buildPalette, grayscale, hashBytes } from '../src/render/atoms/atoms';
import { inspectItem, inspectBuiltRoom } from '../src/render/atoms/inspect';
import { LORE_FRAGMENTS } from '../src/entities/lore/LoreBible';
import { HubGenerator } from '../src/entities/hub/HubGenerator';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { runGoldenCheck } from '../src/entities/world/goldens';
import { useHubStore, worldDay } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { Rng } from '../src/logic/rng/DeterministicRNG';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const WALL_DIFF_MIN = 0.25;          // raw vs worked wall: share of wall atoms differing in grayscale
const WALL_BLOCK_DIFF_MIN = 0.15;    // ...and of 5×5 blocks differing once averaged: the read at game scale
const WALL_BLOCK_GRAY_STEP = 12;     // a block "differs" past this much average gray
const FACADE_DIFF_MIN = 0.15;        // the street: raw facade vs plank facade, share of lot atoms

// Captured from the code at commit 1128831, before this leg changed anything.
const STORED_ROOM_HASHES: Record<string, number> = {
  crf_plank: 488378537,
  crf_stone_block: 3251782806,
  crf_iron_ingot: 2156387344,
  crf_glass: 2163058375
};
const STORED_MIXED_ROOM_HASH = 277033056;
const STORED_TEMPLATE_HASHES: Record<string, number> = {
  "Keeper's House": 3226989047,
  'Carpenter Mill': 1904892013,
  'Market Stall': 2817067909
};
// Recaptured on purpose for D74: the city moved onto the real chunk, from its manifest, with roads and plots.
const STORED_CITY_HASH = 388549729;
const PINNED_PACK_HASHES: Record<number, string> = { 1: 'da2b84b8', 2: '3f842e24' };
const PINNED_DREAM = ['Mire-Cured', 'Bank-Honored', 'Spore-Fed'];
const LORE_FRAGMENT_COUNT = 8;       // a chest's rng.pick must keep landing on the same fragment

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const FOOT = { width: 4, height: 4 };

const defOf = (defId: string) => (RESOURCE_DEFINITIONS[defId] ?? CRAFTED_DEFINITIONS[defId]) as any;
const mint = (defId: string, key: string, opts?: any): IItem => ItemFactory.createResourceItem(defOf(defId), Rng.fromKey(key), opts);
const many = (defId: string, n: number, key: string) => Array.from({ length: n }, (_, i) => mint(defId, `${key}:${i}`));

const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const stash = () => player().bank.stashTabs[0].items;
const setStash = (items: IItem[], gold = 30_000) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, gold, stashTabs: [{ name: 'MAIN', items }] } }
}));
const addStash = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'MAIN', items: [...s.player.bank.stashTabs[0].items, ...items] }] } }
}));
const finishBuilds = async () => {
  useHubStore.setState(s => ({ buildJobs: s.buildJobs.map(j => ({ ...j, finishesAt: 0 })) }));
  await hub().resolveBuilds();
};
const finishCrafts = async () => {
  useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => ({ ...j, finishesAt: 0 })) }));
  await hub().resolveCrafts();
};
const addition = (id: string, stats: Record<string, number>): IAffix => ({ id, name: id, type: 'PREFIX', stats, tier: 1 });
const processIds = () => new Set(AffixBank.current().entries.filter(e => e.theme === PROCESS_THEME).map(e => e.id));
const additionsOf = (item: IItem) => (item.affixes || []).filter(a => processIds().has(a.id));

let hubCounter = 0;
async function freshHub(): Promise<string[]> {
  useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as any);
  await hub().loadHub(`hub_raw_${++hubCounter}`);
  return hub().lots.map(l => l.id);
}

/** A workshop standing from raw alone, on a lot of its own, its bench placed. */
async function rawWorkshop(): Promise<string> {
  const [lotId] = await freshHub();
  setStash([...many('res_tree_log', 6, 'rw:log')]);
  expect(await hub().buyLot(lotId)).toBe(true);
  expect(await hub().buildStructure(lotId, 'WORKSHOP')).toBe(true);
  await finishBuilds();
  const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
  expect(bench).toBeTruthy();
  expect((await hub().placeItem(lotId, bench.id, 6, 3, false)).ok).toBe(true);
  return lotId;
}

const craftOne = async (lotId: string, recipeId: string) => {
  expect(await hub().queueCraft(lotId, recipeId), recipeId).toBe(true);
  await finishCrafts();
};

beforeEach(() => {
  db.clear();
  localStorage.clear();
  MintRegistry.reset();
  useIdentityStore.setState({ certificate: CERT('uid_raw') });
  usePlayerStore.getState().initializeSession(CERT('uid_raw'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// LINE 60 — raw logs and stone raise a house and its first bench
// -----------------------------------------------------------------------------

describe('line 60: D24, logs and stone answer the building bill', () => {
  it('logs and dense stone carry the building tag; pebbles stay out', () => {
    expect(RESOURCE_DEFINITIONS['res_tree_log'].tags).toContain('building');
    expect(RESOURCE_DEFINITIONS['res_rock_small'].tags).toContain('building');
    expect(RESOURCE_DEFINITIONS['res_pebbles'].tags).not.toContain('building');
  });

  it('bills stay by tag: a log pays a wall, a stone pays a wall, a pebble is refused', () => {
    expect(pickBill([PIECE_BILLS.WALL], [mint('res_tree_log', 'b:log')]).ok).toBe(true);
    expect(pickBill([PIECE_BILLS.WALL], [mint('res_rock_small', 'b:rock')]).ok).toBe(true);
    expect(pickBill([PIECE_BILLS.WALL], [mint('res_pebbles', 'b:peb')]).ok).toBe(false);
  });

  it('a log minted before this leg, its stored tags older than the rule, still answers the bill', () => {
    const old = { ...mint('res_tree_log', 'b:old'), tags: ['flora', 'wood'] };
    expect(answersTag(old, 'building')).toBe(true);
    expect(pickBill([PIECE_BILLS.WALL], [old]).ok).toBe(true);
    expect(answersTag({ ...mint('res_pebbles', 'b:oldp'), tags: ['mineral', 'stone'] }, 'building')).toBe(false);
  });
});

describe('line 60: D25, the first bench gives way on the metal line', () => {
  it('with no bench anywhere the WORKSHOP bill asks for building alone; with one, it asks for metal again', () => {
    expect(shellBillFor('WORKSHOP', false)).toEqual([{ tag: 'building', count: 6 }]);
    expect(shellBillFor('WORKSHOP', true)).toEqual(SHELL_BILLS.WORKSHOP);
    expect(SHELL_BILLS.WORKSHOP.some(l => l.tag === 'metal')).toBe(true);
    // the other shells never knew about any of this
    expect(shellBillFor('HOUSE', false)).toEqual(SHELL_BILLS.HOUSE);
    expect(shellBillFor('VENDOR', false)).toEqual(SHELL_BILLS.VENDOR);
  });

  it('a bench held, placed, listed or rising anywhere counts as having one', () => {
    const owner = 'me';
    const bench = mint('stn_bench', 'b:bench');
    const lot = (over: any = {}) => ({ id: 'L', ownerId: owner, structureType: 'EMPTY', shopListings: [], ...over });
    const base = { lots: [lot()], rooms: {}, jobs: [], stash: [] as IItem[] };
    expect(ownerHasBench(owner, base)).toBe(false);
    expect(ownerHasBench(owner, { ...base, stash: [bench] })).toBe(true);
    expect(ownerHasBench(owner, { ...base, lots: [lot({ structureType: 'WORKSHOP' })] })).toBe(true);
    expect(ownerHasBench(owner, { ...base, lots: [lot({ shopListings: [{ item: bench, price: 1 }] })] })).toBe(true);
    expect(ownerHasBench(owner, { ...base, jobs: [{ lotId: 'L', kind: 'SHELL', structureType: 'WORKSHOP', applied: false }] })).toBe(true);
    const room = emptyRoom('L', FOOT, 'crf_plank');
    room.placements.push({ id: 'p', item: bench, x: 2, y: 2, rotated: false, placedBy: owner, at: 0 });
    expect(ownerHasBench(owner, { ...base, rooms: { L: room } })).toBe(true);
    // someone else's bench is not yours
    expect(ownerHasBench(owner, { ...base, lots: [lot({ ownerId: 'other', structureType: 'WORKSHOP' })] })).toBe(false);
  });

  it('a plan raising a first WORKSHOP drops the same line, and only then', () => {
    const tpl = SYSTEM_TEMPLATES.find(t => t.structureType === 'WORKSHOP')!;
    const sheet = defaultSheet(tpl);
    expect(templateBill(tpl, sheet).tagLines.some(l => l.tag === 'metal')).toBe(true);
    expect(templateBill(tpl, sheet, true).tagLines.some(l => l.tag === 'metal')).toBe(false);
  });
});

describe('line 60: played through the store, from raw alone', () => {
  it('a stash of logs and stone raises a house: the walls are what paid for them', async () => {
    const [lotId] = await freshHub();
    setStash([...many('res_tree_log', 2, 'h:log'), ...many('res_rock_small', 2, 'h:rock')]);
    await hub().buyLot(lotId);
    expect(await hub().buildStructure(lotId, 'HOUSE')).toBe(true);
    expect(stash().length).toBe(0); // consumed exactly once, at queue
    await finishBuilds();
    await hub().resolveBuilds();
    const room = hub().rooms[lotId];
    expect(hub().lots.find(l => l.id === lotId)!.structureType).toBe('HOUSE');
    expect(['res_tree_log', 'res_rock_small']).toContain(room.shellMaterialDefId);
  });

  it('logs alone raise a first WORKSHOP: no metal, a bench minted, the bench works', async () => {
    const [lotId] = await freshHub();
    setStash(many('res_tree_log', 7, 'w:log'));
    await hub().buyLot(lotId);
    expect(await hub().buildStructure(lotId, 'WORKSHOP')).toBe(true);
    expect(stash().length).toBe(1); // six consumed, one log held back for the mill
    await finishBuilds();
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench');
    expect(bench).toBeTruthy();
    expect(bench!.affixes).toEqual([]); // raw walls hand on nothing: nothing was worked

    expect((await hub().placeItem(lotId, bench!.id, 6, 3, false)).ok).toBe(true);
    await craftOne(lotId, 'recipe_plank');
    expect(stash().filter(i => i.universalDefinitionId === 'crf_plank').length).toBe(2);
  });

  it('the second WORKSHOP asks for its metal again, and refuses without it', async () => {
    const lotA = await rawWorkshop();
    const lotB = hub().lots.find(l => l.id !== lotA)!.id;
    await hub().buyLot(lotB);
    setStash(many('res_tree_log', 6, 'w2:log'));
    expect(await hub().buildStructure(lotB, 'WORKSHOP')).toBe(false);
    expect(stash().length).toBe(6); // a refused shell consumes nothing
    addStash(many('res_iron_vein', 2, 'w2:ore'));
    expect(await hub().buildStructure(lotB, 'WORKSHOP')).toBe(true);
    expect(stash().length).toBe(0);
  });

  it('the builder names the material: holding planks and logs, the chosen one pays', async () => {
    const [lotId] = await freshHub();
    setStash([...many('crf_plank', 4, 'p:pl'), ...many('res_tree_log', 4, 'p:log')]);
    await hub().buyLot(lotId);
    expect(await hub().buildStructure(lotId, 'HOUSE', 'res_tree_log')).toBe(true);
    expect(stash().every(i => i.universalDefinitionId === 'crf_plank')).toBe(true);
    await finishBuilds();
    expect(hub().rooms[lotId].shellMaterialDefId).toBe('res_tree_log');
  });

  it('a plan rises from raw too: logs on the sheet, a first WORKSHOP with no metal', async () => {
    const [lotId] = await freshHub();
    const tpl: ITemplate = { ...SYSTEM_TEMPLATES[1], pieces: [{ kind: 'DOOR', x: 8, y: 5 }, { kind: 'WALL', x: 4, y: 4 }], name: 'Log Hall' };
    const plan = { ...mint('crf_paper', 'tp:paper'), type: ItemType.TEMPLATE, templateData: tpl } as any;
    setStash([plan, ...many('res_tree_log', 8, 'tp:log')]);
    await hub().buyLot(lotId);
    const res = await hub().applyTemplate(lotId, plan.id, { WALL: 'res_tree_log', DOOR: 'res_tree_log', WINDOW: 'crf_glass', zones: {} });
    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
    await finishBuilds();
    await finishBuilds();
    const room = hub().rooms[lotId];
    expect(room.shellMaterialDefId).toBe('res_tree_log');
    expect(room.pieces.length).toBe(2);
    expect(stash().some(i => i.universalDefinitionId === 'stn_bench')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// LINE 61 — the banks: the additions obey the batch law
// -----------------------------------------------------------------------------

describe('line 61: the additions are banked under the existing batch law', () => {
  const banked = () => AffixBank.current().entries.filter(e => e.theme === PROCESS_THEME);

  it('they ship as a NAMES run and an EFFECTS run, and the whole bank still compiles', () => {
    expect(AFFIX_BATCHES.length).toBeGreaterThanOrEqual(4);
    const kinds = AFFIX_BATCHES.slice(2).map(b => b.kind);
    expect(kinds[0]).toBe('NAMES');
    expect(kinds[1]).toBe('EFFECTS');
    expect(AFFIX_BATCHES[2].names!.every(n => !(n as any).statModifiers)).toBe(true);
    expect(AffixBank.compile(AFFIX_BATCHES).ok).toBe(true);
  });

  it('D22 holds the door: a process entry promising a mental stat refuses its whole batch', () => {
    const prior = AffixBank.packAt(AFFIX_BATCHES.length - 1)!.entries;
    const verdict = AffixBank.validateBatch({
      runId: 'bad', kind: 'EFFECTS', model: 'test', ranAt: 0,
      effects: [{ id: AFFIX_BATCHES[AFFIX_BATCHES.length - 1].effects![0].id, statModifiers: { intelligence: [1, 2] } }]
    }, prior.map(e => ({ ...e, statModifiers: undefined })));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/gear doesn't think/);
  });

  it('every family has entries in every tier, every entry defined, each with a gear half and a room half', () => {
    expect(PROCESS_FAMILIES.length).toBeGreaterThanOrEqual(7);
    for (const family of PROCESS_FAMILIES) {
      const entries = banked().filter(e => e.allowedTags.includes(ProcessSystem.familyTag(family)));
      for (const tier of [1, 2, 3, 4]) {
        expect(entries.some(e => e.tier === tier), `${family} tier ${tier}`).toBe(true);
      }
    }
    for (const e of banked()) {
      expect(e.statModifiers, e.id).toBeTruthy();
      const stats = Object.keys(e.statModifiers!);
      expect(stats.some(s => (ROOM_ACTING_STATS as readonly string[]).includes(s)), `${e.id} room half`).toBe(true);
      expect(stats.some(s => !(ROOM_ACTING_STATS as readonly string[]).includes(s)), `${e.id} gear half`).toBe(true);
      expect(stats.some(s => (MENTAL_ATTRIBUTES as readonly string[]).includes(s)), `${e.id} mental`).toBe(false);
    }
  });

  it('downside pays for upside here too: some additions carry a negative offset (D19)', () => {
    expect(banked().filter(e => Object.values(e.statModifiers!).some(([lo]) => lo < 0)).length).toBeGreaterThanOrEqual(5);
  });
});

describe('line 61: pools grow with rarity and rank, draws are keyed, ranges hold', () => {
  const pack = () => AffixBank.current();
  const RANKS = [UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C, UniversalRank.B, UniversalRank.A, UniversalRank.S];
  const RARITIES = [Rarity.COMMON, Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY];

  it('holding rarity, the pool only grows with rank, and it does grow', () => {
    for (const family of PROCESS_FAMILIES) {
      const sizes = RANKS.map(r => ProcessSystem.poolFor(pack(), family, r, Rarity.COMMON).map(e => e.id));
      sizes.forEach((ids, i) => { if (i > 0) expect(ids.length).toBeGreaterThanOrEqual(sizes[i - 1].length); });
      sizes.forEach((ids, i) => { if (i > 0) sizes[i - 1].forEach(id => expect(ids).toContain(id)); }); // a superset, not a swap
      expect(sizes[sizes.length - 1].length).toBeGreaterThan(sizes[0].length);
    }
  });

  it('holding rank, the pool only grows with rarity, and it does grow', () => {
    for (const family of PROCESS_FAMILIES) {
      const sizes = RARITIES.map(r => ProcessSystem.poolFor(pack(), family, UniversalRank.F, r).map(e => e.id));
      sizes.forEach((ids, i) => { if (i > 0) sizes[i - 1].forEach(id => expect(ids).toContain(id)); });
      expect(sizes[sizes.length - 1].length).toBeGreaterThan(sizes[0].length);
    }
  });

  it('rank and rarity both count: an E-rank uncommon opens more than either alone', () => {
    const both = ProcessSystem.openTier(UniversalRank.E, Rarity.UNCOMMON);
    expect(both).toBeGreaterThan(ProcessSystem.openTier(UniversalRank.E, Rarity.COMMON));
    expect(both).toBeGreaterThan(ProcessSystem.openTier(UniversalRank.F, Rarity.UNCOMMON));
  });

  it('the same key and pack draw the same record, byte for byte', () => {
    for (const family of PROCESS_FAMILIES) {
      const a = ProcessSystem.draw(pack(), family, UniversalRank.E, Rarity.COMMON, Rng.fromKey(`k:${family}`));
      const b = ProcessSystem.draw(pack(), family, UniversalRank.E, Rarity.COMMON, Rng.fromKey(`k:${family}`));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('every number falls inside its banked range, and the range is really walked', () => {
    const seen = new Map<string, Set<number>>();
    for (let i = 0; i < 300; i++) {
      const got = ProcessSystem.draw(pack(), 'carpentry', UniversalRank.F, Rarity.COMMON, Rng.fromKey(`range:${i}`));
      const entry = pack().entries.find(e => e.id === got.id)!;
      expect(got.name).toBe(entry.name);
      expect(got.type).toBe(entry.type);
      for (const [stat, value] of Object.entries(got.stats)) {
        const [lo, hi] = entry.statModifiers![stat];
        expect(value).toBeGreaterThanOrEqual(lo);
        expect(value).toBeLessThanOrEqual(hi);
        const key = `${got.id}.${stat}`;
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key)!.add(value);
      }
    }
    expect([...seen.values()].some(values => values.size >= 2)).toBe(true);
  });

  it('a name-only entry never reaches a pool: a step always adds something that acts', () => {
    for (const family of PROCESS_FAMILIES) {
      for (const e of ProcessSystem.poolFor(pack(), family, UniversalRank.S, Rarity.LEGENDARY)) {
        expect(e.statModifiers).toBeTruthy();
      }
    }
  });
});

// -----------------------------------------------------------------------------
// LINE 61 — through the real bench: each step adds, the chain carries
// -----------------------------------------------------------------------------

/** One unit of every input a recipe asks for, then the real door. */
async function runRecipe(lotId: string, recipeId: string, key: string): Promise<IItem[]> {
  const recipe = RECIPE_DEFINITIONS[recipeId] ?? GEAR_RECIPES[recipeId];
  const inputs = recipe.inputs.flatMap(r => many(r.itemId, r.quantity, `${key}:${r.itemId}`));
  setStash(inputs);
  await craftOne(lotId, recipeId);
  return stash();
}

describe('line 61: each transformation step adds something the raw material lacks', () => {
  it('a raw material carries no addition at all', () => {
    for (const defId of Object.keys(RESOURCE_DEFINITIONS)) {
      expect(additionsOf(mint(defId, `raw:${defId}`))).toEqual([]);
    }
  });

  it('every recipe at the bench: the output carries at least one banked addition its inputs lacked', async () => {
    const lotId = await rawWorkshop();
    const ids = [...Object.keys(RECIPE_DEFINITIONS), ...Object.values(GEAR_RECIPES).filter(r => r.requiredFacility === 'WORKSHOP').map(r => r.id)];
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const id of ids) {
      const out = await runRecipe(lotId, id, `every:${id}`);
      expect(out.length, id).toBeGreaterThan(0);
      for (const item of out) expect(additionsOf(item).length, `${id} -> ${item.name}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the family is the step: milling draws from carpentry, smelting from smelting', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'fam:p');
    const [ingot] = await runRecipe(lotId, 'recipe_ingot', 'fam:i');
    const tagOf = (a: IAffix) => AffixBank.current().entries.find(e => e.id === a.id)!.allowedTags;
    expect(tagOf(additionsOf(plank)[0])).toContain(ProcessSystem.familyTag('carpentry'));
    expect(tagOf(additionsOf(ingot)[0])).toContain(ProcessSystem.familyTag('smelting'));
  });

  it('the chain carries: log to plank to table, each step adding, the table holding them all', async () => {
    const lotId = await rawWorkshop();
    setStash(many('res_tree_log', 2, 'chain:log'));
    await craftOne(lotId, 'recipe_plank');
    await craftOne(lotId, 'recipe_plank');
    const planks = stash().filter(i => i.universalDefinitionId === 'crf_plank');
    expect(planks.length).toBe(4);
    const planksAdded = new Set(planks.slice(0, 3).flatMap(additionsOf).map(a => a.id));
    await craftOne(lotId, 'recipe_table');
    const table = stash().find(i => i.universalDefinitionId === 'stn_table')!;
    const onTable = additionsOf(table).map(a => a.id);
    planksAdded.forEach(id => expect(onTable).toContain(id));
    expect(table.affixes.length).toBeGreaterThanOrEqual(1);
  });

  it('a dreamed input carries too: what the Seed dreamed into a log rides the plank', async () => {
    const lotId = await rawWorkshop();
    const dream: IAffix = { id: 'res_ovg_mirecured', name: 'Mire-Cured', type: 'PREFIX', stats: { max_health: 5 }, tier: 1 };
    setStash([mint('res_tree_log', 'dreamed', { dreamAffix: dream })]);
    await craftOne(lotId, 'recipe_plank');
    for (const plank of stash()) expect(plank.affixes.map(a => a.id)).toContain('res_ovg_mirecured');
  });

  it('the name says so: a worked good wears its addition in its name', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'named');
    const added = additionsOf(plank)[0];
    expect(plank.name).toContain(added.name);
    expect(plank.name).toContain('Cut Plank');
    expect(plank.universalDefinitionId).toBe('crf_plank'); // still answers everything a plank answers
  });

  it('an addition changes the record, never the price: chain sets worth, players work out the rest', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'price');
    expect(plank.value).toBe(CompositionSystem.priceOf(plank.composition!));
  });

  it('the floor stays the floor: improvised work is not a process and adds nothing', () => {
    const made = improvise('improv_club', [mint('res_rock_small', 'imp:r'), mint('res_tree_log', 'imp:l')], 'imp:key');
    expect(made.ok).toBe(true);
    expect(additionsOf(made.item!)).toEqual([]);
  });

  it('a job carries the pack it was queued under: a later batch cannot change what it mints', async () => {
    const lotId = await rawWorkshop();
    setStash(many('res_tree_log', 1, 'pin:log'));
    expect(await hub().queueCraft(lotId, 'recipe_plank')).toBe(true);
    const job = hub().craftingJobs.find(j => j.recipeId === 'recipe_plank')!;
    expect(job.processPack).toBe(AffixBank.version());
  });

  it('a job queued before this law mints what it always would have: no addition', async () => {
    const lotId = await rawWorkshop();
    setStash(many('res_tree_log', 1, 'old:log'));
    expect(await hub().queueCraft(lotId, 'recipe_plank')).toBe(true);
    useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => { const { processPack, ...rest } = j; return rest; }) }));
    await finishCrafts();
    for (const plank of stash()) expect(additionsOf(plank)).toEqual([]);
  });
});

describe('line 61: the additions reach gear', () => {
  it('a made weapon draws its own addition and acts on the gear half alone', async () => {
    const lotId = await rawWorkshop();
    const [maul] = await runRecipe(lotId, 'recipe_iron_maul', 'gear:maul');
    const added = additionsOf(maul);
    expect(added.length).toBeGreaterThanOrEqual(1);
    // the room half stays on the record of the affix, and off the acting stats of a weapon
    for (const stat of ROOM_ACTING_STATS) expect(maul.stats[stat]).toBeUndefined();
    const gearStat = Object.keys(added[0].stats).find(s => !(ROOM_ACTING_STATS as readonly string[]).includes(s))!;
    expect(gearStat).toBeTruthy();
    expect(typeof maul.stats[gearStat]).toBe('number');
  });

  it('components hand their additions on to the weapon they make', async () => {
    const lotId = await rawWorkshop();
    setStash([...many('res_tree_log', 1, 'hand:l'), ...many('res_iron_vein', 2, 'hand:o')]);
    await craftOne(lotId, 'recipe_plank');
    await craftOne(lotId, 'recipe_ingot');
    const planks = stash().filter(i => i.universalDefinitionId === 'crf_plank');
    const ingot = stash().find(i => i.universalDefinitionId === 'crf_iron_ingot')!;
    const wanted = [...planks, ingot].flatMap(additionsOf).map(a => a.id);
    await craftOne(lotId, 'recipe_iron_maul');
    const maul = stash().find(i => i.type === ItemType.GEAR)!;
    wanted.forEach(id => expect(maul.affixes.map(a => a.id)).toContain(id));
  });
});

describe('line 61: the additions reach furniture and buildings, and they act', () => {
  const worked = (id: string, stats: Record<string, number>, defId = 'crf_plank') => {
    const item = mint(defId, `w:${id}`);
    return { ...item, affixes: [addition(id, stats)] };
  };

  it('a piece records what its material carried; the shell too; salvage hands it back', async () => {
    const [lotId] = await freshHub();
    const shell = Array.from({ length: 4 }, (_, i) => ({ ...worked('prc_test_shell', { upkeep_discount_pct: 3 }), id: `shell_${i}` }));
    setStash([...shell, worked('prc_test_wall', { upkeep_discount_pct: 2 })]);
    await hub().buyLot(lotId);
    expect(await hub().buildStructure(lotId, 'HOUSE', 'crf_plank')).toBe(true);
    await finishBuilds();
    const room = () => hub().rooms[lotId];
    expect(room().shellInherited?.map(a => a.id)).toEqual(['prc_test_shell']);

    const wall = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    expect((await hub().queuePiece(lotId, 'WALL', 4, 4, wall.id)).ok).toBe(true);
    await finishBuilds();
    const piece = room().pieces[0];
    expect(piece.inherited?.map(a => a.id)).toEqual(['prc_test_wall']);

    await hub().demolishPiece(lotId, piece.id);
    const back = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    expect(back.affixes.map(a => a.id)).toEqual(['prc_test_wall']);
    expect(back.composition!.materials[0].origin).toBe('SALVAGE');
  });

  it('a raw-built room records nothing: it had nothing to inherit', async () => {
    const [lotId] = await freshHub();
    setStash(many('res_tree_log', 4, 'nothing'));
    await hub().buyLot(lotId);
    await hub().buildStructure(lotId, 'HOUSE');
    await finishBuilds();
    const room = hub().rooms[lotId];
    expect(room.shellInherited ?? []).toEqual([]);
    expect(roomProcessBonus(room)).toEqual({ upkeepDiscountPct: 0, craftSpeedPct: 0, additions: 0 });
  });

  it('a plan hands each class its own: shell, pieces and floors all record', async () => {
    const [lotId] = await freshHub();
    const tpl: ITemplate = {
      ...SYSTEM_TEMPLATES[0], name: 'Inherit Hall',
      pieces: [{ kind: 'WALL', x: 4, y: 4 }, { kind: 'DOOR', x: 6, y: 4 }],
      zones: [{ name: 'Yard', tiles: [{ x: 2, y: 2 }], minArea: 1 }]
    };
    const plan = { ...mint('crf_paper', 'pi:paper'), type: ItemType.TEMPLATE, templateData: tpl } as any;
    const planks = Array.from({ length: 5 }, (_, i) => ({ ...worked('prc_test_w', { upkeep_discount_pct: 1 }), id: `pl_${i}` }));
    const door = worked('prc_test_d', { upkeep_discount_pct: 1 }, 'res_tree_log');
    const floor = worked('prc_test_f', { upkeep_discount_pct: 1 }, 'crf_stone_block');
    setStash([plan, ...planks, door, floor]);
    await hub().buyLot(lotId);
    const res = await hub().applyTemplate(lotId, plan.id, { WALL: 'crf_plank', DOOR: 'res_tree_log', WINDOW: 'crf_glass', zones: { Yard: 'crf_stone_block' } });
    expect(res.reason).toBeUndefined();
    await finishBuilds(); await finishBuilds();
    const room = hub().rooms[lotId];
    expect(room.shellInherited?.map(a => a.id)).toEqual(['prc_test_w']);
    expect(room.pieces.find(p => p.kind === 'WALL')!.inherited?.map(a => a.id)).toEqual(['prc_test_w']);
    expect(room.pieces.find(p => p.kind === 'DOOR')!.inherited?.map(a => a.id)).toEqual(['prc_test_d']);
    expect(room.floorZones![0].inherited?.map(a => a.id)).toEqual(['prc_test_f']);
  });

  it('the first bench inherits its shell: plank walls mint a bench that carries them', async () => {
    const [lotId] = await freshHub();
    const planks = Array.from({ length: 6 }, (_, i) => ({ ...worked('prc_test_bench', { craft_speed_pct: 5 }), id: `bp_${i}` }));
    setStash(planks);
    await hub().buyLot(lotId);
    await hub().buildStructure(lotId, 'WORKSHOP');
    await finishBuilds();
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
    expect(bench.affixes.map(a => a.id)).toEqual(['prc_test_bench']);
    expect(bench.name).toContain('Work Bench');
  });

  it('roomProcessBonus sums the room: shell, pieces, floors and whatever stands in it', () => {
    const room = emptyRoom('L', FOOT, 'crf_plank');
    room.shellInherited = [addition('a', { upkeep_discount_pct: 3, defense: 9 })];
    room.pieces.push({ id: 'p', kind: 'WALL', x: 2, y: 2, materialDefId: 'crf_plank', builtBy: 'x', at: 0, inherited: [addition('b', { upkeep_discount_pct: 2 })] });
    room.floorZones = [{ name: 'Z', tiles: [], materialDefId: 'crf_plank', inherited: [addition('c', { craft_speed_pct: 4 })] }];
    room.placements.push({ id: 'pl', item: { ...mint('stn_table', 'tbl'), affixes: [addition('d', { craft_speed_pct: 6, upkeep_discount_pct: -1 })] }, x: 4, y: 4, rotated: false, placedBy: 'x', at: 0 });
    const bonus = roomProcessBonus(room);
    expect(bonus.upkeepDiscountPct).toBe(4);
    expect(bonus.craftSpeedPct).toBe(10);
    expect(bonus.additions).toBe(4);
  });

  it('a room cannot stack itself out of the economy: both numbers stop at their caps', () => {
    const room = emptyRoom('L', FOOT, 'crf_plank');
    room.shellInherited = [addition('a', { upkeep_discount_pct: 500, craft_speed_pct: 500 })];
    const bonus = roomProcessBonus(room);
    expect(bonus.upkeepDiscountPct).toBeLessThanOrEqual(40);
    expect(bonus.craftSpeedPct).toBeLessThanOrEqual(30);
  });

  it('furniture acts: a placed table with a speed addition really shortens the bench clock', async () => {
    const lotId = await rawWorkshop();
    let round = 0;
    const clock = async () => {
      setStash(many('res_tree_log', 1, `clock:${round++}`));
      const t0 = Date.now();
      await hub().queueCraft(lotId, 'recipe_plank');
      const job = hub().craftingJobs[hub().craftingJobs.length - 1];
      await finishCrafts();
      return Math.round((job.finishesAt - t0) / 1000);
    };
    const before = await clock();
    addStash([{ ...mint('stn_table', 'fast'), affixes: [addition('prc_test_fast', { craft_speed_pct: 20 })] }]);
    const table = stash().find(i => i.universalDefinitionId === 'stn_table')!;
    expect((await hub().placeItem(lotId, table.id, 2, 2, false)).ok).toBe(true);
    const after = await clock();
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it('a building acts: a house whose walls inherited a discount is charged less upkeep', async () => {
    const charged = async (affixes: IAffix[]) => {
      const [lotId] = await freshHub();
      setStash(many('crf_plank', 4, `up:${affixes.length}`).map(p => ({ ...p, affixes })));
      await hub().buyLot(lotId);
      await hub().buildStructure(lotId, 'HOUSE');
      await finishBuilds();
      const gold = player().bank.gold;
      await hub().resolveUpkeep(worldDay() + 20);
      return gold - player().bank.gold;
    };
    const plain = await charged([]);
    const discounted = await charged([addition('prc_test_upkeep', { upkeep_discount_pct: 30 })]);
    expect(plain).toBeGreaterThan(0);
    expect(discounted).toBeLessThan(plain);
  });

  it('an addition acts whether or not anybody has studied it (D19)', () => {
    const room = emptyRoom('L', FOOT, 'crf_plank');
    room.shellInherited = [addition('prc_unknown', { upkeep_discount_pct: 3 })];
    expect(LoadoutSystem.isAffixStudied(player(), 'prc_unknown')).toBe(false);
    expect(roomProcessBonus(room).upkeepDiscountPct).toBe(3);
  });
});

describe('found in play (the fresh origin): small truths the first bars missed', () => {
  it('a step whose whole pool is already on the good works an addition deeper: it still adds', () => {
    const pack = AffixBank.current();
    const rng = () => Rng.fromKey('deeper');
    const pool = ProcessSystem.poolFor(pack, 'carpentry', UniversalRank.F, Rarity.COMMON);
    const carried: IAffix[] = pool.map(e => ({ id: e.id, name: e.name, type: e.type, stats: { craft_speed_pct: 1 }, tier: e.tier }));
    const after = ProcessSystem.stepAffixes(pack, 'carpentry', 1, carried, rng());
    expect(after.length).toBe(carried.length);
    expect(after.some(a => (a.stats.craft_speed_pct ?? 0) !== 1 || Object.keys(a.stats).length > 1)).toBe(true);
    expect(carried.every(a => a.stats.craft_speed_pct === 1)).toBe(true); // the components keep their own record
  });

  it('a name-only dream, studied in a wall, says the bank has not written it yet', () => {
    const room = emptyRoom('L', FOOT, 'res_rock_small');
    room.shellInherited = [{ id: 'res_rui_vaultaged', name: 'Vault-Aged', type: 'PREFIX', stats: {}, tier: 1 }];
    usePlayerStore.setState(s => ({ player: StudySystem.revealAffixes(s.player, 'furniture', room.shellInherited!) }));
    const said = inspectBuiltRoom(room, player())!.rows.map(r => r.join(' ')).join(' ');
    expect(said).toMatch(/not yet written/);
  });

  it('a material picker names the definition, not whichever item came first, and says raw', () => {
    expect(materialLabel('res_tree_log')).toBe('Hardwood Log (raw)');
    expect(materialLabel('crf_plank')).toBe('Cut Plank');
  });
});

// -----------------------------------------------------------------------------
// LINE 62 — through play: study, lore, the skill itself
// -----------------------------------------------------------------------------

describe('line 62: what a step added stays unknown', () => {
  it('a fresh plank says something was worked into it, and not one number', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'blind');
    const added = additionsOf(plank)[0];
    const card = inspectItem(plank, player());
    const line = card.rows.find(([k]) => k === 'Affix')!;
    expect(line[1]).toMatch(/unstudied/);
    for (const stat of Object.keys(added.stats)) expect(line[1]).not.toContain(stat.replace(/_/g, ' '));
  });

  it('a made weapon\'s sheet stays blind to the step and acts regardless', async () => {
    const lotId = await rawWorkshop();
    const [maul] = await runRecipe(lotId, 'recipe_iron_maul', 'blindgear');
    const added = additionsOf(maul)[0];
    const gearStat = Object.keys(added.stats).find(s => !(ROOM_ACTING_STATS as readonly string[]).includes(s))!;
    const visible = LoadoutSystem.visibleItemStats(maul, player());
    expect(visible[gearStat] ?? 0).not.toBe(maul.stats[gearStat]);
  });

  it('a room\'s card is blind the same way: it counts what is in the walls and says no number', () => {
    const room = emptyRoom('L', FOOT, 'crf_plank');
    room.shellInherited = [addition('prc_blind', { upkeep_discount_pct: 3 })];
    const card = inspectBuiltRoom(room, player());
    const said = card!.rows.map(r => r.join(' ')).join(' ');
    expect(said).toMatch(/unstudied/);
    expect(said).not.toMatch(/upkeep discount|\+3/);
  });

  it('a raw house says it is raw, and has no riddle to read', () => {
    const card = inspectBuiltRoom(emptyRoom('L', FOOT, 'res_tree_log'), player());
    const said = card!.rows.map(r => r.join(' ')).join(' ');
    expect(said).toMatch(/Hardwood Log/);
    expect(said).toMatch(/raw/i);
    expect(said).not.toMatch(/unstudied/);
  });
});

describe('line 62: study reveals it', () => {
  it('materials and furniture join the identify scopes; plain cargo still has no riddle', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'scope');
    expect(StudySystem.identifyScopeOf(plank)).toBe('material');
    expect(StudySystem.identifyScopeOf(mint('stn_table', 'scope:t'))).toBe('furniture');
    expect(StudySystem.identifyScopeOf(mint('res_tree_log', 'scope:l'))).toBeNull();
  });

  it('a dreamed log was unstudiable before; now the material eye reads it', () => {
    const dream: IAffix = { id: 'res_ovg_mirecured', name: 'Mire-Cured', type: 'PREFIX', stats: { max_health: 5 }, tier: 1 };
    expect(StudySystem.identifyScopeOf(mint('res_tree_log', 'scope:d', { dreamAffix: dream }))).toBe('material');
  });

  it('a sitting at the bench shows exactly the rolled record, and files it in the one ledger', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'sit');
    const added = additionsOf(plank)[0];
    expect(usePlayerStore.getState().studyItemAtStation(plank.id).ok).toBe(true);
    expect(LoadoutSystem.isAffixStudied(player(), added.id)).toBe(false); // D50: not until a rest
    usePlayerStore.setState(s => ({ player: RestSystem.settle(s.player).player }));
    expect(LoadoutSystem.isAffixStudied(player(), added.id)).toBe(true);
    expect(Object.values(player().materialMastery).some(k => k.discoveredAffixes.includes(added.id))).toBe(true);
    const line = inspectItem(plank, player()).rows.find(([k]) => k === 'Affix')!;
    for (const [stat, value] of Object.entries(added.stats)) {
      expect(line[1]).toContain(stat.replace(/_/g, ' '));
      expect(line[1]).toContain(String(value));
    }
  });

  it('the room can be studied from its own bench: what is in the walls opens, numbers and all', async () => {
    const lotId = await rawWorkshop();
    useHubStore.setState(s => ({ rooms: { ...s.rooms, [lotId]: { ...s.rooms[lotId], shellInherited: [addition('prc_walls', { upkeep_discount_pct: 3 })] } } }));
    expect(usePlayerStore.getState().studyRoomAtStation(hub().rooms[lotId]).ok).toBe(true);
    expect(LoadoutSystem.isAffixStudied(player(), 'prc_walls')).toBe(true);
    const said = inspectBuiltRoom(hub().rooms[lotId], player())!.rows.map(r => r.join(' ')).join(' ');
    expect(said).toMatch(/upkeep discount pct/);
    expect(said).toContain('3');
  });

  it('nothing to study in a raw room, and the refusal says so', async () => {
    const lotId = await rawWorkshop();
    // the bench stands in this room with nothing worked into it, walls of raw log
    const verdict = usePlayerStore.getState().studyRoomAtStation(hub().rooms[lotId]);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBeTruthy();
  });
});

describe('line 62: the skill itself reveals it, through play', () => {
  const tier = (id: string) => AffixBank.current().entries.find(e => e.id === id)!.tier;
  const carpentry = () => ProcessSystem.poolFor(AffixBank.current(), 'carpentry', UniversalRank.S, Rarity.LEGENDARY);

  it('working a process grows its own skill (D6: skills grow by use)', async () => {
    const lotId = await rawWorkshop();
    await runRecipe(lotId, 'recipe_plank', 'grow');
    expect(player().bank.universalSkills['skill_carpentry']).toBeTruthy();
  });

  it('the first making teaches nothing: level 1 knows no tier', async () => {
    const lotId = await rawWorkshop();
    const [plank] = await runRecipe(lotId, 'recipe_plank', 'first');
    expect(player().bank.universalSkills['skill_carpentry'].level).toBe(1);
    expect(LoadoutSystem.isAffixStudied(player(), additionsOf(plank)[0].id)).toBe(false);
  });

  it('honest repetition opens the common tier and nothing above it, in the one ledger', async () => {
    const lotId = await rawWorkshop();
    for (let i = 0; i < 12 && player().bank.universalSkills['skill_carpentry']?.level !== 2; i++) {
      await runRecipe(lotId, 'recipe_plank', `rep:${i}`);
    }
    expect(player().bank.universalSkills['skill_carpentry'].level).toBe(2);
    for (const e of carpentry()) {
      expect(LoadoutSystem.isAffixStudied(player(), e.id), `${e.id} tier ${tier(e.id)}`).toBe(tier(e.id) <= 1);
    }
  });

  it('a skill only knows its own trade', async () => {
    const lotId = await rawWorkshop();
    for (let i = 0; i < 12 && player().bank.universalSkills['skill_carpentry']?.level !== 2; i++) {
      await runRecipe(lotId, 'recipe_plank', `own:${i}`);
    }
    for (const e of ProcessSystem.poolFor(AffixBank.current(), 'smelting', UniversalRank.S, Rarity.LEGENDARY)) {
      expect(LoadoutSystem.isAffixStudied(player(), e.id)).toBe(false);
    }
  });
});

describe('line 62: lore reveals it', () => {
  it('a trade note is a real lore item naming its trade', () => {
    const note = ProcessSystem.tradeNote('carpentry', Rng.fromKey('note'));
    expect(note.type).toBe(ItemType.LORE);
    expect(note.description).toBeTruthy();
    expect(note.loreData?.processFamily).toBe('carpentry');
  });

  it('reading a note opens the first tier of that trade, files the topic, and asks no second reading', () => {
    const note = ProcessSystem.tradeNote('masonry', Rng.fromKey('note2'));
    setStash([note]);
    const read = usePlayerStore.getState().readLore(note.id);
    expect(read.ok).toBe(true);
    for (const e of ProcessSystem.poolFor(AffixBank.current(), 'masonry', UniversalRank.S, Rarity.LEGENDARY)) {
      expect(LoadoutSystem.isAffixStudied(player(), e.id), e.id).toBe(e.tier <= 1);
    }
    expect(Object.values(player().materialMastery).some(k => k.discoveredAffixes.length > 0)).toBe(true);
    expect(Object.values(player().bank.lore).length).toBe(1);
    expect(stash().some(i => i.id === note.id)).toBe(true); // a note is kept, like any document
    const again = usePlayerStore.getState().readLore(note.id);
    expect(again.ok).toBe(false);
    expect(again.reason).toBeTruthy();
  });

  it('an old fragment teaches no trade, and says so in voice', () => {
    const fragment = { ...mint('crf_paper', 'frag'), type: ItemType.LORE, description: LORE_FRAGMENTS[0] };
    setStash([fragment]);
    const read = usePlayerStore.getState().readLore(fragment.id);
    expect(read.ok).toBe(false);
    expect(read.reason).toBeTruthy();
  });

  it('the shelf carries notes, keyed by the day, and a note survives the purchase mint', async () => {
    await freshHub();
    setStash([]);
    const listing = hub().consumableShop.find(l => l.item.loreData);
    expect(listing).toBeTruthy();
    const bought = hub().purchaseFromShop(listing!.id, 'consumable')!;
    expect(bought.loreData?.processFamily).toBeTruthy();
  });

  it('a chest fragment in a world pinned after these batches may teach; a world pinned before never does', () => {
    const roll = (version: number | undefined) => Array.from({ length: 400 }, (_, i) => ProcessSystem.chestNote(version, `chest:${i}`));
    expect(roll(undefined).every(n => n === null)).toBe(true);
    expect(roll(2).every(n => n === null)).toBe(true);
    const later = roll(AffixBank.version());
    expect(later.some(n => n !== null)).toBe(true);
    expect(later.some(n => n === null)).toBe(true);
    expect(JSON.stringify(later)).toBe(JSON.stringify(roll(AffixBank.version())));
  });
});

// -----------------------------------------------------------------------------
// THE ONE-WAY DOOR — what stands must not change
// -----------------------------------------------------------------------------

describe('the one-way door: pinned worlds', () => {
  it('the golden vectors stand', () => {
    expect(runGoldenCheck().mismatches).toEqual([]);
  });

  it('a pinned pack is the same bytes it always was', () => {
    for (const [version, hash] of Object.entries(PINNED_PACK_HASHES)) {
      expect(fnv1a(JSON.stringify(AffixBank.packAt(Number(version))))).toBe(hash);
    }
  });

  it('a world pinned at v2 still reads the same dream', () => {
    expect(DreamingSystem.sectorDream('pin_seed', AffixBank.packAt(2)!, 'OVERGROWTH', 3, 4)).toEqual(PINNED_DREAM);
  });

  it('no process entry ever reaches a dream: drops, chests, harvests, surveys or the shelf', () => {
    const pack = AffixBank.current();
    const ids = processIds();
    expect(ids.size).toBeGreaterThan(0);
    for (const biome of ['WASTELAND', 'OVERGROWTH', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY']) {
      DreamingSystem.entriesFor(pack, biome).forEach(e => expect(ids.has(e.id)).toBe(false));
      const pool = DreamingSystem.rollPoolFor(pack, biome);
      [...pool.prefixes, ...pool.suffixes].forEach(e => expect(ids.has(e.id)).toBe(false));
      for (let i = 0; i < 200; i++) {
        const got = DreamingSystem.materialAffixFor(pack, biome, 'res_tree_log', Rng.fromKey(`door:${biome}:${i}`));
        if (got) expect(ids.has(got.id)).toBe(false);
      }
    }
    const shelf = DreamingSystem.hubShelfPool();
    [...shelf.prefixes, ...shelf.suffixes].forEach(e => expect(ids.has(e.id)).toBe(false));
  });

  it('the chest\'s fragment table is untouched, so every pinned chest lands where it always did', () => {
    expect(LORE_FRAGMENTS.length).toBe(LORE_FRAGMENT_COUNT);
  });
});

describe('the one-way door: finished houses and stored rooms', () => {
  it('rooms of every older material compose to the same bytes', () => {
    for (const [material, hash] of Object.entries(STORED_ROOM_HASHES)) {
      expect(hashBytes(composeRoom(emptyRoom('poi_lot_0', FOOT, material)).data), material).toBe(hash);
    }
  });

  it('a stored mixed room, with a log door and a shard window, composes to the same bytes', () => {
    const room = emptyRoom('poi_lot_0', FOOT, 'crf_plank');
    room.pieces.push({ id: 'a', kind: 'DOOR', x: 8, y: 4, materialDefId: 'res_tree_log', builtBy: 'x', at: 0 });
    room.pieces.push({ id: 'b', kind: 'WINDOW', x: 4, y: 0, materialDefId: 'res_glass_shards', builtBy: 'x', at: 0 });
    room.pieces.push({ id: 'c', kind: 'WALL', x: 4, y: 4, materialDefId: 'crf_stone_block', builtBy: 'x', at: 0 });
    expect(hashBytes(composeRoom(room).data)).toBe(STORED_MIXED_ROOM_HASH);
  });

  it('the system templates compose to the same bytes', () => {
    for (const tpl of SYSTEM_TEMPLATES) {
      expect(hashBytes(composeRoom(templateToRoom(tpl, defaultSheet(tpl), 'poi_lot_0')).data), tpl.name).toBe(STORED_TEMPLATE_HASHES[tpl.name]);
    }
  });

  it('the city, with no raw building standing, is the same bytes', () => {
    const lots: any = { 0: 'HOUSE', 1: 'WORKSHOP', 2: 'VENDOR', 3: 'OWNED_EMPTY', 4: 'FORECLOSED', 5: 'UNDER_CONSTRUCTION' };
    expect(hashBytes(composeHub(HubGenerator.generate(), { frame: 0, lots, construction: { 5: 0.5 } }).data)).toBe(STORED_CITY_HASH);
  });

  it('a stored piece without the new field salvages as it always did, and a stored room reads no bonus', () => {
    const salvage = salvageFor({ kind: 'WALL', materialDefId: 'crf_plank', materialQuality: 0 });
    expect(salvage).toEqual({ defId: 'crf_plank', count: 1, quality: -0.1 });
    const stored: IRoomState = JSON.parse(JSON.stringify(emptyRoom('L', FOOT, 'crf_plank')));
    expect(roomProcessBonus(stored)).toEqual({ upkeepDiscountPct: 0, craftSpeedPct: 0, additions: 0 });
  });
});

// -----------------------------------------------------------------------------
// A RAW-BUILT HOUSE READS APART, IN GRAYSCALE, BY SHAPE
// -----------------------------------------------------------------------------

describe('a raw-built house reads apart from a plank-built one, in grayscale', () => {
  const gray = grayscale(buildPalette(HUB_GENRE));
  const lum = (v: number) => gray[v * 3];
  const wallRow = (material: string) => composeRoom(emptyRoom('l', FOOT, material));

  /** The top wall, atom by atom: what the eye meets first. */
  const atomDiff = (a: string, b: string) => {
    const sa = wallRow(a), sb = wallRow(b);
    let diff = 0, atoms = 0;
    for (let y = 1; y < ROOM_TILE - 1; y++) for (let x = 0; x < sa.w; x++) {
      atoms++;
      if (lum(sa.data[y * sa.w + x]) !== lum(sb.data[y * sb.w + x])) diff++;
    }
    return diff / atoms;
  };

  /** The same wall in 5×5 averaged blocks: the read at game scale, where grain blurs. */
  const blockDiff = (a: string, b: string) => {
    const sa = wallRow(a), sb = wallRow(b);
    let diff = 0, blocks = 0;
    for (let by = 0; by + 5 <= ROOM_TILE; by += 5) for (let bx = 0; bx + 5 <= sa.w; bx += 5) {
      let ta = 0, tb = 0;
      for (let y = by; y < by + 5; y++) for (let x = bx; x < bx + 5; x++) {
        ta += lum(sa.data[y * sa.w + x]);
        tb += lum(sb.data[y * sb.w + x]);
      }
      blocks++;
      if (Math.abs(ta - tb) / 25 >= WALL_BLOCK_GRAY_STEP) diff++;
    }
    return diff / blocks;
  };

  /** Rows of the wall's interior where one long dark line runs: coursing, a shape. */
  const coursedRows = (material: string) => {
    const s = wallRow(material);
    const interior: number[] = [];
    for (let y = 1; y < ROOM_TILE - 1; y++) for (let x = ROOM_TILE; x < s.w - ROOM_TILE; x++) interior.push(lum(s.data[y * s.w + x]));
    const floor = Math.min(...interior);
    let rows = 0;
    for (let y = 1; y < ROOM_TILE - 1; y++) {
      let dark = 0;
      for (let x = ROOM_TILE; x < s.w - ROOM_TILE; x++) if (lum(s.data[y * s.w + x]) <= floor) dark++;
      if (dark / (s.w - 2 * ROOM_TILE) >= 0.8) rows++;
    }
    return rows;
  };

  it('the composer knows which materials are raw, and only those', () => {
    expect(rawWallKind('res_tree_log')).toBe('LOG');
    expect(rawWallKind('res_rock_small')).toBe('STONE');
    for (const worked of ['crf_plank', 'crf_stone_block', 'crf_iron_ingot', 'crf_glass']) expect(rawWallKind(worked)).toBeNull();
  });

  it('a log wall differs from a plank wall, atom by atom and block by block', () => {
    expect(atomDiff('res_tree_log', 'crf_plank')).toBeGreaterThan(WALL_DIFF_MIN);
    expect(blockDiff('res_tree_log', 'crf_plank')).toBeGreaterThan(WALL_BLOCK_DIFF_MIN);
  });

  it('a raw stone wall differs from a plank wall and from its own cut block', () => {
    expect(atomDiff('res_rock_small', 'crf_plank')).toBeGreaterThan(WALL_DIFF_MIN);
    expect(blockDiff('res_rock_small', 'crf_plank')).toBeGreaterThan(WALL_BLOCK_DIFF_MIN);
    expect(atomDiff('res_rock_small', 'crf_stone_block')).toBeGreaterThan(WALL_DIFF_MIN);
    expect(blockDiff('res_rock_small', 'crf_stone_block')).toBeGreaterThan(WALL_BLOCK_DIFF_MIN);
  });

  it('logs and stone differ from each other', () => {
    expect(atomDiff('res_tree_log', 'res_rock_small')).toBeGreaterThan(WALL_DIFF_MIN);
    expect(blockDiff('res_tree_log', 'res_rock_small')).toBeGreaterThan(WALL_BLOCK_DIFF_MIN);
  });

  it('the difference is a shape: a log wall is coursed by long seams, a plank wall is not', () => {
    expect(coursedRows('res_tree_log')).toBeGreaterThanOrEqual(1);
    expect(coursedRows('crf_plank')).toBe(0);
  });

  it('inner walls and floors read raw as well', () => {
    const inner = (material: string) => {
      const room = emptyRoom('l', FOOT, 'crf_plank');
      room.pieces.push({ id: 'w', kind: 'WALL', x: 4, y: 4, materialDefId: material, builtBy: 'x', at: 0 });
      room.floorZones = [{ name: 'Z', tiles: [{ x: 6, y: 4 }], materialDefId: material }];
      return composeRoom(room);
    };
    const log = inner('res_tree_log'), plank = inner('crf_plank');
    const tileDiff = (tx: number, ty: number) => {
      let diff = 0;
      for (let y = 1; y < ROOM_TILE - 1; y++) for (let x = 1; x < ROOM_TILE - 1; x++) {
        const i = (ty * ROOM_TILE + y) * log.w + tx * ROOM_TILE + x;
        if (lum(log.data[i]) !== lum(plank.data[i])) diff++;
      }
      return diff / ((ROOM_TILE - 2) * (ROOM_TILE - 2));
    };
    expect(tileDiff(4, 4)).toBeGreaterThan(WALL_DIFF_MIN);
    expect(tileDiff(6, 4)).toBeGreaterThan(WALL_DIFF_MIN);
  });

  it('a raw room composes deterministically', () => {
    const room = emptyRoom('l', FOOT, 'res_tree_log');
    expect(hashBytes(composeRoom(room).data)).toBe(hashBytes(composeRoom(JSON.parse(JSON.stringify(room))).data));
  });

  it('from the street: a raw building draws a facade of its own, by shape, on the same footprint', () => {
    for (const state of ['HOUSE', 'WORKSHOP', 'VENDOR'] as const) {
      const plain = lotArt(state, 80, 80, 1, 0);
      for (const facade of ['LOG', 'STONE'] as const) {
        const raw = lotArt(state, 80, 80, 1, 0, facade);
        expect(raw.w).toBe(plain.w);
        let diff = 0;
        for (let i = 0; i < raw.data.length; i++) if (lum(raw.data[i]) !== lum(plain.data[i])) diff++;
        expect(diff / raw.data.length, `${state} ${facade}`).toBeGreaterThan(FACADE_DIFF_MIN);
      }
    }
  });

  it('the city passes a raw facade through to the lot it stands on', () => {
    const layout = HubGenerator.generate();
    const lots: any = { 0: 'HOUSE' };
    const plain = composeHub(layout, { frame: 0, lots });
    const raw = composeHub(layout, { frame: 0, lots, facades: { 0: 'LOG' } });
    expect(hashBytes(raw.data)).not.toBe(hashBytes(plain.data));
  });
});

// -----------------------------------------------------------------------------
// LINE 45 — THE SOURCING AUDIT, as a bar over the live definitions
// -----------------------------------------------------------------------------

describe('line 45: every gameplay material can be sourced, refined and consumed', () => {
  const rows = () => SourcingAudit.run();
  const open = () => rows().filter(r => !r.closed);

  it('the audit reads every raw material and every crafted good there is', () => {
    const covered = rows().map(r => r.defId).sort();
    expect(covered).toEqual([...Object.keys(RESOURCE_DEFINITIONS), ...Object.keys(CRAFTED_DEFINITIONS)].sort());
  });

  it('nothing is left open', () => {
    expect(open().map(r => `${r.defId}: ${r.problems.join('; ')}`)).toEqual([]);
  });

  it('every raw material grows somewhere a real world generates it', () => {
    const context = SourcingAudit.worldContext();
    const found = new Set<string>();
    ['audit_a', 'audit_b', 'audit_c'].forEach(seed => {
      const map = WorldGenerator.generate(seed, 16, context);
      for (let cy = 0; cy < 256; cy += 2) for (let cx = 0; cx < 256; cx += 2) {
        const chunk = WorldGenerator.chunkAt(map, cx, cy, context);
        chunk?.entities.forEach(e => { if (e.definitionId) found.add(e.definitionId); });
      }
    });
    for (const defId of Object.keys(RESOURCE_DEFINITIONS)) expect(found.has(defId), defId).toBe(true);
  });

  it('from a fresh origin, every crafted good is reachable: raw, then the first bench, then the chain', () => {
    const reach = SourcingAudit.reachableFromRaw();
    for (const defId of Object.keys(CRAFTED_DEFINITIONS)) expect(reach.has(defId), defId).toBe(true);
  });

  it('every sink is real: a recipe, a bill by tag, the mint, a meal or standing in a room', () => {
    for (const row of rows()) {
      if (row.waiver) continue;
      expect(row.sinks.length, row.defId).toBeGreaterThanOrEqual(1);
    }
  });

  it('every raw material takes a process or is named as used directly, and pebbles still raise nothing', () => {
    for (const row of rows().filter(r => r.raw)) {
      if (row.waiver) continue;
      expect(row.refined.length > 0 || !!row.direct, row.defId).toBe(true);
    }
    const pebbles = rows().find(r => r.defId === 'res_pebbles')!;
    expect(pebbles.sinks.some(s => s.startsWith('bill:building'))).toBe(false);
    expect(pebbles.refined.length).toBeGreaterThan(0);
  });

  it('a waiver names its wave: the sapling alone waits for the farms', () => {
    const waived = rows().filter(r => r.waiver);
    expect(waived.map(r => r.defId)).toEqual(['res_tree_sapling']);
    expect(waived[0].waiver).toMatch(/Wave 11/);
  });

  it('every recipe stays value-positive, as the anatomy law demands', () => {
    for (const recipe of Object.values(RECIPE_DEFINITIONS)) {
      const atoms = recipe.inputs.reduce((n, i) => n + CompositionSystem.baseMaterialValue(defOf(i.itemId)) * i.quantity, 0);
      const inputs = recipe.inputs.flatMap(i => Array.from({ length: i.quantity }, () => CompositionSystem.root({ id: i.itemId, name: i.itemId }, 'HARVEST')));
      const made = recipe.outputs.reduce((n, o) => n + o.quantity, 0);
      const comp = CompositionSystem.compose({ recipeId: recipe.id, name: recipe.name, laborSeconds: recipe.laborTimeSeconds, facility: recipe.requiredFacility }, inputs, made);
      expect(CompositionSystem.priceOf(comp) * made, recipe.id).toBeGreaterThanOrEqual(atoms);
    }
  });
});

describe('line 45: the gold and item audit over the full raw loop', () => {
  it('raw to house to bench to chain to sale: gold balances by replay, nothing exists twice', async () => {
    const lots = await freshHub();
    const { Ledger } = await import('../src/logic/ledger/Ledger');
    await Ledger.append('CHARACTER_GENESIS', { gold: 500 });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + 19_500 } } }));
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 19_500 });

    addStash([
      ...many('res_tree_log', 12, 'loop:l'), ...many('res_rock_small', 8, 'loop:r'),
      ...many('res_iron_vein', 4, 'loop:o'), ...many('res_sand', 2, 'loop:s'),
      ...many('res_pebbles', 2, 'loop:p'), ...many('res_plant_fiber', 3, 'loop:f')
    ]);

    // the raw shells: a stone house, then the log workshop that mints the first bench
    await hub().buyLot(lots[0]);
    await hub().buyLot(lots[1]);
    expect(await hub().buildStructure(lots[0], 'HOUSE', 'res_rock_small')).toBe(true);
    expect(await hub().buildStructure(lots[1], 'WORKSHOP', 'res_tree_log')).toBe(true);
    await finishBuilds();
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
    expect((await hub().placeItem(lots[1], bench.id, 6, 3, false)).ok).toBe(true);

    // the chain: every family through the one door
    for (const recipe of ['recipe_plank', 'recipe_ingot', 'recipe_masonry', 'recipe_cloth', 'recipe_flint_glass']) await craftOne(lots[1], recipe);

    // worked goods into the walls, a piece torn back out, and a sale
    const plank = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    expect((await hub().queuePiece(lots[0], 'WALL', 4, 4, plank.id)).ok).toBe(true);
    await finishBuilds();
    const piece = hub().rooms[lots[0]].pieces[0];
    expect(piece.inherited?.length).toBeGreaterThanOrEqual(1);
    await hub().demolishPiece(lots[0], piece.id);
    const back = stash().find(i => i.universalDefinitionId === 'crf_plank' && i.quality < 0)!;
    expect(additionsOf(back).length).toBeGreaterThanOrEqual(1);
    expect(await hub().sellToVendor(back.id)).toBeGreaterThan(0);

    await hub().resolveUpkeep(worldDay() + 1);
    await new Promise(r => setTimeout(r, 25));

    const audit = await GoldAudit.run();
    expect(audit.notes).toEqual([]);
    expect(audit.ok).toBe(true);

    const everywhere = [
      ...stash(),
      ...Object.values(hub().rooms).flatMap(r => r.placements.map(p => p.item)),
      ...hub().lots.flatMap(l => (l.shopListings || []).map(li => li.item))
    ];
    const ids = everywhere.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of everywhere) expect(item.composition).toBeTruthy();
  });
});

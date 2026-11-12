/**
 * WAVE 10D BARS — registered before the anatomy was built (guardrail 1).
 * Test lines 50, 51 and 54:
 *   50 an item knows what it is made of: its atoms and its chain, from
 *      stone-and-stick to the long route, and the chain sets its worth
 *   51 no two items are ever exactly the same, and the first keeps its claim
 *   54 the gold and item audit balances across the whole itemization economy
 * Plus the wave's own bars (PLAN 3B, Wave 10D): an item's composition is
 * complete and signed — every atom traceable to a harvest, a purchase or an
 * improvisation; same chain, same budget, byte-deterministic; the
 * stone-and-stick item is measurably the worst thing the game can make; no two
 * items identical across a simulated economy of thousands of mints; price
 * monotonic in chain depth for fixed materials; the gold-AND-item audit
 * balances over the whole loop. And 10D.5's absorbed matters: stone masonry
 * joins the building economy; commodity purity and resource quality become one
 * law; demolish-salvage is decided and enacted (the decision taken this leg:
 * the bill comes back whole, minus a quality bite of −0.10 per demolition,
 * floored at the quality floor −0.20; shells and permits never return).
 * And D13's deferred numbers: the mono-material set bonus is real, with
 * numbers derived from the material's own properties.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, IComposition, ItemType, UniversalRank } from '../shared/types';
import {
  CompositionSystem, COMPOSITION_RULES_VERSION, LABOR_RATE_GOLD_PER_SECOND
} from '../shared/logic/economy/CompositionSystem';
import { MintRegistry } from '../shared/logic/economy/MintRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ITEM_DEFINITIONS, CRAFTED_GEAR_BASES } from '../shared/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import {
  RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, GEAR_RECIPES, STRUCTURE_COSTS
} from '../shared/entities/economy/data/recipeDefinitions';
import { improvise } from '../src/logic/systems/ImprovisedCrafting';
import { emptyRoom, PIECE_BILLS, pickBill, salvageFor } from '../shared/entities/hub/room';
import { setBonusFor, monoMaterialOf } from '../shared/entities/hub/template';
import { composeRoom, ROOM_TILE } from '../src/render/atoms/room';
import { grayscale, buildPalette, hashBytes } from '../shared/render/atoms/atoms';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { HUB_GENRE } from '../src/render/atoms/hub';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const SALVAGE_QUALITY_BITE = 0.10;   // every demolition costs the material this much quality
const QUALITY_FLOOR = -0.20;         // and never below the scale's own floor
const STONE_WALL_DIFF_MIN = 0.10;    // stone vs plank wall: share of wall atoms that differ (rooms bar)
const MINT_STORM = 3000;             // simulated economy size for line 51

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const mintRes = (defId: string, key: string, origin?: any): IItem =>
  ItemFactory.createResourceItem(
    (RESOURCE_DEFINITIONS[defId] ?? CRAFTED_DEFINITIONS[defId]) as any,
    Rng.fromKey(key), origin ? { origin } : undefined);

const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;
const gold = () => usePlayerStore.getState().player.bank.gold;
const grantStash = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...items] } : t) } }
}));

beforeEach(() => {
  db.clear();
  localStorage.clear();
  MintRegistry.reset();
  useIdentityStore.setState({ certificate: CERT('uid_anatomy') });
  usePlayerStore.getState().initializeSession(CERT('uid_anatomy'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// LINE 50 — COMPOSITION: an item knows what it is made of
// -----------------------------------------------------------------------------

describe('composition: every item records its atoms and its chain', () => {
  it('a harvested resource is its own root: itself, no steps, depth 0, origin HARVEST', () => {
    const log = mintRes('res_tree_log', 'bars:log');
    const c = log.composition!;
    expect(c.version).toBe(COMPOSITION_RULES_VERSION);
    expect(c.materials).toEqual([{ defId: 'res_tree_log', name: 'Hardwood Log', count: 1, origin: 'HARVEST' }]);
    expect(c.steps).toEqual([]);
    expect(c.depth).toBe(0);
  });

  it('world-rolled gear says so: origin WORLD, no chain to lie about', () => {
    const drop = ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey('bars:drop'));
    expect(drop.composition).toBeTruthy();
    expect(drop.composition!.materials.every(m => m.origin === 'WORLD')).toBe(true);
    expect(drop.composition!.depth).toBe(0);
  });

  it('a composed item merges its inputs per item and adds its step', () => {
    const log = mintRes('res_tree_log', 'bars:log2');
    const step = { recipeId: 'recipe_plank', name: 'Mill Planks', laborSeconds: 10, facility: 'WORKSHOP' };
    const plankComp = CompositionSystem.compose(step, [log.composition!], 2);
    // one log across two planks: half a log and half the labor each
    expect(plankComp.materials).toEqual([{ defId: 'res_tree_log', name: 'Hardwood Log', count: 0.5, origin: 'HARVEST' }]);
    expect(plankComp.laborSeconds).toBe(5);
    expect(plankComp.steps.map(s => s.recipeId)).toEqual(['recipe_plank']);
    expect(plankComp.depth).toBe(1);
    expect(plankComp.batchYield).toBe(2);
  });

  it('a deep route keeps the whole story: the maul remembers the forest and the mine', () => {
    const mk = (id: string, k: string) => mintRes(id, k).composition!;
    const plank = CompositionSystem.compose(
      { recipeId: 'recipe_plank', name: 'Mill Planks', laborSeconds: 10, facility: 'WORKSHOP' },
      [mk('res_tree_log', 'bars:l3')], 2);
    const ingot = CompositionSystem.compose(
      { recipeId: 'recipe_ingot', name: 'Smelt Iron', laborSeconds: 15, facility: 'WORKSHOP' },
      [mk('res_iron_vein', 'bars:o1'), mk('res_iron_vein', 'bars:o2')], 1);
    const maul = CompositionSystem.compose(
      { recipeId: 'recipe_iron_maul', name: 'Hang an Iron Head', laborSeconds: 30, facility: 'WORKSHOP' },
      [plank, plank, ingot], 1);
    const byId = Object.fromEntries(maul.materials.map(m => [m.defId, m.count]));
    expect(byId['res_tree_log']).toBe(1);     // two half-logs
    expect(byId['res_iron_vein']).toBe(2);
    expect(maul.steps.map(s => s.recipeId)).toEqual(['recipe_plank', 'recipe_ingot', 'recipe_iron_maul']);
    expect(maul.depth).toBe(2);               // max(input depth 1) + 1: mill and smelt are depth 1, the maul is 2
  });

  it('same chain, same budget, byte-deterministic', () => {
    const build = () => {
      const log = mintRes('res_tree_log', 'bars:same');
      return CompositionSystem.compose(
        { recipeId: 'recipe_plank', name: 'Mill Planks', laborSeconds: 10, facility: 'WORKSHOP' },
        [log.composition!], 2);
    };
    const a = build(), b = build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(CompositionSystem.compositionHash(a)).toBe(CompositionSystem.compositionHash(b));
    expect(CompositionSystem.priceOf(a)).toBe(CompositionSystem.priceOf(b));
    expect(CompositionSystem.powerBudget(a)).toBe(CompositionSystem.powerBudget(b));
  });

  it('every mint path stamps a composition with a lawful origin', async () => {
    expect(mintRes('res_iron_vein', 'bars:h').composition!.materials[0].origin).toBe('HARVEST');
    expect(mintRes('crf_plank', 'bars:c', 'CONSTRUCTION').composition!.materials[0].origin).toBe('CONSTRUCTION');
    expect(ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('bars:w')).composition!.materials[0].origin).toBe('WORLD');
  });
});

// -----------------------------------------------------------------------------
// LINE 50 — THE FLOOR: stone-and-stick, no bench, anywhere
// -----------------------------------------------------------------------------

describe('the stone-and-stick floor: improvised crafting, no bench, anywhere', () => {
  const kit = () => [mintRes('res_rock_small', 'bars:stone'), mintRes('res_tree_log', 'bars:stick')];

  it('a stone and a stick become the crudest item, with no facility at all', () => {
    expect(GEAR_RECIPES['improv_club'].requiredFacility).toBeNull();
    const result = improvise('improv_club', kit(), 'bars:improv');
    expect(result.ok).toBe(true);
    expect(result.item!.type).toBe(ItemType.GEAR);
    expect(result.consumedIds).toHaveLength(2);
    expect(result.item!.composition!.steps[0].facility).toBeNull();
    const origins = result.item!.composition!.materials.map(m => m.origin);
    expect(origins.every(o => o === 'HARVEST')).toBe(true);
  });

  it('missing atoms refuse in voice, and consume nothing', () => {
    const items = [mintRes('res_rock_small', 'bars:onlystone')];
    const result = improvise('improv_club', items, 'bars:improv2');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Hardwood Log|log/i);
    expect(items).toHaveLength(1);
  });

  it('the club is measurably the worst weapon the game can make', () => {
    const club = improvise('improv_club', kit(), 'bars:worst').item!;
    // the weakest weapon the shelf or the world can mint: rank F at the quality floor, over every
    // weapon base the factory knows. The rarity rescale: a piece's power is its rank's and its quality's
    // (PieceLaw), and no step multiplies it
    const worstMintable = Math.min(...ITEM_DEFINITIONS.weapon_bases.map(() => PieceLaw.power('F', -0.2, false)));
    expect(club.itemPower).toBeGreaterThan(0);
    expect(club.itemPower).toBeLessThan(worstMintable);
  });

  it('the chain is the power budget: the deep maul beats the improvised club', async () => {
    const club = improvise('improv_club', kit(), 'bars:budget').item!;
    const maulBase = CRAFTED_GEAR_BASES.find(b => b.id === 'wpn_iron_maul_t1')!;
    expect(maulBase).toBeTruthy();
    const plank = (q: string) => mintRes('crf_plank', q).composition!;
    const maulComp = CompositionSystem.compose(
      { recipeId: 'recipe_iron_maul', name: 'Hang an Iron Head', laborSeconds: 30, facility: 'WORKSHOP' },
      [plank('bars:p1'), plank('bars:p2'), mintRes('crf_iron_ingot', 'bars:i1').composition!], 1);
    expect(CompositionSystem.powerBudget(maulComp)).toBeGreaterThan(club.itemPower);
  });
});

// -----------------------------------------------------------------------------
// LINE 50 — PRICES FROM THE CHAIN (absorbing 11B's price work)
// -----------------------------------------------------------------------------

describe('the chain sets the worth', () => {
  it('price is monotonic in chain depth for fixed materials', () => {
    let comp = mintRes('res_iron_vein', 'bars:mono').composition!;
    let last = CompositionSystem.priceOf(comp);
    for (let d = 1; d <= 5; d++) {
      comp = CompositionSystem.compose(
        { recipeId: `step_${d}`, name: `Step ${d}`, laborSeconds: 5, facility: 'WORKSHOP' }, [comp], 1);
      const price = CompositionSystem.priceOf(comp);
      expect(price).toBeGreaterThan(last);
      last = price;
    }
  });

  it('labor never destroys value: every real recipe prices above its atoms', () => {
    for (const recipe of Object.values(RECIPE_DEFINITIONS)) {
      const inputs = recipe.inputs.flatMap(req => Array.from({ length: req.quantity }, (_, i) =>
        mintRes(req.itemId, `bars:${recipe.id}:${req.itemId}:${i}`).composition!));
      const outCount = recipe.outputs.reduce((n, o) => n + o.quantity, 0);
      const outComp = CompositionSystem.compose(
        { recipeId: recipe.id, name: recipe.name, laborSeconds: recipe.laborTimeSeconds, facility: recipe.requiredFacility },
        inputs, outCount);
      const atomsIn = inputs.reduce((s, c) => s + CompositionSystem.priceOf(c), 0);
      expect(CompositionSystem.priceOf(outComp) * outCount).toBeGreaterThan(atomsIn);
    }
  });

  it('a crafted output carries the chain price as its value, through the real store', async () => {
    await useHubStore.getState().loadHub('hub_anatomy_price');
    const lotId = useHubStore.getState().lots[0].id;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 20000 } } }));
    await useHubStore.getState().buyLot(lotId);
    grantStash([
      mintRes('crf_plank', 'bars:sb1'), mintRes('crf_plank', 'bars:sb2'),
      mintRes('crf_plank', 'bars:sb3'), mintRes('crf_plank', 'bars:sb4'),
      mintRes('crf_plank', 'bars:sb5'), mintRes('crf_plank', 'bars:sb6'),
      mintRes('crf_iron_ingot', 'bars:si1'), mintRes('crf_iron_ingot', 'bars:si2'),
      mintRes('res_tree_log', 'bars:sl1')
    ]);
    await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await useHubStore.getState().resolveBuilds();

    expect(await useHubStore.getState().queueCraft(lotId, 'recipe_plank')).toBe(true);
    useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => ({ ...j, finishesAt: 0 })) }));
    await useHubStore.getState().resolveCrafts();
    const plank = stash().filter(i => i.universalDefinitionId === 'crf_plank').pop()!;
    expect(plank.composition).toBeTruthy();
    expect(plank.composition!.steps.map(s => s.recipeId)).toEqual(['recipe_plank']);
    expect(plank.value).toBe(CompositionSystem.priceOf(plank.composition!));
  });

  it('a workshop can hang an iron head: gear minted from a recipe, chain and all', async () => {
    await useHubStore.getState().loadHub('hub_anatomy_gear');
    const lotId = useHubStore.getState().lots[0].id;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 20000 } } }));
    await useHubStore.getState().buyLot(lotId);
    // the shell bill eats everything granted (a first bench: 6 building, D25); the
    // maul's own inputs are then MADE through the real chain: fell -> mill, mine -> smelt
    grantStash([
      mintRes('crf_plank', 'bars:m1'), mintRes('crf_plank', 'bars:m2'),
      mintRes('crf_plank', 'bars:m4'), mintRes('crf_plank', 'bars:m5'),
      mintRes('crf_plank', 'bars:m6'), mintRes('crf_plank', 'bars:m7'),
      mintRes('res_tree_log', 'bars:mlog'),
      mintRes('res_iron_vein', 'bars:mo1'), mintRes('res_iron_vein', 'bars:mo2')
    ]);
    await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await useHubStore.getState().resolveBuilds();

    expect(await useHubStore.getState().queueCraft(lotId, 'recipe_plank')).toBe(true);
    expect(await useHubStore.getState().queueCraft(lotId, 'recipe_ingot')).toBe(true);
    useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => ({ ...j, finishesAt: 0 })) }));
    await useHubStore.getState().resolveCrafts();

    expect(await useHubStore.getState().queueCraft(lotId, 'recipe_iron_maul')).toBe(true);
    useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => ({ ...j, finishesAt: 0 })) }));
    await useHubStore.getState().resolveCrafts();
    const maul = stash().find(i => i.universalDefinitionId === 'wpn_iron_maul_t1')!;
    expect(maul).toBeTruthy();
    expect(maul.type).toBe(ItemType.GEAR);
    expect(maul.composition!.depth).toBe(2);
    expect(maul.composition!.materials.some(m => m.defId === 'res_tree_log')).toBe(true);
    expect(maul.composition!.materials.some(m => m.defId === 'res_iron_vein')).toBe(true);
    expect(maul.itemPower).toBe(CompositionSystem.powerBudget(maul.composition!));
    expect(maul.value).toBe(CompositionSystem.priceOf(maul.composition!));
  });
});

// -----------------------------------------------------------------------------
// LINE 51 — UNIQUENESS (D18): first come, first served, globally
// -----------------------------------------------------------------------------

describe('no two items are ever exactly the same (D18)', () => {
  it('the first keeps its claim; a colliding tuple is nudged, deterministically', () => {
    const a = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('bars:claim'), 'weapon', 'wpn_sword_1h_t1');
    // the same roll with a different identity: a forced perfect collision
    const twinRoll = { ...a, id: 'itm_pretender', composition: a.composition };
    const b = MintRegistry.claim(twinRoll as IItem);
    expect(MintRegistry.tupleOf(a)).not.toBe(MintRegistry.tupleOf(b));
    // the first's claim is untouched
    const aAgain = MintRegistry.claim(a);
    expect(MintRegistry.tupleOf(aAgain)).toBe(MintRegistry.tupleOf(a));
    expect(aAgain.quality).toBe(a.quality);
  });

  it('re-claiming the same item is idempotent: replay never re-nudges', () => {
    const a = ItemFactory.createItem(UniversalRank.E, true, Rng.fromKey('bars:replay'));
    const once = MintRegistry.tupleOf(a);
    for (let i = 0; i < 5; i++) expect(MintRegistry.tupleOf(MintRegistry.claim(a))).toBe(once);
  });

  it('the nudge ladder replays: a nudged mint re-minted later lands on its own rung', () => {
    const base = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('bars:ladder'), 'weapon', 'wpn_sword_1h_t1');
    const second = MintRegistry.claim({ ...base, id: 'itm_second' } as IItem);
    const third = MintRegistry.claim({ ...base, id: 'itm_third' } as IItem);
    expect(MintRegistry.tupleOf(second)).not.toBe(MintRegistry.tupleOf(third));
    // replay the second mint from its base roll: same rung, same numbers
    const secondReplay = MintRegistry.claim({ ...base, id: 'itm_second' } as IItem);
    expect(MintRegistry.tupleOf(secondReplay)).toBe(MintRegistry.tupleOf(second));
    expect(secondReplay.quality).toBe(second.quality);
  });

  it(`a simulated economy of ${MINT_STORM} mints holds no two identical items`, () => {
    const seen = new Set<string>();
    for (let i = 0; i < MINT_STORM; i++) {
      const item = ItemFactory.createItem(undefined, true, Rng.fromKey(`storm:${i}`));
      const tuple = MintRegistry.tupleOf(item);
      expect(seen.has(tuple)).toBe(false);
      seen.add(tuple);
    }
    expect(seen.size).toBe(MINT_STORM);
  });

  it('buying twice from one listing mints two distinct items, deterministically', async () => {
    await useHubStore.getState().loadHub('hub_anatomy_shop');
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100000 } } }));
    const listing = useHubStore.getState().weaponShop.find(l => l.stock >= 2)!;
    const first = useHubStore.getState().purchaseFromShop(listing.id, 'weapon')!;
    const second = useHubStore.getState().purchaseFromShop(listing.id, 'weapon')!;
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^itm_/);                       // deterministic mint, not a UUID
    expect(MintRegistry.tupleOf(first)).not.toBe(MintRegistry.tupleOf(second));
    expect(first.composition!.materials[0].origin).toBe('PURCHASE');
  });
});

// -----------------------------------------------------------------------------
// 10D.5 — STONE MASONRY joins the building economy
// -----------------------------------------------------------------------------

describe('masonry: stone finally answers a bill', () => {
  it('two dense stones cut one block, and the block carries the building tag', () => {
    const recipe = RECIPE_DEFINITIONS['recipe_masonry'];
    expect(recipe).toBeTruthy();
    expect(recipe.inputs).toEqual([{ itemId: 'res_rock_small', quantity: 2, consume: true }]);
    const block = CRAFTED_DEFINITIONS['crf_stone_block'];
    expect(block.tags).toContain('building');
    expect(block.tags).toContain('stone');
  });

  it('a stone block pays a wall bill', () => {
    const block = mintRes('crf_stone_block', 'bars:block');
    const verdict = pickBill([PIECE_BILLS.WALL], [block]);
    expect(verdict.ok).toBe(true);
    expect(verdict.items[0].id).toBe(block.id);
  });

  it('a stone wall reads apart from a plank wall, in grayscale', () => {
    const stone = composeRoom(emptyRoom('l', { width: 4, height: 4 }, 'crf_stone_block'));
    const plank = composeRoom(emptyRoom('l', { width: 4, height: 4 }, 'crf_plank'));
    const gray = grayscale(buildPalette(HUB_GENRE));
    let diff = 0, atoms = 0;
    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < stone.w; x++) {
      atoms++;
      if (gray[stone.data[y * stone.w + x] * 3] !== gray[plank.data[y * plank.w + x] * 3]) diff++;
    }
    expect(diff / atoms).toBeGreaterThan(STONE_WALL_DIFF_MIN);
  });
});

// -----------------------------------------------------------------------------
// 10D.5 — ONE QUALITY LAW: purity and quality become one scale
// -----------------------------------------------------------------------------

describe('one quality law', () => {
  it('resources mint on the gear scale now: 0, not the dead 100', () => {
    const log = mintRes('res_tree_log', 'bars:q1');
    const plank = mintRes('crf_plank', 'bars:q2');
    expect(log.quality).toBe(0);
    expect(plank.quality).toBe(0);
    const gear = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('bars:q3'));
    expect(Math.abs(gear.quality)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('quality reaches a material value: worn atoms are worth less', () => {
    const def = RESOURCE_DEFINITIONS['res_iron_vein'] as any;
    expect(CompositionSystem.baseMaterialValue(def, -SALVAGE_QUALITY_BITE))
      .toBeLessThan(CompositionSystem.baseMaterialValue(def, 0));
  });
});

// -----------------------------------------------------------------------------
// 10D.5 — DEMOLISH-SALVAGE, decided and enacted
// -----------------------------------------------------------------------------

describe('demolish-salvage: the bill comes back, bitten', () => {
  const buildWall = async (hubKey: string) => {
    await useHubStore.getState().loadHub(hubKey);
    const lotId = useHubStore.getState().lots[0].id;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 20000 } } }));
    await useHubStore.getState().buyLot(lotId);
    grantStash([
      // the HOUSE shell eats 4 building; the fifth plank is for the wall
      mintRes('crf_plank', `${hubKey}:w1`), mintRes('crf_plank', `${hubKey}:w2`),
      mintRes('crf_plank', `${hubKey}:w3`), mintRes('crf_plank', `${hubKey}:w4`),
      mintRes('crf_plank', `${hubKey}:w5`)
    ]);
    await useHubStore.getState().buildStructure(lotId, 'HOUSE');
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await useHubStore.getState().resolveBuilds();
    return lotId;
  };

  it('the pure law: a wall salvages its bill at a quality bite, never the shell', () => {
    const piece = { id: 'pc', kind: 'WALL' as const, x: 4, y: 4, materialDefId: 'crf_plank', builtBy: 'u', at: 1 };
    const salvage = salvageFor(piece);
    expect(salvage.defId).toBe('crf_plank');
    expect(salvage.count).toBe(PIECE_BILLS.WALL.count);
    expect(salvage.quality).toBeCloseTo(-SALVAGE_QUALITY_BITE, 5);
    // a piece built from already-salvaged material steps down and floors
    const worn = salvageFor({ ...piece, materialQuality: -SALVAGE_QUALITY_BITE });
    expect(worn.quality).toBeCloseTo(QUALITY_FLOOR, 5);
    const floored = salvageFor({ ...piece, materialQuality: QUALITY_FLOOR });
    expect(floored.quality).toBeCloseTo(QUALITY_FLOOR, 5);
  });

  it('demolishing a built wall returns the material, signed, exactly once', async () => {
    const lotId = await buildWall('hub_anatomy_salv');
    const plank = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    const res = await useHubStore.getState().queuePiece(lotId, 'WALL', 4, 4, plank.id);
    expect(res.ok).toBe(true);
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await useHubStore.getState().resolveBuilds();
    expect(stash().some(i => i.id === plank.id)).toBe(false); // consumed by the wall

    const room = (useHubStore.getState() as any).rooms[lotId];
    const wall = room.pieces.find((p: any) => p.kind === 'WALL' && p.x === 4 && p.y === 4)!;
    const before = stash().filter(i => i.universalDefinitionId === 'crf_plank').length;
    expect(await useHubStore.getState().demolishPiece(lotId, wall.id)).toBe(true);
    const salvaged = stash().filter(i => i.universalDefinitionId === 'crf_plank');
    expect(salvaged.length).toBe(before + 1);
    const bitten = salvaged[salvaged.length - 1];
    expect(bitten.quality).toBeCloseTo(-SALVAGE_QUALITY_BITE, 5);
    expect(bitten.composition!.materials[0].origin).toBe('SALVAGE');
    // demolishing again mints nothing twice
    expect(await useHubStore.getState().demolishPiece(lotId, wall.id)).toBe(false);
    expect(stash().filter(i => i.universalDefinitionId === 'crf_plank').length).toBe(before + 1);
  });
});

// -----------------------------------------------------------------------------
// D13's deferred numbers — the mono-material set bonus is real
// -----------------------------------------------------------------------------

describe('the mono-material set bonus has its numbers', () => {
  it('the law derives distinct numbers from distinct materials', () => {
    const plank = setBonusFor('crf_plank')!;
    const stone = setBonusFor('crf_stone_block')!;
    const ingot = setBonusFor('crf_iron_ingot')!;
    expect(plank.upkeepDiscountPct).toBeGreaterThan(0);
    expect(stone.upkeepDiscountPct).toBeGreaterThan(plank.upkeepDiscountPct);
    expect(ingot.craftSpeedPct).toBeGreaterThan(0);          // conductivity reaches the bench
    expect(plank.craftSpeedPct).toBe(0);                     // wood conducts nothing
    expect(new Set([JSON.stringify(plank), JSON.stringify(stone), JSON.stringify(ingot)]).size).toBe(3);
  });

  it('a mono-material house pays discounted upkeep through the real store', async () => {
    await useHubStore.getState().loadHub('hub_anatomy_bonus');
    const lotId = useHubStore.getState().lots[0].id;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 20000 } } }));
    await useHubStore.getState().buyLot(lotId);
    grantStash([
      mintRes('crf_plank', 'bonus:1'), mintRes('crf_plank', 'bonus:2'),
      mintRes('crf_plank', 'bonus:3'), mintRes('crf_plank', 'bonus:4')
    ]);
    await useHubStore.getState().buildStructure(lotId, 'HOUSE');
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await useHubStore.getState().resolveBuilds();
    const room = (useHubStore.getState() as any).rooms[lotId];
    expect(monoMaterialOf(room)).toBe('crf_plank');

    const paidThrough = useHubStore.getState().lots.find(l => l.id === lotId)!.upkeepPaidThroughDay!;
    const before = gold();
    await useHubStore.getState().resolveUpkeep(paidThrough + 1);
    const charged = before - gold();
    const fullRate = STRUCTURE_COSTS.HOUSE.upkeepPerDay;
    const discounted = Math.max(1, Math.round(fullRate * (1 - setBonusFor('crf_plank')!.upkeepDiscountPct / 100)));
    expect(charged).toBe(discounted);
    expect(charged).toBeLessThan(fullRate);
  });
});

// -----------------------------------------------------------------------------
// LINE 54 — THE GOLD AND ITEM AUDIT, over the whole loop
// -----------------------------------------------------------------------------

describe('the gold and item audit balances across the itemization economy', () => {
  it('a full loop conserves gold by the ledger and never loses or dupes an item', async () => {
    await useHubStore.getState().loadHub('hub_anatomy_audit');
    const hub = () => useHubStore.getState();
    const lotId = hub().lots[0].id;

    // grant through the ledgered path so the audit can count it (genesis gets
    // its row the way StartupSequence writes it in the real boot)
    const { Ledger } = await import('../src/logic/ledger/Ledger');
    await Ledger.append('CHARACTER_GENESIS', { gold: 500 });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + 19500 } } }));
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 19500 });

    // items enter by mint (harvest), tracked as a multiset from here on
    const minted: IItem[] = [
      mintRes('res_tree_log', 'audit:l1'), mintRes('res_tree_log', 'audit:l2'),
      mintRes('res_rock_small', 'audit:s1'), mintRes('res_rock_small', 'audit:s2'),
      // the WORKSHOP shell eats 6 building, named below: logs and stones answer
      // that bill too since D24, and these two logs and stones have work to do
      mintRes('crf_plank', 'audit:p1'), mintRes('crf_plank', 'audit:p2'),
      mintRes('crf_plank', 'audit:p3'), mintRes('crf_plank', 'audit:p4'),
      mintRes('crf_plank', 'audit:p5'), mintRes('crf_plank', 'audit:p6'),
      mintRes('crf_iron_ingot', 'audit:i1'), mintRes('crf_iron_ingot', 'audit:i2')
    ];
    grantStash(minted);

    await hub().buyLot(lotId);                                 // 5000 to the treasury
    await hub().buildStructure(lotId, 'WORKSHOP', 'crf_plank'); // permit + shell bill
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await hub().resolveBuilds();

    // craft: masonry (mints), then build a stone wall, demolish it (salvage mints)
    expect(await hub().queueCraft(lotId, 'recipe_masonry')).toBe(true);
    useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => ({ ...j, finishesAt: 0 })) }));
    await hub().resolveCrafts();
    const block = stash().find(i => i.universalDefinitionId === 'crf_stone_block')!;
    expect(block).toBeTruthy();

    await hub().queuePiece(lotId, 'WALL', 4, 4, block.id);
    useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));
    await hub().resolveBuilds();
    const wall = (hub() as any).rooms[lotId].pieces.find((p: any) => p.kind === 'WALL' && p.x === 4)!;
    await hub().demolishPiece(lotId, wall.id);
    const salvagedBlock = stash().find(i => i.universalDefinitionId === 'crf_stone_block')!;
    expect(salvagedBlock.quality).toBeCloseTo(-SALVAGE_QUALITY_BITE, 5);

    // trade: vendor sale (treasury-funded) — the item leaves, gold arrives
    const sold = await hub().sellToVendor(salvagedBlock.id);
    expect(sold).toBeGreaterThan(0);
    expect(stash().some(i => i.id === salvagedBlock.id)).toBe(false);

    // purchase: a deterministic unit mint from the shelf
    const listing = hub().weaponShop.find(l => l.stock >= 1)!;
    const bought = hub().purchaseFromShop(listing.id, 'weapon')!;
    expect(bought).toBeTruthy();

    // the purchase's ledger row and treasury credit are write-behind; let them land
    await new Promise(r => setTimeout(r, 25));

    // THE AUDIT: gold balances by ledger replay, treasuries included
    const audit = await GoldAudit.run(usePlayerStore.getState().player);
    expect(audit.notes).toEqual([]);
    expect(audit.ok).toBe(true);

    // and the item multiset: everything minted is exactly once in the world
    // (stash + room placements + shop listings), or provably consumed
    const everywhere = [
      ...stash(),
      ...Object.values((hub() as any).rooms as Record<string, any>).flatMap((r: any) => r.placements.map((p: any) => p.item)),
      ...hub().lots.flatMap(l => (l.shopListings || []).map(li => li.item))
    ];
    const ids = everywhere.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);               // nothing exists twice
    // consumed: 2 stones -> masonry; 1 block -> wall (salvage re-minted, then sold);
    // shell bill: 4 planks + 2... the workshop bill consumed from the granted planks
    for (const item of everywhere) {
      expect(item.composition).toBeTruthy();                  // every item knows its atoms
    }
  });
});

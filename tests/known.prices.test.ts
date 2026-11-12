/**
 * A KNOWN THING IS DEARER (PR, part 2). Pedro, 2026-11-12, on seeing what three materials do: "the price of something
 * known should increase as well, right now the economy is static". And his rule over all of it: "once something exists
 * it's determined, and the skill always gives the same thing".
 *
 * A price has two parts: what the thing is (the law as it stood) and what is known of it. A material whose doing is
 * written is worth more from then on, by the share its band is of a piece in the piece law; what is made of it is worth
 * more through the price law's own sum; a read piece is worth more than the same piece unread, by its lines. What
 * already exists keeps the worth it came to be with. And the counter never prints coin: nothing bought can be sold
 * straight back for more, before a doing is written, after, or across the moment it is written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

const db = new Map<string, any>();

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, JSON.parse(JSON.stringify(doc))); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));

vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true
  }
}));

import { IAttributes, IItem, ItemType, UniversalRank } from '../shared/types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../shared/entities/item/data/resourceDefinitions';
import { ITEM_DEFINITIONS } from '../shared/entities/item/data/itemDefinitions';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { CompositionSystem } from '../shared/logic/economy/CompositionSystem';
import { KnownWorth } from '../shared/logic/economy/KnownWorth';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { STAT_BANDS } from '../shared/logic/theme/ThemeTypes';
import { DoingBook, DoingBand } from '../shared/logic/systems/MaterialDoing';
import { ItemLaw, IItemDefinitions } from '../shared/logic/content/ItemLaw';
import { useHubStore, worldDay } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { Ledger } from '../src/logic/ledger/Ledger';
import { ShopWeek } from '../src/logic/economy/ShopWeek';
import { VendorSystem } from '../src/logic/systems/VendorSystem';
import { inspectItem, worthSaid } from '../src/render/atoms/inspect';

const UID = 'uid_known';
const HUB = 'hub_known';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const KEEPERS = ['npc_weapon_vendor', 'npc_armor_vendor', 'npc_alchemist'];
const SHOP_OF: Record<string, 'weapon' | 'armor' | 'consumable'> = { npc_weapon_vendor: 'weapon', npc_armor_vendor: 'armor', npc_alchemist: 'consumable' };
const SHELF_OF = { weapon: 'weaponShop', armor: 'armorShop', consumable: 'consumableShop' } as const;

installShippedThemes();
const keyOf = (id: string) => id.replace(/^res_[0-9a-f]+_/, '');
const byKey = (key: string) => Object.values(RESOURCE_DEFINITIONS).find(d => keyOf(d.id) === key && d.themeId === FIRST_THEME_PACK.themeId)! as ResourceDef;
const iron = () => byKey('collateral_iron');
const write = (def: ResourceDef, band: DoingBand) =>
  DoingBook.hold({ material: def.id, stat: 'defense', band, line: 'What is made of it turns a blow aside.', by: 'model', writtenAt: 0 });
const take = (def: ResourceDef, key: string) => ItemFactory.createResourceItem(def, Rng.fromKey(`known:${key}`));
const smelt = (inputs: IItem[]) =>
  CompositionSystem.compose({ recipeId: 'rcp_smelt', name: 'Smelt', laborSeconds: 25, facility: null }, inputs.map(i => i.composition!), 1);

const setBartering = (bartering: number) =>
  usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, bartering } as IAttributes } }));
const grant = async (gold: number) => {
  usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + gold } } }));
  await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: gold });
};

beforeEach(async () => {
  vi.restoreAllMocks();
  const real = Date.now;
  const opening = ShopWeek.weekOf(Math.floor(real() / 86_400_000)) * ShopWeek.WEEK_DAYS;
  vi.spyOn(Date, 'now').mockImplementation(() => opening * 86_400_000 + (real() % 86_400_000));
  db.clear();
  DoingBook.forget();
  installShippedThemes();
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'KNOWN' } } as any });
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'KNOWN', rank: UniversalRank.F, skillProgress: {}, attributes: { ...s.player.attributes, bartering: 1 } as IAttributes,
      bank: { ...s.player.bank, gold: 0, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) }
    }
  }));
  useHubStore.setState({ rooms: {}, weaponShop: [], armorShop: [], consumableShop: [] });
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
  await hub().loadHub(HUB);
});

describe('calls 1 and 2: once what a material does is written, it is worth more, by its band\'s share of a piece', () => {
  it('until its doing is written, a material is worth what it always was', () => {
    const ore = take(iron(), 'before');
    expect(ore.value).toBe(60);
    expect(ore.composition!.materials[0].known).toBeUndefined();
  });

  it('the share is the piece law\'s own band, one rule: a minor doing is a twelfth, a moderate a sixth, a major a third', () => {
    for (const band of STAT_BANDS) expect(KnownWorth.share(band)).toBe(PieceLaw.BANDS[band]);
    expect(KnownWorth.share(undefined)).toBe(0);
    expect([KnownWorth.share('minor'), KnownWorth.share('moderate'), KnownWorth.share('major')]).toEqual([1 / 12, 1 / 6, 1 / 3]);
  });

  it('what is taken once it is written is worth that much more: iron at 60 comes to 65, 70 or 80', () => {
    const seen: Record<string, number> = {};
    for (const band of STAT_BANDS) {
      DoingBook.forget();
      write(iron(), band);
      const ore = take(iron(), `after:${band}`);
      seen[band] = ore.value;
      expect(ore.value).toBe(Math.round(60 * (1 + PieceLaw.BANDS[band])));
      expect(ore.composition!.materials[0].known).toBe(band);
    }
    expect(seen).toEqual({ minor: 65, moderate: 70, major: 80 });
  });

  it('what already exists does not move: a piece taken before keeps its worth, and says it was taken unknown', () => {
    const before = take(iron(), 'kept');
    write(iron(), 'minor');
    expect(before.value).toBe(60);
    expect(before.composition!.materials[0].known).toBeUndefined();
    expect(take(iron(), 'later').value).toBe(65);
  });
});

describe('call 3: what is made of known materials is worth more, through the price law\'s own sum', () => {
  it('an ingot of two known iron is worth what two unknown ones make, and the doing\'s share of the iron in it', () => {
    const unknown = CompositionSystem.priceOf(smelt([take(iron(), 'u1'), take(iron(), 'u2')]));
    write(iron(), 'minor');
    const known = CompositionSystem.priceOf(smelt([take(iron(), 'k1'), take(iron(), 'k2')]));
    expect(known).toBeGreaterThan(unknown);
    // The labor is the same; only the iron's atoms rise, each by its band's twelfth
    const atoms = 2 * CompositionSystem.baseMaterialValue(iron());
    expect(known - unknown).toBe(Math.ceil(atoms * (1 + 1 / 12) + 25) - Math.ceil(atoms + 25));
  });

  it('a known and an unknown piece of one material stay two lines, and each counts as what it was', () => {
    const old = take(iron(), 'old');
    write(iron(), 'minor');
    const fresh = take(iron(), 'fresh');
    const c = smelt([old, fresh]);
    expect(c.materials).toHaveLength(2);
    expect(c.materials.map(m => m.known ?? 'unknown').sort()).toEqual(['minor', 'unknown']);
    const atoms = CompositionSystem.baseMaterialValue(iron());
    expect(CompositionSystem.priceOf(c)).toBe(Math.ceil(atoms + atoms * (1 + 1 / 12) + 25));
  });

  it('the hub\'s check of a made thing reads the same price, before and after the doing is written', () => {
    const ingot = { ...take(iron(), 'ing'), composition: smelt([take(iron(), 'a'), take(iron(), 'b')]) };
    ingot.value = CompositionSystem.priceOf(ingot.composition);
    write(iron(), 'major');
    const defs: IItemDefinitions = {
      base: () => undefined, resource: id => RESOURCE_DEFINITIONS[id], step: () => ({ laborSeconds: 25 })
    };
    const verdict = ItemLaw.correct(ingot, defs);
    expect(verdict.ok && verdict.changes).toEqual([]);
  });
});

describe('call 4: a read piece is worth more than the same piece unread, by what its lines are worth', () => {
  const base = () => ITEM_DEFINITIONS.weapon_bases.find(b => b.kind)!;
  const mint = (read: boolean, law: Parameters<typeof ItemFactory.createFromTemplate>[5]) =>
    ItemFactory.createFromTemplate(base(), read, Rng.fromKey('known:piece'), undefined, UniversalRank.F, { quality: 0.1, ...law });

  it('an unread piece is worth twice its power, as before, and still not bought (Q12)', () => {
    const unread = mint(false, { depth: 1, band: 'moderate' });
    expect(unread.value).toBe(Math.floor(unread.itemPower * 2));
    expect(VendorSystem.refuses(unread)).toBeTruthy();
  });

  it('read, a piece with one moderate line is worth a sixth more; a plain one what it was', () => {
    const plain = mint(true, { depth: 0 });
    expect(plain.value).toBe(Math.floor(plain.itemPower * 2));
    const one = mint(true, { depth: 1, band: 'moderate' });
    expect(one.affixes).toHaveLength(1);
    expect(PieceLaw.linesShare(one)).toBeCloseTo(1 / 6, 9);
    expect(one.value).toBe(Math.floor(one.itemPower * 2 * (1 + 1 / 6)));
  });

  it('an epic piece of six moderate lines is worth a whole rank more, as the law sizes it', () => {
    const epic = mint(true, { depth: 4, band: 'moderate', pairsOpen: true });
    expect(epic.affixes).toHaveLength(6);
    expect(PieceLaw.linesShare(epic)).toBeCloseTo(1, 9);
    expect(epic.value).toBe(Math.floor(epic.itemPower * 2 * 2));
  });

  it('reading an unread piece gives it the worth of the same piece found read', () => {
    const unread = mint(false, { depth: 1, band: 'major' });
    const found = mint(true, { depth: 1, band: 'major' });
    const read = ItemFactory.read(unread);
    expect(read.isIdentified).toBe(true);
    expect(read.value).toBe(found.value);
    expect(read.value).toBeGreaterThan(unread.value);
  });

  it('a line\'s price (a downside) takes back what it added: a line counts as its gift\'s band', () => {
    const words = { gift: { stat: 'max_health', band: 'major' as const }, price: { stat: 'evasion_rating', band: 'minor' as const } };
    const stats = PieceLaw.affixStats(words, UniversalRank.D, 0.15);
    const piece = { rank: UniversalRank.D, quality: 0.15, affixes: [{ id: 'a', name: 'A', type: 'PREFIX' as const, stats, tier: 3 }] };
    expect(PieceLaw.linesShare(piece)).toBeCloseTo(1 / 3, 9);
  });

  it('the hub\'s check leaves a read piece\'s worth standing, and an old-law piece keeps twice its power', () => {
    const defs: IItemDefinitions = { base: id => ITEM_DEFINITIONS.weapon_bases.find(b => b.id === id), resource: () => undefined, step: () => undefined };
    const read = mint(true, { depth: 1, band: 'moderate' });
    const kept = ItemLaw.correct(read, defs);
    expect(kept.ok && kept.changes).toEqual([]);
    const old = { ...read, pieceLaw: 1 };
    const checked = ItemLaw.correct(old, defs);
    expect(checked.ok && checked.item?.value).toBe(Math.floor(read.itemPower * 2));
  });
});

describe('call 6: the counter never prints coin', () => {
  /** Buy every line of every shelf, and ask its keeper what it would pay to have it straight back. */
  const sweep = async (label: string) => {
    hub().generateDailyStock();
    const broke: string[] = [];
    for (const npc of KEEPERS) {
      const shop = SHOP_OF[npc];
      for (const row of hub()[SHELF_OF[shop]].filter(l => l.stock > 0)) {
        await grant(10_000_000);
        const gold = player().bank.gold;
        const bought = hub().purchaseFromShop(row.id, shop);
        if (!bought) continue;
        const paid = gold - player().bank.gold;
        for (const keeper of KEEPERS) {
          const offer = hub().offerFor(bought, keeper);
          if (offer > paid) broke.push(`${label}: ${bought.name} bought for ${paid} from ${npc}, ${keeper} pays ${offer}`);
        }
      }
    }
    return broke;
  };

  it('every line of every shelf, at any bartering, sold straight back pays no more than it cost', async () => {
    const broke: string[] = [];
    for (const bartering of [1, 25, 60, 150, 400]) {
      setBartering(bartering);
      broke.push(...await sweep(`bartering ${bartering}`));
    }
    expect(broke).toEqual([]);
  });

  /** A keeper's own piece of iron, on its shelf: bought, then offered back. */
  const ownIron = async (ore: IItem, npc = 'npc_alchemist') => {
    useHubStore.setState(s => ({ vendors: { ...s.vendors, [npc]: { ...VendorSystem.normal(s.vendors[npc]), listed: [ore], since: { [ore.id]: worldDay() } } } }));
    hub().generateDailyStock();
    const row = hub().consumableShop.find(l => l.held && l.item.id === ore.id)!;
    expect(row, 'the keeper shows its own iron').toBeTruthy();
    await grant(10_000_000);
    const gold = player().bank.gold;
    const bought = hub().purchaseFromShop(row.id, 'consumable')!;
    return { bought, paid: gold - player().bank.gold };
  };

  it('a keeper\'s own iron, bought and offered back, before its doing is written, after, and across the moment', async () => {
    for (const bartering of [1, 60, 400]) {
      setBartering(bartering);
      DoingBook.forget();
      const before = await ownIron(take(iron(), `own:before:${bartering}`));
      for (const npc of KEEPERS) expect(hub().offerFor(before.bought, npc)).toBeLessThanOrEqual(before.paid);
      // Across: bought unknown, then written, then offered
      const across = await ownIron(take(iron(), `own:across:${bartering}`));
      write(iron(), 'major');
      for (const npc of KEEPERS) expect(hub().offerFor(across.bought, npc)).toBeLessThanOrEqual(across.paid);
      const after = await ownIron(take(iron(), `own:after:${bartering}`));
      expect(after.bought.value).toBe(80);
      for (const npc of KEEPERS) expect(hub().offerFor(after.bought, npc)).toBeLessThanOrEqual(after.paid);
    }
  });

  it('bought from a master\'s own shop, marked down for a patron, it still sells back for no more than it cost', async () => {
    setBartering(400);
    write(iron(), 'major');
    const ore = take(iron(), 'trader');
    const traderId = 'crf_known';
    const trader = { ...VendorSystem.fresh(traderId, 'TRADER', worldDay()), listed: [ore], since: { [ore.id]: worldDay() }, patrons: [UID] };
    // A living to make marks it all down a tenth
    trader.agenda = { ...trader.agenda, needs: { ...trader.agenda.needs, survival: 0 } };
    useHubStore.setState(s => ({ vendors: { ...s.vendors, [traderId]: trader } }));
    const row = hub().traderShelf(traderId).find(l => l.item.id === ore.id)!;
    await grant(10_000_000);
    const gold = player().bank.gold;
    const bought = (await hub().buyFromTrader(traderId, row.id))!;
    const paid = gold - player().bank.gold;
    for (const npc of KEEPERS) expect(hub().offerFor(bought, npc)).toBeLessThanOrEqual(paid);
  });

  it('a thing never bought is offered as before: the guard reads only what was paid', () => {
    write(iron(), 'minor');
    const ore = take(iron(), 'found');
    expect(ore.paid).toBeUndefined();
    expect(hub().offerFor(ore)).toBe(Math.ceil(Math.floor(65 * 0.6)));
  });
});

describe('call 7: the card and the counter say the price, and where it rose, why', () => {
  it('a material taken unknown says its worth; one taken known says it is more now that it is known what it does', () => {
    const before = take(iron(), 'card:before');
    write(iron(), 'minor');
    const after = take(iron(), 'card:after');
    expect(worthSaid(before)).toBe('60 G');
    expect(worthSaid(after)).toBe('65 G, more now that it is known what it does');
    expect(inspectItem(after).rows).toContainEqual(['Worth', '65 G, more now that it is known what it does']);
    expect(inspectItem(before).rows).toContainEqual(['Worth', '60 G']);
  });

  it('a thing made of a known material says so; a read piece with lines says so; a plain one does not', () => {
    write(iron(), 'minor');
    const ingot = { ...take(iron(), 'ingot'), composition: smelt([take(iron(), 'x'), take(iron(), 'y')]) };
    ingot.value = CompositionSystem.priceOf(ingot.composition);
    expect(worthSaid(ingot)).toBe(`${ingot.value} G, more now that it is known what it does`);
    const base = ITEM_DEFINITIONS.weapon_bases.find(b => b.kind)!;
    const lined = ItemFactory.createFromTemplate(base, true, Rng.fromKey('card:lined'), undefined, UniversalRank.F, { depth: 1, band: 'minor' });
    const plain = ItemFactory.createFromTemplate(base, true, Rng.fromKey('card:plain'), undefined, UniversalRank.F, { depth: 0 });
    expect(worthSaid(lined)).toBe(`${lined.value} G, more now that it is known what it does`);
    expect(worthSaid(plain)).toBe(`${plain.value} G`);
    expect(lined.type).toBe(ItemType.GEAR);
  });

  it('the counter says it with the same words', () => {
    const canvas = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
    expect(canvas).toContain('worthSaid(item)');
    expect(canvas).not.toContain('G listed value');
    // The bank's own sell button shows what the counter will pay, guard and premium and all
    const bank = readFileSync('src/components/PlayerHub.tsx', 'utf8');
    expect(bank).toContain('SELL {offerFor(selected)}G');
    expect(bank).not.toContain('vendorOffer(selected.value');
  });
});

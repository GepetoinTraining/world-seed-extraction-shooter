/**
 * THE WEEK (D115), Pedro: "The value is a large number, but the good don't cost anything at all,
 * they all cost when they're broken down to be reproduced".
 *
 * Time in stock goes by rank and rarity. What does not sell is salvaged, and what it was expected
 * to fetch less what its components are worth is the week's cost for a keeper of the centre. The
 * guild balances that, and takes what a shop earns over what it spends. People at the bench are
 * paid. The next week's stock is what sold, and new attempts. And: "tech per tile is a general
 * tax, EVERYONE BUT the city center pays it, weekly as well".
 *
 * Patterns read, not ported: the donor's weekly market tick, a merchant's weekly book (market.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();

vi.mock('../src/entities/data/VectorStore', () => ({
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

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../types';
import { useHubStore, worldDay } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Treasury } from '../src/logic/economy/Treasury';
import { Ledger } from '../src/logic/ledger/Ledger';
import { ShopWeek } from '../src/logic/economy/ShopWeek';
import { VendorSystem } from '../src/logic/systems/VendorSystem';
import { WebSystem } from '../src/logic/systems/WebSystem';
import { StatSystem } from '../src/logic/systems/StatSystem';
import { installShippedThemes, FIRST_THEME_PACK } from '../src/logic/theme/boot';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { residentUpkeepPerDay } from '../src/entities/hub/guild';
import { readFileSync } from 'fs';

const UID = 'uid_week';
const HUB = 'hub_week';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const KEEPERS = ['npc_weapon_vendor', 'npc_armor_vendor', 'npc_alchemist'];
const shelves = () => [...hub().weaponShop, ...hub().armorShop, ...hub().consumableShop];

let minted = 0;
const thing = (over: Partial<IItem> = {}): IItem => ({
  id: `thing_${++minted}`, universalDefinitionId: 'res_tree_log', name: 'Oak Log', description: '', type: ItemType.RESOURCE, slot: SlotType.NONE,
  rank: UniversalRank.F, rarity: Rarity.COMMON, level: 1, quality: 0, value: 10, itemPower: 0, tags: ['wood', 'building', 'flora'], affixes: [],
  dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'x', colorHex: '#000000' }, icon: 'x', history: { dropDate: 0, killCount: 0 }, isIdentified: true,
  ...over
} as IItem);

const give = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...items] } : t) } }
}));
const grant = async (gold: number) => {
  usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + gold } } }));
  await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: gold });
};
const rowsOf = async (type: string) => (await Ledger.listAll()).map(r => r.payload).filter(p => p.type === type);
const nextWeek = () => worldDay() + ShopWeek.WEEK_DAYS;

beforeEach(async () => {
  db.clear();
  minted = 0;
  installShippedThemes();
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'WEEK' } } as any });
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'WEEK', rank: UniversalRank.F, skillProgress: {},
      bank: { ...s.player.bank, gold: 0, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) }
    }
  }));
  useHubStore.setState({ rooms: {}, weaponShop: [], armorShop: [], consumableShop: [] });
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
  await hub().loadHub(HUB);
});

describe('"first you need to have a time per rank and per rarity they are kept in stock"', () => {
  it('a plain thing is kept a week, and higher rank or rarer is kept longer', () => {
    expect(ShopWeek.stockDays(UniversalRank.F, Rarity.COMMON)).toBe(7);
    expect(ShopWeek.stockDays(UniversalRank.D, Rarity.COMMON)).toBeGreaterThan(ShopWeek.stockDays(UniversalRank.E, Rarity.COMMON));
    expect(ShopWeek.stockDays(UniversalRank.F, Rarity.RARE)).toBeGreaterThan(ShopWeek.stockDays(UniversalRank.F, Rarity.UNCOMMON));
  });

  it('"the rarer and higher rank, the more unique it is"', () => {
    expect(ShopWeek.uniqueness(UniversalRank.F, Rarity.COMMON)).toBe(0);
    expect(ShopWeek.uniqueness(UniversalRank.C, Rarity.RARE)).toBeGreaterThan(ShopWeek.uniqueness(UniversalRank.C, Rarity.COMMON));
    expect(ShopWeek.uniqueness(UniversalRank.C, Rarity.RARE)).toBeGreaterThan(ShopWeek.uniqueness(UniversalRank.F, Rarity.RARE));
  });

  it('a keeper holds a rare piece past the day it takes a plain one apart', () => {
    const tools = { recipes: [], salvage: () => [thing({ value: 1 })], make: () => [] };
    const plain = thing({ id: 'plain' });
    const rare = thing({ id: 'rare', rarity: Rarity.RARE, rank: UniversalRank.C });
    const start = { ...VendorSystem.fresh('k', 'GENERAL', 100), listed: [plain, rare], since: { plain: 100, rare: 100 } };
    const { record } = VendorSystem.work(start, 107, 0, tools);
    expect(record.listed.map(i => i.id)).toEqual(['rare']);
  });
});

describe('"that difference between expected win and component is the weekly cost"', () => {
  it('a piece taken apart books what it would have fetched, less its components', () => {
    const tools = { recipes: [], salvage: () => [thing({ value: 30 })], make: () => [] };
    const piece = thing({ id: 'p', value: 100 });
    const start = { ...VendorSystem.fresh('k', 'GENERAL', 100), listed: [piece], since: { p: 100 } };
    const { record } = VendorSystem.work(start, 107, 0, tools);
    expect(record.book.loss).toBe(100 * 1.5 - 30);
  });

  it('components worth more than was expected cost nothing, and pay nothing', () => {
    expect(ShopWeek.lossOf(100, 500)).toBe(0);
    expect(ShopWeek.lossOf(100, 40)).toBe(60);
  });

  it('goods sitting on a shelf cost nothing: an unbroken week with nothing sold moves no coin but the running', async () => {
    const before = await Treasury.balance(HUB);
    await hub().resolveRunning(worldDay() + 1);
    expect(await Treasury.balance(HUB)).toBe(before - hub().runningBook().floorPerDay);
    expect(KEEPERS.every(k => (hub().vendors[k]?.book?.loss ?? 0) === 0)).toBe(true);
  });

  it('at the week\'s close what stayed on the shelf comes apart, its parts are the keeper\'s, and the loss is a signed cost', async () => {
    const unsold = shelves().reduce((s, l) => s + l.stock, 0);
    expect(unsold).toBeGreaterThan(0);
    await hub().resolveRunning(nextWeek());
    expect(KEEPERS.some(k => (hub().vendors[k]?.parts.length ?? 0) > 0)).toBe(true);
    const rows = (await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'SHOP_WEEK');
    expect(rows.length).toBe(1);
    expect(rows[0].data.loss).toBeGreaterThan(0);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('only the centre: a master\'s own shop books nothing to the guild', async () => {
    const trader = VendorSystem.fresh('crf_x', 'TRADER', worldDay());
    useHubStore.setState(s => ({ vendors: { ...s.vendors, crf_x: { ...trader, book: { earned: 0, counter: 0, loss: 5_000 } } } }));
    await hub().resolveRunning(nextWeek());
    const row = (await rowsOf('GOLD_DELTA')).find(r => r.data.reason === 'SHOP_WEEK')!;
    expect(row.data.wallets.crf_x).toBeUndefined();
    expect(row.data.shops.some((s: any) => s.npcId === 'crf_x')).toBe(false);
    expect(hub().guild.lastWeek?.shops.some(s => s.npcId === 'crf_x')).toBe(false);
  });
});

describe('"then the guild balances the shops budget out for the cost"', () => {
  it('a loss with nothing earned: the guild pays the whole of it to the keeper', () => {
    const s = ShopWeek.settle({ earned: 0, counter: 0, loss: 100 }, 0);
    expect(s).toMatchObject({ toKeeper: 100, toGuild: 0 });
  });

  it('"when the shop earns more than it spends that money gets added to the guild"', () => {
    expect(ShopWeek.settle({ earned: 500, counter: 100, loss: 100 }, 50)).toMatchObject({ toKeeper: 0, toGuild: 250 });
  });

  it('part earned, part short: the guild pays only the rest', () => {
    expect(ShopWeek.settle({ earned: 150, counter: 100, loss: 100 }, 0)).toMatchObject({ toKeeper: 50, toGuild: 0 });
  });

  it('a counter or a wage the shop could not earn back deepens nothing twice', () => {
    expect(ShopWeek.settle({ earned: 0, counter: 500, loss: 100 }, 70)).toMatchObject({ toKeeper: 100, toGuild: 0 });
  });

  it('coin moves on one row, from the treasury to keepers\' wallets, and the audit adds it up', async () => {
    const treasury = await Treasury.balance(HUB);
    const wallets = { ...hub().wallets };
    const floor = hub().runningBook().floorPerDay * ShopWeek.WEEK_DAYS;
    await hub().resolveRunning(nextWeek());
    const row = (await rowsOf('GOLD_DELTA')).find(r => r.data.reason === 'SHOP_WEEK')!;
    const paid = row.data.shops.reduce((sum: number, s: any) => sum + s.toKeeper + s.pay, 0);
    expect(paid).toBeGreaterThan(0);
    const prints = (await rowsOf('PRINT')).reduce((sum, p) => sum + p.data.amount, 0);
    expect(await Treasury.balance(HUB)).toBe(treasury + prints - floor - paid);
    for (const shop of row.data.shops) expect(hub().wallets[shop.npcId]).toBeGreaterThanOrEqual(wallets[shop.npcId] + shop.toKeeper);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a sale goes on the keeper\'s book, and its coin is the guild\'s already', async () => {
    const row = hub().weaponShop.find(l => l.stock >= 1)!;
    await grant(1_000_000);
    const treasury = await Treasury.balance(HUB);
    expect(hub().purchaseFromShop(row.id, 'weapon')).toBeTruthy();
    const price = 1_000_000 - player().bank.gold;
    await new Promise(r => setTimeout(r, 0));
    await hub().saveHubState();
    expect(await Treasury.balance(HUB)).toBe(treasury + price);
    expect(hub().vendors.npc_weapon_vendor.book.earned).toBe(price);
  });

  it('what the counter pays goes on the book as well', async () => {
    const item = thing({ value: 100 });
    give([item]);
    const paid = await hub().sellToVendor(item.id);
    expect(hub().vendors.npc_weapon_vendor.book.counter).toBe(paid);
  });

  it('a week closes once, and a hub away for three closes three', async () => {
    await hub().resolveRunning(nextWeek());
    await hub().resolveRunning(nextWeek());
    expect((await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'SHOP_WEEK')).toHaveLength(1);
    await hub().resolveRunning(worldDay() + ShopWeek.WEEK_DAYS * 3);
    expect((await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'SHOP_WEEK')).toHaveLength(3);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a hub saved before this starts its week now and owes nothing behind it', async () => {
    const doc = hub().hubDoc()!;
    const { week: _gone, ...guild } = doc.data.guild;
    db.set(doc.id, { ...doc, data: { ...doc.data, guild } });
    await hub().loadHub(HUB);
    expect(hub().guild.week).toBe(ShopWeek.weekOf(worldDay()));
    expect((await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'SHOP_WEEK')).toHaveLength(0);
  });
});

describe('"restocking is based on items sold and what stock is needed ... + new attempts"', () => {
  it('in its first week a shelf opens as it always has', () => {
    const fresh = VendorSystem.fresh('k', 'GENERAL', 1);
    const line = { id: 'l', item: thing(), price: 10, vendorId: 'x', stock: 4 };
    expect(VendorSystem.shelf(fresh, [line], 1, 0)[0].stock).toBe(4);
  });

  it('after that a line holds what sold of it, and one new attempt', () => {
    const closed = { ...VendorSystem.fresh('k', 'GENERAL', 1), weeks: 1, soldLast: { sold3: 3 } };
    const line = (id: string) => ({ id, item: thing(), price: 10, vendorId: 'x', stock: 9 });
    const [sold, unsold] = VendorSystem.shelf(closed, [line('sold3'), line('none')], 8, 0);
    expect(sold.stock).toBe(4);
    expect(unsold.stock).toBe(1);
  });

  it('what sold this week stays sold until the week turns, whatever day it is', () => {
    const line = { id: 'l', item: thing(), price: 10, vendorId: 'x', stock: 5 };
    const sold = VendorSystem.recordSale(VendorSystem.fresh('k', 'GENERAL', 1), 'l', 1, 1);
    expect(VendorSystem.shelf(VendorSystem.fold(sold, 3), [line], 3, 0)[0].stock).toBe(4);
  });

  it('with nobody coming the shelf falls to its attempts, so the second week costs less', async () => {
    await hub().resolveRunning(nextWeek());
    const first = hub().guild.lastWeek!.shops.reduce((s, x) => s + x.loss, 0);
    expect(shelves().filter(l => !l.held).every(l => l.stock <= 2)).toBe(true);
    await hub().resolveRunning(worldDay() + ShopWeek.WEEK_DAYS * 2);
    const second = hub().guild.lastWeek!.shops.reduce((s, x) => s + x.loss, 0);
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThan(0);
  });

  it('"choice items sold by adventurers at a premium": the counter pays more for a kind that has been selling', async () => {
    const item = thing({ value: 100, universalDefinitionId: 'res_wanted' });
    const plain = hub().offerFor(item);
    expect(plain).toBe(StatSystem.vendorOffer(100, player().attributes));
    const today = Math.floor(Date.now() / 86_400_000);
    useHubStore.setState(s => ({ vendors: { ...s.vendors, npc_weapon_vendor: { ...VendorSystem.fresh('npc_weapon_vendor', 'GENERAL', today), demand: { res_wanted: today } } } }));
    expect(hub().offerFor(item)).toBeGreaterThan(plain);
    give([item]);
    expect(await hub().sellToVendor(item.id)).toBe(hub().offerFor(item));
  });

  it('the premium stays under what a shelf asks, so nobody stands between them for coin', () => {
    expect(StatSystem.vendorOffer(100, player().attributes) * ShopWeek.CHOICE_PREMIUM).toBeLessThan(150);
  });
});

describe('"they incure the weekly cost of a person at an apprentice\'s pay"', () => {
  const bench = (entityId: string, masterId = 'npc_weapon_vendor', rank = 'APPRENTICE') => ({
    id: `crf_seed_${entityId}`, name: entityId, bond: { worldSeed: 'seed', entityId, webVersion: 1, rank: UniversalRank.D, rarity: Rarity.RARE, sheet: {} },
    bondItemId: `bond_${entityId}`, sponsorId: UID, sponsorName: 'WEEK', masterId, done: [], rank, since: worldDay(), skill: { id: 'skill_x', tags: [], level: 1, currentXp: 0 }
  }) as any;

  it('pay is a person\'s own living for a week', () => {
    expect(ShopWeek.apprenticePay(UniversalRank.D)).toBe(residentUpkeepPerDay(UniversalRank.D) * 7);
  });

  it('a person at the bench is paid, into their own wallet, and the keeper\'s book carries it', async () => {
    useHubStore.setState(s => ({ craftsmen: [bench('p1')] }));
    await hub().settleWallets();
    const before = hub().wallets.res_seed_p1;
    await hub().resolveRunning(nextWeek());
    const pay = ShopWeek.apprenticePay(UniversalRank.D);
    expect(hub().wallets.res_seed_p1).toBe(before + pay);
    expect(hub().guild.lastWeek!.shops.find(s => s.npcId === 'npc_weapon_vendor')!.pay).toBe(pay);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('"the more people working the costlier it gets"', async () => {
    useHubStore.setState(s => ({ craftsmen: [bench('p1'), bench('p2'), bench('p3')] }));
    await hub().settleWallets();
    await hub().resolveRunning(nextWeek());
    expect(hub().guild.lastWeek!.shops.find(s => s.npcId === 'npc_weapon_vendor')!.pay).toBe(3 * ShopWeek.apprenticePay(UniversalRank.D));
  });

  it('a master with a shop of their own is nobody\'s wage', async () => {
    useHubStore.setState(s => ({ craftsmen: [bench('p1', 'npc_weapon_vendor', 'MASTER')] }));
    await hub().settleWallets();
    await hub().resolveRunning(nextWeek());
    expect(hub().guild.lastWeek!.shops.find(s => s.npcId === 'npc_weapon_vendor')!.pay).toBe(0);
  });
});

describe('"tech per tile is a general tax, EVERYONE BUT the city center pays it, weekly as well"', () => {
  const skillFor = (name: string) => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === FIRST_THEME_PACK.themeId && d.name === name)!;
    const tags = WebSystem.materialIdentity(def.tags ?? []);
    return { def, web: { nodes: { [`skill_${tags.join('+')}`]: { id: `skill_${tags.join('+')}`, tags, rank: 0, firstBy: { uid: 'u', name: 'U', at: 0 }, rungRecord: { uid: 'u', name: 'U', at: 0, rung: 0 } } } } };
  };
  const richCity = (cap = 1_280) => {
    // Gathered by hand, so no shelf's salvage adds to it and the cap holds still
    const { def, web } = skillFor("Teller's Reed");
    give([thing({ universalDefinitionId: def.id, value: cap })]);
    useHubStore.setState({ web });
  };
  const ownedLot = () => {
    const lot = [...hub().lots].filter(l => !l.ownerId).sort((a, b) => a.price - b.price)[0];
    useHubStore.setState(s => ({ lots: s.lots.map(l => l.id === lot.id ? { ...l, ownerId: UID, ownerName: 'WEEK', upkeepPaidThroughDay: 1e9 } : l) }));
    return lot.id;
  };

  it('tech no longer raises a centre building: its upkeep is its floor', () => {
    richCity(1_000_000);
    const buildings = hub().runningBook().lines.filter(l => l.why === 'BUILDING');
    for (const line of buildings) expect(line.amount).toBe(line.tiles);
  });

  it('a person pays tiles held times tech per tile, from their own gold', async () => {
    richCity(1_280); // 10 a tile over the centre's 128
    const lotId = ownedLot();
    const tiles = hub().taxBook().lots.find(l => l.lotId === lotId)!.tiles;
    await grant(1_000_000);
    await hub().resolveRunning(nextWeek());
    const rows = (await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'CITY_TAX');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.amount).toBe(-tiles * 10);
    expect(rows[0].data.treasuryDelta).toBe(tiles * 10);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('no tech, no tax', async () => {
    useHubStore.setState({ web: { nodes: {} } });
    ownedLot();
    await grant(1_000);
    await hub().resolveRunning(nextWeek());
    expect(player().bank.gold).toBe(1_000);
  });

  it('free ground is the hub\'s own, and pays nobody', () => {
    richCity();
    expect(hub().taxBook().lots).toHaveLength(0);
  });

  it('a resident pays from their own wallet, and it moves on a row', async () => {
    richCity(1_280);
    const lot = hub().lots.find(l => !l.ownerId)!;
    const bond = { worldSeed: 's', entityId: 'e', webVersion: 1, rank: UniversalRank.F, rarity: Rarity.COMMON, sheet: { name: 'N', temperament: 'PASSIVE', objective: 'HOARD', want: 'GOLD', disposition: 50, attempts: 0 } } as any;
    useHubStore.setState(s => ({
      lots: s.lots.map(l => l.id === lot.id ? { ...l, ownerId: 'GUILD', ownerName: 'N', upkeepPaidThroughDay: 1e9 } : l),
      guild: { ...s.guild, residents: [{ id: 'res_s_e', bondItemId: 'b', bond, worldSeed: 's', entityId: 'e', name: 'N', sponsorId: UID, sponsorName: 'WEEK', arrivedAt: 1, lotId: lot.id, wantsMet: 0 }] }
    }));
    await hub().settleWallets();
    const tiles = hub().taxBook().lots[0].tiles;
    const owed = tiles * 10;
    await Ledger.append('TRADE', { kind: 'TEST_WALLET', playerDelta: 0, treasuryDelta: 0, wallets: {} });
    const held = hub().wallets.res_s_e;
    await hub().resolveRunning(nextWeek());
    expect(hub().wallets.res_s_e).toBe(held >= owed ? held - owed : held);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('someone who cannot pay keeps their ground: the debt waits', async () => {
    richCity(128_000);
    const lotId = ownedLot();
    await hub().resolveRunning(nextWeek());
    expect(player().bank.gold).toBe(0);
    expect(hub().lots.find(l => l.id === lotId)!.ownerId).toBe(UID);
    expect(hub().lots.find(l => l.id === lotId)!.taxPaidWeek).toBeLessThan(hub().guild.week!);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a debt is paid in full when it can be, for every week behind', async () => {
    richCity(1_280);
    const lotId = ownedLot();
    const tiles = hub().taxBook().lots.find(l => l.lotId === lotId)!.tiles;
    await hub().resolveRunning(worldDay() + ShopWeek.WEEK_DAYS * 2);
    expect(player().bank.gold).toBe(0);
    await grant(1_000_000);
    await hub().resolveRunning(worldDay() + ShopWeek.WEEK_DAYS * 3);
    expect(1_000_000 - player().bank.gold).toBe(tiles * 10 * 3);
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

describe('the fortnight, on the week\'s cost', () => {
  it('a new hub starts with 14 days of what it runs on: the floor, and two weeks of its shops\' cost', async () => {
    const book = hub().runningBook();
    expect(book.weekCost).toBeGreaterThan(0);
    expect(book.perDay).toBe(book.floorPerDay + Math.ceil(book.weekCost / 7));
    expect(await Treasury.balance(HUB)).toBe(14 * book.perDay);
  });

  it('it goes 14 days with nobody coming before it needs to print', async () => {
    await hub().resolveRunning(worldDay() + 14);
    expect(await rowsOf('PRINT')).toHaveLength(0);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('left alone long enough it prints, and goes on printing', async () => {
    await hub().resolveRunning(worldDay() + 700);
    expect((await rowsOf('PRINT')).length).toBeGreaterThan(1);
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

describe('the Hall shows the week', () => {
  it('the window reads the shops\' book', () => {
    const hall = readFileSync('src/components/GuildHall.tsx', 'utf8');
    expect(hall).toMatch(/lastWeek/);
    expect(hall).toMatch(/toKeeper/);
    expect(hall).toMatch(/toGuild/);
  });

  it('the counter window shows the offer it will really pay', () => {
    expect(readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8')).toMatch(/offerFor/);
  });
});

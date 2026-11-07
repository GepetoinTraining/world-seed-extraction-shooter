/**
 * THE IMMIGRANT (D115). Pedro: "every imigrant comes in with cash, and they only get a their plot
 * of land by human questing, because we need to provide their needs... So, what ends up happening
 * is they circulate money we bring the components from the outside they remove our time to craft
 * or time sink to learn".
 *
 * A person arrives with coin, wants things at once, and pays for them out of their own wallet,
 * which is how coin gets round without the Hall printing it. They have no ground until a human has
 * seen to them. Their coin going to players, and their time going back, is the loop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { priceOfListing, useHubStore, worldDay } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Treasury } from '../src/logic/economy/Treasury';
import { Ledger } from '../src/logic/ledger/Ledger';
import { ShopWeek } from '../src/logic/economy/ShopWeek';
import { Wallets } from '../src/logic/economy/Wallets';
import { keeperBrought, walletBrought } from '../src/entities/hub/money';
import { VendorSystem } from '../src/logic/systems/VendorSystem';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { installShippedThemes, FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { residentUpkeepPerDay } from '../src/entities/hub/guild';
import { readFileSync } from 'fs';

const UID = 'uid_arrive';
const HUB = 'hub_arrive';
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
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'ARRIVE' } } as any });
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'ARRIVE', rank: UniversalRank.F, skillProgress: {},
      bank: { ...s.player.bank, gold: 0, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) }
    }
  }));
  useHubStore.setState({ rooms: {}, weaponShop: [], armorShop: [], consumableShop: [] });
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
  await hub().loadHub(HUB);
});

const bondOf = (entityId = 'person_1', rank = UniversalRank.D): IItem => thing({
  id: `bond_${++minted}`, universalDefinitionId: 'npc_contract', name: 'Escort Bond', type: ItemType.LORE, rarity: Rarity.RARE, rank, value: 200, tags: ['npc_contract', 'social'],
  bondData: { worldSeed: 'seed_arrive', entityId, webVersion: 1, rank, rarity: Rarity.RARE, sheet: { name: 'Serin Vale', temperament: 'COWARD', objective: 'HOARD', want: 'GIFT', disposition: 80, attempts: 3 } }
} as any);
const lodge = async (entityId = 'person_1', rank = UniversalRank.D) => {
  const bond = bondOf(entityId, rank);
  give([bond]);
  expect(await hub().redeemBond(bond.id)).toEqual({ ok: true });
  return hub().guild.residents.find(r => r.entityId === entityId)!;
};
const freeLot = () => [...hub().lots].filter(l => !l.ownerId).sort((a, b) => a.price - b.price)[0];
const stash = () => player().bank.stashTabs[0].items;
/** What their want asks, at this value each, in the stash. */
const answer = (quest: { tag: string; count: number }, value: number) => {
  const items = Array.from({ length: quest.count }, () => thing({ tags: [quest.tag], value }));
  give(items);
  return items.map(i => i.id);
};
const meetWant = async (residentId: string, value = 1) => {
  const quest = hub().guild.quests.find(q => q.residentId === residentId && q.state === 'OPEN')!;
  expect(await hub().fulfilQuest(quest.id, answer(quest, value))).toEqual({ ok: true });
};
const allCoin = async () => await Treasury.balance(HUB) + player().bank.gold + Object.values(hub().wallets).reduce((s, n) => s + n, 0);

describe('"every imigrant comes in with cash"', () => {
  it('a keeper of the city is not a survivor, and comes with weeks of living', () => {
    const amounts = Array.from({ length: 200 }, (_, i) => keeperBrought(`npc_${i}`, UniversalRank.D));
    expect(Math.min(...amounts)).toBeGreaterThanOrEqual(14 * residentUpkeepPerDay(UniversalRank.D));
    expect(Math.max(...amounts)).toBeLessThanOrEqual(56 * residentUpkeepPerDay(UniversalRank.D));
  });

  it('survivors carrying their riches: years of their own living, keyed to them, and more for someone of higher rank', () => {
    const amounts = Array.from({ length: 200 }, (_, i) => walletBrought(`res_${i}`, UniversalRank.D));
    expect(Math.min(...amounts)).toBeGreaterThanOrEqual(365 * residentUpkeepPerDay(UniversalRank.D));
    expect(Math.max(...amounts)).toBeGreaterThan(2 * 365 * residentUpkeepPerDay(UniversalRank.D));
    expect(walletBrought('res_a', UniversalRank.D)).toBe(walletBrought('res_a', UniversalRank.D));
    expect(walletBrought('res_a', UniversalRank.A)).toBeGreaterThan(walletBrought('res_a', UniversalRank.F));
  });

  it('it comes with them when they are lodged, on a signed row', async () => {
    const resident = await lodge();
    expect(hub().wallets[resident.id]).toBe(walletBrought(resident.id, UniversalRank.D));
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

describe('"they only get a their plot of land by human questing, because we need to provide their needs"', () => {
  it('they want something from the day they arrive, at the tavern, with no door of their own', async () => {
    const resident = await lodge();
    expect(resident.lotId).toBeNull();
    expect(hub().guild.quests.some(q => q.residentId === resident.id && q.state === 'OPEN')).toBe(true);
  });

  it('no ground until a human has seen to them, and the Hall says why', async () => {
    const resident = await lodge();
    const res = await hub().guildBuyLot(resident.id, freeLot().id);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/seen to|needs|wants/i);
    expect(hub().guild.residents.find(r => r.id === resident.id)!.lotId).toBeNull();
  });

  it('a want met by a person opens the way to ground', async () => {
    const resident = await lodge();
    await meetWant(resident.id);
    expect(await hub().guildBuyLot(resident.id, freeLot().id)).toEqual({ ok: true });
  });

  it('what they were brought before they had ground stays theirs, and moves in with them', async () => {
    const resident = await lodge();
    const quest = hub().guild.quests.find(q => q.residentId === resident.id)!;
    const ids = answer(quest, 1);
    await hub().fulfilQuest(quest.id, ids);
    expect(hub().guild.residents.find(r => r.id === resident.id)!.belongings!.map(i => i.id).sort()).toEqual([...ids].sort());
    const lot = freeLot();
    await hub().guildBuyLot(resident.id, lot.id);
    const after = hub().guild.residents.find(r => r.id === resident.id)!;
    expect(after.belongings ?? []).toHaveLength(0);
    expect(hub().lots.find(l => l.id === lot.id)!.inventory.map(i => i.id).sort()).toEqual([...ids].sort());
  });

  it('someone the road made a master has been seen to already', async () => {
    const bond = bondOf('person_m');
    useHubStore.setState(s => ({ guild: { ...s.guild, residents: [{
      id: 'res_m', bondItemId: bond.id, bond: bond.bondData!, worldSeed: 's', entityId: 'person_m', name: 'M', sponsorId: UID, sponsorName: 'ARRIVE', arrivedAt: 1, lotId: null, wantsMet: 0, craftsmanId: 'crf_m'
    }] } }));
    expect(await hub().guildBuyLot('res_m', freeLot().id)).toEqual({ ok: true });
  });

  it('someone who goes to a bench takes their want off the board', async () => {
    let resident = await lodge('person_0');
    for (let i = 1; !(await hub().takeApprentice('npc_weapon_vendor', resident.id)).ok; i++) {
      expect(i).toBeLessThan(50);
      resident = await lodge(`person_${i}`);
    }
    expect(hub().guild.quests.some(q => q.residentId === resident.id && q.state === 'OPEN')).toBe(false);
  });
});

describe('"they circulate money"', () => {
  it('a want is paid from the person\'s own wallet: the treasury does not move and nothing is printed', async () => {
    const resident = await lodge();
    const held = hub().wallets[resident.id];
    const treasury = await Treasury.balance(HUB);
    const coin = await allCoin();
    await meetWant(resident.id, 1);
    const paid = player().bank.gold;
    expect(paid).toBeGreaterThan(0);
    expect(hub().wallets[resident.id]).toBe(held - paid);
    expect(await Treasury.balance(HUB)).toBe(treasury);
    expect(await rowsOf('PRINT')).toHaveLength(0);
    expect(await allCoin()).toBe(coin);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('the row says whose coin it was', async () => {
    const resident = await lodge();
    await meetWant(resident.id, 1);
    const row = (await rowsOf('GOLD_DELTA')).find(r => r.data.reason === 'QUEST_PAID')!;
    expect(row.data.wallets[resident.id]).toBe(-row.data.amount);
    expect(row.data.treasuryDelta === 0).toBe(true);
  });

  // Pedro: "that's the LITERAL MECHANISM OF MASLOW". What a person cannot afford, they go without.
  it('a want past their wallet waits: nobody covers it, and nothing moves', async () => {
    const resident = await lodge();
    const held = hub().wallets[resident.id];
    const treasury = await Treasury.balance(HUB);
    const quest = hub().guild.quests.find(q => q.residentId === resident.id && q.state === 'OPEN')!;
    const ids = answer(quest, 1_000_000);
    const res = await hub().fulfilQuest(quest.id, ids);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/pay|afford|holds/i);
    expect(hub().wallets[resident.id]).toBe(held);
    expect(await Treasury.balance(HUB)).toBe(treasury);
    expect(player().bank.gold).toBe(0);
    expect(await rowsOf('PRINT')).toHaveLength(0);
    expect(hub().guild.quests.find(q => q.id === quest.id)!.state).toBe('OPEN');
    for (const id of ids) expect(stash().some(i => i.id === id)).toBe(true);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('so they stay at the tavern with no ground, until someone brings what they can afford', async () => {
    const resident = await lodge();
    const quest = hub().guild.quests.find(q => q.residentId === resident.id && q.state === 'OPEN')!;
    await hub().fulfilQuest(quest.id, answer(quest, 1_000_000));
    expect((await hub().guildBuyLot(resident.id, freeLot().id)).ok).toBe(false);
    expect(await hub().fulfilQuest(quest.id, answer(quest, 1))).toEqual({ ok: true });
    expect(await hub().guildBuyLot(resident.id, freeLot().id)).toEqual({ ok: true });
  });

  it('exactly all they hold is enough, and leaves them with nothing', async () => {
    const resident = await lodge();
    const quest = hub().guild.quests.find(q => q.residentId === resident.id && q.state === 'OPEN')!;
    const held = hub().wallets[resident.id];
    useHubStore.setState(s => ({ guild: { ...s.guild, quests: s.guild.quests.map(q => q.id === quest.id ? { ...q, count: 1, payShare: 1 } : q) } }));
    const item = thing({ tags: [quest.tag], value: held });
    give([item]);
    expect(await hub().fulfilQuest(quest.id, [item.id])).toEqual({ ok: true });
    expect(hub().wallets[resident.id]).toBe(0);
    expect(player().bank.gold).toBe(held);
  });

  it('a want is no road to a print: the Hall does not read the treasury for it', () => {
    const src = readFileSync('src/entities/hub/store.ts', 'utf8');
    const door = src.slice(src.indexOf('fulfilQuest: async'), src.indexOf('passTrial: async'));
    expect(door).not.toMatch(/printsNeeded|printRows|Treasury\.|treasury:/);
  });

  it('the wallet on the books and in the store agree', async () => {
    const resident = await lodge();
    await meetWant(resident.id, 1);
    expect(await Wallets.balance(HUB, resident.id)).toBe(hub().wallets[resident.id]);
  });
});

describe('what the windows say', () => {
  it('the board says the person pays, and the Hall says why someone has no ground', () => {
    const hall = readFileSync('src/components/GuildHall.tsx', 'utf8');
    expect(hall).not.toMatch(/The hub pays/);
    expect(hall).toMatch(/mayHaveGround/);
  });

  it('the board says in words when they cannot afford it, and the button will not press', () => {
    const hall = readFileSync('src/components/GuildHall.tsx', 'utf8');
    expect(hall).toMatch(/affordable/);
    expect(hall).toMatch(/It waits/);
  });

  it('Vex no longer says the Hall buys on the treasury\'s word alone', () => {
    expect(readFileSync('src/entities/hub/dialogue.ts', 'utf8')).toMatch(/seen to|see to/i);
  });
});
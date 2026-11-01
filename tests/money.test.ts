/**
 * STREAM C3's BARS, registered before the build: line 151, D108, D115.
 *
 * Pedro, at the stream's start: "NPCs don't know inflation, they feel it because human
 * players don't come.... don't code for inflation". And: "if it needs to print it does,
 * always a 14 day of the cost, that's what makes inflation terrible, the players need to
 * circumvent it or find another coin".
 *
 * A hub starts with 14 days of what it runs on, pays that to its people day by day, and when
 * it falls short it prints 14 more days, as a signed row. Everyone has a wallet. Things found
 * in worlds hold their worth, and a player can ask for one in place of coin. The audit adds
 * all of it back up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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
import { BiomeType, EntityType } from '../src/entities/world/types';
import { useWorldStore } from '../src/entities/world/store';
import { useHubStore, worldDay } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Treasury } from '../src/logic/economy/Treasury';
import { Wallets } from '../src/logic/economy/Wallets';
import { Anchors } from '../src/logic/economy/Anchors';
import { Ledger } from '../src/logic/ledger/Ledger';
import { StatSystem } from '../src/logic/systems/StatSystem';
import { SalvageSystem } from '../src/logic/systems/SalvageSystem';
import { VendorSystem } from '../src/logic/systems/VendorSystem';
import { WebSystem } from '../src/logic/systems/WebSystem';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { compileTheme, sealTheme, themeIdOf } from '../src/logic/theme/ThemeCompiler';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { IThemeBody, THEME_SCHEMA } from '../src/logic/theme/ThemeTypes';
import { WebBank } from '../src/logic/content/WebBank';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { computeGolden } from '../src/entities/world/goldens';
import { LootTable } from '../src/entities/world/LootTable';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { HUB_NPCS } from '../src/entities/hub/HubGenerator';
import { emptyGuild, residentIdOf, residentUpkeepPerDay } from '../src/entities/hub/guild';
import { PRINT_DAYS, foldDays, printAmount, printsNeeded, walletBrought } from '../src/entities/hub/money';
import { MarketCap } from '../src/logic/economy/MarketCap';
import { CRAFTED_DEFINITIONS } from '../src/entities/economy/data/recipeDefinitions';

const UID = 'uid_money';
const HUB = 'hub_money';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const stash = () => player().bank.stashTabs[0].items;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

let minted = 0;
const thing = (over: Partial<IItem> = {}): IItem => ({
  id: `thing_${++minted}`,
  universalDefinitionId: 'res_tree_log',
  name: 'Oak Log',
  description: '',
  type: ItemType.RESOURCE,
  slot: SlotType.NONE,
  rank: UniversalRank.F,
  rarity: Rarity.COMMON,
  level: 1,
  quality: 0,
  value: 10,
  itemPower: 0,
  tags: ['wood', 'building', 'flora'],
  affixes: [],
  dimensions: { width: 1, height: 1 },
  weight: 1,
  stats: {},
  visuals: { modelId: 'x', colorHex: '#000000' },
  icon: 'x',
  history: { dropDate: 0, killCount: 0 },
  isIdentified: true,
  ...over
} as IItem);

const bondOf = (entityId = 'person_1'): IItem => thing({
  id: `bond_${++minted}`,
  universalDefinitionId: 'npc_contract',
  name: 'Escort Bond: Serin Vale',
  type: ItemType.LORE,
  rarity: Rarity.RARE,
  rank: UniversalRank.D,
  value: 200,
  tags: ['npc_contract', 'social'],
  bondData: {
    worldSeed: 'seed_money',
    entityId,
    webVersion: 1,
    rank: UniversalRank.D,
    rarity: Rarity.RARE,
    sheet: { name: 'Serin Vale', temperament: 'COWARD', objective: 'HOARD', want: 'GIFT', disposition: 80, attempts: 3 }
  }
} as any);

const give = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...items] } : t) } }
}));
const setGold = (gold: number) => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold } } }));
/** Coin given to the test person, on a row, so the audit still has something true to check. */
const grant = async (gold: number) => {
  setGold(player().bank.gold + gold);
  await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: gold });
};

const rowsOf = async (type: string) => (await Ledger.listAll()).map(r => r.payload).filter(p => p.type === type);
const drainTreasury = async () => {
  const held = await Treasury.balance(HUB);
  await Treasury.credit(HUB, -held);
  // The same amount has to leave the books too, or the audit is rightly unhappy
  await Ledger.append('GOLD_DELTA', { reason: 'TEST_DRAIN', amount: 0, treasuryId: HUB, treasuryDelta: -held });
};

const lodge = async (entityId = 'person_1') => {
  const bond = bondOf(entityId);
  give([bond]);
  expect(await hub().redeemBond(bond.id)).toEqual({ ok: true });
  // No ground until a human has seen to them (tests/immigrants.test.ts holds that). These bars start after it.
  useHubStore.setState(s => {
    const id = s.guild.residents.find(r => r.entityId === entityId)!.id;
    return { guild: { ...s.guild, quests: s.guild.quests.filter(q => q.residentId !== id), residents: s.guild.residents.map(r => r.id === id ? { ...r, wantsMet: 1 } : r) } };
  });
  return hub().guild.residents.find(r => r.entityId === entityId)!;
};

const smallestFreeLot = () => [...hub().lots].filter(l => !l.ownerId).sort((a, b) => a.price - b.price)[0];

beforeEach(async () => {
  db.clear();
  minted = 0;
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'TALLY' } } as any });
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'TALLY', rank: UniversalRank.F, skillProgress: {},
      bank: { ...s.player.bank, gold: 0, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) }
    }
  }));
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
  await hub().loadHub(HUB);
});

const allSource = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? allSource(path) : /\.tsx?$/.test(name) ? [path] : [];
});

// ---------------------------------------------------------------------------
// WHAT A HUB RUNS ON, AND THE FLOAT
// ---------------------------------------------------------------------------

describe('D115: a hub starts with 14 days of what it runs on', () => {
  it('the number is Pedro\'s: 14', () => {
    expect(PRINT_DAYS).toBe(14);
  });

  it('it runs on the buildings of its centre and its free ground, read from what stands', () => {
    const { lines } = hub().runningBook();
    const free = hub().lots.filter(l => !l.ownerId).length;
    expect(free).toBeGreaterThan(0);
    const ground = lines.filter(l => l.why === 'GROUND').reduce((s, l) => s + l.amount, 0);
    expect(ground).toBe(free * 5);
    expect(hub().runningBook().floorPerDay).toBe(lines.reduce((s, l) => s + l.amount, 0));
  });

  it('a fresh hub\'s treasury is exactly that, and no fixed endowment stands anywhere', async () => {
    expect(await Treasury.balance(HUB)).toBe(14 * hub().runningNow());
    expect(readFileSync('src/entities/hub/store.ts', 'utf8')).not.toMatch(/HUB_ENDOWMENT_GOLD|100_000/);
  });

  it('a hub with more ground starts with more, because it runs on more', async () => {
    const before = hub().runningNow();
    const raised = await hub().raiseChunk('NORTH');
    if (raised.ok) expect(hub().runningNow()).toBeGreaterThan(before);
    else expect.fail(raised.reason);
  });

  it('ground a person holds is theirs to keep up, so the hub runs on less', async () => {
    const before = hub().runningNow();
    setGold(1_000_000);
    await hub().buyLot(smallestFreeLot().id);
    expect(hub().runningNow()).toBe(before - 5);
  });

  it('an existing hub keeps what it holds', async () => {
    db.clear();
    await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
    await Treasury.endow('hub_old', 100_000);
    await Treasury.credit('hub_old', 4_321);
    await hub().loadHub('hub_old');
    expect(await Treasury.balance('hub_old')).toBe(104_321);
  });
});

// ---------------------------------------------------------------------------
// BUILDINGS, THE WEB BY MARKET CAP, PER TILE OF THE CENTRE
// ---------------------------------------------------------------------------

describe('Pedro: "each one of the buildings in the city center need to have an upkeep value"', () => {
  beforeEach(() => installShippedThemes());

  const skillOf = (tags: string[]) => {
    const id = `skill_${tags.join('+')}`;
    return { id, tags, rank: 0, firstBy: { uid: 'u', name: 'U', at: 0 }, rungRecord: { uid: 'u', name: 'U', at: 0, rung: 0 } };
  };
  const webOf = (...tagSets: string[][]) => ({ nodes: Object.fromEntries(tagSets.map(tags => { const s = skillOf(tags); return [s.id, s]; })) });
  const defNamed = (name: string) => Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === FIRST_THEME_PACK.themeId && d.name === name)!;
  const craftedNamed = (name: string) => Object.values(CRAFTED_DEFINITIONS).find(d => d.name === name)!;
  const worked = (name: string) => WebSystem.materialIdentity(defNamed(name).tags ?? []);
  const piece = (defId: string, value: number) => thing({ universalDefinitionId: defId, value });
  const oak = () => defNamed('Compound Oak');
  const buildings = () => hub().runningBook().lines.filter(l => l.why === 'BUILDING');
  const clearStash = () => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) } } }));

  it('every building with a keeper has its own value, and it goes to its keeper', () => {
    const lines = buildings();
    expect(lines.map(l => l.who).sort()).toEqual(Object.keys(HUB_NPCS).sort());
    for (const line of lines) {
      expect(line.poiId, line.who).toBeTruthy();
      expect(line.tiles, line.who).toBeGreaterThan(0);
      expect(line.amount, line.who).toBeGreaterThan(0);
      expect(Number.isInteger(line.amount), line.who).toBe(true);
    }
  });

  it('a lamp or a fountain costs nothing here, and a lot is not a building of the centre', () => {
    const ids = buildings().map(l => l.poiId);
    expect(ids.some(id => /lamp|fountain|lot/.test(id!))).toBe(false);
  });

  it('a larger building costs more, by its tiles', () => {
    const lines = buildings();
    const large = lines.find(l => l.poiId === 'poi_tavern')!;
    const small = lines.find(l => l.poiId === 'poi_land_office')!;
    expect(large.tiles).toBe(20);
    expect(small.tiles).toBe(9);
    expect(large.amount).toBeGreaterThan(small.amount);
  });

  // ------ 1: "You can know how much by market cap over the items the skill produces"

  it('a skill produces what its hands bring in', () => {
    const produced = MarketCap.producedBy(worked('Compound Oak'));
    expect(produced.has(oak().id)).toBe(true);
    expect(produced.has(defNamed('Vault Stone').id)).toBe(false);
  });

  it('hands do not produce what a bench makes, though it shares their tag', () => {
    expect(MarketCap.producedBy(worked('Compound Oak')).has(craftedNamed('Ruled Plank').id)).toBe(false);
  });

  it('a trade produces what its bench makes from what it works, and not the raw material', () => {
    const tags = ['carpentry', ...worked('Compound Oak')];
    const produced = MarketCap.producedBy(tags);
    expect(produced.has(craftedNamed('Ruled Plank').id)).toBe(true);
    expect(produced.has(oak().id)).toBe(false);
    expect(produced.has(craftedNamed('Dressed Block').id)).toBe(false);
  });

  it('a skill\'s market cap is the value of what it produces, in the city, piece by piece', () => {
    const tags = worked('Compound Oak');
    const items = [piece(oak().id, 30), piece(oak().id, 12), piece(defNamed('Vault Stone').id, 500)];
    expect(MarketCap.ofSkill(tags, items)).toBe(42);
  });

  it('a web with no skills is worth nothing, and so is a skill nothing here was made by', () => {
    expect(MarketCap.ofWeb({ nodes: {} }, [piece(oak().id, 30)])).toBe(0);
    expect(MarketCap.ofWeb(webOf(worked('Compound Oak')), [])).toBe(0);
    expect(MarketCap.ofWeb(webOf(worked('Compound Oak')), [piece(defNamed('Vault Stone').id, 500)])).toBe(0);
  });

  it('two skills that bring in the same log do not make it two logs', () => {
    const one = webOf(worked('Compound Oak'));
    const two = webOf(worked('Compound Oak'), ['axe', ...worked('Compound Oak')]);
    expect(MarketCap.ofWeb(two, [piece(oak().id, 30)])).toBe(MarketCap.ofWeb(one, [piece(oak().id, 30)]));
  });

  it('the old guess is gone: a skill\'s rank and rung do not price the web', () => {
    const src = readFileSync('src/entities/hub/money.ts', 'utf8');
    expect(src).not.toMatch(/rungRecord|node\.rank/);
  });

  it('the city\'s market is its shelves, stores, rooms, keepers and whoever is here', () => {
    useHubStore.setState({ web: webOf(worked('Compound Oak')) });
    clearStash();
    expect(hub().runningBook().marketCap).toBe(0);
    give([piece(oak().id, 10)]);
    expect(hub().runningBook().marketCap).toBe(10);
    const lotId = smallestFreeLot().id;
    useHubStore.setState(s => ({ lots: s.lots.map(l => l.id === lotId ? {
      ...l, inventory: [piece(oak().id, 100)], shopListings: [{ item: piece(oak().id, 1_000), price: 1 }], heldInTrade: [piece(oak().id, 10_000)]
    } : l) }));
    expect(hub().runningBook().marketCap).toBe(11_110);
    useHubStore.setState(s => ({
      vendors: { ...s.vendors, keeper_x: { ...VendorSystem.fresh('keeper_x', 'GENERAL', 1), held: [piece(oak().id, 100_000)], listed: [piece(oak().id, 200_000)], parts: [piece(oak().id, 400_000)] } },
      rooms: { ...s.rooms, [lotId]: { placements: [{ item: piece(oak().id, 1_000_000) }] } as never }
    }));
    expect(hub().runningBook().marketCap).toBe(1_311_110);
    useHubStore.setState({ rooms: {} }); // a fresh hub's load does not clear them
  });

  // ------ 2: "Only the city center, not the full sprawl"

  it('the tiles are the centre\'s: its buildings, and no lot', () => {
    const lines = buildings();
    expect(hub().runningBook().tiles).toBe(lines.reduce((s, l) => s + l.tiles!, 0));
    expect(hub().runningBook().tiles).toBe(128);
  });

  it('tech per tile is the market cap over those tiles', () => {
    useHubStore.setState({ web: webOf(worked('Compound Oak')) });
    clearStash();
    give([piece(oak().id, 256)]);
    const book = hub().runningBook();
    expect(book.marketCap).toBe(256);
    expect(book.techPerTile).toBe(2);
  });

  it('raising a chunk spreads nothing: the sprawl does not thin the centre', async () => {
    useHubStore.setState({ web: webOf(worked('Compound Oak')) });
    clearStash();
    give([piece(oak().id, 12_800)]);
    const before = hub().runningBook();
    expect((await hub().raiseChunk('NORTH')).ok).toBe(true);
    const after = hub().runningBook();
    expect(after.tiles).toBe(before.tiles);
    expect(after.techPerTile).toBe(before.techPerTile);
    for (const line of after.lines.filter(l => l.why === 'BUILDING')) {
      expect(line.amount).toBe(before.lines.find(b => b.poiId === line.poiId)!.amount);
    }
  });

  it('so a chunk raised always costs more, however rich the web: the value rises', async () => {
    useHubStore.setState({ web: webOf(worked('Compound Oak')) });
    clearStash();
    give([piece(oak().id, 1_000_000)]);
    const before = hub().runningNow();
    expect((await hub().raiseChunk('NORTH')).ok).toBe(true);
    expect(hub().runningNow()).toBeGreaterThan(before);
  });

  it('a skill joining the web through its own door moves what the city costs', () => {
    useHubStore.setState({ web: { nodes: {} } });
    clearStash();
    give([piece(oak().id, 256)]);
    expect(hub().runningBook().marketCap).toBe(0);
    const tags = worked('Compound Oak');
    const skill = WebSystem.freshSkill(`skill_${tags.join('+')}`, tags, 0);
    const { web } = WebSystem.admit(hub().web, { uid: 'u', name: 'U' }, { [skill.id]: skill }, 1);
    useHubStore.setState({ web });
    expect(hub().runningBook().marketCap).toBe(256);
  });

  it('a day pays each keeper their own building\'s value', async () => {
    useHubStore.setState({ web: webOf(worked('Compound Oak')) });
    clearStash();
    give([piece(oak().id, 12_800)]);
    await hub().saveHubState();
    const lines = hub().runningBook().lines;
    const before = { ...hub().wallets };
    await hub().resolveRunning(worldDay() + 1);
    for (const id of Object.keys(HUB_NPCS)) {
      const owed = lines.filter(l => l.who === id).reduce((s, l) => s + l.amount, 0);
      expect(hub().wallets[id] - before[id], id).toBe(owed);
    }
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('the Hall shows each building\'s value', () => {
    const hall = readFileSync('src/components/GuildHall.tsx', 'utf8');
    expect(hall).toMatch(/runningBook/);
    expect(hall).toMatch(/techPerTile/);
    expect(hall).toMatch(/marketCap/);
  });
});

// ---------------------------------------------------------------------------
// THE PURE LAW OF A PRINT
// ---------------------------------------------------------------------------

describe('D115: a print is always 14 days of the cost', () => {
  it('nothing is printed while the treasury covers it', () => {
    expect(printsNeeded(1000, 1000, 100)).toBe(0);
    expect(printsNeeded(1000, 0, 100)).toBe(0);
  });

  it('a shortfall of one coin still prints 14 days, never the shortfall', () => {
    expect(printsNeeded(999, 1000, 100)).toBe(1);
    expect(printAmount(100)).toBe(1400);
  });

  it('a need larger than one print takes as many as it takes, each the same, with nothing to stop it', () => {
    expect(printsNeeded(0, 1400, 100)).toBe(1);
    expect(printsNeeded(0, 1401, 100)).toBe(2);
    expect(printsNeeded(0, 1_400_000_000, 100)).toBe(1_000_000);
  });

  it('days fold in turn: 14 days of float lasts 14 days, and the 15th prints', () => {
    const perDay = 100;
    const float = printAmount(perDay);
    expect(foldDays(float, perDay, 14)).toEqual({ prints: 0, paid: 1400 });
    expect(foldDays(float, perDay, 15)).toEqual({ prints: 1, paid: 1500 });
    expect(foldDays(float, perDay, 29)).toEqual({ prints: 2, paid: 2900 });
    expect(foldDays(float, perDay, 0)).toEqual({ prints: 0, paid: 0 });
  });
});

// ---------------------------------------------------------------------------
// THE DOORS THAT USED TO REFUSE
// ---------------------------------------------------------------------------

describe('D108: nothing refuses for want of coin, because the hub prints', () => {
  it('guildCover and the book of what was spent are gone', () => {
    expect(readFileSync('src/entities/hub/guild.ts', 'utf8')).not.toMatch(/guildCover|spent: number|guild\.spent/);
    expect(readFileSync('src/entities/hub/store.ts', 'utf8')).not.toMatch(/guildCover|guild\.spent|spent: guild/);
    expect(readFileSync('src/components/GuildHall.tsx', 'utf8')).not.toMatch(/guildCover|guild\.spent/);
    expect(emptyGuild()).not.toHaveProperty('spent');
  });

  it('a save holding the old book loads without it', async () => {
    const doc = hub().hubDoc()!;
    db.set(doc.id, { ...doc, data: { ...doc.data, guild: { ...doc.data.guild, spent: 123_456 } } });
    await hub().loadHub(HUB);
    expect(hub().guild).not.toHaveProperty('spent');
  });

  it('the guild buys ground with an empty treasury: no gold moves, no print, the row says so', async () => {
    const resident = await lodge();
    await drainTreasury();
    const lot = smallestFreeLot();
    expect(await hub().guildBuyLot(resident.id, lot.id)).toEqual({ ok: true });
    expect(await Treasury.balance(HUB)).toBe(0);
    expect(await rowsOf('PRINT')).toHaveLength(0);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  // Moved on purpose: a want no longer reaches the treasury (Pedro: "that's the LITERAL MECHANISM OF MASLOW"). The counter does.
  it('what the treasury cannot pay is paid, and the print and the payment are one act', async () => {
    await drainTreasury();
    const item = thing({ value: 100 });
    const offer = hub().offerFor(item);
    give([item]);
    expect(await hub().sellToVendor(item.id)).toBe(offer);
    expect(player().bank.gold).toBe(offer);
    const perDay = hub().runningNow();
    expect(await Treasury.balance(HUB)).toBe(14 * perDay - offer);
    const prints = await rowsOf('PRINT');
    expect(prints).toHaveLength(1);
    expect(prints[0].data).toMatchObject({ hubId: HUB, amount: 14 * perDay, perDay, days: 14 });
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a sale worth more than one print prints as many as it takes', async () => {
    await drainTreasury();
    const perDay = hub().runningNow();
    // Worth just over three prints to the counter, at whatever share it pays
    const share = hub().offerFor(thing({ value: 1_000_000 })) / 1_000_000;
    const item = thing({ value: Math.ceil((14 * perDay * 3 + 1) / share) });
    give([item]);
    expect(await hub().sellToVendor(item.id)).toBeGreaterThan(14 * perDay * 3);
    const prints = await rowsOf('PRINT');
    expect(prints).toHaveLength(4);
    for (const p of prints) expect(p.data.amount).toBe(14 * perDay);
    expect(hub().guild.printed).toEqual({ count: 4, total: 4 * 14 * perDay });
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('the counter buys with an empty treasury too', async () => {
    await drainTreasury();
    const item = thing({ value: 100 });
    give([item]);
    const offer = await hub().sellToVendor(item.id);
    expect(offer).toBeGreaterThan(0);
    expect(player().bank.gold).toBe(offer);
    expect(await rowsOf('PRINT')).toHaveLength(1);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('no window still says a hub with no funds cannot buy (found by playing)', () => {
    for (const path of allSource('src')) expect(readFileSync(path, 'utf8'), path).not.toMatch(/no funds cannot buy|treasury cannot cover/i);
  });

  it('a covered payment prints nothing', async () => {
    const item = thing({ value: 10 });
    give([item]);
    await hub().sellToVendor(item.id);
    expect(await rowsOf('PRINT')).toHaveLength(0);
  });

  it('more ground means a larger print: what the expansion does, with no code that says so', async () => {
    await drainTreasury();
    const small = printAmount(hub().runningNow());
    const raised = await hub().raiseChunk('NORTH');
    expect(raised.ok).toBe(true);
    const large = printAmount(hub().runningNow());
    expect(large).toBeGreaterThan(small);
    const item = thing({ value: 10 });
    give([item]);
    await hub().sellToVendor(item.id);
    expect((await rowsOf('PRINT'))[0].data.amount).toBe(large);
  });

  it('the audit catches coin no row accounts for', async () => {
    expect((await GoldAudit.run()).ok).toBe(true);
    await Treasury.credit(HUB, 500);
    expect((await GoldAudit.run()).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE DAYS GOING
// ---------------------------------------------------------------------------

describe('D115: the cycle going: the hub pays what it runs on, into its people\'s wallets', () => {
  const walletsTotal = () => Object.values(hub().wallets).reduce((s, n) => s + n, 0);

  it('a day costs the treasury a day, and every coin lands in a wallet', async () => {
    const perDay = hub().runningBook().floorPerDay;
    const treasury = await Treasury.balance(HUB);
    const wallets = walletsTotal();
    await hub().resolveRunning(worldDay() + 1);
    expect(await Treasury.balance(HUB)).toBe(treasury - perDay);
    expect(walletsTotal()).toBe(wallets + perDay);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('the same day is not paid twice, and days are paid in one fold', async () => {
    const perDay = hub().runningBook().floorPerDay;
    const treasury = await Treasury.balance(HUB);
    await hub().resolveRunning(worldDay() + 3);
    await hub().resolveRunning(worldDay() + 3);
    expect(await Treasury.balance(HUB)).toBe(treasury - 3 * perDay);
  });

  it('a hub left alone keeps printing, and the audit still adds up', async () => {
    await hub().resolveRunning(worldDay() + 700);
    expect((await rowsOf('PRINT')).length).toBeGreaterThan(1);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a hub saved before this pays no back-days', async () => {
    const doc = hub().hubDoc()!;
    const { runningDay: _gone, ...guild } = doc.data.guild;
    db.set(doc.id, { ...doc, data: { ...doc.data, guild } });
    await Treasury.credit(HUB, 0);
    const before = await Treasury.balance(HUB);
    await hub().loadHub(HUB);
    expect(hub().guild.runningDay).toBe(worldDay());
    expect(await Treasury.balance(HUB)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// WALLETS
// ---------------------------------------------------------------------------

describe('D115: every NPC brings money, so they have their own wallets', () => {
  it('what a person brings is keyed to them, the same on every machine, and read from their rank', () => {
    expect(walletBrought('res_a', UniversalRank.D)).toBe(walletBrought('res_a', UniversalRank.D));
    const amounts = Array.from({ length: 200 }, (_, i) => walletBrought(`res_${i}`, UniversalRank.D));
    const living = residentUpkeepPerDay(UniversalRank.D);
    expect(new Set(amounts).size).toBeGreaterThan(1);
    for (const a of amounts) expect(a % living).toBe(0);
    expect(Math.min(...amounts)).toBeGreaterThan(0);
  });

  it('everyone the city opens with holds one, each with its own signed row', async () => {
    for (const id of Object.keys(HUB_NPCS)) expect(hub().wallets[id], id).toBeGreaterThan(0);
    const rows = await rowsOf('WALLET');
    for (const id of Object.keys(HUB_NPCS)) expect(rows.some(r => r.data.personId === id && r.data.kind === 'BROUGHT'), id).toBe(true);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('it comes with them once, however many times the hub opens', async () => {
    const before = { ...hub().wallets };
    const rows = (await rowsOf('WALLET')).length;
    await hub().loadHub(HUB);
    expect(hub().wallets).toEqual(before);
    expect(await rowsOf('WALLET')).toHaveLength(rows);
  });

  it('a person brought out brings theirs, which is new coin to the hub and on the record', async () => {
    const resident = await lodge();
    expect(hub().wallets[resident.id]).toBe(walletBrought(resident.id, UniversalRank.D));
    expect(await Wallets.balance(HUB, resident.id)).toBe(hub().wallets[resident.id]);
    expect((await rowsOf('WALLET')).some(r => r.data.personId === resident.id)).toBe(true);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a person the hub saved before wallets gets theirs on opening', async () => {
    const bond = bondOf('person_old');
    const id = residentIdOf(bond.bondData!);
    const doc = hub().hubDoc()!;
    db.set(doc.id, { ...doc, data: { ...doc.data, guild: { ...doc.data.guild, residents: [{
      id, bondItemId: bond.id, bond: bond.bondData, worldSeed: 'seed_money', entityId: 'person_old', name: 'Old', sponsorId: UID, sponsorName: 'TALLY', arrivedAt: 1, lotId: null, wantsMet: 0
    }] } } });
    await hub().loadHub(HUB);
    expect(hub().wallets[id]).toBeGreaterThan(0);
  });

  it('a wallet stays with the person down the road: resident, apprentice, master', async () => {
    // Only someone weak with no craft is taken on, so look through a few until one is
    let resident = await lodge('person_0');
    for (let i = 1; !(await hub().takeApprentice('npc_weapon_vendor', resident.id)).ok; i++) {
      expect(i, 'nobody weak enough among fifty').toBeLessThan(50);
      resident = await lodge(`person_${i}`);
    }
    const held = hub().wallets[resident.id];
    expect(held).toBeGreaterThan(0);
    expect(hub().guild.residents.some(r => r.id === resident.id)).toBe(false);
    await hub().settleWallets();
    expect(hub().wallets[resident.id]).toBe(held);
    expect((await rowsOf('WALLET')).filter(r => r.data.personId === resident.id)).toHaveLength(1);
  });

  it('a wallet is its own record: a change to one moves no treasury', async () => {
    const treasury = await Treasury.balance(HUB);
    const total = await Treasury.totalAll();
    expect(await Wallets.totalAll()).toBe(Object.values(hub().wallets).reduce((s, n) => s + n, 0));
    expect(await Treasury.balance(HUB)).toBe(treasury);
    expect(await Treasury.totalAll()).toBe(total);
  });

  it('the audit catches a wallet no row accounts for', async () => {
    expect((await GoldAudit.run()).ok).toBe(true);
    const unit = { add: () => {} } as any;
    await Wallets.writeInto(unit, HUB, 'npc_banker', 7);
    const result = await GoldAudit.run();
    expect(result.ok).toBe(false);
    expect(result.notes.join(' ')).toMatch(/wallet/i);
  });
});

describe('a master has a purse now (b5\'s note)', () => {
  const masterShop = async () => {
    const resident = await lodge('person_master');
    const craftsmanId = `crf_${resident.worldSeed}_${resident.entityId}`;
    const today = Math.floor(Date.now() / 86_400_000);
    useHubStore.setState(s => ({
      craftsmen: [...s.craftsmen, {
        id: craftsmanId, name: resident.name, bond: resident.bond, bondItemId: resident.bondItemId, sponsorId: UID, sponsorName: 'TALLY',
        masterId: 'npc_weapon_vendor', done: ['npc_weapon_vendor'], rank: 'MASTER', since: today, skill: { id: 'skill_craftsmanship', tags: ['craftsmanship'], xp: 0, level: 1 }
      } as any],
      vendors: { ...s.vendors, [craftsmanId]: { ...VendorSystem.fresh(craftsmanId, 'TRADER', today), worked: today } }
    }));
    return { resident, craftsmanId, today };
  };

  it('what a master sells goes to their wallet, not the treasury, and the row says whose', async () => {
    const { resident, craftsmanId, today } = await masterShop();
    const piece = thing({ id: 'plank_1', universalDefinitionId: 'crf_plank', value: 20 });
    useHubStore.setState(s => ({ vendors: { ...s.vendors, [craftsmanId]: { ...s.vendors[craftsmanId], listed: [piece], since: { plank_1: today } } } }));
    const listing = hub().traderShelf(craftsmanId)[0];
    await grant(1_000);
    const treasury = await Treasury.balance(HUB);
    const before = hub().wallets[resident.id];
    expect(await hub().buyFromTrader(craftsmanId, listing.id)).toBeTruthy();
    const paid = 1_000 - player().bank.gold;
    expect(paid).toBeGreaterThan(0);
    expect(await Treasury.balance(HUB)).toBe(treasury);
    expect(hub().wallets[resident.id]).toBe(before + paid);
    expect(await Wallets.balance(HUB, resident.id)).toBe(before + paid);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a master pays a keeper for parts, as far as their wallet goes, and it is a person\'s own limit', () => {
    const today = 100;
    const parts = Array.from({ length: 10 }, (_, i) => thing({ id: `part_${i}`, value: 10 }));
    const from = { ...VendorSystem.fresh('keeper', 'GENERAL', today), parts };
    const to = VendorSystem.fresh('master', 'TRADER', today);
    const rich = VendorSystem.share(from, to, 1_000);
    expect(rich.to.parts).toHaveLength(5);
    expect(rich.paid).toBe(50);
    const poor = VendorSystem.share(from, to, 25);
    expect(poor.to.parts).toHaveLength(2);
    expect(poor.paid).toBe(20);
    expect(poor.from.parts).toHaveLength(8);
    const broke = VendorSystem.share(from, to, 0);
    expect(broke.to.parts).toHaveLength(0);
    expect(broke.paid).toBe(0);
  });

  it('the parts\' coin moves from one wallet to the other on a signed row', async () => {
    const { resident, craftsmanId, today } = await masterShop();
    const parts = Array.from({ length: 4 }, (_, i) => thing({ id: `part_${i}`, universalDefinitionId: 'res_tree_log', value: 2 }));
    useHubStore.setState(s => ({
      vendors: {
        ...s.vendors,
        npc_weapon_vendor: { ...VendorSystem.normal(s.vendors.npc_weapon_vendor ?? VendorSystem.fresh('npc_weapon_vendor', 'GENERAL', today)), parts, worked: today },
        [craftsmanId]: { ...s.vendors[craftsmanId], worked: today - 1 }
      }
    }));
    const master = hub().wallets[resident.id];
    const keeper = hub().wallets.npc_weapon_vendor;
    await hub().resolveVendors();
    const row = (await rowsOf('TRADE')).find(r => r.data.kind === 'MASTER_BOUGHT_PARTS')!;
    expect(row).toBeTruthy();
    expect(row.data.playerDelta).toBe(0);
    expect(row.data.treasuryDelta).toBe(0);
    expect(hub().wallets[resident.id]).toBeLessThan(master);
    expect(hub().wallets.npc_weapon_vendor).toBe(keeper + (master - hub().wallets[resident.id]));
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NO CODE COMPUTES INFLATION
// ---------------------------------------------------------------------------

describe('Pedro: "you don\'t code inflation"', () => {
  it('no word for it in the game\'s source', () => {
    for (const path of allSource('src')) expect(readFileSync(path, 'utf8'), path).not.toMatch(/inflation|devalu/i);
  });

  it('no price door reads a treasury or a wallet', () => {
    for (const path of ['src/logic/systems/StatSystem.ts', 'src/logic/systems/VendorSystem.ts', 'src/logic/economy/CompositionSystem.ts', 'src/entities/item/ItemFactory.ts']) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/Treasury|Wallets|printed|totalAll/);
    }
  });

  it('a counter\'s offer and a shelf\'s price are the same after many prints', async () => {
    const item = thing({ value: 100 });
    const offer = StatSystem.vendorOffer(item.value, player().attributes);
    const shelf = JSON.stringify(hub().weaponShop.map(l => l.price));
    // Inside one week, since a week rolls its own shelf: the same week, however much is printed
    for (let n = 0; n < 12; n++) {
      await drainTreasury();
      const sold = thing({ value: 10 });
      give([sold]);
      await hub().sellToVendor(sold.id);
    }
    expect((await rowsOf('PRINT')).length).toBeGreaterThanOrEqual(12);
    hub().generateDailyStock();
    expect(StatSystem.vendorOffer(item.value, player().attributes)).toBe(offer);
    expect(JSON.stringify(hub().weaponShop.map(l => l.price))).toBe(shelf);
  });

});

// ---------------------------------------------------------------------------
// ANCHORS
// ---------------------------------------------------------------------------

describe('D115: gems, works of art and valuables found in worlds hold value', () => {
  beforeEach(() => installShippedThemes());
  const themeId = FIRST_THEME_PACK.themeId;
  const anchorDefs = () => Object.values(RESOURCE_DEFINITIONS).filter(d => d.themeId === themeId && d.anchor);
  const judge = (mutate: (b: IThemeBody) => void) => {
    const body = clone(FIRST_THEME);
    mutate(body);
    return ThemeLaw.validate(body, tag => WebBank.current().tags.some(t => t.tag === tag));
  };

  it('the first theme holds gems, art and other valuables, in its own voice', () => {
    const anchors = FIRST_THEME.anchors!;
    expect(anchors.length).toBeGreaterThanOrEqual(3);
    for (const word of ['gem', 'art', 'valuable']) expect(anchors.some(a => a.tags.includes(word)), word).toBe(true);
    for (const a of anchors) { expect(a.blurb.length).toBeGreaterThan(10); expect(a.foundIn.length).toBeGreaterThan(0); }
    expect(judge(() => {})).toEqual({ ok: true });
  });

  it('a new theme must hold some, and the law reads them', () => {
    expect(judge(b => { delete b.anchors; }).ok).toBe(false);
    expect(judge(b => { b.anchors = []; }).reason).toMatch(/anchor|hold/i);
    expect(judge(b => { b.anchors![0].key = b.creatures[0].key; }).ok).toBe(false);
    expect(judge(b => { b.anchors![0].rank = 'Z' as never; }).ok).toBe(false);
    expect(judge(b => { b.anchors![0].foundIn = ['NOWHERE' as never]; }).ok).toBe(false);
    expect(judge(b => { b.anchors![0].foundIn = []; }).ok).toBe(false);
    expect(judge(b => { b.anchors![0].tags = ['never_registered_word']; }).ok).toBe(false);
    expect((THEME_SCHEMA.properties as any).anchors).toBeDefined();
  });

  it('a model writes words and bands; the formula writes the number', () => {
    const compiled = compileTheme(FIRST_THEME_PACK);
    const [one] = FIRST_THEME.anchors!;
    const def = Object.values(compiled.resources).find(r => r.name === one.name)!;
    expect(def.value).toBeGreaterThan(0);
    expect(def.anchor).toBe(true);
    expect('value' in one).toBe(false);
  });

  // What a person holds, not only what the table says: an item prices itself by its weight unless told (found by playing)
  const minted = (def: (typeof RESOURCE_DEFINITIONS)[string], key = 'k') => ItemFactory.createResourceItem(def, Rng.fromKey(`${def.id}:${key}`));

  it('what a person holds is worth what the formula says, however light it is and whatever its roll', () => {
    for (const def of anchorDefs()) {
      for (const key of ['a', 'b', 'c']) expect(minted(def, key).value, def.name).toBe(def.value);
    }
  });

  it('an anchor is worth more than what lies about at its rank', () => {
    for (const def of anchorDefs()) {
      const plain = Object.values(RESOURCE_DEFINITIONS).filter(r => r.themeId === themeId && !r.anchor && r.rank === def.rank && r.rarity === def.rarity);
      for (const other of plain) expect(minted(def).value, `${def.name} / ${other.name}`).toBeGreaterThan(minted(other).value);
    }
  });

  it('nothing grows an anchor from the ground: it is found, not harvested', () => {
    for (const def of anchorDefs()) {
      expect(def.harvestConfig).toBeUndefined();
      for (const table of Object.values(BIOME_RESOURCES)) expect(table).not.toContain(def.id);
    }
  });

  it('a chest can hold one, on its own roll, so no other drop moves', () => {
    const rank = UniversalRank.S;
    const ids = Anchors.foundIn(themeId, BiomeType.RUINS, rank);
    expect(ids.length).toBeGreaterThan(0);
    const found = Array.from({ length: 400 }, (_, i) => Anchors.fromChest(ids, `chest_${i}`)).filter(Boolean);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(400);
    expect(JSON.stringify(Anchors.fromChest(ids, 'chest_7'))).toBe(JSON.stringify(Anchors.fromChest(ids, 'chest_7')));
    const plain = LootTable.generateChestLoot(rank, 1, 'chest_7', BiomeType.RUINS);
    expect(plain.every(i => !Anchors.isAnchor(i))).toBe(true);
    expect(JSON.stringify(plain.map(i => i.universalDefinitionId))).toBe(JSON.stringify(LootTable.generateChestLoot(rank, 1, 'chest_7', BiomeType.RUINS).map(i => i.universalDefinitionId)));
  });

  /** Chests opened one at a time through the door a player's hand uses, in a world pinned to this theme. */
  const openChests = (pinned: string | undefined, count: number): IItem[] => {
    const found: IItem[] = [];
    useWorldStore.setState({ activeWorldId: 'w_money', availableWorlds: [{ id: 'w_money', themeId: pinned }] } as never);
    for (let i = 0; i < count; i++) {
      const id = `chest_${i}`;
      const chest = { id, type: EntityType.CONTAINER, definitionId: 'chest_ruin', position: { x: 5, y: 0 }, rank: UniversalRank.S, rarity: Rarity.COMMON, isHostile: false, container: { lootRank: UniversalRank.S, looted: false, hasLore: false } };
      useWorldStore.setState({ currentMap: { seed: 'money_world', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, biome: BiomeType.RUINS, entities: [chest] } } } } as never);
      usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, strength: 500 }, currentSession: { sessionId: `s${i}`, layerId: 'l', inventory: [], inventoryLayout: {}, health: 100, maxHealth: 100, energy: 1000, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as never } }));
      usePlayerStore.getState().performInteraction(`int_open_${id}`, id);
      found.push(...(player().currentSession?.inventory ?? []));
    }
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined } }));
    useWorldStore.setState({ currentMap: null, activeWorldId: null, availableWorlds: [] } as never);
    return found;
  };

  it('opening a chest in a world of this theme really gives one, now and then', () => {
    const found = openChests(themeId, 120);
    const anchors = found.filter(i => Anchors.isAnchor(i));
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.length).toBeLessThan(120);
    expect(found.length).toBeGreaterThan(anchors.length);
    for (const a of anchors) expect(a.value).toBe(RESOURCE_DEFINITIONS[a.universalDefinitionId].worth);
  });

  it('a chest in a world pinned to a theme with none gives none, by the same door', () => {
    const found = openChests('theme_no_such', 60);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some(i => Anchors.isAnchor(i))).toBe(false);
  });

  it('a chest gives nothing above its own rank, so an anchor is no way around the Hall\'s trial', () => {
    for (const id of Anchors.foundIn(themeId, BiomeType.RUINS, UniversalRank.F)) expect(RESOURCE_DEFINITIONS[id].rank).toBe(UniversalRank.F);
    const all = Anchors.foundIn(themeId, BiomeType.RUINS, UniversalRank.SSS);
    expect(all.length).toBeGreaterThan(Anchors.foundIn(themeId, BiomeType.RUINS, UniversalRank.F).length);
  });

  it('a world pinned to a theme with none finds none', () => {
    expect(Anchors.foundIn('theme_no_such', BiomeType.RUINS, UniversalRank.S)).toEqual([]);
    expect(Anchors.foundIn(undefined, BiomeType.RUINS, UniversalRank.S)).toEqual([]);
  });

  it('it holds its worth: a print does not touch it, and nobody takes it apart', async () => {
    const def = anchorDefs()[0];
    const anchor = ItemFactory.createResourceItem(def, Rng.fromKey('anchor_1'));
    const worth = anchor.value;
    await hub().resolveRunning(worldDay() + 100);
    expect(ItemFactory.createResourceItem(def, Rng.fromKey('anchor_1')).value).toBe(worth);
    expect(SalvageSystem.components(anchor, 'k')).toBeNull();
  });

  it('old printings stay banked with their old numbers', () => {
    const banked = clone(FIRST_THEME) as IThemeBody;
    delete banked.anchors;
    banked.tags = banked.tags.filter(t => !['gem', 'art', 'valuable'].includes(t.tag));
    expect(themeIdOf(banked)).toBe('theme_4599bfea360d75a7');
    const old = { ...sealTheme(banked, 'claude-opus-5-5 (dev batch, D53)', 1793491200000), formula: 3 };
    expect(ContentRegistry.install(old)).toEqual({ ok: true });
    const ctx = ContentRegistry.contextFor(old.themeId);
    expect(computeGolden('golden-alpha', 16, ctx)).toBe(2646139221);
    expect(computeGolden('golden-beta', 32, ctx)).toBe(2744287391);
    expect(computeGolden('dev-sandbox-v4', 32, ctx)).toBe(2784880835);
    expect(Anchors.foundIn(old.themeId, BiomeType.RUINS, UniversalRank.SSS)).toEqual([]);
  });
});

describe('Pedro: "the players need to circumvent it or find another coin"', () => {
  beforeEach(() => installShippedThemes());
  const anchorItem = () => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === FIRST_THEME_PACK.themeId && d.anchor)!;
    return ItemFactory.createResourceItem(def, Rng.fromKey(`anchor_${++minted}`));
  };
  const counter = async () => {
    const lot = smallestFreeLot();
    useHubStore.setState(s => ({ lots: s.lots.map(l => l.id === lot.id ? { ...l, ownerId: UID, ownerName: 'TALLY', structureType: 'VENDOR' as const, upkeepPaidThroughDay: worldDay() } : l) }));
    return lot.id;
  };

  it('a shelf can ask for an anchor in place of coin: no gold moves, and the hub takes no cut', async () => {
    const lotId = await counter();
    const goods = thing({ value: 500 });
    const pay = anchorItem();
    give([goods, pay]);
    expect(await hub().listItemForSale(lotId, goods.id, 0, pay.universalDefinitionId)).toBe(true);
    const listing = hub().lots.find(l => l.id === lotId)!.shopListings![0];
    expect(listing.ask).toEqual({ defId: pay.universalDefinitionId, name: pay.name });

    await grant(77);
    const treasury = await Treasury.balance(HUB);
    expect(await hub().buyFromLot(lotId, goods.id)).toBe(true);
    expect(player().bank.gold).toBe(77);
    expect(await Treasury.balance(HUB)).toBe(treasury);
    expect(stash().some(i => i.id === goods.id)).toBe(true);
    expect(stash().some(i => i.id === pay.id)).toBe(false);
    const lot = hub().lots.find(l => l.id === lotId)!;
    expect(lot.shopListings).toHaveLength(0);
    expect(lot.heldInTrade?.map(i => i.id)).toEqual([pay.id]);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('without the anchor the sale does not happen, and coin will not do', async () => {
    const lotId = await counter();
    const goods = thing({ value: 500 });
    const pay = anchorItem();
    give([goods]);
    await hub().listItemForSale(lotId, goods.id, 0, pay.universalDefinitionId);
    setGold(1_000_000);
    expect(await hub().buyFromLot(lotId, goods.id)).toBe(false);
    expect(player().bank.gold).toBe(1_000_000);
    expect(hub().lots.find(l => l.id === lotId)!.shopListings).toHaveLength(1);
  });

  it('an anchor nobody has read pays for nothing', async () => {
    const lotId = await counter();
    const goods = thing();
    const pay = { ...anchorItem(), isIdentified: false };
    give([goods, pay]);
    await hub().listItemForSale(lotId, goods.id, 0, pay.universalDefinitionId);
    expect(await hub().buyFromLot(lotId, goods.id)).toBe(false);
  });

  it('only an anchor can be asked for', async () => {
    const lotId = await counter();
    const goods = thing();
    give([goods]);
    expect(await hub().listItemForSale(lotId, goods.id, 0, 'res_tree_log')).toBe(false);
    expect(await hub().listItemForSale(lotId, goods.id, 0)).toBe(false);
    expect(stash().some(i => i.id === goods.id)).toBe(true);
  });

  it('what a shelf took is collected by its owner, and nothing is lost if the lot goes', async () => {
    const lotId = await counter();
    const goods = thing();
    const pay = anchorItem();
    give([goods, pay]);
    await hub().listItemForSale(lotId, goods.id, 0, pay.universalDefinitionId);
    await hub().buyFromLot(lotId, goods.id);
    expect(await hub().collectHeld(lotId)).toBe(1);
    expect(stash().some(i => i.id === pay.id)).toBe(true);
    expect(hub().lots.find(l => l.id === lotId)!.heldInTrade ?? []).toHaveLength(0);

    const again = thing();
    give([again]);
    await hub().listItemForSale(lotId, again.id, 0, pay.universalDefinitionId);
    await hub().buyFromLot(lotId, again.id);
    setGold(0);
    useHubStore.setState(s => ({ lots: s.lots.map(l => l.id === lotId ? { ...l, upkeepPaidThroughDay: worldDay() - 1000 } : l) }));
    await hub().resolveUpkeep();
    expect(stash().some(i => i.id === pay.id)).toBe(true);
  });

  it('a shelf priced in coin works as it always did, with the hub\'s cut', async () => {
    const lotId = await counter();
    const goods = thing();
    give([goods]);
    expect(await hub().listItemForSale(lotId, goods.id, 100)).toBe(true);
    await grant(100);
    const treasury = await Treasury.balance(HUB);
    expect(await hub().buyFromLot(lotId, goods.id)).toBe(true);
    expect(await Treasury.balance(HUB)).toBeGreaterThan(treasury);
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

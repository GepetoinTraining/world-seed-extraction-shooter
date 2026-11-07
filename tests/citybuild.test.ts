/**
 * THE CITY'S LIST (the build pass after leg 1): Q3, Q5, Q6, Q8, Q9, Q25, Q26, Q28, Q29,
 * Q31 to Q35, Q38 and Q39 of DESIGN_QUESTIONS_LEG1.md, each held here. Where the game already
 * did what was ruled, the bar only confirms it.
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

import { readFileSync } from 'fs';
import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { useHubStore, worldDay } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Treasury } from '../src/logic/economy/Treasury';
import { Ledger } from '../src/logic/ledger/Ledger';
import { DEAL_DAYS, ShopWeek } from '../src/logic/economy/ShopWeek';
import { VendorSystem } from '../src/logic/systems/VendorSystem';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { RestSystem, INN_FEE } from '../src/logic/systems/RestSystem';
import { RestDoor } from '../src/logic/systems/RestDoor';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { WorldDeed } from '../src/logic/systems/WorldDeed';
import { WorldCertificateSystem } from '../src/entities/world/WorldCertificate';
import { installShippedThemes } from '../shared/logic/theme/boot';

const source = (path: string) => readFileSync(path, 'utf8');
const UID = 'uid_city';
const HUB = 'hub_city';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const KEEPERS = ['npc_weapon_vendor', 'npc_armor_vendor', 'npc_alchemist'];
const shelves = () => [...hub().weaponShop, ...hub().armorShop, ...hub().consumableShop];
const rowsOf = async (type: string) => (await Ledger.listAll()).map(r => r.payload).filter(p => p.type === type);
const weekEnd = (day: number) => (ShopWeek.weekOf(day) + 1) * ShopWeek.WEEK_DAYS;

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

/** Opens the hub on a given day of the world: the first day it is seen is the day it opens. */
const openOn = async (day: number) => {
  const real = Date.now;
  vi.spyOn(Date, 'now').mockImplementation(() => day * 86_400_000 + (real() % 86_400_000));
  await hub().loadHub(HUB);
};

beforeEach(async () => {
  vi.restoreAllMocks();
  db.clear();
  minted = 0;
  installShippedThemes();
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'TITHE' } } as any });
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'TITHE', rank: UniversalRank.F, skillProgress: {}, skillWords: {}, energyToday: undefined, rest: undefined, currentSession: null,
      bank: { ...s.player.bank, gold: 0, lore: {}, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) }
    }
  }));
  useHubStore.setState({ rooms: {}, weaponShop: [], armorShop: [], consumableShop: [], web: { nodes: {} } });
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
});

// =============================================================================
// THE WORDS AND SCREENS
// =============================================================================

describe('Q3: D128 stands over Vex\'s "little coin"', () => {
  it('Vex says a person comes out of the gate carrying years of their own living', () => {
    const text = source('src/entities/hub/dialogue.ts');
    expect(text).not.toMatch(/a little coin/);
    expect(text).toMatch(/GUILD_LORE[\s\S]{0,200}years of their own living/);
  });
});

describe('Q5: the world card names its maker by name', () => {
  it('a world signs its maker\'s name at mint', async () => {
    const cert = await WorldCertificateSystem.mintWorld({ metadata: { uid: UID, displayName: 'TITHE' } } as any, 'SLOW CLOCK', '', 'EXTRACTION' as any, 16, {});
    expect(cert!.data.creatorName).toBe('TITHE');
  });

  it('the card reads the signed name; a world from before it reads the person\'s own name when it is theirs, and the id otherwise', () => {
    const data = { creatorCertUid: 'ws_2ef4e0aa11', creatorName: 'SALTER' } as any;
    expect(WorldCertificateSystem.makerName(data, { uid: UID, name: 'TITHE' })).toBe('SALTER');
    expect(WorldCertificateSystem.makerName({ creatorCertUid: UID } as any, { uid: UID, name: 'TITHE' })).toBe('TITHE');
    expect(WorldCertificateSystem.makerName({ creatorCertUid: 'ws_2ef4e0aa11' } as any, { uid: UID, name: 'TITHE' })).toBe('ws_2ef4e');
  });

  it('the zones list builds its card from that name', () => {
    expect(source('src/entities/world/store.ts')).toMatch(/creator: WorldCertificateSystem\.makerName\(/);
  });
});

describe('Q6: the city shows one weight, the one that rides on the next drop', () => {
  it('the always-zero bank weight line is gone', () => {
    expect(source('src/components/PlayerHub.tsx')).not.toMatch(/Current bank weight/);
  });
});

describe('Q8: the sheet fits the window', () => {
  it('the sheet\'s row wraps instead of running off the left edge, and scrolls if it must', () => {
    const sheet = source('src/components/CharacterSheet.tsx');
    const body = sheet.slice(sheet.indexOf('const SheetBody'), sheet.indexOf('export const CharacterSheet'));
    expect(body).toMatch(/flexWrap: 'wrap'/);
    expect(body).toMatch(/overflowY: 'auto'/);
    expect(body).toMatch(/maxHeight:/);
  });
});

describe('Q26: energy shows in the city wherever something spends it', () => {
  it('what is held is the session\'s in the field, the day\'s in the city, and full when nothing was spent', () => {
    const p = player();
    const full = StatSystem.maxEnergyOf(p);
    expect(RestSystem.energyHeld({ ...p, energyToday: undefined, currentSession: null })).toBe(full);
    expect(RestSystem.energyHeld({ ...p, energyToday: 12, currentSession: null })).toBe(12);
    expect(RestSystem.energyHeld({ ...p, energyToday: 12, currentSession: { energy: 30 } as any })).toBe(30);
  });

  it('the sheet\'s study panel and the inn both show it', () => {
    expect(source('src/components/StudyPanel.tsx')).toMatch(/label="ENERGY"[\s\S]{0,120}RestSystem\.energyHeld\(/);
    expect(source('src/entities/hub/HubCanvas.tsx')).toMatch(/action === 'REST'[\s\S]{0,300}RestSystem\.energyHeld\(/);
  });
});

describe('Q28: the city\'s bar says what waits after a level', () => {
  it('one line for both bars: the level, then points to spend and circles to fill', async () => {
    const { levelLine } = await import('../src/components/ui/levelLine');
    const p = player();
    expect(levelLine({ ...p, attributePoints: 0 })).toMatch(/^LV \d+$/);
    expect(levelLine({ ...p, attributePoints: 3 })).toMatch(/^LV \d+ · 3 TO SPEND/);
  });

  it('the city\'s bar and the field\'s chip read it', () => {
    expect(source('App.tsx')).toMatch(/levelLine\(player\)/);
    expect(source('src/components/WorldCanvas.tsx')).toMatch(/levelLine\(player\)/);
  });
});

// =============================================================================
// ONE NAME PER SKILL, AND THE FIRSTS
// =============================================================================

describe('Q9: creation\'s name enters the bank, and the feed and the ledger read it', () => {
  const id = TagLaw.skillIdOf(['wood', 'saw']);
  const held = () => usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      skillWords: { [id]: { name: 'Quiet Sawing', flavor: 'The teeth go in without a sound.', grants: [] } },
      bank: { ...s.player.bank, universalSkills: { [id]: { id, tags: ['saw', 'wood'], level: 1, currentXp: 0, scalingAttribute: 'dexterity' } as any } }
    }
  }));

  it('the hub\'s web keeps the first one\'s name for the skill, and reads it back', () => {
    const web = WebSystem.admit({ nodes: {} }, { uid: UID, name: 'TITHE' }, { [id]: { id, tags: ['saw', 'wood'], level: 1, currentXp: 0, scalingAttribute: 'dexterity' } as any }, 0, { [id]: { name: 'Quiet Sawing', flavor: 'x', grants: [] } }).web;
    expect(web.nodes[id].name).toBe('Quiet Sawing');
    expect(WebSystem.nameIn(id, web)).toBe('Quiet Sawing');
    // A skill nobody named keeps the bank's words
    expect(WebSystem.nameIn(TagLaw.skillIdOf(['stone', 'hammer']), web)).toBe(WebSystem.nameOf(TagLaw.skillIdOf(['stone', 'hammer'])));
  });

  it('a later name does not take the first one\'s place', () => {
    const first = WebSystem.admit({ nodes: {} }, { uid: UID, name: 'TITHE' }, { [id]: { id, tags: ['saw', 'wood'], level: 1, currentXp: 0, scalingAttribute: 'dexterity' } as any }, 0, { [id]: { name: 'Quiet Sawing', flavor: 'x', grants: [] } }).web;
    const later = WebSystem.admit(first, { uid: 'other', name: 'SALTER' }, { [id]: { id, tags: ['saw', 'wood'], level: 9, currentXp: 0, scalingAttribute: 'dexterity' } as any }, 1, { [id]: { name: 'Loud Sawing', flavor: 'y', grants: [] } }).web;
    expect(WebSystem.nameIn(id, later)).toBe('Quiet Sawing');
  });

  it('found by playing: the feed, the ledger\'s FIRST row and the topic all go by creation\'s name', async () => {
    await openOn(worldDay());
    held();
    await hub().creditHeld();
    const first = (await rowsOf('TECH')).find(r => r.data.kind === 'FIRST' && r.data.skillId === id);
    expect(first?.data.name).toBe('Quiet Sawing');
    expect(Object.keys(player().bank.lore)).toContain('First in this hub: Quiet Sawing');
  });

  it('Q29, as built: a hub\'s firsts are topics the dream is told', async () => {
    await openOn(worldDay());
    held();
    await hub().creditHeld();
    const firsts = Object.values(player().bank.lore).filter(t => t.topic.startsWith('First in this hub: '));
    expect(firsts).toHaveLength(1);
    expect(firsts[0].level).toBe(1);
  });
});

// =============================================================================
// THE INN AND THE COUNTER, AS BUILT
// =============================================================================

describe('Q25, as built: the inn charges for the night at full energy', () => {
  it('a rest with nothing spent still takes the fee, and the day turns', async () => {
    await openOn(worldDay());
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100 } } }));
    expect(RestSystem.energyHeld(player())).toBe(StatSystem.maxEnergyOf(player()));
    const res = await RestDoor.sleep('INN');
    expect(res.ok).toBe(true);
    expect(player().bank.gold).toBe(100 - INN_FEE);
    expect((await rowsOf('GOLD_DELTA')).some(r => r.data.reason === 'INN' && r.data.amount === -INN_FEE)).toBe(true);
  });
});

describe('Q35, as built: a world deed sells at the counter', () => {
  it('the counter offers coin for it, and takes it', async () => {
    await openOn(worldDay());
    const deed = WorldDeed.free(UID);
    give([deed]);
    expect(hub().offerFor(deed)).toBeGreaterThan(0);
    const paid = await hub().sellToVendor(deed.id);
    expect(paid).toBeGreaterThan(0);
    expect(player().bank.stashTabs[0].items.some(i => i.id === deed.id)).toBe(false);
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

// =============================================================================
// THE WEEK'S SHELF, THE PRINT, THE BIN
// =============================================================================

describe('Q31: the print reads the week ahead', () => {
  it('found by playing: a print at a week\'s close is 14 days of the shelf just stocked', async () => {
    const day = weekEnd(worldDay()) - 1;
    await openOn(day);
    // A keeper's week far deeper than the treasury holds, so the close must print
    const keeper = hub().vendors.npc_alchemist;
    useHubStore.setState(s => ({ vendors: { ...s.vendors, npc_alchemist: { ...keeper, book: { earned: 0, counter: 0, loss: 10_000_000 } } } }));
    await hub().resolveRunning(day + 1);
    const prints = await rowsOf('PRINT');
    const atClose = prints.filter(r => r.data.why === 'SHOP_WEEK');
    expect(atClose.length).toBeGreaterThan(0);
    expect(atClose[0].data.perDay).toBe(hub().runningBook().perDay);
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

describe('Q32 and Q33: the keepers\' shelves keep a piece its stock days, from the day it was stocked', () => {
  it('found by playing: a hub opened mid-week bins nothing of its opening shelf at its first close', async () => {
    const day = weekEnd(worldDay()) - 2;
    await openOn(day);
    expect(shelves().reduce((s, l) => s + l.stock, 0)).toBeGreaterThan(0);
    await hub().resolveRunning(day + 2);
    expect(hub().guild.week).toBe(ShopWeek.weekOf(day + 2));
    expect(KEEPERS.every(k => hub().vendors[k].bin.length === 0)).toBe(true);
    // What was not sold is still on the shelf, at its own stock
    expect(shelves().some(l => l.id.startsWith('listing_kept_'))).toBe(true);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a plain piece goes on a deal once it has sat its seven days, at the close after that', async () => {
    const day = weekEnd(worldDay()) - 2;
    await openOn(day);
    await hub().resolveRunning(day + 2 + ShopWeek.WEEK_DAYS);
    expect(KEEPERS.some(k => hub().vendors[k].bin.length > 0)).toBe(true);
    for (const k of KEEPERS) for (const piece of hub().vendors[k].bin) {
      expect(ShopWeek.stockDays(piece.item.rank, piece.item.rarity)).toBeLessThanOrEqual(ShopWeek.WEEK_DAYS + 2);
    }
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('a higher rank is kept past the close that bins a plain one', async () => {
    const day = weekEnd(worldDay()) - 2;
    await openOn(day);
    const ranked = shelves().filter(l => !l.held && ShopWeek.stockDays(l.item.rank, l.item.rarity) > ShopWeek.WEEK_DAYS + 2);
    expect(ranked.length).toBeGreaterThan(0);
    await hub().resolveRunning(day + 2 + ShopWeek.WEEK_DAYS);
    const binned = new Set(KEEPERS.flatMap(k => hub().vendors[k].bin.map(p => p.item.universalDefinitionId + p.item.rank + p.item.rarity)));
    const kept = shelves().filter(l => l.id.startsWith('listing_kept_'));
    for (const line of ranked) {
      expect(kept.some(k => k.item.universalDefinitionId === line.item.universalDefinitionId && k.item.rank === line.item.rank), line.id).toBe(true);
    }
    expect(binned.size).toBeGreaterThan(0);
  });

  it('a kept line can be bought, at its own price, and the audit adds up', async () => {
    const day = weekEnd(worldDay()) - 2;
    await openOn(day);
    await hub().resolveRunning(day + 2);
    const kept = hub().weaponShop.find(l => l.id.startsWith('listing_kept_') && l.stock > 0)!;
    expect(kept).toBeTruthy();
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100_000 } } }));
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 100_000 });
    const before = kept.stock;
    expect(hub().purchaseFromShop(kept.id, 'weapon')).not.toBeNull();
    expect(hub().weaponShop.find(l => l.id === kept.id)!.stock).toBe(before - 1);
    expect(100_000 - player().bank.gold).toBe(Math.ceil(StatSystem.shopPrice(kept.price, player().attributes)));
    await new Promise(r => setTimeout(r, 0));
    expect((await GoldAudit.run()).ok).toBe(true);
  });
});

describe('Q38: identical bin pieces share a row', () => {
  const tonic = (i: number) => thing({ id: `tonic_${i}`, universalDefinitionId: 'res_tonic', name: 'Interest Tonic' });
  const piece = (item: IItem, price: number) => ({ item, ask: 6, worth: 1, price, until: 100 });

  it('seven tonics at one price are one row of seven; a piece with its own price keeps its own row', () => {
    const record = { ...VendorSystem.fresh('k', 'GENERAL', 90), bin: [...Array.from({ length: 7 }, (_, i) => piece(tonic(i), 2)), piece(thing({ id: 'knot', name: 'Gambler\'s Knot', universalDefinitionId: 'gear_knot' }), 9), piece(thing({ id: 'knot2', name: 'Gambler\'s Knot', universalDefinitionId: 'gear_knot' }), 11)] };
    const rows = VendorSystem.shelf(record, [], 95, 0).filter(l => l.deal);
    expect(rows).toHaveLength(3);
    expect(rows.find(r => r.item.name === 'Interest Tonic')!.stock).toBe(7);
  });

  it('buying from a shared row takes one piece, and the row counts one fewer', () => {
    const record = { ...VendorSystem.fresh('k', 'GENERAL', 90), bin: Array.from({ length: 3 }, (_, i) => piece(tonic(i), 2)) };
    const [row] = VendorSystem.shelf(record, [], 95, 0).filter(l => l.deal);
    const after = VendorSystem.takeOwn(record, row.item.id);
    expect(VendorSystem.shelf(after, [], 95, 0).filter(l => l.deal)[0].stock).toBe(2);
  });

  it('found by playing: the shop window says how many a shared bin row holds', () => {
    expect(source('src/entities/hub/HubCanvas.tsx')).toMatch(/BARGAIN BIN: \$\{[^}]+\} days left\$\{listing\.stock > 1 \? ` · \$\{listing\.stock\} alike`/);
  });
});

describe('Q34: a holder reads their lot\'s weekly tax on the deeds screen', () => {
  it('a held lot has a line in the tax book, and zero is right in a city that makes nothing taxable', async () => {
    await openOn(worldDay());
    const lot = hub().lots.find(l => !l.ownerId)!;
    useHubStore.setState(s => ({ lots: s.lots.map(l => l.id === lot.id ? { ...l, ownerId: UID, ownerName: 'TITHE' } : l) }));
    const line = hub().taxBook().lots.find(l => l.lotId === lot.id)!;
    expect(line).toBeTruthy();
    expect(line.perWeek).toBe(0);
  });

  it('the deeds screen shows it on the lot', () => {
    const deeds = source('src/components/HoldingsPanel.tsx');
    expect(deeds).toMatch(/hub\.taxBook\(\)\.lots\.find\(l => l\.lotId === lot\.id\)/);
    expect(deeds).toMatch(/CITY TAX[\s\S]{0,120}tax\.perWeek[\s\S]{0,60}a week/);
  });
});

describe('Q39: the city folds its days at midnight while the person stays in it', () => {
  it('a day turned while the city is open is folded by the city\'s own tick, once', async () => {
    const day = worldDay();
    await openOn(day);
    expect((await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'HUB_RUNNING')).toHaveLength(0);
    vi.spyOn(Date, 'now').mockImplementation(() => (day + 1) * 86_400_000 + 1_000);
    await hub().turnTheDay();
    await hub().turnTheDay();
    const rows = (await rowsOf('GOLD_DELTA')).filter(r => r.data.reason === 'HUB_RUNNING');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.days).toBe(1);
    expect((await GoldAudit.run()).ok).toBe(true);
  });

  it('the city view watches for midnight and turns the day', () => {
    const app = source('App.tsx');
    expect(app).toMatch(/useCityDay\(/);
    expect(source('src/components/ui/useCityDay.ts')).toMatch(/turnTheDay\(\)/);
  });
});

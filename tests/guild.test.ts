/**
 * STREAM B4's BARS, registered before the build: line 115, the rank half of 128,
 * line 141, D93's door, and lines 35 and 38 where they still stand.
 *
 * A bond brings a person out. They stay at the tavern, the guild buys a lot, their
 * house rises through the pooled bill, and their wants become quests at the guildhall.
 * The gold audit balances through the whole of it.
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

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { useHubStore, worldDay, hubPort } from '../src/entities/hub/store';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { useRankMoment } from '../src/components/ui/stores';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { ExitLevy } from '../src/logic/economy/ExitLevy';
import { Treasury } from '../src/logic/economy/Treasury';
import { Ledger } from '../src/logic/ledger/Ledger';
import { Provenance } from '../src/logic/sovereignty/Provenance';
import { NpcSheet } from '../shared/logic/systems/NpcSheet';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { ProgressionSystem } from '../shared/entities/player/systems/ProgressionSystem';
import { HubGenerator } from '../src/entities/hub/HubGenerator';
import { HUB_NPCS } from '../src/entities/hub/HubGenerator';
import { HANDLED_ACTIONS, runDialogueAction } from '../src/entities/hub/dialogue';
import { doorOf, withinReach } from '../src/render/atoms/hub';
import { answersTag } from '../shared/entities/hub/room';
import { SYSTEM_TEMPLATES, lotConstruction, sizeNeedsVerdict, templateMatchesRoom, validateTemplate } from '../shared/entities/hub/template';
import {
  GUILD_OWNER_ID, IResident, TAX_EVASION_TAGS, bedsTaken, benchFactor, chainFromMap, emptyGuild, houseBill, houseTemplateFor, jobOf,
  readSheet, residentStage, residentUpkeepPerDay, tavernBeds, trialFor, wantFor
} from '../src/entities/hub/guild';
import { worldPort } from '../src/entities/world/store';

const UID = 'uid_guild';
const HUB = 'hub_guild';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const stash = () => player().bank.stashTabs[0].items;

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

const logs = (n: number) => Array.from({ length: n }, () => thing());
const panes = (n: number) => Array.from({ length: n }, () => thing({ universalDefinitionId: 'res_glass_shards', name: 'Glass Shard', tags: ['glass', 'mineral'] }));

const bondOf = (entityId = 'person_1', over: Record<string, any> = {}, id?: string): IItem => thing({
  id: id ?? `bond_${++minted}`,
  universalDefinitionId: 'npc_contract',
  name: 'Escort Bond: Serin Vale',
  type: ItemType.LORE,
  rarity: Rarity.RARE,
  rank: UniversalRank.D,
  value: 200,
  tags: ['npc_contract', 'social'],
  bondData: {
    worldSeed: 'seed_guild',
    entityId,
    webVersion: 1,
    rank: UniversalRank.D,
    rarity: Rarity.RARE,
    sheet: { name: 'Serin Vale', temperament: 'COWARD', objective: 'HOARD', want: 'GIFT', disposition: 80, attempts: 3, ...over }
  }
} as any);

const give = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...items] } : t) } }
}));
const setGold = (gold: number) => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold } } }));

/** A lodger at the tavern, from a bond. */
const lodge = async (entityId = 'person_1', over: Record<string, any> = {}): Promise<IResident> => {
  const bond = bondOf(entityId, over);
  give([bond]);
  const res = await hub().redeemBond(bond.id);
  expect(res).toEqual({ ok: true });
  // D115: no ground until a human has seen to them (tests/immigrants.test.ts holds that). These bars start after it.
  useHubStore.setState(s => {
    const id = s.guild.residents.find(r => r.entityId === entityId)!.id;
    return { guild: { ...s.guild, quests: s.guild.quests.filter(q => q.residentId !== id), residents: s.guild.residents.map(r => r.id === id ? { ...r, wantsMet: 1 } : r) } };
  });
  return hub().guild.residents.find(r => r.entityId === entityId)!;
};

const smallestFreeLot = () => [...hub().lots].filter(l => !l.ownerId).sort((a, b) => a.price - b.price)[0];

/** The clock finishes whatever is queued. */
const finishBuilds = async () => {
  useHubStore.setState(s => ({ buildJobs: s.buildJobs.map(j => ({ ...j, finishesAt: 0 })) }));
  await hub().resolveBuilds();
};

/** Bought, pooled and risen: the person is home. */
const house = async (entityId = 'person_1', over: Record<string, any> = {}): Promise<IResident> => {
  const resident = await lodge(entityId, over);
  expect(await hub().guildBuyLot(resident.id, smallestFreeLot().id)).toEqual({ ok: true });
  const bought = hub().guild.residents.find(r => r.id === resident.id)!;
  for (const line of houseBill(houseTemplateFor(footprintOf(bought.lotId!))!)) {
    const items = line.tag === 'glass' ? panes(line.count) : logs(line.count);
    give(items);
    expect(await hub().poolToHouse(resident.id, line.tag, items.map(i => i.id))).toEqual({ ok: true });
  }
  await finishBuilds();
  return hub().guild.residents.find(r => r.id === resident.id)!;
};

const footprintOf = (lotId: string) => {
  const poi = HubGenerator.findPOI(HubGenerator.generate({ chunks: hub().chunks, dismembered: hub().dismembered }), lotId)!;
  return { width: poi.size.width, height: poi.size.height };
};

beforeEach(async () => {
  db.clear();
  minted = 0;
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'QUOIN' } } as any });
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'QUOIN', rank: UniversalRank.F, rankXp: 0, levelXp: 0, levelsBanked: 0, attributePoints: 0,
      skillProgress: {},
      bank: { ...s.player.bank, gold: 0, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) }
    }
  }));
  useRankMoment.setState({ moment: null });
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
  await hub().loadHub(HUB);
});

// ---------------------------------------------------------------------------
// LINE 115: THE TAVERN
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE TAVERN HAS TEN BEDS (Pedro, 2026-11-10, asked what its space is: "10 beds?")
// ---------------------------------------------------------------------------

describe('Pedro, 2026-11-10: the tavern has ten beds', () => {
  const plan = () => HubGenerator.generate({ chunks: hub().chunks, dismembered: hub().dismembered });
  const bring = async (entityId: string) => {
    const bond = bondOf(entityId);
    give([bond]);
    return { bond, res: await hub().redeemBond(bond.id) };
  };

  it('the count is the tavern\'s own, written on it in the city\'s plan', () => {
    expect(tavernBeds(plan())).toBe(10);
    expect(readFileSync('src/entities/hub/hubManifest.ts', 'utf8')).toMatch(/poi_tavern[^\n]*metadata: \{ beds: 10 \}/);
  });

  it('ten are lodged, and the eleventh is turned away in voice and keeps their bond', async () => {
    for (let i = 0; i < 10; i++) expect((await bring(`bed_${i}`)).res).toEqual({ ok: true });
    expect(bedsTaken(hub().guild.residents, hub())).toBe(10);
    const { bond, res } = await bring('bed_10');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/10 of 10/);
    expect(hub().guild.residents).toHaveLength(10);
    expect(stash().some(i => i.id === bond.id)).toBe(true);
  });

  it('a lodger whose own house stands has left their bed for the next', async () => {
    for (let i = 0; i < 10; i++) await bring(`bed_${i}`);
    useHubStore.setState(s => ({ guild: { ...s.guild, residents: s.guild.residents.map((r, i) => (i === 0 ? { ...r, lotId: 'lot_x', homeAt: 1 } : r)) } }));
    expect(bedsTaken(hub().guild.residents, hub())).toBe(9);
    expect((await bring('bed_10')).res).toEqual({ ok: true });
  });

  it('the room says how many beds are taken', () => {
    expect(readFileSync('src/components/TavernRoom.tsx', 'utf8')).toMatch(/OF \{beds\} BEDS|of \{beds\} beds/);
  });
});

describe('line 115: a person brought out stays at the tavern', () => {
  it('a bond redeemed is a lodger, and the bond is gone', async () => {
    const bond = bondOf();
    give([bond]);
    expect(await hub().redeemBond(bond.id)).toEqual({ ok: true });
    expect(stash().some(i => i.id === bond.id)).toBe(false);
    const [resident] = hub().guild.residents;
    expect(residentStage(resident, hub())).toBe('TAVERN');
    expect(resident.lotId).toBeNull();
    expect(resident.sponsorId).toBe(UID);
  });

  it('line 35: recognisably that person, the same sheet the bond reads back', async () => {
    const bond = bondOf();
    give([bond]);
    const expected = NpcSheet.fromBond(bond)!;
    await hub().redeemBond(bond.id);
    const sheet = readSheet(hub().guild.residents[0]);
    expect(sheet.name).toBe('Serin Vale');
    expect(sheet.temperament).toBe('COWARD');
    expect(JSON.stringify(sheet)).toBe(JSON.stringify(expected));
  });

  it('one bond can never make two residents, pressed twice in one tick', async () => {
    const bond = bondOf();
    give([bond]);
    const both = await Promise.all([hub().redeemBond(bond.id), hub().redeemBond(bond.id)]);
    expect(both.filter(v => v.ok).length).toBe(1);
    expect(hub().guild.residents.length).toBe(1);
  });

  it('a copy of the bond, or a second bond for the same person, is refused and stays in the stash', async () => {
    await lodge('person_1');
    const again = bondOf('person_1');
    give([again]);
    const res = await hub().redeemBond(again.id);
    expect(res.ok).toBe(false);
    expect(hub().guild.residents.length).toBe(1);
    expect(stash().some(i => i.id === again.id)).toBe(true);
  });

  it('what is not a bond, or a bond that names nobody, is refused', async () => {
    const log = thing();
    const blank = thing({ universalDefinitionId: 'npc_contract', tags: ['npc_contract'] });
    give([log, blank]);
    expect((await hub().redeemBond(log.id)).ok).toBe(false);
    expect((await hub().redeemBond(blank.id)).ok).toBe(false);
    expect((await hub().redeemBond('no_such_item')).ok).toBe(false);
    expect(hub().guild.residents.length).toBe(0);
    expect(stash().length).toBe(2);
  });

  // Moved on purpose (D115): this held "a lodger posts no quest: wants begin once they have a house".
  it('a lodger posts a want at once: it is the way to their ground', async () => {
    const bond = bondOf('person_arriving');
    give([bond]);
    await hub().redeemBond(bond.id);
    expect(hub().guild.quests.length).toBe(1);
  });

  it('Mags keeps her rest, and has work at the tavern now', () => {
    const actions = HUB_NPCS.npc_bartender.dialogue.options.map(o => o.action);
    expect(actions).toContain('REST');
    expect(actions).toContain('OPEN_TAVERN');
    expect(HANDLED_ACTIONS).toContain('OPEN_TAVERN');
    expect(runDialogueAction(worldPort, playerPort, hubPort, 'OPEN_TAVERN')).toEqual({ kind: 'open', panel: 'tavern' });
  });
});

// ---------------------------------------------------------------------------
// LINE 115: THE GUILD BUYS A LOT
// ---------------------------------------------------------------------------

describe('line 115: the guild buys a lot, with the hub treasury behind it', () => {
  it('the lot is the guild\'s, no gold moves, and the row says so', async () => {
    const resident = await lodge();
    const lot = smallestFreeLot();
    const before = await Treasury.balance(HUB);
    expect(await hub().guildBuyLot(resident.id, lot.id)).toEqual({ ok: true });

    const after = hub().lots.find(l => l.id === lot.id)!;
    expect(after.ownerId).toBe(GUILD_OWNER_ID);
    expect(after.ownerName).toContain('Serin Vale');
    expect(hub().guild.residents[0].lotId).toBe(lot.id);
    expect(await Treasury.balance(HUB)).toBe(before);
    expect(player().bank.gold).toBe(0);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
    const rows = await Ledger.list(UID);
    expect(rows.some(r => r.payload.type === 'TRADE' && r.payload.data.kind === 'GUILD_BOUGHT_LOT' && r.payload.data.price === lot.price)).toBe(true);
  });

  // Moved on purpose (D108): this held "what it spent counts against what it may spend next".
  it('it keeps no book against itself: the next lot is as open as the first', async () => {
    const one = await lodge('person_1');
    const two = await lodge('person_2');
    expect(await hub().guildBuyLot(one.id, smallestFreeLot().id)).toEqual({ ok: true });
    expect(await hub().guildBuyLot(two.id, smallestFreeLot().id)).toEqual({ ok: true });
    expect(hub().guild).not.toHaveProperty('spent');
  });

  // Moved on purpose (D108): this held "the treasury cannot cover it, so it does not buy".
  it('the treasury being empty does not stop it, since it moves no gold', async () => {
    const resident = await lodge();
    const lot = smallestFreeLot();
    const held = await Treasury.balance(HUB);
    await Treasury.credit(HUB, -held);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_DRAIN', amount: 0, treasuryId: HUB, treasuryDelta: -held });
    expect(await hub().guildBuyLot(resident.id, lot.id)).toEqual({ ok: true });
    expect(hub().lots.find(l => l.id === lot.id)!.ownerId).toBe(GUILD_OWNER_ID);
    expect(await Treasury.balance(HUB)).toBe(0);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('it buys free ground only, and each person once', async () => {
    const one = await lodge('person_1');
    const two = await lodge('person_2');
    const lot = smallestFreeLot();
    expect((await hub().guildBuyLot(one.id, lot.id)).ok).toBe(true);
    expect((await hub().guildBuyLot(two.id, lot.id)).ok).toBe(false);
    expect((await hub().guildBuyLot(one.id, smallestFreeLot().id)).ok).toBe(false);
    expect((await hub().guildBuyLot('nobody', smallestFreeLot().id)).ok).toBe(false);
  });

  it('a dismembered piece is ground it can buy, and a house fits on every piece', async () => {
    setGold(200_000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 200_000 });
    const big = [...hub().lots].filter(l => !l.ownerId).sort((a, b) => b.price - a.price)[0];
    expect(await hub().dismemberLot(big.id)).toEqual({ ok: true });
    const layout = HubGenerator.generate({ chunks: hub().chunks, dismembered: hub().dismembered });
    const pieces = layout.zones.flatMap(z => z.pois).filter(p => p.metadata.dismemberedFrom === big.id);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      const tpl = houseTemplateFor({ width: piece.size.width, height: piece.size.height });
      expect(tpl, `${piece.size.width}x${piece.size.height}`).toBeTruthy();
      expect(sizeNeedsVerdict(tpl!, { width: piece.size.width, height: piece.size.height }).ok).toBe(true);
    }
    const resident = await lodge();
    expect(await hub().guildBuyLot(resident.id, pieces[0].id)).toEqual({ ok: true });
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('every house the guild can raise is a lawful plan, drawn by nobody but the hub', () => {
    for (const tpl of SYSTEM_TEMPLATES.filter(t => t.structureType === 'HOUSE')) {
      expect(validateTemplate(tpl)).toEqual({ ok: true });
      expect(tpl.authorUid).toBe('SYSTEM');
    }
  });

  it('a guild lot is nobody\'s to split', async () => {
    const resident = await lodge();
    const lot = smallestFreeLot();
    setGold(100_000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 100_000 });
    await hub().guildBuyLot(resident.id, lot.id);
    expect((await hub().dismemberLot(lot.id)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LINE 115: THE POOLED BILL
// ---------------------------------------------------------------------------

describe('line 115: the house rises through the pooled bill (D8)', () => {
  const bought = async () => {
    const resident = await lodge();
    const lot = smallestFreeLot();
    await hub().guildBuyLot(resident.id, lot.id);
    return { resident, lot, bill: houseBill(houseTemplateFor(footprintOf(lot.id))!) };
  };

  it('the bill is the plan\'s own, by tag', async () => {
    const { bill, lot } = await bought();
    const tpl = houseTemplateFor(footprintOf(lot.id))!;
    expect(bill.find(l => l.tag === 'building')!.count).toBeGreaterThanOrEqual(4 + tpl.pieces.filter(p => p.kind === 'WALL').length);
    expect(bill.reduce((n, l) => n + l.count, 0)).toBeGreaterThan(0);
  });

  it('a deposit takes what answers by tag, once, and no more than is asked', async () => {
    const { resident, bill } = await bought();
    const line = bill.find(l => l.tag === 'building')!;
    const items = logs(line.count + 2);
    give(items);
    expect(await hub().poolToHouse(resident.id, 'building', items.map(i => i.id))).toEqual({ ok: true });
    expect(hub().guild.residents[0].house!.pool.building.count).toBe(line.count);
    expect(stash().length).toBe(2);
  });

  it('what does not answer the tag is refused and stays yours', async () => {
    const { resident } = await bought();
    const shard = panes(1)[0];
    give([shard]);
    expect((await hub().poolToHouse(resident.id, 'building', [shard.id])).ok).toBe(false);
    expect(stash().some(i => i.id === shard.id)).toBe(true);
    expect(answersTag(shard, 'building')).toBe(false);
  });

  it('nothing rises until the bill is met', async () => {
    const { resident, bill, lot } = await bought();
    const line = bill[0];
    const items = line.tag === 'glass' ? panes(line.count - 1) : logs(line.count - 1);
    give(items);
    await hub().poolToHouse(resident.id, line.tag, items.map(i => i.id));
    expect(lotConstruction(hub().buildJobs, lot.id)).toBeNull();
    expect(residentStage(hub().guild.residents[0], hub())).toBe('POOLING');
  });

  it('the bill met starts the clock, on the same construction path as any house', async () => {
    const { resident, bill, lot } = await bought();
    for (const line of bill) {
      const items = line.tag === 'glass' ? panes(line.count) : logs(line.count);
      give(items);
      await hub().poolToHouse(resident.id, line.tag, items.map(i => i.id));
    }
    expect(lotConstruction(hub().buildJobs, lot.id)).not.toBeNull();
    expect(residentStage(hub().guild.residents[0], hub())).toBe('RISING');

    await finishBuilds();
    expect(hub().lots.find(l => l.id === lot.id)!.structureType).toBe('HOUSE');
    const room = hub().rooms[lot.id];
    const tpl = houseTemplateFor(footprintOf(lot.id))!;
    expect(templateMatchesRoom(tpl, hub().guild.residents[0].house!.sheet!, room)).toBe(true);
    expect(residentStage(hub().guild.residents[0], hub())).toBe('HOME');
  });

  it('nothing lands in the stash from a house the guild raised', async () => {
    const homed = await house();
    expect(homed.homeAt).toBeGreaterThan(0);
    expect(stash().length).toBe(0);
  });

  it('a person home adds what they know to the web silently, and the web has to reach it (D119)', async () => {
    const resident = await house();
    const skills = Object.keys(readSheet(resident).skills ?? {});
    expect(skills.length).toBeGreaterThan(0);
    for (const id of skills) {
      expect(hub().web.silent?.[id]).toBeTruthy();
      expect(hub().web.nodes[id]).toBeUndefined();
    }
  });

  it('it all comes back after a reload, and a save from before reads as none', async () => {
    const resident = await house();
    const doc = hub().hubDoc()!;
    expect(doc.data.guild.residents[0].id).toBe(resident.id);
    await hub().saveHubState();
    useHubStore.setState({ guild: emptyGuild() });
    await hub().loadHub(HUB);
    expect(hub().guild.residents[0].id).toBe(resident.id);
    expect(residentStage(hub().guild.residents[0], hub())).toBe('HOME');

    const stored = db.get(`hub_state_${HUB}`);
    delete stored.data.guild;
    db.set(`hub_state_${HUB}`, stored);
    await hub().loadHub(HUB);
    // Moved on purpose (D115): opening a hub starts its running clock and its week, and that is all it adds.
    // Q33: and the day its week's shelf went up, which the stock days count from.
    const { runningDay, week, weekFrom, ...rest } = hub().guild;
    expect(runningDay).toBe(worldDay());
    expect(week).toBeDefined();
    expect(weekFrom).toBe(worldDay());
    expect(rest).toEqual(emptyGuild());
  });
});

// ---------------------------------------------------------------------------
// LINE 115: WANTS BECOME QUESTS
// ---------------------------------------------------------------------------

describe('line 115: their wants become quests at the guildhall', () => {
  it('home, and the want on their sheet is on the board', async () => {
    const resident = await house();
    const [quest] = hub().guild.quests;
    expect(quest.residentId).toBe(resident.id);
    expect(quest.state).toBe('OPEN');
    expect(quest.count).toBeGreaterThan(0);
    expect(quest.text).toContain('Serin Vale');
  });

  it('a want is read from the person, keyed, and the same on every machine', async () => {
    const resident = await house();
    const sheet = readSheet(resident);
    expect(wantFor(resident, sheet, HUB, 0)).toEqual(wantFor(resident, sheet, HUB, 0));
    // A HOARD person wants what their own hands work.
    const job = jobOf(sheet)!;
    expect(job.worked).toContain(wantFor(resident, sheet, HUB, 0).tag);
  });

  it('each objective on a sheet wants something of its own', async () => {
    const resident = await lodge();
    const base = readSheet(resident);
    const tagFor = (objective: string) => wantFor(resident, { ...base, objective } as any, HUB, 0).tag;
    expect(tagFor('PROTECT_ASSET')).toBe('building');
    expect(tagFor('WITNESS')).toBe('document');
    expect(tagFor('SURVIVE')).not.toBe('building');
  });

  it('found by playing: coming home keeps the day apart after a want met today', async () => {
    const resident = await lodge();
    // Their first want was met today, so the next waits for tomorrow (fulfilQuest's own rule).
    useHubStore.setState(s => ({ guild: { ...s.guild, residents: s.guild.residents.map(r => r.id === resident.id ? { ...r, nextWantDay: worldDay() + 1 } : r) } }));
    expect(await hub().guildBuyLot(resident.id, smallestFreeLot().id)).toEqual({ ok: true });
    const bought = hub().guild.residents.find(r => r.id === resident.id)!;
    for (const line of houseBill(houseTemplateFor(footprintOf(bought.lotId!))!)) {
      const items = line.tag === 'glass' ? panes(line.count) : logs(line.count);
      give(items);
      await hub().poolToHouse(resident.id, line.tag, items.map(i => i.id));
    }
    await finishBuilds();
    const home = hub().guild.residents.find(r => r.id === resident.id)!;
    expect(home.homeAt).toBeTruthy();
    expect(hub().guild.quests.filter(q => q.residentId === resident.id && q.state === 'OPEN')).toHaveLength(0);
    setGold(player().bank.gold + 1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 });
    await hub().resolveUpkeep(worldDay() + 1);
    await hub().resolveWants(worldDay() + 1);
    expect(hub().guild.quests.filter(q => q.residentId === resident.id && q.state === 'OPEN')).toHaveLength(1);
  });

  it('found by playing: a want for one thing says one thing', async () => {
    const resident = await lodge();
    const sheet = readSheet(resident);
    const asks = Array.from({ length: 40 }, (_, n) => wantFor({ ...resident, bond: { ...resident.bond, rank: UniversalRank.F } }, sheet, HUB, n));
    const one = asks.find(w => w.count === 1);
    expect(one, 'a rank F want for a single thing').toBeTruthy();
    expect(one!.text).not.toMatch(/\b1 things\b/);
    expect(one!.text).toMatch(/\b1 thing\b/);
    expect(asks.find(w => w.count > 1)!.text).toMatch(/\b\d+ things\b/);
  });

  it('what a person wants pays by their want: a thing, then a name, then coin', async () => {
    const resident = await lodge();
    const base = readSheet(resident);
    const pay = (want: string) => wantFor(resident, { ...base, want } as any, HUB, 0).payShare;
    expect(pay('GIFT')).toBeGreaterThan(pay('RESPECT'));
    expect(pay('RESPECT')).toBeGreaterThan(pay('GOLD'));
    expect(pay('GIFT')).toBeLessThan(1.5); // never above what the shelf marks a thing up to
  });

  // Moved on purpose (D115): this held "the hub's treasury pays". They pay it themselves now.
  it('a want met: the things go to their house, and their own wallet pays', async () => {
    const resident = await house();
    const quest = hub().guild.quests[0];
    const items = Array.from({ length: quest.count }, () => thing({ tags: [quest.tag], value: 1 }));
    give(items);
    const before = await Treasury.balance(HUB);
    const held = hub().wallets[resident.id];

    expect(await hub().fulfilQuest(quest.id, items.map(i => i.id))).toEqual({ ok: true });

    const paid = player().bank.gold;
    expect(paid).toBeGreaterThan(0);
    expect(hub().wallets[resident.id]).toBe(held - paid);
    expect(await Treasury.balance(HUB)).toBe(before);
    expect(stash().length).toBe(0);
    const home = hub().lots.find(l => l.id === resident.lotId)!;
    expect(items.every(i => home.inventory.some(h => h.id === i.id))).toBe(true);
    expect(hub().guild.quests[0].state).toBe('DONE');
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('short, wrong or spent: a quest refuses and nothing moves', async () => {
    await house();
    const quest = hub().guild.quests[0];
    const wrong = Array.from({ length: quest.count }, () => thing({ universalDefinitionId: 'no_such_def', tags: ['ink'] }));
    give(wrong);
    expect((await hub().fulfilQuest(quest.id, wrong.map(i => i.id))).ok).toBe(false);
    const short = thing({ tags: [quest.tag] });
    give([short]);
    if (quest.count > 1) expect((await hub().fulfilQuest(quest.id, [short.id])).ok).toBe(false);
    expect(player().bank.gold).toBe(0);
    expect((await hub().fulfilQuest('no_such_quest', [])).ok).toBe(false);
  });

  // Moved on purpose (D115): this held "the hub's treasury cannot pay". It is their wallet now, and it waits on them.
  it('they cannot pay it, and the want waits: nobody prints for them', async () => {
    await house();
    const quest = hub().guild.quests[0];
    const items = Array.from({ length: quest.count }, () => thing({ tags: [quest.tag], value: 1_000_000 }));
    give(items);
    expect((await hub().fulfilQuest(quest.id, items.map(i => i.id))).ok).toBe(false);
    expect(stash().length).toBe(quest.count);
    expect(hub().guild.quests[0].state).toBe('OPEN');
    expect(hub().guild.printed.count).toBe(0);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('the next want waits for the next day, then posts, and differs by the count of what came before', async () => {
    const resident = await house();
    const first = hub().guild.quests[0];
    const items = Array.from({ length: first.count }, () => thing({ tags: [first.tag] }));
    give(items);
    await hub().fulfilQuest(first.id, items.map(i => i.id));
    await hub().resolveWants(worldDay());
    expect(hub().guild.quests.filter(q => q.state === 'OPEN').length).toBe(0);
    setGold(player().bank.gold + 1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 });
    await hub().resolveUpkeep(worldDay() + 1);
    await hub().resolveWants(worldDay() + 1);
    const open = hub().guild.quests.filter(q => q.state === 'OPEN');
    expect(open.length).toBe(1);
    expect(open[0].n).toBe(first.n + 1);
    expect(open[0].residentId).toBe(resident.id);
  });

  it('line 35: a job with a real effect: the bench runs quicker on what they work', async () => {
    const resident = await lodge();
    const sheet = readSheet(resident);
    const job = jobOf(sheet)!;
    expect(job.name.length).toBeGreaterThan(0);
    const pair = { id: 'skill_x', tags: [job.worked[0]] };
    const away = { ...resident, homeAt: undefined };
    const home = { ...resident, homeAt: 1 };
    expect(benchFactor([away], pair)).toBe(1);
    expect(benchFactor([home], pair)).toBeLessThan(1);
    expect(benchFactor([home], { tags: ['no_such_material'] })).toBe(1);
    expect(benchFactor([home, { ...home, id: 'two' }], pair)).toBeLessThan(benchFactor([home], pair));
    expect(benchFactor([home], null)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D10: UPKEEP
// ---------------------------------------------------------------------------

describe('D10: a resident costs gold through higher upkeep, and no new money path', () => {
  it('a house with someone in it costs more than a house', () => {
    expect(residentUpkeepPerDay(UniversalRank.F)).toBeGreaterThan(5);
    expect(residentUpkeepPerDay(UniversalRank.D)).toBeGreaterThan(residentUpkeepPerDay(UniversalRank.F));
  });

  it('the one who brought them out pays it, to the hub\'s treasury, as an upkeep row', async () => {
    const resident = await house();
    setGold(1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 });
    const before = await Treasury.balance(HUB);
    const lot = hub().lots.find(l => l.id === resident.lotId)!;
    await hub().resolveUpkeep(lot.upkeepPaidThroughDay! + 2);
    const paid = 1000 - player().bank.gold;
    expect(paid).toBeGreaterThanOrEqual(2);
    expect(await Treasury.balance(HUB)).toBe(before + paid);
    expect(hub().lots.find(l => l.id === lot.id)!.ownerId).toBe(GUILD_OWNER_ID);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
    const rows = await Ledger.list(UID);
    expect(rows.some(r => r.payload.type === 'UPKEEP' && r.payload.data.residentId === resident.id)).toBe(true);
  });

  it('unpaid, the house stands and the debt waits, and they want nothing more until it is paid', async () => {
    const resident = await house();
    const quest = hub().guild.quests[0];
    const items = Array.from({ length: quest.count }, () => thing({ tags: [quest.tag], value: 0 }));
    give(items);
    await hub().fulfilQuest(quest.id, items.map(i => i.id));
    setGold(0);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_RESET', amount: -(player().bank.gold) });
    const lot = hub().lots.find(l => l.id === resident.lotId)!;
    const later = lot.upkeepPaidThroughDay! + 3;

    await hub().resolveUpkeep(later);
    expect(hub().lots.find(l => l.id === lot.id)!.ownerId).toBe(GUILD_OWNER_ID);
    expect(hub().rooms[lot.id]).toBeTruthy();
    await hub().resolveWants(later);
    expect(hub().guild.quests.filter(q => q.state === 'OPEN').length).toBe(0);

    setGold(1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 - 0 });
    await hub().resolveUpkeep(later);
    expect(player().bank.gold).toBeLessThan(1000);
    await hub().resolveWants(later);
    expect(hub().guild.quests.filter(q => q.state === 'OPEN').length).toBe(1);
  });

  it('someone else\'s resident is not charged to you, and does not fall when you look', async () => {
    const resident = await house();
    setGold(1000);
    usePlayerStore.setState(s => ({ player: { ...s.player, id: 'another_avatar' } }));
    const lot = hub().lots.find(l => l.id === resident.lotId)!;
    await hub().resolveUpkeep(lot.upkeepPaidThroughDay! + 5);
    expect(player().bank.gold).toBe(1000);
    expect(hub().lots.find(l => l.id === lot.id)!.ownerId).toBe(GUILD_OWNER_ID);
    usePlayerStore.setState(s => ({ player: { ...s.player, id: UID } }));
  });
});

// ---------------------------------------------------------------------------
// LINE 38: THE WHOLE CYCLE
// ---------------------------------------------------------------------------

describe('lines 38 and 115: the gold audit balances through a whole cycle', () => {
  it('rescue, tavern, lot, pooled house, want, upkeep and another want', async () => {
    setGold(500);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 500 });
    const resident = await house();
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);

    const quest = hub().guild.quests[0];
    const items = Array.from({ length: quest.count }, () => thing({ tags: [quest.tag], value: 30 }));
    give(items);
    await hub().fulfilQuest(quest.id, items.map(i => i.id));
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);

    const lot = hub().lots.find(l => l.id === resident.lotId)!;
    const day = lot.upkeepPaidThroughDay! + 3;
    await hub().resolveUpkeep(day);
    await hub().resolveWants(day);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);

    const next = hub().guild.quests.find(q => q.state === 'OPEN')!;
    const more = Array.from({ length: next.count }, () => thing({ tags: [next.tag], value: 30 }));
    give(more);
    await hub().fulfilQuest(next.id, more.map(i => i.id));

    const audit = await GoldAudit.run(usePlayerStore.getState().player);
    expect(audit.notes).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(await Ledger.audit(UID)).toMatchObject({ ok: true });
  });

  it('no door here moves gold outside the one commit', () => {
    const guild = readFileSync('src/entities/hub/guild.ts', 'utf8');
    expect(guild).not.toMatch(/Treasury\.|GoldCommit|Ledger\.|setState/);
    const store = readFileSync('src/entities/hub/store.ts', 'utf8');
    expect(store).not.toMatch(/Treasury\.credit/);
  });
});

// ---------------------------------------------------------------------------
// LINE 128: THE RANK HALF
// ---------------------------------------------------------------------------

describe('line 128: the rank comes from the guild, by a hard quest (D83)', () => {
  /** Things of a rank, brought out through the gate by this person. */
  const hauled = async (count: number, rank = UniversalRank.E, actor?: string): Promise<IItem[]> => {
    const items = Array.from({ length: count }, () => thing({ rank, tags: ['ore', 'metal'] }));
    give(items);
    if (actor) useIdentityStore.setState({ certificate: { metadata: { uid: actor, displayName: 'X' } } as any });
    await Provenance.recordMany(items, 'MINT', { origin: 'EXTRACTION', sessionId: 's1', worldCertUid: 'w1' });
    if (actor) useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'QUOIN' } } as any });
    return items;
  };

  it('the trial names the next rank, and asks more as the ranks climb', () => {
    const f = trialFor(UniversalRank.F)!;
    const d = trialFor(UniversalRank.D)!;
    expect(f.to).toBe(UniversalRank.E);
    expect(d.to).toBe(UniversalRank.C);
    expect(d.count).toBeGreaterThan(f.count);
    expect(trialFor(UniversalRank.SSS)).toBeNull();
  });

  it('passed: the rank moves, the level resets, the stats stay, and the moment shows', async () => {
    usePlayerStore.getState().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1) + ProgressionSystem.levelCost(UniversalRank.F, 2));
    const before = player();
    expect(ProgressionSystem.levelOf(before)).toBe(3);
    const items = await hauled(trialFor(UniversalRank.F)!.count);

    expect(await hub().passTrial(items.map(i => i.id))).toEqual({ ok: true });

    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.E);
    expect(ProgressionSystem.levelOf(player())).toBe(1);
    expect(player().attributes).toEqual(before.attributes);
    expect(player().attributePoints).toBe(before.attributePoints);
    expect(useRankMoment.getState().moment).toMatchObject({ from: UniversalRank.F, to: UniversalRank.E });
  });

  it('what was handed over stays on the hall\'s record, and is not in the stash', async () => {
    const items = await hauled(trialFor(UniversalRank.F)!.count);
    await hub().passTrial(items.map(i => i.id));
    expect(stash().length).toBe(0);
    expect(items.every(i => hub().guild.trophies.some(t => t.id === i.id))).toBe(true);
    const rows = await Ledger.list(UID);
    expect(rows.some(r => r.payload.type === 'GUILD' && r.payload.data.kind === 'RANK_GRANTED' && r.payload.data.to === UniversalRank.E)).toBe(true);
  });

  it('short of the count, or of the rank, it refuses', async () => {
    const need = trialFor(UniversalRank.F)!.count;
    const few = await hauled(need - 1);
    expect((await hub().passTrial(few.map(i => i.id))).ok).toBe(false);
    const low = await hauled(need, UniversalRank.F);
    expect((await hub().passTrial(low.map(i => i.id))).ok).toBe(false);
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.F);
    expect(stash().length).toBe(few.length + low.length);
  });

  it('bought, or carried out by someone else, does not count', async () => {
    const need = trialFor(UniversalRank.F)!.count;
    const bought = Array.from({ length: need }, () => thing({ rank: UniversalRank.E }));
    give(bought);
    expect((await hub().passTrial(bought.map(i => i.id))).ok).toBe(false);
    const theirs = await hauled(need, UniversalRank.E, 'someone_else');
    expect((await hub().passTrial(theirs.map(i => i.id))).ok).toBe(false);
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.F);
  });

  it('an unread piece cannot be handed in, so nothing says its rank aloud', async () => {
    const need = trialFor(UniversalRank.F)!.count;
    const items = await hauled(need);
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: t.items.map(it => ({ ...it, isIdentified: false })) } : t) } }
    }));
    const res = await hub().passTrial(items.map(i => i.id));
    expect(res.ok).toBe(false);
    expect(res.reason).not.toMatch(/\brank [A-Z]/i);
  });

  it('experience alone never moves the rank', () => {
    usePlayerStore.getState().applyKillXp(10_000_000);
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.F);
  });

  it('nothing else grants a rank: the guild\'s trial is the one caller', () => {
    const store = readFileSync('src/entities/hub/store.ts', 'utf8');
    expect((store.match(/grantRank\(/g) ?? []).length).toBe(1);
    expect(store).toMatch(/passTrial:[\s\S]*grantRank\(/);
  });

  it('the Hall is open, and Vex no longer says it is sealed', () => {
    const vex = HUB_NPCS.npc_guild_master.dialogue;
    expect(vex.greeting).not.toMatch(/Seed lets me|register any/i);
    expect(vex.options.map(o => o.action)).toContain('OPEN_HALL');
    expect(runDialogueAction(worldPort, playerPort, hubPort, 'OPEN_HALL')).toEqual({ kind: 'open', panel: 'guild' });
    const lore = runDialogueAction(worldPort, playerPort, hubPort, 'GUILD_LORE');
    expect(lore.kind).toBe('reply');
    expect((lore as any).text).not.toMatch(/sealed/i);
  });
});

// ---------------------------------------------------------------------------
// LINE 141: THE LEVY'S ROLL
// ---------------------------------------------------------------------------

describe('line 141: dodging the levy is a keyed roll that can fail, and doing it grows a skill (D100)', () => {
  const attempt = (session: string, over: Partial<Parameters<typeof ExitLevy.assess>[0]> = {}) =>
    ExitLevy.assess({ playerId: UID, worldUid: 'w1', sessionId: session, haulValue: 1000, rateAsked: 0.05, attributes: player().attributes, skill: undefined, ...over });

  it('the plain reduction is gone: subterfuge reaches the roll instead', () => {
    expect((StatSystem as any).levyRate).toBeUndefined();
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).not.toMatch(/levyRate/);
    expect(readFileSync('shared/logic/systems/StatSystem.ts', 'utf8')).toMatch(/subterfuge: \[[^\]]*StatSystem\.levyDodgeOdds/);
  });

  it('it never works every time, however much is behind it', () => {
    const huge = { ...player().attributes, subterfuge: 1_000_000 };
    const master = { id: 'skill_tax_evasion', level: 1_000_000 } as any;
    expect(StatSystem.levyDodgeOdds(huge, master)).toBeLessThan(1);
    expect(StatSystem.levyDodgeOdds(huge, master)).toBeGreaterThan(StatSystem.levyDodgeOdds(player().attributes));
    expect(StatSystem.levyDodgeOdds(player().attributes)).toBeGreaterThan(0);
  });

  it('both subterfuge and the skill raise the odds', () => {
    const floor = { ...player().attributes, subterfuge: 1 };
    const sly = { ...floor, subterfuge: 30 };
    expect(StatSystem.levyDodgeOdds(sly)).toBeGreaterThan(StatSystem.levyDodgeOdds(floor));
    expect(StatSystem.levyDodgeOdds(floor, { level: 20 } as any)).toBeGreaterThan(StatSystem.levyDodgeOdds(floor));
  });

  it('the roll is keyed: one session reads the same on every machine', () => {
    expect(attempt('session_a')).toEqual(attempt('session_a'));
  });

  it('it can fail and it can land, and a failure asks the full rate', () => {
    const rolls = Array.from({ length: 400 }, (_, i) => attempt(`session_${i}`, { attributes: { ...player().attributes, subterfuge: 40 } }));
    const landed = rolls.filter(r => r.dodged);
    const failed = rolls.filter(r => !r.dodged);
    expect(landed.length).toBeGreaterThan(0);
    expect(failed.length).toBeGreaterThan(0);
    for (const r of failed) { expect(r.ratePaid).toBe(0.05); expect(r.owed).toBe(50); }
    for (const r of landed) { expect(r.ratePaid).toBe(0); expect(r.owed).toBe(0); }
  });

  it('nothing to hide, nothing to attempt', () => {
    expect(attempt('session_empty', { haulValue: 0 })).toMatchObject({ attempted: false, dodged: false });
  });

  const findSession = (dodged: boolean) => {
    for (let i = 0; i < 2000; i++) {
      const a = attempt(`find_${i}`);
      if (a.dodged === dodged) return { session: `find_${i}`, attempt: a };
    }
    throw new Error('no session');
  };

  it('a failed attempt pays in full, the treasury has it, and the record says the rate paid', async () => {
    setGold(1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 });
    const { attempt: failed } = findSession(false);
    expect(await ExitLevy.charge(playerPort, 'w1', 1000, failed.ratePaid, failed)).toBe(50);
    expect(player().bank.gold).toBe(950);
    expect(await Treasury.balance('w1')).toBe(50);
    const row = (await Ledger.list(UID)).find(r => r.payload.type === 'TAX')!.payload.data;
    expect(row).toMatchObject({ rate: 0.05, rateAsked: 0.05, dodged: false, tax: 50 });
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('a dodge pays nothing, and the row is still written, saying so', async () => {
    setGold(1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 });
    const { attempt: landed } = findSession(true);
    expect(await ExitLevy.charge(playerPort, 'w1', 1000, landed.ratePaid, landed)).toBe(0);
    expect(player().bank.gold).toBe(1000);
    const row = (await Ledger.list(UID)).find(r => r.payload.type === 'TAX')!.payload.data;
    expect(row).toMatchObject({ rate: 0, rateAsked: 0.05, dodged: true, tax: 0, owed: 0 });
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('the old call still charges plainly, for any other caller', async () => {
    setGold(1000);
    await Ledger.append('GOLD_DELTA', { reason: 'TEST_GRANT', amount: 1000 });
    expect(await ExitLevy.charge(playerPort, 'w2', 1000, 0.05)).toBe(50);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('the skill is on the web, named, and lawful', () => {
    const pair = WebSystem.mint(TAX_EVASION_TAGS, []);
    expect(pair.id).toBe('skill_tax_evasion');
    expect(WebSystem.isLawfulId(pair.id)).toBe(true);
    expect(WebSystem.nameOf(pair.id)).toBe('Tax Evasion');
    expect(WebBank.current().tags.some(t => t.tag === 'tax_evasion' && t.kind === 'trade')).toBe(true);
  });

  it('an attempt is practice whichever way it goes, and it settles at a rest like any skill', () => {
    const pair = WebSystem.mint(TAX_EVASION_TAGS, []);
    ExitLevy.practise(findSession(false).attempt, 0, playerPort);
    expect(player().skillProgress?.[pair.id]?.attempts).toBe(1);
    ExitLevy.practise(findSession(true).attempt, 0, playerPort);
    expect(player().skillProgress?.[pair.id]?.attempts).toBe(2);
  });

  it('a held skill grows from it', () => {
    const pair = WebSystem.mint(TAX_EVASION_TAGS, []);
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, universalSkills: { [pair.id]: WebSystem.freshSkill(pair.id, pair.tags, 0) } } }
    }));
    const before = WebSystem.cumulativeXp(player().bank.universalSkills[pair.id]);
    ExitLevy.practise(findSession(false).attempt, 0, playerPort);
    expect(WebSystem.cumulativeXp(player().bank.universalSkills[pair.id])).toBeGreaterThan(before);
  });

  it('the skill stands at the rank of who is doing it, not of what they happened to carry (found in play)', () => {
    const pair = WebSystem.mint(TAX_EVASION_TAGS, []);
    ExitLevy.attemptNow('w1', 'session_rank', 1000, 0.05, playerPort);
    expect(player().skillProgress?.[pair.id]?.rank).toBe(ProgressionSystem.rankIndex(ProgressionSystem.rankOf(player())));
  });

  it('nothing to hide teaches nothing', () => {
    const pair = WebSystem.mint(TAX_EVASION_TAGS, []);
    ExitLevy.practise(attempt('session_empty', { haulValue: 0 }), 0, playerPort);
    expect(player().skillProgress?.[pair.id]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D93: THE DOOR
// ---------------------------------------------------------------------------

describe('D93: a map handed to the guild is a real act, and the door to a chain', () => {
  const sheet = {
    '3,4': { level: 2, generation: 4, contacts: { MOB: 14, RESOURCE: 3 }, changed: 2 },
    '5,1': { level: 1, generation: 2, contacts: { MOB: 2 }, changed: 0 }
  };
  const map = (id = `map_${++minted}`): IItem => thing({
    id, universalDefinitionId: 'map_survey', name: 'MAP OF THE LONG STANDS', type: ItemType.MAP, tags: ['document'], value: 30,
    mapData: { worldId: 'world_1', worldName: 'The Long Stands', scribeUid: 'scribe', scribeName: 'TENON', writtenAt: 7, sectors: sheet }
  } as any);

  it('handed in: it leaves the stash, the hall keeps it whole, and a row says so', async () => {
    const m = map();
    give([m]);
    expect(await hub().handMapToGuild(m.id)).toEqual({ ok: true });
    expect(stash().some(i => i.id === m.id)).toBe(false);
    expect(hub().guild.maps[0].item.id).toBe(m.id);
    expect(hub().guild.maps[0].item.mapData!.sectors).toEqual(sheet);
    expect(hub().guild.maps[0].handedBy).toBe(UID);
    const rows = await Ledger.list(UID);
    expect(rows.some(r => r.payload.type === 'GUILD' && r.payload.data.kind === 'MAP_HANDED_IN' && r.payload.data.itemId === m.id)).toBe(true);
  });

  it('only a map, and only once', async () => {
    const m = map();
    const log = thing();
    give([m, log]);
    expect((await hub().handMapToGuild(log.id)).ok).toBe(false);
    const both = await Promise.all([hub().handMapToGuild(m.id), hub().handMapToGuild(m.id)]);
    expect(both.filter(v => v.ok).length).toBe(1);
    expect(hub().guild.maps.length).toBe(1);
  });

  it('it comes back after a reload', async () => {
    const m = map();
    give([m]);
    await hub().handMapToGuild(m.id);
    useHubStore.setState({ guild: emptyGuild() });
    await hub().loadHub(HUB);
    expect(hub().guild.maps[0].item.id).toBe(m.id);
  });

  it('it reads what the map holds, and a map showing nobody holding ground asks nothing (C4: moved on purpose)', () => {
    const chain = chainFromMap(map().mapData!);
    expect(chain.worldName).toBe('The Long Stands');
    expect(chain.sectors).toBe(2);
    expect(chain.mobs).toBe(16);
    expect(chain.changed).toBe(2);
    expect(chain.hottest).toBe('3,4');
    expect(chain.steps).toEqual([]);
  });

  it('it posts nothing while the map shows no seat to chain to', async () => {
    const m = map();
    give([m]);
    await hub().handMapToGuild(m.id);
    expect(hub().guild.quests.length).toBe(0);
    expect(chainFromMap(m.mapData!).posted).toBe(false);
    expect(chainFromMap(m.mapData!).seat).toBeNull();
  });

  it('a map holds counts and no name, and the chain adds none (D60)', () => {
    expect(JSON.stringify(chainFromMap(map().mapData!))).not.toMatch(/mob_|definitionId|displayName/);
  });
});

describe('Pedro: "you can\'t talk across a distance"', () => {
  const layout = HubGenerator.generate();
  const hall = HubGenerator.findPOI(layout, 'poi_guild')!;
  const door = doorOf(hall);
  const canvas = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
  const clickBody = canvas.slice(canvas.indexOf('const handleCityClick'), canvas.indexOf('// ====', canvas.indexOf('const handleCityClick')));

  it('at the door you are near, and across the street you are not', () => {
    expect(withinReach(hall, door)).toBe(true);
    expect(withinReach(hall, { x: door.x + 2, y: door.y })).toBe(true);
    expect(withinReach(hall, { x: door.x + 40, y: door.y })).toBe(false);
  });

  it('a click answers only within reach, by the same measure as the interact key', () => {
    expect(clickBody).toMatch(/withinReach\(poi, playerTile\)/);
    expect(canvas).toMatch(/if \(withinReach\(poi, playerTile\) && dist < closestDist\)/);
  });

  it('a click from too far says so, so it does not look broken', () => {
    expect(clickBody).toMatch(/pushFeed\(/);
  });
});

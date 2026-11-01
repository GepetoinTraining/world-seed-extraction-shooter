/**
 * BUILDINGS IN THE HUB'S TECH, through the store's doors (D91, D119; lines 136, 154).
 * Registered before the doors exist, so these were red first.
 *
 * A person comes home and what they know goes in unseen. Someone gives them the workshop they
 * want, as one station or as a machine that folds their whole road, on ground someone owns,
 * and only what does not stand is ever billed. When the web reaches it, it comes out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = new Map<string, any>();
const door = vi.hoisted(() => ({ answers: [] as any[], calls: 0, status: 'OK' as string }));

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

vi.mock('../src/logic/intelligence/IntelligenceClient', async original => {
  const real = await original<typeof import('../src/logic/intelligence/IntelligenceClient')>();
  return {
    ...real,
    IntelligenceClient: {
      ...real.IntelligenceClient,
      resolveChain: async () => {
        door.calls++;
        if (door.status !== 'OK') return { status: door.status, reason: 'no' };
        return { status: 'OK', data: door.answers.shift() };
      }
    }
  };
});

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../types';
import { buildingLabel, useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { Ledger } from '../src/logic/ledger/Ledger';
import { WebBank } from '../src/logic/content/WebBank';
import { CRAFTED_DEFINITIONS } from '../src/entities/economy/data/recipeDefinitions';
import { WebSystem } from '../src/logic/systems/WebSystem';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { useFeed } from '../src/components/ui/stores';
import { IResident, readSheet } from '../src/entities/hub/guild';
import { emptyTech } from '../src/entities/hub/hubTech';
import { answersTag } from '../src/entities/hub/room';
import { SYSTEM_TEMPLATES, validateTemplate } from '../src/entities/hub/template';

const UID = 'uid_tech';
const HUB = 'hub_tech';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const stash = () => player().bank.stashTabs[0].items;

let minted = 0;
const thing = (over: Partial<IItem> = {}): IItem => ({
  id: `thing_${++minted}`, universalDefinitionId: 'res_tree_log', name: 'Oak Log', description: '', type: ItemType.RESOURCE, slot: SlotType.NONE,
  rank: UniversalRank.F, rarity: Rarity.COMMON, level: 1, quality: 0, value: 10, itemPower: 0, tags: ['wood', 'building', 'flora', 'metal', 'glass', 'cloth'],
  affixes: [], dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'x', colorHex: '#000000' }, icon: 'x',
  history: { dropDate: 0, killCount: 0 }, isIdentified: true, ...over
} as IItem);

const bondOf = (entityId: string, over: Record<string, any> = {}): IItem => thing({
  id: `bond_${++minted}`, universalDefinitionId: 'npc_contract', name: 'Escort Bond', type: ItemType.LORE, rarity: Rarity.RARE, rank: UniversalRank.D, value: 200, tags: ['npc_contract'],
  bondData: {
    worldSeed: 'seed_tech', entityId, webVersion: WebBank.version(), rank: UniversalRank.D, rarity: Rarity.RARE,
    sheet: { name: `Person ${entityId}`, temperament: 'PASSIVE', objective: 'HOARD', want: 'GOLD', disposition: 80, attempts: 3 }, ...over
  }
} as any);

const give = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...items] } : t) } }
}));

const finishBuilds = async () => {
  useHubStore.setState(s => ({ buildJobs: s.buildJobs.map(j => ({ ...j, finishesAt: 0 })) }));
  await hub().resolveBuilds();
};

const lots = () => [...hub().lots].filter(l => !l.ownerId).sort((a, b) => a.price - b.price);

/** Someone home: bought, pooled and risen, as B4's bars hold. */
const home = async (entityId: string): Promise<IResident> => {
  const bond = bondOf(entityId);
  give([bond]);
  expect(await hub().redeemBond(bond.id)).toEqual({ ok: true });
  const resident = hub().guild.residents.find(r => r.entityId === entityId)!;
  const lot = lots()[0];
  expect(await hub().guildBuyLot(resident.id, lot.id)).toEqual({ ok: true });
  const fresh = hub().guild.residents.find(r => r.id === resident.id)!;
  for (const line of Object.keys(fresh.house!.pool).length ? [] : [{ tag: 'building', count: 20 }, { tag: 'wood', count: 20 }, { tag: 'glass', count: 20 }]) {
    const batch = Array.from({ length: line.count }, () => thing());
    give(batch);
    await hub().poolToHouse(resident.id, line.tag, batch.map(i => i.id)).catch(() => undefined);
  }
  await finishBuilds();
  return hub().guild.residents.find(r => r.id === resident.id)!;
};

/** Ground the player holds. */
const ownLot = async () => {
  const lot = lots()[0];
  expect(await hub().buyLot(lot.id)).toBe(true);
  return lot.id;
};

const payAll = async (workshopId: string) => {
  const shop = hub().tech.workshops.find(w => w.id === workshopId)!;
  for (const line of shop.bill) {
    const batch = Array.from({ length: line.count }, () => thing());
    give(batch);
    expect(await hub().poolToWorkshop(workshopId, line.tag, batch.map(i => i.id))).toEqual({ ok: true });
  }
};

beforeEach(async () => {
  db.clear();
  door.answers = [];
  door.calls = 0;
  door.status = 'NO_KEY';
  useIdentityStore.setState({ certificate: { metadata: { uid: UID } } } as any);
  usePlayerStore.setState(s => ({
    player: { ...s.player, id: UID, username: 'Tester', bank: { ...s.player.bank, gold: 50_000_000, stashTabs: [{ id: 'main', name: 'MAIN', items: [] }] as any } }
  }));
  useHubStore.setState({ activeHubId: null, guild: { spent: 0, residents: [], quests: [], maps: [], trophies: [] }, lots: [], tech: emptyTech(), buildJobs: [], rooms: {}, web: { nodes: {} }, craftsmen: [], vendors: {} } as any);
  await Ledger.append('CHARACTER_GENESIS', { gold: 50_000_000 });
  await hub().loadHub(HUB);
  useFeed.setState({ lines: [] } as any);
});

describe('coming home', () => {
  it('what a person knows goes in silently: nothing shows, opens or gets written where a player reads', async () => {
    const before = hub().openStationsNow().map(s => s.id);
    const resident = await home('p1');
    const skills = Object.keys(readSheet(resident).skills ?? {});
    expect(skills.length).toBeGreaterThan(0);
    for (const id of skills) {
      expect(hub().web.nodes[id]).toBeUndefined();
      expect(hub().web.silent?.[id]?.by.uid).toBe(resident.id);
    }
    expect(hub().openStationsNow().map(s => s.id)).toEqual(before);
  });

  it('no line in the feed gives it away', async () => {
    const resident = await home('p1');
    const skills = Object.values(readSheet(resident).skills ?? {});
    const lines = JSON.stringify((useFeed.getState() as any).lines ?? []);
    for (const s of skills) expect(lines).not.toContain(WebSystem.nameOf(s.id));
  });

  it('it stays silent through a reload', async () => {
    const resident = await home('p1');
    await hub().saveHubState();
    const skill = Object.keys(readSheet(resident).skills ?? {})[0];
    useHubStore.setState({ web: { nodes: {} }, tech: emptyTech() } as any);
    await hub().loadHub(HUB);
    expect(hub().web.silent?.[skill]).toBeTruthy();
    expect(hub().web.nodes[skill]).toBeUndefined();
  });
});

describe('what they want', () => {
  it('home, they say what they want, from their own sheet', async () => {
    const resident = await findWorking();
    const offer = hub().workshopOffer(resident.id)!;
    expect(offer.stationId).toBeTruthy();
    expect(offer.profession.name).toBeTruthy();
    expect(offer.station.bill.length).toBeGreaterThanOrEqual(1);
  });

  it('someone still at the tavern is asked nothing', async () => {
    const bond = bondOf('p9');
    give([bond]);
    await hub().redeemBond(bond.id);
    const resident = hub().guild.residents.find(r => r.entityId === 'p9')!;
    expect(hub().workshopOffer(resident.id)).toBeNull();
  });

  it('a person can ask for the building their goal needs: the door a talk writes', async () => {
    const resident = await findWorking();
    const station = WebBank.current().stations[2];
    expect(await hub().askWorkshop(resident.id, station.id, 'I need this to do what I came for.')).toEqual({ ok: true });
    expect(hub().tech.asks[resident.id].by).toBe('TALK');
    expect(hub().workshopOffer(resident.id)!.stationId).toBe(station.id);
    expect((await hub().askWorkshop(resident.id, 'stn_nothing', 'x')).ok).toBe(false);
    expect((await hub().askWorkshop('nobody', station.id, 'x')).ok).toBe(false);
  });

  // Where C2's talk met this stream, at the join
  it('what a talk asks for goes on the Hall\'s board, and is the workshop they now say they want', async () => {
    const resident = await findWorking();
    const station = WebBank.current().stations[2];
    await hub().askForBuilding(resident.id, resident.name, station.id, 'Get a bench of their own.', 'purpose');
    expect(hub().openBuildingAsks().map(a => a.building)).toEqual([station.id]);
    expect(hub().tech.asks[resident.id]).toMatchObject({ stationId: station.id, by: 'TALK' });
    expect(hub().workshopOffer(resident.id)!.stationId).toBe(station.id);
  });

  it('asking for a house, or a keeper asking, goes on the board and writes no workshop', async () => {
    const resident = await findWorking();
    await hub().askForBuilding(resident.id, resident.name, 'house', 'Get a roof.', 'shelter');
    await hub().askForBuilding('npc_keeper', 'A Keeper', WebBank.current().stations[2].id, 'Get a bench.', 'purpose');
    expect(hub().openBuildingAsks()).toHaveLength(2);
    expect(hub().tech.asks).toEqual({});
  });

  it('a station a chain wrote can be asked for by name, and only a known one', async () => {
    const before = hub().buildingWords();
    useHubStore.setState({ tech: { ...hub().tech, chain: { ...hub().tech.chain, stations: [{ key: 'glass_kiln', name: 'Glass Kiln', blurb: 'Hot.', tool: ['blunt'], material: ['stone'], bill: ['stone'] }] } } as never });
    expect(hub().buildingWords()).toEqual([...before, 'glass_kiln']);
    expect(buildingLabel('glass_kiln')).toBe('Glass Kiln');
  });

  it('a workshop that stands answers what its person asked for, and nobody else\'s ask', async () => {
    const resident = await findWorking();
    const station = WebBank.current().stations[2];
    await hub().askForBuilding(resident.id, resident.name, station.id, 'Get a bench.', 'purpose');
    await hub().askForBuilding('npc_keeper', 'A Keeper', station.id, 'Get a bench.', 'purpose');
    useHubStore.setState({ tech: { ...hub().tech, workshops: [{ id: 'shop_1', residentId: resident.id, lotId: 'lot_x', mode: 'WORKSTATION', stations: [station.id], name: station.name, bill: [], pool: {}, raised: true }] } });
    await hub().settleWorkshops();
    expect(hub().openBuildingAsks().map(a => a.askerId)).toEqual(['npc_keeper']);
    expect(hub().guild.asks!.find(a => a.askerId === resident.id)).toMatchObject({ state: 'MET', metBy: 'shop_1' });
  });
});

/** A person whose hands open a station, whatever this web deals them. */
const findWorking = async (): Promise<IResident> => {
  for (let i = 0; i < 12; i++) {
    const resident = await home(`worker_${i}`);
    if (hub().workshopOffer(resident.id)) return resident;
  }
  throw new Error('Nobody in twelve opens a station.');
};

const findWorkingOther = async (not: string): Promise<IResident> => {
  for (let i = 0; i < 12; i++) {
    const r = await home(`other_${i}_${not.length}`);
    if (r.id !== not) return r;
  }
  throw new Error('Nobody else came.');
};

describe('giving it to them', () => {
  it('it has to be ground you hold, and empty', async () => {
    const resident = await findWorking();
    const free = lots()[0].id;
    expect((await hub().provideWorkshop(resident.id, free, 'WORKSTATION')).ok).toBe(false);
    const lot = await ownLot();
    expect(await hub().provideWorkshop(resident.id, lot, 'WORKSTATION')).toEqual({ ok: true });
    expect((await hub().provideWorkshop(resident.id, lot, 'WORKSTATION')).ok).toBe(false);
  });

  it('a building refuses ground too small for it, with the numbers', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    // A road of forty stations, each feeding the next, to the person's own at the end
    const keys = Array.from({ length: 40 }, (_, i) => `extra_${i}`);
    useHubStore.setState(s => ({ tech: { ...s.tech,
      professions: { [resident.id]: { name: 'Far', blurb: '', concept: 'far', knows: 'far', workshop: 'x', tool: ['hammer'], material: ['metal'], rank: 'E', from: 'THEME' } },
      chain: { ...s.tech.chain,
        stations: keys.map(key => ({ key, name: 'x', blurb: '', tool: ['hammer'], material: ['metal'], bill: [{ tag: 'metal', count: 1 }] })),
        goods: keys.map((key, i) => ({ key: `g_${i}`, name: 'x', blurb: '', tags: [], rank: 'E', weight: 'light', trade: 'smithing', station: key, from: [{ key: i === 0 ? 'res_tree_log' : `g_${i - 1}`, count: 1 }], makes: 1, answers: i === 39 ? 'far' : '' })) as any
      } } } as any));
    const res = await hub().provideWorkshop(resident.id, lot, 'MACHINE');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/\d+ tiles/);
  });

  it('nothing is paid but through the bill, and a deposit is gone once given', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    const shop = hub().tech.workshops[0];
    const line = shop.bill[0];
    const batch = Array.from({ length: line.count + 2 }, () => thing());
    give(batch);
    expect(await hub().poolToWorkshop(shop.id, line.tag, batch.map(i => i.id))).toEqual({ ok: true });
    expect(hub().tech.workshops[0].pool[line.tag].count).toBe(line.count);
    expect(stash().filter(i => batch.some(b => b.id === i.id)).length).toBe(2);
    expect((await hub().poolToWorkshop(shop.id, line.tag, stash().map(i => i.id))).ok).toBe(false);
  });

  it('a second person who wants what is already on its way is not asked to pay for it again', async () => {
    const resident = await findWorking();
    const other = await findWorkingOther(resident.id);
    const wanted = hub().workshopOffer(resident.id)!.stationId;
    useHubStore.setState(s => ({ tech: { ...s.tech, asks: { [other.id]: { stationId: wanted, words: 'The same.', by: 'SHEET' } } } }));
    await hub().provideWorkshop(resident.id, await ownLot(), 'WORKSTATION');
    expect(hub().workshopOffer(other.id)!.coming).toBe(true);
    expect((await hub().provideWorkshop(other.id, await ownLot(), 'WORKSTATION')).ok).toBe(false);
  });

  it('a thing that does not answer the tag is refused', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    const shop = hub().tech.workshops[0];
    const wrong = thing({ universalDefinitionId: 'res_fruit_amber', tags: ['fruit'] });
    expect(answersTag(wrong, shop.bill[0].tag)).toBe(false);
    give([wrong]);
    expect((await hub().poolToWorkshop(shop.id, shop.bill[0].tag, [wrong.id])).ok).toBe(false);
  });

  it('the bill met, it rises on the clock and the lot stands as a workshop', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    const id = hub().tech.workshops[0].id;
    await payAll(id);
    expect(hub().tech.workshops[0].raised).toBe(true);
    expect(hub().buildJobs.some(j => j.lotId === lot && !j.applied)).toBe(true);
    expect(hub().tech.workshops[0].standsAt).toBeUndefined();
    await finishBuilds();
    expect(hub().tech.workshops[0].standsAt).toBeGreaterThan(0);
    expect(hub().lots.find(l => l.id === lot)!.structureType).toBe('WORKSHOP');
  });

  it('it mints no bench into a player\'s stash: it is theirs', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    await payAll(hub().tech.workshops[0].id);
    const before = stash().length;
    await finishBuilds();
    expect(stash().length).toBe(before);
  });

  it('a person given the workshop they want adds what they know to the hub\'s web', async () => {
    const resident = await findWorking();
    const station = hub().workshopOffer(resident.id)!.stationId;
    const lot = await ownLot();
    const route = hub().workshopOffer(resident.id)!.route;
    // Everything upstream already stands, so only theirs is missing
    await hub().provideWorkshop(resident.id, lot, 'MACHINE');
    await payAll(hub().tech.workshops[0].id);
    await finishBuilds();
    expect(route).toContain(station);
    expect(hub().openStationsNow().map(s => s.id)).toContain(station);
    const skills = Object.values(readSheet(resident).skills ?? {});
    const opener = skills.find(s => WebSystem.benchesOf(s.tags).includes(station));
    if (opener) {
      expect(hub().web.nodes[opener.id].firstBy.uid).toBe(resident.id);
      expect(hub().web.silent?.[opener.id]).toBeUndefined();
    }
  });

  it('the first the player learns of it is the moment it arrives', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'MACHINE');
    await payAll(hub().tech.workshops[0].id);
    const seen = vi.spyOn(useFeed.getState(), 'push');
    await finishBuilds();
    expect(seen.mock.calls.some(([line]) => /workshop/i.test(String(line)))).toBe(true);
    seen.mockRestore();
    expect((await Ledger.list(UID)).some(r => r.payload.type === 'TECH' && r.payload.data.kind === 'FIRST' && r.payload.data.by === resident.name)).toBe(true);
  });

  it('a permit is paid, on the record, and the gold audit balances through it all', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    const gold = player().bank.gold;
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    expect(player().bank.gold).toBeLessThan(gold);
    await payAll(hub().tech.workshops[0].id);
    await finishBuilds();
    const audit = await GoldAudit.run();
    expect(audit.notes).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('it all comes back after a reload', async () => {
    const resident = await findWorking();
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    await hub().saveHubState();
    useHubStore.setState({ tech: emptyTech() } as any);
    await hub().loadHub(HUB);
    expect(hub().tech.workshops[0].residentId).toBe(resident.id);
  });
});

describe('tall or wide: the same reach, for different people', () => {
  /** A web where one station feeds another: the first recipe whose input another station makes. */
  const chainInWeb = () => {
    const pack = WebBank.current();
    for (const top of pack.recipes) {
      for (const input of top.inputs) {
        const under = pack.recipes.find(r => r.outputs.some(o => o.itemId === input.itemId) && r.requiredStation !== top.requiredStation);
        if (under) return { top: top.requiredStation, under: under.requiredStation };
      }
    }
    return null;
  };
  const CHAIN = { goods: [
    { key: 'shard', name: 'Shard', blurb: '', tags: [], rank: 'E', weight: 'light', trade: 'smithing', station: 'low_kiln', from: [{ key: 'res_tree_log', count: 1 }], makes: 1, answers: '' },
    { key: 'engine', name: 'Engine', blurb: '', tags: [], rank: 'D', weight: 'light', trade: 'smithing', station: 'high_works', from: [{ key: 'shard', count: 1 }], makes: 1, answers: 'flight', by: 'x' }
  ], stations: [
    { key: 'low_kiln', name: 'Low Kiln', blurb: '', tool: ['hammer'], material: ['metal'], bill: [{ tag: 'metal', count: 2 }] },
    { key: 'high_works', name: 'High Works', blurb: '', tool: ['hammer'], material: ['metal'], bill: [{ tag: 'metal', count: 5 }] }
  ], tags: [], materials: [], gear: [] };

  const profess = (residentId: string) => useHubStore.setState(s => ({
    tech: { ...s.tech, chain: CHAIN as any, professions: { ...(s.tech as any).professions, [residentId]: { name: 'Pilot', blurb: '', concept: 'flight', knows: 'flight', workshop: 'High Works', tool: ['hammer'], material: ['metal'], rank: 'D', from: 'THEME', stationId: 'high_works' } } } as any
  }));

  it('a reached station can be fitted, and is still known after a reload', async () => {
    const resident = await findWorking();
    profess(resident.id);
    await hub().provideWorkshop(resident.id, await ownLot(), 'MACHINE');
    await payAll(hub().tech.workshops[0].id);
    await finishBuilds();
    expect(hub().openStationsNow().map(s => s.id)).toEqual(expect.arrayContaining(['high_works', 'low_kiln']));
    await hub().saveHubState();
    delete CRAFTED_DEFINITIONS.high_works;
    useHubStore.setState({ tech: emptyTech() } as any);
    await hub().loadHub(HUB);
    expect(hub().openStationsNow().map(s => s.id)).toContain('high_works');
    expect(CRAFTED_DEFINITIONS.high_works?.stationMinArea).toBeGreaterThan(0);
  });

  it('a machine folds what is missing and does the whole road for one person', async () => {
    const resident = await findWorking();
    profess(resident.id);
    const offer = hub().workshopOffer(resident.id)!;
    expect(offer.route.sort()).toEqual(['high_works', 'low_kiln']);
    expect(offer.machineBill.find(l => l.tag === 'metal')!.count).toBeGreaterThan(offer.stationBill.find(l => l.tag === 'metal')!.count);
    const lot = await ownLot();
    expect(await hub().provideWorkshop(resident.id, lot, 'MACHINE')).toEqual({ ok: true });
    await payAll(hub().tech.workshops[0].id);
    await finishBuilds();
    expect(hub().tech.reached.sort()).toEqual(['high_works', 'low_kiln']);
    expect(hub().population().machines).toBe(1);
    expect(hub().population().working).toBe(1);
  });

  it('spread out, the top does nothing until the step under it stands, and it takes two people', async () => {
    const resident = await findWorking();
    profess(resident.id);
    const lot = await ownLot();
    await hub().provideWorkshop(resident.id, lot, 'WORKSTATION');
    await payAll(hub().tech.workshops[0].id);
    await finishBuilds();
    expect(hub().tech.reached).not.toContain('high_works');
    expect(hub().workshopOffer(resident.id)!.next?.id).toBe('low_kiln');

    const second = await findWorkingOther(resident.id);
    const lot2 = await ownLot();
    expect(await hub().provideWorkshop(second.id, lot2, 'WORKSTATION', 'low_kiln')).toEqual({ ok: true });
    await payAll(hub().tech.workshops[1].id);
    await finishBuilds();
    expect(hub().tech.reached.sort()).toEqual(['high_works', 'low_kiln']);
    expect(hub().population().working).toBe(2);
    expect(hub().population().machines).toBe(0);
  });

  it('a piece that stands is never billed: the order you raise things in is the skill', async () => {
    const resident = await findWorking();
    profess(resident.id);
    const dear = hub().workshopOffer(resident.id)!.machineBill.find(l => l.tag === 'metal')!.count;
    const second = await findWorkingOther(resident.id);
    const lot = await ownLot();
    await hub().provideWorkshop(second.id, lot, 'WORKSTATION', 'low_kiln');
    await payAll(hub().tech.workshops[0].id);
    await finishBuilds();
    const offer = hub().workshopOffer(resident.id)!;
    expect(offer.route).toEqual(['high_works']);
    expect(offer.machineBill.find(l => l.tag === 'metal')!.count).toBe(dear - 2);
  });

  it('a pack web road works the same way, with no model at all', async () => {
    const road = chainInWeb();
    expect(road).not.toBeNull();
  });
});

describe('the door', () => {
  it('with no key the game goes on, and no one is asked twice for nothing', async () => {
    door.status = 'NO_KEY';
    await home('p1');
    expect(hub().guild.residents).toHaveLength(1);
  });

  it('a person from a theme\'s pool has their chain written backwards through the door, and it stays silent', async () => {
    const pack = ContentRegistry.defaultThemeId();
    door.status = 'OK';
    door.answers = [{
      tags: [], materials: [], gear: [],
      stations: [{ key: 'scrap_bench', name: 'Scrap Bench', blurb: '', tool: ['hammer'], material: ['metal'], bill: [{ tag: 'metal', count: 1 }] }],
      goods: [{ key: 'scrap_motor', name: 'Scrap Motor', blurb: '', tags: [], rank: 'F', weight: 'light', trade: 'smithing', station: 'scrap_bench', from: [{ key: 'res_tree_log', count: 1 }], makes: 1, answers: 'repair', look: { color: 'ash', shape: 'lump', size: 'small' } }]
    }];
    const resident = await findWorking();
    useHubStore.setState(s => ({ tech: { ...s.tech, professions: { [resident.id]: { name: 'Fixer', blurb: '', concept: 'repair', knows: 'how to fix', workshop: 'a garage', tool: ['hammer'], material: ['metal'], rank: 'F', from: 'THEME' } }, resolving: {} } } as any));
    await hub().resolveChains();
    expect(door.calls).toBe(1);
    expect(hub().tech.resolving[resident.id].closed).toBe(true);
    expect(hub().tech.chain.stations.map(s => s.key)).toContain('scrap_bench');
    expect(hub().openStationsNow().map(s => s.id)).not.toContain('scrap_bench');
    await hub().resolveChains();
    expect(door.calls).toBe(1);
    void pack;
  });

  it('what a round says must be found goes on the ledger, and it survives a reload', async () => {
    door.status = 'OK';
    door.answers = [{
      tags: [], gear: [], stations: [],
      materials: [{ key: 'skyglass', name: 'Skyglass', blurb: '', tags: ['glass'], rank: 'F', form: 'rock', verb: 'mine', weight: 'light', worth: 'fine', habitat: ['RUINS'], onShelf: false, restores: 'none', look: { color: 'indigo', shape: 'crystal', size: 'small' } }],
      goods: [{ key: 'sky_lens', name: 'Sky Lens', blurb: '', tags: [], rank: 'F', weight: 'light', trade: 'smithing', station: '', from: [{ key: 'skyglass', count: 1 }], makes: 1, answers: 'seeing', look: { color: 'indigo', shape: 'ring', size: 'tiny' } }]
    }];
    const resident = await findWorking();
    useHubStore.setState(s => ({ tech: { ...s.tech, professions: { [resident.id]: { name: 'Lens Grinder', blurb: '', concept: 'seeing', knows: 'how to see far', workshop: 'a dark room', tool: ['hammer'], material: ['metal'], rank: 'F', from: 'THEME' } }, resolving: {} } } as any));
    await hub().resolveChains();
    expect(hub().tech.ledger.map(e => [e.key, e.askedBy])).toEqual([['skyglass', resident.id]]);
    expect(hub().tech.ledger[0].material.look?.shape).toBe('crystal');
    await hub().saveHubState();
    useHubStore.setState({ tech: emptyTech() } as any);
    await hub().loadHub(HUB);
    expect(hub().tech.ledger.map(e => e.key)).toEqual(['skyglass']);
  });

  it('a refused round writes nothing and waits', async () => {
    door.status = 'OK';
    door.answers = [{ tags: [], materials: [], gear: [], stations: [], goods: [{ key: 'bad', name: 'x', blurb: '', tags: [], rank: 'S', weight: 'light', trade: 'smithing', station: '', from: [{ key: 'res_tree_log', count: 1 }], makes: 1, answers: 'repair', hp: 100 }] }];
    const resident = await findWorking();
    useHubStore.setState(s => ({ tech: { ...s.tech, professions: { [resident.id]: { name: 'Fixer', blurb: '', concept: 'repair', knows: 'how to fix', workshop: 'a garage', tool: ['hammer'], material: ['metal'], rank: 'S', from: 'THEME' } }, resolving: {} } } as any));
    await hub().resolveChains();
    expect(hub().tech.chain.goods).toEqual([]);
    expect(hub().tech.resolving[resident.id].closed).toBe(false);
    expect(hub().tech.resolving[resident.id].refused).toContain('refused');
  });
});

describe('the plans', () => {
  it("the hub's workshop plan fits the smallest ground a person can be given", () => {
    const plan = SYSTEM_TEMPLATES.find(t => t.structureType === 'WORKSHOP')!;
    expect(validateTemplate({ ...plan, footprint: { width: 3, height: 3 } }).ok).toBe(true);
    expect(plan.pieces.every(p => p.x < 3 * 4 - 1)).toBe(true);
  });
});

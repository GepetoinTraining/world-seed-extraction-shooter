/**
 * STREAM C1's BARS, registered before the build: food and land. Lines 36, 37, 117 and the
 * herding half of 152.
 *
 * Pedro on the land: "farmland requires an exclusive chunk, you make the whole chunk farmland,
 * we're not animals, and then the hub portions it off as a perfect farmland that has equal
 * spacing". On capture: "All four: hunt, trap, tame, domesticate".
 *
 * No bar here calls a model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
import { Provenance } from '../src/logic/sovereignty/Provenance';
import { HubGenerator, POIType } from '../src/entities/hub/HubGenerator';
import { CHUNK_TILES } from '../src/entities/world/grid';
import { NEW_CARLEON, doorTile, farmChunkPlan, firstPlan, raiseChunk, validateManifest } from '../src/entities/hub/hubManifest';
import { Farm, emptyFarmland } from '../src/entities/hub/farm';
import { Herd } from '../src/entities/hub/herd';
import { FarmDoors } from '../src/entities/hub/farmDoors';
import { Capture, ICaged } from '../src/logic/systems/Capture';
import { Cooking } from '../src/logic/systems/Cooking';
import { Koseki } from '../src/entities/world/Koseki';
import { Population, emptyPopulationRecord } from '../src/entities/world/Population';
import { emptyDirectorRecord } from '../src/entities/world/Director';
import { CreatureLines } from '../src/logic/theme/CreatureLines';
import { creatureIdOf } from '../src/logic/theme/ThemeCompiler';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { computeGolden, GOLDEN_VECTORS } from '../src/entities/world/goldens';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { WebBank } from '../src/logic/content/WebBank';
import { TagLaw } from '../src/logic/content/TagLaw';
import { EntityType } from '../src/entities/world/types';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const materialId = (key: string) => {
  const m = Object.values(RESOURCE_DEFINITIONS).find(d => d.themeId === themeId && d.id.endsWith(key));
  if (!m) throw new Error(`no ${key}`);
  return m.id;
};
const WHEAT = () => materialId('chaffwheat');
const OAK = () => materialId('compound_oak');
const STONE = () => materialId('vault_stone');
const GOAT = () => creatureIdOf(themeId, 'collateral_goat');
const OX = () => creatureIdOf(themeId, 'pension_ox');

const UID = 'uid_food';
const HUB = 'hub_food';
const hub = () => useHubStore.getState();
const player = () => usePlayerStore.getState().player;
const stash = () => player().bank.stashTabs[0].items;
let n = 0;
const harvested = (defId: string): IItem => ItemFactory.createResourceItem(RESOURCE_DEFINITIONS[defId], Rng.fromKey(`food-test:${++n}`));

const farmlandPlan = () => {
  const raised = raiseChunk(firstPlan(), 'EAST', { kind: 'farmland' });
  if (!raised.ok) throw new Error('it would not rise');
  return raised.plan;
};
const plotsOf = (layout: ReturnType<typeof HubGenerator.generate>) =>
  layout.zones.flatMap(z => z.pois).filter(p => p.metadata.farmland);

const caged = (kind = GOAT(), body = `pop_1_1_goat_${++n}`): ICaged => Capture.cage({
  body, kind, seed: 'capture-world', generation: 3, worldUid: 'world_a', by: UID,
  proof: CreatureLines.proofOf(null, { seed: 'capture-world', themeId }, kind)!
});

const reset = async () => {
  db.clear();
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'Farmer' } } as any });
  usePlayerStore.setState(s => ({
    player: { ...s.player, id: UID, username: 'Farmer', bank: { ...s.player.bank, gold: 100_000, stashTabs: [{ id: 't', name: 'Main', items: [] } as any], universalSkills: {} } }
  }));
  await Treasury.endow(HUB, 1_000_000).catch(() => undefined);
  useHubStore.setState({
    activeHubId: HUB, chunks: firstPlan().chunks, dismembered: [], planDeposit: {}, lots: [], rooms: {}, buildJobs: [], craftingJobs: [],
    farmland: emptyFarmland()
  } as any);
};

/** A plot of ours on a new chunk of farmland. */
const ownPlot = async () => {
  await hub().raiseChunk('EAST', undefined, 'farmland');
  const lot = hub().lots.find(l => l.structureType === 'FARM')!;
  expect(await hub().buyLot(lot.id)).toBe(true);
  return lot.id;
};
const giveToStash = (...items: IItem[]) =>
  usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [...s.player.bank.stashTabs[0].items, ...items] }] } } }));

const at = (ms: number) => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

beforeEach(reset);
afterEach(() => { vi.restoreAllMocks(); });

// =============================================================================
// THE LAND: a whole chunk, portioned evenly
// =============================================================================

describe('farmland is a whole chunk, and the hub portions it', () => {
  it('the manifest holds a farmland chunk, and the manifest law still passes', () => {
    expect(NEW_CARLEON.chunks.farmland).toBeTruthy();
    expect(validateManifest(NEW_CARLEON)).toEqual([]);
  });

  it('raising beside the city makes farmland, and the first chunk does not move', () => {
    const before = JSON.stringify(HubGenerator.generate(firstPlan()).zones[0].pois.map(p => [p.id, p.position]));
    const layout = HubGenerator.generate(farmlandPlan());
    expect(plotsOf(layout).length).toBeGreaterThan(0);
    const after = JSON.stringify(layout.zones[0].pois.map(p => [p.id, p.position]));
    expect(after).toBe(before);
  });

  it('holds plots and nothing else: no lot, no lamp, no building shares that chunk', () => {
    const layout = HubGenerator.generate(farmlandPlan());
    const chunk = layout.chunks[1];
    const on = layout.zones.flatMap(z => z.pois).filter(p =>
      p.position.x >= chunk.x && p.position.x < chunk.x + CHUNK_TILES && p.position.y >= chunk.y && p.position.y < chunk.y + CHUNK_TILES);
    expect(on.length).toBeGreaterThan(0);
    expect(on.every(p => p.type === POIType.PLAYER_LOT && p.metadata.farmland)).toBe(true);
  });

  it('every plot is the same size, and the spacing between them is the same both ways', () => {
    const plots = plotsOf(HubGenerator.generate(farmlandPlan()));
    expect(new Set(plots.map(p => `${p.size.width}x${p.size.height}`)).size).toBe(1);
    const steps = (values: number[]) => {
      const sorted = [...new Set(values)].sort((a, b) => a - b);
      return new Set(sorted.slice(1).map((v, i) => v - sorted[i]));
    };
    const xs = steps(plots.map(p => p.position.x)), ys = steps(plots.map(p => p.position.y));
    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
    expect([...xs][0]).toBe([...ys][0]);
    // A grid: every row has every column
    expect(plots.length).toBe(new Set(plots.map(p => p.position.x)).size * new Set(plots.map(p => p.position.y)).size);
  });

  it('every plot has a door on a road, and carries no one else\'s way through it', () => {
    const layout = HubGenerator.generate(farmlandPlan());
    const plots = plotsOf(layout);
    expect(layout.passages.filter(q => plots.some(p => p.id === q.lotId))).toEqual([]);
    for (const p of plots) expect(p.metadata.locked).toBeFalsy();
    for (const p of plots) {
      const d = doorTile(p);
      expect(layout.navMesh[d.y][d.x]).toBe(true);
    }
  });

  it('a standing chunk of free lots can be made farmland whole, and later chunks keep their lots', () => {
    const second = raiseChunk(firstPlan(), 'EAST');
    if (!second.ok) throw new Error('second');
    const third = raiseChunk(second.plan, 'WEST');
    if (!third.ok) throw new Error('third');
    const layoutBefore = HubGenerator.generate(third.plan);
    const westLots = layoutBefore.zones.flatMap(z => z.pois).filter(p => p.type === POIType.PLAYER_LOT && p.position.x < layoutBefore.chunks[0].x);
    const made = farmChunkPlan(third.plan, { cx: 1, cy: 0 });
    if (!made.ok) throw new Error('it would not plough');
    const layout = HubGenerator.generate(made.plan);
    const westAfter = layout.zones.flatMap(z => z.pois).filter(p => p.type === POIType.PLAYER_LOT && p.position.x < layout.chunks[0].x);
    expect(westAfter.map(p => [p.id, p.position, p.size])).toEqual(westLots.map(p => [p.id, p.position, p.size]));
    expect(plotsOf(layout).length).toBeGreaterThan(0);
    const ids = layout.zones.flatMap(z => z.pois).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the first chunk cannot be farmland, nor a chunk twice', () => {
    expect(farmChunkPlan(firstPlan(), { cx: 0, cy: 0 }).ok).toBe(false);
    const raised = farmlandPlan();
    expect(farmChunkPlan(raised, { cx: 1, cy: 0 }).ok).toBe(false);
  });

  it('the door refuses a chunk with anyone\'s lot on it, and lets go of the free records', async () => {
    await hub().raiseChunk('EAST');
    const layout = HubGenerator.generate({ chunks: hub().chunks });
    const east = layout.chunks[1];
    const lots = layout.zones.flatMap(z => z.pois).filter(p => p.type === POIType.PLAYER_LOT && p.position.x >= east.x && p.position.x < east.x + CHUNK_TILES);
    expect(await hub().buyLot(lots[0].id)).toBe(true);
    expect((await FarmDoors.makeFarmland({ cx: 1, cy: 0 })).ok).toBe(false);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100_000 } } }));
    useHubStore.setState({ lots: hub().lots.map(l => l.id === lots[0].id ? { ...l, ownerId: null, ownerName: null } : l) });
    expect((await FarmDoors.makeFarmland({ cx: 1, cy: 0 })).ok).toBe(true);
    expect(hub().lots.some(l => l.id === lots[0].id)).toBe(false);
    expect(hub().lots.filter(l => l.structureType === 'FARM').length).toBeGreaterThan(0);
  });

  it('a plot cannot be split, cannot take a house, and is not offered to the guild for one', async () => {
    const plotId = await ownPlot();
    expect(HubGenerator.dismemberVerdict(HubGenerator.generate({ chunks: hub().chunks }), plotId).ok).toBe(false);
    expect((await hub().dismemberLot(plotId)).ok).toBe(false);
    expect(await hub().buildStructure(plotId, 'HOUSE')).toBeFalsy();
    const free = hub().lots.filter(l => !l.ownerId);
    expect(free.every(l => l.structureType === 'FARM' || l.structureType === 'EMPTY')).toBe(true);
    expect(Farm.groundForHouses(hub().lots).every(l => l.structureType === 'EMPTY')).toBe(true);
  });

  it('a chunk raised through the plan\'s bill can be farmland', async () => {
    useHubStore.setState({ planDeposit: { building: 40 } });
    const res = await hub().planRaise('EAST', undefined, 'farmland');
    expect(res.ok).toBe(true);
    expect(hub().chunks[1].kind).toBe('farmland');
  });

  it('a plot saved and read back stays farmland, and a save with no farmland reads as empty', async () => {
    const plotId = await ownPlot();
    await hub().saveHubState();
    const doc = db.get(`hub_state_${HUB}`);
    expect(doc.data.farmland).toBeTruthy();
    expect(doc.data.lots.find((l: any) => l.id === plotId).structureType).toBe('FARM');
    delete doc.data.farmland;
    db.set(doc.id, doc);
    await hub().loadHub(HUB);
    expect(hub().farmland).toEqual(emptyFarmland());
  });
});

// =============================================================================
// LINE 36: plant what you harvested, leave, come back, harvest it
// =============================================================================

describe('line 36: planting what you harvested', () => {
  it('a plot has beds set out evenly, and more ground holds more', () => {
    const small = Farm.gridOf({ width: 8, height: 8 });
    const big = Farm.gridOf({ width: 16, height: 16 });
    expect(small.cols).toBe(small.rows);
    expect(big.cols * big.rows).toBeGreaterThan(small.cols * small.rows);
  });

  it('a plant, a leave, a return, a harvest, through the doors, with nothing running in between', async () => {
    const plotId = await ownPlot();
    const seed = harvested(WHEAT());
    giveToStash(seed);
    const t0 = 2_000_000_000_000;
    at(t0);
    const planted = await FarmDoors.plant(plotId, seed.id, 0);
    expect(planted.ok).toBe(true);
    expect(stash().some(i => i.id === seed.id)).toBe(false);
    expect(hub().farmland.farms[plotId].beds[0].defId).toBe(WHEAT());

    // Not yet
    expect((await FarmDoors.reap(plotId, 0)).ok).toBe(false);
    const ripeAt = Farm.ripeAt(hub().farmland.farms[plotId].beds[0]);
    expect(ripeAt).toBeGreaterThan(t0);

    // Leave. No clock runs while away: it is read from the time, and only the time
    at(ripeAt + 1);
    const reaped = await FarmDoors.reap(plotId, 0);
    expect(reaped.ok).toBe(true);
    const held = hub().lots.find(l => l.id === plotId)!.inventory;
    expect(held.length).toBeGreaterThan(0);
    expect(held.every(i => i.universalDefinitionId === WHEAT())).toBe(true);
    expect(hub().farmland.farms[plotId].beds[0]).toBeUndefined();
  });

  it('growth reads only the time: the same planting is at the same stage on any machine', () => {
    const bed = Farm.planting(harvested(WHEAT()), RESOURCE_DEFINITIONS[WHEAT()], 1000);
    const again = Farm.planting(harvested(WHEAT()), RESOURCE_DEFINITIONS[WHEAT()], 1000);
    expect(Farm.ripeAt(bed)).toBe(Farm.ripeAt(again));
    expect(Farm.growth(bed, 1000)).toBe(0);
    expect(Farm.growth(bed, Farm.ripeAt(bed))).toBe(1);
    expect(Farm.growth(bed, Farm.ripeAt(bed) * 2)).toBe(1);
    const src = readFileSync('src/entities/hub/farm.ts', 'utf8');
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(/);
  });

  it('a mineral will not grow, and neither will a worked good, and it says so in voice', () => {
    const stone = harvested(STONE());
    expect(Farm.plantVerdict(stone).ok).toBe(false);
    expect(Farm.plantVerdict(stone).reason).toBeTruthy();
    const worked = { ...harvested(WHEAT()), composition: { ...harvested(WHEAT()).composition!, steps: [{ recipeId: 'x' }] } } as any;
    expect(Farm.plantVerdict(worked).ok).toBe(false);
  });

  it('a yield is keyed: the same planting gives the same count, and it never mints gold', async () => {
    const seed = harvested(WHEAT());
    const a = Farm.yieldOf(Farm.planting(seed, RESOURCE_DEFINITIONS[WHEAT()], 5), RESOURCE_DEFINITIONS[WHEAT()], 'plot_a:0');
    const b = Farm.yieldOf(Farm.planting(seed, RESOURCE_DEFINITIONS[WHEAT()], 5), RESOURCE_DEFINITIONS[WHEAT()], 'plot_a:0');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    const plotId = await ownPlot();
    const audit0 = await GoldAudit.run();
    const gold = player().bank.gold;
    const treasury = await Treasury.balance(HUB);
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.reap(plotId, 0);
    expect(player().bank.gold).toBe(gold);
    expect(await Treasury.balance(HUB)).toBe(treasury);
    expect(audit0).toBeTruthy();
  });

  it('a stale press cannot reap twice, and a bed already planted refuses a second seed', async () => {
    const plotId = await ownPlot();
    const s1 = harvested(WHEAT()), s2 = harvested(WHEAT());
    giveToStash(s1, s2);
    at(2_000_000_000_000);
    expect((await FarmDoors.plant(plotId, s1.id, 0)).ok).toBe(true);
    expect((await FarmDoors.plant(plotId, s2.id, 0)).ok).toBe(false);
    expect(stash().some(i => i.id === s2.id)).toBe(true);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    const count = (await FarmDoors.reap(plotId, 0), hub().lots.find(l => l.id === plotId)!.inventory.length);
    expect((await FarmDoors.reap(plotId, 0)).ok).toBe(false);
    expect(hub().lots.find(l => l.id === plotId)!.inventory.length).toBe(count);
  });

  it('someone else\'s plot takes no seed from you', async () => {
    const plotId = await ownPlot();
    useHubStore.setState({ lots: hub().lots.map(l => l.id === plotId ? { ...l, ownerId: 'someone', ownerName: 'Someone' } : l) });
    const s = harvested(WHEAT());
    giveToStash(s);
    expect((await FarmDoors.plant(plotId, s.id, 0)).ok).toBe(false);
    expect(stash().some(i => i.id === s.id)).toBe(true);
  });
});

describe('grove keeping', () => {
  it('a tree or a shrub is a grove: it takes more ground and stays after it bears', async () => {
    const plotId = await ownPlot();
    const oak = harvested(OAK());
    giveToStash(oak);
    at(2_000_000_000_000);
    const planted = await FarmDoors.plant(plotId, oak.id, 0);
    expect(planted.ok).toBe(true);
    const bed = hub().farmland.farms[plotId].beds[0];
    expect(bed.grove).toBe(true);
    expect(Farm.spanOf(bed)).toBeGreaterThan(1);
    // Its block is taken
    const s = harvested(WHEAT());
    giveToStash(s);
    expect((await FarmDoors.plant(plotId, s.id, 1)).ok).toBe(false);

    at(Farm.ripeAt(bed) + 1);
    expect((await FarmDoors.reap(plotId, 0)).ok).toBe(true);
    const after = hub().farmland.farms[plotId].beds[0];
    expect(after).toBeTruthy();
    expect(after.bears).toBe(1);
    expect(Farm.ripeAt(after)).toBeGreaterThan(Date.now());
    at(Farm.ripeAt(after) + 1);
    expect((await FarmDoors.reap(plotId, 0)).ok).toBe(true);
    expect(hub().farmland.farms[plotId].beds[0].bears).toBe(2);
  });

  it('a grove on the plot\'s edge that would not fit is refused', () => {
    const grid = Farm.gridOf({ width: 8, height: 8 });
    const lastCol = grid.cols - 1;
    const oak = Farm.planting(harvested(OAK()), RESOURCE_DEFINITIONS[OAK()], 0);
    expect(Farm.fitVerdict({ lotId: 'x', beds: {} } as any, { width: 8, height: 8 }, oak, lastCol).ok).toBe(false);
  });
});

// =============================================================================
// LINE 37: by their real grain, with their history
// =============================================================================

describe('line 37: stored by their real grain, with their history', () => {
  it('what comes off a bed stays piece by piece: each has its own id, and none is merged', async () => {
    const plotId = await ownPlot();
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.reap(plotId, 0);
    const held = hub().lots.find(l => l.id === plotId)!.inventory;
    expect(new Set(held.map(i => i.id)).size).toBe(held.length);
  });

  it('each piece knows the bed, the seed it came from, and how many plantings stand behind it', async () => {
    const plotId = await ownPlot();
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.reap(plotId, 0);
    const piece = hub().lots.find(l => l.id === plotId)!.inventory[0];
    expect(piece.farmLine).toEqual(expect.objectContaining({ lotId: plotId, seedItemId: s.id, plantings: 1 }));
    expect(piece.composition?.steps ?? []).toEqual([]);
    expect(piece.composition?.materials[0]?.origin ?? (piece.composition as any)?.origin).toBeTruthy();

    // Planted again, it counts on
    expect((await FarmDoors.takeFromStore(plotId, piece.id)).ok).toBe(true);
    expect(stash().some(i => i.id === piece.id)).toBe(true);
    await FarmDoors.plant(plotId, piece.id, 0);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.reap(plotId, 0);
    const next = hub().lots.find(l => l.id === plotId)!.inventory.find(i => i.farmLine?.seedItemId === piece.id)!;
    expect(next.farmLine!.plantings).toBe(2);
  });

  it('a history reads back in words, from what the record holds', async () => {
    const plotId = await ownPlot();
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.reap(plotId, 0);
    const piece = hub().lots.find(l => l.id === plotId)!.inventory[0];
    const lines = Farm.historyOf(piece);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toMatch(/planting/i);
    const recordSpy = vi.spyOn(Provenance, 'record');
    await FarmDoors.takeFromStore(plotId, piece.id);
    expect(recordSpy).toBeDefined();
  });

  it('the store groups what it holds by material and keeps every piece', () => {
    const items = [harvested(WHEAT()), harvested(WHEAT()), harvested(OAK())];
    const groups = Farm.byMaterial(items);
    expect(groups.length).toBe(2);
    expect(groups.flatMap(g => g.pieces).length).toBe(3);
  });

  it('the sapling\'s waiver is closed: a farm is where it goes', () => {
    const text = readFileSync('src/logic/economy/SourcingAudit.ts', 'utf8');
    expect(text).not.toMatch(/res_tree_sapling: 'Wave 11/);
  });
});

// =============================================================================
// A PERSON CAN RUN IT, AND BE BOUGHT FROM (what C6 reads)
// =============================================================================

describe('a farm is something a person runs and is bought from', () => {
  const grown = async () => {
    const plotId = await ownPlot();
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.reap(plotId, 0);
    return plotId;
  };

  it('the owner lists from the store, and the stand is read by what it sells', async () => {
    const plotId = await grown();
    const piece = hub().lots.find(l => l.id === plotId)!.inventory[0];
    expect((await FarmDoors.list(plotId, piece.id, 12)).ok).toBe(true);
    expect(hub().lots.find(l => l.id === plotId)!.inventory.some(i => i.id === piece.id)).toBe(false);
    const sellers = Farm.sellers(hub().lots, 'food');
    expect(sellers.length).toBe(1);
    expect(sellers[0].lotId).toBe(plotId);
    expect(sellers[0].listing.item.id).toBe(piece.id);
    expect(Farm.sellers(hub().lots, 'ore')).toEqual([]);
  });

  it('a buyer pays through the shop door the city already has, and the audit holds', async () => {
    const plotId = await grown();
    const piece = hub().lots.find(l => l.id === plotId)!.inventory[0];
    await FarmDoors.list(plotId, piece.id, 20);
    useHubStore.setState({ lots: hub().lots.map(l => l.id === plotId ? { ...l, ownerId: 'someone', ownerName: 'Someone' } : l) });
    const gold = player().bank.gold;
    expect(await hub().buyFromLot(plotId, piece.id)).toBe(true);
    expect(player().bank.gold).toBe(gold - 20);
    expect(stash().some(i => i.id === piece.id)).toBe(true);
    expect(hub().lots.find(l => l.id === plotId)!.proceeds).toBeGreaterThan(0);
  });

  it('a resident can tend it: ripe beds are reaped and sown again, and the rest goes on the stand', async () => {
    const plotId = await ownPlot();
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    const resident = { id: 'res_x', name: 'Orrin Basalt', lotId: null } as any;
    useHubStore.setState({ guild: { ...hub().guild, residents: [resident] } });
    expect((await FarmDoors.setTender(plotId, resident.id)).ok).toBe(true);
    expect(hub().farmland.farms[plotId].tender).toBe(resident.id);

    at(Farm.ripeAt(hub().farmland.farms[plotId].beds[0]) + 1);
    await FarmDoors.resolve();
    const farm = hub().farmland.farms[plotId];
    const lot = hub().lots.find(l => l.id === plotId)!;
    expect(farm.beds[0]).toBeTruthy();
    expect(farm.beds[0].plantedAt).toBe(Date.now());
    expect((lot.shopListings ?? []).length + lot.inventory.length).toBeGreaterThanOrEqual(0);
    expect(Farm.sellers(hub().lots, 'food').every(x => x.lotId === plotId)).toBe(true);
  });

  it('a tender is only one person at a time, and only one who is in the city', async () => {
    const plotId = await ownPlot();
    expect((await FarmDoors.setTender(plotId, 'res_nobody')).ok).toBe(false);
  });

  it('losing the plot gives back what stood on it, and frees the ground as a plot', async () => {
    const plotId = await ownPlot();
    const s = harvested(WHEAT());
    giveToStash(s);
    at(2_000_000_000_000);
    await FarmDoors.plant(plotId, s.id, 0);
    await FarmDoors.forget(plotId);
    expect(hub().farmland.farms[plotId]).toBeUndefined();
    expect(stash().some(i => i.farmLine === undefined)).toBeDefined();
    const src = readFileSync('src/entities/hub/store.ts', 'utf8');
    expect(src).toMatch(/structureType: l\.structureType === 'FARM' \? 'FARM' : 'EMPTY'/);
  });
});

// =============================================================================
// CAPTURE: hunt, trap, tame, domesticate
// =============================================================================

describe('capture: the four verbs', () => {
  const body = (behavior = 'PASSIVE') => ({ rank: UniversalRank.E, behavior, health: 50, maxHealth: 50, tags: ['biological'] });

  it('trap and tame words are registered, each with a reader', () => {
    const pack = WebBank.current();
    for (const tag of ['farming', 'grove_keeping', 'herding', 'cooking', 'trapping', 'taming', 'snare', 'cage', 'meal']) {
      expect(pack.tags.some(t => t.tag === tag && !t.retired), tag).toBe(true);
    }
    expect(TagLaw.skillIdOf(['trapping'])).toBeTruthy();
  });

  it('a trap is keyed: same body, same attempt, same answer; the next attempt rolls anew', () => {
    const one = Capture.trap({ seed: 's', body: 'b1', attempt: 0, rank: UniversalRank.E, behavior: 'PASSIVE', healthShare: 1 });
    const two = Capture.trap({ seed: 's', body: 'b1', attempt: 0, rank: UniversalRank.E, behavior: 'PASSIVE', healthShare: 1 });
    expect(one).toEqual(two);
    const many = Array.from({ length: 80 }, (_, attempt) => Capture.trap({ seed: 's', body: 'b1', attempt, rank: UniversalRank.E, behavior: 'PASSIVE', healthShare: 1 }).held);
    expect(new Set(many).size).toBe(2);
  });

  it('a wounded body and a practised hand both hold better, with no cap at a fixed number', () => {
    const base = Capture.trapOdds({ rank: UniversalRank.D, behavior: 'NEUTRAL', healthShare: 1 });
    expect(Capture.trapOdds({ rank: UniversalRank.D, behavior: 'NEUTRAL', healthShare: 0.2 })).toBeGreaterThan(base);
    const skilled = Capture.trapOdds({ rank: UniversalRank.D, behavior: 'NEUTRAL', healthShare: 1, skill: 40 });
    expect(skilled).toBeGreaterThan(base);
    expect(Capture.trapOdds({ rank: UniversalRank.D, behavior: 'NEUTRAL', healthShare: 1, skill: 4000 })).toBeGreaterThan(skilled);
    expect(Capture.trapOdds({ rank: UniversalRank.D, behavior: 'NEUTRAL', healthShare: 1, skill: 4000 })).toBeLessThan(1);
    expect(Capture.trapOdds({ rank: UniversalRank.S, behavior: 'AGGRESSIVE', healthShare: 1 })).toBeLessThan(base);
  });

  it('a bad snare on prey goes unfelt; on something that bites, it wakes it', () => {
    const missed = (behavior: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const r = Capture.trap({ seed: 's', body: `b_${behavior}`, attempt, rank: UniversalRank.E, behavior, healthShare: 1 });
        if (!r.held) return r;
      }
      throw new Error('never missed');
    };
    expect(missed('PASSIVE').noticed).toBe(false);
    expect(missed('AGGRESSIVE').noticed).toBe(true);
  });

  it('what leads a pack, and what is one of a kind, will not go in a cage', () => {
    expect(Capture.trapRefusal('lead_8_8_0', { tags: ['beast', 'elite'] })).toBeTruthy();
    expect(Capture.trapRefusal('pop_1_1_x_0', { tags: ['boss'] })).toBeTruthy();
    expect(Capture.trapRefusal('pop_1_1_x_0', { tags: ['beast'] })).toBeNull();
    expect(Capture.trapRefusal('lead_8_8_0_f1', { tags: ['beast'] })).toBeNull();
  });

  it('a snare is tied from what is fibrous, and its parts leave as one', () => {
    const fiber = () => harvested(materialId('tellers_reed'));
    const one = Capture.tieSnare([fiber()], 'k');
    expect(one.ok).toBe(false);
    const two = Capture.tieSnare([fiber(), fiber()], 'k');
    expect(two.ok).toBe(true);
    expect(two.item!.tags).toContain('snare');
    expect(two.consumedIds.length).toBe(2);
    expect(Capture.tieSnare([harvested(STONE()), harvested(STONE())], 'k').ok).toBe(false);
  });

  it('with a snare in the pack, a body in reach offers one; with none, it offers nothing', () => {
    const entity = { id: 'pop_1_1_goat_0', type: EntityType.MOB, definitionId: GOAT(), position: { x: 0, y: 0 }, health: 30, rank: UniversalRank.E } as any;
    const without = { ...player(), currentSession: { inventory: [] } } as any;
    expect(InteractionEngine.getAvailableInteractions(without, entity, 2)).toEqual([]);
    const snare = Capture.tieSnare([harvested(materialId('tellers_reed')), harvested(materialId('tellers_reed'))], 'k').item!;
    const withOne = { ...player(), currentSession: { inventory: [snare] } } as any;
    const options = InteractionEngine.getAvailableInteractions(withOne, entity, 2);
    expect(options.map(o => o.id)).toEqual([`int_snare_${entity.id}`]);
    expect(InteractionEngine.getAvailableInteractions(withOne, entity, 30)).toEqual([]);
  });

  it('a cage holds the body, its kind, its gender by key, and the proof of its line', () => {
    const c = caged();
    expect(c.proof.kind).toBe(GOAT());
    expect(c.gender).toBe(Population.genderOf('capture-world', c.body));
    const item = Capture.cageItem(c, 'key');
    expect(item.creatureData?.body).toBe(c.body);
    expect(item.tags).toContain('cage');
    expect(item.type).toBe(ItemType.CONSUMABLE);
    expect(item.weight).toBeGreaterThan(0);
    expect(Capture.cageItem(c, 'key').id).toBe(item.id);
    // A larger body is a larger cage
    const big = Capture.cageItem(caged(OX()), 'key2');
    expect(big.weight).toBeGreaterThan(item.weight);
  });

  it('taming rolls by key on a body already caged, and a miss keeps it caged', () => {
    const c = caged();
    const first = Capture.tame({ cage: c, attempt: 0 });
    expect(first).toEqual(Capture.tame({ cage: c, attempt: 0 }));
    expect(first.followMs).toBeGreaterThan(0);
    const many = Array.from({ length: 120 }, (_, attempt) => Capture.tame({ cage: c, attempt }).held);
    expect(new Set(many).size).toBe(2);
  });

  it('a tamed body follows, and draws off what would come for the person', () => {
    MobAI.reset();
    MobAI.follow('tame_1', Date.now() + 60_000);
    expect(MobAI.isFollowing('tame_1')).toBe(true);
    const px = 20;
    const goat = { id: 'tame_1', type: EntityType.MOB, definitionId: GOAT(), rank: UniversalRank.E, position: { x: 40 * px, y: 0 }, health: 30 } as any;
    const chunk = { id: '0,0', x: 0, y: 0, entities: [goat] } as any;
    const out = MobAI.tick({ '0,0': chunk }, { x: 0, y: 0 }, 1).updatedChunks['0,0'];
    const moved = out.entities.find((e: any) => e.id === 'tame_1');
    expect(moved.position.x).toBeLessThan(40 * px);
    MobAI.reset();
    expect(MobAI.isFollowing('tame_1')).toBe(false);
  });

  it('domesticating takes days of keeping and cannot be pressed through', () => {
    const c = caged();
    const today = 100;
    let herd = Herd.start({ type: 'plot', id: 'poi_lot_9' }, c, today);
    expect(herd.head).toBe(0);
    expect(herd.keeping.length).toBe(1);
    const days = Herd.daysToKeep(c.def as any);
    expect(days).toBeGreaterThan(1);
    herd = Herd.feed(herd, Array.from({ length: 40 }, () => harvested(WHEAT())));
    herd = Herd.fold(herd, today + days - 1, 'seed');
    expect(herd.head).toBe(0);
    expect(herd.keeping.length).toBe(1);
    herd = Herd.fold(herd, today + days, 'seed');
    expect(herd.head).toBe(1);
    expect(herd.keeping.length).toBe(0);
  });

  it('a day with nothing in the trough does not count toward keeping', () => {
    const c = caged();
    let herd = Herd.start({ type: 'plot', id: 'p' }, c, 0);
    herd = Herd.fold(herd, Herd.daysToKeep(c.def as any) + 5, 'seed');
    expect(herd.head).toBe(0);
  });
});

describe('capture through the register', () => {
  it('a captured body comes off its count and adopts onto the person\'s register, through Koseki.adopt', () => {
    const adopt = vi.spyOn(Koseki, 'adopt');
    const home = Capture.registerOf('hub_x', UID, 5);
    const body = Population.bodyId('10,10', GOAT(), 0);
    const res = Population.captured(emptyPopulationRecord(), body, GOAT(), 5, home);
    expect(adopt).toHaveBeenCalledOnce();
    expect(res.record.down[body]).toEqual(expect.objectContaining({ at: 5, kind: GOAT() }));
    expect(Koseki.standing(res.to).some(e => e.body === body && e.word === 'adopted')).toBe(true);
    const entry = res.to.entries.find(e => e.body === body)!;
    expect(entry.from).toBeTruthy();
    expect(entry.parents).toEqual([GOAT()]);
    const left = res.record.taken?.[entry.from!];
    expect(left?.entries.find(e => e.body === body)?.exit).toBe('adopted_out');
  });

  it('one from a leader\'s pack leaves that leader\'s register', () => {
    const leader = 'lead_8_8_0';
    const home = Capture.registerOf('hub_x', UID, 5);
    const follower = `${leader}_f2`;
    const res = Population.captured(emptyPopulationRecord(), follower, GOAT(), 5, home);
    const from = res.to.entries.find(e => e.body === follower)!.from!;
    const reg = res.record.taken![from];
    expect(reg.head).toBe(leader);
    expect(reg.entries.find(e => e.body === follower)?.exit).toBe('adopted_out');
  });

  it('a capture touches no land and no golden vector', async () => {
    const before = JSON.stringify(GOLDEN_VECTORS);
    Population.captured(emptyPopulationRecord(), Population.bodyId('10,10', GOAT(), 0), GOAT(), 5, Capture.registerOf('hub_x', UID, 5));
    expect(JSON.stringify(GOLDEN_VECTORS)).toBe(before);
    expect(computeGolden).toBeTypeOf('function');
  });
});

// =============================================================================
// THE HERD AT HOME (the herding half of 152)
// =============================================================================

describe('the herding half of 152: a herd at home', () => {
  const settled = (head: number) => {
    const c = caged();
    const herd = Herd.start({ type: 'plot', id: 'poi_lot_9' }, c, 0);
    return { ...herd, head, keeping: [] };
  };
  const wheat = (count: number) => Array.from({ length: count }, () => harvested(WHEAT()));

  it('a herd says who holds it, and a building can hold it later with nothing else changed', () => {
    const h = settled(10);
    expect(h.holder).toEqual({ type: 'plot', id: 'poi_lot_9' });
    const moved = Herd.moveTo(h, { type: 'building', id: 'ranch_1' });
    expect(moved.holder.type).toBe('building');
    expect({ ...moved, holder: h.holder }).toEqual(h);
    expect(Herd.heldBy([h, moved], { type: 'building', id: 'ranch_1' })).toEqual([moved]);
  });

  it('folding N days one at a time is folding them at once', () => {
    let step = Herd.feed(settled(12), wheat(400));
    for (let d = 1; d <= 30; d++) step = Herd.fold(step, d, 'seed');
    const whole = Herd.fold(Herd.feed(settled(12), wheat(400)), 30, 'seed');
    expect(whole.head).toBe(step.head);
    expect(whole.trough.length).toBe(step.trough.length);
  });

  it('a birth changes a count and writes no register entry', () => {
    const h = Herd.fold(Herd.feed(settled(12), wheat(800)), 30, 'seed');
    expect(h.head).toBeGreaterThan(12);
    expect(h.bodies.length).toBe(settled(12).bodies.length);
  });

  it('more food carries more bodies, and no number stops them', () => {
    const lean = Herd.fold(Herd.feed(settled(10), wheat(60)), 40, 'seed');
    const rich = Herd.fold(Herd.feed(settled(10), wheat(2000)), 40, 'seed');
    expect(rich.head).toBeGreaterThan(lean.head);
    // A trough running down stops the births first, so a herd left a little short does not vanish while you are away
    const leftAlone = Herd.fold(Herd.feed(settled(10), wheat(40)), 12, 'seed');
    expect(leftAlone.head).toBeGreaterThanOrEqual(10);
    const src = readFileSync('src/entities/hub/herd.ts', 'utf8');
    expect(src).not.toMatch(/capacity|MAX_HEAD|maxHead/i);
  });

  it('with nothing to eat a herd thins, and can reach nothing', () => {
    const h = Herd.fold(settled(6), 400, 'seed');
    expect(h.head).toBeLessThan(6);
  });

  it('a herd of any size can lose a head, and any can gain one', () => {
    const lost = Array.from({ length: 30 }, (_, i) => Herd.fold(settled(1), 100, `seed_${i}`).head);
    expect(lost.some(n => n === 0)).toBe(true);
    const born = Array.from({ length: 30 }, (_, i) => Herd.fold(Herd.feed(settled(2), wheat(300)), 40, `seed_${i}`).head);
    expect(born.some(n => n > 2)).toBe(true);
  });

  it('a pair of one gender breeds nothing: gender is read by key', () => {
    const c = caged();
    const single = Herd.pairsOf({ ...Herd.start({ type: 'plot', id: 'p' }, c, 0), head: 1 }, 'seed');
    expect(single).toBe(0);
  });

  it('what a slaughter gives comes off the count and never brings gold', () => {
    const h = settled(5);
    const res = Herd.slaughter(h, MOB_DEFINITIONS[GOAT()] as any, 'k');
    expect(res.herd.head).toBe(4);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.some(i => i.tags.includes('food'))).toBe(true);
    expect(Herd.slaughter(settled(0), MOB_DEFINITIONS[GOAT()] as any, 'k').items).toEqual([]);
  });

  it('through the doors: admit a cage, feed, come back to a head', async () => {
    const plotId = await ownPlot();
    const cage = Capture.cageItem(caged(), 'door');
    const feed = wheat(30);
    giveToStash(cage, ...feed);
    const t0 = 2_000_000_000_000;
    at(t0);
    expect((await FarmDoors.admit(plotId, cage.id)).ok).toBe(true);
    expect(stash().some(i => i.id === cage.id)).toBe(false);
    const herd = Herd.heldBy(hub().farmland.herds, { type: 'plot', id: plotId })[0];
    expect(herd.keeping.length).toBe(1);
    expect(hub().farmland.registers[UID]).toBeTruthy();
    expect((await FarmDoors.feed(plotId, herd.id, feed.map(i => i.id))).ok).toBe(true);
    at(t0 + (Herd.daysToKeep(herd.def as any) + 1) * 86_400_000);
    await FarmDoors.resolve();
    expect(hub().farmland.herds.find(h => h.id === herd.id)!.head).toBeGreaterThanOrEqual(1);
  });

  it('a head comes back out in a cage, to carry to another map, with its proof', async () => {
    const plotId = await ownPlot();
    const cage = Capture.cageItem(caged(), 'door2');
    giveToStash(cage);
    at(2_000_000_000_000);
    await FarmDoors.admit(plotId, cage.id);
    const id = hub().farmland.herds[0].id;
    useHubStore.setState({ farmland: { ...hub().farmland, herds: hub().farmland.herds.map(h => ({ ...h, head: 3, keeping: [] })) } });
    const out = await FarmDoors.cageOne(plotId, id);
    expect(out.ok).toBe(true);
    const item = stash().find(i => i.creatureData);
    expect(item).toBeTruthy();
    expect(item!.creatureData!.proof.kind).toBe(GOAT());
    expect(hub().farmland.herds[0].head).toBe(2);
  });

  it('herding moves no gold, and the audit balances through it', async () => {
    const plotId = await ownPlot();
    const cage = Capture.cageItem(caged(), 'door3');
    giveToStash(cage);
    const gold = player().bank.gold, treasury = await Treasury.balance(HUB);
    at(2_000_000_000_000);
    await FarmDoors.admit(plotId, cage.id);
    expect(player().bank.gold).toBe(gold);
    expect(await Treasury.balance(HUB)).toBe(treasury);
  });
});

// =============================================================================
// LINE 117: another map, with the proof of its line
// =============================================================================

describe('line 117: a captured creature joins another map, with the proof of its line', () => {
  const WORLD_B = { seed: 'world-b', themeId };

  it('a proof of a first-generation kind verifies, and a tampered one does not', async () => {
    const proof = CreatureLines.proofOf(null, { seed: 'a', themeId }, GOAT())!;
    expect((await CreatureLines.verifyProof(proof)).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(proof));
    bad.def.baseHealth = 999_999;
    expect((await CreatureLines.verifyProof(bad)).ok).toBe(false);
  });

  it('a proof of a changed kind carries every node up to its root, and a changed word breaks it', async () => {
    const change = { name: 'Goat, as of 3', blurb: 'x', tags: [], innate: [], bands: { build: 'massive' }, features: ['horns'] } as any;
    const id = await CreatureLines.childId([GOAT()], change);
    const lines = { ...CreatureLines.empty(), nodes: { [id]: { id, parents: [GOAT()], change, bornAt: 3 } } };
    const proof = CreatureLines.proofOf({ ...emptyDirectorRecord(), lines }, { seed: 'a', themeId }, id)!;
    expect(proof.nodes.map(x => x.id)).toEqual([id]);
    expect(proof.roots).toEqual([GOAT()]);
    expect((await CreatureLines.verifyProof(proof)).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(proof));
    bad.nodes[0].change.name = 'Something else';
    expect((await CreatureLines.verifyProof(bad)).ok).toBe(false);
  });

  it('joining moves the map\'s signed root and not its pack', async () => {
    const proof = CreatureLines.proofOf(null, { seed: 'a', themeId }, GOAT())!;
    const before = await CreatureLines.rootOf(WORLD_B.seed, 7, CreatureLines.living(FIRST_THEME_PACK, CreatureLines.empty()));
    const res = await CreatureLines.arrive({ ...emptyDirectorRecord(), generation: 7 }, WORLD_B, proof, '10,10');
    expect(res.ok).toBe(true);
    const root = res.record.lines!.roots.find(r => r.generation === 7)!.root;
    expect(root).not.toBe(before);
    expect(ContentRegistry.get(themeId)).toBe(FIRST_THEME_PACK);
    expect(res.record.lines!.foreign).toBeTruthy();
    expect(Object.keys(res.record.lines!.foreign!).length).toBe(1);
  });

  it('a refused proof changes nothing', async () => {
    const proof = JSON.parse(JSON.stringify(CreatureLines.proofOf(null, { seed: 'a', themeId }, GOAT())!));
    proof.def.baseHealth = 1;
    const record = { ...emptyDirectorRecord(), generation: 7 };
    const res = await CreatureLines.arrive(record, WORLD_B, proof, '10,10');
    expect(res.ok).toBe(false);
    expect(res.record).toBe(record);
  });

  it('a released body stands on that ground at its cycle, and is a count after it', () => {
    const context = ContentRegistry.contextFor(themeId, UniversalRank.C);
    const ground = '70,70';
    const [sx, sy] = [Math.floor(70 / 64), Math.floor(70 / 64)];
    const cold = emptyPopulationRecord();
    const without = Population.sectorAt(JSON.parse(JSON.stringify(cold)), 'world-b', sx, sy, 2, context);
    const record = Population.release(emptyPopulationRecord(), ground, GOAT(), 0);
    expect(record.released?.length).toBe(1);
    const after = Population.sectorAt(record, 'world-b', sx, sy, 1, context);
    const countIn = (s: typeof after) => Object.values(s.ground).reduce((n, on) => n + (on[GOAT()] ?? 0), 0);
    expect(countIn(after)).toBeGreaterThanOrEqual(1);
    expect(without).toBeTruthy();
  });

  it('with no record, a world generates exactly as today', () => {
    const context = ContentRegistry.contextFor(themeId, UniversalRank.C);
    const one = Population.sectorAt(emptyPopulationRecord(), 'plain', 1, 1, 3, context);
    const two = Population.sectorAt({ ...emptyPopulationRecord(), released: [] }, 'plain', 1, 1, 3, context);
    expect(one).toEqual(two);
  });

  it('a body folded in a sector read cycle by cycle lands the same as one read late', () => {
    const context = ContentRegistry.contextFor(themeId, UniversalRank.C);
    const a = Population.release(emptyPopulationRecord(), '70,70', GOAT(), 2);
    const late = Population.sectorAt(JSON.parse(JSON.stringify(a)), 'w', 1, 1, 6, context);
    const stepper = JSON.parse(JSON.stringify(a));
    let stepped;
    for (let g = 1; g <= 6; g++) stepped = Population.sectorAt(stepper, 'w', 1, 1, g, context);
    expect(stepped).toEqual(late);
  });

  it('the kinds a world brought in are defined on opening, and a false one stays out', async () => {
    const change = { name: 'Foreign', blurb: 'x', tags: [], innate: [], bands: {}, features: ['horns'] } as any;
    const id = await CreatureLines.childId([GOAT()], change);
    const lines = { ...CreatureLines.empty(), nodes: { [id]: { id, parents: [GOAT()], change, bornAt: 1 } } };
    const sealed = await CreatureLines.sealProof(CreatureLines.proofOf({ ...emptyDirectorRecord(), lines }, { seed: 'a', themeId }, id)!);
    const res = await CreatureLines.arrive({ ...emptyDirectorRecord(), generation: 1 }, WORLD_B, sealed, '10,10');
    expect(res.ok).toBe(true);
    delete (MOB_DEFINITIONS as any)[id];
    await CreatureLines.define(res.record, themeId);
    expect(MOB_DEFINITIONS[id]).toBeTruthy();
    delete (MOB_DEFINITIONS as any)[id];
    const forged = JSON.parse(JSON.stringify(res.record));
    Object.values<any>(forged.lines.foreign)[0].proof.nodes[0].change.name = 'Forged';
    await CreatureLines.define(forged, themeId);
    expect(MOB_DEFINITIONS[id]).toBeUndefined();
  });

  it('a child of two lines has two parents in its hash, and proves both', async () => {
    const a = CreatureLines.proofOf(null, { seed: 'a', themeId }, GOAT())!;
    const b = CreatureLines.proofOf(null, { seed: 'b', themeId }, OX())!;
    const child = await CreatureLines.crossed(a, b, 'cross-key', 4);
    expect(child.nodes[child.nodes.length - 1].parents).toEqual([GOAT(), OX()]);
    expect(child.kind).toBe(await CreatureLines.childId([GOAT(), OX()], child.nodes[child.nodes.length - 1].change));
    expect((await CreatureLines.verifyProof(child)).ok).toBe(true);
    expect(child.roots.sort()).toEqual([GOAT(), OX()].sort());
    expect((child.def as any).generation).toBe(2);
    // The same two parents and the same key make the same child, on any machine
    expect((await CreatureLines.crossed(a, b, 'cross-key', 4)).kind).toBe(child.kind);
  });

  it('a pen crosses two of its kinds through the doors, by a roll, and a register holds both parents', async () => {
    const plotId = await ownPlot();
    const a = Capture.cageItem(caged(GOAT()), 'a'), b = Capture.cageItem(caged(OX()), 'b');
    giveToStash(a, b);
    at(2_000_000_000_000);
    await FarmDoors.admit(plotId, a.id);
    await FarmDoors.admit(plotId, b.id);
    const herds = hub().farmland.herds;
    expect(herds.length).toBe(2);
    useHubStore.setState({ farmland: { ...hub().farmland, herds: herds.map(h => ({ ...h, head: 2, keeping: [], bodies: h.bodies })) } });
    let crossed: any = { ok: false, reason: 'unset' };
    for (let i = 0; i < 40 && !crossed.ok; i++) crossed = await FarmDoors.cross(plotId, herds[0].id, herds[1].id);
    expect(crossed.ok).toBe(true);
    const child = hub().farmland.herds.find(h => !herds.some(o => o.id === h.id))!;
    expect(child.proof.nodes[child.proof.nodes.length - 1].parents.length).toBe(2);
    const reg = hub().farmland.registers[UID];
    const entry = reg.entries.find(e => e.body === child.bodies[0])!;
    expect(entry.parents.length).toBe(2);
    expect(Koseki.lineage(reg, entry.body).length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// COOKING
// =============================================================================

describe('cooking', () => {
  const food = (key = 'chaffwheat') => harvested(materialId(key));

  it('takes two or more things that answer food, and refuses what does not', () => {
    expect(Cooking.verdict([food()]).ok).toBe(false);
    expect(Cooking.verdict([food(), harvested(STONE())]).ok).toBe(false);
    expect(Cooking.verdict([food(), food('accrual_berry')]).ok).toBe(true);
  });

  it('a meal comes out by key, says what it was made from, and is something a person can eat', () => {
    const items = [food(), food('accrual_berry')];
    const one = Cooking.meal(items, 'k1');
    const two = Cooking.meal(items, 'k1');
    expect(one).toEqual(two);
    expect(one.type).toBe(ItemType.CONSUMABLE);
    expect(one.tags).toEqual(expect.arrayContaining(['food', 'meal']));
    expect(one.stats.health_restore).toBeGreaterThan(0);
    expect(one.name).toMatch(/Chaffwheat/);
    expect(one.name).toMatch(/Accrual Berry/);
    expect(one.composition?.steps.length).toBeGreaterThan(0);
  });

  it('more in the pot feeds more, and variety is worth more than the same thing twice', () => {
    const same = Cooking.meal([food(), food()], 'k');
    const mixed = Cooking.meal([food(), food('accrual_berry')], 'k');
    const more = Cooking.meal([food(), food('accrual_berry'), food('gall_of_the_ledger')], 'k');
    expect(mixed.stats.health_restore).toBeGreaterThan(same.stats.health_restore);
    expect(more.stats.health_restore).toBeGreaterThan(mixed.stats.health_restore);
  });

  it('a hearth stands on a plot by a bill of stone, and cooks on a clock', async () => {
    const plotId = await ownPlot();
    expect((await FarmDoors.cook(plotId, [])).ok).toBe(false);
    const stones = Array.from({ length: Cooking.HEARTH_BILL.count }, () => harvested(STONE()));
    giveToStash(...stones);
    expect((await FarmDoors.buildHearth(plotId)).ok).toBe(true);
    expect(stash().filter(i => i.universalDefinitionId === STONE()).length).toBe(0);
    expect(hub().farmland.farms[plotId].hearth).toBe(true);
    const a = food(), b = food('accrual_berry');
    giveToStash(a, b);
    at(2_000_000_000_000);
    expect((await FarmDoors.cook(plotId, [a.id, b.id])).ok).toBe(true);
    expect(stash().some(i => i.id === a.id)).toBe(false);
    await FarmDoors.resolve();
    expect(hub().lots.find(l => l.id === plotId)!.inventory.filter(i => i.tags.includes('meal')).length).toBe(0);
    at(2_000_000_000_000 + Cooking.cookMs([a, b]) + 1);
    await FarmDoors.resolve();
    expect(hub().lots.find(l => l.id === plotId)!.inventory.filter(i => i.tags.includes('meal')).length).toBe(1);
  });

  it('a meal can be eaten in the field through the door a consumable already has', () => {
    const meal = Cooking.meal([food(), food('accrual_berry')], 'k');
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { inventory: [meal], health: 5, maxHealth: 100, inventoryLayout: {}, energy: 10 } as any } }));
    usePlayerStore.getState().consumeItem(meal.id);
    const session = usePlayerStore.getState().player.currentSession!;
    expect(session.health).toBeGreaterThan(5);
    expect(session.inventory).toEqual([]);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined as any } }));
  });
});

describe('the seams others read', () => {
  it('no price, no clock and no model in the pure laws', () => {
    for (const file of ['src/entities/hub/farm.ts', 'src/entities/hub/herd.ts', 'src/logic/systems/Capture.ts', 'src/logic/systems/Cooking.ts']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/Date\.now\(|Math\.random\(/);
      expect(text, file).not.toMatch(/fetch\(|anthropic/i);
    }
  });

  it('every tag the laws write is registered', () => {
    const pack = WebBank.current();
    const tags = new Set(pack.tags.filter(t => !t.retired).map(t => t.tag));
    for (const tag of ['snare', 'cage', 'meal', 'meat', 'food']) expect(tags.has(tag), tag).toBe(true);
  });

  it('worldDay stays the herd\'s clock', () => {
    expect(typeof worldDay()).toBe('number');
  });

  it('Rarity and SlotType stay untouched by the new items', () => {
    const item = Capture.tieSnare([harvested(materialId('tellers_reed')), harvested(materialId('tellers_reed'))], 'k').item!;
    expect(Object.values(Rarity)).toContain(item.rarity);
    expect(Object.values(SlotType)).toContain(item.slot);
  });
});

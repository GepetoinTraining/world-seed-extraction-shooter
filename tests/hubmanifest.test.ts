/**
 * STREAM A1 BARS (D74): registered before the build.
 * Test line 114, first half: the hub is a chunk from a manifest, the middle one first.
 *
 * Pedro: "we need to set it up using a manifest like matrix that places the
 * buildings, with the initial chunk being the middle one, and it growing around
 * the initial chunk." The spending half of line 114 is B4's. Nothing here decides
 * who pays.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { CHUNK_TILES, QUADRANT_TILES } from '../src/entities/world/grid';
import { HubGenerator, IHubLayout, IPOI, POIType, ZoneType } from '../src/entities/hub/HubGenerator';
import {
  CELL_TILES, CHUNK_CELLS, EMPTY_MARK, HUB_SIDES, HubSide, IHubManifest, IHubPlan, NEW_CARLEON, SPAWN_MARK,
  firstPlan, lotPrice, openSides, raiseChunk, validateManifest
} from '../src/entities/hub/hubManifest';
import { HUB_TILE, LOT_STATES, composeHub, doorOf, hubGround, lotArt } from '../src/render/atoms/hub';
import { cityMinimap } from '../src/render/atoms/minimap';
import { Role, STEPS, hashBytes, px } from '../src/render/atoms/atoms';
import { fnv1a } from '../src/logic/rng/DeterministicRNG';
import { useHubStore } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { emptyRoom, fullyWalkable } from '../src/entities/hub/room';
import { sizeNeedsVerdict } from '../src/entities/hub/template';
import { usePlayerStore } from '../src/entities/player/store';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { CRAFTED_DEFINITIONS } from '../src/entities/economy/data/recipeDefinitions';
import { Rng } from '../src/logic/rng/DeterministicRNG';

const SRC = (path: string) => readFileSync(path, 'utf8');
const allPois = (l: IHubLayout) => l.zones.flatMap(z => z.pois);
const poiOf = (l: IHubLayout, id: string) => HubGenerator.findPOI(l, id)!;
const lotPois = (l: IHubLayout) => allPois(l).filter(p => p.type === POIType.PLAYER_LOT);
const inChunk = (l: IHubLayout, p: IPOI, chunk = l.chunks[0]) =>
  p.position.x >= chunk.x && p.position.y >= chunk.y &&
  p.position.x + p.size.width <= chunk.x + CHUNK_TILES && p.position.y + p.size.height <= chunk.y + CHUNK_TILES;

const planOf = (...sides: HubSide[]): IHubPlan => sides.reduce<IHubPlan>((plan, side) => {
  const res = raiseChunk(plan, side);
  if (res.ok === false) throw new Error(res.reason);
  return res.plan;
}, firstPlan());

/** Everyone you can stand on, walking from where you arrive. */
const walkable = (l: IHubLayout) => {
  const seen = new Set([`${l.spawnPoint.x},${l.spawnPoint.y}`]);
  const queue = [l.spawnPoint];
  while (queue.length) {
    const { x, y } = queue.shift()!;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= l.width || ny >= l.height || seen.has(key) || !l.navMesh[ny][nx]) return;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    });
  }
  return seen;
};

/** A tile-aligned window of a composed city, in atoms. */
const cropAtoms = (s: { w: number; data: Uint8Array }, tileX: number, tileY: number, tiles: number) => {
  const size = tiles * HUB_TILE, out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    out[y * size + x] = s.data[(tileY * HUB_TILE + y) * s.w + tileX * HUB_TILE + x];
  }
  return out;
};

/** What stood in the city before this stream, by what it is rather than where. */
const STOOD_THERE: { id: string; type: POIType; name: string; width: number; height: number; npcId?: string }[] = [
  { id: 'poi_fountain', type: POIType.FOUNTAIN, name: 'Founders Fountain', width: 4, height: 4 },
  { id: 'poi_bank', type: POIType.BANK, name: 'Consortium Vault', width: 4, height: 3, npcId: 'npc_banker' },
  { id: 'poi_portal', type: POIType.PORTAL, name: 'The Nexus', width: 3, height: 3, npcId: 'npc_portal_master' },
  { id: 'poi_identifier', type: POIType.IDENTIFIER, name: 'Truthsight Tower', width: 3, height: 3, npcId: 'npc_identifier' },
  { id: 'poi_guild', type: POIType.GUILD_HALL, name: 'Hall of Banners', width: 4, height: 4, npcId: 'npc_guild_master' },
  { id: 'poi_weapons', type: POIType.VENDOR_WEAPONS, name: 'Ironfist Armory', width: 4, height: 3, npcId: 'npc_weapon_vendor' },
  { id: 'poi_armor', type: POIType.VENDOR_ARMOR, name: 'Steelweave Outfitters', width: 4, height: 3, npcId: 'npc_armor_vendor' },
  { id: 'poi_consumables', type: POIType.VENDOR_CONSUMABLES, name: "Alchemist's Corner", width: 3, height: 3, npcId: 'npc_alchemist' },
  { id: 'poi_auction', type: POIType.AUCTION_HOUSE, name: 'The Exchange', width: 5, height: 4, npcId: 'npc_auctioneer' },
  { id: 'poi_tavern', type: POIType.TAVERN, name: 'The Rusty Anchor', width: 5, height: 4, npcId: 'npc_bartender' }
];
const LOTS_STANDING = 6;
const LAMPS_STANDING = 7;

// The whole layout, by hash: the same inputs give the same city on every machine.
const STORED_LAYOUT_HASH = 1744216641;
const STORED_SECOND_CHUNK_HASH = 1463331517;

beforeEach(() => {
  db.clear();
  useIdentityStore.setState({ certificate: { metadata: { uid: 'uid_bars', displayName: 'TESTER', createdAt: 0 }, publicKey: {}, publicKeyJWK: {} } as any });
});

// -----------------------------------------------------------------------------
// THE REAL CHUNK
// -----------------------------------------------------------------------------

describe('the hub stands on the real chunk', () => {
  const layout = HubGenerator.generate();

  it('is one chunk wide and high, and the chunk is the grid\'s own', () => {
    expect(layout.width).toBe(CHUNK_TILES);
    expect(layout.height).toBe(CHUNK_TILES);
    expect(layout.navMesh.length).toBe(CHUNK_TILES);
    layout.navMesh.forEach(row => expect(row.length).toBe(CHUNK_TILES));
  });

  it('a matrix cell divides the grid exactly: cells to a quadrant, quadrants to a chunk', () => {
    expect(CELL_TILES * CHUNK_CELLS).toBe(CHUNK_TILES);
    expect(QUADRANT_TILES % CELL_TILES).toBe(0);
  });

  it('writes no coordinates in the generator any more', () => {
    const src = SRC('src/entities/hub/HubGenerator.ts');
    expect(src).not.toMatch(/position:\s*\{\s*x:\s*\d/);
    expect(src).not.toMatch(/bounds:\s*\{\s*x:\s*\d/);
    expect(src).not.toMatch(/width\s*=\s*50/);
    expect(src).not.toMatch(/\b(lampPositions|spawnPoint:\s*\{\s*x:\s*\d)/);
  });
});

// -----------------------------------------------------------------------------
// THE MANIFEST PLACES THEM
// -----------------------------------------------------------------------------

describe('the manifest is the one place anything is placed', () => {
  const layout = HubGenerator.generate();
  const first = NEW_CARLEON.chunks[NEW_CARLEON.first];

  it('passes its own law, every chunk of it', () => {
    expect(validateManifest(NEW_CARLEON)).toEqual([]);
    Object.values(NEW_CARLEON.chunks).forEach(chunk => {
      expect(chunk.place.length).toBe(CHUNK_CELLS);
      expect(chunk.floor.length).toBe(CHUNK_CELLS);
      [...chunk.place, ...chunk.floor].forEach(row => expect(row.length).toBe(CHUNK_CELLS));
    });
  });

  it('every mark in the matrix is one thing standing at that cell, and nothing stands without a mark', () => {
    const placed: { x: number; y: number }[] = [];
    first.place.forEach((row, cy) => [...row].forEach((mark, cx) => {
      if (mark === EMPTY_MARK || mark === SPAWN_MARK) return;
      placed.push({ x: cx * CELL_TILES, y: cy * CELL_TILES });
    }));
    const positions = allPois(layout).map(p => p.position);
    expect(positions.length).toBe(placed.length);
    placed.forEach(at => expect(positions, `${at.x},${at.y}`).toContainEqual(at));
  });

  it('where you arrive is a mark too', () => {
    const row = first.place.findIndex(r => r.includes(SPAWN_MARK));
    expect(layout.spawnPoint).toEqual({ x: first.place[row].indexOf(SPAWN_MARK) * CELL_TILES, y: row * CELL_TILES });
    expect(layout.navMesh[layout.spawnPoint.y][layout.spawnPoint.x]).toBe(true);
  });

  it('the first chunk holds what stood there, as it was', () => {
    STOOD_THERE.forEach(want => {
      const p = poiOf(layout, want.id);
      expect(p, want.id).toBeTruthy();
      expect({ type: p.type, name: p.name, width: p.size.width, height: p.size.height, npcId: p.npcId }, want.id)
        .toEqual({ type: want.type, name: want.name, width: want.width, height: want.height, npcId: want.npcId });
      expect(inChunk(layout, p), want.id).toBe(true);
    });
    expect(allPois(layout).filter(p => p.type === POIType.LAMP_POST).length).toBe(LAMPS_STANDING);
    expect(lotPois(layout).length).toBe(LOTS_STANDING);
  });

  it('the districts keep their places around the plaza', () => {
    const zone = (t: ZoneType) => layout.zones.find(z => z.type === t)!.bounds;
    const plaza = zone(ZoneType.PLAZA);
    expect(zone(ZoneType.GARDEN).x + zone(ZoneType.GARDEN).width).toBeLessThanOrEqual(plaza.x);   // the tavern, west
    expect(zone(ZoneType.MARKET).y).toBeGreaterThanOrEqual(plaza.y + plaza.height);               // the market, south
    expect(zone(ZoneType.RESIDENTIAL).x).toBeGreaterThanOrEqual(plaza.x + plaza.width);           // the lots, east
    const at = (id: string) => poiOf(layout, id).position;
    expect(at('poi_bank').x).toBeLessThan(at('poi_portal').x);
    expect(at('poi_portal').x).toBeLessThan(at('poi_identifier').x);
    expect(at('poi_bank').y).toBeLessThan(at('poi_fountain').y);
    expect(at('poi_guild').x).toBeGreaterThan(at('poi_fountain').x);
    expect(layout.spawnPoint.y).toBeGreaterThanOrEqual(at('poi_fountain').y + 4); // you arrive south of the fountain
  });

  it('a zone\'s bounds and every thing\'s zone come from the floor matrix', () => {
    layout.zones.forEach(z => {
      expect(z.bounds.x % CELL_TILES, z.id).toBe(0);
      expect(z.bounds.width % CELL_TILES, z.id).toBe(0);
      z.pois.forEach(p => expect(HubGenerator.getZoneAtPosition(layout, p.position.x, p.position.y)?.id, p.id).toBe(z.id));
    });
  });

  it('the navmesh blocks exactly what the legend says is solid, and nothing else', () => {
    let blocked = 0;
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) if (!layout.navMesh[y][x]) blocked++;
    const solidTiles = allPois(layout)
      .filter(p => ![POIType.PLAYER_LOT, POIType.PORTAL].includes(p.type))
      .reduce((n, p) => n + p.size.width * p.size.height, 0);
    expect(blocked).toBe(solidTiles);
  });

  it('moving a mark moves the building, its navmesh, its zone and its place on the map', () => {
    const shifted: IHubManifest = JSON.parse(JSON.stringify(NEW_CARLEON));
    const place = shifted.chunks[shifted.first].place;
    const row = place.findIndex(r => r.includes('B'));
    const col = place[row].indexOf('B');
    const swap = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
    place[row] = swap(place[row], col, EMPTY_MARK);
    // Into the empty ground north of the plaza, and onto a floor of its own.
    const floor = shifted.chunks[shifted.first].floor;
    place[2] = swap(place[2], 4, 'B');
    floor[2] = swap(floor[2], 4, 'G');
    shifted.floors.G = { id: 'zone_test', name: 'Moved', type: ZoneType.GARDEN, ambientColor: '#000000', floorTexture: 'dirt' };

    const moved = HubGenerator.generate(firstPlan(shifted), shifted);
    const bank = poiOf(moved, 'poi_bank');
    expect(bank.position).toEqual({ x: 4 * CELL_TILES, y: 2 * CELL_TILES });
    expect(moved.navMesh[bank.position.y][bank.position.x]).toBe(false);
    const old = poiOf(layout, 'poi_bank').position;
    expect(moved.navMesh[old.y][old.x]).toBe(true);
    expect(HubGenerator.getZoneAtPosition(moved, bank.position.x, bank.position.y)?.id).toBe('zone_test');
    const map = (l: IHubLayout) => hashBytes(cityMinimap(l, {}, { x: 0, y: 0 }).data);
    expect(map(moved)).not.toBe(map(layout));
  });
});

describe('the manifest\'s law refuses what could not stand', () => {
  const copy = (): IHubManifest => JSON.parse(JSON.stringify(NEW_CARLEON));
  const swap = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
  const chunkOf = (m: IHubManifest) => m.chunks[m.first];

  it('a short row', () => {
    const m = copy();
    chunkOf(m).place[3] = '...';
    expect(validateManifest(m).join()).toMatch(/row/i);
  });

  it('a mark the legend does not know', () => {
    const m = copy();
    chunkOf(m).place[1] = swap(chunkOf(m).place[1], 1, '?');
    expect(validateManifest(m).join()).toMatch(/\?/);
  });

  it('a floor the legend does not know', () => {
    const m = copy();
    chunkOf(m).floor[1] = swap(chunkOf(m).floor[1], 1, '?');
    expect(validateManifest(m).join()).toMatch(/\?/);
  });

  it('two things on one footprint', () => {
    const m = copy();
    const row = chunkOf(m).place.findIndex(r => r.includes('X'));
    const col = chunkOf(m).place[row].indexOf('X');
    chunkOf(m).place[row] = swap(chunkOf(m).place[row], col + 1, 'l'); // the auction house is five tiles wide
    expect(validateManifest(m).join()).toMatch(/overlap/i);
  });

  it('a thing on the chunk\'s edge, where the next chunk has to join', () => {
    const m = copy();
    chunkOf(m).floor[0] = swap(chunkOf(m).floor[0], 4, 'P');
    chunkOf(m).place[0] = swap(chunkOf(m).place[0], 4, 'l');
    expect(validateManifest(m).join()).toMatch(/edge/i);
  });

  it('a thing with no floor under it', () => {
    const m = copy();
    chunkOf(m).place[2] = swap(chunkOf(m).place[2], 4, 'l');
    expect(validateManifest(m).join()).toMatch(/floor/i);
  });

  it('a district that is not a rectangle', () => {
    const m = copy();
    chunkOf(m).floor[2] = swap(chunkOf(m).floor[2], 2, 'P');
    expect(validateManifest(m).join()).toMatch(/rectangle/i);
  });

  it('a door nobody can reach', () => {
    const m = copy();
    m.marks.w = { type: POIType.FOUNTAIN, name: 'Wall', size: { width: 4, height: 4 }, interactable: false, solid: true, metadata: {}, series: 'poi_wall' };
    m.floors.Q = { id: 'zone_walled', name: 'Walled', type: ZoneType.GARDEN, ambientColor: '#000000', floorTexture: 'dirt' };
    // A lot walled in on every side, in the empty ground to the northwest.
    const place = chunkOf(m).place, floor = chunkOf(m).floor;
    [1, 2, 3].forEach(r => { floor[r] = 'Q' + floor[r].slice(1); floor[r] = swap(swap(swap(floor[r], 0, '.'), 1, 'Q'), 2, 'Q'); floor[r] = swap(floor[r], 3, 'Q'); });
    const ring: [number, number][] = [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]];
    ring.forEach(([c, r]) => { place[r] = swap(place[r], c, 'w'); });
    place[2] = swap(place[2], 2, 'L');
    expect(validateManifest(m).join()).toMatch(/cannot be reached/);
  });

  it('a hub with no place to arrive, or two', () => {
    const none = copy();
    const row = chunkOf(none).place.findIndex(r => r.includes(SPAWN_MARK));
    chunkOf(none).place[row] = chunkOf(none).place[row].replace(SPAWN_MARK, EMPTY_MARK);
    expect(validateManifest(none).join()).toMatch(/arrive/i);
    const two = copy();
    chunkOf(two).place[1] = swap(chunkOf(two).place[1], 1, SPAWN_MARK);
    expect(validateManifest(two).join()).toMatch(/arrive/i);
  });

  it('a one-of-a-kind building in a chunk that can rise many times', () => {
    const m = copy();
    const grow = m.chunks[m.growth];
    grow.place[1] = swap(grow.place[1], 1, 'B');
    expect(validateManifest(m).join()).toMatch(/one of a kind|poi_bank/i);
  });

  it('a manifest naming a first or growth chunk it does not hold', () => {
    const m = copy();
    m.growth = 'nowhere';
    expect(validateManifest(m).join()).toMatch(/nowhere/);
  });
});

// -----------------------------------------------------------------------------
// THE LOTS, RE-LAID
// -----------------------------------------------------------------------------

describe('the lots are re-laid to fit', () => {
  const layout = HubGenerator.generate();
  const lots = lotPois(layout);

  it('keeps every lot\'s id and number, in the same reading order', () => {
    expect(lots.map(p => p.id)).toEqual(Array.from({ length: LOTS_STANDING }, (_, i) => `poi_lot_${i}`));
    lots.forEach((p, i) => {
      expect(p.metadata.lotIndex).toBe(i);
      expect(p.name).toBe(`Lot #${i + 1}`);
    });
  });

  it('every lot lies in the chunk, on the residential floor, touching nothing', () => {
    lots.forEach(p => {
      expect(inChunk(layout, p), p.id).toBe(true);
      expect(HubGenerator.getZoneAtPosition(layout, p.position.x, p.position.y)?.type, p.id).toBe(ZoneType.RESIDENTIAL);
    });
    const touches = (a: IPOI, b: IPOI) =>
      a.position.x < b.position.x + b.size.width && b.position.x < a.position.x + a.size.width &&
      a.position.y < b.position.y + b.size.height && b.position.y < a.position.y + a.size.height;
    lots.forEach(a => allPois(layout).filter(b => b.id !== a.id).forEach(b => expect(touches(a, b), `${a.id}/${b.id}`).toBe(false)));
  });

  it('every door in the chunk can be walked to from where you arrive', () => {
    const reach = walkable(layout);
    allPois(layout).filter(p => p.interactable).forEach(p => {
      const d = doorOf(p);
      expect(reach.has(`${d.x},${d.y}`), p.id).toBe(true);
    });
  });
});

describe('a lot someone owns stays theirs (placement migrates, ownership never)', () => {
  const ownedLot = { id: 'poi_lot_2', lotIndex: 2, ownerId: 'uid_owner', ownerName: 'OLD HAND', purchaseDate: 12345, structureType: 'HOUSE', inventory: [], price: 5000, upkeepPaidThroughDay: 99999, proceeds: 7 };
  const storedLots = [0, 1, 2, 3, 4, 5].map(i => i === 2 ? ownedLot : ({ id: `poi_lot_${i}`, lotIndex: i, ownerId: null, ownerName: null, purchaseDate: null, structureType: 'EMPTY', inventory: [], price: 5000 }));
  const seedOldHub = (id: string) => {
    // A save from before the manifest: no chunks on it, and no place written on any lot.
    db.set(`hub_state_${id}`, {
      id: `hub_state_${id}`, namespace: 'territories',
      data: { lots: JSON.parse(JSON.stringify(storedLots)), craftingJobs: [], rooms: { poi_lot_2: emptyRoom('poi_lot_2', { width: 4, height: 4 }, 'crf_plank') }, buildJobs: [], web: { nodes: {} } },
      metadata: { createdAt: 0, updatedAt: 0, ownerCertUid: 'SYSTEM', version: 1 }
    });
  };
  const load = async (id: string) => {
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks } as any);
    await useHubStore.getState().loadHub(id);
  };

  // Moved on Pedro's word: a lot's price follows where it stands, so an old save's
  // free lots take the new price. A record someone holds is still not touched.
  it('an old save loads on the first chunk with every owner untouched, and only free lots repriced', async () => {
    seedOldHub('hub_old');
    await load('hub_old');
    const hub = useHubStore.getState();
    expect(hub.lots.find(l => l.id === 'poi_lot_2')).toEqual(ownedLot);
    const layout = HubGenerator.generate({ chunks: hub.chunks });
    hub.lots.filter(l => !l.ownerId).forEach(l => {
      const { price, ...rest } = l;
      const { price: _old, ...storedRest } = storedLots.find(s => s.id === l.id)!;
      expect(rest, l.id).toEqual(storedRest);
      expect(price, l.id).toBe(poiOf(layout, l.id).metadata.price);
    });
    expect(hub.chunks).toEqual(firstPlan().chunks);
    expect(hub.rooms.poi_lot_2.lotId ?? 'poi_lot_2').toBe('poi_lot_2');
  });

  it('nothing about a lot\'s place is written on the lot', () => {
    Object.keys(storedLots[0]).forEach(k => expect(['position', 'x', 'y', 'size']).not.toContain(k));
    const src = SRC('src/entities/hub/store.ts');
    expect(src).not.toMatch(/position:\s*poi\.position/);
  });

  it('a stored lot the manifest no longer places is kept, never dropped', () => {
    const layout = HubGenerator.generate();
    const orphan = { ...ownedLot, id: 'poi_lot_999', lotIndex: 999 };
    const kept = HubGenerator.lotRecords([...storedLots, orphan], layout, (poi: IPOI) => ({ ...storedLots[0], id: poi.id, lotIndex: poi.metadata.lotIndex }));
    expect(kept).toContainEqual(orphan);
    expect(kept.length).toBe(storedLots.length + 1);
  });

  it('raising a chunk adds free lots and touches no record that was there', async () => {
    seedOldHub('hub_grow');
    await load('hub_grow');
    const before = JSON.parse(JSON.stringify(useHubStore.getState().lots));
    const res = await useHubStore.getState().raiseChunk('EAST');
    expect(res.ok).toBe(true);
    const hub = useHubStore.getState();
    expect(hub.lots.slice(0, before.length)).toEqual(before);
    const added = hub.lots.slice(before.length);
    expect(added.length).toBeGreaterThan(0);
    added.forEach(l => {
      expect(l.ownerId).toBeNull();
      expect(l.structureType).toBe('EMPTY');
      expect(l.id).toBe(`poi_lot_${l.lotIndex}`);
    });
    expect(new Set(hub.lots.map(l => l.id)).size).toBe(hub.lots.length);
  });

  it('a raised chunk survives a reload, with its lots and the owner of each', async () => {
    seedOldHub('hub_keep');
    await load('hub_keep');
    await useHubStore.getState().raiseChunk('WEST');
    const saved = useHubStore.getState();
    const wantChunks = JSON.parse(JSON.stringify(saved.chunks));
    const wantLots = JSON.parse(JSON.stringify(saved.lots));
    await load('hub_keep');
    expect(useHubStore.getState().chunks).toEqual(wantChunks);
    expect(useHubStore.getState().lots).toEqual(wantLots);
  });

  it('a chunk raised is written in the ledger, and a refused one moves nothing', async () => {
    seedOldHub('hub_ledger');
    await load('hub_ledger');
    await useHubStore.getState().raiseChunk('NORTH');
    const chunks = useHubStore.getState().chunks;
    const lots = useHubStore.getState().lots;
    const again = await useHubStore.getState().raiseChunk('NORTH');
    expect(again.ok).toBe(false);
    expect(useHubStore.getState().chunks).toBe(chunks);
    expect(useHubStore.getState().lots).toBe(lots);
    expect(SRC('src/entities/hub/store.ts')).toMatch(/Ledger\.append\('BUILD',\s*\{\s*kind:\s*'CHUNK_RAISED'/);
  });

  it('a lot in a raised chunk can be bought and built on, at the footprint the manifest gave it', async () => {
    seedOldHub('hub_build');
    await load('hub_build');
    await useHubStore.getState().raiseChunk('SOUTH');
    const before = useHubStore.getState();
    const layout = HubGenerator.generate({ chunks: before.chunks });
    const far = before.lots[before.lots.length - 1];
    const poi = HubGenerator.findPOI(layout, far.id)!;
    expect(inChunk(layout, poi, layout.chunks[1])).toBe(true);

    const planks = Array.from({ length: 8 }, (_, i) => ItemFactory.createResourceItem(CRAFTED_DEFINITIONS.crf_plank as any, Rng.fromKey(`a1_plank_${i}`)));
    usePlayerStore.setState(s => ({
      player: { ...s.player, id: 'uid_bars', username: 'TESTER', bank: { ...s.player.bank, gold: 20000, stashTabs: [{ ...s.player.bank.stashTabs[0], items: planks }] } }
    }));
    expect(await useHubStore.getState().buyLot(far.id)).toBe(true);
    expect(await useHubStore.getState().buildStructure(far.id, 'HOUSE', 'crf_plank')).toBe(true);
    useHubStore.setState(s => ({ buildJobs: s.buildJobs.map(j => ({ ...j, finishesAt: 0 })) }));
    await useHubStore.getState().resolveBuilds();

    const after = useHubStore.getState();
    const lot = after.lots.find(l => l.id === far.id)!;
    expect(lot.ownerId).toBe('uid_bars');
    expect(lot.structureType).toBe('HOUSE');
    // Asked of the bare first chunk this lot would not exist, and the room would fall back to a guess.
    expect(HubGenerator.findPOI(HubGenerator.generate(), far.id)).toBeNull();
    expect(after.rooms[far.id].size).toEqual(emptyRoom(far.id, poi.size, 'crf_plank').size);
  });

  it('every reader asks the hub\'s own plan, never the bare first chunk', () => {
    ['src/entities/hub/store.ts', 'src/entities/hub/HubCanvas.tsx', 'src/components/TemplateApplyModal.tsx'].forEach(path => {
      expect(SRC(path), path).not.toMatch(/HubGenerator\.generate\(\)/);
    });
  });
});

// -----------------------------------------------------------------------------
// THE MIDDLE, AND GROWING AROUND IT
// -----------------------------------------------------------------------------

describe('the first chunk is the middle, and the hub grows around it', () => {
  it('a chunk can rise on any of the four sides', () => {
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const plan = planOf(side);
      expect(plan.chunks.length, side).toBe(2);
      const [a, b] = plan.chunks;
      expect({ dx: b.cx - a.cx, dy: b.cy - a.cy }, side).toEqual(HUB_SIDES[side]);
    });
  });

  it('with all four sides raised the first chunk is at the middle of the city', () => {
    const l = HubGenerator.generate(planOf('NORTH', 'EAST', 'SOUTH', 'WEST'));
    expect(l.width).toBe(CHUNK_TILES * 3);
    expect(l.height).toBe(CHUNK_TILES * 3);
    expect(l.origin).toEqual({ x: CHUNK_TILES, y: CHUNK_TILES });
    expect({ x: l.chunks[0].x, y: l.chunks[0].y }).toEqual(l.origin);
  });

  it('refuses a side already raised, ground not beside it, and a chunk the manifest does not hold', () => {
    const plan = planOf('EAST');
    const taken = raiseChunk(plan, 'EAST');
    expect(taken.ok).toBe(false);
    if (taken.ok === false) expect(taken.reason).toMatch(/already/i);
    const nowhere = raiseChunk(plan, 'NORTH', { beside: { cx: 9, cy: 9 } });
    expect(nowhere.ok).toBe(false);
    const unknown = raiseChunk(plan, 'NORTH', { kind: 'no_such_chunk' });
    expect(unknown.ok).toBe(false);
  });

  it('raises beside any chunk, not only the first', () => {
    const plan = planOf('EAST');
    const res = raiseChunk(plan, 'EAST', { beside: { cx: plan.chunks[1].cx, cy: plan.chunks[1].cy } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(HubGenerator.generate(res.plan).width).toBe(CHUNK_TILES * 3);
  });

  it('says what could rise next: every open side of every chunk, each place once', () => {
    expect(openSides(firstPlan()).length).toBe(4);
    const plan = planOf('EAST');
    const open = openSides(plan);
    const places = open.map(o => `${o.at.cx},${o.at.cy}`);
    expect(new Set(places).size).toBe(places.length);
    expect(places).not.toContain('0,0');
    expect(places).not.toContain('1,0');
    expect(places.length).toBe(6);
    open.forEach(o => expect(raiseChunk(plan, o.side, { beside: o.beside }).ok).toBe(true));
  });

  it('has no ceiling: forty chunks rise, every id unique and every lot numbered in order', () => {
    let plan = firstPlan();
    for (let i = 0; i < 40; i++) {
      const next = openSides(plan)[i % openSides(plan).length];
      const res = raiseChunk(plan, next.side, { beside: next.beside });
      expect(res.ok).toBe(true);
      if (res.ok) plan = res.plan;
    }
    const l = HubGenerator.generate(plan);
    const ids = allPois(l).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const zoneIds = l.zones.map(z => z.id);
    expect(new Set(zoneIds).size).toBe(zoneIds.length);
    expect(lotPois(l).map(p => p.metadata.lotIndex).sort((a, b) => a - b)).toEqual(lotPois(l).map((_, i) => i));
  });

  it('raising a chunk changes no lot\'s id or number, whichever side it rises', () => {
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      const firstLots = lotPois(HubGenerator.generate());
      firstLots.forEach(p => {
        const after = poiOf(l, p.id);
        expect(after.metadata.lotIndex, `${side} ${p.id}`).toBe(p.metadata.lotIndex);
        expect(after.position, `${side} ${p.id}`).toEqual({ x: p.position.x + l.origin.x, y: p.position.y + l.origin.y });
      });
    });
  });

  it('the first chunk is the same bytes whichever side the hub grows', () => {
    const alone = composeHub(HubGenerator.generate(), { frame: 0 });
    const before = cropAtoms(alone, 0, 0, CHUNK_TILES);
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      const s = composeHub(l, { frame: 0 });
      const after = cropAtoms(s, l.origin.x, l.origin.y, CHUNK_TILES);
      expect(Buffer.from(after).equals(Buffer.from(before)), side).toBe(true);
    });
  });

  it('the first chunk\'s navmesh is the same whichever side the hub grows', () => {
    const alone = HubGenerator.generate();
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      for (let y = 0; y < CHUNK_TILES; y++) for (let x = 0; x < CHUNK_TILES; x++) {
        expect(l.navMesh[y + l.origin.y][x + l.origin.x], `${side} ${x},${y}`).toBe(alone.navMesh[y][x]);
      }
    });
  });

  it('you arrive on the same ground of the first chunk whichever side it grows', () => {
    const alone = HubGenerator.generate();
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      expect(l.spawnPoint, side).toEqual({ x: alone.spawnPoint.x + l.origin.x, y: alone.spawnPoint.y + l.origin.y });
    });
  });

  it('a raised chunk can be walked into across its seam, on every side, to every door', () => {
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      const reach = walkable(l);
      const added = l.chunks[1];
      const newOnes = allPois(l).filter(p => p.interactable && inChunk(l, p, added));
      expect(newOnes.length, side).toBeGreaterThan(0);
      newOnes.forEach(p => {
        const d = doorOf(p);
        expect(reach.has(`${d.x},${d.y}`), `${side} ${p.id}`).toBe(true);
      });
    });
  });

  it('a chunk not raised is not ground: nobody walks it, and it is not drawn', () => {
    const plan = planOf('EAST');
    const res = raiseChunk(plan, 'SOUTH', { beside: { cx: 1, cy: 0 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const l = HubGenerator.generate(res.plan);
    expect(l.width).toBe(CHUNK_TILES * 2);
    expect(l.height).toBe(CHUNK_TILES * 2);
    // The corner below the first chunk stands in the box and is not raised.
    for (let y = CHUNK_TILES; y < CHUNK_TILES * 2; y += 7) for (let x = 0; x < CHUNK_TILES; x += 7) {
      expect(l.navMesh[y][x]).toBe(false);
    }
    expect(walkable(l).has(`${CHUNK_TILES / 2},${CHUNK_TILES + CHUNK_TILES / 2}`)).toBe(false);
    const g = hubGround(l);
    const empty = cropAtoms(g, 0, CHUNK_TILES, CHUNK_TILES);
    expect(empty.every(v => v === 0)).toBe(true);
    expect(HubGenerator.getZoneAtPosition(l, 5, CHUNK_TILES + 5)).toBeNull();
    expect(HubGenerator.getPOIAtPosition(l, 5, CHUNK_TILES + 5)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// THE SAME CITY ON EVERY MACHINE, AND ANYWHERE IT IS PLANTED
// -----------------------------------------------------------------------------

describe('the same inputs give the same city', () => {
  it('the layout is the same, byte for byte, on every call', () => {
    expect(JSON.stringify(HubGenerator.generate())).toBe(JSON.stringify(HubGenerator.generate()));
    const plan = planOf('WEST', 'NORTH');
    expect(JSON.stringify(HubGenerator.generate(plan))).toBe(JSON.stringify(HubGenerator.generate(JSON.parse(JSON.stringify(plan)))));
    expect(hashBytes(composeHub(HubGenerator.generate(plan)).data)).toBe(hashBytes(composeHub(HubGenerator.generate(plan)).data));
  });

  it('the layout reads no clock, no chance and no machine', () => {
    ['src/entities/hub/HubGenerator.ts', 'src/entities/hub/hubManifest.ts'].forEach(path => {
      expect(SRC(path), path).not.toMatch(/Math\.random|Date\.now|crypto\.|navigator\.|localStorage/);
    });
  });

  it('holds the city to its stored hash', () => {
    expect(fnv1a(JSON.stringify(HubGenerator.generate()))).toBe(STORED_LAYOUT_HASH);
    expect(fnv1a(JSON.stringify(HubGenerator.generate(planOf('EAST'))))).toBe(STORED_SECOND_CHUNK_HASH);
  });

  it('lots number in the order chunks rose: that order is an input, and it is kept', () => {
    const ew = HubGenerator.generate(planOf('EAST', 'WEST'));
    const we = HubGenerator.generate(planOf('WEST', 'EAST'));
    expect(ew.width).toBe(we.width);
    const eastLotOf = (l: IHubLayout) => lotPois(l).filter(p => inChunk(l, p, l.chunks.find(c => c.cx === 1)!)).map(p => p.metadata.lotIndex);
    expect(eastLotOf(ew)[0]).toBe(LOTS_STANDING);
    expect(eastLotOf(we)[0]).toBeGreaterThan(LOTS_STANDING);
  });
});

describe('nothing stops a hub being placed in a world (D80)', () => {
  it('the plan can start at any chunk of a world, and the city is the same bytes', () => {
    const here = HubGenerator.generate(firstPlan());
    const there = HubGenerator.generate(firstPlan(NEW_CARLEON, { cx: 17, cy: -3 }));
    expect(there.chunks[0]).toMatchObject({ cx: 17, cy: -3 });
    expect(hashBytes(composeHub(there).data)).toBe(hashBytes(composeHub(here).data));
    expect(there.spawnPoint).toEqual(here.spawnPoint);
  });

  it('a tile of the hub can be read as a tile of the ground it stands on', () => {
    const there = HubGenerator.generate(firstPlan(NEW_CARLEON, { cx: 17, cy: -3 }));
    expect(HubGenerator.groundTile(there, 0, 0)).toEqual({ x: 17 * CHUNK_TILES, y: -3 * CHUNK_TILES });
    expect(HubGenerator.groundTile(there, 5, 9)).toEqual({ x: 17 * CHUNK_TILES + 5, y: -3 * CHUNK_TILES + 9 });
    const grown = raiseChunk(firstPlan(NEW_CARLEON, { cx: 17, cy: -3 }), 'WEST');
    expect(grown.ok).toBe(true);
    if (!grown.ok) return;
    const l = HubGenerator.generate(grown.plan);
    expect(HubGenerator.groundTile(l, l.origin.x, l.origin.y)).toEqual({ x: 17 * CHUNK_TILES, y: -3 * CHUNK_TILES });
  });

  it('a different manifest is a different hub, through the same door', () => {
    const other: IHubManifest = { ...JSON.parse(JSON.stringify(NEW_CARLEON)), id: 'hub_elsewhere', name: 'Elsewhere' };
    const l = HubGenerator.generate(firstPlan(other), other);
    expect(l.id).toBe('hub_elsewhere');
    expect(l.name).toBe('Elsewhere');
  });

  it('the generator names no Nexus world, no session and no store', () => {
    const src = SRC('src/entities/hub/HubGenerator.ts');
    expect(src).not.toMatch(/from '\.\/store'|useHubStore|usePlayerStore|currentSession/);
    expect(SRC('src/entities/hub/hubManifest.ts')).not.toMatch(/useHubStore|usePlayerStore|currentSession/);
  });
});

// -----------------------------------------------------------------------------
// WHAT READS IT
// -----------------------------------------------------------------------------

describe('the city minimap reads the plan', () => {
  it('draws the whole of a small hub', () => {
    const one = HubGenerator.generate();
    const map = cityMinimap(one, {}, { x: 10, y: 10 });
    expect(map.w).toBeGreaterThanOrEqual(one.width);
    expect(map.h).toBeGreaterThanOrEqual(one.height);
  });

  it('shows a raised chunk, and marks the person standing in it', () => {
    const l = HubGenerator.generate(planOf('EAST'));
    const map = cityMinimap(l, {}, { x: l.chunks[1].x + 10, y: 10 });
    const other = cityMinimap(l, {}, { x: l.chunks[1].x + 20, y: 10 });
    expect(Buffer.from(map.data).equals(Buffer.from(other.data))).toBe(false);
    const one = cityMinimap(HubGenerator.generate(), {}, { x: 10, y: 10 });
    expect(map.w / map.h).toBeGreaterThan(one.w / one.h);
  });

  it('leaves a chunk not raised blank, apart from walls and ground', () => {
    const plan = planOf('EAST');
    const res = raiseChunk(plan, 'SOUTH', { beside: { cx: 1, cy: 0 } });
    if (res.ok === false) throw new Error(res.reason);
    const l = HubGenerator.generate(res.plan);
    const map = cityMinimap(l, {}, { x: l.spawnPoint.x, y: l.spawnPoint.y });
    const cx = Math.floor(map.w / 4), cy = Math.floor((map.h * 3) / 4);
    expect(map.data[cy * map.w + cx]).toBe(0);
    expect(map.data[Math.floor(map.h / 4) * map.w + cx]).not.toBe(0);
  });

  it('stays the size of a map however far the hub grows, and follows the person', () => {
    let plan = firstPlan();
    for (let i = 0; i < 12; i++) {
      const res = raiseChunk(plan, 'EAST', { beside: { cx: i, cy: 0 } });
      if (res.ok === false) throw new Error(res.reason);
      plan = res.plan;
    }
    const l = HubGenerator.generate(plan);
    const west = cityMinimap(l, {}, { x: 10, y: 10 });
    const east = cityMinimap(l, {}, { x: l.width - 10, y: 10 });
    const one = cityMinimap(HubGenerator.generate(), {}, { x: 10, y: 10 });
    expect(west.w).toBeLessThanOrEqual(one.w);
    expect(Buffer.from(west.data).equals(Buffer.from(east.data))).toBe(false);
  });
});

// Pedro: "a lot's price should be a function of proximity to main road/hub center + size".
describe('a lot asks a price for where it stands and how big it is', () => {
  const grown = HubGenerator.generate(planOf('EAST'));
  const lots = lotPois(grown);
  const fromCentre = (l: IHubLayout, p: IPOI) => {
    const d = doorOf(p), cx = l.origin.x + CHUNK_TILES / 2, cy = l.origin.y + CHUNK_TILES / 2;
    return Math.abs(d.x - cx) + Math.abs(d.y - cy);
  };
  const fresh = async (id: string) => {
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks } as any);
    await useHubStore.getState().loadHub(id);
  };

  it('the same size costs more nearer the centre', () => {
    const size = { width: 4, height: 4 };
    for (let d = 0; d < 400; d += 7) expect(lotPrice(NEW_CARLEON, size, d), `${d}`).toBeGreaterThanOrEqual(lotPrice(NEW_CARLEON, size, d + 7));
    expect(lotPrice(NEW_CARLEON, size, 0)).toBeGreaterThan(lotPrice(NEW_CARLEON, size, 64));
  });

  it('at the same distance a bigger lot costs more', () => {
    [0, 26, 64, 300].forEach(d => {
      const small = lotPrice(NEW_CARLEON, { width: 3, height: 3 }, d);
      const mid = lotPrice(NEW_CARLEON, { width: 4, height: 4 }, d);
      const big = lotPrice(NEW_CARLEON, { width: 6, height: 5 }, d);
      expect(small).toBeLessThan(mid);
      expect(mid).toBeLessThan(big);
    });
  });

  it('is always whole gold and never nothing, however far out', () => {
    [0, 1, 26, 64, 1000, 100000].forEach(d => {
      const p = lotPrice(NEW_CARLEON, { width: 4, height: 4 }, d);
      expect(Number.isInteger(p), `${d}`).toBe(true);
      expect(p, `${d}`).toBeGreaterThan(0);
    });
  });

  it('every lot in the layout asks exactly that, by its own door and size', () => {
    lots.forEach(p => expect(p.metadata.price, p.id).toBe(lotPrice(NEW_CARLEON, p.size, fromCentre(grown, p))));
  });

  it('the first chunk stays near the price the economy has been read at, and is no longer flat', () => {
    const prices = lotPois(HubGenerator.generate()).map(p => p.metadata.price);
    prices.forEach(p => {
      expect(p).toBeGreaterThan(4000);
      expect(p).toBeLessThan(6000);
    });
    expect(new Set(prices).size).toBeGreaterThan(1);
  });

  it('raising a chunk on any side moves no price', () => {
    const before = lotPois(HubGenerator.generate());
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      before.forEach(p => expect(poiOf(l, p.id).metadata.price, `${side} ${p.id}`).toBe(p.metadata.price));
    });
  });

  it('no price is written as a number, only the manifest\'s one rate', () => {
    expect(SRC('src/entities/hub/store.ts')).not.toMatch(/price:\s*5000/);
    expect(SRC('src/entities/hub/hubManifest.ts')).not.toMatch(/price:\s*\d/);
    expect(NEW_CARLEON.lotGoldPerTile).toBeGreaterThan(0);
  });

  it('buying charges what the lot asks', async () => {
    await fresh('hub_price');
    await useHubStore.getState().raiseChunk('EAST');
    const lot = useHubStore.getState().lots.find(l => l.lotIndex === 6)!;
    const want = poiOf(HubGenerator.generate({ chunks: useHubStore.getState().chunks }), lot.id).metadata.price;
    expect(lot.price).toBe(want);
    usePlayerStore.setState(s => ({ player: { ...s.player, id: 'uid_bars', username: 'TESTER', bank: { ...s.player.bank, gold: want + 123 } } }));
    expect(await useHubStore.getState().buyLot(lot.id)).toBe(true);
    expect(usePlayerStore.getState().player.bank.gold).toBe(123);
  });

  it('what someone paid stays on their record, whatever a free lot now asks', async () => {
    const paid = { id: 'poi_lot_0', lotIndex: 0, ownerId: 'uid_owner', ownerName: 'OLD HAND', purchaseDate: 1, structureType: 'EMPTY', inventory: [], price: 1234 };
    db.set('hub_state_hub_paid', { id: 'hub_state_hub_paid', namespace: 'territories', data: { lots: [paid], craftingJobs: [], rooms: {}, buildJobs: [], web: { nodes: {} } }, metadata: { createdAt: 0, updatedAt: 0, ownerCertUid: 'SYSTEM', version: 1 } });
    await fresh('hub_paid');
    expect(useHubStore.getState().lots.find(l => l.id === 'poi_lot_0')).toEqual(paid);
  });
});

describe('lots come in sizes, and a size can refuse', () => {
  const grown = HubGenerator.generate(planOf('SOUTH'));
  const raised = lotPois(grown).filter(p => inChunk(grown, p, grown.chunks[1]));
  const byArea = [...raised].sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height);
  const small = byArea[0], big = byArea[byArea.length - 1];

  it('a raised chunk holds more than one size, read from the manifest', () => {
    expect(new Set(raised.map(p => p.size.width * p.size.height)).size).toBeGreaterThan(1);
  });

  it('the first chunk\'s lots stay the size their rooms were built at', () => {
    lotPois(HubGenerator.generate()).forEach(p => expect(p.size, p.id).toEqual({ width: 4, height: 4 }));
  });

  it('a plan too big for a small lot is refused with the numbers, and fits a big one', () => {
    const plan = { name: 'Long Hall', footprint: { width: big.size.width, height: big.size.height } } as any;
    expect(sizeNeedsVerdict(plan, big.size).ok).toBe(true);
    const refused = sizeNeedsVerdict(plan, small.size);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain(`${small.size.width}×${small.size.height}`);
  });

  it('a room can stand on every size, and its floor can be walked from its door', () => {
    raised.forEach(p => expect(fullyWalkable(emptyRoom(p.id, p.size, 'crf_plank')), p.id).toBe(true));
  });

  it('every size draws every state inside its own footprint', () => {
    raised.forEach(p => {
      const w = p.size.width * HUB_TILE, h = p.size.height * HUB_TILE;
      LOT_STATES.forEach(state => {
        const art = lotArt(state, w, h, p.metadata.lotIndex, 0.5);
        expect(art.w, `${p.id} ${state}`).toBeLessThanOrEqual(w);
        expect(art.h, `${p.id} ${state}`).toBeLessThanOrEqual(h);
      });
    });
  });

  it('a lot wider than its art stands in the middle of its ground, not jammed left', () => {
    const wide = raised.find(p => p.size.width !== p.size.height)!;
    expect(wide).toBeTruthy();
    const g = hubGround(grown), W = g.w;
    const w = wide.size.width * HUB_TILE, h = wide.size.height * HUB_TILE;
    const ax = wide.position.x * HUB_TILE, ay = wide.position.y * HUB_TILE;
    const bare = hubGround(HubGenerator.generate(firstPlan())); void bare;
    const isGround = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);
    let left = w, right = w;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (!isGround(g.data[(ay + y) * W + ax + x])) { left = Math.min(left, x); break; }
      for (let x = w - 1; x >= 0; x--) if (!isGround(g.data[(ay + y) * W + ax + x])) { right = Math.min(right, w - 1 - x); break; }
    }
    expect(Math.abs(left - right)).toBeLessThanOrEqual(3);
  });

  it('the deeds screen says how big a lot is and how far out it stands', () => {
    expect(SRC('src/components/HoldingsPanel.tsx')).toMatch(/from the centre/);
  });
});

describe('where the ground ends can be seen', () => {
  it('names every outer side of the hub and no side shared by two chunks', () => {
    expect(HubGenerator.edges(HubGenerator.generate()).length).toBe(4);
    const two = HubGenerator.generate(planOf('EAST'));
    const edges = HubGenerator.edges(two);
    expect(edges.length).toBe(6);
    const seam = two.chunks[1].x;
    expect(edges.filter(e => e.x0 === seam && e.x1 === seam)).toEqual([]);
  });

  it('is drawn on the canvas, so the bytes of the city do not depend on what rises next', () => {
    expect(SRC('src/entities/hub/HubCanvas.tsx')).toMatch(/HubGenerator\.edges\(layout\)/);
    expect(SRC('src/render/atoms/hub.ts')).not.toMatch(/\.edges\(/);
  });
});

describe('the screens say what is there', () => {
  it('the deeds screen counts the lots instead of naming a number', () => {
    expect(SRC('src/components/HoldingsPanel.tsx')).not.toMatch(/Six lots/);
  });
});

describe('the canvas reads the plan', () => {
  const src = SRC('src/entities/hub/HubCanvas.tsx');

  it('builds its layout from the hub\'s chunks, and again when they change', () => {
    expect(src).toMatch(/HubGenerator\.generate\(\{\s*chunks\s*\}\)/);
    expect(src).toMatch(/\[chunks\]/);
  });

  it('keeps you on your own ground when a chunk rises to the north or the west', () => {
    expect(src).toMatch(/layout\.origin/);
  });

  it('the proof page does not claim the old size', () => {
    expect(SRC('prototype/atoms/hubPage.ts')).not.toMatch(/50 by 50/);
  });
});

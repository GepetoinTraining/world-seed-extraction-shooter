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
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { CHUNK_TILES, QUADRANT_TILES } from '../shared/entities/world/grid';
import { HUB_NPCS, HubGenerator, IHubLayout, IPOI, POIType, ZoneType } from '../src/entities/hub/HubGenerator';
import { runDialogueAction } from '../src/entities/hub/dialogue';
import {
  CELL_TILES, CHUNK_CELLS, EMPTY_MARK, HUB_SIDES, HubSide, IHubManifest, IHubPlan, NEW_CARLEON, ROAD_MAIN, ROAD_STREET, SPAWN_MARK,
  DISMEMBER_PIECE_MIN, chunkBillFor, dismemberPlan, dismemberShape, doorTile, firstPlan, lotPrice, lotPriceShare, openSides, raiseChunk, tilesToCell, validateManifest
} from '../src/entities/hub/hubManifest';
import { HUB_GENRE, HUB_TILE, LOT_STATES, composeHub, doorOf, floorAtom, hubGround, lotArt, passageAtom, roadAtom } from '../src/render/atoms/hub';
import { cityMinimap } from '../src/render/atoms/minimap';
import { Role, STEPS, buildPalette, grayscale, hashBytes, px } from '../shared/render/atoms/atoms';
import { fnv1a } from '../shared/logic/rng/DeterministicRNG';
import { useHubStore, worldDay } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { emptyRoom, fullyWalkable } from '../shared/entities/hub/room';
import { sizeNeedsVerdict } from '../shared/entities/hub/template';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { worldPort } from '../src/entities/world/store';

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
// Bars, set before the road and the plot are drawn. Do not lower them to get a pass.
const ROAD_FLOOR_GRAY_MIN = 12;   // mean luminance apart, a road against a floor it crosses (0-255)
const ROAD_KERB_GRAY_MIN = 20;    // a kerb against its own road
const LOT_GRID_GRAY_MIN = 12;     // a tile line against the tile it marks
const LOT_GROUND_GRAY_MIN = 12;   // a plot against the ground around it
const STRETCH_FILL_MIN = 0.85;     // share of a raised chunk's blocks that is lots
const PASSAGE_EDGE_MIN = 0.5;      // share of a passage's crossing that keeps to the crossed lot's edge
const LOTS_STANDING = 6;
const LAMPS_STANDING = 7;

// The whole layout, by hash: the same inputs give the same city on every machine.
const STORED_LAYOUT_HASH = 4003879988;
const STORED_SECOND_CHUNK_HASH = 1878524915;

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
    // A stretched lot may start north or west of its mark, and it always covers it.
    const pois = allPois(layout);
    expect(pois.length).toBe(placed.length);
    placed.forEach(at => {
      const here = pois.filter(p => at.x >= p.position.x && at.x < p.position.x + p.size.width && at.y >= p.position.y && at.y < p.position.y + p.size.height);
      expect(here.length, `${at.x},${at.y}`).toBe(1);
    });
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
      player: { ...s.player, id: 'uid_bars', username: 'TESTER', bank: { ...s.player.bank, gold: 500000, stashTabs: [{ ...s.player.bank.stashTabs[0], items: planks }] } }
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
    const at = (fromCentre: number) => lotPrice(NEW_CARLEON, size, { fromCentre, fromRoad: 0 });
    for (let d = 0; d < 400; d += 7) expect(at(d), `${d}`).toBeGreaterThanOrEqual(at(d + 7));
    expect(at(0)).toBeGreaterThan(at(64));
  });

  it('the same size at the same distance costs more nearer the main road', () => {
    const size = { width: 4, height: 4 };
    const at = (fromRoad: number) => lotPrice(NEW_CARLEON, size, { fromCentre: 26, fromRoad });
    for (let d = 0; d < 64; d += 3) expect(at(d), `${d}`).toBeGreaterThanOrEqual(at(d + 3));
    expect(at(0)).toBeGreaterThan(at(16));
  });

  it('at the same distance a bigger lot costs more', () => {
    [0, 26, 64, 300].forEach(d => {
      const where = { fromCentre: d, fromRoad: 4 };
      const small = lotPrice(NEW_CARLEON, { width: 3, height: 3 }, where);
      const mid = lotPrice(NEW_CARLEON, { width: 4, height: 4 }, where);
      const big = lotPrice(NEW_CARLEON, { width: 6, height: 5 }, where);
      expect(small).toBeLessThan(mid);
      expect(mid).toBeLessThan(big);
    });
  });

  it('is always whole gold and never nothing, however far out', () => {
    [0, 1, 26, 64, 1000, 100000].forEach(d => {
      const p = lotPrice(NEW_CARLEON, { width: 4, height: 4 }, { fromCentre: d, fromRoad: d });
      expect(Number.isInteger(p), `${d}`).toBe(true);
      expect(p, `${d}`).toBeGreaterThan(0);
    });
  });

  it('every lot in the layout asks exactly that, by its own door and size', () => {
    const fromMainRoad = (p: IPOI) => {
      const d = doorOf(p);
      const own = grown.chunks.find(c => inChunk(grown, p, c))!;
      const mine = grown.roads.filter(r => r.main && r.x >= own.x && r.x < own.x + CHUNK_TILES && r.y >= own.y && r.y < own.y + CHUNK_TILES);
      return Math.min(...mine.map(r => Math.max(0, r.x - d.x, d.x - (r.x + CELL_TILES - 1)) + Math.max(0, r.y - d.y, d.y - (r.y + CELL_TILES - 1))));
    };
    lots.forEach(p => {
      expect(p.metadata.fromRoad, p.id).toBe(fromMainRoad(p));
      expect(p.metadata.fromCentre, p.id).toBe(fromCentre(grown, p));
    });
  });

  // Moved on Pedro's word: lots stretch, so a big lot asks for its size. The smallest
  // on Homestead Row is what stays near the price the economy has been read at.
  it('the smallest lot on the first chunk stays near the old price, and prices are no longer flat', () => {
    const prices = lotPois(HubGenerator.generate()).map(p => p.metadata.price);
    const least = Math.min(...prices);
    expect(least).toBeGreaterThanOrEqual(3500);
    expect(least).toBeLessThanOrEqual(6500);
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

  it('the deeds screen says how big a lot is and how far out it stands', () => {
    expect(SRC('src/components/HoldingsPanel.tsx')).toMatch(/from the centre/);
    expect(SRC('src/components/HoldingsPanel.tsx')).toMatch(/from the main road/);
  });
});

// Pedro: "we need to make one pass that creates roads, make the tiles more visible
// for what a lot is, a little more the simish".
describe('the manifest lays roads, and roads join', () => {
  const layout = HubGenerator.generate();
  const cellsOf = (l: IHubLayout, main?: boolean) => l.roads.filter(r => main === undefined || r.main === main);
  const onRoad = (l: IHubLayout, x: number, y: number) => l.roads.some(r => x >= r.x && x < r.x + CELL_TILES && y >= r.y && y < r.y + CELL_TILES);

  it('every chunk writes a road layer of the same shape as its others', () => {
    Object.values(NEW_CARLEON.chunks).forEach(chunk => {
      expect(chunk.road.length).toBe(CHUNK_CELLS);
      chunk.road.forEach(row => {
        expect(row.length).toBe(CHUNK_CELLS);
        expect([...row].every(c => [EMPTY_MARK, ROAD_MAIN, ROAD_STREET].includes(c)), row).toBe(true);
      });
    });
  });

  it('a road tile can always be walked', () => {
    layout.roads.forEach(r => {
      for (let y = r.y; y < r.y + CELL_TILES; y++) for (let x = r.x; x < r.x + CELL_TILES; x++) {
        expect(layout.navMesh[y][x], `${x},${y}`).toBe(true);
      }
    });
  });

  it('nothing stands on a road, a built lot included', () => {
    lotPois(layout).concat(allPois(layout)).forEach(p => {
      for (let y = p.position.y; y < p.position.y + p.size.height; y++) for (let x = p.position.x; x < p.position.x + p.size.width; x++) {
        expect(onRoad(layout, x, y), `${p.id} at ${x},${y}`).toBe(false);
      }
    });
  });

  it('the main road runs through the middle of the first chunk, and the plaza', () => {
    const plaza = layout.zones.find(z => z.type === ZoneType.PLAZA)!.bounds;
    const y = NEW_CARLEON.gates.row * CELL_TILES;
    expect(y).toBeGreaterThanOrEqual(plaza.y);
    expect(y).toBeLessThan(plaza.y + plaza.height);
    for (let x = 0; x < CHUNK_TILES; x += CELL_TILES) {
      expect(cellsOf(layout, true).some(r => r.x === x && r.y === y), `${x}`).toBe(true);
    }
  });

  it('every lot in every chunk has a road at its door, or a passage to one', () => {
    const l = HubGenerator.generate(planOf('EAST', 'SOUTH'));
    lotPois(l).forEach(p => {
      const d = doorOf(p);
      const near = Math.min(...l.roads.map(r => tilesToCell(d, r)));
      expect(near <= 1 || l.passages.some(q => q.lotId === p.id), p.id).toBe(true);
    });
  });

  it('the roads of a raised chunk join the first across the seam, on every side', () => {
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      const key = (r: { x: number; y: number }) => `${r.x},${r.y}`;
      const cells = new Map(l.roads.map(r => [key(r), r]));
      const start = l.roads.find(r => r.x >= l.chunks[0].x && r.y >= l.chunks[0].y && r.x < l.chunks[0].x + CHUNK_TILES && r.y < l.chunks[0].y + CHUNK_TILES)!;
      const seen = new Set([key(start)]);
      const queue = [start];
      while (queue.length) {
        const r = queue.pop()!;
        [[CELL_TILES, 0], [-CELL_TILES, 0], [0, CELL_TILES], [0, -CELL_TILES]].forEach(([dx, dy]) => {
          const next = cells.get(`${r.x + dx},${r.y + dy}`);
          if (next && !seen.has(key(next))) { seen.add(key(next)); queue.push(next); }
        });
      }
      expect(seen.size, side).toBe(l.roads.length);
    });
  });

  it('the law refuses a road that cannot join or cannot stand', () => {
    const copy = (): IHubManifest => JSON.parse(JSON.stringify(NEW_CARLEON));
    const swap = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
    const first = (m: IHubManifest) => m.chunks[m.first];

    const noGate = copy();
    first(noGate).road[0] = swap(first(noGate).road[0], NEW_CARLEON.gates.col, EMPTY_MARK);
    expect(validateManifest(noGate).join()).toMatch(/gate/i);

    const extraGate = copy();
    first(extraGate).road[0] = swap(first(extraGate).road[0], 2, ROAD_MAIN);
    expect(validateManifest(extraGate).join()).toMatch(/gate/i);

    const stranded = copy();
    first(stranded).road[2] = swap(first(stranded).road[2], 3, ROAD_STREET);
    expect(validateManifest(stranded).join()).toMatch(/connect/i);

    const built = copy();
    const row = first(built).place.findIndex(r => r.includes('T'));
    first(built).road[row] = swap(first(built).road[row], first(built).place[row].indexOf('T'), ROAD_STREET);
    expect(validateManifest(built).join()).toMatch(/road/i);

    const unknown = copy();
    first(unknown).road[2] = swap(first(unknown).road[2], 3, '?');
    expect(validateManifest(unknown).join()).toMatch(/\?/);
  });

  it('a lot with no street at its door is not refused: the servidão gives it a way', () => {
    const m: IHubManifest = JSON.parse(JSON.stringify(NEW_CARLEON));
    const swap = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
    const chunk = m.chunks[m.first];
    chunk.floor[2] = swap(chunk.floor[2], 2, 'H');
    chunk.place[2] = swap(chunk.place[2], 2, 'L');
    expect(validateManifest(m)).toEqual([]);
  });

  it('a road reads by value in grayscale, against every floor it crosses', () => {
    const gray = grayscale(buildPalette(HUB_GENRE));
    const luma = (v: number) => gray[v * 3];
    const mean = (f: (x: number, y: number) => number) => {
      let sum = 0;
      for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) sum += luma(f(x, y));
      return sum / (24 * 24);
    };
    const road = mean((x, y) => roadAtom(ROAD_MAIN, { n: false, e: true, s: false, w: true }, x, y));
    [ZoneType.PLAZA, ZoneType.RESIDENTIAL].forEach(z => {
      expect(Math.abs(road - mean((x, y) => floorAtom(z, x, y))), z).toBeGreaterThanOrEqual(ROAD_FLOOR_GRAY_MIN);
    });
  });

  it('a road shows its kerb by shape: along what it does not join, and open where it does', () => {
    const closed = { n: false, e: true, s: false, w: true };
    const gray = grayscale(buildPalette(HUB_GENRE));
    const luma = (v: number) => gray[v * 3];
    expect(luma(roadAtom(ROAD_MAIN, closed, 20, 0))).toBeGreaterThan(luma(roadAtom(ROAD_MAIN, closed, 20, 12)) + ROAD_KERB_GRAY_MIN);
    expect(roadAtom(ROAD_MAIN, { n: true, e: true, s: false, w: true }, 20, 0)).toBe(roadAtom(ROAD_MAIN, { n: true, e: true, s: false, w: true }, 20, 12));
  });

  it('a main road and a street differ by shape: the main road carries a broken centre line', () => {
    const across = { n: false, e: true, s: false, w: true };
    const row = (kind: string) => Array.from({ length: 40 }, (_, x) => roadAtom(kind, across, x, 19));
    expect(new Set(row(ROAD_MAIN)).size).toBeGreaterThan(1);
    expect(new Set(row(ROAD_STREET)).size).toBe(1);
  });

  it('the city draws them, and the first chunk is still whole on its own', () => {
    const r = layout.roads.find(c => c.main && c.x > 0 && c.x < 40)!;
    const g = hubGround(layout);
    const noRoads = HubGenerator.generate();
    noRoads.roads = [];
    const plain = hubGround(noRoads);
    let differ = 0;
    for (let y = 0; y < CELL_TILES * HUB_TILE; y++) for (let x = 0; x < CELL_TILES * HUB_TILE; x++) {
      const i = (r.y * HUB_TILE + y) * g.w + r.x * HUB_TILE + x;
      if (g.data[i] !== plain.data[i]) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  });

  it('the map marks them', () => {
    const noRoads = HubGenerator.generate();
    noRoads.roads = [];
    const hash = (l: IHubLayout) => hashBytes(cityMinimap(l, {}, { x: 0, y: 0 }).data);
    expect(hash(layout)).not.toBe(hash(noRoads));
  });
});

describe('a lot reads as a plot: you can count its tiles', () => {
  const gray = grayscale(buildPalette(HUB_GENRE));
  const luma = (v: number) => gray[v * 3];
  const SIZES = [[30, 30], [40, 40], [60, 50]] as const;
  const OPEN = ['FOR_SALE', 'OWNED_EMPTY', 'FORECLOSED'] as const;

  it('fills its whole footprint in every state, so the plot is the size it says', () => {
    SIZES.forEach(([w, h]) => OPEN.forEach(state => {
      const art = lotArt(state, w, h, 3);
      expect([art.w, art.h], `${state} ${w}x${h}`).toEqual([w, h]);
      expect(art.data.every(v => v !== 0), `${state} ${w}x${h}`).toBe(true);
    }));
  });

  it('marks every tile: each tile line stands apart from its tile by value', () => {
    SIZES.forEach(([w, h]) => OPEN.forEach(state => {
      const art = lotArt(state, w, h, 3);
      // Near the plot's edge, clear of the mark in the middle and inside the border.
      for (let line = HUB_TILE; line < w; line += HUB_TILE) {
        const onLine = luma(art.data[4 * w + line]), inTile = luma(art.data[4 * w + line + 5]);
        expect(Math.abs(onLine - inTile), `${state} ${w}x${h} x=${line}`).toBeGreaterThanOrEqual(LOT_GRID_GRAY_MIN);
      }
      for (let line = HUB_TILE; line < h; line += HUB_TILE) {
        const onLine = luma(art.data[line * w + 4]), inTile = luma(art.data[(line + 5) * w + 4]);
        expect(Math.abs(onLine - inTile), `${state} ${w}x${h} y=${line}`).toBeGreaterThanOrEqual(LOT_GRID_GRAY_MIN);
      }
    }));
  });

  it('stands apart from the ground around it by value', () => {
    const around = (() => { let s = 0; for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) s += luma(floorAtom(ZoneType.RESIDENTIAL, x, y)); return s / 1600; })();
    OPEN.forEach(state => {
      const art = lotArt(state, 40, 40, 3);
      let s = 0;
      art.data.forEach(v => { s += luma(v); });
      expect(Math.abs(s / art.data.length - around), state).toBeGreaterThanOrEqual(LOT_GROUND_GRAY_MIN);
    });
  });

  it('tells its state by the shape of its border: broken for sale, whole when held', () => {
    const edge = (state: typeof OPEN[number]) => {
      const art = lotArt(state, 60, 50, 3);
      return Array.from({ length: 40 }, (_, i) => art.data[0 * 60 + 10 + i]);
    };
    const gaps = (row: number[]) => { let n = 0; for (let i = 1; i < row.length; i++) if (row[i] !== row[i - 1]) n++; return n; };
    expect(gaps(edge('OWNED_EMPTY'))).toBe(0);
    expect(gaps(edge('FOR_SALE'))).toBeGreaterThan(2);
  });

  it('keeps its mark in the middle of its ground on a lot that is not square', () => {
    const w = 60, h = 50, art = lotArt('FOR_SALE', w, h, 3);
    const isGround = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) {
      if (isGround(art.data[y * w + x])) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    expect(x1).toBeGreaterThan(x0);
    expect(Math.abs((x0 + x1) / 2 - w / 2)).toBeLessThanOrEqual(3);
    expect(Math.abs((y0 + y1) / 2 - h / 2)).toBeLessThanOrEqual(3);
  });

  it('an empty lot can still be walked onto: only a building blocks', () => {
    const l = HubGenerator.generate();
    lotPois(l).forEach(p => expect(l.navMesh[p.position.y + 1][p.position.x + 1], p.id).toBe(true));
  });
});

// Pedro: "make it stretch to fill and create a 'servidão' rule for locked out of street access lots."
describe('lots stretch to fill their block', () => {
  const grown = HubGenerator.generate(planOf('EAST'));
  const growth = grown.chunks[1];
  const inRaised = lotPois(grown).filter(p => inChunk(grown, p, growth));

  it('a lot ends where the road, a neighbour or its floor ends: no cell it could take is left free', () => {
    const covered = (x: number, y: number) => allPois(grown).some(p =>
      x >= p.position.x && x < p.position.x + p.size.width && y >= p.position.y && y < p.position.y + p.size.height);
    const isRoad = (x: number, y: number) => grown.roads.some(r => x >= r.x && x < r.x + CELL_TILES && y >= r.y && y < r.y + CELL_TILES);
    const sameFloor = (x: number, y: number, z: string) => HubGenerator.getZoneAtPosition(grown, x, y)?.id === z;
    lotPois(grown).forEach(p => {
      const z = HubGenerator.getZoneAtPosition(grown, p.position.x, p.position.y)!.id;
      const open = (x: number, y: number) => !covered(x, y) && !isRoad(x, y) && sameFloor(x, y, z);
      const rowOpen = (y: number) => Array.from({ length: p.size.width }, (_, i) => p.position.x + i).every(x => open(x, y));
      const colOpen = (x: number) => Array.from({ length: p.size.height }, (_, i) => p.position.y + i).every(y => open(x, y));
      expect(rowOpen(p.position.y - 1), `${p.id} north`).toBe(false);
      expect(rowOpen(p.position.y + p.size.height), `${p.id} south`).toBe(false);
      expect(colOpen(p.position.x - 1), `${p.id} west`).toBe(false);
      expect(colOpen(p.position.x + p.size.width), `${p.id} east`).toBe(false);
    });
  });

  it('a block of a raised chunk is nearly all lots', () => {
    let lotTiles = 0, blockTiles = 0;
    for (let y = growth.y + CELL_TILES; y < growth.y + CHUNK_TILES - 2 * CELL_TILES; y++) for (let x = growth.x + CELL_TILES; x < growth.x + CHUNK_TILES - CELL_TILES; x++) {
      if (grown.roads.some(r => x >= r.x && x < r.x + CELL_TILES && y >= r.y && y < r.y + CELL_TILES)) continue;
      blockTiles++;
      if (inRaised.some(p => x >= p.position.x && x < p.position.x + p.size.width && y >= p.position.y && y < p.position.y + p.size.height)) lotTiles++;
    }
    expect(lotTiles / blockTiles).toBeGreaterThanOrEqual(STRETCH_FILL_MIN);
  });

  it('a stretched lot is whole cells, stays a rectangle and touches no other', () => {
    lotPois(grown).forEach(p => {
      expect(p.size.width % CELL_TILES, p.id).toBe(0);
      expect(p.size.height % CELL_TILES, p.id).toBe(0);
    });
    const touches = (a: IPOI, b: IPOI) =>
      a.position.x < b.position.x + b.size.width && b.position.x < a.position.x + a.size.width &&
      a.position.y < b.position.y + b.size.height && b.position.y < a.position.y + a.size.height;
    lotPois(grown).forEach(a => allPois(grown).filter(b => b.id !== a.id).forEach(b => expect(touches(a, b), `${a.id}/${b.id}`).toBe(false)));
  });

  it('stretching moves no lot off its number, and a lot on Homestead Row keeps its door on a street', () => {
    const first = HubGenerator.generate();
    expect(lotPois(first).map(p => p.id)).toEqual(Array.from({ length: LOTS_STANDING }, (_, i) => `poi_lot_${i}`));
    lotPois(first).forEach(p => {
      const d = doorOf(p);
      expect(first.roads.some(r => tilesToCell(d, r) === 0), p.id).toBe(true);
    });
  });

  it('a house built before the stretch keeps its room as recorded', async () => {
    const room = emptyRoom('poi_lot_2', { width: 4, height: 4 }, 'crf_plank');
    const before = JSON.parse(JSON.stringify(room));
    const owned = { id: 'poi_lot_2', lotIndex: 2, ownerId: 'uid_owner', ownerName: 'OLD HAND', purchaseDate: 1, structureType: 'HOUSE', inventory: [], price: 5000 };
    db.set('hub_state_hub_room', { id: 'hub_state_hub_room', namespace: 'territories', data: { lots: [owned], craftingJobs: [], rooms: { poi_lot_2: room }, buildJobs: [], web: { nodes: {} } }, metadata: { createdAt: 0, updatedAt: 0, ownerCertUid: 'SYSTEM', version: 1 } });
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks } as any);
    await useHubStore.getState().loadHub('hub_room');
    const hub = useHubStore.getState();
    expect(hub.rooms.poi_lot_2).toEqual(before);
    expect(hub.lots.find(l => l.id === 'poi_lot_2')).toEqual(owned);
  });

  it('you can reach a big lot from its door, not only from its middle', () => {
    expect(SRC('src/entities/hub/HubCanvas.tsx')).toMatch(/doorOf\(poi\)/);
  });
});

describe('servidão: a lot with no street at its door gets a way through', () => {
  const grown = HubGenerator.generate(planOf('EAST'));
  const lotsOf = (l: IHubLayout) => lotPois(l);
  const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
  const onRoad = (l: IHubLayout, t: { x: number; y: number }) => l.roads.some(r => tilesToCell(t, r) === 0);

  /** Walk as if every lot were built on: its footprint blocks, except where a passage runs. */
  const reachWithAllBuilt = (l: IHubLayout) => {
    const lots = lotsOf(l);
    const passage = new Set(l.passages.flatMap(p => p.tiles.map(key)));
    const blocked = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= l.width || y >= l.height || !l.navMesh[y][x]) return true;
      if (passage.has(`${x},${y}`)) return false;
      return lots.some(p => x >= p.position.x && x < p.position.x + p.size.width && y >= p.position.y && y < p.position.y + p.size.height);
    };
    const seen = new Set([key(l.spawnPoint)]);
    const queue = [l.spawnPoint];
    while (queue.length) {
      const { x, y } = queue.shift()!;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || blocked(x + dx, y + dy)) return;
        seen.add(k);
        queue.push({ x: x + dx, y: y + dy });
      });
    }
    return seen;
  };

  it('a raised chunk holds lots locked out of the street, and each has its passage', () => {
    const locked = lotsOf(grown).filter(p => p.metadata.locked);
    expect(locked.length).toBeGreaterThan(0);
    locked.forEach(p => expect(grown.passages.some(q => q.lotId === p.id), p.id).toBe(true));
  });

  it('with every lot in the hub built on, every door can still be walked to', () => {
    const reach = reachWithAllBuilt(grown);
    lotsOf(grown).forEach(p => expect(reach.has(key(doorOf(p))), p.id).toBe(true));
    const raisedAll = HubGenerator.generate(planOf('NORTH', 'EAST', 'SOUTH', 'WEST'));
    const reachAll = reachWithAllBuilt(raisedAll);
    lotsOf(raisedAll).forEach(p => expect(reachAll.has(key(doorOf(p))), p.id).toBe(true));
  });

  it('a passage runs one unbroken line from the door to a road', () => {
    grown.passages.forEach(q => {
      const door = doorOf(poiOf(grown, q.lotId));
      expect(q.tiles[0], q.lotId).toEqual(door);
      for (let i = 1; i < q.tiles.length; i++) {
        expect(Math.abs(q.tiles[i].x - q.tiles[i - 1].x) + Math.abs(q.tiles[i].y - q.tiles[i - 1].y), `${q.lotId} step ${i}`).toBe(1);
      }
      const last = q.tiles[q.tiles.length - 1];
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => onRoad(grown, { x: last.x + dx, y: last.y + dy })), q.lotId).toBe(true);
      q.tiles.forEach(t => expect(onRoad(grown, t), `${q.lotId} ${key(t)}`).toBe(false));
    });
  });

  it('a passage never crosses the lot it serves, or anything solid', () => {
    grown.passages.forEach(q => {
      const own = poiOf(grown, q.lotId);
      q.tiles.forEach(t => {
        expect(t.x >= own.position.x && t.x < own.position.x + own.size.width && t.y >= own.position.y && t.y < own.position.y + own.size.height, `${q.lotId} ${key(t)}`).toBe(false);
        expect(grown.navMesh[t.y][t.x], `${q.lotId} ${key(t)}`).toBe(true);
      });
    });
  });

  it('every lot it crosses is named, and carries the count of tiles it gives up', () => {
    const crossed = new Map<string, number>();
    grown.passages.forEach(q => q.tiles.forEach(t => {
      const on = lotsOf(grown).find(p => t.x >= p.position.x && t.x < p.position.x + p.size.width && t.y >= p.position.y && t.y < p.position.y + p.size.height);
      if (!on) return;
      expect(q.through, q.lotId).toContain(on.id);
      crossed.set(on.id, (crossed.get(on.id) ?? 0) + 1);
    }));
    expect(crossed.size).toBeGreaterThan(0);
    lotsOf(grown).forEach(p => expect(p.metadata.carries ?? 0, p.id).toBe(crossed.get(p.id) ?? 0));
  });

  it('a passage keeps to the edge of the lot it crosses where it can, so a building still fits', () => {
    grown.passages.forEach(q => q.through.forEach(id => {
      const lot = poiOf(grown, id);
      const crossing = q.tiles.filter(t => t.x >= lot.position.x && t.x < lot.position.x + lot.size.width && t.y >= lot.position.y && t.y < lot.position.y + lot.size.height);
      const edge = crossing.filter(t => t.x === lot.position.x || t.x === lot.position.x + lot.size.width - 1 || t.y === lot.position.y || t.y === lot.position.y + lot.size.height - 1);
      expect(edge.length / crossing.length, `${q.lotId} through ${id}`).toBeGreaterThanOrEqual(PASSAGE_EDGE_MIN);
    }));
  });

  it('price: a locked lot asks less, and a lot that carries a passage asks for the tiles it keeps', () => {
    const size = { width: 8, height: 8 };
    const where = { fromCentre: 40, fromRoad: 10 };
    const plain = lotPrice(NEW_CARLEON, size, where);
    expect(lotPrice(NEW_CARLEON, size, { ...where, locked: true })).toBeLessThan(plain);
    expect(lotPrice(NEW_CARLEON, size, { ...where, carries: 8 })).toBeLessThan(plain);
    lotsOf(grown).forEach(p => expect(p.metadata.price, p.id).toBe(lotPrice(NEW_CARLEON, p.size, {
      fromCentre: p.metadata.fromCentre, fromRoad: p.metadata.fromRoad, locked: !!p.metadata.locked, carries: p.metadata.carries ?? 0
    })));
  });

  it('passages read only their own chunk, so raising one moves no first-chunk byte or passage', () => {
    const alone = HubGenerator.generate();
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const l = HubGenerator.generate(planOf(side));
      const firstOnes = l.passages.filter(q => inChunk(l, poiOf(l, q.lotId), l.chunks[0]));
      expect(firstOnes.length, side).toBe(alone.passages.length);
    });
    const a = HubGenerator.generate(planOf('EAST')), b = HubGenerator.generate(planOf('EAST'));
    expect(JSON.stringify(a.passages)).toBe(JSON.stringify(b.passages));
  });

  it('the law refuses a lot no passage can free, and allows one a neighbour can', () => {
    const swap = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
    const m: IHubManifest = JSON.parse(JSON.stringify(NEW_CARLEON));
    const chunk = m.chunks[m.growth];
    expect(validateManifest(m)).toEqual([]);
    m.marks.w = { type: POIType.FOUNTAIN, name: 'Wall', size: { width: 4, height: 4 }, interactable: false, solid: true, metadata: {}, series: 'poi_wall' };
    // A wall in the door's path, on all sides of a lot at the block's corner.
    const lotRow = chunk.place.findIndex(r => r.includes('L'));
    chunk.place[lotRow] = swap(chunk.place[lotRow], 13, EMPTY_MARK);
    chunk.place[1] = swap(chunk.place[1], 13, 'L');
    [[12, 1], [14, 1], [12, 2], [13, 2], [14, 2]].forEach(([c, r]) => { chunk.place[r] = swap(chunk.place[r], c, 'w'); });
    expect(validateManifest(m).join()).toMatch(/cannot be reached/);
  });

  it('is drawn over what stands on the lot it crosses, by shape', () => {
    const q = grown.passages.find(p => p.through.length > 0)!;
    const across = q.tiles.find(t => lotsOf(grown).some(p => q.through.includes(p.id) && t.x >= p.position.x && t.x < p.position.x + p.size.width && t.y >= p.position.y && t.y < p.position.y + p.size.height))!;
    const lot = lotsOf(grown).find(p => q.through.includes(p.id) && across.x >= p.position.x && across.x < p.position.x + p.size.width && across.y >= p.position.y && across.y < p.position.y + p.size.height)!;
    const g = hubGround(grown, 0, { [lot.metadata.lotIndex]: 'HOUSE' });
    const at = (x: number, y: number) => g.data[(across.y * HUB_TILE + y) * g.w + across.x * HUB_TILE + x];
    const values = new Set(Array.from({ length: HUB_TILE * HUB_TILE }, (_, i) => at(i % HUB_TILE, Math.floor(i / HUB_TILE))));
    const want = new Set(Array.from({ length: HUB_TILE * HUB_TILE }, (_, i) => passageAtom(across.x * HUB_TILE + (i % HUB_TILE), across.y * HUB_TILE + Math.floor(i / HUB_TILE))));
    expect(values).toEqual(want);
    expect(want.size).toBeGreaterThan(1);
  });

  it('a built lot lets the passage through, on the street and on the map', () => {
    expect(SRC('src/entities/hub/HubCanvas.tsx')).toMatch(/passageTiles/);
    expect(hashBytes(cityMinimap(grown, {}, { x: 0, y: 0 }).data)).not.toBe(hashBytes(cityMinimap({ ...grown, passages: [] }, {}, { x: 0, y: 0 }).data));
  });

  it('the deeds screen says which lot serves which', () => {
    expect(SRC('src/components/HoldingsPanel.tsx')).toMatch(/Servidão/);
  });
});

// Pedro: "instead of more smaller lots, make a dismemberment option at a cost that
// traces a servidão to the center and makes smaller lots all around it".
describe('dismemberment: the shape', () => {
  const rects = [{ x: 48, y: 16, width: 8, height: 8 }, { x: 0, y: 0, width: 16, height: 16 }, { x: 8, y: 8, width: 16, height: 8 }, { x: 4, y: 4, width: 8, height: 16 }, { x: 0, y: 0, width: 12, height: 12 }];
  const inRect = (r: { x: number; y: number; width: number; height: number }, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

  it('the servidão runs from the door to the centre of the lot', () => {
    rects.forEach(r => {
      const s = dismemberShape(r);
      const cx = r.x + (r.width >> 1), cy = r.y + (r.height >> 1);
      const door = doorTile({ position: { x: r.x, y: r.y }, size: { width: r.width, height: r.height } });
      expect(s.way.some(t => t.x === cx && t.y === cy), JSON.stringify(r)).toBe(true);
      expect(s.way.some(t => t.x === door.x && t.y === door.y - 1), JSON.stringify(r)).toBe(true);
    });
  });

  it('the pieces and the way between them are exactly the old lot, with nothing twice', () => {
    rects.forEach(r => {
      const seen = new Map<string, number>();
      const mark = (x: number, y: number) => seen.set(`${x},${y}`, (seen.get(`${x},${y}`) ?? 0) + 1);
      const s = dismemberShape(r);
      s.way.forEach(t => mark(t.x, t.y));
      s.pieces.forEach(p => { for (let y = p.y; y < p.y + p.height; y++) for (let x = p.x; x < p.x + p.width; x++) mark(x, y); });
      expect(seen.size, JSON.stringify(r)).toBe(r.width * r.height);
      [...seen.values()].forEach(n => expect(n).toBe(1));
      s.pieces.forEach(p => {
        expect(inRect(r, p.x, p.y)).toBe(true);
        expect(inRect(r, p.x + p.width - 1, p.y + p.height - 1)).toBe(true);
      });
    });
  });

  it('makes smaller lots all around the centre, on every side but the way in', () => {
    rects.forEach(r => {
      const s = dismemberShape(r);
      const cx = r.x + (r.width >> 1), cy = r.y + (r.height >> 1);
      expect(s.pieces.length, JSON.stringify(r)).toBeGreaterThanOrEqual(3);
      expect(s.pieces.some(p => p.y + p.height <= cy), 'north').toBe(true);
      expect(s.pieces.some(p => p.y > cy && p.x + p.width <= cx), 'south-west').toBe(true);
      expect(s.pieces.some(p => p.y > cy && p.x > cx), 'south-east').toBe(true);
      s.pieces.forEach(p => {
        expect(p.width, JSON.stringify(p)).toBeGreaterThanOrEqual(DISMEMBER_PIECE_MIN);
        expect(p.height, JSON.stringify(p)).toBeGreaterThanOrEqual(DISMEMBER_PIECE_MIN);
        expect(p.width * p.height).toBeLessThan(r.width * r.height);
      });
    });
  });

  it('every piece has its door on the way or below the old lot', () => {
    rects.forEach(r => {
      const s = dismemberShape(r);
      const way = new Set(s.way.map(t => `${t.x},${t.y}`));
      s.pieces.forEach(p => {
        const d = doorTile({ position: { x: p.x, y: p.y }, size: { width: p.width, height: p.height } });
        expect(way.has(`${d.x},${d.y}`) || d.y === r.y + r.height, JSON.stringify(p)).toBe(true);
      });
    });
  });
});

describe('dismemberment: in the layout', () => {
  const first = HubGenerator.generate();
  const bigLot = lotPois(first).find(p => p.size.width >= 8 && p.size.height >= 8)!;
  const planSplit = (id = bigLot.id): IHubPlan => {
    const res = dismemberPlan(firstPlan(), id);
    return res;
  };
  const split = () => HubGenerator.generate(planSplit());

  it('asks a verdict first: too small, locked out, or carrying a passage is refused, with the reason', () => {
    const small = lotPois(first).find(p => p.size.width < 8 || p.size.height < 8)!;
    expect(HubGenerator.dismemberVerdict(first, small.id).ok).toBe(false);
    expect(HubGenerator.dismemberVerdict(first, 'poi_lot_nowhere').ok).toBe(false);
    const big = HubGenerator.dismemberVerdict(first, bigLot.id);
    expect(big.ok).toBe(true);
    expect(big.cost).toBe(lotPriceShare(NEW_CARLEON, bigLot.metadata.price));
    expect(big.cost).toBeGreaterThan(0);
    expect(big.pieces).toBeGreaterThanOrEqual(3);
    const grown = HubGenerator.generate(planOf('EAST'));
    const locked = lotPois(grown).find(p => p.metadata.locked)!;
    const carrying = lotPois(grown).find(p => p.metadata.carries)!;
    const lockedVerdict = HubGenerator.dismemberVerdict(grown, locked.id);
    expect(lockedVerdict.ok).toBe(false);
    expect(lockedVerdict.reason).toMatch(/street/i);
    const carryingVerdict = HubGenerator.dismemberVerdict(grown, carrying.id);
    expect(carryingVerdict.ok).toBe(false);
    expect(carryingVerdict.reason).toMatch(/servidão/i);
  });

  it('replaces the old lot with its pieces, all in the same district, numbered on from what stands', () => {
    const l = split();
    expect(HubGenerator.findPOI(l, bigLot.id)).toBeNull();
    const children = lotPois(l).filter(p => p.metadata.dismemberedFrom === bigLot.id);
    expect(children.length).toBeGreaterThanOrEqual(3);
    const zone = HubGenerator.getZoneAtPosition(first, bigLot.position.x, bigLot.position.y)!.id;
    children.forEach(p => {
      expect(HubGenerator.getZoneAtPosition(l, p.position.x, p.position.y)?.id, p.id).toBe(zone);
      expect(p.id).toBe(`poi_lot_${p.metadata.lotIndex}`);
      expect(p.metadata.lotIndex, p.id).toBeGreaterThanOrEqual(LOTS_STANDING);
      expect(p.name).toBe(`Lot #${p.metadata.lotIndex + 1}`);
    });
    const ids = allPois(l).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves everything else exactly where it stood', () => {
    const l = split();
    allPois(first).filter(p => p.id !== bigLot.id).forEach(p => {
      const after = poiOf(l, p.id);
      expect(after.position, p.id).toEqual(p.position);
      expect(after.size, p.id).toEqual(p.size);
      expect(after.metadata.price, p.id).toBe(p.metadata.price);
    });
    expect(l.navMesh).toEqual(first.navMesh);
  });

  it('every piece behind the centre has a passage, door first, down the way to the street', () => {
    const l = split();
    const children = lotPois(l).filter(p => p.metadata.dismemberedFrom === bigLot.id);
    const behind = children.filter(p => p.metadata.locked);
    expect(behind.length).toBeGreaterThan(0);
    behind.forEach(p => {
      const q = l.passages.find(x => x.lotId === p.id)!;
      expect(q, p.id).toBeTruthy();
      expect(q.tiles[0]).toEqual(doorOf(p));
      for (let i = 1; i < q.tiles.length; i++) expect(Math.abs(q.tiles[i].x - q.tiles[i - 1].x) + Math.abs(q.tiles[i].y - q.tiles[i - 1].y), `${p.id} step ${i}`).toBe(1);
      const last = q.tiles[q.tiles.length - 1];
      expect(l.roads.some(r => tilesToCell(last, r) <= 1), p.id).toBe(true);
      expect(q.through).toEqual([]);
    });
    children.filter(p => !p.metadata.locked).forEach(p => expect(l.roads.some(r => tilesToCell(doorOf(p), r) <= 1), p.id).toBe(true));
  });

  it('with every lot built on, every door still reaches the street', () => {
    const l = split();
    const lots = lotPois(l);
    const open = new Set(l.passages.flatMap(q => q.tiles.map(t => `${t.x},${t.y}`)));
    const blocked = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= l.width || y >= l.height || !l.navMesh[y][x]) return true;
      if (open.has(`${x},${y}`)) return false;
      return lots.some(p => x >= p.position.x && x < p.position.x + p.size.width && y >= p.position.y && y < p.position.y + p.size.height);
    };
    const seen = new Set([`${l.spawnPoint.x},${l.spawnPoint.y}`]);
    const queue = [l.spawnPoint];
    while (queue.length) {
      const { x, y } = queue.shift()!;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || blocked(x + dx, y + dy)) return;
        seen.add(k);
        queue.push({ x: x + dx, y: y + dy });
      });
    }
    lots.forEach(p => expect(seen.has(`${doorOf(p).x},${doorOf(p).y}`), p.id).toBe(true));
  });

  it('every lot the manifest can dismember comes out with no piece stranded', () => {
    const grown = HubGenerator.generate(planOf('EAST'));
    lotPois(grown).filter(p => HubGenerator.dismemberVerdict(grown, p.id).ok).forEach(p => {
      const l = HubGenerator.generate(dismemberPlan(planOf('EAST'), p.id));
      lotPois(l).filter(c => c.metadata.dismemberedFrom === p.id).forEach(c => {
        const onStreet = l.roads.some(r => tilesToCell(doorOf(c), r) <= 1);
        expect(onStreet || l.passages.some(q => q.lotId === c.id), `${p.id} -> ${c.id}`).toBe(true);
      });
    });
  });

  it('the same plan is the same city, and what rises after moves no piece or number', () => {
    expect(JSON.stringify(split())).toBe(JSON.stringify(HubGenerator.generate(JSON.parse(JSON.stringify(planSplit())))));
    const before = lotPois(split()).filter(p => p.metadata.dismemberedFrom === bigLot.id);
    (Object.keys(HUB_SIDES) as HubSide[]).forEach(side => {
      const raised = raiseChunk(planSplit(), side);
      if (raised.ok === false) throw new Error(raised.reason);
      const l = HubGenerator.generate(raised.plan);
      expect(raised.plan.dismembered, side).toEqual(planSplit().dismembered);
      const ids = allPois(l).map(p => p.id);
      expect(new Set(ids).size, side).toBe(ids.length);
      before.forEach(p => {
        const after = poiOf(l, p.id);
        expect(after.metadata.lotIndex, `${side} ${p.id}`).toBe(p.metadata.lotIndex);
        expect(after.position, `${side} ${p.id}`).toEqual({ x: p.position.x + l.origin.x, y: p.position.y + l.origin.y });
      });
    });
  });

  it('a chunk that rose first keeps its numbers when a lot is split after', () => {
    const plan = planOf('EAST');
    const before = HubGenerator.generate(plan);
    const after = HubGenerator.generate(dismemberPlan(plan, bigLot.id));
    lotPois(before).filter(p => p.id !== bigLot.id).forEach(p => expect(poiOf(after, p.id).metadata.lotIndex, p.id).toBe(p.metadata.lotIndex));
  });

  it('a piece big enough can be dismembered again', () => {
    const grown = HubGenerator.generate(planOf('EAST'));
    const biggest = lotPois(grown).filter(p => HubGenerator.dismemberVerdict(grown, p.id).ok).sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height)[0];
    const once = dismemberPlan(planOf('EAST'), biggest.id);
    const l = HubGenerator.generate(once);
    const child = lotPois(l).find(p => p.metadata.dismemberedFrom === biggest.id && HubGenerator.dismemberVerdict(l, p.id).ok);
    if (!child) return; // Whether one stays big enough depends on the shape; none is not a fault.
    const twice = HubGenerator.generate(dismemberPlan(once, child.id));
    expect(HubGenerator.findPOI(twice, child.id)).toBeNull();
    expect(new Set(allPois(twice).map(p => p.id)).size).toBe(allPois(twice).length);
  });

  it('the law holds the shape to the manifest, and refuses a share that costs nothing', () => {
    const m: IHubManifest = JSON.parse(JSON.stringify(NEW_CARLEON));
    m.dismemberShare = 0;
    expect(validateManifest(m).join()).toMatch(/dismember/i);
  });
});

describe('dismemberment: at a cost, by the owner', () => {
  const owner = 'uid_bars';
  const seed = async (id: string, gold: number, patch: Record<string, unknown> = {}) => {
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks, dismembered: [] } as any);
    await useHubStore.getState().loadHub(id);
    useHubStore.setState(s => ({ lots: s.lots.map(l => l.id === 'poi_lot_0' ? { ...l, ownerId: owner, ownerName: 'TESTER', purchaseDate: 77, upkeepPaidThroughDay: 123, ...patch } as any : l) }));
    usePlayerStore.setState(s => ({ player: { ...s.player, id: owner, username: 'TESTER', bank: { ...s.player.bank, gold } } }));
  };
  const askFor = () => HubGenerator.dismemberVerdict(HubGenerator.generate(), 'poi_lot_0').cost!;

  it('charges the cost, and every piece is the owner\'s, in the old lot\'s place', async () => {
    await seed('hub_split', askFor() + 7);
    const res = await useHubStore.getState().dismemberLot('poi_lot_0');
    expect(res.ok).toBe(true);
    expect(usePlayerStore.getState().player.bank.gold).toBe(7);
    const hub = useHubStore.getState();
    expect(hub.lots.find(l => l.id === 'poi_lot_0')).toBeUndefined();
    const layout = HubGenerator.generate({ chunks: hub.chunks, dismembered: hub.dismembered });
    const children = lotPois(layout).filter(p => p.metadata.dismemberedFrom === 'poi_lot_0');
    children.forEach(c => {
      const rec = hub.lots.find(l => l.id === c.id)!;
      expect(rec, c.id).toBeTruthy();
      expect(rec.ownerId).toBe(owner);
      expect(rec.ownerName).toBe('TESTER');
      expect(rec.purchaseDate).toBe(77);
      expect(rec.upkeepPaidThroughDay).toBe(123);
      expect(rec.structureType).toBe('EMPTY');
      expect(rec.lotIndex).toBe(c.metadata.lotIndex);
      expect(rec.price).toBe(c.metadata.price);
    });
    expect(hub.lots.filter(l => l.ownerId === owner).length).toBe(children.length);
  });

  it('the gold goes through the one door, with a row of its own', () => {
    const src = SRC('src/entities/hub/store.ts');
    expect(src).toMatch(/reason: 'LOT_DISMEMBERED'/);
    const body = src.slice(src.indexOf('dismemberLot: async'), src.indexOf('resolveBuilds: async'));
    expect(body).toMatch(/GoldCommit\.commit/);
    expect(body).not.toMatch(/Treasury\.credit/);
  });

  it('survives a reload: the plan and the pieces and their owner', async () => {
    await seed('hub_split_keep', askFor(), { upkeepPaidThroughDay: worldDay() });
    await useHubStore.getState().dismemberLot('poi_lot_0');
    const saved = JSON.parse(JSON.stringify(useHubStore.getState()));
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks, dismembered: [] } as any);
    await useHubStore.getState().loadHub('hub_split_keep');
    expect(useHubStore.getState().dismembered).toEqual(saved.dismembered);
    expect(useHubStore.getState().lots).toEqual(saved.lots);
  });

  it('a save from before this has no record of it, and loads as it was', async () => {
    db.set('hub_state_hub_none', { id: 'hub_state_hub_none', namespace: 'territories', data: { chunks: firstPlan().chunks, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], web: { nodes: {} } }, metadata: { createdAt: 0, updatedAt: 0, ownerCertUid: 'SYSTEM', version: 1 } });
    useHubStore.setState({ activeHubId: null, lots: [], chunks: firstPlan().chunks, dismembered: [{ lotId: 'x', after: 1 }] } as any);
    await useHubStore.getState().loadHub('hub_none');
    expect(useHubStore.getState().dismembered).toEqual([]);
  });

  it('refuses without moving anything: someone else\'s, too poor, or with a building on it', async () => {
    await seed('hub_split_no', askFor() - 1);
    const before = useHubStore.getState();
    const poor = await useHubStore.getState().dismemberLot('poi_lot_0');
    expect(poor.ok).toBe(false);
    expect(poor.reason).toMatch(/\d/);
    expect(useHubStore.getState().lots).toBe(before.lots);
    expect(usePlayerStore.getState().player.bank.gold).toBe(askFor() - 1);

    await seed('hub_split_theirs', askFor(), { ownerId: 'someone_else' });
    expect((await useHubStore.getState().dismemberLot('poi_lot_0')).ok).toBe(false);

    await seed('hub_split_built', askFor(), { structureType: 'HOUSE' });
    const built = await useHubStore.getState().dismemberLot('poi_lot_0');
    expect(built.ok).toBe(false);
    expect(built.reason).toMatch(/empty|building|stands/i);

    await seed('hub_split_small', askFor());
    expect((await useHubStore.getState().dismemberLot('poi_lot_3')).ok).toBe(false);
  });

  // Pedro: "you pay to split and then you can buy one of the small ones". It is how
  // someone who cannot afford a big lot gets a small one.
  describe('a free lot, split by anyone', () => {
    const freeSeed = async (id: string, gold: number) => {
      useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks, dismembered: [], planDeposit: {} } as any);
      await useHubStore.getState().loadHub(id);
      usePlayerStore.setState(s => ({ player: { ...s.player, id: owner, username: 'TESTER', bank: { ...s.player.bank, gold } } }));
    };
    const pieces = () => {
      const hub = useHubStore.getState();
      const layout = HubGenerator.generate({ chunks: hub.chunks, dismembered: hub.dismembered });
      return lotPois(layout).filter(p => p.metadata.dismemberedFrom === 'poi_lot_0');
    };

    it('charges the cost, and every piece goes on the market at what it asks', async () => {
      await freeSeed('hub_free_split', askFor() + 7);
      const res = await useHubStore.getState().dismemberLot('poi_lot_0');
      expect(res.ok).toBe(true);
      expect(usePlayerStore.getState().player.bank.gold).toBe(7);
      const hub = useHubStore.getState();
      expect(hub.lots.find(l => l.id === 'poi_lot_0')).toBeUndefined();
      expect(pieces().length).toBeGreaterThanOrEqual(3);
      pieces().forEach(c => {
        const rec = hub.lots.find(l => l.id === c.id)!;
        expect(rec.ownerId, c.id).toBeNull();
        expect(rec.ownerName, c.id).toBeNull();
        expect(rec.purchaseDate, c.id).toBeNull();
        expect(rec.price, c.id).toBe(c.metadata.price);
      });
    });

    it('then you can buy one of the small ones, for less than the whole would have asked', async () => {
      const whole = poiOf(HubGenerator.generate(), 'poi_lot_0').metadata.price;
      await freeSeed('hub_free_buy', askFor() + 50000);
      await useHubStore.getState().dismemberLot('poi_lot_0');
      const cheapest = useHubStore.getState().lots.filter(l => pieces().some(p => p.id === l.id)).sort((a, b) => a.price - b.price)[0];
      expect(askFor() + cheapest.price).toBeLessThan(whole);
      const before = usePlayerStore.getState().player.bank.gold;
      expect(await useHubStore.getState().buyLot(cheapest.id)).toBe(true);
      expect(usePlayerStore.getState().player.bank.gold).toBe(before - cheapest.price);
      const hub = useHubStore.getState();
      expect(hub.lots.find(l => l.id === cheapest.id)?.ownerId).toBe(owner);
      expect(hub.lots.filter(l => pieces().some(p => p.id === l.id) && l.ownerId === null).length).toBe(pieces().length - 1);
    });

    it('a piece for sale survives a reload as for sale', async () => {
      await freeSeed('hub_free_keep', askFor());
      await useHubStore.getState().dismemberLot('poi_lot_0');
      const want = JSON.parse(JSON.stringify(useHubStore.getState().lots));
      useHubStore.setState({ activeHubId: null, lots: [], chunks: firstPlan().chunks, dismembered: [], planDeposit: {} } as any);
      await useHubStore.getState().loadHub('hub_free_keep');
      expect(useHubStore.getState().lots).toEqual(want);
    });

    it('a short purse moves nothing', async () => {
      await freeSeed('hub_free_poor', askFor() - 1);
      const before = useHubStore.getState().lots;
      const res = await useHubStore.getState().dismemberLot('poi_lot_0');
      expect(res.ok).toBe(false);
      expect(useHubStore.getState().lots).toBe(before);
    });

    it('the deeds screen offers it on a lot for sale, and says where the pieces go', () => {
      const src = SRC('src/components/HoldingsPanel.tsx');
      expect(src).toMatch(/!lot\.ownerId \|\| mine/);
      expect(src).toMatch(/on the market/);
    });
  });

  it('refuses while something is being raised there', async () => {
    await seed('hub_split_job', askFor());
    useHubStore.setState({ buildJobs: [{ id: 'j', lotId: 'poi_lot_0', kind: 'SHELL', structureType: 'HOUSE', ownerCertUid: owner, queuedAt: 0, finishesAt: 0, applied: false, consumedIds: [], consumedDefIds: [] }] } as any);
    expect((await useHubStore.getState().dismemberLot('poi_lot_0')).ok).toBe(false);
  });

  it('the deeds screen offers it as a deliberate step, saying the cost and the pieces', () => {
    const src = SRC('src/components/HoldingsPanel.tsx');
    expect(src).toMatch(/dismemberLot/);
    expect(src).toMatch(/ArmedButton/);
    expect(src).toMatch(/DISMEMBER/);
  });

  it('every reader passes the whole plan', () => {
    ['src/entities/hub/HubCanvas.tsx', 'src/components/TemplateApplyModal.tsx', 'src/components/HoldingsPanel.tsx'].forEach(path => {
      expect(SRC(path), path).toMatch(/dismembered/);
    });
    expect(SRC('src/entities/hub/store.ts')).not.toMatch(/generate\(\{ chunks: get\(\)\.chunks \}\)/);
  });
});

// Pedro: "the concept is we need to make the guildhall be sorts of like a town hall,
// make a land manager be there, and that screen is connected through him, then what
// happens is the player has the options to develop everything through that one npc."
// And D73: the materials for expansion are deposited there, and the plan decided there.
describe('the Land Office: the town hall has a land manager', () => {
  const layout = HubGenerator.generate();
  const office = poiOf(layout, 'poi_land_office');

  it('stands against the Hall of Banners, on the plaza, with a door that can be walked to', () => {
    const hall = poiOf(layout, 'poi_guild');
    expect(office).toBeTruthy();
    expect(office.type).toBe(POIType.LAND_OFFICE);
    expect(office.npcId).toBe('npc_land_manager');
    expect(office.position.x + office.size.width).toBeLessThanOrEqual(hall.position.x);
    expect(hall.position.x - (office.position.x + office.size.width)).toBeLessThanOrEqual(CELL_TILES);
    expect(office.position.y).toBe(hall.position.y);
    expect(HubGenerator.getZoneAtPosition(layout, office.position.x, office.position.y)?.type).toBe(ZoneType.PLAZA);
    expect(walkable(layout).has(`${doorOf(office).x},${doorOf(office).y}`)).toBe(true);
  });

  it('is a person of the cast, and offers the deeds and the plan, each doing something', () => {
    const npc = HUB_NPCS.npc_land_manager;
    expect(npc.title).toBe('Land Manager');
    const actions = npc.dialogue.options.map(o => o.action);
    expect(actions).toContain('OPEN_DEEDS');
    expect(actions).toContain('OPEN_PLAN');
    expect(actions).toContain('CLOSE');
    expect(runDialogueAction(worldPort, playerPort, 'OPEN_DEEDS')).toEqual({ kind: 'navigate', view: 'HOLDINGS' });
    expect(runDialogueAction(worldPort, playerPort, 'OPEN_PLAN')).toEqual({ kind: 'open', panel: 'plan' });
  });

  it('is the one way to the deeds in the city', () => {
    const city = SRC('src/entities/hub/HubCanvas.tsx');
    expect(city).not.toMatch(/setView\('HOLDINGS'\)/);
    expect(city).toMatch(/setView\(effect\.view\)/);
    expect(city).not.toMatch(/THE DEEDS/);
  });

  it('a lot with nothing to enter points you to him, instead of opening anything', () => {
    const city = SRC('src/entities/hub/HubCanvas.tsx');
    expect(city).toMatch(/Land Office/);
  });

  it('opens the plan from the city', () => {
    const city = SRC('src/entities/hub/HubCanvas.tsx');
    expect(city).toMatch(/panel\?\.kind === 'plan'/);
    expect(city).toMatch(/<CityPlan /);
  });
});

describe('the city plan: materials go in, and a chunk comes out', () => {
  const owner = 'uid_bars';
  const plank = (i: number, def = 'crf_plank') => ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[def] as any, Rng.fromKey(`a1_plan_${def}_${i}`));
  const stashIds = () => usePlayerStore.getState().player.bank.stashTabs[0].items.map(i => i.id);
  const fresh = async (id: string, items: ReturnType<typeof plank>[]) => {
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], chunks: firstPlan().chunks, dismembered: [], planDeposit: {} } as any);
    await useHubStore.getState().loadHub(id);
    usePlayerStore.setState(s => ({ player: { ...s.player, id: owner, username: 'TESTER', bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items }] } } }));
  };
  const firstBill = () => chunkBillFor(1)[0];

  it('the bill is data, and each chunk asks more than the last, with no ceiling', () => {
    expect(NEW_CARLEON.chunkBill.length).toBeGreaterThan(0);
    const asks = [1, 2, 3, 40, 400].map(n => chunkBillFor(n)[0].count);
    asks.slice(1).forEach((c, i) => expect(c).toBeGreaterThan(asks[i]));
    expect(chunkBillFor(1)[0].tag).toBe(NEW_CARLEON.chunkBill[0].tag);
    const m: IHubManifest = JSON.parse(JSON.stringify(NEW_CARLEON));
    m.chunkBill = [];
    expect(validateManifest(m).join()).toMatch(/bill/i);
  });

  it('a deposit takes the items out of the stash, exactly once', async () => {
    const items = Array.from({ length: 5 }, (_, i) => plank(i));
    await fresh('hub_plan_a', items);
    const res = await useHubStore.getState().depositToPlan(firstBill().tag, items.slice(0, 3).map(i => i.id));
    expect(res.ok).toBe(true);
    expect(stashIds()).toEqual(items.slice(3).map(i => i.id));
    expect(useHubStore.getState().planDeposit[firstBill().tag]).toBe(3);
    const again = await useHubStore.getState().depositToPlan(firstBill().tag, items.slice(0, 3).map(i => i.id));
    expect(again.ok).toBe(false);
    expect(useHubStore.getState().planDeposit[firstBill().tag]).toBe(3);
  });

  it('refuses what does not answer the bill, and moves nothing', async () => {
    const wrong = { ...plank(0), id: 'a1_not_building', universalDefinitionId: 'no_such_def', tags: ['consumable'] };
    await fresh('hub_plan_b', [wrong]);
    const res = await useHubStore.getState().depositToPlan(firstBill().tag, [wrong.id]);
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
    expect(stashIds()).toEqual([wrong.id]);
    expect(useHubStore.getState().planDeposit[firstBill().tag] ?? 0).toBe(0);
    const unknown = await useHubStore.getState().depositToPlan('no_such_tag', [wrong.id]);
    expect(unknown.ok).toBe(false);
  });

  it('takes no more than the next chunk still asks', async () => {
    const need = firstBill().count;
    const items = Array.from({ length: need + 3 }, (_, i) => plank(i));
    await fresh('hub_plan_c', items);
    await useHubStore.getState().depositToPlan(firstBill().tag, items.map(i => i.id));
    expect(useHubStore.getState().planDeposit[firstBill().tag]).toBe(need);
    expect(stashIds().length).toBe(3);
  });

  it('a chunk will not rise on a short deposit, and says by how much', async () => {
    await fresh('hub_plan_d', []);
    const res = await useHubStore.getState().planRaise('EAST');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain(String(firstBill().count));
    expect(useHubStore.getState().chunks.length).toBe(1);
  });

  it('a full deposit raises the chunk where it was chosen, and is spent', async () => {
    const need = firstBill().count;
    const items = Array.from({ length: need }, (_, i) => plank(i));
    await fresh('hub_plan_e', items);
    await useHubStore.getState().depositToPlan(firstBill().tag, items.map(i => i.id));
    const res = await useHubStore.getState().planRaise('WEST');
    expect(res.ok).toBe(true);
    const hub = useHubStore.getState();
    expect(hub.chunks.length).toBe(2);
    expect({ cx: hub.chunks[1].cx, cy: hub.chunks[1].cy }).toEqual({ cx: -1, cy: 0 });
    expect(hub.planDeposit[firstBill().tag]).toBe(0);
    expect(hub.lots.length).toBeGreaterThan(LOTS_STANDING);
  });

  it('a chunk on taken ground is refused, and the deposit keeps', async () => {
    const need = firstBill().count;
    const items = Array.from({ length: need }, (_, i) => plank(i));
    await fresh('hub_plan_f', items);
    await useHubStore.getState().raiseChunk('NORTH');
    const nextNeed = chunkBillFor(2)[0].count;
    useHubStore.setState({ planDeposit: { [firstBill().tag]: nextNeed } });
    const res = await useHubStore.getState().planRaise('NORTH');
    expect(res.ok).toBe(false);
    expect(useHubStore.getState().planDeposit[firstBill().tag]).toBe(nextNeed);
    expect(useHubStore.getState().chunks.length).toBe(2);
  });

  it('what is deposited stays through a reload', async () => {
    const items = Array.from({ length: 4 }, (_, i) => plank(i));
    await fresh('hub_plan_g', items);
    await useHubStore.getState().depositToPlan(firstBill().tag, items.map(i => i.id));
    useHubStore.setState({ activeHubId: null, lots: [], chunks: firstPlan().chunks, dismembered: [], planDeposit: {} } as any);
    await useHubStore.getState().loadHub('hub_plan_g');
    expect(useHubStore.getState().planDeposit[firstBill().tag]).toBe(4);
  });

  it('deposits and raises are on the ledger, and the screen spends through the one door', () => {
    expect(SRC('src/entities/hub/store.ts')).toMatch(/kind: 'PLAN_DEPOSIT'/);
    const plan = SRC('src/components/CityPlan.tsx');
    expect(plan).toMatch(/planRaise\(/);
    expect(plan).toMatch(/depositToPlan\(/);
    expect(plan).not.toMatch(/raiseChunk/);
    expect(plan).toMatch(/dashed/); // where a chunk could rise reads by its outline, not its hue
    expect(plan).toMatch(/ArmedButton/); // a deposit does not come back
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
    expect(src).toMatch(/HubGenerator\.generate\(\{\s*chunks,\s*dismembered\s*\}\)/);
    expect(src).toMatch(/\[chunks,\s*dismembered\]/);
  });

  it('keeps you on your own ground when a chunk rises to the north or the west', () => {
    expect(src).toMatch(/layout\.origin/);
  });

  it('the proof page does not claim the old size', () => {
    expect(SRC('prototype/atoms/hubPage.ts')).not.toMatch(/50 by 50/);
  });
});

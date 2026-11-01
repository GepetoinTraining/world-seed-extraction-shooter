/**
 * WAVE 10 BARS — registered before the rooms were built (guardrail 1).
 * Test lines 32–34:
 *   32 you walk through the door of your own house and back, and the room is the same after a reload
 *   33 you craft at a bench in your Workshop and serve from a counter in your shop
 *   34 you place something in a room, reload, and it is still there, signed
 * Plus the wave's own bars (PLAN 3B, Wave 10): the same build record gives the
 * same bytes; every room with a door is fully walkable from it; every station
 * reachable; neither a wall nor a placement can seal the way out (the builder
 * refuses); a placed item is never lost or duplicated across reloads; materials
 * are consumed exactly once per build step; composing stays cheap enough to
 * cache; a built lot blocks exactly what it draws, except its door.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { IItem, UniversalRank } from '../types';
import {
  IRoomState, IRoomPlacement, emptyRoom, interiorSize, roomDoor, roomEntry, roomSolid,
  fullyWalkable, reachableFrom, placementReachable, canBuildPiece, canPlaceItem,
  builtLotBlocksAt, PIECE_BILLS, SHELL_BILLS, SHELL_STATION, STATION_MIN_AREA, shellBillFor,
  STATION_FUNCTION
} from '../src/entities/hub/room';
// Wave 10B: the presets fold into the template contract — one path, no second.
import { ROOM_PRESETS, presetToRoom } from '../src/entities/hub/template';
import { composeRoom, ROOM_TILE } from '../src/render/atoms/room';
import { HUB_GENRE, lotArt } from '../src/render/atoms/hub';
import { Role, STEPS, buildPalette, grayscale, hashBytes, px } from '../src/render/atoms/atoms';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { CRAFTED_DEFINITIONS, RECIPE_DEFINITIONS } from '../src/entities/economy/data/recipeDefinitions';
import { Rng } from '../src/logic/rng/DeterministicRNG';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const COMPOSE_MAX_MS = 25;        // median, the largest standard room
const WALL_FLOOR_GRAY_MIN = 20;   // mean luminance apart in grayscale (0–255)
const WINDOW_WALL_DIFF_MIN = 0.15; // share of a window tile's atoms changed vs plain wall
const PLACEMENT_COVER_MIN = 0.20; // share of a placement tile covered by its item's art
const LOT_FLOOR_MAX = 0.10;       // floor atoms allowed per blocked built-lot tile
const LOT_DOOR_VOID_MIN = 12;     // atoms of opening at a built lot's bottom centre

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const mint = (defId: string, key: string): IItem =>
  ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[defId] as any, Rng.fromKey(key));

const FOOT_4x4 = { width: 4, height: 4 };

const roomWithStation = (defId: string, x = 6, y = 3): IRoomState => {
  const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
  room.placements.push({
    id: `pl_${defId}`, item: mint(defId, `bars:${defId}`), x, y, rotated: false, placedBy: 'uid_bars', at: 1
  });
  return room;
};

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT('uid_bars') });
  usePlayerStore.getState().initializeSession(CERT('uid_bars'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// THE WALKABILITY LAW — every room fully walkable from its door
// -----------------------------------------------------------------------------

describe('every room is fully walkable from its door', () => {
  it('a fresh shell is open floor behind one door', () => {
    const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
    expect(room.size).toEqual(interiorSize(FOOT_4x4));
    expect(fullyWalkable(room)).toBe(true);
    const door = roomDoor(room.size);
    const solid = roomSolid(room);
    expect(solid[door.y * room.size.w + door.x]).toBe(0); // the gap is real
  });

  it('every NPC preset is fully walkable with every station reachable', () => {
    for (const preset of ROOM_PRESETS) {
      const room = presetToRoom(preset, 'poi_lot_p', FOOT_4x4, mint);
      expect(fullyWalkable(room), preset.id).toBe(true);
      const seen = reachableFrom(room);
      for (const place of room.placements) {
        expect(placementReachable(room, place, seen), `${preset.id}:${place.item.universalDefinitionId}`).toBe(true);
      }
    }
  });

  it('lots of several sizes make walkable rooms', () => {
    for (const foot of [{ width: 3, height: 3 }, { width: 4, height: 4 }, { width: 6, height: 5 }]) {
      const room = emptyRoom('poi_lot_s', foot, 'crf_plank');
      expect(fullyWalkable(room), `${foot.width}x${foot.height}`).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// THE REFUSALS — nothing can seal the way out, and the builder says why
// -----------------------------------------------------------------------------

describe('the builder refuses, out loud', () => {
  it('refuses to build on the door and gives the reason', () => {
    const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
    const door = roomDoor(room.size);
    const v = canBuildPiece(room, 'WALL', door.x, door.y);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason.length).toBeGreaterThan(0);
  });

  it('refuses the wall that would seal a pocket off from the door', () => {
    const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
    const { w, h } = room.size;
    // A full column of wall from top to one tile above the bottom wall seals the left side.
    for (let y = 1; y < h - 2; y++) {
      const v = canBuildPiece(room, 'WALL', 3, y);
      expect(v.ok, `wall 3,${y}`).toBe(true);
      room.pieces.push({ id: `p${y}`, kind: 'WALL', x: 3, y, materialDefId: 'crf_plank', builtBy: 'uid_bars', at: 1 });
    }
    const sealing = canBuildPiece(room, 'WALL', 3, h - 2);
    expect(sealing.ok).toBe(false);
    if (!sealing.ok) expect(sealing.reason).toMatch(/seal|door/i);
    expect(w).toBeGreaterThan(4);
  });

  it('refuses a stair with the honest reason: one floor at this tier', () => {
    const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
    const v = canBuildPiece(room, 'STAIR', 4, 4);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/floor|tier/i);
  });

  it('refuses the placement that blocks the doorway or seals the room', () => {
    const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
    const entry = roomEntry(room.size);
    const table = mint('stn_table', 'bars:block');
    const onDoorway = canPlaceItem(room, table, entry.x, entry.y - 1, false);
    expect(onDoorway.ok).toBe(false);

    // Wall off a corridor, then try to cork it with a table.
    const { h } = room.size;
    for (let y = 1; y < h - 3; y++) {
      room.pieces.push({ id: `p${y}`, kind: 'WALL', x: 3, y, materialDefId: 'crf_plank', builtBy: 'uid_bars', at: 1 });
    }
    const cork = canPlaceItem(room, table, 2, h - 4, false);
    expect(cork.ok).toBe(false);
    if (!cork.ok) expect(cork.reason.length).toBeGreaterThan(0);
  });

  it('a station refuses a region smaller than its minimum, naming the numbers', () => {
    const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
    const { h } = room.size;
    // Wall off a small chamber in the top-left: 2 wide, 2 tall, with a doorway.
    for (let y = 1; y <= 3; y++) room.pieces.push({ id: `px${y}`, kind: 'WALL', x: 3, y, materialDefId: 'crf_plank', builtBy: 'u', at: 1 });
    for (let x = 1; x <= 2; x++) room.pieces.push({ id: `py${x}`, kind: 'WALL', x, y: 3, materialDefId: 'crf_plank', builtBy: 'u', at: 1 });
    room.pieces.push({ id: 'dd', kind: 'DOOR', x: 3, y: 2, materialDefId: 'crf_plank', builtBy: 'u', at: 1 });
    // Remove one wall so the chamber opens through the DOOR tile (doors are walkable).
    room.pieces = room.pieces.filter(p => !(p.kind === 'WALL' && p.x === 3 && p.y === 2));
    expect(fullyWalkable(room)).toBe(true);

    const bench = mint('stn_bench', 'bars:small');
    const verdict = canPlaceItem(room, bench, 1, 1, false);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/tiles/);
    expect(STATION_MIN_AREA.stn_bench).toBeGreaterThan(4);
    expect(h).toBeGreaterThan(6);
  });
});

// -----------------------------------------------------------------------------
// THE DETERMINISM LAW — the same build record gives the same bytes
// -----------------------------------------------------------------------------

describe('the same build record gives the same bytes', () => {
  it('composes identically twice, and from a deep copy', () => {
    const preset = ROOM_PRESETS[2]; // the stall: pieces and two placements
    const room = presetToRoom(preset, 'poi_lot_0', FOOT_4x4, mint);
    const a = composeRoom(room);
    const b = composeRoom(JSON.parse(JSON.stringify(room)));
    expect(hashBytes(a.data)).toBe(hashBytes(b.data));
    expect(a.w).toBe(room.size.w * ROOM_TILE);
    expect(a.h).toBe(room.size.h * ROOM_TILE);
  });

  it('different shell materials give different walls', () => {
    const plank = composeRoom(emptyRoom('l', FOOT_4x4, 'crf_plank'));
    const ingot = composeRoom(emptyRoom('l', FOOT_4x4, 'crf_iron_ingot'));
    let diff = 0, wallAtoms = 0;
    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < plank.w; x++) {
      wallAtoms++;
      if (plank.data[y * plank.w + x] !== ingot.data[y * ingot.w + x]) diff++;
    }
    expect(diff / wallAtoms).toBeGreaterThan(0.10); // properties become pixels
  });

  it('composes inside its budget', () => {
    const room = presetToRoom(ROOM_PRESETS[2], 'poi_lot_0', { width: 6, height: 5 }, mint);
    const times = Array.from({ length: 5 }, () => {
      const t = performance.now(); composeRoom(room); return performance.now() - t;
    }).sort((x, y) => x - y);
    console.log(`ROOM compose median ${times[2].toFixed(1)}ms for ${room.size.w * ROOM_TILE}x${room.size.h * ROOM_TILE} atoms`);
    expect(times[2]).toBeLessThanOrEqual(COMPOSE_MAX_MS);
  });
});

// -----------------------------------------------------------------------------
// READABILITY — position, shape and seams, in color and in grayscale
// -----------------------------------------------------------------------------

describe('the room reads in grayscale', () => {
  const room = emptyRoom('poi_lot_0', FOOT_4x4, 'crf_plank');
  const sprite = () => composeRoom(room);

  const tileLuma = (s: { w: number; data: Uint8Array }, tx: number, ty: number) => {
    const gray = grayscale(buildPalette(HUB_GENRE));
    let sum = 0, n = 0;
    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < ROOM_TILE; x++) {
      const v = s.data[(ty * ROOM_TILE + y) * s.w + tx * ROOM_TILE + x];
      sum += gray[v * 3]; n++;
    }
    return sum / n;
  };

  it('walls sit apart from the floor by value, and the door gap reads as floor', () => {
    const s = sprite();
    const wall = tileLuma(s, 4, 0);
    const floor = tileLuma(s, 8, 5);
    const door = roomDoor(room.size);
    const gap = tileLuma(s, door.x, door.y);
    expect(Math.abs(wall - floor)).toBeGreaterThanOrEqual(WALL_FLOOR_GRAY_MIN);
    expect(Math.abs(gap - floor)).toBeLessThan(Math.abs(gap - wall)); // the way out looks open
  });

  it('walls are drawn solid: no ground shows through a wall tile', () => {
    const s = sprite();
    const isGround = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);
    let ground = 0;
    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < ROOM_TILE; x++) {
      if (isGround(s.data[y * s.w + 4 * ROOM_TILE + x])) ground++;
    }
    expect(ground).toBe(0);
  });

  it('a window changes its wall tile by shape, not hue alone', () => {
    const bare = composeRoom(emptyRoom('l', FOOT_4x4, 'crf_plank'));
    const withWindow = emptyRoom('l', FOOT_4x4, 'crf_plank');
    withWindow.pieces.push({ id: 'w1', kind: 'WINDOW', x: 4, y: 0, materialDefId: 'crf_glass', builtBy: 'u', at: 1 });
    const lit = composeRoom(withWindow);
    let diff = 0;
    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < ROOM_TILE; x++) {
      const i = y * lit.w + 4 * ROOM_TILE + x;
      if (bare.data[i] !== lit.data[i]) diff++;
    }
    expect(diff / (ROOM_TILE * ROOM_TILE)).toBeGreaterThanOrEqual(WINDOW_WALL_DIFF_MIN);
  });

  it('a placed item covers its tiles with its real art', () => {
    const r = roomWithStation('stn_bench', 6, 3);
    const s = composeRoom(r);
    const isGround = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);
    let covered = 0;
    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < ROOM_TILE; x++) {
      const v = s.data[(3 * ROOM_TILE + y) * s.w + 6 * ROOM_TILE + x];
      if (v && !isGround(v)) covered++;
    }
    expect(covered / (ROOM_TILE * ROOM_TILE)).toBeGreaterThanOrEqual(PLACEMENT_COVER_MIN);
  });
});

// -----------------------------------------------------------------------------
// THE CITY SIDE — a built lot blocks exactly what it draws, except its door
// -----------------------------------------------------------------------------

describe('a built lot blocks what it draws', () => {
  const poi = { position: { x: 40, y: 18 }, size: { width: 4, height: 4 } };

  it('blocks all of its footprint when built, none when empty', () => {
    let blocked = 0;
    for (let ty = 18; ty < 22; ty++) for (let tx = 40; tx < 44; tx++) {
      if (builtLotBlocksAt(poi, true, tx, ty)) blocked++;
      expect(builtLotBlocksAt(poi, false, tx, ty)).toBe(false);
    }
    expect(blocked).toBe(16);
    expect(builtLotBlocksAt(poi, true, 42, 22)).toBe(false); // the door tile row, outside
  });

  it('built lot art is solid over every tile, with an opening at the bottom centre', () => {
    const isGround = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);
    for (const state of ['HOUSE', 'WORKSHOP', 'VENDOR'] as const) {
      const art = lotArt(state, 40, 40, 1);
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        let floor = 0;
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
          const v = art.data[(ty * 10 + y) * art.w + tx * 10 + x];
          if (!v || isGround(v)) floor++;
        }
        expect(floor / 100, `${state} tile ${tx},${ty}`).toBeLessThanOrEqual(LOT_FLOOR_MAX);
      }
      // The doorway: void atoms in the bottom-centre band
      let voids = 0;
      const isVoid = (v: number) => v >= px(Role.VOID, 0) && v <= px(Role.VOID, STEPS - 1);
      for (let y = art.h - 8; y < art.h; y++) for (let x = (art.w >> 1) - 4; x < (art.w >> 1) + 4; x++) {
        if (isVoid(art.data[y * art.w + x])) voids++;
      }
      expect(voids, `${state} door`).toBeGreaterThanOrEqual(LOT_DOOR_VOID_MIN);
    }
  });
});

// -----------------------------------------------------------------------------
// THE STORE — materials once, stations real, nothing lost or duplicated
// -----------------------------------------------------------------------------

const primeStash = (items: IItem[], gold = 10_000) => {
  usePlayerStore.setState(s => ({
    player: { ...s.player, bank: { ...s.player.bank, gold, stashTabs: [{ name: 'MAIN', items }] } }
  }));
};

const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;

const buildingKit = () => [
  ...Array.from({ length: 8 }, (_, i) => mint('crf_plank', `bars:plank:${i}`)),
  ...Array.from({ length: 3 }, (_, i) => mint('crf_iron_ingot', `bars:ingot:${i}`)),
  ...Array.from({ length: 2 }, (_, i) => mint('crf_glass', `bars:glass:${i}`))
];

async function ownedLot() {
  useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as any);
  await useHubStore.getState().loadHub('hub_bars');
  primeStash(buildingKit());
  // Setup moved for the stretch: lot 0 is 8x8 now, and lot 3 is the 4x4 this bar has always meant.
  const lotId = useHubStore.getState().lots[3].id;
  const ok = await useHubStore.getState().buyLot(lotId);
  expect(ok).toBe(true);
  return lotId;
}

const finishJobs = () =>
  useHubStore.setState(s => ({ buildJobs: (s as any).buildJobs.map((j: any) => ({ ...j, finishesAt: 0 })) } as any));

describe('construction: materials are consumed exactly once per step', () => {
  it('a shell consumes its bill at queue time and never again', async () => {
    const lotId = await ownedLot();
    const before = stash().length;
    const ok = await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    expect(ok).toBe(true);
    // D25: this owner's first bench. The bar is unchanged: exactly the bill, exactly once.
    const bill = shellBillFor('WORKSHOP', false).reduce((n, line) => n + line.count, 0);
    expect(stash().length).toBe(before - bill);

    // Not built until the clock says so
    expect(useHubStore.getState().lots.find(l => l.id === lotId)!.structureType).toBe('EMPTY');

    finishJobs();
    await useHubStore.getState().resolveBuilds();
    await useHubStore.getState().resolveBuilds(); // resolving twice must not double anything
    const hub = useHubStore.getState();
    expect(hub.lots.find(l => l.id === lotId)!.structureType).toBe('WORKSHOP');
    expect(stash().length).toBe(before - bill + 1); // exactly one minted bench
    expect(stash().filter(i => i.universalDefinitionId === SHELL_STATION.WORKSHOP).length).toBe(1);
    expect((hub as any).rooms[lotId]).toBeTruthy();
    expect((hub as any).rooms[lotId].pieces.length).toBe(0);
  });

  it('a refused shell consumes nothing', async () => {
    const lotId = await ownedLot();
    primeStash([mint('crf_plank', 'bars:lone')]); // far short of the bill
    const before = stash().length;
    const ok = await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    expect(ok).toBe(false);
    expect(stash().length).toBe(before);
  });

  it('a wall piece consumes its one material, signed, and applies on the clock', async () => {
    const lotId = await ownedLot();
    await useHubStore.getState().buildStructure(lotId, 'HOUSE');
    finishJobs();
    await useHubStore.getState().resolveBuilds();

    const plank = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    const before = stash().length;
    const res = await useHubStore.getState().queuePiece(lotId, 'WALL', 4, 4, plank.id);
    expect(res.ok).toBe(true);
    expect(stash().length).toBe(before - 1);
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    const room: IRoomState = (useHubStore.getState() as any).rooms[lotId];
    expect(room.pieces.length).toBe(1);
    expect(room.pieces[0].kind).toBe('WALL');
    expect(room.pieces[0].materialDefId).toBe('crf_plank');
    expect(room.pieces[0].signature).toBeTruthy(); // every completed step is a signed record
  });
});

// -----------------------------------------------------------------------------
// LINE 33 — the bench and the counter call the same store functions
// -----------------------------------------------------------------------------

describe('line 33: stations call the one store, no duplicate logic', () => {
  it('the bench is the workshop: the same queueCraft answers it', async () => {
    const lotId = await ownedLot();
    await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    expect(STATION_FUNCTION.stn_bench).toBe('WORKSHOP');

    // Place the minted bench, then craft through the same function the panel calls.
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
    const placed = await useHubStore.getState().placeItem(lotId, bench.id, 6, 3, false);
    expect(placed.ok).toBe(true);

    primeStash([...stash(), mint('crf_plank', 'bars:log-sub')]); // keep kit
    const log = ItemFactory.createResourceItem(
      (await import('../src/entities/item/data/resourceDefinitions')).RESOURCE_DEFINITIONS['res_tree_log'], Rng.fromKey('bars:log')
    );
    primeStash([...stash(), log]);
    const ok = await useHubStore.getState().queueCraft(lotId, 'recipe_plank');
    expect(ok).toBe(true);
    expect(RECIPE_DEFINITIONS.recipe_table.outputs[0].itemId).toBe('stn_table'); // the table line exists
  });

  it('the counter is the shop: list and sell through the same functions', async () => {
    const lotId = await ownedLot();
    await useHubStore.getState().buildStructure(lotId, 'VENDOR');
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    expect(STATION_FUNCTION.stn_counter).toBe('VENDOR');

    const counter = stash().find(i => i.universalDefinitionId === 'stn_counter')!;
    const placed = await useHubStore.getState().placeItem(lotId, counter.id, 5, 4, false);
    expect(placed.ok).toBe(true);

    const ware = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    expect(await useHubStore.getState().listItemForSale(lotId, ware.id, 25)).toBe(true);
    const lot = useHubStore.getState().lots.find(l => l.id === lotId)!;
    expect(lot.shopListings?.length).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// LINES 32 & 34 — the room survives a reload; a placement is never lost, never
// duplicated, and carries its signature
// -----------------------------------------------------------------------------

describe('lines 32 and 34: the room is the same after a reload, placements signed', () => {
  it('shell, wall and placement all survive a cold reload, byte for byte', async () => {
    const lotId = await ownedLot();
    await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    const plank = stash().find(i => i.universalDefinitionId === 'crf_plank')!;
    await useHubStore.getState().queuePiece(lotId, 'WALL', 4, 4, plank.id);
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
    const placed = await useHubStore.getState().placeItem(lotId, bench.id, 8, 5, false);
    expect(placed.ok).toBe(true);
    expect(stash().some(i => i.id === bench.id)).toBe(false); // it left the stash

    const beforeRoom: IRoomState = (useHubStore.getState() as any).rooms[lotId];
    const beforeHash = hashBytes(composeRoom(beforeRoom).data);
    expect(beforeRoom.placements[0].signature).toBeTruthy(); // line 34: signed

    // Cold reload: a fresh store reads only what was persisted.
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as any);
    await useHubStore.getState().loadHub('hub_bars');
    const afterRoom: IRoomState = (useHubStore.getState() as any).rooms[lotId];
    expect(afterRoom).toBeTruthy();
    expect(afterRoom.pieces.length).toBe(1);
    expect(afterRoom.placements.length).toBe(1);
    expect(afterRoom.placements[0].item.id).toBe(bench.id);
    expect(hashBytes(composeRoom(afterRoom).data)).toBe(beforeHash); // line 32: the same room

    // Never duplicated: the placed item exists once, in the room, not the stash.
    expect(stash().filter(i => i.id === bench.id).length).toBe(0);

    // Reclaim returns it exactly once.
    const got = await useHubStore.getState().reclaimItem(lotId, afterRoom.placements[0].id);
    expect(got).toBe(true);
    expect(stash().filter(i => i.id === bench.id).length).toBe(1);
    expect(((useHubStore.getState() as any).rooms[lotId] as IRoomState).placements.length).toBe(0);
    expect(await useHubStore.getState().reclaimItem(lotId, afterRoom.placements[0].id)).toBe(false);
  });

  it('a foreclosed lot returns its placements to the owner; nothing is lost', async () => {
    const lotId = await ownedLot();
    await useHubStore.getState().buildStructure(lotId, 'WORKSHOP');
    finishJobs();
    await useHubStore.getState().resolveBuilds();
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
    await useHubStore.getState().placeItem(lotId, bench.id, 8, 5, false);

    // Strip the gold so upkeep cannot be paid, then jump ten days.
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 0 } } }));
    const day = Math.floor(Date.now() / 86_400_000);
    await useHubStore.getState().resolveUpkeep(day + 10);

    const hub = useHubStore.getState();
    const lot = hub.lots.find(l => l.id === lotId)!;
    expect(lot.ownerId).toBeNull();
    expect(lot.structureType).toBe('EMPTY');
    expect((hub as any).rooms[lotId]).toBeFalsy(); // the room went with the lot
    expect(stash().filter(i => i.id === bench.id).length).toBe(1); // the bench came home
  });
});

// -----------------------------------------------------------------------------
// HOUSEKEEPING — bills reference real tags; presets reference real stations
// -----------------------------------------------------------------------------

describe('the bills are payable', () => {
  it('every bill tag is carried by at least one craftable definition', () => {
    const tags = new Set(Object.values(CRAFTED_DEFINITIONS).flatMap(d => d.tags || []));
    for (const line of Object.values(PIECE_BILLS)) expect(tags.has(line.tag), line.tag).toBe(true);
    for (const bill of Object.values(SHELL_BILLS)) for (const line of bill) expect(tags.has(line.tag), line.tag).toBe(true);
  });

  it('every preset station is a real definition with a minimum area', () => {
    for (const preset of ROOM_PRESETS) {
      for (const st of preset.stations) {
        expect(CRAFTED_DEFINITIONS[st.defId], st.defId).toBeTruthy();
        expect(STATION_MIN_AREA[st.defId], st.defId).toBeGreaterThan(0);
      }
    }
  });

  it('station ranks render: every station mints with real art dimensions', () => {
    for (const defId of ['stn_bench', 'stn_counter', 'stn_table']) {
      const item = mint(defId, `bars:art:${defId}`);
      expect(item.dimensions.width).toBeGreaterThan(0);
      const place: IRoomPlacement = { id: 'p', item, x: 2, y: 2, rotated: true, placedBy: 'u', at: 1 };
      const f = { w: item.dimensions.height, h: item.dimensions.width };
      expect(f.w).toBeGreaterThan(0);
      expect(place.rotated).toBe(true);
    }
  });
});

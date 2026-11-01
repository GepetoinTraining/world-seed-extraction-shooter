/**
 * THE HUB'S MANIFEST (D74): a matrix that places the buildings.
 *
 * A chunk is the grid's own 64 tiles, read here as 16 by 16 cells of 4 tiles. Each
 * chunk writes two matrices: `floor` says which district a cell is, `place` says
 * what stands with its corner at that cell. Nothing else in the code holds a
 * coordinate: zones, things, the navmesh, the map and walking all read from this.
 *
 * The first chunk raised is the middle one. Each later chunk rises beside one
 * already standing, on a side someone chooses (the guild, in B4). A plan says what
 * has risen and in what order, and starts at any chunk of whatever ground it stands
 * on, so the same manifest can be planted in a world (D80).
 */

import { CHUNK_TILES, QUADRANT_TILES } from '../world/grid';
import { POIType, ZoneType } from './layoutTypes';

export const CELL_TILES = QUADRANT_TILES / 4;
export const CHUNK_CELLS = CHUNK_TILES / CELL_TILES;

export const EMPTY_MARK = '.';
export const SPAWN_MARK = '@';
/** In the `road` matrix: the main road, which joins chunks, and the streets off it. */
export const ROAD_MAIN = '=';
export const ROAD_STREET = '-';

/** What a mark in the `place` matrix stands for. Plain data: a manifest can arrive from anywhere. */
export interface IManifestMark {
  type: POIType;
  /** `{n}` is the thing's number in its series, counted from one. */
  name: string;
  size: { width: number; height: number };
  interactable: boolean;
  /** Blocks walking wherever it stands. A lot is not solid until something is built on it. */
  solid: boolean;
  metadata: Record<string, any>;
  npcId?: string;
  /** One of a kind: this id, and it may stand only in the first chunk. */
  id?: string;
  /** Or one of many: `series_0`, `series_1`..., counted across the hub in the order chunks rose. */
  series?: string;
  /** Grows from `size` over its own floor until a road, a neighbour or the floor's end stops it. */
  stretch?: boolean;
}

/** What a letter in the `floor` matrix stands for. */
export interface IManifestFloor {
  id: string;
  name: string;
  type: ZoneType;
  ambientColor: string;
  floorTexture: string;
}

export interface IChunkManifest {
  floor: string[];
  place: string[];
  /** Where the roads run. Walkable, and nothing may stand on one. */
  road: string[];
}

export interface IHubManifest {
  id: string;
  name: string;
  version: string;
  marks: Record<string, IManifestMark>;
  floors: Record<string, IManifestFloor>;
  chunks: Record<string, IChunkManifest>;
  /** The chunk a hub starts with. */
  first: string;
  /** The chunk that rises when nobody names another. */
  growth: string;
  /** What one tile of lot asks at the very centre of the hub, on the main road. See `lotPrice`. */
  lotGoldPerTile: number;
  /** The cells where every chunk's main road meets its edge, so any two chunks join. */
  gates: { col: number; row: number };
  /** What a lot locked out of the street asks, as a share of what it would. */
  lockedShare: number;
}

export const NEW_CARLEON: IHubManifest = {
  id: 'hub_carleon',
  name: 'New Carleon',
  version: '2.0.0',
  // A guess until Wave 12: this makes a 4 by 4 lot on Homestead Row ask about what the flat 5,000 did.
  lotGoldPerTile: 480,
  gates: { col: 11, row: 8 },
  lockedShare: 0.75,
  floors: {
    P: { id: 'zone_plaza', name: 'Central Plaza', type: ZoneType.PLAZA, ambientColor: '#1a1a2e', floorTexture: 'cobblestone' },
    M: { id: 'zone_market', name: 'Market District', type: ZoneType.MARKET, ambientColor: '#2d1b1b', floorTexture: 'wooden_planks' },
    T: { id: 'zone_tavern', name: 'The Rusty Anchor', type: ZoneType.GARDEN, ambientColor: '#1f2937', floorTexture: 'dirt' },
    R: { id: 'zone_residential', name: 'Homestead Row', type: ZoneType.RESIDENTIAL, ambientColor: '#1a1a1a', floorTexture: 'grass' },
    H: { id: 'zone_homesteads', name: 'New Homesteads', type: ZoneType.RESIDENTIAL, ambientColor: '#1a1a1a', floorTexture: 'grass' }
  },
  marks: {
    F: { id: 'poi_fountain', type: POIType.FOUNTAIN, name: 'Founders Fountain', size: { width: 4, height: 4 }, interactable: false, solid: true, metadata: { particles: 'water' } },
    B: { id: 'poi_bank', type: POIType.BANK, name: 'Consortium Vault', size: { width: 4, height: 3 }, interactable: true, solid: true, npcId: 'npc_banker', metadata: {} },
    N: { id: 'poi_portal', type: POIType.PORTAL, name: 'The Nexus', size: { width: 3, height: 3 }, interactable: true, solid: false, npcId: 'npc_portal_master', metadata: { glowColor: '#06b6d4' } },
    I: { id: 'poi_identifier', type: POIType.IDENTIFIER, name: 'Truthsight Tower', size: { width: 3, height: 3 }, interactable: true, solid: true, npcId: 'npc_identifier', metadata: {} },
    G: { id: 'poi_guild', type: POIType.GUILD_HALL, name: 'Hall of Banners', size: { width: 4, height: 4 }, interactable: true, solid: true, npcId: 'npc_guild_master', metadata: {} },
    W: { id: 'poi_weapons', type: POIType.VENDOR_WEAPONS, name: 'Ironfist Armory', size: { width: 4, height: 3 }, interactable: true, solid: true, npcId: 'npc_weapon_vendor', metadata: {} },
    A: { id: 'poi_armor', type: POIType.VENDOR_ARMOR, name: 'Steelweave Outfitters', size: { width: 4, height: 3 }, interactable: true, solid: true, npcId: 'npc_armor_vendor', metadata: {} },
    C: { id: 'poi_consumables', type: POIType.VENDOR_CONSUMABLES, name: "Alchemist's Corner", size: { width: 3, height: 3 }, interactable: true, solid: true, npcId: 'npc_alchemist', metadata: {} },
    X: { id: 'poi_auction', type: POIType.AUCTION_HOUSE, name: 'The Exchange', size: { width: 5, height: 4 }, interactable: true, solid: true, npcId: 'npc_auctioneer', metadata: {} },
    T: { id: 'poi_tavern', type: POIType.TAVERN, name: 'The Rusty Anchor', size: { width: 5, height: 4 }, interactable: true, solid: true, npcId: 'npc_bartender', metadata: {} },
    l: { series: 'poi_lamp', type: POIType.LAMP_POST, name: 'Street Lamp', size: { width: 1, height: 1 }, interactable: false, solid: true, metadata: { lightRadius: 3 } },
    L: { series: 'poi_lot', type: POIType.PLAYER_LOT, name: 'Lot #{n}', size: { width: 4, height: 4 }, interactable: true, solid: false, stretch: true, metadata: {} }
  },
  chunks: {
    // What has always stood here, with the tavern west, the market south, the lots east.
    carleon: {
      floor: [
        '................',
        '................',
        '................',
        '................',
        '...........RRRR.',
        '.....PPPPP.RRRR.',
        '..TTTPPPPP.RRRR.',
        '..TTTPPPPP.RRRR.',
        '..TTTPPPPP.RRRR.',
        '.....PPPPP.RRRR.',
        '...MMMMMMMMRRRR.',
        '...MMMMMMMM.....',
        '...MMMMMMMM.....',
        '................',
        '................',
        '................'
      ],
      place: [
        '................',
        '................',
        '................',
        '................',
        '................',
        '.....B.N.I..L.L.',
        '......l..l......',
        '...T...F.G..L.L.',
        '.......@........',
        '......l..l..L.L.',
        '................',
        '...WlAlClX......',
        '................',
        '................',
        '................',
        '................'
      ],
      // The main road crosses at the lots and runs through the plaza. The streets
      // are what the lots and the market front onto.
      road: [
        '...........=....',
        '...........=....',
        '...........=....',
        '...........=....',
        '...........=....',
        '...........=....',
        '...........=---.',
        '...........=....',
        '================',
        '...........=....',
        '...........=---.',
        '...........=....',
        '...--------=....',
        '...........=....',
        '...........=....',
        '...........=....',
      ],
    },
    // What rises around it: lots, lamps, and a bare edge for the next chunk to join.
    homesteads: {
      floor: [
        '................',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '................'
      ],
      place: [
        '................',
        '................',
        '................',
        '..L..L..L....L..',
        '................',
        '................',
        '................',
        '..L..L..L....L..',
        '................',
        '.....L.......L..',
        '................',
        '................',
        '..L..L..L....L..',
        '................',
        '...l....l....l..',
        '................'
      ],
      // The same main road, and a street above and below it. Each lot stretches to fill
      // its block. The two marked behind the last row are locked out of the street, and
      // reach it by a passage through the lot in front.
      road: [
        '...........=....',
        '...........=....',
        '...........=....',
        '...........=....',
        '.----------=---.',
        '...........=....',
        '...........=....',
        '...........=....',
        '================',
        '...........=....',
        '...........=....',
        '...........=....',
        '...........=....',
        '.----------=---.',
        '...........=....',
        '...........=....',
      ]
    }
  },
  first: 'carleon',
  growth: 'homesteads'
};

// =============================================================================
// THE PLAN: what has risen, and in what order
// =============================================================================

export type HubSide = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';

export const HUB_SIDES: Record<HubSide, { dx: number; dy: number }> = {
  NORTH: { dx: 0, dy: -1 },
  EAST: { dx: 1, dy: 0 },
  SOUTH: { dx: 0, dy: 1 },
  WEST: { dx: -1, dy: 0 }
};

export interface IRaisedChunk {
  cx: number;
  cy: number;
  kind: string;
}

/** The first chunk is the middle one. The order is kept, because lots are numbered by it. */
export interface IHubPlan {
  chunks: IRaisedChunk[];
}

export type RaiseVerdict = { ok: true; plan: IHubPlan } | { ok: false; reason: string };

export const firstPlan = (manifest: IHubManifest = NEW_CARLEON, at: { cx: number; cy: number } = { cx: 0, cy: 0 }): IHubPlan => ({
  chunks: [{ cx: at.cx, cy: at.cy, kind: manifest.first }]
});

const standing = (plan: IHubPlan, cx: number, cy: number) => plan.chunks.some(c => c.cx === cx && c.cy === cy);

/**
 * One chunk more, on the given side of one already standing (the first, unless
 * another is named). This says only what rises. Who pays, and who chose, is not its business.
 */
export function raiseChunk(
  plan: IHubPlan,
  side: HubSide,
  opts: { beside?: { cx: number; cy: number }; kind?: string } = {},
  manifest: IHubManifest = NEW_CARLEON
): RaiseVerdict {
  const beside = opts.beside ?? plan.chunks[0];
  const kind = opts.kind ?? manifest.growth;
  if (!standing(plan, beside.cx, beside.cy)) return { ok: false, reason: 'Nothing stands there to raise beside.' };
  if (!manifest.chunks[kind]) return { ok: false, reason: `The manifest holds no chunk called ${kind}.` };
  const step = HUB_SIDES[side];
  const cx = beside.cx + step.dx, cy = beside.cy + step.dy;
  if (standing(plan, cx, cy)) return { ok: false, reason: `The ground ${side.toLowerCase()} of there is already raised.` };
  return { ok: true, plan: { chunks: [...plan.chunks, { cx, cy, kind }] } };
}

export interface IOpenSide {
  beside: { cx: number; cy: number };
  side: HubSide;
  at: { cx: number; cy: number };
}

/** Everywhere a chunk could rise next, each place once, nearest the oldest chunks first. */
export function openSides(plan: IHubPlan): IOpenSide[] {
  const seen = new Set<string>();
  const open: IOpenSide[] = [];
  for (const chunk of plan.chunks) {
    for (const side of Object.keys(HUB_SIDES) as HubSide[]) {
      const at = { cx: chunk.cx + HUB_SIDES[side].dx, cy: chunk.cy + HUB_SIDES[side].dy };
      const key = `${at.cx},${at.cy}`;
      if (standing(plan, at.cx, at.cy) || seen.has(key)) continue;
      seen.add(key);
      open.push({ beside: { cx: chunk.cx, cy: chunk.cy }, side, at });
    }
  }
  return open;
}

/**
 * What a free lot asks (Pedro: "a function of proximity to main road/hub center +
 * size"). It rises with the lot's tiles and falls with how far its door stands, walked
 * along the grid, from the middle of the first chunk and from the main road. It halves
 * one chunk from the centre and half a chunk from the road, and keeps falling past that
 * without ever reaching nothing. Both are read within what is already fixed, the first
 * chunk's middle and the lot's own chunk, so raising a chunk moves no price.
 */
export function lotPrice(
  manifest: IHubManifest,
  size: { width: number; height: number },
  where: { fromCentre: number; fromRoad: number; locked?: boolean; carries?: number }
): number {
  const nearCentre = CHUNK_TILES / (CHUNK_TILES + where.fromCentre);
  const nearRoad = (CHUNK_TILES / 2) / (CHUNK_TILES / 2 + where.fromRoad);
  const tiles = Math.max(1, size.width * size.height - (where.carries ?? 0));
  const share = where.locked ? manifest.lockedShare : 1;
  return Math.max(1, Math.round((manifest.lotGoldPerTile * tiles * nearCentre * nearRoad * share) / 50) * 50);
}

/** Tiles along the grid from a tile to the nearest tile of a road cell. */
export const tilesToCell = (from: { x: number; y: number }, cell: { x: number; y: number }) =>
  Math.max(0, cell.x - from.x, from.x - (cell.x + CELL_TILES - 1)) + Math.max(0, cell.y - from.y, from.y - (cell.y + CELL_TILES - 1));

/** The tile you stand on to reach a thing: below its middle. */
export const doorTile = (p: { position: { x: number; y: number }; size: { width: number; height: number } }) => ({
  x: p.position.x + (p.size.width >> 1),
  y: p.position.y + p.size.height
});

// =============================================================================
// A CHUNK, RESOLVED: lots stretched to fill, and a way out for those with no street
// =============================================================================

export interface IResolvedThing {
  mark: string;
  x: number;
  y: number;
  size: { width: number; height: number };
}

/**
 * Servidão: a lot whose door has no road at it holds a right of way to the nearest
 * one, across whatever lies between. It is written into the land, not agreed between
 * owners: the tiles stay open to everyone whatever is built on them. All in tiles from
 * the chunk's corner, door first. `through` indexes the things it crosses.
 */
export interface IResolvedPassage {
  thing: number;
  tiles: { x: number; y: number }[];
  through: number[];
}

export interface IResolvedChunk {
  things: IResolvedThing[];
  spawn: { x: number; y: number } | null;
  passages: IResolvedPassage[];
  /** Things with a door that no way at all can reach. */
  cutOff: number[];
}

const resolved = new WeakMap<IChunkManifest, IResolvedChunk>();
/** The law reads a manifest as written, and may be handed one being edited. */
const resolveChunkFresh = (m: IHubManifest, chunk: IChunkManifest) => stretchAndFree(m, chunk);

/** What this chunk's matrices come to. The same matrices always come to the same chunk. */
export function resolveChunk(m: IHubManifest, chunk: IChunkManifest): IResolvedChunk {
  const known = resolved.get(chunk);
  if (known) return known;
  const res = stretchAndFree(m, chunk);
  resolved.set(chunk, res);
  return res;
}

function stretchAndFree(m: IHubManifest, chunk: IChunkManifest): IResolvedChunk {
  const last = CHUNK_CELLS - 1;
  const cellOf = (cx: number, cy: number) => cy * CHUNK_CELLS + cx;
  const taken = new Uint8Array(CHUNK_CELLS * CHUNK_CELLS);
  const isRoadCell = (cx: number, cy: number) => (chunk.road[cy]?.[cx] ?? EMPTY_MARK) !== EMPTY_MARK;

  const things: IResolvedThing[] = [];
  const rects: { c0: number; r0: number; c1: number; r1: number; letter: string; grows: boolean }[] = [];
  let spawn: { x: number; y: number } | null = null;
  chunk.place.forEach((row, cy) => [...row].forEach((mark, cx) => {
    if (mark === EMPTY_MARK) return;
    if (mark === SPAWN_MARK) { spawn = { x: cx * CELL_TILES, y: cy * CELL_TILES }; return; }
    const def = m.marks[mark];
    if (!def) return;
    const c1 = Math.min(last, cx + Math.ceil(def.size.width / CELL_TILES) - 1);
    const r1 = Math.min(last, cy + Math.ceil(def.size.height / CELL_TILES) - 1);
    for (let r = cy; r <= r1; r++) for (let c = cx; c <= c1; c++) taken[cellOf(c, r)] = 1;
    things.push({ mark, x: cx * CELL_TILES, y: cy * CELL_TILES, size: { ...def.size } });
    rects.push({ c0: cx, r0: cy, c1, r1, letter: chunk.floor[cy]?.[cx] ?? EMPTY_MARK, grows: !!def.stretch });
  }));

  // A round each, in reading order, one row or column at a time, so no lot takes more
  // than its turn. Each grows along its shorter side first, so it stays near a square.
  const free = (cx: number, cy: number, letter: string) =>
    cx > 0 && cy > 0 && cx < last && cy < last && !taken[cellOf(cx, cy)] && !isRoadCell(cx, cy) && chunk.floor[cy][cx] === letter;
  const growers = rects.map((rect, i) => ({ rect, i })).filter(g => g.rect.grows);
  for (let moved = true; moved;) {
    moved = false;
    for (const { rect } of growers) {
      const taller = rect.r1 - rect.r0 > rect.c1 - rect.c0;
      const upDown = [
        { cells: spanX(rect.c0, rect.c1, rect.r0 - 1), take: () => { rect.r0--; } },
        { cells: spanX(rect.c0, rect.c1, rect.r1 + 1), take: () => { rect.r1++; } }
      ];
      const sideways = [
        { cells: spanY(rect.r0, rect.r1, rect.c0 - 1), take: () => { rect.c0--; } },
        { cells: spanY(rect.r0, rect.r1, rect.c1 + 1), take: () => { rect.c1++; } }
      ];
      const edges: { cells: [number, number][]; take: () => void }[] = taller ? [...sideways, ...upDown] : [...upDown, ...sideways];
      for (const edge of edges) {
        if (!edge.cells.every(([c, r]) => free(c, r, rect.letter))) continue;
        edge.cells.forEach(([c, r]) => { taken[cellOf(c, r)] = 1; });
        edge.take();
        moved = true;
        break;
      }
    }
  }
  growers.forEach(({ rect, i }) => {
    things[i].x = rect.c0 * CELL_TILES;
    things[i].y = rect.r0 * CELL_TILES;
    things[i].size = { width: (rect.c1 - rect.c0 + 1) * CELL_TILES, height: (rect.r1 - rect.r0 + 1) * CELL_TILES };
  });

  // Who holds each tile, and which are road.
  const FREE = -1, SOLID = -2;
  const owner = new Int16Array(CHUNK_TILES * CHUNK_TILES).fill(FREE);
  const road = new Uint8Array(CHUNK_TILES * CHUNK_TILES);
  chunk.road.forEach((row, cy) => [...row].forEach((c, cx) => {
    if (c === EMPTY_MARK) return;
    for (let y = 0; y < CELL_TILES; y++) for (let x = 0; x < CELL_TILES; x++) road[(cy * CELL_TILES + y) * CHUNK_TILES + cx * CELL_TILES + x] = 1;
  }));
  const isLot = (t: IResolvedThing) => m.marks[t.mark].type === POIType.PLAYER_LOT;
  const edgeOf = (t: IResolvedThing, x: number, y: number) =>
    x === t.x || y === t.y || x === t.x + t.size.width - 1 || y === t.y + t.size.height - 1;
  things.forEach((t, i) => {
    const solid = m.marks[t.mark].solid;
    if (!solid && !isLot(t)) return;
    for (let y = t.y; y < t.y + t.size.height; y++) for (let x = t.x; x < t.x + t.size.width; x++) {
      if (y < CHUNK_TILES && x < CHUNK_TILES) owner[y * CHUNK_TILES + x] = solid ? SOLID : i;
    }
  });

  const passages: IResolvedPassage[] = [];
  const cutOff: number[] = [];
  things.forEach((t, i) => {
    if (!isLot(t)) return;
    const door = doorTile({ position: { x: t.x, y: t.y }, size: t.size });
    const atRoad = (x: number, y: number) =>
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => road[(y + dy) * CHUNK_TILES + x + dx] === 1 && x + dx >= 0 && x + dx < CHUNK_TILES && y + dy >= 0 && y + dy < CHUNK_TILES);
    if (door.x >= CHUNK_TILES || door.y >= CHUNK_TILES || owner[door.y * CHUNK_TILES + door.x] === SOLID) { cutOff.push(i); return; }
    if (atRoad(door.x, door.y) && owner[door.y * CHUNK_TILES + door.x] === FREE) return;

    // Cheapest way to a road: open ground is cheapest, a neighbour's edge costs more, and
    // the middle of a neighbour's land costs most, so a building still fits beside it.
    const OPEN = 1, EDGE = 3, MIDDLE = 12;
    const cost = (x: number, y: number) => {
      const who = owner[y * CHUNK_TILES + x];
      if (who === FREE) return OPEN;
      return edgeOf(things[who], x, y) ? EDGE : MIDDLE;
    };
    const dist = new Int32Array(CHUNK_TILES * CHUNK_TILES).fill(-1);
    const from = new Int32Array(CHUNK_TILES * CHUNK_TILES).fill(-1);
    const buckets: number[][] = [];
    const push = (d: number, index: number) => { (buckets[d] ??= []).push(index); };
    const start = door.y * CHUNK_TILES + door.x;
    dist[start] = 0;
    push(0, start);
    let found = -1;
    for (let d = 0; d < buckets.length && found < 0; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let b = 0; b < bucket.length && found < 0; b++) {
        const index = bucket[b];
        if (dist[index] !== d) continue;
        const x = index % CHUNK_TILES, y = (index - x) / CHUNK_TILES;
        if (atRoad(x, y) && !road[index]) { found = index; break; }
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= CHUNK_TILES || ny >= CHUNK_TILES) continue;
          const next = ny * CHUNK_TILES + nx;
          const who = owner[next];
          if (who === SOLID || who === i || road[next]) continue;
          const nd = d + cost(nx, ny);
          if (dist[next] !== -1 && dist[next] <= nd) continue;
          dist[next] = nd;
          from[next] = index;
          push(nd, next);
        }
      }
    }
    if (found < 0) { cutOff.push(i); return; }
    const tiles: { x: number; y: number }[] = [];
    for (let at = found; at !== -1; at = from[at]) {
      const x = at % CHUNK_TILES;
      tiles.unshift({ x, y: (at - x) / CHUNK_TILES });
    }
    const through = [...new Set(tiles.map(p => owner[p.y * CHUNK_TILES + p.x]).filter(who => who >= 0))];
    passages.push({ thing: i, tiles, through });
  });

  return { things, spawn, passages, cutOff };
}

const spanX = (c0: number, c1: number, r: number): [number, number][] => Array.from({ length: c1 - c0 + 1 }, (_, i) => [c0 + i, r]);
const spanY = (r0: number, r1: number, c: number): [number, number][] => Array.from({ length: r1 - r0 + 1 }, (_, i) => [c, r0 + i]);

// =============================================================================
// THE LAW: what a manifest must be, whoever wrote it
// =============================================================================

/** Roads: known marks, meeting the edge only at the gates, all one network, under nothing. */
function roadLaw(
  m: IHubManifest,
  kind: string,
  chunk: IChunkManifest,
  taken: Uint8Array
): string[] {
  const out: string[] = [];
  const last = CHUNK_CELLS - 1;
  const cells: { cx: number; cy: number }[] = [];
  chunk.road.forEach((row, cy) => [...row].forEach((c, cx) => {
    if (c === EMPTY_MARK) return;
    if (c !== ROAD_MAIN && c !== ROAD_STREET) { out.push(`${kind}: no road called ${c}.`); return; }
    cells.push({ cx, cy });
    for (let y = 0; y < CELL_TILES; y++) for (let x = 0; x < CELL_TILES; x++) {
      if (taken[(cy * CELL_TILES + y) * CHUNK_TILES + cx * CELL_TILES + x]) { out.push(`${kind}: something stands on the road at ${cx},${cy}.`); return; }
    }
  }));

  for (let i = 0; i <= last; i++) {
    const edges: [number, number, boolean][] = [
      [i, 0, i === m.gates.col], [i, last, i === m.gates.col],
      [0, i, i === m.gates.row], [last, i, i === m.gates.row]
    ];
    for (const [cx, cy, isGate] of edges) {
      const c = chunk.road[cy]?.[cx];
      if (isGate && c !== ROAD_MAIN) out.push(`${kind}: the gate at ${cx},${cy} has no main road, so the next chunk cannot join.`);
      if (!isGate && c !== EMPTY_MARK) out.push(`${kind}: a road reaches the edge at ${cx},${cy}, which is no gate.`);
    }
  }

  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const known = new Set(cells.map(c => key(c.cx, c.cy)));
  const seen = new Set<string>();
  const stack = cells.slice(0, 1);
  while (stack.length) {
    const { cx, cy } = stack.pop()!;
    if (seen.has(key(cx, cy))) continue;
    seen.add(key(cx, cy));
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      if (known.has(key(cx + dx, cy + dy))) stack.push({ cx: cx + dx, cy: cy + dy });
    });
  }
  if (seen.size !== cells.length) out.push(`${kind}: its roads do not all connect.`);
  return out;
}

/** Why this manifest could not stand. Nothing back means it can. */
export function validateManifest(m: IHubManifest): string[] {
  const out: string[] = [];
  if (!m.chunks[m.first]) out.push(`The first chunk, ${m.first}, is not in the manifest.`);
  if (!m.chunks[m.growth]) out.push(`The growth chunk, ${m.growth}, is not in the manifest.`);
  if (!(m.lotGoldPerTile > 0)) out.push('A lot has to ask something: lotGoldPerTile must be above nothing.');

  for (const [kind, chunk] of Object.entries(m.chunks)) {
    const shaped = (rows: string[], what: string) => {
      const ok = rows.length === CHUNK_CELLS && rows.every(r => r.length === CHUNK_CELLS);
      if (!ok) out.push(`${kind}: every ${what} row must be ${CHUNK_CELLS} cells, and there must be ${CHUNK_CELLS} of them.`);
      return ok;
    };
    if (!shaped(chunk.floor, 'floor') || !shaped(chunk.place, 'place') || !shaped(chunk.road, 'road')) continue;

    // Floors: each letter known, and each district one rectangle.
    const spans = new Map<string, { x0: number; y0: number; x1: number; y1: number; cells: number }>();
    chunk.floor.forEach((row, y) => [...row].forEach((letter, x) => {
      if (letter === EMPTY_MARK) return;
      if (!m.floors[letter]) { out.push(`${kind}: no floor called ${letter}.`); return; }
      const s = spans.get(letter) ?? { x0: x, y0: y, x1: x, y1: y, cells: 0 };
      s.x0 = Math.min(s.x0, x); s.y0 = Math.min(s.y0, y); s.x1 = Math.max(s.x1, x); s.y1 = Math.max(s.y1, y); s.cells++;
      spans.set(letter, s);
    }));
    spans.forEach((s, letter) => {
      if (s.cells !== (s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1)) out.push(`${kind}: the floor ${letter} is not a rectangle.`);
    });

    // Things: each mark known, on a floor, off the edge, inside the chunk, touching nothing.
    const solid = new Uint8Array(CHUNK_TILES * CHUNK_TILES);
    const taken = new Uint8Array(CHUNK_TILES * CHUNK_TILES);
    const placed: { mark: string; position: { x: number; y: number }; size: { width: number; height: number }; interactable: boolean }[] = [];
    let spawns = 0;
    chunk.place.forEach((row, cy) => [...row].forEach((mark, cx) => {
      if (mark === EMPTY_MARK) return;
      const edge = cx === 0 || cy === 0 || cx === CHUNK_CELLS - 1 || cy === CHUNK_CELLS - 1;
      if (edge) out.push(`${kind}: ${mark} stands on the chunk's edge, where the next chunk has to join.`);
      if (mark === SPAWN_MARK) { spawns++; return; }
      const def = m.marks[mark];
      if (!def) { out.push(`${kind}: no mark called ${mark}.`); return; }
      if (!!def.id === !!def.series) out.push(`${mark}: a mark is one of a kind or one of a series, and never both.`);
      if (def.id && kind !== m.first) out.push(`${kind}: ${def.id} is one of a kind, and this chunk can rise many times.`);
      if (chunk.floor[cy][cx] === EMPTY_MARK) out.push(`${kind}: ${mark} at ${cx},${cy} has no floor under it.`);
      const position = { x: cx * CELL_TILES, y: cy * CELL_TILES };
      if (position.x + def.size.width > CHUNK_TILES || position.y + def.size.height > CHUNK_TILES) {
        out.push(`${kind}: ${mark} at ${cx},${cy} runs out of the chunk.`);
        return;
      }
      for (let y = position.y; y < position.y + def.size.height; y++) for (let x = position.x; x < position.x + def.size.width; x++) {
        const i = y * CHUNK_TILES + x;
        if (taken[i]) out.push(`${kind}: ${mark} at ${cx},${cy} overlaps what stands there.`);
        taken[i] = 1;
        if (def.solid) solid[i] = 1;
      }
      placed.push({ mark, position, size: def.size, interactable: def.interactable });
    }));
    out.push(...roadLaw(m, kind, chunk, taken));
    const free = resolveChunkFresh(m, chunk);
    free.cutOff.forEach(i => {
      const t = free.things[i];
      out.push(`${kind}: the door of ${t.mark} at ${t.x},${t.y} cannot be reached, by any passage.`);
    });
    const wantSpawns = kind === m.first ? 1 : 0;
    if (spawns !== wantSpawns) out.push(`${kind}: it must hold ${wantSpawns} place to arrive, and it holds ${spawns}.`);

    // Reach: from the bare edge, which every chunk shares, to every door.
    const seen = new Uint8Array(CHUNK_TILES * CHUNK_TILES);
    const queue: number[] = [];
    const visit = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= CHUNK_TILES || y >= CHUNK_TILES) return;
      const i = y * CHUNK_TILES + x;
      if (seen[i] || solid[i]) return;
      seen[i] = 1;
      queue.push(i);
    };
    for (let i = 0; i < CHUNK_TILES; i++) { visit(i, 0); visit(i, CHUNK_TILES - 1); visit(0, i); visit(CHUNK_TILES - 1, i); }
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % CHUNK_TILES, y = (i - x) / CHUNK_TILES;
      visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
    }
    // A lot's way out is the servidão's business, and it says so if there is none.
    placed.filter(p => p.interactable && m.marks[p.mark].type !== POIType.PLAYER_LOT).forEach(p => {
      const d = doorTile(p);
      if (d.y >= CHUNK_TILES || !seen[d.y * CHUNK_TILES + d.x]) out.push(`${kind}: the door of ${p.mark} at ${p.position.x},${p.position.y} cannot be reached.`);
    });
  }
  return out;
}

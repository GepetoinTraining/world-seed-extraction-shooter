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
  /** What one tile of lot asks at the very centre of the hub. See `lotPrice`. */
  lotGoldPerTile: number;
}

export const NEW_CARLEON: IHubManifest = {
  id: 'hub_carleon',
  name: 'New Carleon',
  version: '2.0.0',
  // A guess until Wave 12: this makes a 4 by 4 lot on Homestead Row ask about what the flat 5,000 did.
  lotGoldPerTile: 440,
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
    L: { series: 'poi_lot', type: POIType.PLAYER_LOT, name: 'Lot #{n}', size: { width: 4, height: 4 }, interactable: true, solid: false, metadata: {} },
    s: { series: 'poi_lot', type: POIType.PLAYER_LOT, name: 'Lot #{n}', size: { width: 3, height: 3 }, interactable: true, solid: false, metadata: {} },
    D: { series: 'poi_lot', type: POIType.PLAYER_LOT, name: 'Lot #{n}', size: { width: 6, height: 5 }, interactable: true, solid: false, metadata: {} }
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
      ]
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
        '...D..L..L..D...',
        '................',
        '.....l.....l....',
        '................',
        '...L..s..s..L...',
        '................',
        '.....l.....l....',
        '................',
        '...D..L..L..D...',
        '................',
        '................',
        '................',
        '................'
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
 * size"). It rises with the lot's tiles and falls with how far its door stands from
 * the middle of the first chunk, walked along the grid. Half price is one chunk out,
 * and it keeps falling past that without ever reaching nothing. The first chunk is
 * the centre for good, so raising a chunk moves no price.
 */
export function lotPrice(manifest: IHubManifest, size: { width: number; height: number }, tilesFromCentre: number): number {
  const nearness = CHUNK_TILES / (CHUNK_TILES + tilesFromCentre);
  return Math.max(1, Math.round((manifest.lotGoldPerTile * size.width * size.height * nearness) / 50) * 50);
}

/** The tile you stand on to reach a thing: below its middle. */
export const doorTile = (p: { position: { x: number; y: number }; size: { width: number; height: number } }) => ({
  x: p.position.x + (p.size.width >> 1),
  y: p.position.y + p.size.height
});

// =============================================================================
// THE LAW: what a manifest must be, whoever wrote it
// =============================================================================

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
    if (!shaped(chunk.floor, 'floor') || !shaped(chunk.place, 'place')) continue;

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
    placed.filter(p => p.interactable).forEach(p => {
      const d = doorTile(p);
      if (d.y >= CHUNK_TILES || !seen[d.y * CHUNK_TILES + d.x]) out.push(`${kind}: the door of ${p.mark} at ${p.position.x},${p.position.y} cannot be reached.`);
    });
  }
  return out;
}

/**
 * THE MINIMAP (the usability pass): a small map drawn from the atoms, one buffer
 * in the machine's own ramps, so it reads in grayscale. Marks are shapes. In the
 * field it keeps the fog: what has not been seen draws as static that depends on
 * nothing about the world; a scanned sector reads only what recon already said.
 */

import { BiomeType, IMap } from '../../entities/world/types';
import { TerrainSystem } from '../../entities/world/TerrainSystem';
import { CHUNK_TILES, QUADRANT_TILES, SECTOR_PX, TILE_PX, quadrantOf, sectorOf } from '../../entities/world/grid';
import { CELL_TILES } from '../../entities/hub/hubManifest';
import { Role, Sprite, hash2, px } from './atoms';
import { RECON_CELL_ATOMS, reconCell } from './recon';

export const MINIMAP_ATOMS = 88;
const TILES_PER_ATOM = 2;
const QUADRANT_ATOMS = QUADRANT_TILES / TILES_PER_ATOM;

export type MinimapMark = 'PLAYER' | 'HOSTILE' | 'EXIT' | 'THING';

const GROUND = px(Role.GROUND, 1);
const BLOCKED = px(Role.MATTER, 3);
const STATIC_DARK = px(Role.VOID, 0);
const STATIC_LIT = px(Role.VOID, 1);

const MARKS: Record<MinimapMark, { ink: number; cells: [number, number][] }> = {
  // A cross, always at the center
  PLAYER: { ink: px(Role.SIGNAL, 4), cells: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]] },
  // An X: what can hurt you
  HOSTILE: { ink: px(Role.LOSS, 4), cells: [[0, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]] },
  // A hollow lozenge, the survey's own exit mark
  EXIT: { ink: px(Role.PROOF, 4), cells: [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2]] },
  // A single bright dot: anything else you can see
  THING: { ink: px(Role.MATTER, 4), cells: [[0, 0]] }
};

export const minimapMark = (kind: MinimapMark) => MARKS[kind];

function stamp(data: Uint8Array, w: number, h: number, cx: number, cy: number, kind: MinimapMark) {
  const mark = MARKS[kind];
  for (const [dx, dy] of mark.cells) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = mark.ink;
  }
}

// Terrain is a pure function of seed and tile, so a quadrant is read once. This
// holds work, not knowledge: `seen` alone decides what may be drawn.
const terrain = new Map<string, Uint8Array>();
const MAX_HELD_QUADRANTS = 2048;

function quadrantTerrain(seed: string, qx: number, qy: number): Uint8Array {
  const key = `${seed}:${qx},${qy}`;
  let cell = terrain.get(key);
  if (cell) return cell;
  cell = new Uint8Array(QUADRANT_ATOMS * QUADRANT_ATOMS);
  for (let ay = 0; ay < QUADRANT_ATOMS; ay++) for (let ax = 0; ax < QUADRANT_ATOMS; ax++) {
    const blocked = TerrainSystem.isBlockedTile(seed, qx * QUADRANT_TILES + ax * TILES_PER_ATOM, qy * QUADRANT_TILES + ay * TILES_PER_ATOM);
    cell[ay * QUADRANT_ATOMS + ax] = blocked ? BLOCKED : GROUND;
  }
  if (terrain.size >= MAX_HELD_QUADRANTS) terrain.clear();
  terrain.set(key, cell);
  return cell;
}

const reconCells = new Map<string, Uint8Array>();
function sectorInk(biome: BiomeType, level: number): Uint8Array {
  const key = `${biome}:${level}`;
  let cell = reconCells.get(key);
  if (!cell) {
    cell = reconCell({ biome, scanLevel: level, seed: 'minimap', sx: 0, sy: 0 }).data;
    reconCells.set(key, cell);
  }
  return cell;
}

export interface FieldMinimapInput {
  map: Pick<IMap, 'seed' | 'sectors'>;
  center: { x: number; z: number };
  /** Quadrants this session has had in sight, as "qx,qy". */
  seen: Set<string>;
  things: { x: number; y: number; kind: 'HOSTILE' | 'THING' }[];
  exits: { x: number; y: number }[];
  /** Chests this character has found, drawn wherever they are: knowledge, as last seen. */
  marks?: { x: number; y: number; empty: boolean }[];
}

/** A found chest: a solid block, or only its corners if it was last seen empty. Told apart by shape. */
function stampChest(data: Uint8Array, size: number, sx: number, sy: number, empty: boolean) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (empty && (dx === 0 || dy === 0)) continue;
    const ax = sx + dx, ay = sy + dy;
    if (ax >= 0 && ay >= 0 && ax < size && ay < size) data[ay * size + ax] = px(Role.MATTER, 4);
  }
}

export function fieldMinimap(input: FieldMinimapInput): Sprite {
  const { map, center, seen } = input;
  const size = MINIMAP_ATOMS;
  const data = new Uint8Array(size * size);
  const atomPx = TILES_PER_ATOM * TILE_PX;
  const half = size >> 1;
  const cqx = Math.floor(center.x / atomPx), cqy = Math.floor(center.z / atomPx);

  let lastQ = '', lastKnown = false, lastCell: Uint8Array | null = null;
  for (let sy = 0; sy < size; sy++) {
    const wy = cqy + sy - half;
    const qy = Math.floor(wy / QUADRANT_ATOMS);
    for (let sx = 0; sx < size; sx++) {
      const wx = cqx + sx - half;
      const qx = Math.floor(wx / QUADRANT_ATOMS);
      const q = `${qx},${qy}`;
      if (q !== lastQ) {
        lastQ = q;
        lastKnown = seen.has(q);
        lastCell = lastKnown ? quadrantTerrain(map.seed, qx, qy) : null;
      }
      if (lastCell) {
        const ax = wx - qx * QUADRANT_ATOMS, ay = wy - qy * QUADRANT_ATOMS;
        data[sy * size + sx] = lastCell[ay * QUADRANT_ATOMS + ax];
        continue;
      }
      // Not seen. A scanned sector shows what the survey showed; the rest is static
      // keyed on nothing but where the cell is, so it can say nothing of the world.
      const sector = map.sectors[`${sectorOf(wx * atomPx)},${sectorOf(wy * atomPx)}`];
      if (sector && sector.scanLevel > 0) {
        const ink = sectorInk(sector.biome, sector.scanLevel);
        const rx = ((wx % RECON_CELL_ATOMS) + RECON_CELL_ATOMS) % RECON_CELL_ATOMS;
        const ry = ((wy % RECON_CELL_ATOMS) + RECON_CELL_ATOMS) % RECON_CELL_ATOMS;
        data[sy * size + sx] = ink[ry * RECON_CELL_ATOMS + rx];
      } else {
        data[sy * size + sx] = hash2(4177, wx, wy) % 5 === 0 ? STATIC_LIT : STATIC_DARK;
      }
    }
  }

  const toScreen = (x: number, y: number) => ({
    sx: Math.floor(x / atomPx) - cqx + half,
    sy: Math.floor(y / atomPx) - cqy + half
  });
  const inSeen = (x: number, y: number) => seen.has(`${quadrantOf(x)},${quadrantOf(y)}`);
  const scannedExit = (x: number, y: number) => {
    const sector = map.sectors[`${Math.floor(x / SECTOR_PX)},${Math.floor(y / SECTOR_PX)}`];
    return !!sector && sector.scanLevel > 0 && sector.hasExtraction;
  };

  for (const thing of input.things) {
    if (!inSeen(thing.x, thing.y)) continue;
    const { sx, sy } = toScreen(thing.x, thing.y);
    stamp(data, size, size, sx, sy, thing.kind);
  }
  for (const exit of input.exits) {
    if (!inSeen(exit.x, exit.y) && !scannedExit(exit.x, exit.y)) continue;
    const { sx, sy } = toScreen(exit.x, exit.y);
    stamp(data, size, size, sx, sy, 'EXIT');
  }
  for (const mark of input.marks ?? []) {
    const { sx, sy } = toScreen(mark.x, mark.y);
    stampChest(data, size, sx, sy, mark.empty);
  }
  stamp(data, size, size, half, half, 'PLAYER');
  return { w: size, h: size, data };
}

// ---------------------------------------------------------------------------
// THE CITY: known ground, drawn whole. A lot reads its state by fill.
// ---------------------------------------------------------------------------

export interface CityLayoutLike {
  width: number;
  height: number;
  navMesh: boolean[][];
  zones: { pois: { id: string; type: string; position: { x: number; y: number }; size: { width: number; height: number }; metadata?: Record<string, any> }[] }[];
  chunks: { x: number; y: number }[];
  roads: { x: number; y: number; main: boolean }[];
  passages: { tiles: { x: number; y: number }[] }[];
}

const ROAD_INK = { main: px(Role.GROUND, 4), street: px(Role.GROUND, 3) };

const LOT_INK = {
  outline: px(Role.MATTER, 4),
  built: px(Role.MATTER, 3),
  empty: GROUND
};

const CITY_SCALE = 2;
/** The map's own size. A hub this grows past keeps the map this big, and the map follows you. */
const CITY_MAP_ATOMS = CHUNK_TILES * CITY_SCALE;

/** `lots` maps a lot index to its state; anything built fills, the rest stays hollow. */
export function cityMinimap(layout: CityLayoutLike, lots: Partial<Record<number, string>>, tile: { x: number; y: number }): Sprite {
  const s = Math.max(1, Math.min(CITY_SCALE, Math.floor(CITY_MAP_ATOMS / Math.max(layout.width, layout.height))));
  const w = layout.width * s, h = layout.height * s;
  const data = new Uint8Array(w * h);
  // What has not risen stays blank: it is neither ground nor wall.
  for (const chunk of layout.chunks) {
    for (let ty = chunk.y; ty < chunk.y + CHUNK_TILES; ty++) for (let tx = chunk.x; tx < chunk.x + CHUNK_TILES; tx++) {
      const ink = layout.navMesh[ty]?.[tx] ? GROUND : BLOCKED;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) data[(ty * s + dy) * w + tx * s + dx] = ink;
    }
  }
  for (const road of layout.roads) {
    const ink = road.main ? ROAD_INK.main : ROAD_INK.street;
    for (let y = 0; y < CELL_TILES * s; y++) for (let x = 0; x < CELL_TILES * s; x++) data[(road.y * s + y) * w + road.x * s + x] = ink;
  }
  for (const zone of layout.zones) for (const poi of zone.pois) {
    const px0 = poi.position.x * s, py0 = poi.position.y * s;
    const pw = poi.size.width * s, ph = poi.size.height * s;
    const isLot = poi.type === 'PLAYER_LOT';
    const state = isLot ? lots[poi.metadata?.lotIndex] : undefined;
    const built = !!state && state !== 'FOR_SALE' && state !== 'OWNED_EMPTY';
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const edge = x === 0 || y === 0 || x === pw - 1 || y === ph - 1;
      const cell = (py0 + y) * w + px0 + x;
      if (cell < 0 || cell >= data.length) continue;
      if (edge) data[cell] = LOT_INK.outline;
      else if (!isLot || built) data[cell] = LOT_INK.built;
      else data[cell] = LOT_INK.empty;
    }
  }
  // A servidão crosses lots, so it is drawn over them.
  for (const q of layout.passages) for (const t of q.tiles) {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) data[(t.y * s + y) * w + t.x * s + x] = ROAD_INK.main;
  }
  stamp(data, w, h, tile.x * s + 1, tile.y * s + 1, 'PLAYER');
  if (w <= CITY_MAP_ATOMS && h <= CITY_MAP_ATOMS) return { w, h, data };
  const vw = Math.min(w, CITY_MAP_ATOMS), vh = Math.min(h, CITY_MAP_ATOMS);
  const x0 = Math.max(0, Math.min(w - vw, tile.x * s - (vw >> 1)));
  const y0 = Math.max(0, Math.min(h - vh, tile.y * s - (vh >> 1)));
  const view = new Uint8Array(vw * vh);
  for (let y = 0; y < vh; y++) view.set(data.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + vw), y * vw);
  return { w: vw, h: vh, data: view };
}

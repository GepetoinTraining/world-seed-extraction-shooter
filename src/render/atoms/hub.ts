/**
 * THE HUB: the real city layout, painted atom by atom.
 *
 * Footprints, doors, zones and lamps all come from HubGenerator, so what you can
 * walk through is exactly what looks walkable. The hub is the one warm place: its
 * own ramp, lit windows and lamplight. The light also shows as brightness, so it
 * survives without color.
 */

import { IHubLayout, IPOI, POIType, ZoneType, HubGenerator } from '../../entities/hub/HubGenerator';
import { CELL_TILES, ROAD_MAIN, ROAD_STREET, doorTile } from '../../entities/hub/hubManifest';
import { CHUNK_TILES } from '../../../shared/entities/world/grid';
import { fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { Genre, Ink, Role, Sprite, hash2, isqrt, material, px, seal, stamp } from '../../../shared/render/atoms/atoms';
import { castFigure } from '../../../shared/render/atoms/people';
import { RawWallKind, rawAtom } from './room';
import { HUB_TILE_PX } from '../../entities/hub/HubCanvas.constants';

export const HUB_TILE = HUB_TILE_PX / 2;

/** Warm stone and lamp-lit wood. Threat stays red: the hub is safe, but the role still exists. */
export const HUB_GENRE: Genre = { name: 'New Carleon', palette: ['#7a4210', '#c2a07a', '#e0963e', '#d9503f'] };

const BUILDING_TYPES = [
  POIType.BANK, POIType.GUILD_HALL, POIType.AUCTION_HOUSE, POIType.VENDOR_WEAPONS,
  POIType.VENDOR_ARMOR, POIType.VENDOR_CONSUMABLES, POIType.TAVERN, POIType.IDENTIFIER, POIType.LAND_OFFICE
];

const allPois = (layout: IHubLayout) => layout.zones.flatMap(z => z.pois);
const isBuilding = (p: IPOI) => BUILDING_TYPES.includes(p.type);

// ---------------------------------------------------------------------------
// TYPE: 3 by 5 atoms, so a sign is made of the same matter as the wall it hangs on.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'], K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'], O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'], Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'], W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['110', '001', '010', '100', '111'],
  3: ['110', '001', '010', '001', '110'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '110', '001', '110'],
  6: ['011', '100', '110', '101', '010'], 7: ['111', '001', '010', '010', '010'], 8: ['010', '101', '010', '101', '010'],
  9: ['010', '101', '011', '001', '110'],
  "'": ['010', '010', '000', '000', '000'], '#': ['101', '111', '101', '111', '101'], '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '100'], '-': ['000', '000', '111', '000', '000'], ':': ['000', '010', '000', '010', '000'],
  ' ': ['000', '000', '000', '000', '000']
};

export const glyph = (c: string): string[] | undefined => FONT[c.toUpperCase()];
const textWidth = (s: string) => s.length * 4 - 1;

export function textSprite(lines: string[], ink = px(Role.MATTER, 4), plate = px(Role.VOID, 1)): Sprite {
  const w = Math.max(...lines.map(textWidth)) + 4, h = lines.length * 6 + 3;
  const data = new Uint8Array(w * h).fill(plate);
  lines.forEach((line, row) => {
    const x0 = (w - textWidth(line)) >> 1;
    [...line].forEach((c, i) => {
      const g = glyph(c);
      if (!g) return;
      g.forEach((bits, gy) => [...bits].forEach((b, gx) => {
        if (b === '1') data[(2 + row * 6 + gy) * w + x0 + i * 4 + gx] = ink;
      }));
    });
  });
  return { w, h, data };
}

export interface Sign { poiId: string; lines: string[]; x: number; y: number; w: number; h: number }

export function hubSigns(layout: IHubLayout): Sign[] {
  return allPois(layout).filter(p => p.interactable).map(p => {
    const words = p.name.toUpperCase().split(' ');
    const fit = Math.max(p.size.width * HUB_TILE - 2, ...words.map(textWidth));
    const lines: string[] = [];
    words.forEach(word => {
      const last = lines[lines.length - 1];
      if (last !== undefined && textWidth(`${last} ${word}`) <= fit) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    });
    const w = Math.max(...lines.map(textWidth)) + 4, h = lines.length * 6 + 3;
    const cx = p.position.x * HUB_TILE + (p.size.width * HUB_TILE >> 1);
    return { poiId: p.id, lines, x: cx - (w >> 1), y: p.position.y * HUB_TILE - h, w, h };
  });
}

// ---------------------------------------------------------------------------
// FLOORS: each district has its own structure and brightness.
// ---------------------------------------------------------------------------

export function floorAtom(zone: ZoneType | null, ax: number, ay: number): number {
  switch (zone) {
    case ZoneType.PLAZA: {
      const row = Math.floor(ay / 7), off = (row & 1) * 5;
      if (ay % 7 === 0 || (ax + off) % 10 === 0) return px(Role.GROUND, 0);
      return px(Role.GROUND, hash2(11, Math.floor((ax + off) / 10), row) % 4 === 0 ? 2 : 3);
    }
    case ZoneType.MARKET: {
      const row = Math.floor(ay / 6);
      if (ay % 6 === 0) return px(Role.GROUND, 0);
      if ((ax + row * 11) % 28 === 0) return px(Role.GROUND, 0);
      return px(Role.GROUND, 2);
    }
    case ZoneType.GARDEN:
      return px(Role.GROUND, hash2(33, ax >> 1, ay >> 1) % 9 === 0 ? 2 : 1);
    case ZoneType.FARMLAND:
      // Turned ground, in long even rows
      return px(Role.GROUND, ay % 5 === 0 ? 1 : 2);
    case ZoneType.RESIDENTIAL: {
      const tuft = hash2(44, ax >> 2, ay >> 2) % 5 === 0 && (ax + ay) % 2 === 0;
      return px(Role.GROUND, tuft ? 4 : 3);
    }
    default:
      return px(Role.GROUND, ax % HUB_TILE === 0 && ay % HUB_TILE === 0 ? 1 : 0);
  }
}

/**
 * A road cell, from its own corner. Dark, with a bright kerb along every side it does
 * not join and open where it does. A main road carries a broken centre line; a street
 * has none. So the two tell apart by shape, and a road from a floor by value.
 */
export function roadAtom(kind: string, joins: { n: boolean; e: boolean; s: boolean; w: boolean }, x: number, y: number): number {
  const size = CELL_TILES * HUB_TILE;
  const kerb = (!joins.n && y < 2) || (!joins.s && y >= size - 2) || (!joins.w && x < 2) || (!joins.e && x >= size - 2);
  if (kerb) return px(Role.GROUND, 4);
  if (kind === ROAD_MAIN) {
    const across = joins.e || joins.w, along = joins.n || joins.s;
    const mid = (v: number) => v === (size >> 1) - 1 || v === size >> 1;
    if (across && !along && mid(y) && (x >> 2) % 2 === 0) return px(Role.GROUND, 4);
    if (along && !across && mid(x) && (y >> 2) % 2 === 0) return px(Role.GROUND, 4);
  }
  return px(Role.GROUND, 0);
}

/** A servidão's path: stepping stones, so it reads apart from road and lot alike, and it reads from the hub's own atoms. */
export const passageAtom = (ax: number, ay: number): number =>
  ((ax >> 2) + (ay >> 2)) % 2 === 0 ? px(Role.GROUND, 4) : px(Role.GROUND, 1);

const lampLevel = (d2: number, r2: number, x: number, y: number) => (d2 * 2 <= r2 ? 2 : (x + y) % 4 !== 0 ? 1 : 0);

/** How much lamplight reaches an atom: 0, 1 or 2 steps, at the lamp's real radius. */
export function lightAt(layout: IHubLayout, ax: number, ay: number): number {
  let best = 0;
  for (const p of allPois(layout)) {
    if (p.type !== POIType.LAMP_POST) continue;
    const r = (p.metadata.lightRadius ?? 3) * HUB_TILE;
    const dx = ax - (p.position.x * HUB_TILE + 5), dy = ay - (p.position.y * HUB_TILE + 5);
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    const level = lampLevel(d2, r * r, ax, ay);
    if (level > best) best = level;
  }
  return best;
}

// ---------------------------------------------------------------------------
// EMBLEMS: every kind of building, recognisable with no words.
// ---------------------------------------------------------------------------

function emblemInk(type: POIType): Ink {
  const k = new Ink();
  switch (type) {
    case POIType.BANK:
      k.disc(24, 24, 23).disc(24, 24, 16, 0).disc(24, 24, 9);
      k.rect(22, 0, 26, 47).rect(0, 22, 47, 26).disc(24, 24, 4, 0);
      break;
    case POIType.IDENTIFIER:
      k.disc(24, 24, 23).rect(0, 0, 47, 11, 0).rect(0, 37, 47, 47, 0).disc(24, 24, 9, 0).disc(24, 24, 5);
      break;
    case POIType.GUILD_HALL:
      k.rect(5, 0, 9, 47).rect(10, 2, 42, 30);
      for (let y = 20; y <= 30; y++) { const half = y - 20; k.rect(26 - half, y, 26 + half, y, 0); }
      break;
    case POIType.LAND_OFFICE:
      // A plot on a sheet, cut into its lots.
      k.rect(2, 2, 45, 45).rect(6, 6, 41, 41, 0);
      k.rect(14, 6, 17, 41).rect(30, 6, 33, 41).rect(6, 22, 41, 25);
      break;
    case POIType.VENDOR_WEAPONS:
      k.line(5, 5, 42, 42, 3).line(42, 5, 5, 42, 3).rect(2, 32, 16, 36).rect(31, 32, 45, 36);
      break;
    case POIType.VENDOR_ARMOR:
      k.rect(7, 2, 40, 22);
      for (let y = 22; y < 48; y++) { const half = 17 - Math.floor(((y - 22) * 16) / 25); k.rect(24 - half, y, 24 + half, y); }
      k.rect(22, 8, 26, 34, 0).rect(13, 15, 35, 18, 0);
      break;
    case POIType.VENDOR_CONSUMABLES:
      k.rect(19, 0, 29, 3).rect(21, 3, 27, 16);
      for (let y = 16; y < 40; y++) { const half = 3 + y - 16; k.rect(24 - half, y, 24 + half, y); }
      k.rect(3, 40, 44, 47).rect(14, 27, 34, 30, 0);
      break;
    case POIType.AUCTION_HOUSE:
      k.rect(2, 6, 45, 10).rect(22, 0, 26, 42).rect(10, 42, 38, 47);
      k.disc(8, 26, 8).rect(0, 16, 16, 25, 0).line(8, 10, 8, 18, 1);
      k.disc(40, 26, 8).rect(32, 16, 47, 25, 0).line(40, 10, 40, 18, 1);
      break;
    case POIType.TAVERN:
      k.disc(24, 7, 7).disc(24, 7, 3, 0).rect(21, 12, 27, 42).rect(10, 15, 38, 19);
      k.line(3, 28, 22, 44, 3).line(44, 28, 26, 44, 3);
      break;
    case POIType.PORTAL:
    default:
      k.disc(24, 24, 23).disc(24, 24, 15, 0);
      k.rect(21, 0, 27, 9, 0).rect(21, 38, 27, 47, 0).rect(0, 21, 9, 27, 0).rect(38, 21, 47, 27, 0);
      break;
  }
  return k;
}

const EMBLEM_ROLE = (t: POIType) => (t === POIType.BANK ? Role.PROOF : t === POIType.PORTAL ? Role.SIGNAL : Role.MATTER);

export function emblem(type: POIType, s = 12): Sprite {
  const seed = fnv1a(`emblem:v1:${type}`);
  return stamp(emblemInk(type), s, material({ density: 30 }), seed, { role: EMBLEM_ROLE(type), edgeStep: 4, minFill: 3, maxFill: 3 });
}

// ---------------------------------------------------------------------------
// LOTS: the states the game really has, each its own shape.
// ---------------------------------------------------------------------------

export const LOT_STATES = ['FOR_SALE', 'OWNED_EMPTY', 'UNDER_CONSTRUCTION', 'HOUSE', 'WORKSHOP', 'VENDOR', 'FORECLOSED', 'FARM'] as const;
export type LotState = typeof LOT_STATES[number];
export type RawFacade = RawWallKind;

function lotInk(state: LotState): Ink {
  const k = new Ink();
  switch (state) {
    case 'FOR_SALE':
      k.rect(22, 8, 26, 44).rect(10, 8, 38, 24).rect(14, 12, 34, 20, 0);
      break;
    // HOUSE / WORKSHOP / VENDOR draw as real buildings now (builtLotArt, Wave 10).
    case 'FORECLOSED':
      k.line(10, 10, 37, 37, 3).line(37, 10, 10, 37, 3);
      break;
  }
  return k;
}

/**
 * An open lot is a plot: its own ground over its whole footprint, a line on every tile
 * boundary so you can count what you would be buying, and a border that says its state
 * by shape: broken with corner stakes for sale, whole when held, torn when foreclosed.
 */
function plotArt(state: 'FOR_SALE' | 'OWNED_EMPTY' | 'FORECLOSED', w: number, h: number, seed: number): Sprite {
  const data = new Uint8Array(w * h);
  const edge = 2;
  const stake = 6;
  const borderAt = (x: number, y: number): number => {
    const along = y < edge || y >= h - edge ? x : y;
    const onBorder = x < edge || y < edge || x >= w - edge || y >= h - edge;
    const corner = (x < stake || x >= w - stake) && (y < stake || y >= h - stake);
    switch (state) {
      case 'FOR_SALE':
        if (corner) return px(Role.MATTER, 3);
        return onBorder && (along >> 1) % 3 === 0 ? px(Role.MATTER, 4) : 0;
      case 'OWNED_EMPTY':
        return onBorder ? px(Role.MATTER, 4) : 0;
      case 'FORECLOSED':
        return onBorder && (along >> 3) % 3 === 0 ? px(Role.LOSS, 2) : 0;
    }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onLine = x % HUB_TILE === 0 || y % HUB_TILE === 0;
    const line = px(Role.GROUND, state === 'FORECLOSED' ? 2 : 4);
    const ground = state === 'OWNED_EMPTY'
      ? px(Role.GROUND, (x + y) % 4 < 2 ? 2 : 1) // turned earth, in furrows
      : px(Role.GROUND, state === 'FOR_SALE' ? 1 : 0);
    data[y * w + x] = borderAt(x, y) || (onLine ? line : ground);
  }
  const place = (s: Sprite) => {
    const x0 = (w - s.w) >> 1, y0 = (h - s.h) >> 1;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const v = s.data[y * s.w + x];
      if (v) data[(y0 + y) * w + x0 + x] = v;
    }
  };
  if (state === 'OWNED_EMPTY') place(seal(`lot:${seed}`));
  else {
    const s = Math.min(w, h) - 12;
    place(stamp(lotInk(state), s, material({ density: 40, hardness: 50 }), fnv1a(`lot:v1:${state}`), {
      role: state === 'FORECLOSED' ? Role.LOSS : Role.MATTER, edgeStep: state === 'FORECLOSED' ? 2 : 3, minFill: 1, maxFill: 2
    }));
  }
  return { w, h, data };
}

/**
 * Wave 10: a built lot is a real building. Solid over every tile (the city
 * blocks exactly this footprint), a hard void seam all round, and a doorway
 * at the bottom centre — the way in that 10.2 opens.
 */
function builtLotArt(state: 'HOUSE' | 'WORKSHOP' | 'VENDOR', w: number, h: number, seed: number, raw?: RawFacade): Sprite {
  const data = new Uint8Array(w * h);
  const facade = Math.max(12, (h * 3) >> 3);
  const roofH = h - facade;
  const doorW = 8;
  const doorX0 = (w >> 1) - (doorW >> 1);

  const roofAtom = (x: number, y: number): number => {
    switch (state) {
      case 'HOUSE': {
        // Gabled shingles: chevrons falling away from the ridge.
        const dist = Math.abs(x - (w >> 1));
        return (y + (dist >> 1)) % 5 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 1 + ((x + y + seed) % 2));
      }
      case 'WORKSHOP': {
        // Corrugated sheet, and a chimney block on the right.
        if (x >= w - 12 && x < w - 7 && y >= 3 && y < roofH - 4) return (x + y) % 4 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 3);
        return x % 5 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 2);
      }
      case 'VENDOR':
        // A striped awning, bright bands the market can see from the street.
        return y % 6 < 2 ? px(Role.LIFE, 3) : px(Role.MATTER, 1);
    }
  };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v: number;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (edge) v = px(Role.VOID, 0);
    else if (y < roofH) v = y === roofH - 1 ? px(Role.VOID, 0) : y === 1 ? px(Role.MATTER, 3) : roofAtom(x, y);
    else {
      v = raw ? rawAtom(raw, Role.MATTER, x, y, seed) : (y - roofH) % 5 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 1);
      const wy = y - roofH - 3;
      const inDoor = x >= doorX0 - 1 && x < doorX0 + doorW + 1;
      // A raw building has walls and a door. Its first window waits for glass.
      if (!raw && !inDoor && wy >= 0 && wy < 5 && x > 2 && x < w - 3 && (x - 3) % 8 < 5) {
        v = (x - 3) % 8 === 2 ? px(Role.MATTER, 2) : px(Role.LIFE, 4);
      }
      if (inDoor) {
        const top = y - roofH;
        v = x === doorX0 - 1 || x === doorX0 + doorW || top === 1 ? px(Role.MATTER, 3) : top > 1 ? px(Role.VOID, 0) : px(Role.MATTER, 1);
      }
    }
    data[y * w + x] = v;
  }
  return { w, h, data };
}

/**
 * Wave 10B: UNDER CONSTRUCTION. A scaffold dense enough to read as blocked on
 * every tile it covers (the city blocks exactly this footprint), with the
 * building itself rising solid from the ground as progress climbs — progress
 * is read by shape, from the street, with no words.
 */
function constructionLotArt(w: number, h: number, seed: number, progress: number): Sprite {
  const data = new Uint8Array(w * h);
  const p = Math.max(0, Math.min(1, progress));
  const builtH = Math.round((h - 2) * p); // solid rows, rising from the ground
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (edge) { data[y * w + x] = px(Role.VOID, 0); continue; }
    if (y >= h - 1 - builtH) {
      // The risen part: built matter, seamed every course.
      data[y * w + x] = y % 10 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 1 + ((x + y + seed) % 2));
      continue;
    }
    const dx = x % 10, dy = y % 10;
    const post = dx < 2;                 // standards, one per tile
    const board = dy < 2;                // ledgers and walkboards
    const brace = Math.abs(dx - dy) <= 1 || dx + dy === 9 || dx + dy === 10 || dx + dy === 8;
    if (post || board) data[y * w + x] = px(Role.MATTER, 3);
    else if (brace) data[y * w + x] = px(Role.MATTER, 1);
    // what remains stays open: the street shows through the scaffold
  }
  return { w, h, data };
}

/** What a plot shows of what is on it: a bed's number and how far along, 0 to 1. A tree stands wider. */
export interface IPlotShow { cols: number; beds: { at: number; growth: number; span: number }[] }

/** Evenly set beds, by shape: a furrow, then a sprig, then a stand, and a ripe one wears a crown. A wider one is a tree. */
function farmArt(w: number, h: number, show?: IPlotShow): Sprite {
  const data = new Uint8Array(w * h);
  const cols = show?.cols ?? 4;
  const bed = Math.floor(w / cols);
  // A worked plot: a fence of posts round it, and its beds in even rows, so it reads as held and worked from the street
  const fence = (x: number, y: number) => (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) && (x + y) % 6 < 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gap = x % bed < 2 || y % bed < 2;
    data[y * w + x] = fence(x, y) ? px(Role.MATTER, 4) : gap ? px(Role.GROUND, 0) : px(Role.GROUND, (y >> 1) % 2 === 0 ? 2 : 3);
  }
  for (const b of show?.beds ?? []) {
    const size = bed * b.span;
    const x0 = (b.at % cols) * bed, y0 = Math.floor(b.at / cols) * bed;
    const tall = Math.max(2, Math.round((size - 6) * b.growth));
    const midX = x0 + (size >> 1) + 1;
    const put = (x: number, y: number, ink: number) => { if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = ink; };
    // A stalk two atoms wide, with leaves that widen as it rises. A tree grows a crown as wide as its block.
    for (let t = 0; t < tall; t++) {
      const y = y0 + size - 3 - t;
      put(midX, y, px(Role.MATTER, 3));
      put(midX + 1, y, px(Role.MATTER, 3));
      const reach = b.span > 1 ? (t > tall / 2 ? Math.round((t - tall / 2) / 2) + 2 : 0) : t % 4 === 2 ? 2 : 0;
      for (let dx = 1; dx <= reach; dx++) { put(midX - dx, y, px(Role.MATTER, 2)); put(midX + 1 + dx, y, px(Role.MATTER, 2)); }
    }
    // Ripe wears a crown, by shape, so it can be told from across a street with no hue at all
    if (b.growth >= 1) {
      const top = y0 + size - 3 - tall;
      for (let dx = -3; dx <= 4; dx++) { put(midX + dx, top, px(Role.MATTER, 4)); put(midX + dx, top - 1, px(Role.MATTER, 4)); }
    }
  }
  return { w, h, data };
}

export function lotArt(state: LotState, w: number, h: number, seed: number, progress = 0, facade?: RawFacade, plot?: IPlotShow): Sprite {
  if (state === 'FARM') return farmArt(w, h, plot);
  if (state === 'UNDER_CONSTRUCTION') return constructionLotArt(w, h, seed, progress);
  if (state === 'HOUSE' || state === 'WORKSHOP' || state === 'VENDOR') return builtLotArt(state, w, h, seed, facade);
  return plotArt(state, w, h, seed);
}

// ---------------------------------------------------------------------------
// BUILDINGS
// ---------------------------------------------------------------------------

export const doorOf = (p: IPOI) => doorTile(p);

/** How near you stand to deal with a place. Nobody talks across a distance. */
const REACH_TILES = 3;

/** From a tile to a place. A stretched lot is bigger than the reach, so its door counts too. */
export const distanceTo = (p: IPOI, tile: { x: number; y: number }) => {
  const door = doorOf(p);
  return Math.min(
    Math.hypot(tile.x + 0.5 - (p.position.x + p.size.width / 2), tile.y + 0.5 - (p.position.y + p.size.height / 2)),
    Math.hypot(tile.x - door.x, tile.y - door.y)
  );
};

export const withinReach = (p: IPOI, tile: { x: number; y: number }) => distanceTo(p, tile) < REACH_TILES;

/** Where a keeper stands: beside their door, never in it, so you can always reach it. */
export function keeperSpot(layout: IHubLayout, p: IPOI): { x: number; y: number } {
  const door = p.type === POIType.PORTAL ? { x: p.position.x + (p.size.width >> 1), y: p.position.y + p.size.height } : doorOf(p);
  const free = (x: number) => layout.navMesh[door.y]?.[x] === true;
  return { x: free(door.x + 1) ? door.x + 1 : door.x - 1, y: door.y };
}

function roofAtom(type: POIType, x: number, y: number): number {
  switch (type) {
    case POIType.BANK: return (x + y) % 6 === 0 ? px(Role.PROOF, 1) : px(Role.MATTER, 1);
    case POIType.IDENTIFIER: return y % 4 === 0 ? px(Role.MATTER, 2) : px(Role.MATTER, 0);
    case POIType.GUILD_HALL: return (x >> 1) % 3 === 0 ? px(Role.LIFE, 1) : px(Role.MATTER, 1);
    case POIType.LAND_OFFICE: return (x >> 1) % 3 === 0 ? px(Role.LIFE, 1) : y % 4 === 0 ? px(Role.MATTER, 2) : px(Role.MATTER, 1);
    case POIType.VENDOR_WEAPONS: return x % 5 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 2);
    case POIType.VENDOR_ARMOR: return (x + (y >> 2) * 3) % 6 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 1);
    case POIType.VENDOR_CONSUMABLES: return hash2(5, x, y) % 3 === 0 ? px(Role.LIFE, 2) : px(Role.LIFE, 1);
    case POIType.AUCTION_HOUSE: return y % 6 < 2 ? px(Role.MATTER, 2) : px(Role.MATTER, 1);
    default: return y % 3 === 0 ? px(Role.LIFE, 1) : px(Role.LIFE, 2);
  }
}

function paintBuilding(data: Uint8Array, W: number, p: IPOI) {
  const x0 = p.position.x * HUB_TILE, y0 = p.position.y * HUB_TILE;
  const w = p.size.width * HUB_TILE, h = p.size.height * HUB_TILE;
  const facade = Math.max(12, (h * 2) >> 3 < 12 ? 12 : (h * 3) >> 3);
  const roofH = h - facade;
  const door = doorOf(p);
  const doorX0 = door.x * HUB_TILE + 1 - x0, doorW = 8;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v: number;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (edge) v = px(Role.VOID, 0);
    else if (y < roofH) v = y === roofH - 1 ? px(Role.VOID, 0) : y === 1 ? px(Role.MATTER, 3) : roofAtom(p.type, x, y);
    else {
      v = (y - roofH) % 5 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 1);
      const wy = y - roofH - 3;
      const inDoor = x >= doorX0 - 1 && x < doorX0 + doorW + 1;
      if (!inDoor && wy >= 0 && wy < 5 && x > 2 && x < w - 3 && (x - 3) % 8 < 5) {
        v = (x - 3) % 8 === 2 ? px(Role.MATTER, 2) : px(Role.LIFE, 4);
      }
      if (inDoor) {
        const top = y - roofH;
        v = x === doorX0 - 1 || x === doorX0 + doorW || top === 1 ? px(Role.MATTER, 3) : top > 1 ? px(Role.VOID, 0) : px(Role.MATTER, 1);
      }
    }
    data[(y0 + y) * W + x0 + x] = v;
  }
  const mark = emblem(p.type, Math.min(12, roofH - 4));
  blit(data, W, mark, x0 + ((w - mark.w) >> 1), y0 + ((roofH - mark.h) >> 1));
}

function paintFountain(data: Uint8Array, W: number, p: IPOI, frame: number) {
  const x0 = p.position.x * HUB_TILE, y0 = p.position.y * HUB_TILE;
  const w = p.size.width * HUB_TILE, h = p.size.height * HUB_TILE;
  const cx = w >> 1, cy = h >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    let v: number;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = px(Role.VOID, 0);
    else if (r > 18) v = (x + y) % 4 === 0 ? px(Role.MATTER, 0) : px(Role.MATTER, 1);
    else if (r > 15) v = px(Role.MATTER, 3);
    else if (r > 4) v = (r + frame * 2) % 6 === 0 ? px(Role.MATTER, 2) : px(Role.VOID, 2);
    else v = r > 2 ? px(Role.MATTER, 4) : px(Role.LIFE, 4);
    data[(y0 + y) * W + x0 + x] = v;
  }
}

function paintLamp(data: Uint8Array, W: number, p: IPOI, frame: number) {
  const x0 = p.position.x * HUB_TILE, y0 = p.position.y * HUB_TILE;
  const put = (x: number, y: number, v: number) => { data[(y0 + y) * W + x0 + x] = v; };
  for (let y = 3; y < 10; y++) { put(3, y, px(Role.VOID, 0)); put(4, y, px(Role.MATTER, 2)); put(5, y, px(Role.MATTER, 2)); put(6, y, px(Role.VOID, 0)); }
  for (let x = 2; x < 8; x++) { put(x, 9, px(Role.MATTER, 3)); put(x, 0, px(Role.VOID, 0)); }
  put(3, 1, px(Role.LIFE, 4)); put(4, 1, px(Role.LIFE, 4)); put(5, 1, px(Role.LIFE, 4)); put(6, 1, px(Role.LIFE, frame % 2 ? 3 : 4));
  put(3, 2, px(Role.LIFE, frame % 2 ? 4 : 3)); put(4, 2, px(Role.LIFE, 4)); put(5, 2, px(Role.LIFE, 4)); put(6, 2, px(Role.LIFE, 3));
}

function blit(data: Uint8Array, W: number, s: Sprite, x0: number, y0: number) {
  const H = data.length / W;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const v = s.data[y * s.w + x];
    if (!v) continue;
    const dx = x0 + x, dy = y0 + y;
    if (dx >= 0 && dy >= 0 && dx < W && dy < H) data[dy * W + dx] = v;
  }
}

/** A chunk's floor before light, by its own zones and roads. The same ones are the same bytes, so a recompose reads them back. */
const chunkFloors = new Map<string, Uint8Array>();
function chunkFloor(layout: IHubLayout, chunk: { x: number; y: number }): Uint8Array {
  const zones: (ZoneType | null)[] = [];
  for (let ty = chunk.y; ty < chunk.y + CHUNK_TILES; ty++) for (let tx = chunk.x; tx < chunk.x + CHUNK_TILES; tx++) {
    zones.push(HubGenerator.getZoneAtPosition(layout, tx, ty)?.type ?? null);
  }
  // A road's kerb reads only its own chunk. It stays open at a chunk's edge, so what rises next moves no byte here.
  const roads = layout.roads
    .filter(r => r.x >= chunk.x && r.x < chunk.x + CHUNK_TILES && r.y >= chunk.y && r.y < chunk.y + CHUNK_TILES)
    .map(r => ({ cx: (r.x - chunk.x) / CELL_TILES, cy: (r.y - chunk.y) / CELL_TILES, kind: r.main ? ROAD_MAIN : ROAD_STREET }));
  const key = `${zones.join()}|${roads.map(r => `${r.cx},${r.cy},${r.kind}`).join(';')}`;
  let floor = chunkFloors.get(key);
  if (!floor) {
    const size = CHUNK_TILES * HUB_TILE;
    floor = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      floor[y * size + x] = floorAtom(zones[Math.floor(y / HUB_TILE) * CHUNK_TILES + Math.floor(x / HUB_TILE)], x, y);
    }
    const roadAt = new Set(roads.map(r => `${r.cx},${r.cy}`));
    const joins = (cx: number, cy: number) => {
      const cells = CHUNK_TILES / CELL_TILES;
      const open = (x: number, y: number) => x < 0 || y < 0 || x >= cells || y >= cells || roadAt.has(`${x},${y}`);
      return { n: open(cx, cy - 1), e: open(cx + 1, cy), s: open(cx, cy + 1), w: open(cx - 1, cy) };
    };
    const cellAtoms = CELL_TILES * HUB_TILE;
    for (const r of roads) {
      const j = joins(r.cx, r.cy);
      for (let y = 0; y < cellAtoms; y++) for (let x = 0; x < cellAtoms; x++) {
        floor[(r.cy * cellAtoms + y) * size + r.cx * cellAtoms + x] = roadAtom(r.kind, j, x, y);
      }
    }
    chunkFloors.set(key, floor);
  }
  return floor;
}

/** Floors, light and everything solid. What this draws as solid is what the navmesh blocks. */
export function hubGround(layout: IHubLayout, frame = 0, lots: Partial<Record<number, LotState>> = {}, construction: Partial<Record<number, number>> = {}, facades: Partial<Record<number, RawFacade>> = {}, plots: Partial<Record<number, IPlotShow>> = {}): Sprite {
  const W = layout.width * HUB_TILE, H = layout.height * HUB_TILE;
  const data = new Uint8Array(W * H);
  const lamps = allPois(layout).filter(p => p.type === POIType.LAMP_POST);
  const lit = new Uint8Array(W * H);
  lamps.forEach(p => {
    const r = (p.metadata.lightRadius ?? 3) * HUB_TILE;
    const cx = p.position.x * HUB_TILE + 5, cy = p.position.y * HUB_TILE + 5;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r * r) continue;
      const level = lampLevel(d2, r * r, x, y);
      if (level > lit[y * W + x]) lit[y * W + x] = level;
    }
  });
  // A chunk's floor is read from its own corner, so raising another beside it moves
  // no grain. What has not risen stays empty, and the outskirts show through.
  const chunkAtoms = CHUNK_TILES * HUB_TILE;
  for (const chunk of layout.chunks) {
    const floor = chunkFloor(layout, chunk);
    for (let y = 0; y < chunkAtoms; y++) {
      data.set(floor.subarray(y * chunkAtoms, (y + 1) * chunkAtoms), (chunk.y * HUB_TILE + y) * W + chunk.x * HUB_TILE);
    }
  }
  const ground4 = px(Role.GROUND, 4);
  for (let i = 0; i < data.length; i++) {
    if (lit[i] && data[i]) data[i] = Math.min(ground4, data[i] + lit[i]);
  }

  const pois = allPois(layout);
  pois.filter(p => p.type === POIType.PLAYER_LOT).forEach(p => {
    const art = lotArt(
      lots[p.metadata.lotIndex] ?? 'FOR_SALE',
      p.size.width * HUB_TILE, p.size.height * HUB_TILE,
      p.metadata.lotIndex,
      construction[p.metadata.lotIndex] ?? 0,
      facades[p.metadata.lotIndex],
      plots[p.metadata.lotIndex]
    );
    blit(data, W, art, p.position.x * HUB_TILE, p.position.y * HUB_TILE);
  });
  // Over whatever stands on the lots it crosses: it blocks nobody, so it must look it.
  layout.passages.forEach(q => q.tiles.forEach(t => {
    for (let y = t.y * HUB_TILE; y < (t.y + 1) * HUB_TILE; y++) for (let x = t.x * HUB_TILE; x < (t.x + 1) * HUB_TILE; x++) {
      data[y * W + x] = passageAtom(x, y);
    }
  }));
  pois.filter(p => p.type === POIType.PORTAL).forEach(p => {
    blit(data, W, emblem(p.type, p.size.width * HUB_TILE - 2), p.position.x * HUB_TILE, p.position.y * HUB_TILE);
  });
  pois.filter(p => p.type === POIType.LAMP_POST).forEach(p => paintLamp(data, W, p, frame));
  pois.filter(p => p.type === POIType.FOUNTAIN).forEach(p => paintFountain(data, W, p, frame));
  pois.filter(isBuilding).forEach(p => paintBuilding(data, W, p));
  return { w: W, h: H, data };
}

export interface HubOptions {
  frame?: number;
  lots?: Partial<Record<number, LotState>>;
  /** Wave 10B: per-lot construction progress (0..1), read by shape on the scaffold. */
  construction?: Partial<Record<number, number>>;
  /** The raw materials leg: a lot whose walls are raw draws them from the street. */
  facades?: Partial<Record<number, RawFacade>>;
  /** What stands on each plot of farmland, by shape. */
  plots?: Partial<Record<number, IPlotShow>>;
}

/** The whole city: ground, signs, and the cast standing at their doors. */
export function composeHub(layout: IHubLayout, o: HubOptions = {}): Sprite {
  const ground = hubGround(layout, o.frame ?? 0, o.lots, o.construction, o.facades, o.plots);
  const { data, w: W } = ground;
  allPois(layout).filter(p => isBuilding(p) || p.type === POIType.PORTAL).forEach(p => {
    if (!p.npcId) return;
    const spot = keeperSpot(layout, p);
    const f = castFigure(p.npcId);
    blit(data, W, f, spot.x * HUB_TILE + 5 - (f.w >> 1), spot.y * HUB_TILE + 5 - (f.h >> 1));
  });
  hubSigns(layout).forEach(s => {
    const poi = allPois(layout).find(p => p.id === s.poiId)!;
    const sprite = poi.type === POIType.BANK ? textSprite(s.lines, px(Role.PROOF, 4)) : textSprite(s.lines);
    blit(data, W, sprite, s.x, s.y);
  });
  return ground;
}

/**
 * THE HUB: the real city layout, painted atom by atom.
 *
 * Footprints, doors, zones and lamps all come from HubGenerator, so what you can
 * walk through is exactly what looks walkable. The hub is the one warm place: its
 * own ramp, lit windows and lamplight. The light also shows as brightness, so it
 * survives without color.
 */

import { IHubLayout, IPOI, POIType, ZoneType, HubGenerator } from '../../entities/hub/HubGenerator';
import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { Genre, Ink, Role, Sprite, hash2, isqrt, material, px, seal, stamp } from './atoms';
import { castFigure } from './people';
import { RawWallKind, rawAtom } from './room';
import { HUB_TILE_PX } from '../../entities/hub/HubCanvas.constants';

export const HUB_TILE = HUB_TILE_PX / 2;

/** Warm stone and lamp-lit wood. Threat stays red: the hub is safe, but the role still exists. */
export const HUB_GENRE: Genre = { name: 'New Carleon', palette: ['#7a4210', '#c2a07a', '#e0963e', '#d9503f'] };

const BUILDING_TYPES = [
  POIType.BANK, POIType.GUILD_HALL, POIType.AUCTION_HOUSE, POIType.VENDOR_WEAPONS,
  POIType.VENDOR_ARMOR, POIType.VENDOR_CONSUMABLES, POIType.TAVERN, POIType.IDENTIFIER
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
    case ZoneType.RESIDENTIAL: {
      const tuft = hash2(44, ax >> 2, ay >> 2) % 5 === 0 && (ax + ay) % 2 === 0;
      return px(Role.GROUND, tuft ? 4 : 3);
    }
    default:
      return px(Role.GROUND, ax % HUB_TILE === 0 && ay % HUB_TILE === 0 ? 1 : 0);
  }
}

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

export const LOT_STATES = ['FOR_SALE', 'OWNED_EMPTY', 'UNDER_CONSTRUCTION', 'HOUSE', 'WORKSHOP', 'VENDOR', 'FORECLOSED'] as const;
export type LotState = typeof LOT_STATES[number];
export type RawFacade = RawWallKind;

function lotInk(state: LotState): Ink {
  const k = new Ink();
  const stakes = () => {
    [[0, 0], [41, 0], [0, 41], [41, 41]].forEach(([x, y]) => k.rect(x, y, x + 6, y + 6));
  };
  const fence = () => {
    for (let i = 0; i < 48; i += 6) { k.rect(i, 0, i + 3, 2); k.rect(i, 45, i + 3, 47); k.rect(0, i, 2, i + 3); k.rect(45, i, 47, i + 3); }
  };
  switch (state) {
    case 'FOR_SALE':
      stakes();
      k.rect(22, 8, 26, 44).rect(10, 8, 38, 24).rect(14, 12, 34, 20, 0);
      break;
    case 'OWNED_EMPTY':
      fence();
      break;
    // HOUSE / WORKSHOP / VENDOR draw as real buildings now (builtLotArt, Wave 10).
    case 'FORECLOSED':
      k.rect(0, 0, 8, 2).rect(30, 45, 47, 47).rect(0, 32, 2, 47).rect(45, 0, 47, 12);
      k.line(10, 10, 37, 37, 3).line(37, 10, 10, 37, 3);
      break;
  }
  return k;
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

export function lotArt(state: LotState, w: number, h: number, seed: number, progress = 0, facade?: RawFacade): Sprite {
  if (state === 'UNDER_CONSTRUCTION') return constructionLotArt(w, h, seed, progress);
  if (state === 'HOUSE' || state === 'WORKSHOP' || state === 'VENDOR') return builtLotArt(state, w, h, seed, facade);
  const s = Math.min(w, h) - 2;
  const sprite = stamp(lotInk(state), s, material({ density: 40, hardness: 50 }), fnv1a(`lot:v1:${state}`), {
    role: state === 'FORECLOSED' ? Role.LOSS : Role.MATTER, edgeStep: 3, minFill: 1, maxFill: 2
  });
  if (state === 'OWNED_EMPTY') {
    const mark = seal(`lot:${seed}`);
    const x0 = (sprite.w - mark.w) >> 1, y0 = (sprite.h - mark.h) >> 1;
    for (let y = 0; y < mark.h; y++) for (let x = 0; x < mark.w; x++) {
      const v = mark.data[y * mark.w + x];
      if (v) sprite.data[(y0 + y) * sprite.w + x0 + x] = v;
    }
  }
  return sprite;
}

// ---------------------------------------------------------------------------
// BUILDINGS
// ---------------------------------------------------------------------------

export const doorOf = (p: IPOI) => ({ x: p.position.x + (p.size.width >> 1), y: p.position.y + p.size.height });

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

/** Floors, light and everything solid. What this draws as solid is what the navmesh blocks. */
export function hubGround(layout: IHubLayout, frame = 0, lots: Partial<Record<number, LotState>> = {}, construction: Partial<Record<number, number>> = {}, facades: Partial<Record<number, RawFacade>> = {}): Sprite {
  const W = layout.width * HUB_TILE, H = layout.height * HUB_TILE;
  const data = new Uint8Array(W * H);
  const zoneOf: (ZoneType | null)[] = [];
  for (let ty = 0; ty < layout.height; ty++) for (let tx = 0; tx < layout.width; tx++) {
    zoneOf.push(HubGenerator.getZoneAtPosition(layout, tx, ty)?.type ?? null);
  }
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
  const ground4 = px(Role.GROUND, 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const zone = zoneOf[Math.floor(y / HUB_TILE) * layout.width + Math.floor(x / HUB_TILE)];
    let v = floorAtom(zone, x, y);
    if (lit[y * W + x]) v = Math.min(ground4, v + lit[y * W + x]);
    data[y * W + x] = v;
  }

  const pois = allPois(layout);
  pois.filter(p => p.type === POIType.PLAYER_LOT).forEach(p => {
    const art = lotArt(
      lots[p.metadata.lotIndex] ?? 'FOR_SALE',
      p.size.width * HUB_TILE, p.size.height * HUB_TILE,
      p.metadata.lotIndex,
      construction[p.metadata.lotIndex] ?? 0,
      facades[p.metadata.lotIndex]
    );
    blit(data, W, art, p.position.x * HUB_TILE, p.position.y * HUB_TILE);
  });
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
}

/** The whole city: ground, signs, and the cast standing at their doors. */
export function composeHub(layout: IHubLayout, o: HubOptions = {}): Sprite {
  const ground = hubGround(layout, o.frame ?? 0, o.lots, o.construction, o.facades);
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

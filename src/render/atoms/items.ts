/**
 * One rule for what an item looks like (Wave 9.4): its real art at its real
 * footprint, from the same numbers that decide its physics. Resources draw
 * from their material properties; gear proposes a profile from its tags.
 * Wave 10B: a template's art is its composed plan — real atoms, never an icon.
 */

import { ICognitiveFrame, IItem, ItemType } from '../../../shared/types';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { Role, STEPS, Sprite, gearMaterial, hashBytes, itemArt, materialFromProps } from '../../../shared/render/atoms/atoms';
import { templateThumb } from './room';

const encoder = new TextEncoder();

/**
 * Wave 10C (D22): a cognitive frame on the paper-doll. NOT an item and never
 * drawn like one: a hollow diamond — mind holding a position gear would — with
 * the frame's TYPE coded by the structure inside, never by hue (colourblind
 * law): LOGIC carries ruled traces, INSTINCT carries chevrons, SOCIAL carries
 * two facing points. Drawn in the machine's signal ramp: a frame is live signal.
 */
export function frameMark(frame: ICognitiveFrame): Sprite {
  const S = 16;
  const data = new Uint8Array(S * S);
  const set = (x: number, y: number, step: number) => {
    if (x >= 0 && x < S && y >= 0 && y < S) data[y * S + x] = 1 + Role.SIGNAL * STEPS + step;
  };
  const c = S / 2 - 0.5, r = 7;

  // The hollow diamond: |dx| + |dy| == r, two atoms thick
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.abs(x - c) + Math.abs(y - c);
    if (d >= r - 1 && d <= r) set(x, y, 3);
  }

  if (frame.type === 'LOGIC') {
    // Ruled traces: three horizontal lines inside the diamond
    for (const y of [5, 8, 11] as const) {
      for (let x = 0; x < S; x++) {
        if (Math.abs(x - c) + Math.abs(y - c) < r - 2) set(x, y, y === 8 ? 4 : 2);
      }
    }
  } else if (frame.type === 'INSTINCT') {
    // Chevrons: two nested points, teeth downward
    for (const [top, step] of [[4, 4], [8, 2]] as const) {
      for (let i = 0; i < 4; i++) {
        set(Math.floor(c) - i, top + i, step); set(Math.floor(c) + 1 - i, top + i, step);
        set(Math.floor(c) + i, top + i, step); set(Math.floor(c) + 1 + i, top + i, step);
      }
    }
  } else {
    // SOCIAL: two facing points with a bridge
    for (const dx of [-3, 3] as const) {
      set(Math.floor(c) + dx, 7, 4); set(Math.floor(c) + dx + 1, 7, 4);
      set(Math.floor(c) + dx, 8, 4); set(Math.floor(c) + dx + 1, 8, 4);
    }
    for (let x = Math.floor(c) - 1; x <= Math.floor(c) + 2; x++) set(x, 10, 2);
  }

  return { w: S, h: S, data };
}

/**
 * D85: a map shows what it holds: a ruled sheet with a block where each sector was read,
 * the deeper the read the heavier the block. Value and shape, so it reads with no hue at all.
 */
function mapThumb(map: NonNullable<IItem['mapData']>, cells: { width: number; height: number }): Sprite {
  const W = cells.width * 18, H = cells.height * 18; // the pack's cell, 18 atoms
  const data = new Uint8Array(W * H);
  const set = (x: number, y: number, step: number) => { data[y * W + x] = 1 + Role.MATTER * STEPS + step; };
  const INK = 0, RULE = 2, PAPER = 4, INSET = 2;
  for (let y = INSET; y < H - INSET; y++) for (let x = INSET; x < W - INSET; x++) {
    const edge = x === INSET || y === INSET || x === W - INSET - 1 || y === H - INSET - 1;
    set(x, y, edge ? RULE : PAPER);
  }
  const held = Object.entries(map.sectors).map(([key, entry]) => {
    const [sx, sy] = key.split(',').map(Number);
    return { sx, sy, level: entry.level };
  });
  const minX = Math.min(...held.map(s => s.sx)), minY = Math.min(...held.map(s => s.sy));
  const span = Math.max(...held.map(s => s.sx - minX), ...held.map(s => s.sy - minY)) + 1;
  const room = Math.min(W, H) - (INSET + 2) * 2;
  const per = room / span;
  for (const { sx, sy, level } of held) {
    const size = Math.max(1, Math.round(per * Math.min(1, (level + 1) / 4)));
    const x0 = INSET + 2 + Math.floor((sx - minX) * per), y0 = INSET + 2 + Math.floor((sy - minY) * per);
    for (let y = y0; y < y0 + size && y < H - INSET - 1; y++) for (let x = x0; x < x0 + size && x < W - INSET - 1; x++) set(x, y, INK);
  }
  return { w: W, h: H, data };
}

/** D80: a world deed is a sheet with a seal and a ruled square, more finely ruled the larger the world. Shape, not hue. */
function deedThumb(size: number, dims: { width: number; height: number }): Sprite {
  const W = dims.width * 18, H = dims.height * 18; // the pack's cell, 18 atoms
  const data = new Uint8Array(W * H);
  const set = (x: number, y: number, step: number) => { if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = 1 + Role.MATTER * STEPS + step; };
  const INK = 0, PAPER = 4;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    set(x, y, x === 1 || y === 1 || x === W - 2 || y === H - 2 ? INK : PAPER);
  }
  const side = Math.min(W, H) - 8;
  const x0 = Math.floor((W - side) / 2), y0 = 4;
  // One rule across for every doubling above the smallest
  const rules = Math.max(1, Math.round(Math.log2(Math.max(16, size) / 16)) + 1);
  const step = side / (rules + 1);
  for (let i = 0; i <= rules + 1; i++) {
    const at = Math.round(i * step);
    for (let t = 0; t <= side; t++) { set(x0 + at, y0 + t, INK); set(x0 + t, y0 + at, INK); }
  }
  // The seal, a filled block under the square
  for (let y = H - 7; y < H - 3; y++) for (let x = Math.floor(W / 2) - 2; x < Math.floor(W / 2) + 2; x++) set(x, y, INK);
  return { w: W, h: H, data };
}

export function itemArtFor(item: IItem): Sprite {
  // Wave 10B: a building plan shows the plan itself, through the composer.
  const templateData = (item as any).templateData;
  if (item.type === ItemType.TEMPLATE && templateData) {
    return templateThumb(templateData, item.dimensions ?? { width: 2, height: 2 });
  }
  if (item.type === ItemType.WORLD_DEED && item.worldDeedData) {
    return deedThumb(item.worldDeedData.size, item.dimensions ?? { width: 1, height: 2 });
  }
  if (item.type === ItemType.MAP && item.mapData) {
    return mapThumb(item.mapData, item.dimensions ?? { width: 2, height: 2 });
  }
  const def = RESOURCE_DEFINITIONS[item.universalDefinitionId] as any;
  const material = def?.materialProps ? materialFromProps(def.materialProps) : gearMaterial(item.tags || []);
  return itemArt({
    wCells: item.dimensions?.width || 1,
    hCells: item.dimensions?.height || 1,
    tags: item.tags || [],
    material,
    rarity: String(item.rarity),
    rank: String(item.rank),
    quality: (item as any).quality,
    durability: item.stats?.durability,
    maxDurability: item.stats?.maxDurability,
    identified: item.isIdentified,
    seed: hashBytes(encoder.encode(item.id))
  });
}

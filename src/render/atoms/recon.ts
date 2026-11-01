/**
 * RECON CELLS (Wave 9, bar: recon readable in grayscale).
 *
 * The drone survey was hue-only — five flat biome colors that collapse to one
 * gray. A sector cell is now drawn from the atoms in the machine's own ground
 * ramp: each biome brings a STRUCTURE and a VALUE KEY, so the survey reads as
 * instrument output in color and in grayscale alike. The exit is a SIGNAL mark
 * (shape, position), scan depth is brightness, and the unknown is void static.
 */

import { BiomeType } from '../../entities/world/types';
import { Role, Sprite, TRI, hash2, px } from './atoms';
import { fnv1a } from '../../logic/rng/DeterministicRNG';

export const RECON_CELL_ATOMS = 16;

// Each biome's structure is a SHAPE, never a hue. Keys keep their grounds on
// different brightness floors, the same law the genres follow.
interface BiomeLook { key: number; structure: (x: number, y: number, sig: number) => number }

const BIOME_LOOKS: Record<BiomeType, BiomeLook> = {
  // Dunes: long diagonal banding
  [BiomeType.WASTELAND]: { key: 2, structure: (x, y) => ((x + y * 2) >> 2) % 3 === 0 ? 1 : 0 },
  // Blotches: large irregular growth patches
  [BiomeType.OVERGROWTH]: { key: 1, structure: (x, y, sig) => hash2(sig, x >> 2, y >> 2) % 3 === 0 ? 2 : 0 },
  // Strata: broken horizontal courses, like surveyed masonry
  [BiomeType.RUINS]: { key: 0, structure: (x, y) => Math.floor((y + TRI[(x >> 1) % 12]) / 3) % 2 === 0 ? 2 : 0 },
  // Lattice: a full grid of worked lines
  [BiomeType.INDUSTRIAL]: { key: 1, structure: (x, y) => (x % 5 === 0 || y % 5 === 0 ? 2 : 0) },
  // Traces: straight vertical conduits with node taps
  [BiomeType.CYBER_CITY]: { key: 0, structure: (x, y, sig) => (x % 4 === 1 ? 2 : x % 4 === 2 && hash2(sig, x >> 2, y >> 2) % 4 === 0 ? 3 : 0) }
};

export interface ReconCellInput {
  biome: BiomeType;
  scanLevel: number;       // 0 unknown … 3 complete
  hasExit?: boolean;       // only shown once the scan knows the sector (level ≥ 1)
  hostiles?: boolean;      // level ≥ 2: contact marks along the top edge
  seed?: string;           // world seed: the static of the unknown is still deterministic
  sx?: number; sy?: number;
  /** D93: ground someone holds, as it was read: chunks across the sector, seen and marked. */
  holding?: { chunks: [number, number][]; seat?: [number, number]; marks: { at: [number, number]; fn: string; built: boolean }[] };
}

/** One sector of the survey, RECON_CELL_ATOMS square. */
export function reconCell(o: ReconCellInput): Sprite {
  const s = RECON_CELL_ATOMS;
  const data = new Uint8Array(s * s);
  const sig = fnv1a(`recon:v1:${o.seed ?? ''}:${o.sx ?? 0},${o.sy ?? 0}`);

  if (o.scanLevel <= 0) {
    // Not yet recorded: void static, unmistakable against any scanned ground.
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      data[y * s + x] = hash2(sig, x, y) % 7 === 0 ? px(Role.VOID, 2) : px(Role.VOID, hash2(sig, y, x) % 2);
    }
    return { w: s, h: s, data };
  }

  const look = BIOME_LOOKS[o.biome] ?? BIOME_LOOKS[BiomeType.WASTELAND];
  // The eye's correction: the ground ramp alone is too dark to survey by.
  // Fills stay in GROUND (the biome's value key), but the STRUCTURE is drawn
  // in MATTER — instrument ink over dark paper — and a deeper scan inks it up.
  const lift = Math.min(2, Math.max(0, o.scanLevel - 1));
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const gx = x + (o.sx ?? 0) * s, gy = y + (o.sy ?? 0) * s;
    const structure = look.structure(gx, gy, sig);
    const speckle = hash2(sig, gx, gy) % 11 === 0 ? 1 : 0;
    data[y * s + x] = structure > 0
      ? px(Role.MATTER, Math.min(4, structure - 1 + lift))
      : px(Role.GROUND, Math.min(4, 2 + look.key + speckle));
  }

  // Contacts (level 2+): loss ticks along the top edge — position, not hue alone.
  if (o.hostiles && o.scanLevel >= 2) {
    for (let x = 1; x < s - 1; x += 3) data[1 * s + x] = px(Role.LOSS, 3);
  }

  // Held ground: hatching with a hard seam at its border, by position and shape, never hue.
  if (o.holding) {
    const per = s / 8;
    const held = new Set(o.holding.chunks.map(([x, y]) => `${x},${y}`));
    for (const [cx, cy] of o.holding.chunks) {
      for (let dy = 0; dy < per; dy++) for (let dx = 0; dx < per; dx++) {
        const x = cx * per + dx, y = cy * per + dy;
        if ((x + y) % 2 === 0) data[y * s + x] = px(Role.VOID, 0);
        const edge = (dx === 0 && !held.has(`${cx - 1},${cy}`)) || (dx === per - 1 && !held.has(`${cx + 1},${cy}`))
          || (dy === 0 && !held.has(`${cx},${cy - 1}`)) || (dy === per - 1 && !held.has(`${cx},${cy + 1}`));
        if (edge) data[y * s + x] = px(Role.PROOF, 4);
      }
    }
    // A seat fills its chunk, an anchor is a diagonal stroke, anything else one corner
    const fill = ([cx, cy]: [number, number], at: (dx: number, dy: number) => boolean, ink: number) => {
      for (let dy = 0; dy < per; dy++) for (let dx = 0; dx < per; dx++) if (at(dx, dy)) data[(cy * per + dy) * s + cx * per + dx] = ink;
    };
    for (const m of o.holding.marks) {
      if (m.fn === 'anchor') fill(m.at, (dx, dy) => dx === dy, px(Role.SIGNAL, m.built ? 4 : 2));
      else if (m.fn !== 'seat') fill(m.at, (dx, dy) => dx === 0 && dy === 0, px(Role.MATTER, m.built ? 4 : 2));
    }
    if (o.holding.seat) fill(o.holding.seat, () => true, px(Role.PROOF, 4));
  }

  // The exit: a signal lozenge, bottom-right, with a void moat so it reads on any ground.
  if (o.hasExit) {
    const cx = s - 5, cy = s - 5;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const d = Math.abs(x) + Math.abs(y);
      if (d > 3) continue;
      data[(cy + y) * s + cx + x] = d === 3 ? px(Role.VOID, 0) : d >= 2 ? px(Role.SIGNAL, 3) : px(Role.SIGNAL, 1);
    }
    data[cy * s + cx] = px(Role.SIGNAL, 4);
  }

  return { w: s, h: s, data };
}

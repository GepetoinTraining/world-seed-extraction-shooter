/**
 * THE ATOMS: prototype.
 *
 * Six families (pixel, ramp, grain, edge, part, mark) and the rules that compose
 * them. Everything here is pure integer arithmetic over byte buffers, so the same
 * input gives the same bytes on every machine.
 *
 * A pixel byte is 0 for transparent, otherwise 1 + role * STEPS + step.
 */

import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { hash2 } from '../../logic/rng/noise';
import { IThemeLook, LOOK_COLORS } from '../../logic/theme/ThemeTypes';

export { hash2 };

export const ATOM_PX = 2;
export const TILE_ATOMS = 10;
export const STEPS = 5;

export enum Role { GROUND, MATTER, LIFE, THREAT, SIGNAL, PROOF, LOSS, VOID }
const ROLE_COUNT = 8;

export interface Sprite { w: number; h: number; data: Uint8Array }
export interface GenreLook { structure: 'strata' | 'blotches' | 'lattice' | 'dunes'; key: number }
export interface Genre { name: string; palette: [string, string, string, string]; look?: GenreLook }
export interface Material {
  density: number; hardness: number; conductivity: number; resonance: number;
  luminosity: number; toxicity: number; elasticity: number;
}

export const px = (role: Role, step: number) => 1 + role * STEPS + Math.max(0, Math.min(STEPS - 1, step));

export const material = (m: Partial<Material>): Material => ({
  density: 0, hardness: 0, conductivity: 0, resonance: 0, luminosity: 0, toxicity: 0, elasticity: 0, ...m
});

// ---------------------------------------------------------------------------
// Integer helpers
// ---------------------------------------------------------------------------

export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n, y = (x + 1) >> 1;
  while (y < x) { x = y; y = (x + Math.floor(n / x)) >> 1; }
  return x;
}

export const hashBytes = (data: Uint8Array): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

// ---------------------------------------------------------------------------
// RAMP: roles keep their values in every world; only the hue changes.
// ---------------------------------------------------------------------------

const ROLE_LUMA: Record<number, number[]> = {
  [Role.GROUND]: [10, 16, 24, 34, 46],
  [Role.MATTER]: [50, 85, 120, 160, 205],
  [Role.LIFE]: [55, 90, 130, 170, 215],
  [Role.THREAT]: [60, 100, 145, 190, 240]
};

const MACHINE: Record<number, [number, number, number][]> = {
  [Role.SIGNAL]: [[0, 67, 35], [6, 152, 85], [16, 196, 112], [32, 222, 129], [140, 239, 193]],
  [Role.PROOF]: [[77, 64, 0], [128, 106, 0], [179, 149, 0], [255, 215, 0], [255, 239, 133]],
  [Role.LOSS]: [[69, 10, 10], [127, 29, 29], [185, 28, 28], [239, 68, 68], [252, 165, 165]],
  [Role.VOID]: [[3, 3, 3], [5, 5, 5], [10, 10, 10], [17, 17, 17], [24, 24, 27]]
};

const parseHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)
];

const luma = (r: number, g: number, b: number) => Math.floor((299 * r + 587 * g + 114 * b) / 1000);

function atLuma(rgb: [number, number, number], target: number): [number, number, number] {
  const y = Math.max(1, luma(rgb[0], rgb[1], rgb[2]));
  let out = rgb.map(c => Math.min(255, Math.floor((c * target) / y))) as [number, number, number];
  for (let i = 0; i < 64 && luma(out[0], out[1], out[2]) < target; i++) {
    out = out.map(c => Math.min(255, c + 4)) as [number, number, number];
  }
  return out;
}

/**
 * D119: the colours a new thing can be, each its own ramp after the eight roles, so no existing
 * sprite's bytes move. All share one brightness ramp: in grayscale every colour reads the same,
 * so colour is only ever a look and shape does the telling apart (Pedro is colourblind).
 */
export const LOOK_HUES: Record<typeof LOOK_COLORS[number], string> = {
  ash: '#8c8c88', bone: '#c9bd9a', ochre: '#c2902f', rust: '#b5691f', ember: '#e0352e',
  moss: '#6f8f3a', verdigris: '#3f9c86', slate: '#5f7f9c', indigo: '#5a5fc0', plum: '#94508f'
};
const LOOK_LUMA = [50, 85, 120, 160, 205];
const lookRole = (color: string): Role => (ROLE_COUNT + Math.max(0, LOOK_COLORS.indexOf(color as typeof LOOK_COLORS[number]))) as Role;

/** RGB per pixel byte. Index 0 is unused (transparent). */
export function buildPalette(genre: Genre): Uint8Array {
  const table = new Uint8Array((1 + (ROLE_COUNT + LOOK_COLORS.length) * STEPS) * 3);
  const set = (role: number, step: number, c: [number, number, number]) => {
    const i = (1 + role * STEPS + step) * 3;
    table[i] = c[0]; table[i + 1] = c[1]; table[i + 2] = c[2];
  };
  [Role.GROUND, Role.MATTER, Role.LIFE, Role.THREAT].forEach((role, slot) => {
    const hue = parseHex(genre.palette[slot]);
    ROLE_LUMA[role].forEach((l, step) => set(role, step, atLuma(hue, l)));
  });
  Object.entries(MACHINE).forEach(([role, ramp]) => ramp.forEach((c, step) => set(Number(role), step, c)));
  LOOK_COLORS.forEach((color, i) => LOOK_LUMA.forEach((l, step) => set(ROLE_COUNT + i, step, atLuma(parseHex(LOOK_HUES[color]), l))));
  return table;
}

export function grayscale(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(palette.length);
  for (let i = 0; i < palette.length; i += 3) {
    const y = luma(palette[i], palette[i + 1], palette[i + 2]);
    out[i] = y; out[i + 1] = y; out[i + 2] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// GRAIN: properties become pixels.
// ---------------------------------------------------------------------------

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const TRI = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3];
const CELL = TILE_ATOMS;

/** Brightness offset (0+) a material adds to one atom. */
export function grain(m: Material, x: number, y: number, seed: number): number {
  const ax = x + 1024, ay = y + 1024;
  let step = 0;
  if (BAYER[ay & 3][ax & 3] < Math.ceil((m.density * 16) / 100)) step += 1;
  if (m.conductivity > 0) {
    // Spacing carries the amount; a line that may not appear at all carries nothing.
    const s = Math.max(3, 12 - Math.floor(m.conductivity / 10));
    const live = 50 + (m.conductivity >> 1);
    const onV = ax % s === 0 && hash2(seed, Math.floor(ax / s), Math.floor(ay / 6)) % 100 < live;
    const onH = ay % s === 0 && hash2(seed + 1, Math.floor(ax / 6), Math.floor(ay / s)) % 100 < live;
    if (onV || onH) step += 2;
  }
  if (m.resonance > 0) {
    const dx = (ax % CELL) - 5, dy = (ay % CELL) - 5;
    if (isqrt(dx * dx + dy * dy) % Math.max(2, 5 - Math.floor(m.resonance / 30)) === 0) step += 1;
  }
  if (m.toxicity > 0 && hash2(seed + 2, ax, ay) % 100 < m.toxicity) step += 2;
  if (m.elasticity > 0 && (ay + TRI[ax % 12]) % Math.max(4, 14 - Math.floor(m.elasticity / 10)) === 0) step += 1;
  if (m.hardness >= 10 && (ax + ay) % Math.max(3, 14 - Math.floor(m.hardness / 8)) === 0) step += 1;
  return step + Math.floor(m.luminosity / 34);
}

// ---------------------------------------------------------------------------
// PART: shapes are drawn on a 48-unit design grid, then sampled to any size.
// ---------------------------------------------------------------------------

export const D = 48;

export class Ink {
  body = new Uint8Array(D * D);
  eye = new Uint8Array(D * D);

  private put(layer: Uint8Array, x: number, y: number, v: number) {
    if (x >= 0 && y >= 0 && x < D && y < D) layer[y * D + x] = v;
  }

  disc(cx: number, cy: number, r: number, v = 1) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.put(this.body, x, y, v);
    }
    return this;
  }

  rect(x0: number, y0: number, x1: number, y1: number, v = 1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.put(this.body, x, y, v);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, thick: number, v = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      this.disc(x0 + Math.round(((x1 - x0) * i) / n), y0 + Math.round(((y1 - y0) * i) / n), thick, v);
    }
    return this;
  }

  /** Draw on the left half and mirror it. */
  both(draw: (flip: (x: number) => number) => void) {
    draw(x => x);
    draw(x => D - 1 - x);
    return this;
  }

  eyeAt(x: number, y: number, r = 2) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) this.put(this.eye, x + dx, y + dy, 1);
    return this;
  }
}

/** Sample the design grid to size S. A cell is on when at least a third of it is covered. */
export function sampleRect(layer: Uint8Array, w: number, h: number, anyCoverage = false): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    const x0 = Math.floor((tx * D) / w), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * D) / w));
    const y0 = Math.floor((ty * D) / h), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * D) / h));
    let on = 0, total = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { total++; on += layer[y * D + x] ? 1 : 0; }
    out[ty * w + tx] = (anyCoverage ? on > 0 : on * 3 >= total) ? 1 : 0;
  }
  return out;
}

export interface StampStyle { role: Role; edgeStep: number; minFill: number; maxFill: number; eyeStep?: number; edgeGrain?: boolean }

/** EDGE + GRAIN: turn sampled ink into a sprite with a hard void seam around it. */
export function stamp(ink: Ink, s: number, m: Material, seed: number, style: StampStyle, sh = s): Sprite {
  const body = sampleRect(ink.body, s, sh);
  const eye = sampleRect(ink.eye, s, sh, true);
  const w = s + 2, h = sh + 2, data = new Uint8Array(w * h);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < s && y < sh && body[y * s + x] === 1;

  for (let y = 0; y < sh; y++) for (let x = 0; x < s; x++) {
    if (!on(x, y)) continue;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    let value: number;
    if (eye[y * s + x] && style.eyeStep !== undefined) value = px(style.role, style.eyeStep);
    else if (edge) value = px(style.role, style.edgeGrain && grain(m, x, y, seed) === 0 ? style.edgeStep - 1 : style.edgeStep);
    else value = px(style.role, Math.min(style.maxFill, style.minFill + grain(m, x, y, seed)));
    data[(y + 1) * w + x + 1] = value;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[y * w + x]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && data[ny * w + nx] !== 0 && data[ny * w + nx] !== px(Role.VOID, 0);
    });
    if (near) data[y * w + x] = px(Role.VOID, 0);
  }
  return { w, h, data };
}

export const maskOf = (sprite: Sprite): Uint8Array =>
  sprite.data.map(v => (v !== 0 && v !== px(Role.VOID, 0) ? 1 : 0));

/** Fraction of the union of two same-size masks that differs. */
export function maskDifference(a: Uint8Array, b: Uint8Array): number {
  let union = 0, diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] !== b[i]) diff++;
  }
  return union === 0 ? 0 : diff / union;
}

// ---------------------------------------------------------------------------
// CREATURES: the body plan comes from tags, so a new creature needs no new art.
// ---------------------------------------------------------------------------

export type Plan = 'ring' | 'tracks' | 'spikes' | 'rotor' | 'hull' | 'wings' | 'tendril' | 'biped' | 'swarm' | 'grazer';

export function planFor(tags: string[]): Plan {
  const has = (t: string) => tags.includes(t);
  if (has('god')) return 'ring';
  if (has('vehicle')) return 'tracks';
  if (has('titan') || (has('boss') && has('beast'))) return 'spikes';
  if (has('mechanical') && has('flying')) return 'rotor';
  if (has('mechanical')) return 'hull';
  if (has('flying')) return 'wings';
  if (has('horror')) return 'tendril';
  if (has('humanoid')) return 'biped';
  if (has('livestock')) return 'grazer';
  return 'swarm';
}

/**
 * Two stepped frames per plan: frame 1 moves only what that body would move.
 * Every delta is at least ~6 design units, so it survives sampling at TINY size.
 */
function drawPlan(plan: Plan, seed: number, frame = 0): Ink {
  const k = new Ink();
  const v = (n: number, mod: number) => hash2(seed, n, 7) % mod;
  const s = frame % 2; // the step: 0 or 1

  switch (plan) {
    case 'swarm':
      k.disc(24, 28, 11).disc(24, 15, 8);
      k.both(f => { k.disc(f(16), 8, 3); k.line(f(15), 24, f(5), 18 + v(1, 4) + s * 6, 1); k.line(f(15), 33, f(5), 38 - s * 6, 1); });
      k.line(24, 38, 24 + (s ? -1 : 1) * (6 + v(2, 8)), 47, 1);
      k.eyeAt(20, 13).eyeAt(28, 13);
      break;
    case 'biped':
      k.disc(24, 10, 7).rect(11, 18, 37, 25).rect(16, 25, 32, 36).rect(16, 36, 21, 47 - s * 6).rect(27, 36, 32, 41 + s * 6);
      k.both(f => k.line(f(11), 21, f(6), 36, 2));
      k.line(39, 37, 44, 5 + v(1, 6) + s * 6, 2);
      k.eyeAt(21, 9).eyeAt(27, 9);
      break;
    case 'wings':
      k.disc(24, 24, 9).disc(24, 10, 6).line(24, 32, 24, 47, 2);
      k.both(f => { k.line(f(18), 20, f(1), 8 + v(1, 5) + s * 9, 4); k.line(f(18), 27, f(3), 34 - s * 5, 4); k.line(f(14), 30, f(8), 42, 2); });
      k.eyeAt(21, 9).eyeAt(27, 9);
      break;
    case 'rotor':
      k.both(f => {
        k.line(f(19), 19, f(9), 9, 2); k.line(f(19), 29, f(9), 39, 2);
        k.disc(f(8), 8, 8); k.disc(f(8), 8 + (s ? -3 : 0), 4, 0).disc(f(8) + (s ? 3 : 0), 8, s ? 3 : 0, 0);
        k.disc(f(8), 40, 8); k.disc(f(8), 40 + (s ? 3 : 0), 4, 0).disc(f(8) + (s ? -3 : 0), 40, s ? 3 : 0, 0);
      });
      k.disc(24, 24, 8);
      k.eyeAt(24, 23, 3);
      break;
    case 'hull':
      k.rect(10, 12, 38, 40).rect(20 + s * 5, 0, 28 + s * 5, 14);
      k.both(f => k.rect(Math.min(f(2), f(8)), 14, Math.max(f(2), f(8)), 38));
      k.disc(24, 26, 9, 0).disc(24, 26, 5);
      k.eyeAt(24, 26, 2);
      break;
    case 'tracks':
      k.both(f => k.rect(Math.min(f(0), f(10)), 2, Math.max(f(0), f(10)), 46));
      k.rect(13, 8, 35, 40);
      k.both(f => { k.disc(f(18), 16 + s * 6, 5); k.rect(Math.min(f(16), f(20)), 0, Math.max(f(16), f(20)), 14); });
      k.rect(18, 30, 30, 34, 0);
      k.both(f => { for (let y = 4 + s * 4; y < 46; y += 8) k.rect(Math.min(f(1), f(9)), y, Math.max(f(1), f(9)), y + 1, 0); });
      k.eyeAt(24, 24, 2);
      break;
    case 'tendril': {
      k.disc(24, 24, 11);
      const ends = [[6, 6], [42, 10], [3, 30], [44, 34], [14, 46], [34, 45]];
      // Only every other tendril sways, so the body holds while the limbs search.
      const sway = (i: number) => (s && i % 2 ? 5 : 0);
      ends.forEach(([ex, ey], i) => k.line(24, 24, ex + v(i, 5) - 2 + sway(i), ey + v(i + 9, 5) - 2 - sway(i), 1 + v(i + 20, 2)));
      k.eyeAt(19, 20).eyeAt(29, 22).eyeAt(24, 29);
      break;
    }
    case 'ring': {
      k.disc(24, 24, 23).disc(24, 24, 15, 0).disc(24, 24, 6);
      // The halo turns: frame 1 holds the spots at the half-step angles.
      const spots = s
        ? [[32, 6], [42, 16], [42, 32], [32, 42], [16, 42], [6, 32], [6, 16], [16, 6]]
        : [[24, 4], [38, 10], [44, 24], [38, 38], [24, 44], [10, 38], [4, 24], [10, 10]];
      spots.forEach(([x, y]) => k.eyeAt(x, y, 2));
      k.eyeAt(24, 24, s ? 2 : 3);
      break;
    }
    case 'spikes':
      k.disc(24, 28, 18).disc(24, 9 + s * 4, 8);
      k.both(f => { k.line(f(9), 18, f(0), 8 + s * 6, 2); k.line(f(6), 30, f(0), 30, 2); k.line(f(10), 41, f(2), 47, 2); k.line(f(19), 3 + s * 4, f(16), s * 4, 1); });
      k.eyeAt(20, 8 + s * 4).eyeAt(28, 8 + s * 4);
      break;
    case 'grazer':
      // Long and low on four legs, head up: nothing else here stands like this
      k.rect(6, 16, 35, 31).disc(39, 11, 7).line(32, 18, 38, 13, 3);
      k.rect(8, 32, 13, 47 - s * 6).rect(16, 32, 21, 41 + s * 6).rect(23, 32, 28, 47 - s * 6).rect(30, 32, 35, 41 + s * 6);
      k.line(6, 18, 1, 26 + v(1, 5), 1);
      k.eyeAt(41, 10);
      break;
  }
  return k;
}

/**
 * What a change of form adds to the body it inherits (D61). On a thin body a feature is
 * added and joined to it, and the body stays whole. A dense body has no room outside it,
 * so there the feature cuts its own hard seam and is drawn inside that. A mark on the
 * body cuts on any body. The rest pose decides which, so nothing flickers between frames. `tests/trees.test.ts` holds each
 * one visible on every plan, at every size and from every side. Shape and place, never hue.
 */
type FeatureStroke = { from: [number, number]; to: [number, number]; thick?: number; mirror?: boolean; seamOnly?: boolean; mark?: boolean };
const FEATURE_CUT = 4;
/** Above this share of the design grid a body is dense: there is no room left to add to. */
const DENSE_MASS = 0.55;

const FEATURE_STROKES: Record<string, FeatureStroke[]> = {
  horns: [{ from: [17, 11], to: [6, 2], mirror: true }],
  crest: [{ from: [24, 13], to: [24, 3], thick: 4 }, { from: [11, 2], to: [36, 2], thick: 2 }],
  spines: [{ from: [11, 13], to: [2, 7], mirror: true }, { from: [10, 24], to: [2, 24], mirror: true }, { from: [11, 36], to: [2, 41], mirror: true }],
  tail: [{ from: [27, 35], to: [41, 45], thick: 4 }],
  plates: [{ from: [3, 10], to: [44, 10], thick: 3, seamOnly: true }, { from: [3, 43], to: [44, 43], thick: 3, seamOnly: true }],
  fangs: [{ from: [9, 22], to: [22, 46], thick: 4, mirror: true }],
  mantle: [{ from: [3, 7], to: [44, 7], thick: 4 }],
  barbs: [{ from: [3, 22], to: [3, 22], thick: 4, mirror: true }, { from: [2, 46], to: [2, 46], thick: 4, mirror: true }],
  brand: [{ from: [13, 22], to: [34, 22], thick: 2, seamOnly: true, mark: true }, { from: [24, 13], to: [24, 34], thick: 2, seamOnly: true, mark: true }],
  stilts: [{ from: [20, 33], to: [12, 47], thick: 4, mirror: true }],
  fins: [{ from: [19, 36], to: [1, 46], thick: 4, mirror: true }]
};

/**
 * @param rest the plain body at rest: what decides dense or thin, and where a stroke joins.
 * @param again how many of this shape the line already bears: a second sits lower and further out.
 */
function drawFeature(k: Ink, rest: Ink, feature: string, again: number) {
  const dx = again * 3, dy = again * 6;
  const paths = (FEATURE_STROKES[feature] ?? []).flatMap(s => {
    const thick = s.thick ?? 3;
    const at = (flip: (x: number) => number) => ({ x0: flip(s.from[0] - dx), y0: s.from[1] + dy, x1: flip(s.to[0] - dx), y1: s.to[1] + dy, thick, seamOnly: s.seamOnly, mark: s.mark });
    return s.mirror ? [at(x => x), at(x => D - 1 - x)] : [at(x => x)];
  });

  let cx = 0, cy = 0, mass = 0;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (rest.body[y * D + x]) { cx += x; cy += y; mass++; }
  }

  const dense = mass > D * D * DENSE_MASS;
  const seams = paths.filter(p => dense || p.mark);
  seams.forEach(p => k.line(p.x0, p.y0, p.x1, p.y1, p.seamOnly ? p.thick : p.thick + FEATURE_CUT, 0));
  if (!dense && mass > 0) {
    // Nothing floats: a stroke that starts in the air reaches in to the body's nearest edge
    const mx = Math.round(cx / mass), my = Math.round(cy / mass);
    for (const p of paths.filter(p => !p.mark)) {
      const steps = Math.max(Math.abs(mx - p.x0), Math.abs(my - p.y0), 1);
      for (let i = 0; i <= steps; i++) {
        const x = p.x0 + Math.round(((mx - p.x0) * i) / steps), y = p.y0 + Math.round(((my - p.y0) * i) / steps);
        if (rest.body[y * D + x]) {
          k.line(p.x0, p.y0, x, y, 1);
          break;
        }
      }
    }
  }
  paths.forEach(p => {
    if (!seams.includes(p)) k.line(p.x0, p.y0, p.x1, p.y1, p.thick);
    else if (!p.seamOnly) k.line(p.x0, p.y0, p.x1, p.y1, Math.max(1, p.thick - 1));
  });
}

export function creatureMaterial(tags: string[]): Material {
  const has = (t: string) => tags.includes(t);
  if (has('god')) return material({ density: 20, resonance: 80, luminosity: 30 });
  if (has('vehicle')) return material({ density: 80, hardness: 80, conductivity: 40 });
  if (has('mechanical')) return material({ density: 70, hardness: has('armored') ? 90 : 60, conductivity: 60 });
  if (has('horror')) return material({ density: 40, toxicity: 45, elasticity: 30 });
  if (has('titan') || has('beast')) return material({ density: 60, hardness: 45, elasticity: 20 });
  if (has('humanoid')) return material({ density: 60, hardness: 30 });
  return material({ density: 50, elasticity: 40 });
}

export const SIZE_ATOMS: Record<string, number> = { TINY: 10, MEDIUM: 14, LARGE: 20, GIGANTIC: 32, COLOSSAL: 48 };

export type CreatureFacing = 'down' | 'up' | 'left' | 'right';
export interface CreaturePose { facing?: CreatureFacing; frame?: number }

/** Radially symmetric bodies have no front, so they keep one face in every direction. */
export const RADIAL_PLANS: Plan[] = ['ring'];

/** Seen from the side a body narrows to 5/8 of itself and the eyes slide toward where it looks. */
function sideInk(k: Ink): Ink {
  const out = new Ink();
  const c = (D - 1) / 2;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const sx = Math.round(c + ((x - c) * 8) / 5);
    if (sx >= 0 && sx < D && k.body[y * D + sx]) out.body[y * D + x] = 1;
  }
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    if (!k.eye[y * D + x]) continue;
    // The eye slides toward where it looks, but never off the body: a side view
    // must keep its eye, or a symmetric body would mirror into itself.
    let nx = Math.min(D - 1, Math.max(0, Math.round(c + ((x - c) * 5) / 8) + 9));
    while (nx > 0 && !out.body[y * D + nx]) nx--;
    if (out.body[y * D + nx]) out.eye[y * D + nx] = 1;
  }
  return out;
}

/**
 * Seen from behind the eyes are gone and a dashed dorsal line runs down the lower
 * body — low, so even at TINY size the back never samples like a front-facing eye.
 */
function backInk(k: Ink): Ink {
  const out = new Ink();
  out.body.set(k.body);
  for (let y = 30; y <= 46; y += 2) for (let x = 21; x <= 26; x++) {
    if (k.body[y * D + x]) out.eye[y * D + x] = 1;
  }
  return out;
}

/** A kind that has changed draws from the first of its line, plus what its line has added. */
export interface CreatureLineArt { root: string; rootTags: string[]; features: string[] }

export function creature(def: { id: string; tags: string[]; size?: string; line?: CreatureLineArt }, s?: number, pose: CreaturePose = {}): Sprite {
  const seed = fnv1a(`sprite:v1:${def.line?.root ?? def.id}`);
  const size = s ?? SIZE_ATOMS[def.size || 'MEDIUM'] ?? 14;
  const tags = def.line?.rootTags ?? def.tags;
  const plan = planFor(tags);
  const facing = RADIAL_PLANS.includes(plan) ? 'down' : pose.facing ?? 'down';
  let ink = drawPlan(plan, seed, pose.frame ?? 0);
  if (def.line) {
    const rest = drawPlan(plan, seed, 0);
    def.line.features.forEach((feature, i, all) => drawFeature(ink, rest, feature, all.slice(0, i).filter(f => f === feature).length));
  }
  if (facing === 'up') ink = backInk(ink);
  if (facing === 'left' || facing === 'right') ink = sideInk(ink);
  const sprite = stamp(ink, size, creatureMaterial(tags), seed, {
    role: Role.THREAT, edgeStep: 3, minFill: 0, maxFill: 2, eyeStep: 4
  });
  return facing === 'left' ? mirrorSprite(sprite) : sprite;
}

export const mirrorSprite = (s: Sprite): Sprite => {
  const data = new Uint8Array(s.data.length);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) data[y * s.w + x] = s.data[y * s.w + (s.w - 1 - x)];
  return { w: s.w, h: s.h, data };
};

// ---------------------------------------------------------------------------
// RESOURCES: form from tags, fill from real material numbers.
// ---------------------------------------------------------------------------

/**
 * Game values to a 0-100 grain scale. Fixed and versioned: deriving it from the
 * data would change old worlds whenever a new material arrived. Density and
 * Conductivity span wide ranges in the game, so they are read on a square root.
 */
export function materialFromProps(props?: Partial<Record<string, number>>): Material {
  const p = props || {};
  const cap = (n: number) => Math.min(100, Math.floor(n));
  return material({
    density: cap(isqrt(Math.floor((p.DENSITY || 0) * 500))), hardness: cap(p.HARDNESS || 0), conductivity: cap(isqrt(Math.floor((p.CONDUCTIVITY || 0) * 333))),
    resonance: cap(p.RESONANCE || 0), luminosity: cap((p.LUMINOSITY || 0) * 8), toxicity: cap((p.TOXICITY || 0) * 8),
    elasticity: cap((p.ELASTICITY || 0) * 4)
  });
}

/** A lump whose outline follows hardness: square when hard, round when soft. */
function lump(k: Ink, cx: number, cy: number, r: number, hardness: number, seed: number) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const cheb = Math.max(Math.abs(x), Math.abs(y));
    const eucl = isqrt(x * x + y * y);
    const metric = Math.floor((hardness * cheb + (100 - hardness) * (eucl + (eucl >> 2))) / 100);
    const dent = hash2(seed, Math.floor((x + 64) / 8), Math.floor((y + 64) / 8)) % 4;
    if (metric <= r - dent) k.rect(cx + x, cy + y, cx + x, cy + y);
  }
}

const CROWN_LOBES = [[-9, -6], [9, -6], [-12, 3], [12, 3], [0, -11], [-6, 8], [6, 8]];
const CANOPY_GAPS = [[-7, -2], [6, -5], [-2, 7], [8, 4]];

/**
 * The tree stands upright (D1): a crown you walk under and a trunk that blocks (D3).
 * Each felling takes a bite out of the crown; the last leaves a stump.
 */
function treeCrownInk(seed: number, uses: number, full: number): Ink {
  const k = new Ink();
  if (uses <= 0) return k;
  k.disc(24, 15, 12);
  CROWN_LOBES.forEach(([dx, dy], i) => k.disc(24 + dx, 15 + dy, 6 + hash2(seed, i, 9) % 3));
  CANOPY_GAPS.forEach(([dx, dy], i) => k.disc(24 + dx, 15 + dy, 2 + hash2(seed, i, 5) % 2, 0));
  if (uses < full) {
    const heavy = uses * 2 <= full;
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      if (heavy ? x >= 24 || y <= 12 : x >= 24 && y <= 15) k.rect(x, y, x, y, 0);
    }
  }
  return k;
}

function treeTrunkInk(uses: number): Ink {
  const k = new Ink();
  if (uses <= 0) {
    // The stump: a short stub with its rings showing. A tree never regrows.
    k.rect(17, 34, 30, 47).rect(19, 31, 28, 34);
    k.eyeAt(23, 38, 2);
    return k;
  }
  k.rect(20, 14, 27, 47);
  k.rect(14, 44, 33, 47);
  k.line(27, 28, 35, 22, 1);
  return k;
}

export const TREE_ATOMS = { w: 16, h: 24 };

/** The standing tree, trunk and crown composed: crown in life, trunk in matter. */
export function treeSprite(def: any, uses: number, full: number, variant = 0): Sprite {
  const seed = fnv1a(`sprite:v1:${def.id}`) + variant;
  const { w, h } = TREE_ATOMS;
  const trunkStyle: StampStyle = uses <= 0
    ? { role: Role.MATTER, edgeStep: 2, minFill: 1, maxFill: 1, eyeStep: 3 }
    : { role: Role.MATTER, edgeStep: 2, minFill: 0, maxFill: 2 };
  const trunk = stamp(treeTrunkInk(uses), w, material({ density: 60, hardness: 40 }), seed, trunkStyle, h);
  if (uses <= 0) return trunk;
  const m = knownMaterial(def.materialProps, KNOWN);
  const crown = stamp(treeCrownInk(seed, uses, full), w, m, seed, { role: Role.LIFE, edgeStep: 3, minFill: 1, maxFill: 4, edgeGrain: true }, h);
  const data = new Uint8Array(trunk.data);
  for (let i = 0; i < data.length; i++) if (crown.data[i]) data[i] = crown.data[i];
  return { w: trunk.w, h: trunk.h, data };
}

const isTree = (tags: string[]) => tags.includes('wood') && !tags.includes('seed');

function resourceInk(def: any, m: Material, seed: number, level = KNOWN): Ink {
  const k = new Ink();
  const tags: string[] = def.tags || [];
  const has = (t: string) => tags.includes(t);
  if (has('grain')) {
    [12, 24, 36].forEach((x, i) => { k.line(x, 46, x, 14, 1); k.disc(x, 10 + (i % 2) * 3, 5); });
  } else if (has('berry')) {
    k.disc(16, 18, 9).disc(33, 16, 9).disc(24, 33, 10);
  } else if (has('fruit')) {
    k.disc(24, 29, 17).line(24, 13, 30, 2, 1).line(30, 6, 40, 4, 2);
    if (has('poison') && level >= KNOWN) k.disc(24, 29, 6, 0);
  } else if (has('fiber')) {
    [8, 22, 36].forEach(x => k.line(x, 46, x + 8, 3, 2));
  } else if (has('seed')) {
    // The sapling stands upright like its parent: a stem, two leaves, and the mound it grows from.
    k.rect(21, 18, 26, 44).rect(13, 42, 34, 47);
    k.disc(13, 17, 9).disc(33, 11, 10);
    k.line(15, 19, 23, 28, 2).line(31, 13, 24, 24, 2);
  } else if (has('wood')) {
    const uses = def.uses ?? 3;
    return treeCrownInk(seed, uses, uses);
  } else if (has('sand')) {
    for (let y = 26; y < 48; y++) { const half = Math.floor((y - 22) * 1.1); k.rect(24 - half, y, 24 + half, y); }
  } else if (has('glass')) {
    k.line(24, 3, 12, 44, 2).line(24, 3, 38, 44, 2).line(12, 44, 38, 44, 2).line(25, 12, 22, 40, 3);
  } else if (has('salvage')) {
    k.rect(5, 8, 43, 40).rect(5, 8, 15, 16, 0).rect(34, 30, 43, 40, 0).disc(14, 30, 3, 0).disc(33, 18, 3, 0);
  } else if (has('stone') && m.density <= 25) {
    k.disc(13, 15, 8).disc(35, 12, 6).disc(19, 35, 9).disc(38, 35, 6);
  } else {
    lump(k, 24, 24, 21, m.hardness, seed);
  }
  return k;
}

/**
 * KNOWLEDGE: 0 unknown, 1 named, 2 base properties, 3 affixes. These are the levels
 * of the game's MaterialScience. Form survives at 0 because it is plain to see; what
 * it is made of does not, so unknown things of one form share every pixel.
 */
export const KNOWN = 2;
const UNKNOWN_SEED = fnv1a('sprite:v1:unknown');
const UNKNOWN_HARDNESS = 50;

function knownMaterial(props: Partial<Record<string, number>> | undefined, level: number): Material {
  const m = materialFromProps(props);
  if (level <= 0) return material({ density: 50, hardness: UNKNOWN_HARDNESS });
  if (level === 1) return material({ density: m.density, hardness: UNKNOWN_HARDNESS });
  return m;
}

/** Spent: only a broken outline is left. What will return keeps a live sprout at its center. */
export function spent(s: Sprite, regrows: boolean): Sprite {
  const mask = maskOf(s);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && mask[y * s.w + x] === 1;
  const data = new Uint8Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!on(x, y) || (x + y) % 2 !== 0) continue;
    if (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) continue;
    data[y * s.w + x] = regrows ? px(Role.LIFE, 1) : px(Role.MATTER, 1);
  }
  if (regrows) {
    const cx = s.w >> 1, cy = s.h >> 1;
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { data[(cy + dy) * s.w + cx + dx] = px(Role.LIFE, 4); });
  }
  return { w: s.w, h: s.h, data };
}

const AFFIX_MARKS: Record<string, number[][]> = {
  aff_dense: [[0, 0], [1, 0], [0, 1], [1, 1]],
  aff_volatile: [[0, 0], [1, 1], [2, 0], [1, 2]],
  aff_arcane: [[1, 0], [0, 1], [2, 1], [1, 2]]
};
const AFFIX_THRESHOLD: Record<string, number> = { aff_dense: 2, aff_volatile: 3, aff_arcane: 3 };

/** D119: how many atoms across each size word is. */
export const LOOK_ATOMS: Record<IThemeLook['size'], number> = { tiny: 8, small: 10, medium: 12, large: 16 };

/** D119: what each shape word draws, on the same 48 by 48 the rest of the art is inked on. */
const taper = (k: Ink, top: number, bottom: number, widen: number, cx = 24) => {
  for (let y = top; y <= bottom; y++) { const half = Math.floor((y - top) * widen); k.rect(cx - half, y, cx + half, y); }
  return k;
};
export const LOOK_INKS: Record<IThemeLook['shape'], (m: Material, seed: number) => Ink> = {
  lump: (m, seed) => { const k = new Ink(); lump(k, 24, 24, 21, m.hardness, seed); return k; },
  shard: () => taper(new Ink(), 2, 45, 0.3, 18).rect(10, 40, 40, 45).line(18, 3, 40, 42, 3),
  rod: () => new Ink().rect(19, 1, 29, 46),
  coil: () => new Ink().disc(24, 24, 23).disc(24, 24, 16, 0).disc(24, 24, 9).disc(24, 24, 3, 0),
  ring: () => new Ink().disc(24, 24, 23).disc(24, 24, 13, 0),
  plate: () => new Ink().rect(2, 14, 45, 33),
  cluster: () => new Ink().disc(13, 15, 9).disc(35, 12, 7).disc(19, 35, 10).disc(38, 35, 7),
  tuft: () => { const k = new Ink(); [6, 18, 30, 40].forEach((x, i) => k.line(x, 46, x + (i % 2 ? -5 : 5), 3 + i * 3, 3)); return k; },
  crystal: () => { const k = new Ink(); for (let y = 0; y <= 47; y++) { const half = y < 16 ? y : Math.floor((47 - y) * 0.5); k.rect(24 - half, y, 24 + half, y); } return k; },
  spike: () => taper(new Ink(), 0, 47, 0.2),
  pod: () => new Ink().disc(24, 16, 14).disc(24, 32, 14).rect(23, 0, 25, 6),
  heap: () => taper(new Ink(), 14, 46, 0.72)
};

export const worldSize = (def: any) => {
  if (def.look) return LOOK_ATOMS[def.look.size as IThemeLook['size']] ?? 12;
  const tags: string[] = def.tags || [];
  return isTree(tags) ? 22 : tags.includes('seed') ? 10 : 12;
};

export interface WorldFormOptions { uses?: number; level?: number; affixes?: string[]; s?: number; variant?: number }

/** A resource as it stands in the world, at what the player knows of it. */
export function worldForm(def: any, o: WorldFormOptions = {}): Sprite {
  const level = o.level ?? KNOWN;
  const tags: string[] = def.tags || [];
  const seed = level <= 0 ? UNKNOWN_SEED : fnv1a(`sprite:v1:${def.id}`);
  const m = knownMaterial(def.materialProps, level);
  const size = o.s ?? worldSize(def);
  const full = def.uses ?? 1;
  const uses = o.uses ?? full;
  const role = tags.includes('flora') ? Role.LIFE : Role.MATTER;

  let sprite: Sprite;
  if (def.look) {
    // D119: three words, and this is what they come to. Form is plain to see at any knowledge.
    const live = stamp(LOOK_INKS[def.look.shape as IThemeLook['shape']](m, seed), size, m, seed, { role: lookRole(def.look.color), edgeStep: 3, minFill: 1, maxFill: 4, edgeGrain: true });
    sprite = uses <= 0 ? spent(live, !!def.regrowMs) : live;
  } else if (isTree(tags)) {
    sprite = treeSprite(def, uses, full, o.variant ?? 0);
  } else {
    const live = stamp(resourceInk(def, m, seed, level), size, m, seed, { role, edgeStep: 3, minFill: 1, maxFill: 4, edgeGrain: true });
    sprite = uses <= 0 ? spent(live, !!def.regrowMs) : live;
  }

  (o.affixes || []).forEach(id => {
    const mark = AFFIX_MARKS[id];
    if (!mark || level < (AFFIX_THRESHOLD[id] ?? 3)) return;
    mark.forEach(([x, y]) => { sprite.data[y * sprite.w + x] = px(Role.PROOF, 4); });
  });
  return sprite;
}

export function resource(def: any, s = 12): Sprite {
  return worldForm(def, { s });
}

// ---------------------------------------------------------------------------
// WORLD THINGS
// ---------------------------------------------------------------------------

const fixed = (draw: (k: Ink) => void, s: number, m: Material, style: StampStyle, id: string): Sprite => {
  const k = new Ink();
  draw(k);
  return stamp(k, s, m, fnv1a(`sprite:v1:${id}`), style);
};

export const exitBeacon = () => fixed(k => {
  k.disc(24, 24, 23).disc(24, 24, 18, 0).disc(24, 24, 8);
  k.rect(21, 0, 27, 47, 0).rect(0, 21, 47, 27, 0).disc(24, 24, 8);
}, 18, material({ luminosity: 34 }), { role: Role.SIGNAL, edgeStep: 4, minFill: 2, maxFill: 3 }, 'exit');

export const chest = () => fixed(k => {
  k.rect(4, 12, 43, 42).rect(4, 22, 43, 24, 0);
}, 12, material({ density: 60, hardness: 80 }), { role: Role.PROOF, edgeStep: 3, minFill: 1, maxFill: 2 }, 'chest');

export const ruin = () => fixed(k => {
  k.rect(2, 2, 22, 9).rect(2, 2, 9, 30).rect(30, 16, 45, 23).rect(38, 16, 45, 45).rect(14, 38, 26, 45);
}, 20, material({ density: 70, hardness: 90 }), { role: Role.MATTER, edgeStep: 2, minFill: 0, maxFill: 1 }, 'ruin');

/**
 * D93: what a leader raised. Each function is its own silhouette, and scaffolding is one lattice
 * whatever it will be, because that is what a person can tell of a thing still going up.
 */
export const structureForm = (fn: string, built: boolean) => {
  const style = { role: Role.MATTER, edgeStep: 3, minFill: 1, maxFill: 2 };
  const hard = material({ density: 70, hardness: 90 });
  if (!built) return fixed(k => {
    for (let i = 4; i < 48; i += 12) { k.rect(i, 2, i + 2, 45); k.rect(2, i, 45, i + 2); }
  }, 20, material({ density: 30, hardness: 40 }), { role: Role.MATTER, edgeStep: 2, minFill: 0, maxFill: 1 }, 'scaffold');
  switch (fn) {
    case 'seat': return fixed(k => { k.rect(8, 22, 39, 45).rect(8, 4, 14, 22).rect(33, 4, 39, 22).rect(20, 12, 27, 22); }, 24, hard, { ...style, role: Role.PROOF }, 'seat');
    case 'anchor': return fixed(k => { k.rect(20, 2, 27, 45).rect(10, 12, 37, 18).disc(24, 38, 11); }, 22, material({ luminosity: 30 }), { ...style, role: Role.SIGNAL }, 'anchor');
    case 'watch': return fixed(k => { k.rect(16, 16, 31, 45).rect(6, 4, 41, 16).rect(6, 4, 11, 0, 0); }, 24, hard, style, 'watch');
    case 'wall': return fixed(k => { k.rect(0, 0, 47, 47); k.rect(0, 22, 47, 25, 0); k.rect(22, 0, 25, 22, 0); }, 10, hard, style, 'wall');
    case 'works': return fixed(k => { k.rect(6, 12, 41, 22).rect(18, 22, 29, 34).rect(10, 34, 37, 44); }, 20, hard, style, 'works');
    case 'muster': return fixed(k => { k.rect(10, 2, 15, 45).rect(15, 4, 41, 20); k.rect(30, 8, 41, 16, 0); }, 22, hard, style, 'muster');
    default: return ruin();
  }
};

export const npcFigure = (id: string) => fixed(k => {
  k.disc(24, 13, 11).disc(24, 42, 20).rect(0, 0, 47, 0, 0);
}, 10, material({ density: 30 }), { role: Role.LIFE, edgeStep: 4, minFill: 1, maxFill: 2 }, id);


// ---------------------------------------------------------------------------
// MARK: rank is a 3×3 count, so it needs no color and no language.
// ---------------------------------------------------------------------------

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

export function rankMark(rank: string): Sprite {
  const count = RANKS.indexOf(rank) + 1;
  const w = 5, data = new Uint8Array(w * w).fill(px(Role.VOID, 0));
  for (let i = 0; i < 9; i++) {
    data[(1 + Math.floor(i / 3)) * w + 1 + (i % 3)] = i < count ? px(Role.PROOF, 4) : px(Role.VOID, 4);
  }
  return { w, h: w, data };
}

export const RARITIES = ['SCRAP', 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT'];

/** Gear has no material data in the game yet. This is the profile it would need, from tags. */
export function gearMaterial(tags: string[]): Material {
  const has = (t: string) => tags.includes(t);
  if (has('magic') || has('caster')) return material({ density: 20, resonance: 60 });
  if (has('tech')) return material({ density: 40, conductivity: 70 });
  if (has('heavy')) return material({ density: 80, hardness: 60 });
  if (has('blade') || has('crit')) return material({ density: 50, hardness: 75 });
  if (has('mining') || has('chopping')) return material({ density: 60, hardness: 55 });
  if (has('light') || has('ranged')) return material({ density: 30, elasticity: 55 });
  return material({ density: 50, hardness: 30 });
}

function gearInk(tags: string[]): Ink {
  const k = new Ink();
  const has = (t: string) => tags.includes(t);
  if (has('caster')) return k.rect(20, 12, 28, 47).disc(24, 10, 10).disc(24, 10, 4, 0);
  if (has('ranged')) return k.line(34, 3, 12, 24, 3).line(12, 24, 34, 44, 3).line(34, 3, 34, 44, 1);
  if (has('chopping') || (has('melee') && has('heavy'))) return k.rect(21, 6, 27, 47).rect(6, 2, 26, 20);
  if (has('mining')) return k.rect(21, 6, 27, 47).rect(4, 3, 44, 12);
  if (has('tool')) return k.rect(10, 4, 38, 44).rect(15, 10, 33, 24, 0);
  if (has('armor')) return k.rect(10, 4, 38, 44).rect(2, 4, 46, 14).rect(19, 0, 29, 6, 0);
  return k.rect(19, 0, 29, 33).rect(9, 33, 39, 38).rect(20, 38, 28, 47);
}

/** What fills a pack slot: gear by its class, a tree as its log, anything else as itself. */
function glyphInk(tags: string[], m: Material, seed: number): Ink {
  const gear = ['armor', 'tool', 'melee', 'ranged', 'caster'].some(t => tags.includes(t));
  if (gear) return gearInk(tags);
  if (isTree(tags)) {
    const k = new Ink().rect(14, 0, 34, 47);
    return k.rect(20, 3, 28, 4, 0).rect(20, 8, 28, 9, 0);
  }
  return resourceInk({ tags }, m, seed);
}

export const ITEM_CELL = 18;
export const QUALITY_NAMES = ['Crude', 'Rough', 'Standard', 'Fine', 'Superior'];

/** The one quality law (Wave 10D): everything sits on the gear scale, -0.2 to
 * +0.2; 0 means no roll was taken. Values outside the scale are legacy 100s
 * from before the law and still read as no roll. */
export function qualityBand(q?: number): number {
  if (q === undefined || q === null || Math.abs(q) > 1) return 2;
  if (q < -0.12) return 0;
  if (q < -0.04) return 1;
  if (q <= 0.04) return 2;
  return q <= 0.12 ? 3 : 4;
}

/** The plate behind the glyph. Ramp steps of the ground are too close to read at 2px, so this climbs from void into matter. */
function qualityPlate(band: number, x: number, y: number): number {
  const third = (x + y) % 3 === 0;
  if (band <= 1) return px(Role.VOID, band === 0 ? 2 : 4);
  if (band === 2) return px(Role.VOID, 4);
  if (band === 3) return third ? px(Role.MATTER, 0) : px(Role.VOID, 4);
  return third ? px(Role.MATTER, 1) : px(Role.MATTER, 0);
}

const QUALITY = {
  holes: [30, 12, 0, 0, 0],
  minFill: [0, 1, 1, 2, 2],
  maxFill: [1, 2, 3, 4, 4],
  edge: [1, 2, 3, 4, 4]
};

export const wearLevel = (durability?: number, max?: number) => {
  if (durability === undefined || !max) return 0;
  if (durability >= max) return 0;
  if (durability * 3 >= max * 2) return 1;
  if (durability * 3 >= max) return 2;
  return durability > 0 ? 3 : 4;
};

export interface ItemArtInput {
  wCells: number; hCells: number; tags: string[]; material: Material; rarity: string; rank: string; seed: number;
  quality?: number; durability?: number; maxDurability?: number; identified?: boolean;
}

/**
 * An item at its real footprint, four facts in four places: rarity in the frame,
 * wear as bites from the middle of the frame, quality in the fill, rank in its mark.
 */
export function itemArt(o: ItemArtInput): Sprite {
  const w = o.wCells * ITEM_CELL - 2, h = o.hCells * ITEM_CELL - 2;
  const data = new Uint8Array(w * h);
  const ring = (x: number, y: number) => Math.min(x, y, w - 1 - x, h - 1 - y);

  if (o.identified === false) {
    const noise = fnv1a('item:v1:unidentified');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      data[y * w + x] = ring(x, y) === 0 ? ((x + y) % 2 ? px(Role.VOID, 4) : px(Role.VOID, 0)) : hash2(noise, x, y) % 3 === 0 ? px(Role.MATTER, hash2(noise, y, x) % 3) : px(Role.VOID, 1);
    }
    return { w, h, data };
  }

  const tier = RARITIES.indexOf(o.rarity);
  const role = o.tags.includes('flora') ? Role.LIFE : Role.MATTER;

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = ring(x, y);
    if (r > 1) continue;
    const corner = (x < 3 || x >= w - 3) && (y < 3 || y >= h - 3);
    const leading = (x < 3 && y < 3) || (x >= w - 3 && y >= h - 3);
    let v = px(Role.VOID, 2);
    if (tier === 0) { if (r === 0) v = (x + y) % 3 === 0 ? px(Role.VOID, 0) : px(Role.MATTER, 1); }
    else if (tier === 1) { if (r === 0) v = px(Role.MATTER, 1); }
    else if (tier === 2) { if (r === 0) v = px(Role.MATTER, 1); if (leading) v = px(Role.PROOF, 3); }
    else if (tier === 3) { if (r === 0) v = px(Role.MATTER, 1); if (corner) v = px(Role.PROOF, 3); }
    else if (tier === 4) { v = r === 0 ? px(Role.MATTER, 1) : px(Role.MATTER, 3); if (corner) v = px(Role.PROOF, 3); }
    else if (tier === 5) { if (r === 0) v = px(Role.PROOF, 3); if (corner) v = px(Role.PROOF, 4); }
    else { v = r === 0 ? px(Role.PROOF, 4) : px(Role.PROOF, 2); }
    data[y * w + x] = v;
  }

  const band = qualityBand(o.quality);
  const gw = w - 4, gh = h - 4;
  const glyph = sampleRect(glyphInk(o.tags, o.material, o.seed).body, gw, gh);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && glyph[y * gw + x] === 1;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v: number;
    if (on(x, y)) {
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
      v = edge ? px(role, QUALITY.edge[band])
        : px(role, Math.min(QUALITY.maxFill[band], QUALITY.minFill[band] + grain(o.material, x, y, o.seed)));
    } else {
      v = qualityPlate(band, x, y);
    }
    if (hash2(o.seed, x, y) % 100 < QUALITY.holes[band]) v = px(Role.VOID, 0);
    data[(y + 2) * w + x + 2] = v;
  }

  const wear = wearLevel(o.durability, o.maxDurability);
  const bite = (x0: number, y0: number, bw: number, bh: number) => {
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) data[y * w + x] = px(Role.VOID, 0);
  };
  const mx = (w >> 1) - 2, my = (h >> 1) - 2;
  if (wear >= 1) bite(mx, 0, 4, 2);
  if (wear >= 2) bite(w - 2, my, 2, 4);
  if (wear >= 3) bite(mx, h - 2, 4, 2);
  if (wear >= 4) {
    bite(0, my, 2, 4);
    const n = Math.max(gw, gh) - 3;
    for (let i = 0; i < n; i++) {
      const x = 3 + Math.floor((i * (w - 8)) / n), y = h - 4 - Math.floor((i * (h - 8)) / n);
      data[y * w + x] = px(Role.LOSS, 3);
      data[y * w + x + 1] = px(Role.VOID, 0);
    }
  }

  const mark = rankMark(o.rank);
  for (let y = 0; y < mark.h; y++) for (let x = 0; x < mark.w; x++) {
    data[(h - 7 + y) * w + w - 7 + x] = mark.data[y * mark.w + x];
  }
  return { w, h, data };
}

// ---------------------------------------------------------------------------
// IDENTITY: an avatar comes from the certificate, a seal from the signature.
// ---------------------------------------------------------------------------

export function avatar(uid: string): Sprite {
  const seed = fnv1a(`avatar:v1:${uid}`);
  const k = new Ink();
  const plan = seed % 4;
  k.disc(24, 16, 12 + (seed >>> 3) % 4);
  k.rect(10 - plan, 30, 37 + plan, 47);
  for (let i = 0; i < 6; i++) {
    const x = hash2(seed, i, 1) % 22, y = hash2(seed, i, 2) % 44;
    k.both(f => k.disc(f(x + 1), y + 2, 2 + (hash2(seed, i, 3) % 3), hash2(seed, i, 4) % 3 === 0 ? 0 : 1));
  }
  k.eyeAt(20, 15).eyeAt(27, 15);
  return stamp(k, 16, material({ density: 50, resonance: seed % 40 }), seed, {
    role: Role.SIGNAL, edgeStep: 3, minFill: 1, maxFill: 2, eyeStep: 4
  });
}

export function seal(hash: string): Sprite {
  const seed = fnv1a(`seal:v1:${hash}`);
  const s = 20, w = s, data = new Uint8Array(w * w);
  const c = s - 1;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = 2 * x - c, dy = 2 * y - c;
    const r = isqrt(dx * dx + dy * dy);
    if (r > 19) continue;
    if (r >= 17) { data[y * w + x] = px(Role.PROOF, 3); continue; }
    const sx = Math.min(x, c - x), sy = Math.min(y, c - y);
    const on = hash2(seed, sx, sy) % 100 < 46;
    data[y * w + x] = r >= 14 ? px(Role.VOID, 2) : on ? px(Role.PROOF, 3) : px(Role.PROOF, 0);
  }
  return { w, h: w, data };
}

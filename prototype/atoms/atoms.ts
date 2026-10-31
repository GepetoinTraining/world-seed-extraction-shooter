/**
 * THE ATOMS: prototype.
 *
 * Six families (pixel, ramp, grain, edge, part, mark) and the rules that compose
 * them. Everything here is pure integer arithmetic over byte buffers, so the same
 * input gives the same bytes on every machine.
 *
 * A pixel byte is 0 for transparent, otherwise 1 + role * STEPS + step.
 */

import { fnv1a } from '../../src/logic/rng/DeterministicRNG';

export const ATOM_PX = 2;
export const TILE_ATOMS = 10;
export const STEPS = 5;

export enum Role { GROUND, MATTER, LIFE, THREAT, SIGNAL, PROOF, LOSS, VOID }
const ROLE_COUNT = 8;

export interface Sprite { w: number; h: number; data: Uint8Array }
export interface Genre { name: string; palette: [string, string, string, string] }
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

export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 15), 0x2d2816a5);
  return (h ^ (h >>> 16)) >>> 0;
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

/** RGB per pixel byte. Index 0 is unused (transparent). */
export function buildPalette(genre: Genre): Uint8Array {
  const table = new Uint8Array((1 + ROLE_COUNT * STEPS) * 3);
  const set = (role: number, step: number, c: [number, number, number]) => {
    const i = (1 + role * STEPS + step) * 3;
    table[i] = c[0]; table[i + 1] = c[1]; table[i + 2] = c[2];
  };
  [Role.GROUND, Role.MATTER, Role.LIFE, Role.THREAT].forEach((role, slot) => {
    const hue = parseHex(genre.palette[slot]);
    ROLE_LUMA[role].forEach((l, step) => set(role, step, atLuma(hue, l)));
  });
  Object.entries(MACHINE).forEach(([role, ramp]) => ramp.forEach((c, step) => set(Number(role), step, c)));
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
  if (BAYER[ay & 3][ax & 3] < Math.floor((m.density * 16) / 100)) step += 1;
  if (m.conductivity > 0) {
    const s = Math.max(3, 12 - Math.floor(m.conductivity / 10));
    const onV = ax % s === 0 && hash2(seed, Math.floor(ax / s), Math.floor(ay / 6)) % 100 < m.conductivity;
    const onH = ay % s === 0 && hash2(seed + 1, Math.floor(ax / 6), Math.floor(ay / s)) % 100 < m.conductivity;
    if (onV || onH) step += 2;
  }
  if (m.resonance > 0) {
    const dx = (ax % CELL) - 5, dy = (ay % CELL) - 5;
    if (isqrt(dx * dx + dy * dy) % Math.max(2, 5 - Math.floor(m.resonance / 30)) === 0) step += 1;
  }
  if (m.toxicity > 0 && hash2(seed + 2, ax, ay) % 100 < m.toxicity) step += 2;
  if (m.elasticity > 0 && (ay + TRI[ax % 12]) % Math.max(4, 14 - Math.floor(m.elasticity / 10)) === 0) step += 1;
  if (m.hardness >= 30 && (ax + ay) % Math.max(3, 14 - Math.floor(m.hardness / 8)) === 0) step += 1;
  return step + Math.floor(m.luminosity / 34);
}

// ---------------------------------------------------------------------------
// PART: shapes are drawn on a 48-unit design grid, then sampled to any size.
// ---------------------------------------------------------------------------

const D = 48;

class Ink {
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
function sample(layer: Uint8Array, s: number, anyCoverage = false): Uint8Array {
  const out = new Uint8Array(s * s);
  for (let ty = 0; ty < s; ty++) for (let tx = 0; tx < s; tx++) {
    const x0 = Math.floor((tx * D) / s), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * D) / s));
    const y0 = Math.floor((ty * D) / s), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * D) / s));
    let on = 0, total = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { total++; on += layer[y * D + x] ? 1 : 0; }
    out[ty * s + tx] = (anyCoverage ? on > 0 : on * 3 >= total) ? 1 : 0;
  }
  return out;
}

export interface StampStyle { role: Role; edgeStep: number; minFill: number; maxFill: number; eyeStep?: number }

/** EDGE + GRAIN: turn sampled ink into a sprite with a hard void seam around it. */
function stamp(ink: Ink, s: number, m: Material, seed: number, style: StampStyle): Sprite {
  const body = sample(ink.body, s);
  const eye = sample(ink.eye, s, true);
  const w = s + 2, data = new Uint8Array(w * w);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < s && y < s && body[y * s + x] === 1;

  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    if (!on(x, y)) continue;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    let value: number;
    if (eye[y * s + x] && style.eyeStep !== undefined) value = px(style.role, style.eyeStep);
    else if (edge) value = px(style.role, style.edgeStep);
    else value = px(style.role, Math.min(style.maxFill, style.minFill + grain(m, x, y, seed)));
    data[(y + 1) * w + x + 1] = value;
  }
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    if (data[y * w + x]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < w && ny < w && data[ny * w + nx] !== 0 && data[ny * w + nx] !== px(Role.VOID, 0);
    });
    if (near) data[y * w + x] = px(Role.VOID, 0);
  }
  return { w, h: w, data };
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

export type Plan = 'ring' | 'tracks' | 'spikes' | 'rotor' | 'hull' | 'wings' | 'tendril' | 'biped' | 'swarm';

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
  return 'swarm';
}

function drawPlan(plan: Plan, seed: number): Ink {
  const k = new Ink();
  const v = (n: number, mod: number) => hash2(seed, n, 7) % mod;

  switch (plan) {
    case 'swarm':
      k.disc(24, 28, 11).disc(24, 15, 8);
      k.both(f => { k.disc(f(16), 8, 3); k.line(f(15), 24, f(5), 18 + v(1, 4), 1); k.line(f(15), 33, f(5), 38, 1); });
      k.line(24, 38, 30 + v(2, 8), 47, 1);
      k.eyeAt(20, 13).eyeAt(28, 13);
      break;
    case 'biped':
      k.disc(24, 10, 7).rect(11, 18, 37, 25).rect(16, 25, 32, 36).rect(16, 36, 21, 47).rect(27, 36, 32, 47);
      k.both(f => k.line(f(11), 21, f(6), 36, 2));
      k.line(39, 37, 44, 5 + v(1, 6), 2);
      k.eyeAt(21, 9).eyeAt(27, 9);
      break;
    case 'wings':
      k.disc(24, 24, 9).disc(24, 10, 6).line(24, 32, 24, 47, 2);
      k.both(f => { k.line(f(18), 20, f(1), 8 + v(1, 5), 4); k.line(f(18), 27, f(3), 34, 4); k.line(f(14), 30, f(8), 42, 2); });
      k.eyeAt(21, 9).eyeAt(27, 9);
      break;
    case 'rotor':
      k.both(f => {
        k.line(f(19), 19, f(9), 9, 2); k.line(f(19), 29, f(9), 39, 2);
        k.disc(f(8), 8, 8); k.disc(f(8), 8, 4, 0); k.disc(f(8), 40, 8); k.disc(f(8), 40, 4, 0);
      });
      k.disc(24, 24, 8);
      k.eyeAt(24, 23, 3);
      break;
    case 'hull':
      k.rect(10, 12, 38, 40).rect(20, 0, 28, 14);
      k.both(f => k.rect(Math.min(f(2), f(8)), 14, Math.max(f(2), f(8)), 38));
      k.disc(24, 26, 9, 0).disc(24, 26, 5);
      k.eyeAt(24, 26, 2);
      break;
    case 'tracks':
      k.both(f => k.rect(Math.min(f(0), f(10)), 2, Math.max(f(0), f(10)), 46));
      k.rect(13, 8, 35, 40);
      k.both(f => { k.disc(f(18), 16, 5); k.rect(Math.min(f(16), f(20)), 0, Math.max(f(16), f(20)), 14); });
      k.rect(18, 30, 30, 34, 0);
      k.eyeAt(24, 24, 2);
      break;
    case 'tendril': {
      k.disc(24, 24, 11);
      const ends = [[6, 6], [42, 10], [3, 30], [44, 34], [14, 46], [34, 45]];
      ends.forEach(([ex, ey], i) => k.line(24, 24, ex + v(i, 5) - 2, ey + v(i + 9, 5) - 2, 1 + v(i + 20, 2)));
      k.eyeAt(19, 20).eyeAt(29, 22).eyeAt(24, 29);
      break;
    }
    case 'ring': {
      k.disc(24, 24, 23).disc(24, 24, 15, 0).disc(24, 24, 6);
      const spots = [[24, 4], [38, 10], [44, 24], [38, 38], [24, 44], [10, 38], [4, 24], [10, 10]];
      spots.forEach(([x, y]) => k.eyeAt(x, y, 2));
      k.eyeAt(24, 24, 3);
      break;
    }
    case 'spikes':
      k.disc(24, 28, 18).disc(24, 9, 8);
      k.both(f => { k.line(f(9), 18, f(0), 8, 2); k.line(f(6), 30, f(0), 30, 2); k.line(f(10), 41, f(2), 47, 2); k.line(f(19), 3, f(16), 0, 1); });
      k.eyeAt(20, 8).eyeAt(28, 8);
      break;
  }
  return k;
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

export function creature(def: { id: string; tags: string[]; size?: string }, s?: number): Sprite {
  const seed = fnv1a(`sprite:v1:${def.id}`);
  const size = s ?? SIZE_ATOMS[def.size || 'MEDIUM'] ?? 14;
  return stamp(drawPlan(planFor(def.tags), seed), size, creatureMaterial(def.tags), seed, {
    role: Role.THREAT, edgeStep: 3, minFill: 0, maxFill: 2, eyeStep: 4
  });
}

// ---------------------------------------------------------------------------
// RESOURCES: form from tags, fill from real material numbers.
// ---------------------------------------------------------------------------

export function materialFromProps(props?: Partial<Record<string, number>>): Material {
  const p = props || {};
  const cap = (n: number) => Math.min(100, n);
  return material({
    density: cap((p.DENSITY || 0) * 5), hardness: cap(p.HARDNESS || 0), conductivity: cap((p.CONDUCTIVITY || 0) * 2),
    resonance: cap(p.RESONANCE || 0), luminosity: cap((p.LUMINOSITY || 0) * 5), toxicity: cap((p.TOXICITY || 0) * 5),
    elasticity: cap((p.ELASTICITY || 0) * 3)
  });
}

/** A lump whose outline follows hardness: square when hard, round when soft. */
function lump(k: Ink, cx: number, cy: number, r: number, hardness: number, seed: number) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const cheb = Math.max(Math.abs(x), Math.abs(y));
    const eucl = isqrt(x * x + y * y);
    const metric = Math.floor((hardness * cheb + (100 - hardness) * eucl) / 100);
    const dent = hash2(seed, Math.floor((x + 64) / 8), Math.floor((y + 64) / 8)) % 4;
    if (metric <= r - dent) k.rect(cx + x, cy + y, cx + x, cy + y);
  }
}

function resourceInk(def: any, m: Material, seed: number): Ink {
  const k = new Ink();
  const tags: string[] = def.tags || [];
  const has = (t: string) => tags.includes(t);
  if (has('grain')) {
    [12, 24, 36].forEach((x, i) => { k.line(x, 46, x, 14, 1); k.disc(x, 10 + (i % 2) * 3, 5); });
  } else if (has('berry')) {
    k.disc(16, 18, 9).disc(33, 16, 9).disc(24, 33, 10);
  } else if (has('fruit')) {
    k.disc(24, 29, 17).line(24, 13, 30, 2, 1).line(30, 6, 40, 4, 2);
    if (has('poison')) k.disc(24, 29, 6, 0);
  } else if (has('fiber')) {
    [8, 22, 36].forEach(x => k.line(x, 46, x + 8, 3, 2));
  } else if (has('seed')) {
    k.line(24, 47, 24, 18, 2).both(f => k.line(f(22), 22, f(8), 12, 3));
  } else if (has('wood')) {
    k.rect(19, 28, 29, 47).disc(24, 17, 17);
  } else if (has('sand')) {
    for (let y = 26; y < 48; y++) { const half = Math.floor((y - 22) * 1.1); k.rect(24 - half, y, 24 + half, y); }
  } else if (has('glass')) {
    k.line(24, 3, 12, 44, 2).line(24, 3, 38, 44, 2).line(12, 44, 38, 44, 2).line(25, 12, 22, 40, 3);
  } else if (has('salvage')) {
    k.rect(5, 8, 43, 40).rect(5, 8, 15, 16, 0).rect(34, 30, 43, 40, 0).disc(14, 30, 3, 0).disc(33, 18, 3, 0);
  } else if (has('stone') && m.density <= 25) {
    k.disc(13, 15, 8).disc(35, 12, 6).disc(19, 35, 9).disc(38, 35, 6);
  } else {
    lump(k, 24, 24, 21, Math.max(m.hardness, 40), seed);
  }
  return k;
}

export function resource(def: any, s = 12): Sprite {
  const seed = fnv1a(`sprite:v1:${def.id}`);
  const m = materialFromProps(def.materialProps);
  const flora = (def.tags || []).includes('flora');
  return stamp(resourceInk(def, m, seed), s, m, seed, {
    role: flora ? Role.LIFE : Role.MATTER, edgeStep: 3, minFill: 1, maxFill: 3
  });
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

export const npcFigure = (id: string) => fixed(k => {
  k.disc(24, 13, 11).disc(24, 42, 20).rect(0, 0, 47, 0, 0);
}, 10, material({ density: 30 }), { role: Role.LIFE, edgeStep: 4, minFill: 1, maxFill: 2 }, id);

export const playerFigure = () => fixed(k => {
  for (let y = 0; y < 48; y++) { const half = 24 - Math.abs(y - 24); k.rect(24 - half, y, 23 + half, y); }
  k.rect(21, 0, 26, 7, 0);
  k.disc(24, 24, 5, 0);
}, 12, material({ luminosity: 34 }), { role: Role.SIGNAL, edgeStep: 4, minFill: 2, maxFill: 3 }, 'player');

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

/** EDGE family on an item: footprint in cells, rarity in the frame, material in the fill. */
export function itemSprite(m: Material, wCells: number, hCells: number, rarity: string, seed: number): Sprite {
  const cell = 8, w = wCells * cell + 2, h = hCells * cell + 2;
  const data = new Uint8Array(w * h);
  const tier = RARITIES.indexOf(rarity);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const border = x === 1 || y === 1 || x === w - 2 || y === h - 2;
    const inner = x === 2 || y === 2 || x === w - 3 || y === h - 3;
    const corner = (x <= 3 || x >= w - 4) && (y <= 3 || y >= h - 4);
    let v = px(Role.MATTER, Math.min(3, 1 + grain(m, x, y, seed)));
    if (border) {
      if (tier === 0) v = (x + y) % 3 === 0 ? px(Role.VOID, 0) : px(Role.MATTER, 2);
      else if (tier === 1) v = px(Role.MATTER, 2);
      else v = corner ? px(Role.PROOF, Math.min(4, tier)) : px(Role.MATTER, 3);
    }
    if (inner && tier >= 4) v = corner || tier >= 5 ? px(Role.PROOF, 3) : v;
    if (tier === 6 && !border && (x + y) % 4 === 0) v = px(Role.PROOF, 4);
    data[y * w + x] = v;
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

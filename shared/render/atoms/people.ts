/**
 * THE PEOPLE: an avatar is computed from the identity you own.
 *
 * Archetype sets the silhouette family, the certificate id sets who you are inside
 * it, and what you carry changes the outline. The named cast comes from the same
 * parts, drawn in the world's own life ramp, so only you are drawn in signal.
 */

import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { D, Ink, Role, Sprite, hash2, material, px, stamp } from './atoms';

export const ARCHETYPE_IDS = ['OPERATOR', 'STREET_SAMURAI', 'NOMAD', 'ARCANIST', 'FATE_GAMBLER'] as const;
export type Archetype = typeof ARCHETYPE_IDS[number];
export type Facing = 'down' | 'up' | 'left' | 'right';
export type WeaponClass = 'blade' | 'heavy' | 'caster' | 'ranged' | 'tool';
export type ArmorClass = 'heavy' | 'light' | 'magic';

export const FIGURE_ATOMS = 16;
export const PORTRAIT_ATOMS = 32;

export const weaponClass = (tags: string[]): WeaponClass => {
  if (tags.includes('tool')) return 'tool';
  if (tags.includes('caster')) return 'caster';
  if (tags.includes('ranged')) return 'ranged';
  if (tags.includes('heavy')) return 'heavy';
  return 'blade';
};

export const armorClass = (tags: string[]): ArmorClass | undefined => {
  if (tags.includes('heavy')) return 'heavy';
  if (tags.includes('magic')) return 'magic';
  if (tags.includes('light')) return 'light';
  return undefined;
};

export interface FigureInput {
  uid: string; archetype: Archetype; facing?: Facing; step?: number; moving?: boolean; phases?: 2 | 4;
  weapon?: WeaponClass; armor?: ArmorClass; you?: boolean;
}

/**
 * THE WALK (D2, decided): both cycles exist; this constant is the one the game uses.
 * Pedro chose 4 by eye on the proof page (2026-10-31); 2 stays as the alternative.
 */
export const WALK_PHASES: 2 | 4 = 4;

/**
 * A pose is three numbers. lead: which leg is forward (-1 left, 1 right, 0 none).
 * amp: how far the stride reaches, in design units (3 units = 1 atom).
 * sink: how far the head drops into the step. Standing is all zeros, so stopping
 * always returns to one defined frame.
 */
interface Gait { lead: -1 | 0 | 1; amp: number; sink: number }

const STAND: Gait = { lead: 0, amp: 0, sink: 0 };
const GAIT_2: Gait[] = [{ lead: -1, amp: 5, sink: 3 }, { lead: 1, amp: 5, sink: 3 }];
const GAIT_4: Gait[] = [
  { lead: -1, amp: 5, sink: 3 }, { lead: 1, amp: 3, sink: 0 },
  { lead: 1, amp: 5, sink: 3 }, { lead: -1, amp: 3, sink: 0 }
];

function gaitOf(o: FigureInput): Gait {
  // No step named and not said to be moving: the figure stands.
  if (!(o.moving ?? (o.step !== undefined))) return STAND;
  const cycle = (o.phases ?? WALK_PHASES) === 2 ? GAIT_2 : GAIT_4;
  return cycle[(((o.step ?? 0) % cycle.length) + cycle.length) % cycle.length];
}

/** A shape that widens row by row, for robes, cloaks and shields. */
function flare(k: Ink, cx: number, y0: number, half0: number, y1: number, half1: number, v = 1) {
  for (let y = y0; y <= y1; y++) {
    const half = half0 + Math.floor(((half1 - half0) * (y - y0)) / Math.max(1, y1 - y0));
    k.rect(cx - half, y, cx + half, y, v);
  }
}

function drawWeapon(k: Ink, kind: WeaponClass | undefined, x: number) {
  switch (kind) {
    case 'blade': k.rect(x - 1, 2, x + 1, 28).rect(x - 6, 28, x + 6, 31).rect(x - 1, 31, x + 1, 38); break;
    case 'heavy': k.rect(x - 1, 20, x + 1, 42).rect(x - 9, 0, x + 6, 21); break;
    case 'caster': k.rect(x - 1, 20, x + 1, 47).disc(x, 9, 9).disc(x, 9, 5, 0); break;
    case 'ranged': k.line(x + 5, 4, x - 4, 22, 1).line(x - 4, 22, x + 5, 42, 1).rect(x + 5, 4, x + 6, 42); break;
    case 'tool': k.rect(x - 1, 12, x + 1, 42).rect(x - 9, 6, x + 7, 12); break;
    default: break;
  }
}

function figureInk(o: FigureInput, side: boolean, back: boolean): Ink {
  const k = new Ink();
  const seed = fnv1a(`figure:v1:${o.uid}`);
  const cx = 22;
  const g = gaitOf(o);
  const sink = g.sink;
  const narrow = (n: number) => (side ? (n * 5) >> 3 : n);
  const build = seed % 3;
  const sw = narrow(9 + build * 2);
  const headR = 6 + ((seed >>> 2) % 2);
  const crown = (seed >>> 3) % 5;

  const legs = (top: number) => {
    if (side) {
      if (g.lead !== 0) k.line(cx, top, cx + (3 + g.amp) * g.lead, 46, 2).line(cx, top, cx - g.amp * g.lead, 46, 2);
      else k.rect(cx - 3, top, cx + 3, 47);
    } else {
      k.rect(cx - 7, top, cx - 2, 47 - (g.lead === -1 ? g.amp : 0)).rect(cx + 2, top, cx + 7, 47 - (g.lead === 1 ? g.amp : 0));
    }
  };

  switch (o.archetype) {
    case 'OPERATOR':
      legs(33);
      k.rect(cx - sw + 2, 18, cx + sw - 2, 34);
      if (back) k.rect(cx - sw, 16, cx + sw, 32).rect(cx - sw + 4, 20, cx + sw - 4, 22, 0);
      else if (side) k.rect(cx - sw - 6, 17, cx - sw, 31);
      else k.rect(cx - sw - 2, 18, cx - sw, 30).rect(cx + sw, 18, cx + sw + 2, 30);
      k.line(cx - (side ? 4 : sw - 2), 18, cx - (side ? 8 : sw + 2), 1, 1).disc(cx - (side ? 8 : sw + 2), 2, 2);
      k.disc(cx, 10 + sink, headR);
      break;
    case 'STREET_SAMURAI':
      legs(32);
      k.rect(cx - 5, 18, cx + 5, 33);
      if (side) k.rect(cx - 9, 15, cx + 9, 21);
      else { k.line(cx - sw - 6, 13, cx - 2, 22, 2); k.line(cx + sw + 6, 13, cx + 2, 22, 2); }
      k.disc(cx, 10 + sink, headR).rect(cx - 2, sink, cx + 2, 5 + sink);
      if (!side) k.rect(cx - 6, 29, cx + 6, 31, 0);
      break;
    case 'NOMAD':
      k.rect(cx - (side ? 3 : 7) + 3 * g.lead, 36, cx + (side ? 3 : 7) + 3 * g.lead, 47 - (g.lead ? 3 : 0));
      flare(k, cx, 16, narrow(7), 39, narrow(18));
      k.disc(cx, 11 + sink, headR + 4);
      if (!back) k.disc(cx + (side ? 3 : 0), 11 + sink, headR, 0).disc(cx + (side ? 3 : 0), 11 + sink, headR - 2);
      break;
    case 'ARCANIST':
      // The halo holds still; only the head inside it and the orbs answer the step.
      flare(k, cx + 2 * g.lead, 18, narrow(6), 47, narrow(14));
      k.disc(cx, 11, 15).disc(cx, 11, 12, 0);
      k.disc(cx, 11 + sink, headR);
      k.disc(cx - 20, 30 + 3 * g.lead, 2).disc(cx + 20, 26 - 3 * g.lead, 2);
      break;
    case 'FATE_GAMBLER':
      // A flat wide brim, a long coat, and a die held out on one side: all outline, so it reads in grayscale.
      legs(38);
      flare(k, cx, 17, narrow(6), 38, narrow(11));
      k.disc(cx, 11 + sink, headR);
      k.rect(cx - narrow(19), 5 + sink, cx + narrow(19), 7 + sink).rect(cx - narrow(8), sink, cx + narrow(8), 5 + sink);
      if (!back) {
        k.rect(cx + 15, 21 + 2 * g.lead, cx + 22, 28 + 2 * g.lead).rect(cx + 17, 23 + 2 * g.lead, cx + 20, 26 + 2 * g.lead, 0);
        k.line(cx + 6, 21, cx + 15, 24 + 2 * g.lead, 1);
      }
      break;
  }

  const torso = o.archetype === 'NOMAD' ? 28 : 24;
  if (crown === 1) k.rect(cx - 5, 1 + sink, cx + 5, 3 + sink);
  if (crown === 2) k.rect(cx + headR - 2, 6 + sink, cx + headR + 2, 13 + sink);
  if (crown === 3) k.rect(cx - headR - 2, 6 + sink, cx - headR + 2, 13 + sink);
  if (crown === 4) k.rect(cx - headR, 7 + sink, cx + headR, 8 + sink, 0);
  const mark = (seed >>> 6) % 4;
  if (mark === 1) k.rect(cx - 3, torso - 3, cx + 3, torso + 3, 0);
  if (mark === 2) k.rect(cx - sw + 2, torso, cx + sw - 2, torso + 2, 0);
  if (mark === 3) k.rect(cx - 1, 19, cx + 1, torso + 7, 0);
  const shoulder = (seed >>> 8) % 3;
  if (shoulder === 1) k.rect(cx - sw - 1, 15, cx - sw + 3, 20);
  if (shoulder === 2) k.rect(cx + sw - 3, 15, cx + sw + 1, 20);
  const hem = (seed >>> 10) % 3;
  if (o.archetype === 'ARCANIST') {
    const notch = (seed >>> 14) % 4;
    k.rect(cx - 12 + notch * 6, 41, cx - 9 + notch * 6, 47, 0);
    const halo = (seed >>> 16) % 4;
    if (halo === 0) k.rect(cx - 4, 0, cx + 4, 3, 0);
    if (halo === 1) k.rect(cx + 12, 7, cx + 16, 15, 0);
    if (halo === 2) k.rect(cx - 16, 7, cx - 12, 15, 0);
    const fold = (seed >>> 18) % 3;
    k.rect(cx - 7 + fold * 6, 26, cx - 6 + fold * 6, 38, 0);
    const band = (seed >>> 20) % 4;
    if (band > 0) k.rect(cx - 13, 24 + band * 5, cx + 13, 25 + band * 5, 0);
    const sleeve = (seed >>> 22) % 3;
    if (sleeve === 1) k.rect(cx - 13, 20, cx - 8, 30);
    if (sleeve === 2) k.rect(cx + 8, 20, cx + 13, 30);
  } else if (o.archetype === 'FATE_GAMBLER') {
    // The hat and the coat hide what marks everyone else, so they carry the id themselves.
    const notch = (seed >>> 14) % 4;
    if (notch > 0) k.rect(cx - 16 + notch * 8, 5 + sink, cx - 13 + notch * 8, 7 + sink, 0);
    const crownCut = (seed >>> 16) % 4;
    if (crownCut > 0) k.rect(cx - 8 + crownCut * 3, sink, cx - 6 + crownCut * 3, 2 + sink, 0);
    const fold = (seed >>> 18) % 4;
    k.rect(cx - 8 + fold * 5, 24, cx - 7 + fold * 5, 37, 0);
    const band = (seed >>> 20) % 4;
    if (band > 0) k.rect(cx - 11, 24 + band * 4, cx + 11, 25 + band * 4, 0);
    const lapel = (seed >>> 22) % 3;
    if (lapel === 1) k.rect(cx - 13, 19, cx - 7, 29);
    if (lapel === 2) k.rect(cx + 7, 19, cx + 13, 29);
    const tail = (seed >>> 24) % 3;
    if (tail === 1) k.rect(cx - 12, 34, cx - 7, 42);
    if (tail === 2) k.rect(cx + 7, 34, cx + 12, 42);
  } else {
    const hop = g.lead ? 3 : 0;
    if (hem === 1) k.rect(cx - 8, 44 - hop, cx - 2, 47 - hop);
    if (hem === 2) k.rect(cx + 2, 44, cx + 8, 47);
  }
  const patch = (seed >>> 12) % 4;
  if (patch > 0) k.rect(cx - 7 + patch * 4, 30, cx - 5 + patch * 4, 32, 0);

  if (o.armor === 'heavy') k.rect(cx - narrow(16), 14, cx + narrow(16), 21).rect(cx - narrow(9), 27, cx + narrow(9), 29, 0);
  if (o.armor === 'light') k.line(cx - narrow(8), 19, cx + narrow(8), 33, 1, 0);
  if (o.armor === 'magic') flare(k, cx, 32, narrow(10), 46, narrow(17));

  drawWeapon(k, o.weapon, side ? cx + 13 : cx + 21);

  if (!back) {
    if (side) k.eyeAt(cx + 3, 10 + sink, 1);
    else if (o.archetype !== 'NOMAD' || !back) k.eyeAt(cx - 3, 10 + sink, 1).eyeAt(cx + 3, 10 + sink, 1);
  }
  return k;
}

const mirror = (s: Sprite): Sprite => {
  const data = new Uint8Array(s.data.length);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) data[y * s.w + x] = s.data[y * s.w + (s.w - 1 - x)];
  return { w: s.w, h: s.h, data };
};

/** Brackets at the four corners: the machine marking its own subject. Shape, so it survives without color. */
function markYou(s: Sprite): Sprite {
  const v = px(Role.SIGNAL, 4);
  const put = (x: number, y: number) => { s.data[y * s.w + x] = v; };
  [[0, 0, 1, 1], [s.w - 1, 0, -1, 1], [0, s.h - 1, 1, -1], [s.w - 1, s.h - 1, -1, -1]].forEach(([x, y, dx, dy]) => {
    put(x, y); put(x + dx, y); put(x + 2 * dx, y); put(x, y + dy); put(x, y + 2 * dy);
  });
  return s;
}

export function figure(o: FigureInput): Sprite {
  const facing = o.facing ?? 'down';
  const seed = fnv1a(`figure:v1:${o.uid}`);
  const m = material({ density: 30 + seed % 50, resonance: (seed >>> 8) % 40, elasticity: (seed >>> 12) % 30 });
  const side = facing === 'left' || facing === 'right';
  const ink = figureInk(o, side, facing === 'up');
  const sprite = stamp(ink, FIGURE_ATOMS, m, seed, { role: Role.SIGNAL, edgeStep: 3, minFill: 1, maxFill: 2, eyeStep: 4 });
  const marked = o.you === false ? sprite : markYou(sprite);
  return facing === 'left' ? mirror(marked) : marked;
}

/**
 * Q22: SOMEONE WHO LIVES HERE. Pedro is colourblind, and a resident drawn like you reads as two of
 * you, so they are told apart by shape: no corner brackets (those mark you alone), and a roof over
 * the head, the house the guild raised for them. They walk the same body you do, in the cast's
 * life ramp, so the ramp only agrees with what the shape already says.
 */
export function residentFigure(o: { uid: string; archetype?: Archetype; facing?: Facing; step?: number; moving?: boolean }): Sprite {
  const facing = o.facing ?? 'down';
  const input: FigureInput = { uid: o.uid, archetype: o.archetype ?? 'NOMAD', facing, step: o.step, moving: o.moving, you: false };
  const seed = fnv1a(`figure:v1:${o.uid}`);
  const m = material({ density: 30 + seed % 50, resonance: (seed >>> 8) % 40, elasticity: (seed >>> 12) % 30 });
  const side = facing === 'left' || facing === 'right';
  const ink = figureInk(input, side, facing === 'up');
  // The roof: a gable from a point over the head out to its eaves, with the head showing under it.
  const cx = 22, eaves = 9, reach = 21;
  for (let y = 0; y <= eaves; y++) {
    const half = Math.round((reach * y) / eaves);
    ink.rect(cx - half, y, cx + half, y);
  }
  ink.rect(cx - reach, eaves, cx + reach, eaves + 3);
  // Daylight under the eaves, either side of the neck, so the overhang reads as a roof and not a big head.
  ink.rect(cx - reach, eaves + 4, cx - 8, eaves + 7, 0).rect(cx + 8, eaves + 4, cx + reach, eaves + 7, 0);
  const sprite = stamp(ink, FIGURE_ATOMS, m, seed, CAST_STYLE);
  return facing === 'left' ? mirror(sprite) : sprite;
}

/**
 * The bust used in dialogue and on the identity card. The face is the ownership
 * fantasy made visible, so it carries the most variation of anything drawn:
 * hair, brows, eyes, nose, mouth, jaw, marks and collar all come from the id.
 */
function faceInk(seed: number, r0 = 10): Ink {
  const k = new Ink();
  const h = (n: number, mod: number) => hash2(seed, n, 3) % mod;
  const r = r0 + h(1, 3);
  const y = 17 + h(2, 3);
  flare(k, 24, 34, 9 + h(3, 3), 47, 19 + h(3, 4));
  k.rect(20, y + r - 3, 27, 36);
  k.disc(24, y, r);
  k.rect(24 - r + 2, y + 2, 24 + r - 2, y + r - 2 - h(12, 3));
  const hair = h(4, 8);
  if (hair === 1) k.rect(24 - r, y - r, 24 + r, y - r + 5);
  if (hair === 2) k.both(f => k.rect(Math.min(f(24 - r), f(24 - r + 4)), y - 6, Math.max(f(24 - r), f(24 - r + 4)), y + 8));
  if (hair === 3) k.disc(24, y - r, 6);
  if (hair === 4) for (let i = 0; i < 5; i++) k.rect(24 - r + i * 6, y - r - 2, 24 - r + i * 6 + 2, y - r + 3);
  if (hair === 5) k.rect(22, y - r - 4, 25, y - r + 4);
  if (hair === 6) k.both(f => k.rect(Math.min(f(24 - r - 2), f(24 - r + 1)), y - 4, Math.max(f(24 - r - 2), f(24 - r + 1)), y + r + 4));
  if (hair === 7) k.rect(24 - r + 3, y - r - 1, 24 + r - 3, y - r, 0);
  const gap = 4 + h(5, 2), eyeY = y - 1 + h(6, 2);
  // Brows: level, raised, knitted, or none — each reads as a temperament.
  const brow = h(7, 4);
  if (brow === 1) k.both(f => { k.rect(Math.min(f(24 - gap - 2), f(24 - gap + 2)), eyeY - 3, Math.max(f(24 - gap - 2), f(24 - gap + 2)), eyeY - 3, 0); });
  if (brow === 2) k.both(f => { k.line(f(24 - gap - 2), eyeY - 2, f(24 - gap + 2), eyeY - 4, 0, 0); });
  if (brow === 3) k.both(f => { k.line(f(24 - gap - 2), eyeY - 4, f(24 - gap + 2), eyeY - 2, 0, 0); });
  k.eyeAt(24 - gap, eyeY, 1).eyeAt(23 + gap, eyeY, 1);
  // The nose: a shadow line of varying length, or a notch.
  const nose = h(8, 3);
  if (nose === 0) k.rect(24, eyeY + 1, 24, eyeY + 3 + h(16, 2), 0);
  if (nose === 1) k.rect(23, eyeY + 3, 25, eyeY + 3, 0);
  // The mouth: width, height and set (level, wry, grim) from the id.
  const mouthY = y + 6 + h(10, 2);
  const mouthW = 1 + h(9, 3);
  const wry = h(17, 3);
  if (wry === 0) k.rect(24 - mouthW, mouthY, 24 + mouthW, mouthY, 0);
  if (wry === 1) k.line(24 - mouthW, mouthY + 1, 24 + mouthW, mouthY, 0, 0);
  if (wry === 2) k.rect(24 - mouthW, mouthY, 24 + mouthW, mouthY + 1, 0);
  if (h(11, 3) === 0) k.line(24 + gap, y - 6, 24 + gap + 3, y + 4, 0, 0);
  if (h(18, 4) === 0) k.rect(24 - gap - 2, mouthY - 1, 24 - gap, mouthY, 0);
  const jaw = h(14, 3);
  if (jaw === 1) k.rect(24 - r, y, 24 + r, y + r - 3);
  if (jaw === 2) k.both(f => k.rect(Math.min(f(24 - r - 2), f(24 - r)), y - 2, Math.max(f(24 - r - 2), f(24 - r)), y + 2));
  const cheek = h(15, 3);
  if (cheek === 1) k.both(f => k.rect(Math.min(f(24 - gap - 1), f(24 - gap + 1)), eyeY + 3, Math.max(f(24 - gap - 1), f(24 - gap + 1)), eyeY + 3, 0));
  if (cheek === 2) k.rect(23, eyeY + 1, 24, eyeY + 4, 0);
  const collar = h(13, 4);
  if (collar === 1) k.rect(19, 36, 28, 37, 0);
  if (collar === 2) k.line(24, 36, 24, 47, 0, 0);
  if (collar === 3) k.both(f => k.line(f(16), 36, f(22), 47, 0, 0));
  for (let i = 0; i < 4; i++) {
    const x = 8 + h(20 + i, 10), py = 40 + h(30 + i, 7);
    k.both(f => k.disc(f(x), py, 1, h(50 + i, 2)));
  }
  return k;
}

export function portrait(o: { uid: string; archetype: Archetype }): Sprite {
  const seed = fnv1a(`portrait:v1:${o.uid}`);
  const k = faceInk(seed);
  switch (o.archetype) {
    case 'OPERATOR': k.line(40, 20, 45, 2, 1).rect(9, 15, 14, 24); break;
    case 'STREET_SAMURAI': k.rect(21, 0, 27, 6); k.line(4, 40, 16, 34, 3); k.line(44, 40, 32, 34, 3); break;
    case 'NOMAD': {
      // The hood opens wider than it used to, and the hood itself belongs to the
      // id: its size, its opening, its fold and its wear all vary, so two hooded
      // faces are never nearly the same shape with eyes.
      const inner = faceInk(seed);
      const hv = (n: number, mod: number) => hash2(seed, 60 + n, 3) % mod;
      const hoodR = 18 + hv(0, 3);
      const openR = 13 + hv(1, 3);
      k.disc(24, 16, hoodR).disc(24 + hv(2, 3) - 1, 19, openR, 0);
      flare(k, 24, 30, 14 + hv(3, 3), 47, 21 + hv(4, 4));
      const hood = hv(5, 4);
      if (hood === 1) k.rect(22, 0, 25, 4, 0);
      if (hood === 2) k.rect(24 - hoodR, 14, 24 - hoodR + 4, 17, 0);
      if (hood === 3) k.rect(24 + hoodR - 4, 10, 24 + hoodR, 13, 0);
      const band = hv(6, 3);
      if (band > 0) k.rect(24 - hoodR + 2, 2 + band * 3, 24 + hoodR - 2, 3 + band * 3, 0);
      inner.body.forEach((v, i) => { if (v && i < D * 34) k.body[i] = 1; });
      k.eye = inner.eye;
      break;
    }
    case 'ARCANIST': {
      // The halo belongs to the id too: its radius, its break and its spike vary.
      const inner = faceInk(seed);
      const av = (n: number, mod: number) => hash2(seed, 70 + n, 3) % mod;
      const ringR = 19 + av(0, 3);
      k.disc(24, 17, ringR).disc(24, 17, ringR - 3, 0);
      inner.body.forEach((v, i) => { if (v) k.body[i] = 1; });
      k.eye = inner.eye;
      const spike = av(1, 4);
      if (spike === 0) k.rect(23, 0, 24, 4);
      if (spike === 1) k.rect(24 - ringR - 2, 15, 24 - ringR + 1, 18);
      if (spike === 2) k.rect(24 + ringR - 1, 15, 24 + ringR + 2, 18);
      if (spike === 3) k.rect(21, 0, 26, 2);
      const gap = av(2, 3);
      if (gap === 1) k.rect(20, 17 - ringR, 27, 17 - ringR + 2, 0);
      if (gap === 2) k.rect(24 - ringR, 20, 24 - ringR + 3, 24, 0);
      break;
    }
    case 'FATE_GAMBLER': {
      // The brim belongs to the id too: its tilt and its width vary. The die stays.
      const gv = (n: number, mod: number) => hash2(seed, 80 + n, 3) % mod;
      const brim = 20 + gv(0, 4), tilt = gv(1, 3);
      k.rect(24 - brim, 7 + tilt, 24 + brim, 10 + tilt).rect(13 - gv(2, 2), 0, 34 + gv(3, 2), 7 + tilt);
      k.rect(37, 31, 45, 39).rect(39, 33, 43, 37, 0);
      break;
    }
  }
  return stamp(k, PORTRAIT_ATOMS, material({ density: 8 + seed % 14, hardness: 20 + (seed >>> 7) % 30 }), seed, {
    role: Role.SIGNAL, edgeStep: 3, minFill: 1, maxFill: 2, eyeStep: 4
  });
}

// ---------------------------------------------------------------------------
// THE CAST: every named person in the game, from the same parts.
// ---------------------------------------------------------------------------

const CAST_STYLE = { role: Role.LIFE, edgeStep: 4, minFill: 1, maxFill: 2, eyeStep: 4 };

function castInk(id: string): Ink {
  const k = new Ink();
  const cx = 22;
  const face = (y = 10, r = 6) => { k.disc(cx, y, r).eyeAt(cx - 3, y, 1).eyeAt(cx + 3, y, 1); };
  const legs = () => k.rect(cx - 7, 34, cx - 2, 47).rect(cx + 2, 34, cx + 7, 47);
  switch (id) {
    case 'npc_banker':
      flare(k, cx, 18, 9, 46, 11);
      k.rect(cx - 9, 13, cx + 9, 19);
      k.rect(cx + 11, 22, cx + 22, 36).rect(cx + 13, 26, cx + 20, 27, 0);
      face(9);
      break;
    case 'npc_identifier':
      flare(k, cx, 16, 5, 47, 8);
      face(8, 5);
      k.disc(cx + 12, 8, 8).disc(cx + 12, 8, 4, 0).line(cx + 12, 16, cx + 12, 40, 1);
      break;
    case 'npc_portal_master':
      flare(k, cx, 18, 11, 38, 2);
      k.disc(cx, 12, 11).disc(cx, 13, 6, 0);
      k.disc(cx - 18, 26, 3).disc(cx + 18, 26, 3).disc(cx, 44, 3);
      break;
    case 'npc_weapon_vendor':
      legs();
      k.rect(cx - 13, 18, cx + 13, 35).rect(cx - 20, 18, cx - 14, 38).rect(cx + 14, 18, cx + 20, 38);
      k.rect(cx - 7, 26, cx + 7, 28, 0);
      k.rect(cx + 21, 4, cx + 24, 36).rect(cx + 15, 0, cx + 25, 9);
      face(10, 7);
      break;
    case 'npc_armor_vendor':
      legs();
      k.rect(cx - 7, 18, cx + 7, 35);
      k.rect(cx - 22, 16, cx - 5, 30);
      flare(k, cx - 13, 30, 8, 42, 1);
      k.rect(cx - 15, 20, cx - 12, 34, 0);
      face();
      break;
    case 'npc_guild_master':
      legs();
      k.rect(cx - 9, 18, cx + 9, 35).rect(cx - 13, 15, cx + 13, 20);
      k.rect(cx + 15, 0, cx + 17, 47).rect(cx + 18, 1, cx + 25, 22).rect(cx + 20, 18, cx + 23, 22, 0);
      face();
      break;
    case 'npc_land_manager':
      // A wide-brimmed surveyor, with a rolled plan held across the body.
      legs();
      k.rect(cx - 9, 19, cx + 9, 35);
      k.rect(cx - 6, 0, cx + 6, 3).rect(cx - 13, 4, cx + 13, 6);
      face(11, 5);
      k.line(cx - 15, 40, cx + 19, 15, 3);
      break;
    case 'npc_auctioneer':
      legs();
      k.rect(cx - 6, 20, cx + 6, 35);
      k.rect(cx - 7, 0, cx + 7, 7).rect(cx - 12, 7, cx + 12, 9);
      face(14, 5);
      k.rect(cx + 8, 22, cx + 16, 24).rect(cx + 14, 16, cx + 20, 26);
      break;
    case 'npc_alchemist':
      flare(k, cx, 18, 7, 47, 11);
      face();
      k.rect(cx + 13, 18, cx + 17, 24);
      flare(k, cx + 15, 24, 2, 38, 8);
      k.rect(cx + 11, 31, cx + 19, 32, 0);
      break;
    case 'npc_bartender':
      k.rect(cx - 8, 38, cx - 3, 47).rect(cx + 3, 38, cx + 8, 47);
      k.disc(cx, 28, 15).rect(cx - 8, 24, cx + 8, 26, 0);
      k.rect(cx + 15, 20, cx + 24, 32).rect(cx + 18, 23, cx + 21, 29, 0);
      face(9, 6);
      break;
    default:
      legs();
      k.rect(cx - 8, 18, cx + 8, 35);
      face();
  }
  return k;
}

export function castFigure(id: string): Sprite {
  const seed = fnv1a(`cast:v1:${id}`);
  return stamp(castInk(id), FIGURE_ATOMS, material({ density: 30 + seed % 40, hardness: (seed >>> 5) % 40 }), seed, CAST_STYLE);
}

export function castPortrait(id: string): Sprite {
  const seed = fnv1a(`portrait:v1:${id}`);
  const k = faceInk(seed);
  switch (id) {
    case 'npc_banker': k.rect(6, 36, 41, 40).rect(16, 34, 31, 37); break;
    case 'npc_identifier': k.disc(33, 18, 9).disc(33, 18, 5, 0); break;
    case 'npc_portal_master': k.disc(24, 18, 23).disc(24, 20, 15, 0); k.eye.fill(0); break;
    case 'npc_weapon_vendor': k.rect(2, 34, 45, 47); break;
    case 'npc_armor_vendor': k.rect(4, 32, 16, 47); break;
    case 'npc_guild_master': k.rect(40, 0, 42, 47).rect(30, 1, 39, 14); break;
    case 'npc_land_manager': k.rect(14, 0, 33, 4).rect(4, 5, 43, 8); k.line(2, 44, 16, 34, 2); break;
    case 'npc_auctioneer': k.rect(12, 0, 35, 6).rect(6, 6, 41, 8); break;
    case 'npc_alchemist': k.rect(36, 24, 40, 30); flare(k, 38, 30, 2, 44, 8); break;
    case 'npc_bartender': k.rect(14, 28, 33, 30); break;
  }
  return stamp(k, PORTRAIT_ATOMS, material({ density: 8 + seed % 14, hardness: 20 + (seed >>> 5) % 30 }), seed, {
    role: Role.LIFE, edgeStep: 4, minFill: 1, maxFill: 2, eyeStep: 4
  });
}

/**
 * Coordinate-keyed noise. Every value is a pure function of its place, so the land
 * at one position never depends on what was generated before it.
 */

import { fnv1a } from './DeterministicRNG';

export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 15), 0x2d2816a5);
  return (h ^ (h >>> 16)) >>> 0;
}

const layerSeeds = new Map<string, number>();

/** A stable number for a named layer of a world. Cached, because this runs per tile. */
export function layerSeed(seed: string, layer: string): number {
  const key = `${seed}:${layer}`;
  let value = layerSeeds.get(key);
  if (value === undefined) {
    if (layerSeeds.size > 2048) layerSeeds.clear();
    value = fnv1a(key);
    layerSeeds.set(key, value);
  }
  return value;
}

const lattice = (seed: number, x: number, y: number) => hash2(seed, x, y) / 0x100000000;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** How much each of a place's four corners counts in its value (bilinear on the smoothed step), as `valueNoise` blends them. */
function cornerWeights(x: number, y: number, period: number): number[] {
  const fx = x / period, fy = y / period;
  const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
  return [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
}

/** Value noise in [0,1), with features about `period` cells across. */
export function valueNoise(seed: number, x: number, y: number, period: number): number {
  const fx = x / period, fy = y / period;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  const tx = smooth(fx - cx), ty = smooth(fy - cy);
  const a = lattice(seed, cx, cy), b = lattice(seed, cx + 1, cy);
  const c = lattice(seed, cx, cy + 1), d = lattice(seed, cx + 1, cy + 1);
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** A weight this small moves a sum by less than any reader of a share can see, and only divides the sum below by it. */
const NEGLIGIBLE_WEIGHT = 1e-9;

/**
 * The chance that a weighted sum of even draws in [0,1) comes to at most `s`: the exact spread, by counting the
 * corners of the box each draw spans (inclusion and exclusion over which draws are taken at their top).
 */
export function weightedUniformCdf(weights: readonly number[], s: number): number {
  return spreadAt(spreadOf(weights), s);
}

/** A spread made ready to read: each corner of the box (the sum of the draws taken at their top) and its sign, and the divisor. */
interface ISpread { power: number; corners: number[]; signs: number[]; divisor: number }

function spreadOf(weights: readonly number[]): ISpread {
  const w = weights.filter(x => x > NEGLIGIBLE_WEIGHT);
  let factorial = 1, product = 1;
  for (let i = 0; i < w.length; i++) { factorial *= i + 1; product *= w[i]; }
  const corners: number[] = [], signs: number[] = [];
  for (let mask = 0; mask < (1 << w.length); mask++) {
    let taken = 0, sign = 1;
    for (let i = 0; i < w.length; i++) if (mask & (1 << i)) { taken += w[i]; sign = -sign; }
    corners.push(taken); signs.push(sign);
  }
  return { power: w.length, corners, signs, divisor: factorial * product };
}

function spreadAt(spread: ISpread, s: number): number {
  if (spread.power === 0) return s >= 0 ? 1 : 0;
  let sum = 0;
  for (let i = 0; i < spread.corners.length; i++) {
    const left = s - spread.corners[i];
    if (left <= 0) continue;
    let term = left;
    for (let k = 1; k < spread.power; k++) term *= left;
    sum += spread.signs[i] * term;
  }
  return Math.min(1, Math.max(0, sum / spread.divisor));
}

/** A place's spread hangs only on where it sits in its cell, so a whole-numbered place reads one of period x period of them. */
const spreads = new Map<string, ISpread>();

/**
 * Value noise read through its own spread (GS2): the same land, its high ground still high, but even, so a share of
 * places is a share of the line [0,1). Blending four even corners piles the noise toward its middle; how much depends
 * on where in its cell a place sits, so each place is read through the spread its own blend makes.
 */
export function uniformNoise(seed: number, x: number, y: number, period: number): number {
  const key = `${period}|${x - Math.floor(x / period) * period}|${y - Math.floor(y / period) * period}`;
  let spread = spreads.get(key);
  if (!spread) {
    if (spreads.size > 4096) spreads.clear();
    spread = spreadOf(cornerWeights(x, y, period));
    spreads.set(key, spread);
  }
  return spreadAt(spread, valueNoise(seed, x, y, period));
}

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

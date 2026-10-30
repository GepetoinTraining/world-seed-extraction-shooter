/**
 * GOLDEN VECTORS (Wave 2.6)
 *
 * Reference fingerprints for the world generator, primordial-style: a world
 * cert must generate the SAME world forever. Any refactor that changes these
 * hashes must bump a layer version string instead of silently changing old
 * worlds — the boot check makes a silent change loud.
 *
 * To re-capture after an INTENTIONAL generation change (new layer version):
 * run `window.__captureGoldens()` in the dev console and paste the output here.
 */

import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { WorldGenerator } from './WorldGenerator';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { IMap } from './types';

export interface IGoldenVector {
  seed: string;
  size: number;
  hash: number; // fnv1a of the canonical map JSON
}

// Captured 2026-10-30 (Wave 2 generation: terrain-era entities, ruins, NPCs, beacons)
export const GOLDEN_VECTORS: IGoldenVector[] = [
  { seed: 'golden-alpha', size: 16, hash: 510390627 },
  { seed: 'golden-beta', size: 32, hash: 1682457704 },
  { seed: 'dev-sandbox-v3', size: 32, hash: 3902260507 }
];

/** Static context: goldens pin the generator, not the DB's row order. */
function staticContext() {
  return {
    mobDefinitions: Object.values(MOB_DEFINITIONS),
    resourceDefinitions: Object.values(RESOURCE_DEFINITIONS)
  };
}

/** Canonical fingerprint: everything except wall-clock fields. */
export function fingerprintMap(map: IMap): number {
  const { generatedAt, ...canonical } = map;
  return fnv1a(JSON.stringify(canonical));
}

export function computeGolden(seed: string, size: number): number {
  return fingerprintMap(WorldGenerator.generate(seed, size, staticContext()));
}

/** Boot check: zero mismatches allowed. */
export function runGoldenCheck(): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (const g of GOLDEN_VECTORS) {
    if (g.hash === 0) continue; // uncaptured slot
    const actual = computeGolden(g.seed, g.size);
    if (actual !== g.hash) {
      mismatches.push(`${g.seed}/${g.size}: expected ${g.hash}, got ${actual}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Dev helper: prints the block to paste into GOLDEN_VECTORS. */
export function captureGoldens(): IGoldenVector[] {
  const captured = GOLDEN_VECTORS.map(g => ({ ...g, hash: computeGolden(g.seed, g.size) }));
  console.log('[GOLDENS] Paste into GOLDEN_VECTORS:\n' + JSON.stringify(captured, null, 2));
  return captured;
}

// Expose capture in dev
if (typeof window !== 'undefined') {
  (window as any).__captureGoldens = captureGoldens;
}

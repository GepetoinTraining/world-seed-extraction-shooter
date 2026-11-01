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
import { SECTOR_CHUNKS } from './grid';
import type { IGenerationContext } from './WorldGenerator';

export interface IGoldenVector {
  seed: string;
  size: number;
  hash: number; // fnv1a of the canonical map JSON
}

// The test fixture's land, recaptured when R4 changed what spawns (D54 retired what stood on it).
export const GOLDEN_VECTORS: IGoldenVector[] = [
  { seed: 'golden-alpha', size: 16, hash: 2684391673 },
  { seed: 'golden-beta', size: 32, hash: 3169500984 },
  { seed: 'dev-sandbox-v4', size: 32, hash: 432684866 }
];

/** The shipped theme's own land. A change here means generation moved: say so, on purpose. */
export const FIRST_THEME_VECTORS: IGoldenVector[] = [
  { seed: 'golden-alpha', size: 16, hash: 3036151310 },
  { seed: 'golden-beta', size: 32, hash: 3482659051 },
  { seed: 'dev-sandbox-v4', size: 32, hash: 772219746 }
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

/** A world is on demand, so its fingerprint builds a fixed handful of chunks at its center. */
export function computeGolden(seed: string, size: number, context: IGenerationContext = staticContext()): number {
  const map = WorldGenerator.generate(seed, size, context);
  const mid = (size >> 1) * SECTOR_CHUNKS;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) WorldGenerator.chunkAt(map, mid + x, mid + y, context);
  return fingerprintMap(map);
}

/** Boot check: zero mismatches allowed. */
export function runGoldenCheck(context?: IGenerationContext, vectors: IGoldenVector[] = GOLDEN_VECTORS): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (const g of vectors) {
    if (g.hash === 0) continue; // uncaptured slot
    const actual = computeGolden(g.seed, g.size, context);
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

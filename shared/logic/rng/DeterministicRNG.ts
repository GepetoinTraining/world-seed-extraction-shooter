/**
 * DETERMINISTIC RNG (Wave 1.3)
 *
 * One RNG for every gameplay roll. Streams are derived from STRING KEYS, never
 * from ambient state, in the primordial style:
 *
 *   Rng.fromKey(`${sessionSeed}:loot:${mobId}`)
 *
 * Same key -> same stream -> same rolls, forever. This is what makes sessions
 * replayable, loot provable, and worlds portable.
 *
 * CHARTER (PLAN.md guardrail 5): after Wave 1 lands, any `Math.random` in a
 * gameplay path is a bug by definition. UI sparkle and cosmetic jitter are the
 * only exemptions.
 */

/** FNV-1a 32-bit hash of a string key. */
export function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Seeded stream: FNV-1a keyed LCG.
 * Same algorithm the WorldGenerator has always used, so existing world certs
 * keep generating identical worlds (golden-vector safe).
 */
export class SeededRNG {
  private seed: number;

  constructor(seed: string) {
    this.seed = fnv1a(seed);
  }

  /** [0, 1) */
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (this.next() * (max - min));
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max));
  }

  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }

  /** Receipt: a short checkable fingerprint of where this stream is. */
  cursor(): string {
    return (this.seed >>> 0).toString(16).padStart(8, '0');
  }
}

export const Rng = {
  fromKey(key: string): SeededRNG {
    return new SeededRNG(key);
  }
};

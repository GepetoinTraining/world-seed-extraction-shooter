/**
 * THE BANK'S MINT REGISTRY (Wave 10D.3 — D18, decided by Pedro)
 *
 * First come, first served, GLOBALLY: the bank remembers every rolled item's
 * tuple (definition, affixes, numbers), and a collision deterministically
 * nudges the later roll until it is unique. The first keeps its claim.
 * The spirit on record: Dungeons of Dredmor crossed with Path of Exile.
 *
 * Scope, enacted honestly: the registry covers ROLLED mints — gear and tools
 * with an identity worth rolling. Commodities (resources, planks, ingots) are
 * fungible by design (ICommodity is the bulk contract); their uniqueness is
 * their provenance, not their tuple.
 *
 * Replayability (the one-way door): claims are keyed by tuple AND owned by
 * item id, and ids derive from the roll's own stream — so re-minting the same
 * journaled roll finds its own claim and walks the same nudge ladder to the
 * same rung. Claims are never released; the ladder's lower rungs stand.
 */

import { IItem } from '../../types';
import { fnv1a } from './CompositionSystem';

export class MintRegistry {

  /** tuple hash -> the item id that claimed it first */
  private static claims = new Map<string, string>();

  /** The app sets this to persist claims (write-behind); tests leave it unset. */
  static onClaim: ((tupleHash: string, itemId: string) => void) | null = null;

  /** The tuple D18 names: definition, affixes, numbers. Stable and versioned. */
  static tupleOf(item: IItem): string {
    const stats = Object.entries(item.stats ?? {})
      .filter(([, v]) => typeof v === 'number')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    const affixes = (item.affixes ?? [])
      .map(a => `${a.id}[${Object.entries(a.stats).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(',')}]`)
      .sort()
      .join('|');
    const quality = typeof item.quality === 'number' ? item.quality.toFixed(6) : 'none';
    return fnv1a(`v1|${item.universalDefinitionId}|${item.rank}|${item.rarity}|${quality}|${stats}|${affixes}`);
  }

  /**
   * Register a rolled mint. If its tuple is free, the claim is laid. If the
   * tuple belongs to this very item (a replay), nothing moves. If it belongs
   * to another, the roll is nudged deterministically — a whisper on the
   * quality, derived from the original roll and the rung number — until it
   * stands on a rung that is free or already its own.
   */
  static claim<T extends IItem>(item: T): T {
    let current: T = item;
    for (let rung = 0; ; rung++) {
      if (rung > 0) current = this.nudge(item, rung);
      const hash = this.tupleOf(current);
      const owner = this.claims.get(hash);
      if (owner === undefined) {
        this.claims.set(hash, current.id);
        this.onClaim?.(hash, current.id);
        return current;
      }
      if (owner === current.id) return current;
    }
  }

  /** The nudge: the later roll shifts by a ten-thousandth per rung. Real in
   * the numbers, invisible at the card's rounding — and never the first's. */
  private static nudge<T extends IItem>(item: T, rung: number): T {
    const q = typeof item.quality === 'number' && Math.abs(item.quality) <= 1 ? item.quality : 0;
    return { ...item, quality: Math.round((q + rung * 0.0001) * 1e6) / 1e6 };
  }

  // --- persistence plumbing (the app hydrates; tests reset) ---

  static reset(): void { this.claims.clear(); }

  static snapshot(): [string, string][] { return [...this.claims.entries()]; }

  static hydrate(rows: [string, string][]): void {
    for (const [hash, id] of rows) if (!this.claims.has(hash)) this.claims.set(hash, id);
  }

  static size(): number { return this.claims.size; }
}

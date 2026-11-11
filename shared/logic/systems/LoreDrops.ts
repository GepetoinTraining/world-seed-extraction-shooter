/**
 * LORE PIECES DROP A LOT (the lore pass, call 6). Pedro, 2026-11-11: "they used to drop a lot". A creature with a mind
 * leaves a fragment at the loot law's "sometimes" band and a leader's or a boss's hoard holds one at its "often" band,
 * each on a stream of its own beside what its table gives, so nothing a table drops moves. Only a world whose ground is
 * pinned at version 3 or later gives them: a world that stands gives what it gave (GROUND_VERSION).
 */

import { Rng } from '../rng/DeterministicRNG';
import { LOOT_ODDS_PARTS, LOOT_PARTS } from '../theme/ThemeFormula';

/** The ground version from which a world gives these. */
export const LORE_DROPS_FROM_GROUND = 3;

const CHANCE = { creature: LOOT_ODDS_PARTS.sometimes / LOOT_PARTS, hoard: LOOT_ODDS_PARTS.often / LOOT_PARTS } as const;

export const LoreDrops = {
  chance: CHANCE,

  /** Does this kill or this hoard give a fragment? Keyed by its roll, so a reload gives the same. */
  fragment(source: keyof typeof CHANCE, rollKey: string, groundVersion: number | undefined): boolean {
    if ((groundVersion ?? 1) < LORE_DROPS_FROM_GROUND) return false;
    return Rng.fromKey(`${rollKey}:lore_fragment`).next() < CHANCE[source];
  }
};

/**
 * THE OLD LAW OF A FOUND PIECE, kept for the worlds that stand. The rarity rescale (BALANCE_RUN 1.4) took
 * the power table by rarity out of the game's law: a step multiplies nothing. A world pinned before the
 * new ground (GROUND_VERSION, PieceLaw.FROM_GROUND) still mints by it, and a piece it minted keeps what is
 * stamped on it (call 18), so the hub checks such a piece by the arithmetic it was minted under.
 */

import { Rarity } from '../../types';

/** Item power by rarity, the old law only. MAGICAL never existed under it, so it stands at uncommon's. */
export const RARITY_MULTIPLIERS: Record<Rarity, number> = {
  [Rarity.SCRAP]: 0.5,
  [Rarity.COMMON]: 1.0,
  [Rarity.UNCOMMON]: 1.2,
  [Rarity.MAGICAL]: 1.2,
  [Rarity.RARE]: 1.5,
  [Rarity.EPIC]: 2.0,
  [Rarity.LEGENDARY]: 2.5,
  [Rarity.ARTIFACT]: 3.5
};

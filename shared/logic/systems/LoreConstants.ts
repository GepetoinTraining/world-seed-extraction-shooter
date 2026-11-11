/**
 * The words and numbers about lore that a server prompt and the player store both need,
 * apart from `LoreSystem` so that neither pulls the systems behind it. A guess until Wave 12.
 */

/** How deep a sitting went: the one thing about its worth a model decides. */
export const LORE_DEPTHS = ['shallow', 'fair', 'deep'] as const;
export type LoreDepth = typeof LORE_DEPTHS[number];

/** What a trade note read pays, and what an entry from before the purse is worth. */
export const LORE_NOTE_PAY = 15;

/** What a dream asks to teach a skill born at rank F, and what a forming skill asks to settle (Pedro, 2026-11-11: "Yes, ask for lore"). */
export const LORE_TEACH_PRICE = 40;
/** Rarer costs and pays more, on the same curve as gear's. No rank is the top of it. */
export const LORE_RANK_GROWTH = 1.5;

/** A skill's price in lore, by the rank it is born at. */
export const loreTeachPrice = (rank: number): number => Math.round(LORE_TEACH_PRICE * Math.pow(LORE_RANK_GROWTH, Math.max(0, rank)));

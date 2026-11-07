/**
 * The words and numbers about lore that a server prompt and the player store both need,
 * apart from `LoreSystem` so that neither pulls the systems behind it. A guess until Wave 12.
 */

/** How deep a sitting went: the one thing about its worth a model decides. */
export const LORE_DEPTHS = ['shallow', 'fair', 'deep'] as const;
export type LoreDepth = typeof LORE_DEPTHS[number];

/** What a trade note read pays, and what an entry from before the purse is worth. */
export const LORE_NOTE_PAY = 15;

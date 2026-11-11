/**
 * The words and numbers about lore that a server prompt and the player store both need,
 * apart from `LoreSystem` so that neither pulls the systems behind it. A guess until Wave 12.
 */

/**
 * THE ROLL OF A HUNDRED (the lore pass, BALANCE_RUN.md 3.8, call 1). Pedro, 2026-11-11: "It needs to use the d100 idea
 * and scales for what the roll gives you". The roll sets what a sitting pays; a model only words it (call 7).
 */
export const LORE_STRETCHES = ['misread', 'little', 'fair', 'deep', 'insight'] as const;
export type LoreStretch = typeof LORE_STRETCHES[number];
/** What a sitting on a thing of rank F pays at a fair reading. Half again each rank, as before. */
export const LORE_PER_SITTING = 10;
/** Where a fair reading begins, on a person and a thing of one rank, with nothing to move it. */
export const LORE_FAIR_LINE = 41;
/** Each point of the eye, and of intelligence above 1, moves the person this far along the roll: the d20's one, five times. */
export const LORE_ROLL_PER_POINT = 5;
/** Each rank the thing stands above the person, and each failure it already carries, moves the bar. */
export const LORE_ROLL_PER_RANK = 15;
export const LORE_ROLL_PER_HARM = 10;
/** A misreading, in times the sitting's base (call 4). */
export const LORE_MISREAD_TIMES = 3;
/** A document pays twice, and a thing of the registered paper material half again (call 5). */
export const LORE_DOCUMENT_TIMES = 2;
export const LORE_PAPER_TIMES = 1.5;
/** Of what a sitting pays, the share that goes to its category, rounded down; the rest is general (call 3). */
export const LORE_CATEGORY_SHARE = 2 / 3;

/** What a trade note read pays, and what an entry from before the purse is worth. */
export const LORE_NOTE_PAY = 15;

/** What a dream asks to teach a skill born at rank F, and what a forming skill asks to settle (Pedro, 2026-11-11: "Yes, ask for lore"). */
export const LORE_TEACH_PRICE = 40;
/** Rarer costs and pays more, on the same curve as gear's. No rank is the top of it. */
export const LORE_RANK_GROWTH = 1.5;

/** A skill's price in lore, by the rank it is born at. */
export const loreTeachPrice = (rank: number): number => Math.round(LORE_TEACH_PRICE * Math.pow(LORE_RANK_GROWTH, Math.max(0, rank)));

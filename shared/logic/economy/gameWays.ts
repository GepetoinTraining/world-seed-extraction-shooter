/**
 * The game's own ways of making that are not recipes in a web: cooking a meal (Cooking.ts). Named here
 * once, so the makers and the host that infers a made thing's chain (ItemLaw.ts) read the same names.
 * A meal's labor follows what went into it, so it is not fixed. Tying a snare stood here until
 * 2026-11-19 and does not any more: a snare is asked for like any other thing (MakeAsk).
 */
export const COOK_WAY = { id: 'cook_meal', laborSeconds: null } as const;
export const GAME_WAYS: { id: string; laborSeconds: number | null }[] = [COOK_WAY];

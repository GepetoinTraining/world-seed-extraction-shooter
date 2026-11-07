/**
 * The game's own ways of making that are not recipes in a web: tying a snare (Capture.ts) and cooking
 * a meal (Cooking.ts). Named here once, so the makers and the host that infers a made thing's chain
 * (ItemLaw.ts) read the same names. A meal's labor follows what went into it, so it is not fixed.
 */
export const SNARE_WAY = { id: 'tie_snare', laborSeconds: 30 } as const;
export const COOK_WAY = { id: 'cook_meal', laborSeconds: null } as const;
export const GAME_WAYS: { id: string; laborSeconds: number | null }[] = [SNARE_WAY, COOK_WAY];

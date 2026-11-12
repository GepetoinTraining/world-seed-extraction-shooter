/**
 * WHAT A DEATH COSTS (Wave 4.4): a world's card says it in one word, and the field reads it when a run ends badly.
 * 'NONE' is the tutorial's (Q14): nothing a person brings in is lost, and what they carry is banked as if they had
 * come out. Every other word costs something: the haul, experience, or the character.
 *
 * Read in one place, so the death and the ground agree (GS19): where a death costs nothing, the ground holds nothing
 * above the world's own rank, for risk and reward travel together.
 */

export type DeathPenalty = 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH';

/** Does a death in a world with this word cost nothing? A world that names none costs its haul. */
export const deathCostsNothing = (penalty?: string): boolean => penalty === 'NONE';

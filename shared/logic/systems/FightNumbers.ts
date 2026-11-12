/**
 * THE FIGHT READERS' OWN NUMBERS, in one place both sides read. `CombatMath`, `CombatSystems` and `MobAI`
 * (the field) read them as they always did; `PieceLaw` (the rarity rescale) reads them to size a ruler
 * by what each reader needs for the same lift. Moved here unchanged; every one a guess until Wave 12.
 */

/** A rating read on a curve (`rating / (rating + KNEE)`): evasion and defense. */
export const RATING_KNEE = 100;
/** Layer 0's odds: the chance a hit glances before accuracy, and what a glance leaves. */
export const BASE_GLANCE = 0.2;
export const GLANCE_FACTOR = 0.5;
/** A crit before what is worn. */
export const BASE_CRIT_MULTIPLIER = 1.5;
/** What a block leaves of a blow. */
export const BLOCK_FACTOR = 0.5;
/** A bare hand's shots a second. */
export const UNARMED_SHOTS_PER_SEC = 1.0;
/** How long poison keeps working after the hit, and how often it bites. */
export const POISON_MS = 3000;
export const POISON_TICK_MS = 1000;
/** How much noise reduction it takes to halve the distance you are noticed from. */
export const NOISE_SCALE = 20;

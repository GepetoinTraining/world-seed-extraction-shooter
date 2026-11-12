import { UniversalRank } from './types';

// --- SCALING FACTORS ---

/**
 * Multiplier for Item Power based on Rank.
 * This ensures an S-Rank item is exponentially stronger than an F-Rank.
 */
export const RANK_MULTIPLIERS: Record<UniversalRank, number> = {
  [UniversalRank.F]: 1.0,
  [UniversalRank.E]: 1.2,
  [UniversalRank.D]: 1.5,
  [UniversalRank.C]: 2.0,
  [UniversalRank.B]: 3.0,
  [UniversalRank.A]: 5.0,
  [UniversalRank.S]: 8.0,
  [UniversalRank.SS]: 13.0,
  [UniversalRank.SSS]: 21.0, // Fibonacci sequence approach for power spikes
};

// --- ECONOMY CONSTANTS ---

export const MAX_INVENTORY_SLOTS = 20;
export const MAX_BANK_SLOTS_DEFAULT = 50;

/**
 * Tax rate per day for owning a plot of land.
 * Forces players to generate Gold (Gameplay) to maintain Territory (Social).
 */
export const DAILY_LAND_TAX_GOLD = 100;

// --- UI COLORS ---

export const RANK_COLORS: Record<UniversalRank, string> = {
  [UniversalRank.F]: 'text-rank-f border-rank-f',
  [UniversalRank.E]: 'text-rank-e border-rank-e',
  [UniversalRank.D]: 'text-rank-d border-rank-d',
  [UniversalRank.C]: 'text-rank-c border-rank-c',
  [UniversalRank.B]: 'text-rank-b border-rank-b',
  [UniversalRank.A]: 'text-rank-a border-rank-a',
  [UniversalRank.S]: 'text-rank-s border-rank-s',
  [UniversalRank.SS]: 'text-rank-ss border-rank-ss',
  [UniversalRank.SSS]: 'text-rank-sss border-rank-sss',
};

export const BG_RANK_COLORS: Record<UniversalRank, string> = {
  [UniversalRank.F]: 'bg-rank-f',
  [UniversalRank.E]: 'bg-rank-e',
  [UniversalRank.D]: 'bg-rank-d',
  [UniversalRank.C]: 'bg-rank-c',
  [UniversalRank.B]: 'bg-rank-b',
  [UniversalRank.A]: 'bg-rank-a',
  [UniversalRank.S]: 'bg-rank-s',
  [UniversalRank.SS]: 'bg-rank-ss',
  [UniversalRank.SSS]: 'bg-rank-sss',
};
/**
 * Stats a rank does not move. Pedro, 2026-11-11: "gear needs to give energy stat (you get very little
 * energy simply by levelling)", and his day reads no rank (BALANCE_RUN 1.5), so energy on a piece is the
 * same amount at rank F and at SSS, natively and as a property. A list of what reads no rank, not a limit.
 */
export const RANKLESS_STATS: readonly string[] = ['max_energy'];

/** Does a rank multiply this stat where a piece is minted? */
export const readsRank = (stat: string): boolean => !RANKLESS_STATS.includes(stat);

/**
 * The rarity rescale (BALANCE_RUN 1.2, 1.4): how a stat is read, which decides two things about it on a
 * piece. An amount is added to a figure and goes before the name; a rating is read through a curve and
 * goes after it. And whether a rank doubles it: an amount a fight reads does; the day's energy,
 * kilograms, tiles and seconds never do ("no rank at all"); a rating doubles once its reader reads it
 * against a rank, which is the fight's rebalance, so until then it reads none on the piece.
 * A list of how each stat is read, never a limit on what may roll.
 */
export const RATING_STATS: readonly string[] = [
  'defense', 'physical_reduction', 'accuracy_rating', 'evasion_rating', 'crit_chance', 'crit_multiplier', 'block_chance',
  'movement_speed', 'movement_speed_penalty', 'noise_reduction', 'luck_find_rarity', 'field_analysis_speed', 'attack_speed',
  'craft_speed_pct', 'upkeep_discount_pct', 'cart_alarm'
];
/** Amounts in kilograms, tiles or seconds, beside the day's energy: they read no rank. */
export const UNIT_STATS: readonly string[] = ['carry_capacity', 'carry_bonus_kg', 'light_radius', 'pickup_radius', 'cart_lock'];

export type StatReading = 'amount' | 'rating' | 'rankless';

/** An amount a rank doubles, a rating, or a number no rank moves. Mind attributes on a frame are amounts of no rank. */
export const statReading = (stat: string): StatReading =>
  RANKLESS_STATS.includes(stat) || UNIT_STATS.includes(stat) || MIND_STATS.includes(stat) ? 'rankless'
    : RATING_STATS.includes(stat) ? 'rating' : 'amount';

/** Which side of a name a stat stands on, by its reader: an amount before (a prefix), a rating after (a suffix). */
export const statSide = (stat: string): 'PREFIX' | 'SUFFIX' => RATING_STATS.includes(stat) ? 'SUFFIX' : 'PREFIX';

const MIND_STATS: readonly string[] = ['intelligence', 'focus', 'engineering', 'hacking', 'perception', 'charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership'];

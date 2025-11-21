import { UniversalRank, Rarity } from '../types';

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

/**
 * Multiplier for Item Power based on Rarity.
 */
export const RARITY_MULTIPLIERS: Record<Rarity, number> = {
  [Rarity.SCRAP]: 0.5,
  [Rarity.COMMON]: 1.0,
  [Rarity.UNCOMMON]: 1.2,
  [Rarity.RARE]: 1.5,
  [Rarity.EPIC]: 2.0,
  [Rarity.LEGENDARY]: 2.5,
  [Rarity.ARTIFACT]: 3.5,
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
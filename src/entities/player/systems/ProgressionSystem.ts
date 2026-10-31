import { UniversalRank, Rarity } from '../../../../types';

// --- XP TABLES ---
const RANK_BASE_XP: Record<UniversalRank, number> = {
  [UniversalRank.F]: 50,
  [UniversalRank.E]: 100,
  [UniversalRank.D]: 250,
  [UniversalRank.C]: 600,
  [UniversalRank.B]: 1500,
  [UniversalRank.A]: 4000,
  [UniversalRank.S]: 10000,
  [UniversalRank.SS]: 25000,
  [UniversalRank.SSS]: 100000
};

const RARITY_MULTIPLIER: Record<Rarity, number> = {
  [Rarity.SCRAP]: 0.5,
  [Rarity.COMMON]: 1.0,
  [Rarity.UNCOMMON]: 1.2,
  [Rarity.RARE]: 1.5,
  [Rarity.EPIC]: 2.5,
  [Rarity.LEGENDARY]: 5.0,
  [Rarity.ARTIFACT]: 10.0
};

export const XP_CONSTANTS = {
  BASE_LEVEL_XP: 100,
  EXPONENT: 2.1,
  GROUP_BONUS_FACTOR: 0.8, 
};

// --- THE UNIVERSAL RANK TRACK (Wave 9.5, D6) ---
// Kills feed rankXp; crossing a threshold is a rank-up and grants attribute
// points. Thresholds are lifetime totals. A rat (F, COMMON) pays 50, so the
// first rank-up is ~20 rats or two E-rank kills — early, seen, believed.
export const RANK_ORDER: UniversalRank[] = [
  UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C,
  UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS
];

export const RANK_XP_THRESHOLDS: Record<UniversalRank, number> = {
  [UniversalRank.F]: 0,
  [UniversalRank.E]: 1_000,
  [UniversalRank.D]: 4_000,
  [UniversalRank.C]: 12_000,
  [UniversalRank.B]: 30_000,
  [UniversalRank.A]: 75_000,
  [UniversalRank.S]: 180_000,
  [UniversalRank.SS]: 450_000,
  [UniversalRank.SSS]: 1_200_000
};

export const POINTS_PER_RANK_UP = 3;

export class ProgressionSystem {

  static rankIndex(rank: UniversalRank | string): number {
    const i = RANK_ORDER.indexOf(rank as UniversalRank);
    return i === -1 ? 0 : i;
  }

  /** The rank a lifetime of kill XP has earned. */
  static rankFromXp(rankXp: number): UniversalRank {
    let rank = UniversalRank.F;
    for (const r of RANK_ORDER) {
      if (rankXp >= RANK_XP_THRESHOLDS[r]) rank = r;
    }
    return rank;
  }

  /** XP still owed before the next rank, or null at SSS. */
  static xpToNextRank(rankXp: number): { next: UniversalRank; needed: number; have: number; floor: number } | null {
    const at = this.rankIndex(this.rankFromXp(rankXp));
    if (at >= RANK_ORDER.length - 1) return null;
    const next = RANK_ORDER[at + 1];
    const floor = RANK_XP_THRESHOLDS[this.rankFromXp(rankXp)];
    return { next, needed: RANK_XP_THRESHOLDS[next] - rankXp, have: rankXp - floor, floor };
  }

  /**
   * D6: a rank is effectiveness against the target's difficulty. Outside
   * combat, outranking the task by three or more is an automatic success
   * (Magic Lockpicking at SS opens a simple B lock without a roll).
   */
  static checkSkill(actorRank: UniversalRank | string, taskRank: UniversalRank | string): { autoSuccess: boolean; gap: number } {
    const gap = this.rankIndex(actorRank) - this.rankIndex(taskRank);
    return { autoSuccess: gap >= 3, gap };
  }

  /**
   * Calculates XP gained from a kill.
   * Formula: (RankBase * RarityMult) / (PlayerCount ^ GroupBonus)
   */
  static calculateKillXp(
    targetRank: UniversalRank, 
    targetRarity: Rarity, 
    participantCount: number = 1
  ): number {
    const base = RANK_BASE_XP[targetRank] || 50;
    const mult = RARITY_MULTIPLIER[targetRarity] || 1.0;
    
    const totalXp = base * mult;
    const denominator = Math.pow(Math.max(1, participantCount), XP_CONSTANTS.GROUP_BONUS_FACTOR);
    
    return Math.floor(totalXp / denominator);
  }

  /**
   * XP needed to go from current level to next.
   */
  static getXpToNextLevel(currentLevel: number): number {
    return Math.floor(XP_CONSTANTS.BASE_LEVEL_XP * Math.pow(currentLevel, XP_CONSTANTS.EXPONENT));
  }

  /**
   * Total cumulative XP for a level.
   */
  static getXpForLevel(level: number): number {
    let total = 0;
    for (let i = 1; i < level; i++) {
      total += Math.floor(XP_CONSTANTS.BASE_LEVEL_XP * Math.pow(i, XP_CONSTANTS.EXPONENT));
    }
    return total;
  }

  static getRankFromLevel(level: number): UniversalRank {
    if (level < 10) return UniversalRank.F;
    if (level < 25) return UniversalRank.E;
    if (level < 45) return UniversalRank.D;
    if (level < 65) return UniversalRank.C;
    if (level < 80) return UniversalRank.B;
    if (level < 95) return UniversalRank.A;
    if (level < 100) return UniversalRank.S;
    if (level < 120) return UniversalRank.SS;
    return UniversalRank.SSS;
  }

  static calculateLearningRate(
    skillTags: string[], 
    attributes: any
  ): number {
    let multiplier = 1.0;
    if (skillTags.includes('physical') && attributes.strength) multiplier += attributes.strength * 0.01;
    if (skillTags.includes('tech') && attributes.intelligence) multiplier += attributes.intelligence * 0.01;
    if (skillTags.includes('meme') && attributes.charisma) multiplier += attributes.charisma * 0.05;
    return multiplier;
  }
}
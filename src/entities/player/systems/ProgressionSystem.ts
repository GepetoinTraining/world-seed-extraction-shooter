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

export class ProgressionSystem {
  
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
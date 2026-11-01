import { IPlayer, ISkillProgress, ISkillState, UniversalRank, Rarity } from '../../../../types';

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

/**
 * D84: time is the real resource. Pedro's "down by 150%", read as: a skill takes
 * 2.5 times as long to gain. The rungs, the skill levels and the weight an unheld
 * skill needs all read this one number.
 */
export const SKILL_TIME_FACTOR = 2.5;

export const XP_CONSTANTS = {
  BASE_LEVEL_XP: 100 * SKILL_TIME_FACTOR,
  EXPONENT: 2.1,
  GROUP_BONUS_FACTOR: 0.8, 
};

// --- THE UNIVERSAL RANK (Wave 9.5, D6, D83) ---
export const RANK_ORDER: UniversalRank[] = [
  UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C,
  UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS
];

/**
 * The old ladder, when lifetime experience decided the rank. D83 ended that: it
 * stays only so that a save from before keeps the rank it earned, once.
 */
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

// --- LEVELS (D83): from experience, reset at each rank, with no top ---
// A first level asks LEVEL_KILLS common foes of the character's own rank, and each
// level after asks more by LEVEL_GROWTH. Three levels at rank F are 45 rats where
// the old rank-up's three points were 20, and the next rank's foes pay what its
// levels ask. Guesses until Wave 12.
export const POINTS_PER_LEVEL = 1;
export const LEVEL_KILLS = 5;
export const LEVEL_GROWTH = 1.5;

type HasLevels = Pick<IPlayer, 'rank' | 'rankXp' | 'levelXp' | 'levelsBanked'>;

export class ProgressionSystem {

  static rankIndex(rank: UniversalRank | string): number {
    const i = RANK_ORDER.indexOf(rank as UniversalRank);
    return i === -1 ? 0 : i;
  }

  /** The rank a lifetime of experience earned on the old ladder. Only a save from before asks. */
  static rankFromXp(rankXp: number): UniversalRank {
    let rank = UniversalRank.F;
    for (const r of RANK_ORDER) {
      if (rankXp >= RANK_XP_THRESHOLDS[r]) rank = r;
    }
    return rank;
  }

  /** The rank a character holds. One not yet migrated holds what its experience earned. */
  static rankOf(player: HasLevels): UniversalRank {
    return player.rank ?? this.rankFromXp(player.rankXp ?? 0);
  }

  /** What the next level asks, from this one. A higher rank's levels ask more. */
  static levelCost(rank: UniversalRank, level: number): number {
    return Math.floor((RANK_BASE_XP[rank] ?? RANK_BASE_XP[UniversalRank.F]) * LEVEL_KILLS * Math.pow(level, LEVEL_GROWTH));
  }

  /** Where this much experience stands at this rank. */
  static levelFromXp(rank: UniversalRank, levelXp: number): { level: number; into: number; needed: number } {
    let level = 1;
    let left = Math.max(0, levelXp);
    while (left >= this.levelCost(rank, level)) {
      left -= this.levelCost(rank, level);
      level++;
    }
    return { level, into: left, needed: this.levelCost(rank, level) };
  }

  static levelProgress(player: HasLevels): { level: number; into: number; needed: number } {
    return this.levelFromXp(this.rankOf(player), player.levelXp ?? 0);
  }

  static levelOf(player: HasLevels): number {
    return this.levelProgress(player).level;
  }

  /** Every level climbed, at any rank. A reset does not lower this, so nothing that reads it takes a hit. */
  static levelsEarned(player: HasLevels): number {
    return (player.levelsBanked ?? 0) + this.levelOf(player) - 1;
  }

  /** Experience lands: lifetime and level both, and each level crossed pays its points. */
  static gainXp(player: IPlayer, amount: number): { player: IPlayer; from: number; to: number; points: number } {
    const settled = this.migrate(player);
    const gained = Math.max(0, amount);
    const from = this.levelOf(settled);
    const fed = { ...settled, rankXp: (settled.rankXp ?? 0) + gained, levelXp: (settled.levelXp ?? 0) + gained };
    const to = this.levelOf(fed);
    const points = (to - from) * POINTS_PER_LEVEL;
    return { player: { ...fed, attributePoints: (fed.attributePoints ?? 0) + points }, from, to, points };
  }

  /**
   * D83's seam: the guild grants a rank for hard quests. The level resets and
   * nothing else moves: attributes, unspent points and whatever grows with level all
   * stay. With no rank named it is the next one. A rank never falls this way.
   */
  static grantRank(player: IPlayer, to?: UniversalRank): { player: IPlayer; granted: boolean; from: UniversalRank; to: UniversalRank } {
    const settled = this.migrate(player);
    const from = this.rankOf(settled);
    const target = to ?? RANK_ORDER[this.rankIndex(from) + 1];
    if (!target || this.rankIndex(target) <= this.rankIndex(from)) return { player: settled, granted: false, from, to: from };
    return {
      player: { ...settled, rank: target, levelXp: 0, levelsBanked: this.levelsEarned(settled) },
      granted: true,
      from,
      to: target
    };
  }

  /**
   * A save from before D83 and D84 arrives once, without loss. Pure; a character
   * holding a stored rank passes straight through.
   * - The rank its experience earned is stored, and experience never moves it again.
   * - What stands past that rank's floor becomes levels, paid in points as a level
   *   is, since no rank-up ever paid for that stretch.
   * - The ranks it walked count as levels climbed, so it holds the energy a new
   *   character would. Their points were paid by the old rank-ups.
   * - Skills keep their level and rung, and half-done work keeps its fill, against
   *   costs that are now SKILL_TIME_FACTOR higher.
   */
  static migrate(player: IPlayer): IPlayer {
    if (player.rank) return player;
    const lifetime = player.rankXp ?? 0;
    const rank = this.rankFromXp(lifetime);
    const levelXp = lifetime - RANK_XP_THRESHOLDS[rank];
    const level = this.levelFromXp(rank, levelXp).level;
    const levelsBanked = RANK_ORDER.slice(0, this.rankIndex(rank)).reduce((sum, walked, i) =>
      sum + this.levelFromXp(walked, RANK_XP_THRESHOLDS[RANK_ORDER[i + 1]] - RANK_XP_THRESHOLDS[walked]).level - 1, 0);
    const scaleSkill = (s: ISkillState): ISkillState => ({ ...s, currentXp: Math.round(s.currentXp * SKILL_TIME_FACTOR) });
    const scaleWork = (p: ISkillProgress): ISkillProgress => ({ ...p, weight: p.weight * SKILL_TIME_FACTOR });
    const mapValues = <T,>(rows: Record<string, T>, fn: (row: T) => T) =>
      Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, fn(row)]));
    return {
      ...player,
      rank,
      levelXp,
      levelsBanked,
      attributePoints: (player.attributePoints ?? 0) + (level - 1) * POINTS_PER_LEVEL,
      bank: player.bank && { ...player.bank, universalSkills: mapValues(player.bank.universalSkills ?? {}, scaleSkill) },
      skillProgress: player.skillProgress && mapValues(player.skillProgress, scaleWork)
    };
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
/**
 * A PIECE ABOVE NORMAL (BALANCE_RUN 1.4, the rarity rescale). Pedro, 2026-11-11: "uncommon is
 * technological with 1 stat (prefix or suffix), then magical 2 stats (one suffix one affix), rare 4
 * epic 6. the ranks are tiers", and "Yes, rank is tier". On gear stopping at rank D because a rank was
 * written on each kind: "because it needs to be generated, the gear is a "noun", it has the slot it
 * goes into".
 *
 * A piece has three facts, kept apart here:
 *   rank      where it came from (a ground, a body, a chest), never its kind. It doubles a piece, once.
 *   quality   the one roll on a piece. It moves every number on the piece together.
 *   step      common, uncommon, magical, rare, epic: read off the piece by counting its properties,
 *             never written on it, and it multiplies nothing.
 *
 * Pure. A piece keeps words and one number; every number here is worked out from them, never rounded.
 */

import { IAffix, Rarity, UniversalRank } from '../../types';
import { statReading, StatReading } from '../../constants';
import { GEAR_SHAPES, rankStep } from './ThemeFormula';
import { GearKind } from './ThemeTypes';

/** What one rank is worth to a piece (1.6, call 1): it doubles. */
const RANK_RATIO = 2;
/** A common piece's power at rank F (2.5): 50, the same base the formula always had. */
const BASE_POWER = 50;
/** A tool holds a third of a piece's power, as before. */
const TOOL_SHARE = 1 / 3;
/** A weapon's blow is a fixed share of its power, with no bare constant beside it (1.2): a fifth, 10 at rank F. */
const BLOW_SHARE = 1 / 5;

/** The ladder, read off a piece: nothing; one property on either side; then pairs of one prefix with one suffix. */
const PAIR_STEPS = [Rarity.MAGICAL, Rarity.RARE, Rarity.EPIC] as const;

export const PieceLaw = {
  /** The law a found piece carries (`IItem.pieceLaw`). */
  VERSION: 1,
  /** The ground a world must have pinned at its mint for its finds to follow this law (GROUND_VERSION). */
  FROM_GROUND: 4,

  /** One scale: 2^step, F 1 to SSS 256. */
  scale(rank: UniversalRank | string): number {
    return Math.pow(RANK_RATIO, Math.max(0, rankStep(rank as UniversalRank)));
  },

  reading(stat: string): StatReading {
    return statReading(stat);
  },

  /** What a rank does to a stat on a piece: an amount doubles, the rest read none until their readers read one. */
  rankFactor(stat: string, rank: UniversalRank | string): number {
    return statReading(stat) === 'amount' ? this.scale(rank) : 1;
  },

  /** A piece's power: 50 x 2^step x (1 + quality), a tool a third. Found or made, the same law. */
  power(rank: UniversalRank | string, quality: number, tool: boolean): number {
    return BASE_POWER * this.scale(rank) * (1 + quality) * (tool ? TOOL_SHARE : 1);
  },

  /** A weapon's blow from its power. */
  blowOf(power: number): number {
    return power * BLOW_SHARE;
  },

  /**
   * What a kind carries by itself at a rank, at quality 0: one number each, the middle of what the formula
   * writes for it at rank F, doubled a rank where the stat is an amount. One roll on a piece (call 16).
   */
  nativeLines(kind: GearKind, step: number): { stat: string; value: number }[] {
    return GEAR_SHAPES[kind].implicits(0).map(l => ({
      stat: l.stat,
      value: (l.value ?? ((l.min ?? 0) + (l.max ?? 0)) / 2) * (statReading(l.stat) === 'amount' ? Math.pow(RANK_RATIO, step) : 1)
    }));
  },

  /** The step of a piece, by counting what it holds. No step multiplies anything. */
  stepOf(affixes: readonly Pick<IAffix, 'type'>[]): Rarity {
    const prefixes = affixes.filter(a => a.type === 'PREFIX').length;
    const suffixes = affixes.length - prefixes;
    const pairs = Math.min(prefixes, suffixes);
    if (pairs === 0) return affixes.length > 0 ? Rarity.UNCOMMON : Rarity.COMMON;
    // Past three pairs the ladder has no further word; the count on the piece still says what it holds
    return PAIR_STEPS[Math.min(pairs, PAIR_STEPS.length) - 1];
  }
};

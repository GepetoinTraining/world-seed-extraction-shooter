/**
 * A PIECE ABOVE NORMAL (BALANCE_RUN 1.4, the rarity rescale). Pedro, 2026-11-11: "uncommon is
 * technological with 1 stat (prefix or suffix), then magical 2 stats (one suffix one affix), rare 4
 * epic 6. the ranks are tiers", and "Yes, rank is tier". On gear stopping at rank D because a rank was
 * written on each kind: "because it needs to be generated, the gear is a "noun", it has the slot it
 * goes into". Asked whether any piece can carry any stat: "Any stat, any piece". Asked whether a full
 * epic kit should be worth a whole rank over a plain one: "Yes, a whole rank".
 *
 * A piece has three facts, kept apart here:
 *   rank      where it came from (a ground, a body, a chest), never its kind. It doubles a piece, once.
 *   quality   the one roll on a piece. It moves every number on the piece together.
 *   step      common, uncommon, magical, rare, epic: read off the piece by counting its properties,
 *             never written on it, and it multiplies nothing.
 *
 * And the affix law (part 2): one affix gives one stat, sized band x ruler(stat, the carrier's rank) x
 * (1 + quality); an amount stands before the name, a rating after it; the ladder is one on either side,
 * then pairs; a find goes d steps deep with chance q^d, the odds moved by the body and the finder's luck.
 *
 * Pure. A piece keeps words and one number; every number here is worked out from them, never rounded.
 */

import { IAffix, IAttributes, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../../types';
import { statReading, StatReading, statSide } from '../../constants';
import { GEAR_SHAPES, STAT_SCALE, WIDEST_VIEW_TILES, rankStep } from './ThemeFormula';
import { GearKind, STAT_BANDS } from './ThemeTypes';
import { StatSystem } from '../systems/StatSystem';
import { InventorySystem } from '../../entities/player/systems/InventorySystem';
import {
  BASE_CRIT_MULTIPLIER, BASE_GLANCE, BLOCK_FACTOR, GLANCE_FACTOR, NOISE_SCALE, POISON_MS, POISON_TICK_MS, RATING_KNEE, UNARMED_SHOTS_PER_SEC
} from '../systems/FightNumbers';
import { TILE_PX } from '../../entities/world/grid';
import type { SeededRNG } from '../rng/DeterministicRNG';

/** What one rank is worth to a piece (1.6, call 1): it doubles. */
const RANK_RATIO = 2;
/** A common piece's power at rank F (2.5): 50, the same base the formula always had. */
const BASE_POWER = 50;
/** A tool holds a third of a piece's power, as before. */
const TOOL_SHARE = 1 / 3;
/** A weapon's blow is a fixed share of its power, with no bare constant beside it (1.2): a fifth, 10 at rank F. */
const BLOW_SHARE = 1 / 5;
const RANK_WORDS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'] as const;

/** The ladder, read off a piece: nothing; one property on either side; then pairs of one prefix with one suffix. */
const PAIR_STEPS = [Rarity.MAGICAL, Rarity.RARE, Rarity.EPIC] as const;

export type Band = typeof STAT_BANDS[number];
/** An affix's size as a share of one ruler (1.4): minor a twelfth, moderate a sixth, major a third. Six moderates are one ruler. */
const BANDS: Record<Band, number> = { minor: 1 / 12, moderate: 1 / 6, major: 1 / 3 };
const BAND_ORDER: readonly Band[] = ['minor', 'moderate', 'major'];

/** The chance a found thing goes one step deeper (1.4): the old 60, 25, 10, 4, 1 already is q^d with q = 0.4. */
const ODDS_Q = 0.4;

/**
 * The one shared factor of every ruler: ruler(stat, rank) = RULER_FACTOR x the stat's plain reference. Not chosen:
 * solved so that a full kit, every worn position epic and every affix moderate, comes to one rank over a plain kit
 * of the same rank on the same body, through the fight's own readers (Pedro: "Yes, a whole rank"). Solved and held
 * by `tests/kit.measure.test.ts`; when what a body holds or deals changes, that bar goes red and it is solved again.
 */
const RULER_FACTOR = 0.1994;

/**
 * What the body a thing was found on does to the odds of depth: each class up holds twice what the one below it
 * holds (1.2, D93), and its finds go twice the odds deeper. How a body is read, never a limit.
 */
const BODY_ODDS: readonly [string, number][] = [['titan', 8], ['god', 8], ['boss', 4], ['elite', 2]];

/** A plain body of a rank: every attribute at its floor, 1 + step (1.2). */
const floorBody = (step: number): IAttributes =>
  Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1 + step])) as unknown as IAttributes;

/**
 * A stat's plain reference, by its own reader (the coordinator's ruling on the ruler, 2026-11-12). For an amount,
 * what a plain body of the rank already has of the figure it is added to; for a rating, what its reader needs for
 * the same lift against an equal rank: the plain figure over what one more of the stat adds to it. An amount a
 * rank doubles reads the piece's rank; everything else reads none, so it is read at rank F. Undefined for a stat
 * no worn piece's reader reads (a room's, a cart's, a mind's): those keep the formula's old scale.
 */
/**
 * The ratings a reader reads against a rank (the fight's law, part 3): a blow's protection and a dodge against the
 * striker's, a glance against the holder's own. On a piece they double a rank, as the knee they are read on does.
 */
const RANK_RATINGS = new Set(['defense', 'evasion_rating', 'accuracy_rating']);
const readsRankOf = (stat: string) => statReading(stat) === 'amount' || RANK_RATINGS.has(stat);

function referenceOf(stat: string, rank: UniversalRank | string): number | undefined {
  const step = readsRankOf(stat) ? Math.max(0, rankStep(rank as UniversalRank)) : 0;
  const body = floorBody(step);
  const knee = RATING_KNEE * Math.pow(RANK_RATIO, step);
  const blow = BLOW_SHARE * BASE_POWER * Math.pow(RANK_RATIO, step);
  switch (stat) {
    // Amounts: the figure each is added to
    case 'damage': return blow;                                                          // a plain weapon's blow (CombatMath.weaponDamage)
    case 'poison_damage': return blow / (POISON_MS / POISON_TICK_MS);                    // a hit's poison bites this many times
    case 'max_health': return StatSystem.maxHealth(body, undefined, RANK_WORDS[Math.min(step, RANK_WORDS.length - 1)]);
    case 'max_energy': return StatSystem.maxEnergy(body);
    case 'carry_capacity': case 'carry_bonus_kg': return InventorySystem.maxCarryWeight(body.strength);
    case 'pickup_radius': return StatSystem.pickupRadiusPx() / TILE_PX;                   // the reach its units are added to
    case 'light_radius': return WIDEST_VIEW_TILES;                                        // sight, against the farthest a body notices from
    // Ratings: the plain figure over what one more adds to it
    case 'defense': return knee;                                                          // what a blow leaves: 1 + defense / knee
    case 'evasion_rating': return knee + StatSystem.evasionRating(undefined, body);
    case 'accuracy_rating': {
      const a0 = StatSystem.accuracyRating(undefined, body);
      const kept = 1 - BASE_GLANCE * knee / (knee + a0) * (1 - GLANCE_FACTOR);
      return kept / (BASE_GLANCE * knee * (1 - GLANCE_FACTOR) / Math.pow(knee + a0, 2));
    }
    case 'crit_chance': return (1 + StatSystem.critChance(undefined, body) * (BASE_CRIT_MULTIPLIER - 1)) / (BASE_CRIT_MULTIPLIER - 1);
    case 'crit_multiplier': return BASE_CRIT_MULTIPLIER;
    case 'block_chance': return 1 / (1 - BLOCK_FACTOR);
    case 'attack_speed': case 'haste': return UNARMED_SHOTS_PER_SEC * StatSystem.fireRateScale(body);   // haste, added to a hand's own rate
    case 'movement_speed': return 1 + StatSystem.paceBonus(body);
    case 'physical_reduction': return 1;                                                 // a share summed straight
    case 'noise_reduction': return NOISE_SCALE + StatSystem.noiseReduction(undefined, body);
    case 'luck_find_rarity': return 1;                                                   // PieceLaw.oddsOf: the odds x (1 + luck)
    case 'field_analysis_speed': return 1 + StatSystem.signalEyes(body);
    default: return undefined;
  }
}

/**
 * The stat keys, cleaned (1.4's last paragraph, part 3): protection is one rating, `defense`; carrying is one key,
 * `carry_capacity`; and `attack_speed` is a weapon's own rate, never an affix, so what the rest of the body adds is
 * `haste`. An old word naming the other key is read as the one. A piece of the old law keeps its keys, and the
 * readers read them as the one rating, the one load and the hand's rate (`CombatMath`, `LoadoutSystem`).
 */
const ONE_KEY: Record<string, string> = { physical_reduction: 'defense', carry_bonus_kg: 'carry_capacity', attack_speed: 'haste' };
const oneKey = (stat: string) => ONE_KEY[stat] ?? stat;

/** One affix's words, read from the bank: the one stat it gives, and the price it may ask. */
export interface IAffixWords { gift: { stat: string; band: Band }; price?: { stat: string; band: Band } }
type Rollable = { statModifiers?: Record<string, [number, number]>; gives?: { stat: string; band: string; downside: boolean }[] };

export const PieceLaw = {
  /** The law a found piece carries (`IItem.pieceLaw`). */
  VERSION: 1,
  /** The ground a world must have pinned at its mint for its finds to follow this law (GROUND_VERSION). */
  FROM_GROUND: 4,
  BANDS,
  ODDS_Q,
  RULER_FACTOR,

  /** One scale: 2^step, F 1 to SSS 256. */
  scale(rank: UniversalRank | string): number {
    return Math.pow(RANK_RATIO, Math.max(0, rankStep(rank as UniversalRank)));
  },

  reading(stat: string): StatReading {
    return statReading(stat);
  },

  /** What a rank does to a stat with no ruler: an amount doubles, the rest read none until their readers read one. */
  rankFactor(stat: string, rank: UniversalRank | string): number {
    return readsRankOf(stat) ? this.scale(rank) : 1;
  },

  /** A piece's power: 50 x 2^step x (1 + quality), a tool a third. Found or made, the same law. */
  power(rank: UniversalRank | string, quality: number, tool: boolean): number {
    return BASE_POWER * this.scale(rank) * (1 + quality) * (tool ? TOOL_SHARE : 1);
  },

  /** A weapon's blow from its power. */
  blowOf(power: number): number {
    return power * BLOW_SHARE;
  },

  /** A stat's plain reference at a rank, by its own reader (`referenceOf`); NaN for a stat no worn piece reads. */
  reference(stat: string, rank: UniversalRank | string): number {
    return referenceOf(stat, rank) ?? NaN;
  },

  /** What one native piece of the stat gives at a rank. A stat no worn piece reads keeps the formula's old scale, a moderate band's middle as a sixth. */
  ruler(stat: string, rank: UniversalRank | string): number {
    const ref = referenceOf(stat, rank);
    return ref !== undefined ? RULER_FACTOR * ref : 9 * (STAT_SCALE[stat] ?? 1);
  },

  /**
   * What a kind carries by itself at a rank, at quality 0. The law's sentence kept true: a native line is one ruler
   * of its stat, on its one key, at the piece's rank. Kept as the kind's own, the middle of the formula's rank-F line:
   * a weapon's own rate; the day's energy (Pedro: "I'd leave it to 1-2 at most", no rank); the boots' own pace (the
   * coordinator, 2026-11-12: a plain body in a plain kit walks what it walked on main, since "a person can always
   * leave" is measured against creatures not yet rebalanced); and what has no ruler (a tool's power, doubled a rank).
   * One roll on a piece (call 16).
   */
  nativeLines(kind: GearKind, step: number): { stat: string; value: number }[] {
    const shape = GEAR_SHAPES[kind];
    const rank = RANK_WORDS[Math.max(0, Math.min(step, RANK_WORDS.length - 1))];
    return shape.implicits(0).map(l => {
      const middle = l.value ?? ((l.min ?? 0) + (l.max ?? 0)) / 2;
      const weaponRate = shape.bucket === 'weapon_bases' && l.stat === 'attack_speed';
      if (weaponRate || l.stat === 'max_energy' || l.stat === 'movement_speed') return { stat: l.stat, value: middle };
      const stat = oneKey(l.stat);
      if (referenceOf(stat, rank) !== undefined) return { stat, value: this.ruler(stat, rank) };
      return { stat, value: middle * (statReading(stat) === 'amount' ? Math.pow(RANK_RATIO, step) : 1) };
    });
  },

  /** The odds-multiplier of a find: the finder's luck, read as what it multiplies the odds by, and the body it came from. */
  oddsOf(f: { luck: number; tags: readonly string[] }): number {
    const body = BODY_ODDS.find(([tag]) => f.tags.includes(tag))?.[1] ?? 1;
    return (1 + Math.max(0, f.luck)) * body;
  },

  /** The chance of one more step, with the odds moved: it climbs as the odds do, and never arrives. */
  depthChance(odds: number): number {
    const o = Math.max(0, odds) * ODDS_Q / (1 - ODDS_Q);
    return o / (1 + o);
  },

  /** How deep a find goes. Before a hub's magic unlock it stops at one lone property (call 13). No last step. */
  rollDepth(rng: SeededRNG, odds: number, pairsOpen: boolean): number {
    const p = this.depthChance(odds);
    let depth = 0;
    while (rng.next() < p) { depth++; if (!pairsOpen) break; }
    return depth;
  },

  /** How many of each side a depth holds: one on either side, then pairs. */
  ladder(depth: number, coin: () => number): [number, number] {
    if (depth <= 0) return [0, 0];
    if (depth === 1) return coin() < 0.5 ? [1, 0] : [0, 1];
    return [depth - 1, depth - 1];
  },

  /**
   * One affix's words. It gives one stat (1.5): the first the writer named that is not a downside. A downside is a
   * price, a smaller band of its own stat taken: the first downside on another stat, lowered under the gift's band
   * when it is not already, and none when the gift is minor. A bank entry with no words is read from its ranges.
   */
  wordsOf(def: Rollable): IAffixWords | undefined {
    const gives = def.gives ?? Object.entries(def.statModifiers ?? {}).map(([stat, [, hi]]) => ({ stat, band: hi < 0 ? 'minor' : 'moderate', downside: hi < 0 }));
    const giftWords = gives.find(g => !g.downside);
    if (!giftWords) return undefined;
    const gift = { stat: oneKey(giftWords.stat), band: (BAND_ORDER.includes(giftWords.band as Band) ? giftWords.band : 'moderate') as Band };
    const priceFound = gives.find(g => g.downside && oneKey(g.stat) !== gift.stat);
    const priceWords = priceFound ? { ...priceFound, stat: oneKey(priceFound.stat) } : undefined;
    const under = BAND_ORDER.indexOf(gift.band) - 1;
    if (!priceWords || under < 0) return { gift };
    const written = BAND_ORDER.indexOf(priceWords.band as Band);
    return { gift, price: { stat: priceWords.stat, band: BAND_ORDER[written >= 0 ? Math.min(written, under) : under] } };
  },

  /** What one affix gives on a piece: band x ruler(stat, the carrier's rank) x (1 + quality), a price added to the gift. */
  affixStats(words: IAffixWords, rank: UniversalRank | string, quality: number, band?: Band): Record<string, number> {
    const giftBand = band ?? words.gift.band;
    const priceBand = words.price && BAND_ORDER.indexOf(words.price.band) < BAND_ORDER.indexOf(giftBand) ? words.price.band : undefined;
    const stats: Record<string, number> = {
      [words.gift.stat]: (BANDS[giftBand] + (priceBand ? BANDS[priceBand] : 0)) * this.ruler(words.gift.stat, rank) * (1 + quality)
    };
    if (words.price && priceBand) stats[words.price.stat] = -BANDS[priceBand] * this.ruler(words.price.stat, rank) * (1 + quality);
    return stats;
  },

  /** The side an affix stands on, by how its one stat is read: an amount before the name, a rating after it. */
  sideOf(words: IAffixWords): 'PREFIX' | 'SUFFIX' {
    return statSide(words.gift.stat);
  },

  /**
   * The word a piece says (call 17): whose it was when it was a body's own, legendary for a boss's and artifact for a
   * titan's or a god's, and otherwise its step by count. Whose it was is not a count; the count still stands beneath.
   */
  wordOf(piece: { affixes: readonly Pick<IAffix, 'type'>[]; whose?: { kind: string } }): Rarity {
    if (piece.whose) return piece.whose.kind === 'boss' ? Rarity.LEGENDARY : Rarity.ARTIFACT;
    return this.stepOf(piece.affixes);
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

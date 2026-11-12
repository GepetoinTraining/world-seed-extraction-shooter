/**
 * WEAR BY THE WORK DONE (Pedro, 2026-11-12: "also, durability, needs to be fixed, breaks too early").
 *
 * A piece lasts three runs of the fighting a run holds at its own rank. A run is the spine's sixteen plain creatures
 * met one at a time (BALANCE_RUN 1.2, call 2), each felled in the whole blows of a plain weapon of the rank at one
 * blow a second. Both a plain creature and a plain weapon double with rank, so a run is the same 48 seconds of
 * fighting at every rank, and takes the same share of a body; reading them from the formula keeps it so if either
 * moves.
 *
 * A blow wears its weapon by the share of a second's work it is (one over the piece's own rate): since the fight's
 * rebalance a quick kind deals the same a second in more, lighter blows, so counting blows broke it sooner. It wears
 * when the blow lets go, landed or not. A hit wears each piece that protects by the share of a body it took, so a ring
 * of eight light shots wears what one heavy blow taking as much does. Every number here is a call, open to strike.
 */

import { CREATURE_COOLDOWN_MS, CREATURE_WINDUP_MS, creatureNumbers, personHealth, rankStep } from './ThemeFormula';
import { PieceLaw } from './PieceLaw';
import type { IItem } from '../../types';
import type { ThemeRank } from './ThemeTypes';

/** The spine's run: sixteen plain creatures met one at a time (BALANCE_RUN 1.2, call 2). */
export const RUN_PLAIN_CREATURES = 16;
/** How many runs of fighting a piece lasts before it needs a repair (the coordinator's call). */
export const RUNS_A_PIECE_LASTS = 3;

const plainCreature = (rank: string) => creatureNumbers({ rank: rank as ThemeRank, build: 'sturdy', threat: 'sharp', pace: 'steady', size: 'MEDIUM' });

/** Seconds to fell one plain creature of the rank: the whole blows of a plain weapon of the rank, one a second. */
const fellSeconds = (rank: string): number =>
  Math.ceil(plainCreature(rank).baseHealth / PieceLaw.blowOf(PieceLaw.power(rank, 0, false)));

/** The seconds of fighting a run holds at a rank. */
export const runFightSeconds = (rank: string): number => RUN_PLAIN_CREATURES * fellSeconds(rank);

/** The share of a body of the rank (at its floor) a run's fighting takes before armour: what sixteen plain creatures land while each is felled. */
export const runBodyShare = (rank: string): number => {
  const p = plainCreature(rank);
  const perSecond = p.baseDamage / ((CREATURE_COOLDOWN_MS + CREATURE_WINDUP_MS) / 1000);
  return (RUN_PLAIN_CREATURES * fellSeconds(rank) * perSecond) / personHealth(rank, 1 + Math.max(0, rankStep(rank as ThemeRank)));
};

/** What one blow takes from its weapon: the share of a second's work it is, at the wear a second that spends the piece in three runs. */
export const blowWear = (maxDurability: number, ownRate: number, rank: string): number =>
  maxDurability / (RUNS_A_PIECE_LASTS * runFightSeconds(rank)) / Math.max(0.1, ownRate);

/** What one hit takes from a piece that protects: the share of a body it took, at the wear that spends the piece in three runs of a run's hits. */
export const hitWear = (maxDurability: number, bodyShare: number, rank: string): number =>
  (maxDurability * Math.max(0, bodyShare)) / (RUNS_A_PIECE_LASTS * runBodyShare(rank));

/**
 * What a try that fails takes from its tool (ML, the coordinator's call on Pedro's "a failure damages"): what felling one
 * plain creature takes from a weapon, a run's share of a piece's life, the same at every rank.
 */
export const slipWear = (maxDurability: number): number => maxDurability / (RUNS_A_PIECE_LASTS * RUN_PLAIN_CREATURES);

/** The lines protection and the rolls before it read: a piece carrying one takes the blows, and wears by them. */
const PROTECTION_LINES = ['defense', 'physical_reduction', 'evasion_rating', 'block_chance'] as const;
export const protects = (item: Pick<IItem, 'stats'>): boolean =>
  PROTECTION_LINES.some(stat => ((item.stats as Record<string, number> | undefined)?.[stat] ?? 0) > 0);

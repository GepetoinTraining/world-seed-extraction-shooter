/**
 * THE DECISION LAYER (D103): how many things anyone who is not a human player decides, and when.
 *
 * Pedro: "a leader is also deterministic because the decision layer follows cadence. the LLM call
 * for the leaders all happen on weekly interval, the higher their mental stats the more decisions
 * they get". Asked how: "make them correlate ... the rule will stand later for anything non human
 * player". So it reads any sheet, and nothing here knows what a leader is.
 *
 * The number is the mean of the mental attributes on the sheet, rounded down, and never under one.
 * It has no ceiling, and rank raises it without being asked, because rank raises the stats.
 *
 * A week is real days, however long a world's cycle runs (D103). So what falls due in a cycle is the
 * week's share of it, kept by a running count: a three-hour cycle mostly decides nothing, and a
 * fortnight's cycle decides two weeks' worth at once. A key offsets the count, so leaders with one
 * sheet do not all act on the same cycle. Pure, and it reads no clock: a cycle's place in time is
 * its number times its length, which the world's certificate signed.
 */

import { IAttributes, MENTAL_ATTRIBUTES } from '../../../types';
import { fnv1a } from '../rng/DeterministicRNG';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class DecisionLayer {

  /** How many decisions this sheet makes in a week. */
  static perWeek(stats: IAttributes): number {
    const sheet = stats as unknown as Record<string, number>;
    const total = MENTAL_ATTRIBUTES.reduce((sum, a) => sum + (sheet[a] ?? 0), 0);
    return Math.max(1, Math.floor(total / MENTAL_ATTRIBUTES.length));
  }

  /** Which week a cycle falls in, from the world's first. What a weekly plan is keyed by. */
  static weekOf(generation: number, cycleMs: number): number {
    return Math.floor((generation * cycleMs) / WEEK_MS);
  }

  /** How many of its decisions fall due in this cycle. Over any run of cycles they add up to the week's. */
  static dueAt(stats: IAttributes, generation: number, cycleMs: number, key: string): number {
    const perWeek = this.perWeek(stats);
    const offset = fnv1a(`cadence:${key}`) / 0x100000000;
    const count = (g: number) => Math.floor((g * cycleMs * perWeek) / WEEK_MS + offset);
    return count(generation + 1) - count(generation);
  }
}

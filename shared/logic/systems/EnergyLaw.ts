/**
 * THE DAY'S WORK (EN). Pedro, 2026-11-12, after playing on main: "we need to separate the energy consumption, right now
 * energy is bonkers, it's using way too much, and no level of skill gets it down."
 *
 * Energy is the day's budget for work: a try at a place, a sitting, a round of talk, a chest opened, a snare set, two
 * things worked together, a gift, someone secured to come along. A weapon's own blow takes none of it, a focus's cast
 * included, as a bow's shot took none (EN5). Every place that spends energy on work asks this law, and no place keeps a
 * number of its own (EN6).
 *
 * What an act costs is its weight, as main had it, against one plain day (EN1): the weights stand in the proportions
 * main gave them, and the day they are counted against is set by measure, so that a plain run's work at rank F with no
 * skill (counted in the hidden window: `PLAIN_RUN`) is one rested day of a plain body. A try's weight is the place's own
 * ask, which the formula sets by its verb and rank (`harvestNumbers`).
 *
 * The skill that does the act brings it down: a rank's worth of that skill halves it, the same doubling a rank the
 * bodies and the pieces follow (`bodyScale`, `PieceLaw`), with no floor and no top (EN7). A rank's worth of a skill is as
 * many levels as the roll a try or a sitting makes gives for one rank of what it faces: fifteen a rank against five a
 * level, so three. An act that has a skill, done with none of it, costs half again, as it did.
 *
 * A cost is kept as the game says a number (`said`): whole from ten up, to one place under it, so what is shown is what
 * is spent. Pure: no store, no clock.
 */

import type { ISkillState } from '../../types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { harvestNumbers } from '../theme/ThemeFormula';
import { LORE_ROLL_PER_POINT, LORE_ROLL_PER_RANK } from './LoreConstants';
import { BASE_ENERGY } from './StatSystem';

export type WorkAct = 'try' | 'sitting' | 'round' | 'open' | 'snare' | 'make' | 'gift' | 'secure' | 'analyze';

/**
 * Each act's weight as main had it, in its proportions to the others: a sitting 10 (`IDENTIFY_ENERGY`), a round of talk
 * 5 (`TALK_ENERGY`, a name or a want asked and a bargain the same), a chest or a cache opened 2, a snare 3
 * (`Capture.SNARE_ENERGY`), two things worked together 5 (`PAIR_ENERGY`), a gift 2, someone secured 5, Analyze Structure
 * 2 as its menu said. A try's weight is its place's ask.
 */
const WEIGHT: Record<Exclude<WorkAct, 'try'>, number> = { sitting: 10, round: 5, open: 2, snare: 3, make: 5, gift: 2, secure: 5, analyze: 2 };

/** An act that has a skill, done by a hand with none of it, costs half again, as it did on main (D27, D32). */
export const UNSKILLED = 1.5;

/** A rank's worth of a skill: the levels a try's or a sitting's roll counts for one rank of what it faces. */
export const LEVELS_A_RANK = LORE_ROLL_PER_RANK / LORE_ROLL_PER_POINT;

/**
 * A plain run's work at rank F, counted in the hidden window on main (EN1). From the drop to the beacon, 186 tiles, the
 * pack of either kit was full after 19 tries (the tools kit's all with its hatchet, the heavier); the run passes 2 chests
 * and 1 person, turned on good words in about seven rounds (BALANCE_RUN 2.8) after their name is asked, then secured;
 * and the day asks 2 sittings at home (BALANCE_RUN 3.8's modelled day).
 */
export const PLAIN_RUN = { tries: 19, chests: 2, asks: 8, secured: 1, sittings: 2 } as const;

/** What a plain run's work weighs, done with no skill of any of it. */
const RUN_WEIGHT = UNSKILLED * (
  PLAIN_RUN.tries * harvestNumbers('tool', 'F').energyCost
  + PLAIN_RUN.chests * WEIGHT.open
  + PLAIN_RUN.asks * WEIGHT.round
  + PLAIN_RUN.secured * WEIGHT.secure
  + PLAIN_RUN.sittings * WEIGHT.sitting
);

/** One unit of weight in a plain day's energy: a plain run's work is one day of a plain body (EN1). */
const PER_WEIGHT = BASE_ENERGY / RUN_WEIGHT;

export const EnergyLaw = {
  /** What is left of a cost for this many levels of the skill that does it: a rank's worth halves it, and it never stops. */
  share(levels: number): number {
    return Math.pow(2, -Math.max(0, levels) / LEVELS_A_RANK);
  },

  /**
   * The levels a skill brings to the act it does: its levels past the first, each worth what a level of its rarity is
   * worth (Pedro: a rarer skill has "a large impact per level"). None held: null, which costs half again.
   */
  levelsOf(skill: Pick<ISkillState, 'level' | 'rank' | 'bornRank'> | undefined): number | null {
    if (!skill) return null;
    return Math.max(0, skill.level - 1) * ProgressionSystem.skillImpactFactor(ProgressionSystem.skillRarity(skill));
  },

  /**
   * The cost before it is said. `levels`: what brings it down (`levelsOf`); null where the act has a skill and the hand
   * holds none of it; undefined where no skill does it. `weight`: a try's is its place's ask; any other act's is its
   * own. `winged`: done untrained, though something known still brings it down, as a sitting with no eye schooled is
   * winged and still cheaper for what is known of its tree.
   */
  raw(act: WorkAct, levels: number | null | undefined, weight?: number, winged = false): number {
    const own = act === 'try' ? weight ?? harvestNumbers('tool', 'F').energyCost : WEIGHT[act];
    return own * PER_WEIGHT * (levels === null || winged ? UNSKILLED : 1) * this.share(levels ?? 0);
  },

  /** What an act costs, as it is said and spent. */
  cost(act: WorkAct, levels: number | null | undefined, weight?: number, winged = false): number {
    return this.said(this.raw(act, levels, weight, winged));
  },

  /** As the game says a number: whole from ten up, to one place under it. */
  said(n: number): number {
    return Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  }
};

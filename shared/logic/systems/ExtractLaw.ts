/**
 * THE TRY (ML). Pedro, 2026-11-12: "the right click studies or inspects or tries to use the tool, rank + rarity give
 * the roll, on success you can extract". And earlier, of what a tool is: "the tool is a hand held workbench, and it's the
 * basis of everything".
 *
 * A try is one roll of a hundred, on the scale a sitting reads (`LoreLaw`), against the bar the material's rank and
 * rarity set (`extractBar`), measured from the rank of the hand that tries it. What the hand brings, read from what the
 * code already keeps, each point five along the roll as a sitting's are:
 *   - its tool: the one carried that fits the place, the best by rank and then by how well it was made; its rank sets
 *     where the bar is measured from, and how well it was made moves the roll a point for each band above standard
 *     (a crude tool two points back, a superior one two forward). Where the place asks for no tool, the bare hand is
 *     the person's own rank and brings no band;
 *   - the skill: the level held of that tool on that material (the pair the web already mints from a harvest);
 *   - the eye: what the person knows of the material, from nothing (unknown) to its affixes.
 * A misread is a major failure, as a sitting's is. Pedro, the same day: "once something exists it's determined, and the
 * skill always gives the same thing". So the roll decides only whether the material comes away (a deep reading is a
 * success like any other), and what a success gives is `yieldOf`: the material and the hand's skill, by one rule, with
 * no dice in it. Pure: no store, no clock.
 */

import { IItem, IPlayer, ISkillState, StudyOutcome, UniversalRank } from '../../types';
import type { ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { qualityBand } from '../../render/atoms/atoms';
import { extractBar } from '../theme/ThemeFormula';
import { Rng } from '../rng/DeterministicRNG';
import { LORE_FAIR_LINE, LORE_ROLL_PER_POINT } from './LoreConstants';
import { LoreLaw } from './LoreLaw';
import { ISkillPair, WebSystem } from './WebSystem';

/** The band a tool of no particular making stands at, as the quality law names them. */
const STANDARD_BAND = 2;
const RANK_ORDER = Object.values(UniversalRank);

/**
 * GV41: how a hand stands, as the card says it. D32 ruled the odds are never shown, so the chance is said in plain steps,
 * the least chance each step starts at, from none to every time. Words only; the steps are the coordinator's (GV41).
 */
export const ODDS_STEPS: { least: number; words: string }[] = [
  { least: 0, words: 'never' },
  { least: 1, words: 'hardly ever' },
  { least: 10, words: 'now and then' },
  { least: 35, words: 'about half the time' },
  { least: 65, words: 'more often than not' },
  { least: 90, words: 'nearly every time' },
  { least: 100, words: 'every time' }
];

export interface IHand {
  /** The tool tried with; absent, a bare hand. */
  tool?: IItem;
  rank: UniversalRank;
  /** How well the tool was made, on the quality law's five bands; a bare hand stands at standard. */
  band: number;
  /** The level held of this tool on this material. */
  skill: number;
  /** What the person knows of the material, 0 to 3. */
  eye: number;
  pair: ISkillPair | null;
}

export interface ITry { d100: number; total: number; bar: number; outcome: StudyOutcome; hand: IHand }

const fits = (item: IItem, tags: string[]) =>
  tags.some(t => item.toolData?.toolTags.includes(t) || (item.tags ?? []).includes(t) || item.name.toLowerCase().includes(t));

export const ExtractLaw = {
  /** What a place asks of the hand: the tags of a tool, none where a hand will do. */
  asks(def: ResourceDef): string[] {
    return def.harvestConfig?.requiredToolTags ?? [];
  },

  /** The carried tool that fits: the best by rank, then by its making. Undefined where a hand will do; null where none fits. */
  toolFor(carried: IItem[], def: ResourceDef): IItem | undefined | null {
    const asks = this.asks(def);
    if (asks.length === 0) return undefined;
    const fitting = carried.filter(i => fits(i, asks));
    if (fitting.length === 0) return null;
    return fitting.sort((a, b) => RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank) || (b.quality ?? 0) - (a.quality ?? 0))[0];
  },

  /** What this person's hand brings to this place, or null where it asks for a tool nobody carries. */
  hand(player: IPlayer, def: ResourceDef): IHand | null {
    const carried = [...(player.currentSession?.inventory ?? []), ...(player.equipment?.items ?? [])];
    const tool = this.toolFor(carried, def);
    if (tool === null) return null;
    const pair = WebSystem.pairOfHarvest(player, def);
    return {
      ...(tool ? { tool } : {}),
      rank: tool ? tool.rank : ProgressionSystem.rankOf(player),
      band: tool ? qualityBand(tool.quality) : STANDARD_BAND,
      skill: pair ? player.bank?.universalSkills?.[pair.id]?.level ?? 0 : 0,
      eye: WebSystem.knowledgeReader(player)(def.id),
      pair
    };
  },

  /** The points a hand moves the roll by, before each is made five. */
  points(hand: IHand): number {
    return hand.skill + hand.eye + (hand.band - STANDARD_BAND);
  },

  bar(def: ResourceDef, handRank: UniversalRank): number {
    return extractBar(def.rank, def.rarity, handRank);
  },

  /** The try, keyed so a reload rolls nothing new. Null where the hand cannot try at all. */
  roll(player: IPlayer, def: ResourceDef, key: string): ITry | null {
    const hand = this.hand(player, def);
    if (!hand) return null;
    const d100 = Rng.fromKey(`try:${key}`).int(1, 101);
    const total = d100 + this.points(hand) * LORE_ROLL_PER_POINT;
    const bar = this.bar(def, hand.rank);
    return { d100, total, bar, outcome: LoreLaw.outcomeOf(LoreLaw.stretchOf(total - bar + LORE_FAIR_LINE).stretch), hand };
  },

  /**
   * What a success gives (ML18): the least a use of the material gives, a piece more for every rung of mastery of this
   * tool on this material, and that grown by what the skill's levels add up to, the same readers that make the work
   * cheaper (`WebSystem.masteryOf`, `skillPower`), whole pieces only. A hand with no skill of it takes the least.
   */
  yieldOf(def: Pick<ResourceDef, 'yieldPerUse'>, skill: ISkillState | undefined): number {
    const least = Math.max(1, (def.yieldPerUse ?? [1, 1])[0]);
    if (!skill) return least;
    return Math.max(least, Math.floor((least + WebSystem.masteryOf(skill).rung) * (1 + WebSystem.skillPower(skill))));
  },

  /** A chance in a hundred, said as the card says it. */
  oddsSaid(odds: number): string {
    let words = ODDS_STEPS[0].words;
    for (const step of ODDS_STEPS) if (odds >= step.least) words = step.words;
    return words;
  },

  /** How often a hand like this takes the place, in a hundred: said in words on the card once the material is known. */
  oddsOf(hand: IHand, def: ResourceDef): number {
    const need = this.bar(def, hand.rank) - this.points(hand) * LORE_ROLL_PER_POINT;
    return Math.max(0, Math.min(100, 101 - need));
  }
};

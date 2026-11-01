/**
 * THE TALK'S LAW (D113, D116). Pedro: "each round carries with it the user message and the roll,
 * what's required, and haiku judges if it is aligned, gives it a + or - bonus, we roll for it and
 * the meter moves, the tougher the npc the more difficult it is to bring."
 *
 * Pure. A model says a band and the formula here writes what it is worth (D57), and whatever it
 * says stands before the law first. With no key a round has no bonus and still rolls (D35), so
 * a floor answer exists for everything a model would have said. Every number is a guess until
 * Wave 12.
 */

import { IAttributes, UniversalRank } from '../../../types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { Rng } from '../rng/DeterministicRNG';
import { Alignment } from './Alignment';
import { LADDER } from './NpcAgenda';
import { StatSystem } from './StatSystem';
import { HARM_BANDS, IGoalAsk, IGoalWords, IMeans, IRoundWords, JUDGE_BANDS, JudgeBand, PROMISE_BANDS, QUEST_SIZES, QuestSize } from './TalkTypes';

const BONUS_NEAR = 10;
const BONUS_FAR = 25;
/** How much harder each rank is, and each point of will over the rank's floor. */
const REQUIRED_PER_RANK = 8;
const REQUIRED_PER_WILL = 3;
const REQUIRED_FLOOR = 5;
const REQUIRED_CEILING = 95;
/** A round that lands moves the meter this far, and a little further for landing well. */
const MOVE_ON_LANDING = 8;
const MOVE_PER_MARGIN = 0.2;
const FALL_PER_MARGIN = 0.1;
/** A band can never be above this when what was asked is what their alignment refuses. */
const GATED_BAND: JudgeBand = 'grates';

/** What the formula gives a band: symmetric around the middle. */
function bonusOf(band: JudgeBand): number {
  const steps = JUDGE_BANDS.indexOf(band) - JUDGE_BANDS.indexOf('idle');
  return Math.sign(steps) * (Math.abs(steps) === 2 ? BONUS_FAR : Math.abs(steps) * BONUS_NEAR);
}

const inBand = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);
const saysAny = (text: string, names: string[]) => names.some(name => name && text.toLowerCase().includes(name.toLowerCase()));
const validMeans = (means: IMeans | undefined) => !!means && inBand(PROMISE_BANDS, means.promise) && inBand(HARM_BANDS, means.harm);

export interface IRoundVerdict {
  ok: boolean;
  reason?: string;
  band?: JudgeBand;
  /** Their alignment refused what was asked, so the band was held down. */
  gated?: boolean;
  reply?: string;
  wants?: string;
}

export const TalkLaw = {
  bonusOf,

  bonuses(): Record<JudgeBand, number> {
    return Object.fromEntries(JUDGE_BANDS.map(band => [band, bonusOf(band)])) as Record<JudgeBand, number>;
  },

  /** 1 to 100, on the key alone, so a round replays the same. */
  rollOf(key: string): number {
    return Rng.fromKey(key).int(1, 101);
  },

  /** What is against you: their rank, and how much will they have over it. */
  toughness(rank: UniversalRank, stats?: IAttributes): number {
    const index = ProgressionSystem.rankIndex(rank);
    const floor = 1 + index;
    const will = stats ? Math.max(0, stats.intelligence - floor) + Math.max(0, stats.focus - floor) : 0;
    return index * REQUIRED_PER_RANK + will * REQUIRED_PER_WILL;
  },

  /** What a roll and its bonus must reach. Charisma comes off through the one door that already says so. */
  required(want: string | undefined, attributes: IAttributes | undefined, rank: UniversalRank, stats?: IAttributes): number {
    const fromYou = 100 * (1 - StatSystem.talkOdds(want, attributes));
    return Math.round(Math.max(REQUIRED_FLOOR, Math.min(REQUIRED_CEILING, fromYou + this.toughness(rank, stats))));
  },

  /** The round's sums. The meter is the disposition number, and it stays 0 to 100. */
  settle(round: { roll: number; required: number; band: JudgeBand; disposition: number }) {
    const bonus = bonusOf(round.band);
    const total = round.roll + bonus;
    const margin = total - round.required;
    const landed = margin >= 0;
    const delta = landed
      ? Math.round(MOVE_ON_LANDING + margin * MOVE_PER_MARGIN)
      : Math.min(-1, Math.round(margin * FALL_PER_MARGIN));
    return { bonus, total, landed, delta, disposition: Math.max(0, Math.min(100, round.disposition + delta)) };
  },

  judgeRound(words: Partial<IRoundWords> | null | undefined, ctx: { alignment?: string; hidden: string[] }): IRoundVerdict {
    if (!words || !inBand(JUDGE_BANDS, words.band)) return { ok: false, reason: 'It said no band the law knows.' };
    if (!validMeans(words.asked)) return { ok: false, reason: 'It did not say what was asked.' };
    if (typeof words.reply !== 'string' || !words.reply.trim()) return { ok: false, reason: 'It came back with nothing to say.' };
    const wants = typeof words.wants === 'string' ? words.wants.trim() : '';
    if (saysAny(words.reply, ctx.hidden) || saysAny(wants, ctx.hidden)) return { ok: false, reason: 'It said a name that stays masked.' };
    const gated = !!ctx.alignment && !!Alignment.refuses(ctx.alignment, words.asked!);
    const band = gated && JUDGE_BANDS.indexOf(words.band!) > JUDGE_BANDS.indexOf(GATED_BAND) ? GATED_BAND : words.band!;
    return { ok: true, band, gated, reply: words.reply.trim(), wants };
  },

  /** What is said when no model said anything. It describes, and never pretends to be their words. */
  floorReply(landed: boolean, name?: string): string {
    const who = name || 'It';
    return landed ? `${who} hears that out, and something gives a little.` : `${who} hears that out, and nothing gives.`;
  },

  /** People climb, so their goal must answer the rung they stand on. A leader's must be one of its own. */
  judgeGoal(words: Partial<IGoalWords> | null | undefined, ask: IGoalAsk): { ok: boolean; reason?: string; words?: IGoalWords } {
    if (!words || typeof words.goal !== 'string' || !words.goal.trim()) return { ok: false, reason: 'It set no goal.' };
    if (!validMeans(words.means)) return { ok: false, reason: 'It did not say how.' };
    if (ask.binding === 'LADDER' && words.need !== ask.need) return { ok: false, reason: `That answers ${words.need}, and they stand on ${ask.need}.` };
    if (ask.binding === 'FREE' && !ask.choices?.includes(words.goal)) return { ok: false, reason: `${words.goal} is not one of its goals.` };
    const alignment = ask.who.alignment;
    if (alignment) {
      const refused = Alignment.refuses(alignment, words.means!);
      if (refused) return { ok: false, reason: refused };
    }
    const building = typeof words.building === 'string' ? words.building : '';
    if (building && !ask.buildings.includes(building)) return { ok: false, reason: `Nobody here can raise ${building}.` };
    const quest = words.quest ?? null;
    if (quest) {
      if (!ask.questTags.includes(quest.tag)) return { ok: false, reason: `${quest.tag} is no word the hub knows.` };
      if (!inBand(QUEST_SIZES, quest.size)) return { ok: false, reason: 'A quest says small, fair or large.' };
      if (typeof quest.text !== 'string' || !quest.text.trim()) return { ok: false, reason: 'A quest says what it wants.' };
      if (/\d/.test(quest.text)) return { ok: false, reason: 'A quest writes no numbers: the formula does.' };
    }
    return {
      ok: true,
      words: {
        need: ask.binding === 'LADDER' ? ask.need! : words.need ?? 'purpose',
        goal: words.goal.trim(), means: words.means!,
        // Someone with one already open has been heard. The rest of the goal stands.
        building: ask.mayAsk === false ? '' : building,
        quest: ask.mayPost === false ? null : quest
      }
    };
  },

  /** The goal with no model: what the rung says, or what the leader was dealt. It asks nothing of anyone. */
  floorGoal(ask: IGoalAsk): IGoalWords {
    const quiet = { means: { promise: 'keeps', harm: 'none' } as IMeans, building: '', quest: null };
    if (ask.binding === 'FREE') return { need: 'purpose', goal: ask.dealt ?? ask.choices?.[0] ?? '', ...quiet };
    const rung = LADDER.find(r => r.need === ask.need) ?? LADDER[0];
    return { need: rung.need, goal: `Working toward ${rung.says}.`, ...quiet };
  },

  /** A quest's size in things, by the formula. A tougher person asks for more. */
  questCount(size: QuestSize, rank: UniversalRank): number {
    return 1 + QUEST_SIZES.indexOf(size) * 2 + ProgressionSystem.rankIndex(rank);
  },

  /**
   * THE WEEKLY CALL'S SEAM (D103, D116: a leader's weekly call waits on this hook). The same ask
   * and the same law, with no ladder, because leaders keep the goal D93 deals them and can change
   * it. It has no caller yet: how often, and how mental stats become a number of decisions, are
   * C4's to ask.
   */
  leaderAsk(sheet: { temperament: string; drive?: string; goal: string }, choices: string[]): IGoalAsk {
    return { binding: 'FREE', who: { temperament: sheet.temperament, drive: sheet.drive }, log: [], choices, dealt: sheet.goal, buildings: [], questTags: [] };
  }
};

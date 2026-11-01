/**
 * THE APPRENTICE ROAD. Pedro, 2026-11-01: the general vendors "will train up the NPCs
 * that have no crafting skill and are weak, the ones that are randomly badly generated."
 *
 * The donor's road, engine/craftsman.ts: untrained, apprentice, journeyman, master. Its
 * formula for progress and its masterwork trial are kept. Its trades and recipes are not:
 * a trade here is a word on the technology web, and the skill is an ordinary web record.
 * Its limit of three is not kept either: a master's room comes from their leadership.
 * Its migration and guild formation wait for there being more than one place to go.
 *
 * Pure. Days are folded one at a time, so being away reaches the same person as watching.
 * The one roll is keyed. Numbers are guesses until Wave 12.
 */

import { IAttributes, IItem, ISkillState, IWebPack, PHYSICAL_ATTRIBUTES } from '../../../types';
import { INpcSheet } from '../../entities/world/types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { Rng } from '../rng/DeterministicRNG';
import { TagLaw } from '../content/TagLaw';
import { WebBank } from '../content/WebBank';
import { INeedFill, INpcAgenda, NpcAgenda } from './NpcAgenda';
import { NpcSheet } from './NpcSheet';
import { WebSystem } from './WebSystem';

export type CraftRank = 'APPRENTICE' | 'JOURNEYMAN' | 'MASTER';

export interface ICraftsman {
  id: string;
  name: string;
  /** The bond that brought them out. Their sheet reads back from this, and nothing else. */
  bond: NonNullable<IItem['bondData']>;
  sponsorId: string;
  /** Who they answer to: a general vendor, or a person who became a master. */
  masterId: string;
  trade: string;
  rank: CraftRank;
  /** Toward the exam, 0 to 100. */
  progress: number;
  skill: ISkillState;
  /** What the deal gave their mind, the donor's INT modifier. */
  intModifier: number;
  startedDay: number;
  /** The last day this person was folded to. */
  day: number;
  /** How many masterwork trials, which keys the next. */
  trials: number;
  agenda: INpcAgenda;
}

export interface IMasterSeat {
  id: string;
  trade: string;
  room: number;
  taken: number;
}

export interface IRoadEvent {
  id: string;
  name: string;
  to: CraftRank;
  day: number;
}

/** The 7 day world (D92): a term is one of them. A guess until Wave 12. */
export const TERM_DAYS = 7;
export const TRIAL_DC = 18;
const TRIAL_MIN_LEVEL = 3;
/** Graded by two terms, whoever they are: read from the rung, so a new table moves it too. */
const TERMS_TO_GRADED = 2;
const GRADED_RUNG = 2;
const MAX_HOURS = 1.5;
const WORK_FILL: INeedFill = { survival: 8, safety: 2, belonging: 3 };
const PROMOTION_FILL: INeedFill = { esteem: 30 };
const LABOR: Record<CraftRank, number> = { APPRENTICE: 0, JOURNEYMAN: 1, MASTER: 2 };
const LEADERSHIP_PER_SEAT = 2;

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);

export const ApprenticeRoad = {
  /** A skill that names a trade, or opens a bench. A bare hand on a tree is not a craft. */
  hasCraft(sheet: INpcSheet, pack: IWebPack): boolean {
    const held = WebSystem.heldSkills(sheet.skills ?? {});
    if (held.some(s => s.tags.some(t => WebBank.hasKind(pack, t, ['trade'])))) return true;
    return WebSystem.openStations(sheet.skills ?? {}, pack).length > 0;
  },

  /**
   * Every nature of one rank totals the same, so weak is the shape of the deal: a body
   * under the person's own average.
   */
  isWeak(stats: IAttributes): boolean {
    const body = PHYSICAL_ATTRIBUTES.map(a => stats[a]);
    return mean(body) < mean(Object.values(stats) as number[]);
  },

  /** Would a general vendor take this person? `ok` means yes. */
  unfit(bond: IItem, pack: IWebPack): { ok: boolean; reason?: string } {
    const sheet = bond.bondData ? NpcSheet.fromBond(bond) : null;
    if (!sheet?.stats) return { ok: false, reason: 'That is not anybody.' };
    if (this.hasCraft(sheet, pack)) return { ok: false, reason: `${sheet.name} already knows a trade. They do not need me.` };
    if (!this.isWeak(sheet.stats)) return { ok: false, reason: `${sheet.name} is strong enough to make their own way. I take the ones nobody else will.` };
    return { ok: true };
  },

  /** How many a master can keep at the bench. */
  roomFor(attributes: Pick<IAttributes, 'leadership'>): number {
    return 1 + Math.floor(Math.max(0, attributes.leadership - 1) / LEADERSHIP_PER_SEAT);
  },

  begin(bond: IItem, master: IMasterSeat, sponsorId: string, today: number, pack: IWebPack): { ok: boolean; reason?: string; craftsman?: ICraftsman } {
    const verdict = this.unfit(bond, pack);
    if (!verdict.ok) return verdict;
    if (master.taken >= master.room) return { ok: false, reason: `There is no room at this bench: ${master.taken} of ${master.room} already.` };
    const sheet = NpcSheet.fromBond(bond)!;
    const tags = [master.trade];
    const rank = ProgressionSystem.rankIndex(bond.bondData!.rank);
    return {
      ok: true,
      craftsman: {
        id: `crf_${bond.bondData!.worldSeed}_${bond.bondData!.entityId}`,
        name: sheet.name, bond: bond.bondData!, sponsorId, masterId: master.id, trade: master.trade,
        rank: 'APPRENTICE', progress: 0,
        skill: WebSystem.freshSkill(TagLaw.skillIdOf(tags), tags, rank),
        // What the deal gave them over the bottom of their rank, less the one that starts it at nothing
        intModifier: sheet.stats!.intelligence - 1 - rank - 1,
        startedDay: today, day: today, trials: 0,
        agenda: NpcAgenda.fresh(today)
      }
    };
  },

  levelOf(craftsman: Pick<ICraftsman, 'skill'>): number {
    return WebSystem.masteryOf(craftsman.skill).rung + 1;
  },

  trialTotal(d20: number, level: number, intModifier: number): number {
    return d20 + level + intModifier;
  },

  /** One day at the bench. Exactly the donor's progress, with its months as these days. */
  day(c: ICraftsman, day: number, hours: number): { craftsman: ICraftsman; event?: IRoadEvent } {
    let agenda = NpcAgenda.fold(c.agenda, day, WORK_FILL);
    if (c.rank === 'MASTER') return { craftsman: { ...c, day, agenda } };

    const rarity = ProgressionSystem.skillRarity(c.skill);
    const dailyXp = WebSystem.rungXp(GRADED_RUNG, rarity) / (TERM_DAYS * TERMS_TO_GRADED);
    const skill = WebSystem.withCumulativeXp(c.skill, WebSystem.cumulativeXp(c.skill) + dailyXp);
    let next: ICraftsman = { ...c, day, agenda, skill };
    const named = (to: CraftRank): IRoadEvent => ({ id: c.id, name: c.name, to, day });

    if (c.rank === 'APPRENTICE') {
      const skillMod = 1 + (this.levelOf(next) - 1) * 0.1;
      const intMod = 1 + c.intModifier * 0.05;
      const gained = (100 / TERM_DAYS) * skillMod * intMod * Math.min(MAX_HOURS, hours);
      const progress = Math.min(100, c.progress + gained);
      next = { ...next, progress };
      if (progress < 100) return { craftsman: next };
      agenda = NpcAgenda.fill(agenda, PROMOTION_FILL);
      return { craftsman: { ...next, rank: 'JOURNEYMAN', agenda }, event: named('JOURNEYMAN') };
    }

    // A journeyman goes for the masterwork when a name is what they want most
    if (this.levelOf(next) < TRIAL_MIN_LEVEL || NpcAgenda.pressing(agenda) !== 'esteem') return { craftsman: next };
    const d20 = Rng.fromKey(`road:trial:${c.id}:${c.trials}`).int(1, 21);
    const trials = c.trials + 1;
    if (this.trialTotal(d20, this.levelOf(next), c.intModifier) < TRIAL_DC) return { craftsman: { ...next, trials } };
    return { craftsman: { ...next, trials, rank: 'MASTER', agenda: NpcAgenda.fill(agenda, PROMOTION_FILL) }, event: named('MASTER') };
  },

  /** Every day up to today, in turn. `hoursFor` reads the master's goal. */
  resolve(craftsman: ICraftsman, today: number, hoursFor: () => number): { craftsman: ICraftsman; events: IRoadEvent[] } {
    const events: IRoadEvent[] = [];
    let current = craftsman;
    for (let d = craftsman.day + 1; d <= today; d++) {
      const stepped = this.day(current, d, hoursFor());
      current = stepped.craftsman;
      if (stepped.event) events.push(stepped.event);
    }
    return { craftsman: current, events };
  },

  canTeach(craftsman: Pick<ICraftsman, 'rank'>): boolean {
    return craftsman.rank === 'MASTER';
  },

  /** What everyone this master raised adds to each line of its shelf. */
  labor(craftsmen: ICraftsman[], masterId: string): number {
    return craftsmen.filter(c => c.masterId === masterId).reduce((sum, c) => sum + LABOR[c.rank], 0);
  }
};

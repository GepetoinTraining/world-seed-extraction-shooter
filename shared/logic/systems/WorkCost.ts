/**
 * WHICH SKILL DOES EACH ACT (EN8). The day's work costs what `EnergyLaw` says, brought down by the skill that does the
 * act. That skill is the one the act itself trains, read from the same words its door trains it by, so what makes a
 * thing cheaper is what doing it grows:
 *   - a round of talk, a name or a want asked, a bargain: the talk's door trains `social, charisma` (Persuasion);
 *   - a chest or a cache opened: `scavenging, intel`; a gift: `social, trade`; someone secured: `social, rescue, charisma`
 *     (the store's `processAction`);
 *   - a snare: what a snare practises, `trapping` (`FieldCapture`);
 *   - Analyze Structure: the skill it pays toward (`skill_analysis`);
 *   - two things worked together: what the hands know of the two things' tree, as a sitting reads it, so the price says
 *     nothing of whether they make something (the making is a secret until a rest).
 * A try's skill is the tool on the material (`WebSystem.energyFor`); a sitting's is what the person knows of the thing's
 * tree, and the eye says only whether it is winged (`StudySystem`). Pure.
 */

import type { IItem, IPlayer } from '../../types';
import { TagLaw } from '../content/TagLaw';
import { WebBank } from '../content/WebBank';
import { EnergyLaw, WorkAct } from './EnergyLaw';
import { ISkillPair, WebSystem } from './WebSystem';

/** What the store's door trains for each act, as `SkillDiscovery.identify` reads an action's words. */
const TRAINS: Partial<Record<WorkAct, string[]>> = {
  round: ['social', 'charisma'],
  open: ['scavenging', 'intel'],
  gift: ['social', 'trade'],
  secure: ['social', 'rescue', 'charisma']
};

export const WorkCost = {
  /** The skill an act trains, as a pair; null where nothing identifies one. A try's, a sitting's and a making's are read elsewhere. */
  pairOf(act: WorkAct): ISkillPair | null {
    if (act === 'snare') return WebSystem.mint(['trapping'], []);
    if (act === 'analyze') return { id: 'skill_analysis', tags: ['analysis'] };
    const words = TRAINS[act];
    if (!words) return null;
    const pack = WebBank.current();
    const tags = TagLaw.canonical(words.filter(t => WebBank.isIdentityTag(pack, t)));
    return tags.length > 0 ? { id: TagLaw.skillIdOf(tags), tags } : null;
  },

  /** What this person pays for an act that is not a try, a sitting or a making. */
  of(player: IPlayer, act: WorkAct): number {
    const pair = this.pairOf(act);
    return EnergyLaw.cost(act, pair ? EnergyLaw.levelsOf(player.bank?.universalSkills?.[pair.id]) : undefined);
  },

  /** Two things worked together: what the hands know of the two things' tree. Nothing known, its base. */
  make(player: IPlayer, a: Pick<IItem, 'tags'>, b: Pick<IItem, 'tags'>): number {
    return EnergyLaw.cost('make', WebSystem.treeKnowledge(player.bank?.universalSkills ?? {}, [...(a.tags ?? []), ...(b.tags ?? [])]));
  }
};

/**
 * WHAT MAKES WORK CHEAPER, SAID (EN, the coordinator's call 5). The large sheet says, as a fixed fact, what brings each
 * act of work's energy down, and what it costs this person now where that does not hang on the thing worked. Words
 * only: no line says how a number is made, and a skill is said by its name (`SkillNames`).
 *
 * UXS, 2026-11-12: numbers first. A line is its word and its energy; what brings it down is its description, opened behind
 * it, and it opens for someone holding the skill the act trains (`WorkCost.pairOf`, the very skill its price reads). A line
 * whose cost hangs on the thing worked roots in no one skill: a gap (`DescriptionLaw`).
 */

import type { IPlayer } from '../../../shared/types';
import { WorkCost } from '../../../shared/logic/systems/WorkCost';
import type { WorkAct } from '../../../shared/logic/systems/EnergyLaw';
import { DescriptionLaw, DescriptionRoot } from '../../../shared/logic/systems/DescriptionLaw';
import { SkillNames } from './SkillNames';
import { said } from './SheetWords';

export interface IWorkLine { word: string; value: string; says: string; root: DescriptionRoot }

/** The day, in one line: what it is spent on, what spends none of it, and what brings the work down. */
export const WORK_DAY = 'Energy is spent on work and study, and comes back when you rest. A blow takes none of it. Each level of the skill that does a piece of work makes it cheaper; untrained, it costs more.';

/** What a line whose cost hangs on the thing worked shows where a number would stand. */
const BY_THE_THING = 'varies';

export const WorkSay = {
  lines(player: IPlayer): IWorkLine[] {
    const by = (act: WorkAct) => {
      const pair = WorkCost.pairOf(act);
      return pair ? `${SkillNames.nameOf(pair.id)} brings it down.` : 'Doing it brings it down.';
    };
    const root = (act: WorkAct): DescriptionRoot => {
      const pair = WorkCost.pairOf(act);
      return pair ? DescriptionLaw.itself(pair.id) : DescriptionLaw.GAP;
    };
    const now = (act: WorkAct) => `${said(WorkCost.of(player, act))} energy`;
    const gap = DescriptionLaw.GAP;
    return [
      { word: 'A TRY AT A PLACE', value: BY_THE_THING, says: 'Your skill with that tool on that material brings it down.', root: gap },
      { word: 'A SITTING', value: BY_THE_THING, says: 'What your skills know of that kind of thing brings it down.', root: gap },
      { word: 'TWO THINGS WORKED TOGETHER', value: BY_THE_THING, says: 'What your skills know of the two brings it down.', root: gap },
      { word: 'A ROUND OF TALK', value: now('round'), says: `${by('round')} Asking a name or a want costs the same.`, root: root('round') },
      { word: 'OPENING A CHEST', value: now('open'), says: by('open'), root: root('open') },
      { word: 'A SNARE', value: now('snare'), says: by('snare'), root: root('snare') },
      { word: 'A GIFT', value: now('gift'), says: by('gift'), root: root('gift') },
      { word: 'BRINGING SOMEONE ALONG', value: now('secure'), says: by('secure'), root: root('secure') },
      { word: 'ANALYZING A STRUCTURE', value: now('analyze'), says: by('analyze'), root: root('analyze') }
    ];
  }
};

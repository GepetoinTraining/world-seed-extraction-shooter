/**
 * WHAT MAKES WORK CHEAPER, SAID (EN, the coordinator's call 5). The large sheet says, as a fixed fact, what brings each
 * act of work's energy down, and what it costs this person now where that does not hang on the thing worked. Words
 * only: no line says how a number is made, and a skill is said by its name (`SkillNames`).
 */

import type { IPlayer } from '../../../shared/types';
import { WorkCost } from '../../../shared/logic/systems/WorkCost';
import type { WorkAct } from '../../../shared/logic/systems/EnergyLaw';
import { SkillNames } from './SkillNames';
import { said } from './SheetWords';

export interface IWorkLine { word: string; value: string; says: string }

/** The day, in one line: what it is spent on, what spends none of it, and what brings the work down. */
export const WORK_DAY = 'Energy is spent on work and study, and comes back when you rest. A blow takes none of it. Each level of the skill that does a piece of work makes it cheaper; untrained, it costs more.';

export const WorkSay = {
  lines(player: IPlayer): IWorkLine[] {
    const by = (act: WorkAct) => {
      const pair = WorkCost.pairOf(act);
      return pair ? `${SkillNames.nameOf(pair.id)} brings it down.` : 'Doing it brings it down.';
    };
    const now = (act: WorkAct) => `${said(WorkCost.of(player, act))} energy`;
    return [
      { word: 'A TRY AT A PLACE', value: '', says: 'Your skill with that tool on that material brings it down.' },
      { word: 'A SITTING', value: '', says: 'What your skills know of that kind of thing brings it down.' },
      { word: 'TWO THINGS WORKED TOGETHER', value: '', says: 'What your skills know of the two brings it down.' },
      { word: 'A ROUND OF TALK', value: now('round'), says: `${by('round')} Asking a name or a want costs the same.` },
      { word: 'OPENING A CHEST', value: now('open'), says: by('open') },
      { word: 'A SNARE', value: now('snare'), says: by('snare') },
      { word: 'A GIFT', value: now('gift'), says: by('gift') },
      { word: 'BRINGING SOMEONE ALONG', value: now('secure'), says: by('secure') },
      { word: 'ANALYZING A STRUCTURE', value: now('analyze'), says: by('analyze') }
    ];
  }
};

/**
 * A sitting landing, pure (lifted out of StudyDoor.finish so a hand and a stack land a sitting through one function). What
 * it cost was paid when it began. The roll lands, the thing is worn or lost, a document that paid is spent, a piece's
 * designs and a written skill go toward the hands, and what it pays waits for a dream. The eye for the piece's kind grows
 * as a change the door applies (by hand, through the player store's own doors) or `eyeGrown` applies (in a stack).
 */

import { IItem, IPlayer, IStudySitting, IStudyTarget } from '../../../shared/types';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { IHubTree, WebSystem, rankIndexOf } from '../../../shared/logic/systems/WebSystem';
import { LoreSystem } from './LoreSystem';
import { LorePiece } from './LorePiece';
import { RestSystem } from './RestSystem';
import { StudySystem } from './StudySystem';

/** What a sitting teaches the eye for the piece's kind, and how much. */
export const EYE_XP_PER_SITTING = 15;

export type IEyeChange = { kind: 'GAIN'; skillId: string } | { kind: 'ACCRUE'; skillId: string; tag: string } | null;

export interface ILanding {
  player: IPlayer;
  sitting: IStudySitting;
  piece?: IItem;
  /** The piece was a document that paid, and is spent. */
  spent: boolean;
  /** An unread piece the eye could not make out. */
  unread: boolean;
  eye: IEyeChange;
}

export const StudyLanding = {
  /** Null when the piece sat with is no longer held: what was paid is gone. */
  land(before: IPlayer, target: IStudyTarget, cost: number, now: number, hub?: IHubTree): ILanding | null {
    const piece = target.kind === 'item' ? StudySystem.heldItem(before, target.ref) : undefined;
    if (target.kind === 'item' && !piece) return null;
    // The lore pass: the roll fixes what it pays, filed by the hub's web; a dream lands it
    const { player, sitting } = StudySystem.sit(before, target, cost, now, hub);
    let next = player;
    if (LoreSystem.gives(sitting)) next = RestSystem.queueSitting(next, sitting);
    let unread = false;
    if (piece && sitting.outcome !== 'major_failure') {
      // D50 still holds: looking gets there. Q27: an unread piece gets there only through the eye for its kind.
      const reads = StudySystem.canRead(before, piece);
      if (reads && (piece.isIdentified === false || piece.affixes.some(a => !LoadoutSystem.isAffixStudied(next, a.id)))) next = RestSystem.queueStudy(next, piece.id);
      unread = !reads;
      // D27: loot teaches. What the piece implies accrues, and settles only at a rest.
      if (!target.hidden && LoreSystem.pays(sitting.outcome)) {
        for (const d of WebSystem.reverseEngineer(piece).designs) {
          if (!next.bank.universalSkills[d.skillId]) next = WebSystem.accrueFromStudy(next, { id: d.skillId, tags: d.tags }, rankIndexOf(piece.rank));
        }
        // The design pass, part 3: a skill written out makes the skill it carries ready to settle, for its price in lore
        next = LorePiece.read(next, piece);
      }
    }
    // A reading that gives its whole worth (fair or better) has given what it held; a little one leaves it, the worse (H11)
    const spent = !!piece && StudySystem.isDocument(piece) && LoreSystem.pays(sitting.outcome);
    if (spent) next = StudySystem.loseItem(next, piece!.id);
    // The eye grows either way: an unschooled one is winging it, and it settles at a rest
    const scope = piece ? StudySystem.identifyScopeOf(piece) : null;
    const eyeId = scope ? StudySystem.scopeSkillId(scope) : null;
    const eye: IEyeChange = !scope || !eyeId ? null : next.bank.universalSkills[eyeId] ? { kind: 'GAIN', skillId: eyeId } : { kind: 'ACCRUE', skillId: eyeId, tag: `identify_${scope}` };
    return { player: next, sitting, ...(piece ? { piece } : {}), spent, unread, eye };
  },

  /**
   * The eye's change, applied purely: what the player store's GAIN_SKILL_XP and ACCRUE do for an eye (the learn rate, the
   * level climbed; an unheld eye accrues at rank 0). An eye works no material, so the store's rung reveal has nothing to add.
   */
  eyeGrown(player: IPlayer, eye: IEyeChange): IPlayer {
    if (!eye) return player;
    if (eye.kind === 'ACCRUE') return WebSystem.accrue(player, { id: eye.skillId, tags: [eye.tag] }, 0);
    const held = player.bank.universalSkills[eye.skillId];
    if (!held) return player;
    const skill = { ...held, currentXp: held.currentXp + Math.round(EYE_XP_PER_SITTING * StatSystem.learnRate(player.attributes)) };
    while (skill.currentXp >= ProgressionSystem.getXpToNextLevel(skill.level, ProgressionSystem.skillRarity(skill))) {
      skill.currentXp -= ProgressionSystem.getXpToNextLevel(skill.level, ProgressionSystem.skillRarity(skill));
      skill.level++;
    }
    return { ...player, bank: { ...player.bank, universalSkills: { ...player.bank.universalSkills, [eye.skillId]: skill } } };
  }
};

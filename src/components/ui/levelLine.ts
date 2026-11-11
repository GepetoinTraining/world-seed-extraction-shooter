/**
 * What a level leaves waiting, in one line (Q28): the field's chip and the city's bar read the
 * same words, so a level reached in either place says what it gave in both.
 */

import { IPlayer } from '../../../shared/types';
import { ATTRIBUTE_GROUPS, AttributeGroup, GROUP_WORDS, ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { CircleSystem } from '../../logic/systems/CircleSystem';

export const levelLine = (player: IPlayer): string => {
  const points = ProgressionSystem.unspent(player).total;
  const circles = CircleSystem.free(player);
  return `LV ${ProgressionSystem.levelOf(player)}${points > 0 ? ` · ${points} TO SPEND` : ''}${circles > 0 ? ` · ${circles} TO FILL` : ''}`;
};

type Points = Parameters<typeof ProgressionSystem.unspent>[0];

/** A group's heading on either sheet (G1f): its word, and how many of its own points wait, when any do. */
export const groupHeading = (player: Points, group: AttributeGroup): string => {
  const own = player.groupPoints?.[group] ?? 0;
  return own > 0 ? `${GROUP_WORDS[group]} · ${own} TO SPEND HERE` : GROUP_WORDS[group];
};

/** What a + in this group spends, said in words beside it so no pointer has to hover (G1f); none when no + shows. */
export const plusSays = (player: Points, group: AttributeGroup): string | null => {
  const kind = ProgressionSystem.pointFor(player, ATTRIBUTE_GROUPS[group][0]);
  if (!kind) return null;
  return kind === 'free' ? '+ SPENDS THE FREE POINT' : `+ SPENDS A ${GROUP_WORDS[group]} POINT`;
};

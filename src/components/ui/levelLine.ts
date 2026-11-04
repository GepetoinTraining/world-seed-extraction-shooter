/**
 * What a level leaves waiting, in one line (Q28): the field's chip and the city's bar read the
 * same words, so a level reached in either place says what it gave in both.
 */

import { IPlayer } from '../../../types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { CircleSystem } from '../../logic/systems/CircleSystem';

export const levelLine = (player: IPlayer): string => {
  const points = player.attributePoints ?? 0;
  const circles = CircleSystem.free(player);
  return `LV ${ProgressionSystem.levelOf(player)}${points > 0 ? ` · ${points} TO SPEND` : ''}${circles > 0 ? ` · ${circles} TO FILL` : ''}`;
};

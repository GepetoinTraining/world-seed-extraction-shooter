/**
 * WHAT A CHARACTER'S ATTRIBUTES ADD UP TO (UXS, 2026-11-12). The store's `recalcAttributes`, moved out whole so it can be
 * asked of a copy: a point's preview on the sheet runs this on a character with the point spent, and the store runs it on
 * the character itself, so what the preview shows is what the spend gives. Pure: a player in, the same player with its
 * attributes worked out out.
 *
 * What it does, unchanged: the base attributes, plus every worn frame's modifiers from its head position (legacy float
 * memory only where no equipment exists yet), each at least 1; the legacy mirror of the worn frames in budget order; and
 * the skills' passive gifts, summed where `StatSystem.total` reads them.
 */

import { HEAD_BUDGET_POSITIONS, ICognitiveFrame, IPlayer } from '../../../../shared/types';
import { COGNITIVE_FRAMES } from '../../../../shared/entities/player/data/cognitiveFrames';
import { CircleSystem } from '../../../logic/systems/CircleSystem';

export function withTotals(player: IPlayer): IPlayer {
  const { baseAttributes, equipment } = player;
  const attributes = { ...baseAttributes };

  // D22: frames apply from their head-budget positions (legacy floatMemory only when no equipment exists yet)
  const worn: ICognitiveFrame[] = equipment
    ? HEAD_BUDGET_POSITIONS.map(p => equipment.frames[p]).filter(Boolean).map(id => COGNITIVE_FRAMES[id!]).filter(Boolean)
    : (player.floatMemory.filter(Boolean) as ICognitiveFrame[]);

  for (const frame of worn) {
    for (const [key, val] of Object.entries(frame.modifiers)) {
      if (key in attributes) (attributes as Record<string, number>)[key] += val as number;
    }
  }

  // Clamp values (min 1)
  for (const key of Object.keys(attributes)) {
    if ((attributes as Record<string, number>)[key] < 1) (attributes as Record<string, number>)[key] = 1;
  }

  // The legacy mirror: old readers see the worn frames, in budget order
  const mirror = [worn[0] ?? null, worn[1] ?? null, worn[2] ?? null] as [ICognitiveFrame | null, ICognitiveFrame | null, ICognitiveFrame | null];

  return CircleSystem.withPassives({ ...player, attributes, floatMemory: mirror });
}

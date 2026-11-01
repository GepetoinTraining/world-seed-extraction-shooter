/**
 * Wave 9.5: the fix. CombatSystem has emitted xpReward on every KILL since
 * Wave 4 and nothing ever applied it — kills were calculated and forgotten.
 * This is the one consumer: XP lands on the player's level (D83), and a level
 * comes back so the screen can say so. A rank is the guild's to grant, never a fight's.
 */

import { ICombatEvent } from './CombatSystems';
import { usePlayerStore } from '../player/store';

export interface IKillReward {
  xpGained: number;
  levelUp: { from: number; to: number; points: number } | null;
}

export function applyKillRewards(events: ICombatEvent[]): IKillReward {
  let xpGained = 0;
  let levelUp: IKillReward['levelUp'] = null;
  for (const e of events) {
    if (e.type !== 'KILL' || !e.xpReward) continue;
    xpGained += e.xpReward.amount;
    const res = usePlayerStore.getState().applyKillXp(e.xpReward.amount);
    if (res.leveledUp) {
      levelUp = levelUp
        ? { from: levelUp.from, to: res.to, points: levelUp.points + res.pointsGranted }
        : { from: res.from, to: res.to, points: res.pointsGranted };
    }
  }
  return { xpGained, levelUp };
}

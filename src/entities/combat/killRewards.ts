/**
 * Wave 9.5: the fix. CombatSystem has emitted xpReward on every KILL since
 * Wave 4 and nothing ever applied it — kills were calculated and forgotten.
 * This is the one consumer: XP lands on the player's rank track, and a
 * rank-up comes back so the screen can make a moment of it.
 */

import { ICombatEvent } from './CombatSystems';
import { usePlayerStore } from '../player/store';
import { UniversalRank } from '../../../types';

export interface IKillReward {
  xpGained: number;
  rankUp: { from: UniversalRank; to: UniversalRank; points: number } | null;
}

export function applyKillRewards(events: ICombatEvent[]): IKillReward {
  let xpGained = 0;
  let rankUp: IKillReward['rankUp'] = null;
  for (const e of events) {
    if (e.type !== 'KILL' || !e.xpReward) continue;
    xpGained += e.xpReward.amount;
    const res = usePlayerStore.getState().applyKillXp(e.xpReward.amount);
    if (res.rankedUp) {
      rankUp = rankUp
        ? { from: rankUp.from, to: res.to, points: rankUp.points + res.pointsGranted }
        : { from: res.from, to: res.to, points: res.pointsGranted };
    }
  }
  return { xpGained, rankUp };
}

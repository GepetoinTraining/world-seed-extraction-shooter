/**
 * THE FIRST ORDER, HEARD IN THE FIELD (TQ). Where the game already does each of the five (a kill it pays for, a chest
 * opened, material taken, someone walked out, the extraction), it hands the step here. In the tutorial, while the first
 * order stands, the step is kept on the character, saved at once so a closed window keeps it (call 9), and a task done is
 * said in the feed. Anywhere else nothing happens.
 */

import type { FirstTask } from '../../../shared/types';
import type { IPlayerPort } from '../../entities/player/playerView';
import { openCard, type IWorldPort } from '../../entities/world/worldView';
import { useFeed } from '../../components/ui/stores';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { FirstOrder } from './FirstOrder';
import { Tutorial } from './Tutorial';

export const FirstOrderDoor = {
  /** A step of one task. True when it was kept. */
  note(task: FirstTask, world: Pick<IWorldPort, 'view'>, pc: Pick<IPlayerPort, 'view' | 'apply'>, count = 1, at = Date.now()): boolean {
    const view = world.view();
    if (!Tutorial.isTutorial(view.availableWorlds ? openCard(view) : undefined)) return false;
    const before = pc.view().player;
    const out = FirstOrder.tick(before, task, at, count);
    if (!out.ticked) return false;
    pc.apply({ kind: 'SET', player: out.player });
    const was = FirstOrder.isDone(FirstOrder.of(before), task);
    if (!was && FirstOrder.isDone(FirstOrder.of(out.player), task)) useFeed.getState().push(FirstOrder.doneLine(task), 'proof');
    void PlayerPersistence.flush('first order', pc.view().player);
    return true;
  }
};

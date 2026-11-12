/**
 * A DIVE THE WINDOW CLOSED ON (TQ, call 9). A drop moves every tool from the vault into the pack, and the save used to
 * leave the dive out, so a window closed mid-dive lost the whole pack, tools included, even in the tutorial where a death
 * costs nothing (ML26). Now the save keeps the dive as it stands, and the next start settles it exactly as a death in
 * that world would be settled, by its own word (`DeathCost`), through the death's own door, and never more. A dive still
 * in recon had risked nothing, as leaving recon shows, so it settles as that.
 */

import type { IPlayer } from '../../../shared/types';

/** What the card says when it says nothing: a death costs the haul (as the field reads it). */
const UNSAID = 'INVENTORY_LOSS';

export const LeftDive = {
  /** What the save keeps of a dive in progress: the dive itself, and what a death there costs. */
  keep(player: Pick<IPlayer, 'currentSession'>): IPlayer['leftDive'] {
    const session = player.currentSession;
    return session ? { session, penalty: session.deathPenalty ?? UNSAID } : undefined;
  },

  /** What settling it costs: the world's own word once the person was on the ground; nothing while in recon. */
  penaltyOf(left: NonNullable<IPlayer['leftDive']>): string {
    return left.session.droppedAt === undefined ? 'NONE' : left.penalty;
  },

  /**
   * At a start: the dive stands again for a moment, and the death's own door settles it. `jackOut` is that door
   * (`emergencyJackOut`); `set` puts a player in place. True when there was one to settle.
   */
  settle(player: IPlayer, jackOut: (penalty: string) => unknown, set: (player: IPlayer) => void): boolean {
    const left = player.leftDive;
    if (!left) return false;
    set({ ...player, leftDive: undefined, currentSession: left.session });
    jackOut(this.penaltyOf(left));
    return true;
  }
};

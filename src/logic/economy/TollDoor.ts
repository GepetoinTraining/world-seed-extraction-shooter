/**
 * The toll, reaching out: where the toll's law meets a person's gold. The law is `Toll` and stays
 * pure. A gold change goes through `GoldCommit` in the same tick, with no await between them.
 */

import { useHubStore } from '../../entities/hub/store';
import { useIdentityStore } from '../../entities/identity/store';
import type { IPlayerPort } from '../../entities/player/playerView';
import { openCard, type IWorldView } from '../../entities/world/worldView';
import { Toll, useTollPrompt } from '../systems/Toll';
import { GoldCommit } from './GoldCommit';

export interface ITollPaid { ok: boolean; reason?: string; paid?: number }

export const TollDoor = {
  /** Pays what is being asked, and it stands aside for as long as this world stays open. */
  async pay(world: IWorldView, pc: IPlayerPort): Promise<ITollPaid> {
    const asking = useTollPrompt.getState().asking;
    if (!asking) return { ok: false, reason: 'Nobody is asking.' };
    const card = openCard(world);
    if (!card) return { ok: false, reason: 'No world stands open.' };
    const { player } = pc.view();
    if (!Toll.canPay(player.bank.gold, asking.owed)) return { ok: false, reason: `It wants ${asking.owed} G, and you hold ${player.bank.gold} G.` };

    const payer = useIdentityStore.getState().certificate?.metadata.uid ?? player.id;
    const owner = Toll.ownerOf(card, useHubStore.getState().activeHubId);
    const moves = Toll.moves(card, useHubStore.getState().activeHubId, payer, asking.owed);
    Toll.settled(Toll.live(), asking.entityId);
    useTollPrompt.setState({ asking: null });

    pc.apply({ kind: 'GOLD', delta: moves.playerDelta });
    await GoldCommit.commit({
      player: pc.view().player,
      rows: [{ type: 'TRADE', data: { kind: 'TOLL_PAID', worldUid: card.id, entityId: asking.entityId, owed: asking.owed, owner: owner.to, playerDelta: moves.playerDelta, treasuryDelta: moves.treasury?.delta ?? 0 } }],
      ...(moves.treasury ? { treasury: moves.treasury } : {})
    });
    return { ok: true, paid: -moves.playerDelta };
  },

  /** Says no. It comes for you. */
  refuse(): void {
    const asking = useTollPrompt.getState().asking;
    if (!asking) return;
    Toll.refused(Toll.live(), asking.entityId);
    useTollPrompt.setState({ asking: null });
  }
};

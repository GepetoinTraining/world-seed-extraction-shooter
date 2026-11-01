/**
 * The toll, reaching out: where the toll's law meets a person's gold. The law is `Toll` and stays
 * pure. A gold change goes through `GoldCommit` in the same tick, with no await between them.
 */

import { useHubStore } from '../../entities/hub/store';
import { useIdentityStore } from '../../entities/identity/store';
import { usePlayerStore } from '../../entities/player/store';
import { useWorldStore } from '../../entities/world/store';
import { Toll, useTollPrompt } from '../systems/Toll';
import { GoldCommit } from './GoldCommit';

export interface ITollPaid { ok: boolean; reason?: string; paid?: number }

export const TollDoor = {
  /** Pays what is being asked, and it stands aside for as long as this world stays open. */
  async pay(): Promise<ITollPaid> {
    const asking = useTollPrompt.getState().asking;
    if (!asking) return { ok: false, reason: 'Nobody is asking.' };
    const world = useWorldStore.getState();
    const card = world.availableWorlds.find(w => w.id === world.activeWorldId);
    if (!card) return { ok: false, reason: 'No world stands open.' };
    const { player } = usePlayerStore.getState();
    if (!Toll.canPay(player.bank.gold, asking.owed)) return { ok: false, reason: `It wants ${asking.owed} G, and you hold ${player.bank.gold} G.` };

    const payer = useIdentityStore.getState().certificate?.metadata.uid ?? player.id;
    const owner = Toll.ownerOf(card, useHubStore.getState().activeHubId);
    const moves = Toll.moves(card, useHubStore.getState().activeHubId, payer, asking.owed);
    Toll.settled(Toll.live(), asking.entityId);
    useTollPrompt.setState({ asking: null });

    usePlayerStore.setState(state => ({
      player: { ...state.player, bank: { ...state.player.bank, gold: state.player.bank.gold + moves.playerDelta } }
    }));
    await GoldCommit.commit({
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

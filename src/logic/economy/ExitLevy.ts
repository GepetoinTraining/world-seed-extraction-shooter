import { Ledger } from '../ledger/Ledger';
import { Treasury } from './Treasury';
import { usePlayerStore } from '../../entities/player/store';

export class ExitLevy {

  /** Charges the world's fee on a completed session. Returns the gold actually taken. */
  static async charge(worldUid: string, haulValue: number, rate: number): Promise<number> {
    const owed = Math.floor(haulValue * rate);
    const charged = Math.min(owed, usePlayerStore.getState().player.bank.gold);
    if (charged <= 0) return 0;

    usePlayerStore.setState(state => ({
      player: { ...state.player, bank: { ...state.player.bank, gold: state.player.bank.gold - charged } }
    }));
    await Treasury.credit(worldUid, charged);
    await Ledger.append('TAX', { worldCertUid: worldUid, haulValue, rate, owed, tax: charged });
    return charged;
  }
}

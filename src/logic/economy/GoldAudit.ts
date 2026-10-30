/**
 * GOLD CONSERVATION AUDIT (Wave 5.1)
 *
 * Replays the signed ledger and checks it against live state:
 *   expected player gold  = genesis grant + every signed delta
 *   expected treasury sum = every signed credit
 * A mismatch means gold appeared or vanished outside the ledger — which is,
 * by Wave 5 law, a bug.
 */

import { Ledger } from '../ledger/Ledger';
import { Treasury } from './Treasury';
import { usePlayerStore } from '../../entities/player/store';
import { useIdentityStore } from '../../entities/identity/store';

export interface IGoldAuditResult {
  ok: boolean;
  expectedPlayerGold: number;
  actualPlayerGold: number;
  expectedTreasuryTotal: number;
  actualTreasuryTotal: number;
  rows: number;
  notes: string[];
}

export class GoldAudit {

  static async run(): Promise<IGoldAuditResult> {
    const notes: string[] = [];
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return { ok: false, expectedPlayerGold: 0, actualPlayerGold: 0, expectedTreasuryTotal: 0, actualTreasuryTotal: 0, rows: 0, notes: ['no identity'] };

    const rows = await Ledger.list(cert.metadata.uid);
    let player = 0;
    let treasury = 0;

    for (const signed of rows) {
      const { type, data } = signed.payload;
      switch (type) {
        case 'CHARACTER_GENESIS':
          player += data.gold ?? 500; // the birthright grant
          break;
        case 'GOLD_DELTA':
          player += data.amount ?? 0;
          treasury += data.treasuryDelta ?? 0;
          break;
        case 'TAX':
          player -= data.tax ?? 0;
          treasury += data.tax ?? 0;
          break;
        case 'UPKEEP':
          player -= data.amount ?? 0;
          treasury += data.amount ?? 0;
          break;
        case 'TRADE':
          player += data.playerDelta ?? 0;
          treasury += data.treasuryDelta ?? 0;
          break;
        default:
          break; // SESSION_RESULT, CRAFT, TOMBSTONE carry no gold
      }
    }

    const actualPlayer = usePlayerStore.getState().player.bank.gold;
    const actualTreasury = await Treasury.totalAll();

    const playerOk = actualPlayer === player;
    const treasuryOk = actualTreasury === treasury;
    if (!playerOk) notes.push(`player gold drift: ledger says ${player}, bank says ${actualPlayer}`);
    if (!treasuryOk) notes.push(`treasury drift: ledger says ${treasury}, docs say ${actualTreasury}`);

    return {
      ok: playerOk && treasuryOk,
      expectedPlayerGold: player,
      actualPlayerGold: actualPlayer,
      expectedTreasuryTotal: treasury,
      actualTreasuryTotal: actualTreasury,
      rows: rows.length,
      notes
    };
  }
}

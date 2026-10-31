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
    for (const signed of rows) {
      const { type, data } = signed.payload;
      if (type === 'CHARACTER_GENESIS') player += data.gold ?? 500;
      if (type === 'GOLD_DELTA') player += data.amount ?? 0;
      if (type === 'TAX') player -= data.tax ?? 0;
      if (type === 'UPKEEP') player -= data.amount ?? 0;
      if (type === 'TRADE') player += data.playerDelta ?? 0;
    }

    // Treasuries are shared, so their expectation spans every identity's rows.
    let treasury = await Treasury.totalEndowed();
    for (const signed of await Ledger.listAll()) {
      const { type, data } = signed.payload;
      if (type === 'GOLD_DELTA' || type === 'TRADE') treasury += data.treasuryDelta ?? 0;
      if (type === 'TAX') treasury += data.tax ?? 0;
      if (type === 'UPKEEP') treasury += data.amount ?? 0;
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

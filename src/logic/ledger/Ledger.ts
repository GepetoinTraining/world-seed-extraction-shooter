/**
 * TRANSACTION LEDGER (Wave 1.4)
 *
 * Append-only, per-identity, signed. Primordial's record shape: monotonic seq,
 * each row carries its prevSeq so the chain is checkable, deletes are
 * tombstone rows, never removals. Gold movements, taxes, trades and session
 * results all become rows here — Wave 5 adds the economy types; Wave 1 lays
 * the rail and uses it for genesis + session results.
 */

import { CertificateSystem, ISignedPayload } from '../../entities/identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { useIdentityStore } from '../../entities/identity/store';

export type LedgerRowType =
  | 'CHARACTER_GENESIS' // identity minted a character
  | 'SESSION_RESULT'    // sealed session receipt summary
  | 'GOLD_DELTA'        // any gold movement (data: { amount: player delta, treasuryId?, treasuryDelta?, wallets?: personId → delta })
  | 'TAX'               // session-exit levy (Wave 2.5)
  | 'TRADE'             // item changed owners (Wave 5/6)
  | 'CRAFT'             // a transformation job queued or collected (Wave 5.2)
  | 'BUILD'             // construction and placement in a room (Wave 10)
  | 'DESIGN'            // a plan minted or copied at the scribe's table (Wave 10B)
  | 'UPKEEP'            // lot upkeep charged (Wave 5.4)
  | 'TECH'              // first to reach a skill or a rung, in this hub (D27). Moves no gold
  | 'GUILD'             // what the guild did: a person lodged, a rank granted, a map handed in. Moves no gold
  | 'PRINT'             // a hub printed coin into its treasury (D115). data: { hubId, amount, perDay, days, why }
  | 'WALLET'            // a person came with their own coin (D115). data: { kind, hubId, personId, amount }
  | 'FARM'              // what happened on farmland: planted, reaped, penned, fed, cooked. Mints items, moves no gold
  | 'TOMBSTONE';        // marks an earlier row as superseded — never delete

export interface ILedgerRow {
  seq: number;
  prevSeq: number;
  ts: number;
  type: LedgerRowType;
  data: Record<string, any>;
}

export class Ledger {

  private static headId(uid: string) { return `ledger_head_${uid}`; }
  private static rowId(uid: string, seq: number) {
    return `ledger_${uid}_${seq.toString().padStart(8, '0')}`;
  }

  /** Append one signed row. Returns the new seq, or null on failure. A row that moves gold takes GoldCommit instead. */
  static append(type: LedgerRowType, data: Record<string, any>): Promise<number | null> {
    return StoreUnit.enqueue(() => this.write(type, data));
  }

  private static async write(type: LedgerRowType, data: Record<string, any>): Promise<number | null> {
    try {
      // A conflict means another tab moved this chain: read its head again and re-sign.
      for (;;) {
        const unit = new StoreUnit();
        const seq = await this.writeInto(unit, type, data);
        const result = await unit.commit();
        if (result.ok) return seq;
        if (!result.conflict) throw new Error(result.reason);
      }
    } catch (e) {
      console.error('[LEDGER] Append failed:', e);
      return null;
    }
  }

  /** Sign the next row into a unit. Whatever else is in the unit lands with it. */
  static async writeInto(unit: StoreUnit, type: LedgerRowType, data: Record<string, any>): Promise<number | null> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return null;
    const uid = cert.metadata.uid;

    const head = await VectorStore.get<{ seq: number }>(VectorNamespace.TRANSACTIONS, this.headId(uid));
    const prevSeq = Math.max(head?.data?.seq ?? 0, unit.seqOf(uid));
    const seq = prevSeq + 1;

    const row: ILedgerRow = { seq, prevSeq, ts: Date.now(), type, data };
    const signed = await CertificateSystem.signPayload(uid, row);

    await VectorStore.put({
      id: this.rowId(uid, seq),
      namespace: VectorNamespace.TRANSACTIONS,
      data: signed,
      metadata: {
        createdAt: row.ts,
        updatedAt: row.ts,
        ownerCertUid: uid,
        signature: signed.signature,
        version: 1
      }
    }, false, { unit });

    await VectorStore.put({
      id: this.headId(uid),
      namespace: VectorNamespace.TRANSACTIONS,
      data: { seq },
      metadata: { createdAt: row.ts, updatedAt: row.ts, ownerCertUid: uid, version: 1 }
    }, false, { unit });

    unit.noteSeq(uid, seq);
    return seq;
  }

  /** Read the chain back (ascending seq). */
  static async list(uid: string): Promise<ISignedPayload<ILedgerRow>[]> {
    const prefix = `ledger_${uid}_`;
    const docs = await VectorStore.query<ISignedPayload<ILedgerRow>>({ namespace: VectorNamespace.TRANSACTIONS, idPrefix: prefix });
    return docs
      .filter(d => d?.id?.startsWith?.(prefix))
      .map(d => d.data)
      .sort((a, b) => a.payload.seq - b.payload.seq);
  }

  /** Every identity's rows held on this machine. */
  static async listAll(): Promise<ISignedPayload<ILedgerRow>[]> {
    const docs = await VectorStore.query<ISignedPayload<ILedgerRow>>({ namespace: VectorNamespace.TRANSACTIONS, idPrefix: 'ledger_' });
    return docs
      .filter(d => d?.id?.startsWith?.('ledger_') && !d.id.startsWith('ledger_head_'))
      .map(d => d.data);
  }

  /** Verify every row's signature and the seq chain. */
  static async audit(uid: string): Promise<{ ok: boolean; rows: number; firstBadSeq?: number }> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert || cert.metadata.uid !== uid) return { ok: false, rows: 0 };

    const rows = await this.list(uid);
    let expected = 1;
    for (const signed of rows) {
      const valid = await CertificateSystem.verifyPayload(signed, cert);
      if (!valid || signed.payload.seq !== expected || signed.payload.prevSeq !== expected - 1) {
        return { ok: false, rows: rows.length, firstBadSeq: expected };
      }
      expected++;
    }
    return { ok: true, rows: rows.length };
  }
}

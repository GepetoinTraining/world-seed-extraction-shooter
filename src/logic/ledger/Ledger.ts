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
import { useIdentityStore } from '../../entities/identity/store';

export type LedgerRowType =
  | 'CHARACTER_GENESIS' // identity minted a character
  | 'SESSION_RESULT'    // sealed session receipt summary
  | 'GOLD_DELTA'        // any gold movement (data: { amount: player delta, treasuryId?, treasuryDelta? })
  | 'TAX'               // session-exit levy (Wave 2.5)
  | 'TRADE'             // item changed owners (Wave 5/6)
  | 'CRAFT'             // a transformation job queued or collected (Wave 5.2)
  | 'BUILD'             // construction and placement in a room (Wave 10)
  | 'UPKEEP'            // lot upkeep charged (Wave 5.4)
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

  // Each append reads the head then writes it, so overlapping appends must queue.
  private static queue: Promise<unknown> = Promise.resolve();

  /** Append one signed row. Returns the new seq, or null on failure. */
  static append(type: LedgerRowType, data: Record<string, any>): Promise<number | null> {
    const run = this.queue.then(() => this.write(type, data));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private static async write(type: LedgerRowType, data: Record<string, any>): Promise<number | null> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return null;
    const uid = cert.metadata.uid;

    try {
      const head = await VectorStore.get<{ seq: number }>(VectorNamespace.TRANSACTIONS, this.headId(uid));
      const prevSeq = head?.data?.seq ?? 0;
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
      });

      await VectorStore.put({
        id: this.headId(uid),
        namespace: VectorNamespace.TRANSACTIONS,
        data: { seq },
        metadata: { createdAt: row.ts, updatedAt: row.ts, ownerCertUid: uid, version: 1 }
      });

      return seq;
    } catch (e) {
      console.error('[LEDGER] Append failed:', e);
      return null;
    }
  }

  /** Read the chain back (ascending seq). */
  static async list(uid: string): Promise<ISignedPayload<ILedgerRow>[]> {
    const head = await VectorStore.get<{ seq: number }>(VectorNamespace.TRANSACTIONS, this.headId(uid));
    const top = head?.data?.seq ?? 0;
    const rows: ISignedPayload<ILedgerRow>[] = [];
    for (let seq = 1; seq <= top; seq++) {
      const doc = await VectorStore.get<ISignedPayload<ILedgerRow>>(
        VectorNamespace.TRANSACTIONS, this.rowId(uid, seq)
      );
      if (doc?.data) rows.push(doc.data);
    }
    return rows;
  }

  /** Every identity's rows held on this machine. */
  static async listAll(): Promise<ISignedPayload<ILedgerRow>[]> {
    const docs = await VectorStore.query<ISignedPayload<ILedgerRow>>({ namespace: VectorNamespace.TRANSACTIONS });
    return docs
      .filter(d => d.id.startsWith('ledger_') && !d.id.startsWith('ledger_head_'))
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

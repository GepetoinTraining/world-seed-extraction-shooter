/**
 * THE GOLD COMMIT (D31, line 71): a gold change and its ledger row, together.
 *
 * The player's signed bank doc, the treasury, the ledger rows and any hub state a
 * purchase changed go to the server as one transaction: all of it lands, or none
 * of it does. Before this, a closed tab between those writes left gold that the
 * ledger had never heard of.
 *
 * Call it in the same tick as the gold change, with no await between them. The
 * bank is snapshotted at the call, so its save and its row always agree, however
 * long the queue or a closed vault holds them.
 */

import { VectorStore, IVectorDocument } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { Ledger, LedgerRowType } from '../ledger/Ledger';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { Treasury } from './Treasury';

export interface IGoldCommit {
  rows: { type: LedgerRowType; data: Record<string, any> }[];
  treasury?: { worldUid: string; delta: number };
  /** The hub's state, when the same act changed it (a lot bought, a permit queued). */
  hubDoc?: IVectorDocument;
}

export class GoldCommit {

  /** Returns the seq of the last row written, or null if the server refused. */
  static commit(spec: IGoldCommit): Promise<number | null> {
    const snapshot = PlayerPersistence.snapshot();

    return StoreUnit.enqueue(async () => {
      // A conflict means another tab moved this chain: read its head again and re-sign.
      for (;;) {
        const unit = new StoreUnit();
        if (snapshot) await PlayerPersistence.signInto(unit, snapshot);
        if (spec.treasury) await Treasury.writeInto(unit, spec.treasury.worldUid, spec.treasury.delta);

        let seq: number | null = null;
        for (const row of spec.rows) seq = await Ledger.writeInto(unit, row.type, row.data);

        if (spec.hubDoc) await VectorStore.put(spec.hubDoc, false, { unit });

        const result = await unit.commit();
        if (result.ok) return seq;
        if (!result.conflict) {
          console.error('[GOLD] ⛔ The store refused a gold commit. Nothing moved in the database:', result.reason);
          return null;
        }
      }
    });
  }
}

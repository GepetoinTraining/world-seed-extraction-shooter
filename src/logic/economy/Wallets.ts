/**
 * WALLETS (D115): "every NPC brigns money with them, so they have their own wallets."
 *
 * One number per person per hub, held where treasuries are held and moved the way a treasury
 * is moved: the database adds to it. What a person brings comes with them once, with a signed
 * row, and from then on their coin changes only on a row that says so. `GoldAudit` adds them
 * all back up.
 */

import { VectorStore, VectorNamespace } from '../../../shared/entities/data/VectorStore';
import { StoreUnit } from '../../../shared/entities/data/StoreUnit';
import { Ledger } from '../ledger/Ledger';

const PREFIX = 'wallet_';
const hubPrefix = (hubId: string) => `${PREFIX}${hubId}__`;

export class Wallets {

  static docId(hubId: string, personId: string) { return `${hubPrefix(hubId)}${personId}`; }

  static async balance(hubId: string, personId: string): Promise<number> {
    const doc = await VectorStore.get<{ gold: number }>(VectorNamespace.TERRITORIES, this.docId(hubId, personId));
    return doc?.data?.gold || 0;
  }

  /** Add to a unit. The database adds the amount to what it holds; `next` is this client's reading of it. */
  static async writeInto(unit: StoreUnit, hubId: string, personId: string, amount: number): Promise<number> {
    const next = await this.balance(hubId, personId) + amount;
    await VectorStore.put({
      id: this.docId(hubId, personId),
      namespace: VectorNamespace.TERRITORIES,
      data: { gold: next },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    }, false, { unit, increment: amount });
    return next;
  }

  /** What a person came with: the record, the coin and the row land together, and only once, whoever else is trying. */
  static bring(hubId: string, personId: string, amount: number, name: string): Promise<void> {
    return StoreUnit.enqueue(async () => {
      const id = `brought_${hubId}__${personId}`;
      for (;;) {
        if (await VectorStore.get(VectorNamespace.TERRITORIES, id)) return;
        const unit = new StoreUnit();
        unit.onlyIfAbsent(id);
        await VectorStore.put({
          id,
          namespace: VectorNamespace.TERRITORIES,
          data: { gold: amount },
          metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
        }, false, { unit });
        await this.writeInto(unit, hubId, personId, amount);
        await Ledger.writeInto(unit, 'WALLET', { kind: 'BROUGHT', hubId, personId, name, amount });
        const result = await unit.commit();
        if (result.ok) return;
        if (!result.conflict) throw new Error(result.reason);
      }
    });
  }

  /** Everyone's in one hub, by person. */
  static async allOf(hubId: string): Promise<Record<string, number>> {
    const prefix = hubPrefix(hubId);
    const docs = await VectorStore.query<{ gold: number }>({ namespace: VectorNamespace.TERRITORIES, idPrefix: prefix });
    const out: Record<string, number> = {};
    for (const d of docs) {
      if (d?.id?.startsWith?.(prefix)) out[d.id.slice(prefix.length)] = d.data?.gold || 0;
    }
    return out;
  }

  /** Sum across every wallet (for the conservation audit). */
  static async totalAll(): Promise<number> {
    const docs = await VectorStore.query<{ gold: number }>({ namespace: VectorNamespace.TERRITORIES, idPrefix: PREFIX });
    return docs
      .filter(d => d?.id?.startsWith?.(PREFIX))
      .reduce((s, d) => s + (d.data?.gold || 0), 0);
  }
}

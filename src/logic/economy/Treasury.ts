/**
 * TREASURY (Wave 5.1)
 *
 * Gold is conserved: it moves, it never evaporates. Every debit from a player
 * credits a treasury (the hub's, or the world's), and the audit can add it
 * all back up. One doc per world cert uid.
 */

import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';

export class Treasury {

  static docId(worldUid: string) { return `treasury_${worldUid}`; }

  static async balance(worldUid: string): Promise<number> {
    const doc = await VectorStore.get<{ gold: number }>(VectorNamespace.TERRITORIES, this.docId(worldUid));
    return doc?.data?.gold || 0;
  }

  /** A credit with no gold change beside it. A player's gold moving takes GoldCommit instead. */
  static credit(worldUid: string, amount: number): Promise<number> {
    return StoreUnit.enqueue(async () => {
      const unit = new StoreUnit();
      const next = await this.writeInto(unit, worldUid, amount);
      await unit.commit();
      return next;
    });
  }

  /** Add to a unit. The database adds the amount to what it holds; `next` is this client's reading of it. */
  static async writeInto(unit: StoreUnit, worldUid: string, amount: number): Promise<number> {
    const current = await this.balance(worldUid);
    const next = current + amount;
    await VectorStore.put({
      id: this.docId(worldUid),
      namespace: VectorNamespace.TERRITORIES,
      data: { gold: next },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    }, false, { unit, increment: amount });
    return next;
  }

  /** One-time starting fund for a hub, so it can pay for goods before anyone has paid it. */
  static endow(worldUid: string, amount: number): Promise<void> {
    return StoreUnit.enqueue(async () => {
      const id = `endowment_${worldUid}`;
      if (await VectorStore.get(VectorNamespace.TERRITORIES, id)) return;
      // The record and the money land together, and only once, whoever else is trying.
      const unit = new StoreUnit();
      unit.onlyIfAbsent(id);
      await VectorStore.put({
        id,
        namespace: VectorNamespace.TERRITORIES,
        data: { gold: amount },
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
      }, false, { unit });
      await this.writeInto(unit, worldUid, amount);
      await unit.commit();
    });
  }

  static async totalEndowed(): Promise<number> {
    const docs = await VectorStore.query<{ gold: number }>({ namespace: VectorNamespace.TERRITORIES, idPrefix: 'endowment_' });
    return docs
      .filter(d => d?.id?.startsWith?.('endowment_'))
      .reduce((s, d) => s + (d.data?.gold || 0), 0);
  }

  /** Sum across every treasury (for the conservation audit). */
  static async totalAll(): Promise<number> {
    const docs = await VectorStore.query<{ gold: number }>({ namespace: VectorNamespace.TERRITORIES, idPrefix: 'treasury_' });
    return docs
      .filter(d => d?.id?.startsWith?.('treasury_'))
      .reduce((s, d) => s + (d.data?.gold || 0), 0);
  }
}

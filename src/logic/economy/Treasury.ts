/**
 * TREASURY (Wave 5.1)
 *
 * Gold is conserved: it moves, it never evaporates. Every debit from a player
 * credits a treasury (the hub's, or the world's), and the audit can add it
 * all back up. One doc per world cert uid.
 */

import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';

export class Treasury {

  static docId(worldUid: string) { return `treasury_${worldUid}`; }

  static async balance(worldUid: string): Promise<number> {
    const doc = await VectorStore.get<{ gold: number }>(VectorNamespace.TERRITORIES, this.docId(worldUid));
    return doc?.data?.gold || 0;
  }

  // Each credit reads then writes the balance, so overlapping credits must queue.
  private static queue: Promise<unknown> = Promise.resolve();

  static credit(worldUid: string, amount: number): Promise<number> {
    const run = this.queue.then(() => this.write(worldUid, amount));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private static async write(worldUid: string, amount: number): Promise<number> {
    const current = await this.balance(worldUid);
    const next = current + amount;
    await VectorStore.put({
      id: this.docId(worldUid),
      namespace: VectorNamespace.TERRITORIES,
      data: { gold: next },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
    return next;
  }

  /** One-time starting fund for a hub, so it can pay for goods before anyone has paid it. */
  static async endow(worldUid: string, amount: number): Promise<void> {
    const id = `endowment_${worldUid}`;
    if (await VectorStore.get(VectorNamespace.TERRITORIES, id)) return;
    await VectorStore.put({
      id,
      namespace: VectorNamespace.TERRITORIES,
      data: { gold: amount },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
    await this.credit(worldUid, amount);
  }

  static async totalEndowed(): Promise<number> {
    const docs = await VectorStore.query<{ gold: number }>({ namespace: VectorNamespace.TERRITORIES });
    return docs
      .filter(d => d.id.startsWith('endowment_'))
      .reduce((s, d) => s + (d.data?.gold || 0), 0);
  }

  /** Sum across every treasury (for the conservation audit). */
  static async totalAll(): Promise<number> {
    const docs = await VectorStore.query<{ gold: number }>({ namespace: VectorNamespace.TERRITORIES });
    return docs
      .filter(d => d.id.startsWith('treasury_'))
      .reduce((s, d) => s + (d.data?.gold || 0), 0);
  }
}

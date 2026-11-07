/**
 * THE STORE UNIT (D31): several writes, one transaction.
 *
 * Writes handed to `VectorStore.put(doc, false, { unit })` wait in the unit, and
 * `commit()` sends them to the server as one request, which runs them as one SQL
 * transaction. A gold change, its treasury and its ledger row travel this way.
 *
 * The queue is the other half. Every write that reads before it writes (a ledger
 * append reads its head, a save snapshots the bank) takes its turn here, so a save
 * that follows a gold change can never reach the database ahead of that change's
 * ledger row, and a hung server holds them all in their order.
 */

import { CommitOp } from './wire';
import { StoreClient, StoreRefused } from './StoreClient';

export interface UnitResult {
  ok: boolean;
  /** ok: whether this commit did the writing (a retried or guarded one may not have). */
  applied?: boolean;
  /** not ok: another writer got there first, so read again and retry. */
  conflict?: boolean;
  reason?: string;
}

let queue: Promise<unknown> = Promise.resolve();

export class StoreUnit {
  private readonly ops: CommitOp[] = [];
  private guard?: string;
  private readonly seqs = new Map<string, number>();
  private readonly signatures = new Map<string, string>();

  /** Take a turn in the one write queue. Never enqueue from inside a turn. */
  static enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  }

  /** Called by VectorStore. */
  add(op: CommitOp) {
    this.ops.push(op);
  }

  /** Nothing in this unit applies if a document with this id already exists. */
  onlyIfAbsent(id: string) {
    this.guard = id;
  }

  /** The ledger seq this unit has reached for an identity, so a second row in one unit follows the first. */
  noteSeq(uid: string, seq: number) {
    this.seqs.set(uid, seq);
  }

  seqOf(uid: string): number {
    return this.seqs.get(uid) ?? 0;
  }

  /** The signature of the last row this unit holds for an identity, so the next one links to it (D135). */
  noteSignature(uid: string, signature: string) {
    this.signatures.set(uid, signature);
  }

  signatureOf(uid: string): string | undefined {
    return this.signatures.get(uid);
  }

  get size() {
    return this.ops.length;
  }

  /** All of it or none of it. A refusal comes back as a result; an outage waits inside. */
  async commit(): Promise<UnitResult> {
    if (this.ops.length === 0) return { ok: true, applied: false };
    try {
      const { applied } = await StoreClient.commit({
        commitId: crypto.randomUUID(),
        ops: this.ops,
        ...(this.guard ? { guardAbsent: this.guard } : {})
      });
      return { ok: true, applied };
    } catch (e) {
      if (e instanceof StoreRefused) return { ok: false, conflict: e.conflict, reason: e.message };
      throw e;
    }
  }
}

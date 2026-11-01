/**
 * Two of these write one SQLite file at once: what two dev servers on two ports do.
 */
import { randomUUID } from 'node:crypto';
import { openStore } from '../../server/SqlStore';

const owner = process.env.WS_SHARED_OWNER!;
const store = await openStore(process.env.WS_SHARED_URL!);

for (let seq = 1; seq <= 50; seq++) {
  const row = { payload: { seq, prevSeq: seq - 1, ts: seq, type: 'GOLD_DELTA', data: { amount: -1 } }, signature: `row_${seq}`, certUid: owner, timestamp: seq };
  await store.commit({
    commitId: randomUUID(),
    ops: [
      { kind: 'add', namespace: 'territories', id: 'treasury_shared', amount: 1, at: seq },
      { kind: 'put', doc: { id: `ledger_${owner}_${seq.toString().padStart(8, '0')}`, namespace: 'transactions', dataText: JSON.stringify(row), metadata: { createdAt: seq, updatedAt: seq, ownerCertUid: owner, signature: row.signature, version: 1 } } }
    ]
  });
}

await store.close();
process.exit(0);

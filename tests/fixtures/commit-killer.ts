/**
 * A real process that commits gold and is killed mid-commit at a chosen stage.
 * Line 71's fixture: WS_KILL_COMMITS whole commits are acknowledged on stdout,
 * then the next dies at WS_KILL_AT. The kill is the operating system's, so no
 * rollback handler, no finally and no driver cleanup gets to run.
 */
import { randomUUID } from 'node:crypto';
import { openStore } from '../../server/SqlStore';

const url = process.env.WS_KILL_URL!;
const killAt = process.env.WS_KILL_AT!;
const whole = Number(process.env.WS_KILL_COMMITS!);
const start = Number(process.env.WS_KILL_START ?? 0);

let armed = false;
const store = await openStore(url, {
  fault: stage => {
    if (armed && stage === killAt) process.kill(process.pid, 'SIGKILL');
  }
});

const goldCommit = (seq: number) => {
  const gold = 500 - seq * 10;
  const signed = { payload: { bank: { gold } }, signature: `doc_${seq}`, certUid: 'killed', timestamp: seq };
  const row = { payload: { seq, prevSeq: seq - 1, ts: seq, type: 'GOLD_DELTA', data: { amount: -10 } }, signature: `row_${seq}`, certUid: 'killed', timestamp: seq };
  return store.commit({
    commitId: randomUUID(),
    ops: [
      { kind: 'put', doc: { id: 'killed', namespace: 'characters', dataText: JSON.stringify(signed), metadata: { createdAt: 1, updatedAt: seq, ownerCertUid: 'killed', signature: signed.signature, version: 1 } } },
      { kind: 'add', namespace: 'territories', id: 'treasury_hub', amount: 10, at: seq },
      { kind: 'put', doc: { id: `ledger_killed_${seq.toString().padStart(8, '0')}`, namespace: 'transactions', dataText: JSON.stringify(row), metadata: { createdAt: seq, updatedAt: seq, ownerCertUid: 'killed', signature: row.signature, version: 1 } } },
      { kind: 'put', doc: { id: 'ledger_head_killed', namespace: 'transactions', dataText: JSON.stringify({ seq }), metadata: { createdAt: seq, updatedAt: seq, ownerCertUid: 'killed', version: 1 } } }
    ]
  });
};

for (let i = 1; i <= whole; i++) {
  await goldCommit(start + i);
  process.stdout.write(`ACK ${start + i}\n`);
}

armed = true;
await goldCommit(start + whole + 1);
process.stdout.write(`ACK ${start + whole + 1}\n`);
process.exit(0);

/**
 * A real process that commits, starts a write-down, and is stopped hard at a chosen moment
 * inside it. The stop is the operating system's: no finally and no cleanup gets to run.
 *
 *   WS_KILL_URL      the live database
 *   WS_KILL_RECORD   the record's URL
 *   WS_KILL_TOKEN    the record's token, if it asks for one
 *   WS_KILL_AT       pending | sending | staged-part | staged | applied | verified | none
 *                    (sending is the one-request path; staged-part and staged need a record that refused it as too large)
 *                    or in-flight:<ms> | in-flight-stage:<ms>, that long after the crossing batch, or a staging one, starts on its way
 *   WS_KILL_FROM     the first seq to commit (a later round goes on from where the last stopped)
 *   WS_KILL_COMMITS  how many whole commits come first, each acknowledged on stdout
 */
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../server/connection';
import { RecordKeeper } from '../../server/record';
import { SqlStore } from '../../server/SqlStore';

const killAt = process.env.WS_KILL_AT!;
const from = Number(process.env.WS_KILL_FROM ?? 1);
const commits = Number(process.env.WS_KILL_COMMITS ?? 3);

// With the request on the wire, where no stage of the keeper's can reach: the answer may or may not ever have been made.
const [inFlight, afterMs] = killAt.split(':');
if (inFlight === 'in-flight' || inFlight === 'in-flight-stage') {
  const looksFor = inFlight === 'in-flight' ? 'INSERT INTO cold_writedowns' : 'INSERT INTO cold_stage_documents';
  const sendIt = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const body = input instanceof Request ? await input.clone().text() : String(init?.body ?? '');
    if (body.includes(looksFor)) setTimeout(() => process.kill(process.pid, 'SIGKILL'), Number(afterMs));
    return sendIt(input, init);
  }) as typeof fetch;
}

const database = await openDatabase(process.env.WS_KILL_URL!);
const keeper = new RecordKeeper(database, { on: true, url: process.env.WS_KILL_RECORD!, authToken: process.env.WS_KILL_TOKEN }, {
  say: () => undefined,
  fault: stage => { if (stage === killAt) process.kill(process.pid, 'SIGKILL'); }
});
await keeper.goLive();
const store = new SqlStore(database, {}, keeper);

// Past the staging size, so a write-down takes several requests and the moment between them exists.
const body = (seq: number) => 'h'.repeat(1_500_000) + seq;

for (let seq = from; seq < from + commits; seq++) {
  const gold = 500 - seq * 10;
  const signed = { payload: { bank: { gold } }, signature: `doc_${seq}`, certUid: 'stopped', timestamp: seq };
  const row = { payload: { seq, prevSeq: seq - 1, ts: seq, type: 'GOLD_DELTA', data: { amount: -10, treasuryDelta: 10 } }, signature: `row_${seq}`, certUid: 'stopped', timestamp: seq };
  await store.commit({
    commitId: randomUUID(),
    ops: [
      { kind: 'put', doc: { id: 'stopped', namespace: 'characters', dataText: JSON.stringify(signed), metadata: { createdAt: 1, updatedAt: seq, ownerCertUid: 'stopped', signature: signed.signature, version: 1 } } },
      { kind: 'put', doc: { id: 'hub_state_stopped', namespace: 'territories', dataText: JSON.stringify({ seq, body: body(seq) }), metadata: { createdAt: 1, updatedAt: seq, version: 1 } } },
      { kind: 'put', doc: { id: 'hub_side_stopped', namespace: 'territories', dataText: JSON.stringify({ seq, body: body(seq) }), metadata: { createdAt: 1, updatedAt: seq, version: 1 } } },
      { kind: 'add', namespace: 'territories', id: 'treasury_hub', amount: 10, at: seq },
      { kind: 'put', doc: { id: `ledger_stopped_${seq.toString().padStart(8, '0')}`, namespace: 'transactions', dataText: JSON.stringify(row), metadata: { createdAt: seq, updatedAt: seq, ownerCertUid: 'stopped', signature: row.signature, version: 1 } } }
    ]
  });
  process.stdout.write(`ACK ${seq}\n`);
}

const receipt = await keeper.writeDown('test');
process.stdout.write(`DOWN ${receipt.status}\n`);
process.exit(0);

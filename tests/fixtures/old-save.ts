/**
 * An old save, the shape the old server made: a SQLite file in WAL mode, with its log
 * still open beside it. The carry tool's bars read it. Node's own SQLite makes it, so a
 * test run loads nothing of the old driver.
 *
 *   node --disable-warning=ExperimentalWarning --import tsx tests/fixtures/old-save.ts <file> <plain|nul|fraction>
 */
import { DatabaseSync } from 'node:sqlite';

const [, , file, kind = 'plain'] = process.argv;

// The old migration, as it was shipped.
const DDL = [
  'CREATE TABLE commits (id text PRIMARY KEY NOT NULL, at integer NOT NULL)',
  `CREATE TABLE documents (id text PRIMARY KEY NOT NULL, namespace text NOT NULL, data text NOT NULL, embedding text, doc_type text, genre text, owner_cert_uid text, signature text, version integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)`,
  'CREATE INDEX documents_namespace_idx ON documents (namespace)',
  'CREATE INDEX documents_namespace_type_idx ON documents (namespace, doc_type)',
  'CREATE INDEX documents_owner_idx ON documents (owner_cert_uid)',
  `CREATE TABLE ledger_rows (id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL, seq integer NOT NULL, prev_seq integer NOT NULL, ts integer NOT NULL, type text NOT NULL, signature text NOT NULL, data text NOT NULL, version integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)`,
  'CREATE UNIQUE INDEX ledger_rows_owner_seq_idx ON ledger_rows (owner_uid, seq)',
  'CREATE INDEX ledger_rows_type_idx ON ledger_rows (type)',
  'CREATE TABLE treasuries (id text PRIMARY KEY NOT NULL, namespace text NOT NULL, gold real NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)'
];

export const NASTY = JSON.stringify({
  payload: { z: 1, a: 2, '10': 'ten', '2': 'two', m: { y: [1, 2.5, -0.1, 1e21], x: null } },
  text: 'naïve é é 🐉 "quoted" \\ back \n line \t tab \u0000 nul \ud800 lone',
  timestamp: 1730000000123.5
});

const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL');
for (const statement of DDL) db.exec(statement);
const client = {
  async execute(s: { sql: string; args: any[] }) { db.prepare(s.sql).run(...s.args); }
};

db.exec('BEGIN');
const insertDoc = `INSERT INTO documents (id, namespace, data, embedding, doc_type, genre, owner_cert_uid, signature, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
await client.execute({ sql: insertDoc, args: ['ws_abc_character', 'characters', NASTY, null, null, null, 'ws_abc', 'sig-char', 3, 1730000000000, 1730000000999] });
await client.execute({ sql: insertDoc, args: ['res_tree_log', 'content', '{ "type":"res",  "spacing":"kept" }', '[0.1,0.2]', 'res', 'wood', 'SYSTEM', null, 1, 1000, 2000] });
await client.execute({ sql: insertDoc, args: ["quote'd_id_é", 'items', '{}', null, null, null, null, null, 1, 1, 1] });
for (let i = 0; i < 1200; i++) {
  await client.execute({ sql: insertDoc, args: [`prov_${i.toString().padStart(5, '0')}`, 'items', JSON.stringify({ i }), null, null, null, 'SYSTEM', null, 1, 1000 + i, 1000 + i] });
}
await client.execute({ sql: insertDoc, args: ['hub_state_a', 'territories', JSON.stringify({ body: 'hub'.repeat(350_000) }), null, null, null, 'SYSTEM', null, 1, 5, 6] });

for (let seq = 1; seq <= 700; seq++) {
  const data = JSON.stringify({ payload: { seq, prevSeq: seq - 1, ts: 5000 + seq, type: 'GOLD_DELTA', data: { amount: -1 } }, signature: `sig_${seq}`, certUid: 'ws_abc', timestamp: seq });
  await client.execute({
    sql: 'INSERT INTO ledger_rows (id, owner_uid, seq, prev_seq, ts, type, signature, data, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    args: [`ledger_ws_abc_${seq.toString().padStart(8, '0')}`, 'ws_abc', seq, seq - 1, 5000 + seq, 'GOLD_DELTA', `sig_${seq}`, data, 1, 5000 + seq, 5000 + seq]
  });
}

for (const [id, gold] of [['treasury_world_a', 0.1 + 0.2], ['treasury_world_b', 111581], ['wallet_world_a__npc_banker', 1 / 3], ['treasury_world_c', 123456789.12345678]] as [string, number][]) {
  await client.execute({ sql: 'INSERT INTO treasuries (id, namespace, gold, created_at, updated_at) VALUES (?,?,?,?,?)', args: [id, 'territories', gold, 10, 20] });
}
for (let i = 0; i < 900; i++) {
  await client.execute({ sql: 'INSERT INTO commits (id, at) VALUES (?,?)', args: [`commit_${i}`, 1730000000000 + i] });
}

if (kind === 'nul') await client.execute({ sql: insertDoc, args: ['has_nul', 'content', '{}', null, 'a\u0000b', null, null, null, 1, 1, 1] });
if (kind === 'fraction') await client.execute({ sql: insertDoc, args: ['has_fraction', 'content', '{"kept":"exactly"}', null, null, null, null, null, 1, 1730000000123.5, 1730000000123.75] });

db.exec('COMMIT');

// Not closed: a real server's file keeps its log beside it, holding the newest play.
await client.execute({ sql: insertDoc, args: ['only_in_the_log', 'content', '{"newest":true}', null, null, null, null, null, 1, 7, 7] });
process.stdout.write('MADE\n');
process.exit(0);

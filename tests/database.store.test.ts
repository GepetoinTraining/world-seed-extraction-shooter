// @vitest-environment node
/**
 * THE STABLE DATABASE (D31), the store's half. Registered before the build.
 *
 * Line 70: the same store contract passes on the SQLite file and on Postgres.
 *   One suite, three doors: a SQLite file through libSQL, Postgres in process
 *   (PGlite), and Postgres over the real wire through the `pg` driver, which is
 *   the door a deploy uses. No Postgres server is installed on this machine, so
 *   the wire door talks to PGlite through its socket server. That proves the
 *   driver, the SQL and the protocol; it does not prove a real server's
 *   concurrency, and the record says so.
 *
 * Line 71: a gold change and its ledger row commit together or not at all,
 *   across a killed process. The processes below are real and really killed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { openStore, SqlStore, StoreConflict } from '../server/SqlStore';
import { IWireDoc, ICommitRequest } from '../src/entities/data/wire';

const NS = { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' };
const ROOT = process.cwd();
const TSX = ['--import', 'tsx'];

function wire(id: string, namespace: string, data: unknown, extra: Partial<IWireDoc> = {}): IWireDoc {
  return {
    id,
    namespace,
    dataText: JSON.stringify(data),
    metadata: { createdAt: 1000, updatedAt: 2000, ownerCertUid: 'owner_a', version: 1, ...extra.metadata },
    ...(extra.embedding ? { embedding: extra.embedding } : {})
  };
}

function rowDoc(uid: string, seq: number, type = 'GOLD_DELTA', data: Record<string, any> = { amount: -1 }): IWireDoc {
  const signed = { payload: { seq, prevSeq: seq - 1, ts: 5000 + seq, type, data }, signature: `sig_${uid}_${seq}`, certUid: uid, timestamp: 9000 + seq };
  return {
    id: `ledger_${uid}_${seq.toString().padStart(8, '0')}`,
    namespace: NS.TRANSACTIONS,
    dataText: JSON.stringify(signed),
    metadata: { createdAt: 5000 + seq, updatedAt: 5000 + seq, ownerCertUid: uid, signature: signed.signature, version: 1 }
  };
}

const headDoc = (uid: string, seq: number): IWireDoc => wire(`ledger_head_${uid}`, NS.TRANSACTIONS, { seq }, { metadata: { createdAt: 1, updatedAt: 1, ownerCertUid: uid, version: 1 } });

const commit = (store: SqlStore, ops: ICommitRequest['ops'], extra: Partial<ICommitRequest> = {}) =>
  store.commit({ commitId: randomUUID(), ops, ...extra });

const put = (store: SqlStore, doc: IWireDoc) => commit(store, [{ kind: 'put', doc }]);

// ---------------------------------------------------------------------------
// THE THREE DOORS
// ---------------------------------------------------------------------------

interface IDoor { name: string; open: () => Promise<{ store: SqlStore; done: () => Promise<void> }> }

const dirs: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'ws-db-')); dirs.push(d); return d; };

const DOORS: IDoor[] = [
  {
    name: 'SQLite file (libSQL)',
    open: async () => {
      const dir = scratch();
      const store = await openStore(`file:${join(dir, 'contract.db').replace(/\\/g, '/')}`);
      return { store, done: () => store.close() };
    }
  },
  {
    name: 'Postgres in process (PGlite)',
    open: async () => {
      const store = await openStore('pglite://memory');
      return { store, done: () => store.close() };
    }
  },
  {
    name: 'Postgres over the wire (pg driver)',
    open: async () => {
      const db = await PGlite.create();
      const port = 15432 + Math.floor(Math.random() * 2000);
      const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
      await server.start();
      const store = await openStore(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { poolSize: 1 });
      return { store, done: async () => { await store.close(); await server.stop(); await db.close(); } };
    }
  }
];

afterAll(() => {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a held WAL file on Windows; the OS cleans temp */ } }
});

describe.each(DOORS)('line 70: the store contract on $name', ({ open }) => {
  let store: SqlStore;
  let done: () => Promise<void>;

  beforeAll(async () => { ({ store, done } = await open()); }, 60_000);
  afterAll(async () => { await done(); });

  // Each test takes fresh ids rather than a fresh database: opening PGlite costs seconds.
  let tag = '';
  beforeEach(() => { tag = randomUUID().slice(0, 8); });

  it('reports its own health and dialect', async () => {
    const health = await store.health();
    expect(health.ok).toBe(true);
    expect(['sqlite', 'postgres']).toContain(health.dialect);
  });

  it('returns null for what is not there, never an empty document', async () => {
    expect(await store.get(`absent_${tag}`)).toBeNull();
  });

  it('keeps a signed document byte-identical through the column', async () => {
    // Everything a re-serialization would quietly change: key order, integer-like
    // keys, float precision, exponents, escapes, astral and combining characters.
    const nasty = {
      payload: { z: 1, a: 2, '10': 'ten', '2': 'two', m: { y: [1, 2.5, -0.1, 1e21, 1.7976931348623157e308], x: null } },
      text: 'naïve é é 🐉 "quoted" \\ back \n line \t tab \u0000 nul   sep \ud800 lone',
      timestamp: 1730000000123.5,
      empty: { arr: [], obj: {} }
    };
    const text = JSON.stringify(nasty);
    const doc: IWireDoc = { id: `bytes_${tag}`, namespace: NS.CHARACTERS, dataText: text, metadata: { createdAt: 1, updatedAt: 2, ownerCertUid: 'o', signature: 's', version: 3 } };
    await put(store, doc);
    const back = await store.get(doc.id);
    expect(back!.dataText).toBe(text);
    expect(createHash('sha256').update(back!.dataText).digest('hex')).toBe(createHash('sha256').update(text).digest('hex'));
    expect(back!.metadata).toEqual(doc.metadata);
    expect(back!.namespace).toBe(NS.CHARACTERS);
  });

  it('overwrites on a second put, with one row', async () => {
    await put(store, wire(`up_${tag}`, NS.TERRITORIES, { v: 1 }));
    await put(store, wire(`up_${tag}`, NS.TERRITORIES, { v: 2 }, { metadata: { createdAt: 1000, updatedAt: 3000, version: 2 } }));
    const back = await store.get(`up_${tag}`);
    expect(JSON.parse(back!.dataText)).toEqual({ v: 2 });
    expect(back!.metadata.version).toBe(2);
    expect((await store.query({ namespace: NS.TERRITORIES, idPrefix: `up_${tag}` })).length).toBe(1);
  });

  it('holds an id longer than the old 100-character limit, and a very large document: no cap', async () => {
    const id = `long_${tag}_${'x'.repeat(4000)}`;
    const big = { rows: Array.from({ length: 200_000 }, (_, i) => [`tuple_${i}`, `item_${i}`]) };
    await put(store, wire(id, NS.ITEMS, big));
    const back = await store.get(id);
    expect(JSON.parse(back!.dataText).rows.length).toBe(200_000);
  }, 60_000);

  it('queries by namespace, in byte order of id, whatever the insert order and case', async () => {
    for (const id of ['b', 'a', 'C', 'a_', 'B', 'aa']) await put(store, wire(`ord_${tag}_${id}`, NS.WORLDS, { id }));
    const ids = (await store.query({ namespace: NS.WORLDS, idPrefix: `ord_${tag}_` })).map(d => d.id.split('_').slice(2).join('_'));
    expect(ids).toEqual(['B', 'C', 'a', 'a_', 'aa', 'b']);
  });

  it('treats an id prefix literally, with no wildcards and no case folding', async () => {
    await put(store, wire(`pre${tag}_%x`, NS.WORLDS, {}));
    await put(store, wire(`pre${tag}_ax`, NS.WORLDS, {}));
    await put(store, wire(`PRE${tag}_ax`, NS.WORLDS, {}));
    expect((await store.query({ namespace: NS.WORLDS, idPrefix: `pre${tag}_%` })).map(d => d.id)).toEqual([`pre${tag}_%x`]);
    expect((await store.query({ namespace: NS.WORLDS, idPrefix: `pre${tag}_` })).length).toBe(2);
  });

  it('filters on the indexed columns: data.type, data.genre, metadata.ownerCertUid', async () => {
    const type = `TYPE_${tag}`;
    await put(store, wire(`f1_${tag}`, NS.CONTENT, { type, genre: 'a', content: 1 }));
    await put(store, wire(`f2_${tag}`, NS.CONTENT, { type, genre: 'b', content: 2 }));
    await put(store, wire(`f3_${tag}`, NS.CONTENT, { type: 'OTHER', genre: 'a', content: 3 }, { metadata: { createdAt: 1, updatedAt: 1, ownerCertUid: `who_${tag}`, version: 1 } }));

    expect((await store.query({ namespace: NS.CONTENT, filter: { 'data.type': type } })).map(d => d.id)).toEqual([`f1_${tag}`, `f2_${tag}`]);
    expect((await store.query({ namespace: NS.CONTENT, filter: { 'data.type': type, 'data.genre': 'b' } })).map(d => d.id)).toEqual([`f2_${tag}`]);
    expect((await store.query({ namespace: NS.CONTENT, filter: { 'metadata.ownerCertUid': `who_${tag}` } })).map(d => d.id)).toEqual([`f3_${tag}`]);
  });

  it('filters on a path with no column too, and refuses a filter it cannot honor rather than ignoring it', async () => {
    await put(store, wire(`deep_${tag}`, NS.CONTENT, { nested: { marker: tag }, type: 'DEEP' }));
    await put(store, wire(`deep2_${tag}`, NS.CONTENT, { nested: { marker: 'other' }, type: 'DEEP' }));
    expect((await store.query({ namespace: NS.CONTENT, filter: { 'data.nested.marker': tag } })).map(d => d.id)).toEqual([`deep_${tag}`]);
    await expect(store.query({ namespace: NS.CONTENT, filter: { 'data.type': { $in: ['DEEP'] } } as any })).rejects.toThrow();
  });

  it('respects a limit only when asked, and has no default cap', async () => {
    const type = `MANY_${tag}`;
    await commit(store, Array.from({ length: 1500 }, (_, i) => ({ kind: 'put' as const, doc: wire(`many_${tag}_${i.toString().padStart(4, '0')}`, NS.CONTENT, { type, i }) })));
    expect((await store.query({ namespace: NS.CONTENT, filter: { 'data.type': type } })).length).toBe(1500);
    const one = await store.query({ namespace: NS.CONTENT, filter: { 'data.type': type }, limit: 1 });
    expect(one.map(d => d.id)).toEqual([`many_${tag}_0000`]);
  }, 60_000);

  it('runs vector search through the same interface: ranked, thresholded, limited, dimension-safe', async () => {
    const ns = NS.ITEMS;
    await put(store, wire(`vec_near_${tag}`, ns, { name: 'near', marker: tag }, { embedding: [1, 0, 0] }));
    await put(store, wire(`vec_mid_${tag}`, ns, { name: 'mid', marker: tag }, { embedding: [0.8, 0.6, 0] }));
    await put(store, wire(`vec_far_${tag}`, ns, { name: 'far', marker: tag }, { embedding: [0, 1, 0] }));
    await put(store, wire(`vec_dims_${tag}`, ns, { name: 'other model', marker: tag }, { embedding: [1, 0, 0, 0, 0] }));
    await put(store, wire(`vec_none_${tag}`, ns, { name: 'no vector', marker: tag }));
    const mine = (r: IWireDoc[]) => r.filter(d => d.id.endsWith(tag)).map(d => JSON.parse(d.dataText).name);

    expect(mine(await store.search({ namespace: ns, vector: [1, 0, 0], threshold: 0.7, limit: 100 }))).toEqual(['near', 'mid']);
    expect(mine(await store.search({ namespace: ns, vector: [1, 0, 0], threshold: 0.99, limit: 100 }))).toEqual(['near']);
    const back = await store.get(`vec_near_${tag}`);
    expect(back!.embedding).toEqual([1, 0, 0]);
  });

  it('commits a batch whole, and rolls every op back when one is refused', async () => {
    const uid = `atomic_${tag}`;
    await commit(store, [
      { kind: 'put', doc: wire(`keep_${tag}`, NS.CHARACTERS, { gold: 100 }) },
      { kind: 'put', doc: rowDoc(uid, 1) },
      { kind: 'put', doc: headDoc(uid, 1) }
    ]);
    const before = await store.get(`keep_${tag}`);

    await expect(commit(store, [
      { kind: 'put', doc: wire(`keep_${tag}`, NS.CHARACTERS, { gold: 90 }) },
      { kind: 'add', namespace: NS.TERRITORIES, id: `treasury_${tag}`, amount: 10, at: 1 },
      { kind: 'put', doc: rowDoc(uid, 5) } // a gap in the chain: refused
    ])).rejects.toBeInstanceOf(StoreConflict);

    expect((await store.get(`keep_${tag}`))!.dataText).toBe(before!.dataText);
    expect(await store.get(`treasury_${tag}`)).toBeNull();
    expect((await store.query({ namespace: NS.TRANSACTIONS, idPrefix: `ledger_${uid}_` })).length).toBe(1);
  });

  it('gives ledger rows a real table: routed by id, ordered, chained, append-only', async () => {
    const uid = `chain_${tag}`;
    for (let seq = 1; seq <= 3; seq++) await commit(store, [{ kind: 'put', doc: rowDoc(uid, seq) }, { kind: 'put', doc: headDoc(uid, seq) }]);

    expect(JSON.parse((await store.get(`ledger_head_${uid}`))!.dataText)).toEqual({ seq: 3 });
    expect((await store.get(`ledger_${uid}_00000002`))!.metadata.signature).toBe(`sig_${uid}_2`);
    expect((await store.query({ namespace: NS.TRANSACTIONS, idPrefix: `ledger_${uid}_` })).map(d => JSON.parse(d.dataText).payload.seq)).toEqual([1, 2, 3]);
    expect((await store.query({ namespace: NS.TRANSACTIONS, filter: { 'metadata.ownerCertUid': uid } })).length).toBe(3);

    // Replaying the identical row is a no-op; a different row at that seq is a fork.
    await commit(store, [{ kind: 'put', doc: rowDoc(uid, 2) }]);
    await expect(commit(store, [{ kind: 'put', doc: rowDoc(uid, 2, 'TAX', { tax: 999 }) }])).rejects.toBeInstanceOf(StoreConflict);
    // A chain never skips, and its head never moves away from its rows.
    await expect(commit(store, [{ kind: 'put', doc: rowDoc(uid, 9) }])).rejects.toBeInstanceOf(StoreConflict);
    await expect(commit(store, [{ kind: 'put', doc: headDoc(uid, 1) }])).rejects.toBeInstanceOf(StoreConflict);
    expect(JSON.parse((await store.get(`ledger_head_${uid}`))!.dataText)).toEqual({ seq: 3 });
  });

  it('keeps one owner\'s chain apart from another\'s, and lists every row across owners', async () => {
    const a = `one_${tag}`, b = `two_${tag}`;
    await commit(store, [{ kind: 'put', doc: rowDoc(a, 1) }, { kind: 'put', doc: rowDoc(b, 1) }, { kind: 'put', doc: rowDoc(b, 2) }]);
    expect((await store.query({ namespace: NS.TRANSACTIONS, idPrefix: `ledger_${a}_` })).length).toBe(1);
    expect((await store.query({ namespace: NS.TRANSACTIONS, idPrefix: `ledger_${b}_` })).length).toBe(2);
    const all = await store.query({ namespace: NS.TRANSACTIONS, idPrefix: 'ledger_' });
    expect(all.filter(d => d.id.includes(tag)).length).toBe(3);
  });

  it('adds to a treasury atomically: concurrent credits lose nothing', async () => {
    const id = `treasury_add_${tag}`;
    await Promise.all(Array.from({ length: 25 }, () => commit(store, [{ kind: 'add', namespace: NS.TERRITORIES, id, amount: 3, at: 7 }])));
    const doc = await store.get(id);
    expect(JSON.parse(doc!.dataText)).toEqual({ gold: 75 });
    expect(doc!.namespace).toBe(NS.TERRITORIES);
    await commit(store, [{ kind: 'add', namespace: NS.TERRITORIES, id, amount: -5, at: 8 }]);
    expect(JSON.parse((await store.get(id))!.dataText)).toEqual({ gold: 70 });
    expect((await store.query({ namespace: NS.TERRITORIES, idPrefix: id })).map(d => JSON.parse(d.dataText).gold)).toEqual([70]);
  });

  it('applies a commit once, however many times its request is retried', async () => {
    const id = `treasury_once_${tag}`;
    const req: ICommitRequest = { commitId: `retry_${tag}`, ops: [{ kind: 'add', namespace: NS.TERRITORIES, id, amount: 10, at: 1 }] };
    expect((await store.commit(req)).applied).toBe(true);
    expect((await store.commit(req)).applied).toBe(false);
    expect((await store.commit(req)).applied).toBe(false);
    expect(JSON.parse((await store.get(id))!.dataText)).toEqual({ gold: 10 });
  });

  it('honors a one-time guard: a one-time grant cannot land twice', async () => {
    const endow = `endowment_${tag}`, id = `treasury_endow_${tag}`;
    const grant = () => commit(store, [
      { kind: 'put', doc: wire(endow, NS.TERRITORIES, { gold: 100 }) },
      { kind: 'add', namespace: NS.TERRITORIES, id, amount: 100, at: 1 }
    ], { guardAbsent: endow });
    const results = await Promise.all([grant(), grant(), grant()]);
    expect(results.filter(r => r.applied).length).toBe(1);
    expect(JSON.parse((await store.get(id))!.dataText)).toEqual({ gold: 100 });
  });

  it('never overwrites through put-if-absent, on documents, rows and treasuries alike', async () => {
    const id = `abs_${tag}`, uid = `absent_${tag}`, tre = `treasury_abs_${tag}`;
    await commit(store, [{ kind: 'putIfAbsent', doc: wire(id, NS.CONTENT, { v: 'first' }) }]);
    await commit(store, [{ kind: 'putIfAbsent', doc: wire(id, NS.CONTENT, { v: 'second' }) }]);
    expect(JSON.parse((await store.get(id))!.dataText)).toEqual({ v: 'first' });

    await commit(store, [{ kind: 'putIfAbsent', doc: rowDoc(uid, 1) }]);
    await commit(store, [{ kind: 'putIfAbsent', doc: rowDoc(uid, 1, 'TAX', { tax: 5 }) }]);
    expect(JSON.parse((await store.get(`ledger_${uid}_00000001`))!.dataText).payload.type).toBe('GOLD_DELTA');

    await commit(store, [{ kind: 'putIfAbsent', doc: wire(tre, NS.TERRITORIES, { gold: 40 }) }]);
    await commit(store, [{ kind: 'putIfAbsent', doc: wire(tre, NS.TERRITORIES, { gold: 999 }) }]);
    expect(JSON.parse((await store.get(tre))!.dataText)).toEqual({ gold: 40 });
  });
});

// ---------------------------------------------------------------------------
// ONE CODE PATH: the two schemas must not drift apart
// ---------------------------------------------------------------------------

describe('line 70: one code path, no deploy-only surprises', () => {
  it('declares the same tables and columns for both dialects', async () => {
    const { getTableConfig: sqliteConfig } = await import('drizzle-orm/sqlite-core');
    const { getTableConfig: pgConfig } = await import('drizzle-orm/pg-core');
    const sqlite = await import('../server/schema.sqlite');
    const pg = await import('../server/schema.pg');
    const names = ['documents', 'ledgerRows', 'treasuries', 'commits'] as const;
    for (const name of names) {
      const a = sqliteConfig((sqlite as any)[name]);
      const b = pgConfig((pg as any)[name]);
      expect(a.name).toBe(b.name);
      expect(a.columns.map(c => c.name).sort()).toEqual(b.columns.map(c => c.name).sort());
      expect(a.indexes.map(i => i.config.name).sort()).toEqual(b.indexes.map(i => i.config.name).sort());
    }
  });

  it('stores signed text in a text column on Postgres, never jsonb, which would reorder it', () => {
    const src = readFileSync(join(ROOT, 'server/schema.pg.ts'), 'utf8');
    expect(src).not.toMatch(/jsonb?\(/);
  });

  it('has one store for both dialects: SQL is written once', () => {
    const src = readFileSync(join(ROOT, 'server/SqlStore.ts'), 'utf8');
    const dialectBranches = src.match(/dialect\s*===/g) ?? [];
    expect(dialectBranches.length).toBe(0);
    expect(src).not.toMatch(/\bfs\b|readFileSync/);
  });

  it('ships a migration for each dialect, and neither has drifted from its schema', async () => {
    const { getTableConfig: sqliteConfig } = await import('drizzle-orm/sqlite-core');
    const { getTableConfig: pgConfig } = await import('drizzle-orm/pg-core');
    const sqlite = await import('../server/schema.sqlite');
    const pg = await import('../server/schema.pg');
    for (const [folder, schema, config, tableKey] of [
      ['sqlite', sqlite, sqliteConfig, (n: string) => n],
      ['pg', pg, pgConfig, (n: string) => `public.${n}`]
    ] as const) {
      const journal = JSON.parse(readFileSync(join(ROOT, `drizzle/${folder}/meta/_journal.json`), 'utf8'));
      const latest = journal.entries[journal.entries.length - 1].idx.toString().padStart(4, '0');
      const snapshot = JSON.parse(readFileSync(join(ROOT, `drizzle/${folder}/meta/${latest}_snapshot.json`), 'utf8'));
      for (const name of ['documents', 'ledgerRows', 'treasuries', 'commits']) {
        const table = (config as any)((schema as any)[name]);
        const inMigration = snapshot.tables[(tableKey as any)(table.name)];
        expect(Object.keys(inMigration.columns).sort(), `${folder} ${table.name}`).toEqual(table.columns.map((c: any) => c.name).sort());
      }
    }
  });

  it('notes where pgvector fits', () => {
    expect(readFileSync(join(ROOT, 'server/schema.pg.ts'), 'utf8')).toMatch(/pgvector/);
  });
});

// ---------------------------------------------------------------------------
// LINE 71: REAL PROCESSES, REALLY KILLED
// ---------------------------------------------------------------------------

function goldLaw(chars: any[], rows: any[], treasuryGold: number, grant: number) {
  // The audit's own arithmetic over what survived on disk.
  const deltas = rows.map(r => JSON.parse(r.dataText).payload.data.amount as number);
  const gold = chars.length ? JSON.parse(chars[0].dataText).payload.bank.gold : grant;
  return {
    playerAgrees: gold === grant + deltas.reduce((s, d) => s + d, 0),
    treasuryAgrees: treasuryGold === -deltas.reduce((s, d) => s + d, 0),
    chainWhole: rows.every((r, i) => JSON.parse(r.dataText).payload.seq === i + 1)
  };
}

function runFixture(env: Record<string, string>): Promise<{ code: number | null; signal: string | null; stdout: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [...TSX, 'tests/fixtures/commit-killer.ts'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout!.on('data', b => { stdout += b; });
    child.on('exit', (code, signal) => resolve({ code, signal, stdout }));
  });
}

describe('line 71: all or nothing across a killed process', () => {
  // Every op of the commit, plus the moment before COMMIT itself.
  for (const stage of ['op:0', 'op:1', 'op:2', 'op:3', 'before-commit']) {
    it(`a process killed at ${stage} leaves the last whole commit and nothing of the next`, async () => {
      const file = join(scratch(), 'killed.db').replace(/\\/g, '/');
      const url = `file:${file}`;
      const run = await runFixture({ WS_KILL_URL: url, WS_KILL_AT: stage, WS_KILL_COMMITS: '3' });
      expect(run.code === 0).toBe(false); // it was killed, it did not finish
      expect(run.stdout).toContain('ACK 3');
      expect(run.stdout).not.toContain('ACK 4');

      const store = await openStore(url);
      const rows = await store.query({ namespace: NS.TRANSACTIONS, idPrefix: 'ledger_killed_' });
      const chars = [await store.get('killed')].filter(Boolean) as IWireDoc[];
      const treasury = JSON.parse((await store.get('treasury_hub'))!.dataText).gold;
      // Exactly the three acknowledged commits: the fourth left no trace at all.
      expect(rows.length).toBe(3);
      expect(treasury).toBe(30);
      expect(goldLaw(chars, rows, treasury, 500)).toEqual({ playerAgrees: true, treasuryAgrees: true, chainWhole: true });
      // And the store is still usable: the next append takes the next seq.
      const next = await commit(store, [{ kind: 'put', doc: rowDoc('killed', 4, 'GOLD_DELTA', { amount: -10 }) }]);
      expect(next.applied).toBe(true);
      await store.close();
    }, 60_000);
  }

  it('commits made after a kill land normally on the same file, over and over', async () => {
    const file = join(scratch(), 'again.db').replace(/\\/g, '/');
    const url = `file:${file}`;
    let acknowledged = 0;
    for (let round = 0; round < 4; round++) {
      const run = await runFixture({ WS_KILL_URL: url, WS_KILL_AT: 'op:2', WS_KILL_COMMITS: '2', WS_KILL_START: String(acknowledged) });
      expect(run.code === 0).toBe(false);
      acknowledged += 2;
    }
    const store = await openStore(url);
    const rows = await store.query({ namespace: NS.TRANSACTIONS, idPrefix: 'ledger_killed_' });
    expect(rows.length).toBe(acknowledged);
    const treasury = JSON.parse((await store.get('treasury_hub'))!.dataText).gold;
    expect(goldLaw([(await store.get('killed'))!], rows, treasury, 500)).toEqual({ playerAgrees: true, treasuryAgrees: true, chainWhole: true });
    await store.close();
  }, 120_000);

  it('a real server, hammered over HTTP and killed at a moment nobody chose, never splits a commit', async () => {
    const file = join(scratch(), 'hammered.db').replace(/\\/g, '/');
    const url = `file:${file}`;
    const uid = 'hammered';
    let seq = 0;
    let acknowledged = 0;

    for (let round = 0; round < 4; round++) {
      const port = 18000 + Math.floor(Math.random() * 2000);
      const child: ChildProcess = spawn(process.execPath, [...TSX, 'server/main.ts'], {
        cwd: ROOT,
        env: { ...process.env, WS_DATABASE_URL: url, WS_PORT: String(port), WS_NO_STATIC: '1' },
        stdio: 'ignore'
      });
      const base = `http://127.0.0.1:${port}/api/db`;
      for (let i = 0; i < 200; i++) {
        try { const r = await fetch(`${base}/health`); if (r.ok) break; } catch { /* still rising */ }
        await new Promise(r => setTimeout(r, 100));
      }

      // Kill it after a random stretch of work, while requests are in flight.
      const killAt = Date.now() + 50 + Math.random() * 250;
      let exitedCleanly = false;
      child.on('exit', () => { exitedCleanly = true; });
      const killer = setInterval(() => { if (Date.now() >= killAt) { clearInterval(killer); child.kill('SIGKILL'); } }, 5);

      while (!exitedCleanly) {
        const next = seq + 1;
        const gold = 500 - next * 10;
        const body: ICommitRequest = {
          commitId: randomUUID(),
          ops: [
            { kind: 'put', doc: wire(uid, NS.CHARACTERS, { payload: { bank: { gold } }, signature: 's', certUid: uid, timestamp: next }) },
            { kind: 'add', namespace: NS.TERRITORIES, id: 'treasury_hub', amount: 10, at: next },
            { kind: 'put', doc: rowDoc(uid, next, 'GOLD_DELTA', { amount: -10 }) },
            { kind: 'put', doc: headDoc(uid, next) }
          ]
        };
        try {
          const r = await fetch(`${base}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (r.ok) { seq = next; acknowledged = next; } else break;
        } catch {
          break;
        }
      }
      clearInterval(killer);
      child.kill('SIGKILL');
      await new Promise(r => setTimeout(r, 150));

      // The unacknowledged last commit may or may not have landed; it must be WHOLE either way.
      const store = await openStore(url);
      const rows = await store.query({ namespace: NS.TRANSACTIONS, idPrefix: `ledger_${uid}_` });
      const treasuryDoc = await store.get('treasury_hub');
      const treasury = treasuryDoc ? JSON.parse(treasuryDoc.dataText).gold : 0;
      const charDoc = await store.get(uid);
      expect(rows.length).toBeGreaterThanOrEqual(acknowledged);
      expect(rows.length).toBeLessThanOrEqual(acknowledged + 1);
      expect(goldLaw(charDoc ? [charDoc] : [], rows, treasury, 500)).toEqual({ playerAgrees: true, treasuryAgrees: true, chainWhole: true });
      seq = rows.length;
      await store.close();
    }
    expect(acknowledged).toBeGreaterThan(0);
  }, 180_000);

  it('two processes writing one file at once both land, and neither corrupts the other', async () => {
    const file = join(scratch(), 'shared.db').replace(/\\/g, '/');
    const url = `file:${file}`;
    const runs = await Promise.all(['alpha', 'beta'].map(owner => new Promise<number | null>(resolve => {
      const child = spawn(process.execPath, [...TSX, 'tests/fixtures/shared-writer.ts'], {
        cwd: ROOT, env: { ...process.env, WS_SHARED_URL: url, WS_SHARED_OWNER: owner }, stdio: 'inherit'
      });
      child.on('exit', code => resolve(code));
    })));
    expect(runs).toEqual([0, 0]);
    const store = await openStore(url);
    expect((await store.query({ namespace: NS.TRANSACTIONS, idPrefix: 'ledger_alpha_' })).length).toBe(50);
    expect((await store.query({ namespace: NS.TRANSACTIONS, idPrefix: 'ledger_beta_' })).length).toBe(50);
    expect(JSON.parse((await store.get('treasury_shared'))!.dataText)).toEqual({ gold: 100 });
    await store.close();
  }, 120_000);

  it('on Postgres too, a thrown op rolls the whole commit back', async () => {
    const faulted = await openStore('pglite://memory', { fault: stage => { if (stage === 'op:2') throw new Error('injected'); } });
    await expect(commit(faulted, [
      { kind: 'put', doc: wire('pg_char', NS.CHARACTERS, { gold: 1 }) },
      { kind: 'add', namespace: NS.TERRITORIES, id: 'treasury_pg', amount: 1, at: 1 },
      { kind: 'put', doc: rowDoc('pg', 1) }
    ])).rejects.toThrow('injected');
    expect(await faulted.get('pg_char')).toBeNull();
    expect(await faulted.get('treasury_pg')).toBeNull();
    expect(await faulted.get('ledger_pg_00000001')).toBeNull();
    await faulted.close();
  }, 60_000);
});


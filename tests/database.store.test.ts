// @vitest-environment node
/**
 * THE STABLE DATABASE (D31), the store's half. Registered before the build.
 *
 * Line 70: one store contract, every door Postgres comes through.
 *   Three doors: PGlite on a folder (the local game), PGlite in memory, and
 *   Postgres over the real wire through the `pg` driver, which is the door a
 *   served hub uses. No Postgres server is installed on this machine, so the wire
 *   door talks to PGlite through its socket server. That proves the driver, the
 *   SQL and the protocol; it does not prove a real server's concurrency, and the
 *   record says so.
 *
 * Line 71: a gold change and its ledger row commit together or not at all,
 *   across a killed process. The processes below are real and really killed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { folderUrl, openDatabase } from '../server/connection';
import { openStore, SqlStore, StoreConflict, StoreRefusal } from '../server/SqlStore';
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
    name: 'Postgres on a folder (PGlite)',
    open: async () => {
      const store = await openStore(folderUrl(join(scratch(), 'contract')));
      return { store, done: () => store.close() };
    }
  },
  {
    name: 'Postgres in memory (PGlite)',
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
    expect(health.dialect).toBe('postgres');
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

  it('holds a balance as the very number it was given, through a double and back', async () => {
    for (const [i, gold] of [0.1 + 0.2, 1 / 3, 1e21, 123456789.12345678, 1.7976931348623157e308, 5e-324, -0.07].entries()) {
      const id = `treasury_exact_${tag}_${i}`;
      await commit(store, [{ kind: 'put', doc: wire(id, NS.TERRITORIES, { gold }) }]);
      expect(JSON.parse((await store.get(id))!.dataText).gold).toBe(gold);
    }
    const id = `treasury_sum_${tag}`;
    await commit(store, [{ kind: 'add', namespace: NS.TERRITORIES, id, amount: 0.1, at: 1 }]);
    await commit(store, [{ kind: 'add', namespace: NS.TERRITORIES, id, amount: 0.2, at: 2 }]);
    expect(JSON.parse((await store.get(id))!.dataText).gold).toBe(0.1 + 0.2);
  });

  it('takes a fractional timestamp as the old store did, rather than losing the commit', async () => {
    const uid = `frac_${tag}`;
    const fraction = { createdAt: 1730000000123.5, updatedAt: 1730000000123.75, ownerCertUid: 'o', version: 1 };
    await commit(store, [{ kind: 'put', doc: { id: `frac_${tag}`, namespace: NS.CONTENT, dataText: '{"a":1}', metadata: fraction } }]);
    expect((await store.get(`frac_${tag}`))!.metadata.updatedAt).toBe(1730000000123);
    await commit(store, [{ kind: 'add', namespace: NS.TERRITORIES, id: `treasury_${uid}`, amount: 1, at: 1730000000123.5 }]);
    const row = rowDoc(uid, 1);
    const signed = JSON.parse(row.dataText);
    signed.payload.ts = 1730000000123.5;
    const text = JSON.stringify(signed);
    await commit(store, [{ kind: 'put', doc: { ...row, dataText: text, metadata: { ...row.metadata, createdAt: 1730000000123.5 } } }]);
    // The column loses the fraction. The signed text does not.
    expect((await store.get(row.id))!.dataText).toBe(text);
  });

  it('refuses what Postgres cannot hold, which a client must not retry forever', async () => {
    await expect(commit(store, [{ kind: 'put', doc: wire(`nul_${tag}`, NS.CONTENT, { type: 'has\u0000nul' }) }])).rejects.toBeInstanceOf(StoreRefusal);
    await expect(commit(store, [{ kind: 'put', doc: { ...wire(`big_${tag}`, NS.CONTENT, {}), metadata: { createdAt: 1, updatedAt: 1, version: 2 ** 40 } } }])).rejects.toBeInstanceOf(StoreRefusal);
    expect(await store.get(`nul_${tag}`)).toBeNull();
    expect((await commit(store, [{ kind: 'put', doc: wire(`after_${tag}`, NS.CONTENT, {}) }])).applied).toBe(true);
  });

  it('runs maintenance between commits and keeps every row', async () => {
    await put(store, wire(`kept_${tag}`, NS.CONTENT, { v: 1 }));
    expect(await store.maintain()).toEqual({ ok: true });
    expect(JSON.parse((await store.get(`kept_${tag}`))!.dataText)).toEqual({ v: 1 });
    expect((await put(store, wire(`kept_${tag}`, NS.CONTENT, { v: 2 }))).applied).toBe(true);
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
// ONE CODE PATH: one dialect, one schema
// ---------------------------------------------------------------------------

describe('line 70: one code path, no deploy-only surprises', () => {
  it('libSQL has left the server: only the tool that carries an old save still loads it', () => {
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => {
      const path = `${dir}/${name}`;
      return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
    });
    const sources = [...walk('server'), ...walk('src'), ...walk('scripts'), 'vite.config.ts', 'App.tsx', 'index.tsx'].filter(p => /\.tsx?$/.test(p));
    const loads = sources.filter(p => /@libsql|drizzle-orm\/libsql|sqlite-core|schema\.sqlite/.test(readFileSync(join(ROOT, p), 'utf8')));
    expect(loads).toEqual(['scripts/carry-save.ts']);
  });

  it('PGlite travels with the game, so nobody installs a database to play', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@electric-sql/pglite']).toBeTruthy();
    expect(pkg.dependencies.pg).toBeTruthy();
  });

  it('stores signed text in a text column on Postgres, never jsonb, which would reorder it', () => {
    const src = readFileSync(join(ROOT, 'server/schema.pg.ts'), 'utf8');
    expect(src).not.toMatch(/jsonb?\(/);
  });

  it('has one store: SQL is written once, and no branch asks which database it is on', () => {
    const src = readFileSync(join(ROOT, 'server/SqlStore.ts'), 'utf8');
    const dialectBranches = src.match(/dialect\s*===/g) ?? [];
    expect(dialectBranches.length).toBe(0);
    expect(src).not.toMatch(/\bfs\b|readFileSync/);
  });

  it('ships a migration that has not drifted from its schema', async () => {
    const { getTableConfig } = await import('drizzle-orm/pg-core');
    const pg = await import('../server/schema.pg');
    const journal = JSON.parse(readFileSync(join(ROOT, 'drizzle/pg/meta/_journal.json'), 'utf8'));
    const latest = journal.entries[journal.entries.length - 1].idx.toString().padStart(4, '0');
    const snapshot = JSON.parse(readFileSync(join(ROOT, `drizzle/pg/meta/${latest}_snapshot.json`), 'utf8'));
    for (const name of ['documents', 'ledgerRows', 'treasuries', 'commits']) {
      const table = getTableConfig((pg as any)[name]);
      const inMigration = snapshot.tables[`public.${table.name}`];
      expect(Object.keys(inMigration.columns).sort(), table.name).toEqual(table.columns.map((c: any) => c.name).sort());
      expect(Object.keys(inMigration.indexes).sort(), table.name).toEqual(table.indexes.map((i: any) => i.config.name).sort());
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
      const url = folderUrl(join(scratch(), 'killed'));
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

  it('commits made after a kill land normally on the same folder, over and over', async () => {
    const url = folderUrl(join(scratch(), 'again'));
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
    const url = folderUrl(join(scratch(), 'hammered'));
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

  it('a process killed while a fresh folder is still being made leaves one that opens', async () => {
    for (const after of [150, 400, 700, 1000, 1400]) {
      const folder = join(scratch(), 'halfmade');
      const url = folderUrl(folder);
      const child = spawn(process.execPath, [...TSX, 'tests/fixtures/commit-killer.ts'], {
        cwd: ROOT, env: { ...process.env, WS_KILL_URL: url, WS_KILL_AT: 'op:0', WS_KILL_COMMITS: '0' }, stdio: 'ignore'
      });
      const gone = new Promise<void>(resolve => { child.on('exit', () => resolve()); });
      await new Promise(r => setTimeout(r, after));
      child.kill('SIGKILL');
      await gone;
      const store = await openStore(url);
      expect((await commit(store, [{ kind: 'put', doc: rowDoc('fresh', 1) }])).applied).toBe(true);
      await store.close();
    }
  }, 120_000);

  it('on Postgres in memory, a thrown op rolls the whole commit back', async () => {
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


// ---------------------------------------------------------------------------
// ONE OPENER AT A TIME: SQLite let several servers share a file, and a folder does not
// ---------------------------------------------------------------------------

describe('one process holds a database folder at a time', () => {
  async function startServer(url: string, port: number): Promise<ChildProcess> {
    const child = spawn(process.execPath, [...TSX, 'server/main.ts'], {
      cwd: ROOT, env: { ...process.env, WS_DATABASE_URL: url, WS_PORT: String(port), WS_NO_STATIC: '1' }, stdio: 'ignore'
    });
    for (let i = 0; i < 200; i++) {
      try { await fetch(`http://127.0.0.1:${port}/api/db/health`); return child; } catch { /* still rising */ }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('it never answered');
  }
  const health = async (port: number) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/db/health`);
    return { status: r.status, body: await r.json() as { ok: boolean; reason?: string } };
  };
  const killed = (child: ChildProcess) => new Promise<void>(resolve => { child.on('exit', () => resolve()); child.kill('SIGKILL'); });

  it('a second server is refused in plain words, the first goes on, and when the first is gone the second opens', async () => {
    const url = folderUrl(join(scratch(), 'one-opener'));
    const a = 19000 + Math.floor(Math.random() * 1000);
    const b = a + 1000;
    const first = await startServer(url, a);
    for (let i = 0; i < 100 && (await health(a)).status !== 200; i++) await new Promise(r => setTimeout(r, 100));
    expect((await health(a)).status).toBe(200);

    const second = await startServer(url, b);
    try {
      const refused = await health(b);
      expect(refused.status).toBe(503);
      expect(refused.body.reason).toMatch(/one process holds a folder at a time/);
      expect(refused.body.reason).toContain(String(first.pid));

      const post = (port: number, path: string, body: unknown) => fetch(`http://127.0.0.1:${port}/api/db${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const doc = wire('still_mine', NS.CONTENT, { v: 1 });
      expect((await post(a, '/commit', { commitId: 'c1', ops: [{ kind: 'put', doc }] })).status).toBe(200);
      expect((await post(b, '/commit', { commitId: 'c2', ops: [{ kind: 'put', doc: wire('not_yours', NS.CONTENT, {}) }] })).status).toBe(503);
      expect((await health(a)).status).toBe(200);

      // A killed server cannot release its lock. The next look finds its holder dead.
      await killed(first);
      let opened = await health(b);
      for (let i = 0; i < 100 && opened.status !== 200; i++) { await new Promise(r => setTimeout(r, 100)); opened = await health(b); }
      expect(opened.status).toBe(200);
      const got = await (await post(b, '/get', { id: 'still_mine' })).json() as { doc: IWireDoc | null };
      expect(got.doc!.dataText).toBe(doc.dataText);
      const none = await (await post(b, '/get', { id: 'not_yours' })).json() as { doc: IWireDoc | null };
      expect(none.doc).toBeNull();
    } finally {
      first.kill('SIGKILL');
      await killed(second);
    }
  }, 120_000);

  it('a second open in one process waits for the first to close, as a restarted dev server needs', async () => {
    const url = folderUrl(join(scratch(), 'restart'));
    const first = await openDatabase(url);
    const second = openDatabase(url);
    await new Promise(r => setTimeout(r, 200));
    await first.close();
    await (await second).close();
  }, 60_000);

  it('several waiting in one process go one at a time, and none is refused for it', async () => {
    const url = folderUrl(join(scratch(), 'queue'));
    const first = await openDatabase(url);
    const waiting = [openDatabase(url), openDatabase(url), openDatabase(url)];
    await new Promise(r => setTimeout(r, 100));
    await first.close();
    for (let left = waiting.length; left > 0; left--) {
      const { held, at } = await Promise.race(waiting.map((p, at) => p.then(held => ({ held, at }))));
      waiting[at] = new Promise(() => undefined); // answered: out of the race
      await held.close();
    }
  }, 60_000);

  it('a second copy of the module in one process still waits: Vite loads this file afresh at every restart', async () => {
    const url = folderUrl(join(scratch(), 'twice'));
    const first = await openDatabase(url);
    vi.resetModules();
    const again = await import('../server/connection');
    expect(again.openDatabase).not.toBe(openDatabase);
    let opened = false;
    const second = again.openDatabase(url).then(d => { opened = true; return d; });
    await new Promise(r => setTimeout(r, 500));
    expect(opened).toBe(false);
    await first.close();
    await (await second).close();
  }, 60_000);

  it('a closed store stays closed: a request caught in a restart cannot open the folder again', async () => {
    const { lazyStore } = await import('../server/http');
    const url = folderUrl(join(scratch(), 'closed'));
    const lazy = lazyStore(() => openStore(url));
    await lazy.get();
    await lazy.close();
    await expect(lazy.get()).rejects.toThrow(/closing/);
    // So the folder is free for whoever comes next.
    await (await openDatabase(url)).close();
  }, 60_000);

  it('and refuses, in the end, if the first never does', async () => {
    const url = folderUrl(join(scratch(), 'never'));
    const first = await openDatabase(url);
    await expect(openDatabase(url)).rejects.toThrow(/one process holds a folder at a time/);
    await first.close();
  }, 60_000);

  it('a stale lock from a dead process does not stand in the way, and neither does a torn one', async () => {
    const folder = join(scratch(), 'stale');
    writeFileSync(`${folder}.lock`, JSON.stringify({ pid: 2 ** 22 + 13, at: 1 }));
    await (await openDatabase(folderUrl(folder))).close();
    writeFileSync(`${folder}.lock`, '{"pid":');
    await (await openDatabase(folderUrl(folder))).close();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// WHAT SINGLE-USER POSTGRES DOES NOT DO ALONE
// ---------------------------------------------------------------------------

describe('a folder stays small: no checkpointer and no autovacuum run in single-user Postgres', () => {
  const sizeOf = (p: string): number => {
    const s = statSync(p);
    return s.isDirectory() ? readdirSync(p).reduce((n, name) => n + sizeOf(join(p, name)), 0) : s.size;
  };

  it('tidies itself under repeated whole-document saves, and maintenance gives the space back', async () => {
    const folder = join(scratch(), 'tidy');
    const store = await openStore(folderUrl(folder));
    const meg = 1024 * 1024;
    // Random hex compresses about 2:1, harder than real hub JSON, so the bound below is the honest one.
    const noise = createHash('sha256').update('seed').digest('hex');
    const body = (i: number) => {
      let text = '';
      for (let n = 0; text.length < meg; n++) text += createHash('sha256').update(`${noise}${i}${n}`).digest('hex');
      return text;
    };
    for (let i = 0; i < 300; i++) await put(store, wire('hub_state_tidy', NS.TERRITORIES, { i, body: body(i) }));
    const after = sizeOf(folder) / meg;
    // Unmeasured, this is about 650 MB: a megabyte of log and half a megabyte of dead row per save.
    expect(after).toBeLessThan(300);

    await store.maintain();
    const compacted = sizeOf(folder) / meg;
    expect(compacted).toBeLessThan(after);
    expect(compacted).toBeLessThan(150);
    expect(JSON.parse((await store.get('hub_state_tidy'))!.dataText).i).toBe(299);
    await store.close();
  }, 180_000);
});

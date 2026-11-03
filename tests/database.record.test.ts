// @vitest-environment node
/**
 * THE RECORD (D133). Pedro: "one is cheap to store the other is the live service", and
 * "Use turso." Postgres runs the live game; the record is written at a downtime.
 *
 * WHAT THESE BARS ARE AND ARE NOT. The real network driver talks real HTTP to a real
 * process, in sqld's protocol, with SQLite underneath (tests/fixtures/record-double.ts).
 * They prove the driver path, the SQL and every failure this has to survive. They do not
 * prove Turso's limits, timing or rules. Nothing here has met Turso.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { ColdDoorRefused, assertNetworkUrl, openColdDoor, requestDeadlineMs } from '../server/coldStore';
import { DatabaseUnavailable, folderUrl, openDatabase } from '../server/connection';
import { RecordKeeper, openLiveStore, recordConfig } from '../server/record';
import { RECORD_TABLES } from '../server/recordRows';
import { SqlStore, openStore } from '../server/SqlStore';
import * as schema from '../server/schema.pg';

const ROOT = process.cwd();
const TSX = ['--disable-warning=ExperimentalWarning', '--import', 'tsx'];

const dirs: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'ws-record-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ } } });

// --- a stand-in for Turso, in its own process --------------------------------

interface IDouble { url: string; file: string; child: ChildProcess; port: number; stop: () => Promise<void>; fault: (mode: string, more?: { ms?: number; then?: string; times?: number }) => Promise<void>; sql: (text: string, args?: any[]) => Promise<any[]>; limit: (bytes: number) => Promise<void>; seen: () => Promise<{ pipelines: number; staged: number; crossings: number }> }

const toArg = (v: any) => (v === null ? { type: 'null' } : typeof v === 'number' ? { type: 'float', value: v } : { type: 'text', value: v });
const fromCell = (c: any) => (c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value);

async function startDouble(file = join(scratch(), 'record.sqlite'), token?: string): Promise<IDouble> {
  const port = 30000 + Math.floor(Math.random() * 15000);
  const child = spawn(process.execPath, [...TSX, 'tests/fixtures/record-double.ts', file, String(port), ...(token ? [token] : [])], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on('data', b => { if (String(b).includes('READY')) resolve(); });
    child.on('exit', code => reject(new Error(`The double stopped: ${code}`)));
  });
  child.removeAllListeners('exit');
  const url = `http://127.0.0.1:${port}`;
  return {
    url, file, child, port,
    stop: () => new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); child.on('exit', () => resolve()); child.kill('SIGKILL'); }),
    fault: async (mode, more = {}) => { await fetch(`${url}/__fault`, { method: 'POST', body: JSON.stringify({ mode, ...more }) }); },
    limit: async bytes => { await fetch(`${url}/__limit`, { method: 'POST', body: JSON.stringify({ bytes }) }); },
    seen: async () => (await (await fetch(`${url}/__seen`, { method: 'POST', body: '{}' })).json()) as any,
    sql: async (text, args = []) => {
      const res = await fetch(`${url}/__sql`, { method: 'POST', body: JSON.stringify({ sql: text, args: args.map(toArg) }) });
      return ((await res.json()) as any).rows.map((row: any[]) => row.map(fromCell));
    }
  };
}

// --- a live store with a keeper ----------------------------------------------

const meta = (at = 1000) => ({ createdAt: at, updatedAt: at, ownerCertUid: 'o', version: 1 });
const doc = (id: string, namespace: string, data: unknown) => ({ id, namespace, dataText: typeof data === 'string' ? data : JSON.stringify(data), metadata: meta() });
const put = (store: SqlStore, d: ReturnType<typeof doc>) => store.commit({ commitId: randomUUID(), ops: [{ kind: 'put', doc: d }] });
const rowDoc = (uid: string, seq: number, amount = -1) => {
  const signed = { payload: { seq, prevSeq: seq - 1, ts: 5000 + seq, type: 'GOLD_DELTA', data: { amount, treasuryDelta: -amount } }, signature: `sig_${uid}_${seq}`, certUid: uid, timestamp: seq };
  return { id: `ledger_${uid}_${seq.toString().padStart(8, '0')}`, namespace: 'transactions', dataText: JSON.stringify(signed), metadata: { createdAt: 5000 + seq, updatedAt: 5000 + seq, ownerCertUid: uid, signature: signed.signature, version: 1 } };
};

const NASTY = JSON.stringify({ payload: { z: 1, a: 2, '10': 'ten', '2': 'two' }, text: 'naïve é é 🐉 "quoted" \\ back \n line \t tab \u0000 nul \ud800 lone', t: 1730000000123.5 });

let double: IDouble;
const opened: { close: () => Promise<void> }[] = [];

async function live(url: string, config: { on: boolean; url?: string; authToken?: string } = { on: true, url: double.url }, options: any = {}) {
  const database = await openDatabase(url);
  const said: string[] = [];
  const keeper = new RecordKeeper(database, config, { say: l => said.push(l), retryFirstMs: 60_000, ...options });
  const go = await keeper.goLive();
  const store = new SqlStore(database, {}, keeper);
  const handle = { store, keeper, database, said, go, close: () => store.close() };
  opened.push(handle);
  return handle;
}
const closeOut = async () => { for (const h of opened.splice(0)) await h.close().catch(() => undefined); };

const folder = () => folderUrl(join(scratch(), 'live'));

beforeEach(async () => { double = await startDouble(); }, 30_000);
afterEach(async () => { await closeOut(); await double.stop(); });

// ---------------------------------------------------------------------------

describe('the door takes the network and nothing else', () => {
  it('refuses a file, whatever it is called, before the driver can see it', async () => {
    for (const url of ['file:data/x.db', 'file:///D:/x.db', ':memory:', 'data/x.db', 'FILE:x.db']) {
      expect(() => assertNetworkUrl(url), url).toThrow(ColdDoorRefused);
      await expect(openColdDoor({ url }), url).rejects.toBeInstanceOf(ColdDoorRefused);
    }
    for (const url of ['libsql://x.turso.io', 'https://x.turso.io', 'http://127.0.0.1:8080']) expect(() => assertNetworkUrl(url), url).not.toThrow();
  });

  it('exercising the door loads no native module at all', () => {
    const script = `
      const hits = []; const real = process.dlopen; process.dlopen = (m, f, ...r) => { hits.push(f); return real(m, f, ...r); };
      const { openColdDoor } = await import('./server/coldStore.ts');
      const door = await openColdDoor({ url: 'http://127.0.0.1:9' });
      await door.head().catch(() => undefined); door.close();
      process.stdout.write('NATIVE ' + JSON.stringify(hits.filter(f => /libsql/i.test(f))));`;
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' });
    expect(run.stdout).toContain('NATIVE []');
    expect(run.status).toBe(0);
  }, 60_000);

  it('holds the same four tables as the live store, column by column, in its own migration set', async () => {
    const door = await openColdDoor({ url: double.url });
    expect(await door.head()).toBeNull();
    door.close();
    for (const [table, shape] of [[schema.documents, 'documents'], [schema.ledgerRows, 'ledger_rows'], [schema.treasuries, 'treasuries'], [schema.commits, 'commits']] as const) {
      const pg = getTableConfig(table as any).columns.map(c => c.name).sort();
      const cold = (await double.sql(`SELECT name FROM pragma_table_info('${shape}')`)).map(r => r[0]).sort();
      expect(cold, shape).toEqual(pg);
      expect(RECORD_TABLES.find(t => t.name === shape)!.columns.slice().sort(), shape).toEqual(pg);
    }
    expect(readdirSync(join(ROOT, 'drizzle/cold')).length).toBeGreaterThan(0);
    expect(existsSync(join(ROOT, 'drizzle/sqlite'))).toBe(false);
  }, 30_000);

  it('a wrong token is a refusal of its own, and is said as an outage too', async () => {
    const guarded = await startDouble(join(scratch(), 'guarded.sqlite'), 'the-token');
    try {
      const wrong = await live(folder(), { on: true, url: guarded.url, authToken: 'not-the-token' });
      await put(wrong.store, doc('a', 'content', {}));
      expect((await wrong.keeper.writeDown('test')).status).toBe('WAITING');
      expect((await wrong.keeper.status()).says).toContain('400');
    } finally {
      await closeOut();
      await guarded.stop();
    }
  }, 60_000);

  it('migrates once, however many doors open on it', async () => {
    for (let i = 0; i < 3; i++) { const door = await openColdDoor({ url: double.url }); await door.head(); door.close(); }
    expect((await double.sql('SELECT COUNT(*) FROM cold_migrations'))[0][0]).toBe(readdirSync(join(ROOT, 'drizzle/cold')).filter(n => n.endsWith('.sql')).length);
  }, 30_000);

  it('a record with a token refuses without it, and says so as an outage rather than a lie', async () => {
    const guarded = await startDouble(join(scratch(), 'guarded.sqlite'), 'the-token');
    try {
      const without = await live(folder(), { on: true, url: guarded.url });
      await put(without.store, doc('a', 'content', {}));
      expect((await without.keeper.writeDown('test')).status).toBe('WAITING');
      await without.close();
      const withIt = await live(folder(), { on: true, url: guarded.url, authToken: 'the-token' });
      await put(withIt.store, doc('a', 'content', {}));
      expect((await withIt.keeper.writeDown('test')).status).toBe('WRITTEN');
    } finally {
      await closeOut();
      await guarded.stop();
    }
  }, 60_000);
});

describe('what asks for a record, and what never does', () => {
  it('nothing does unless told: a .env holding a URL does not send a test server anywhere', () => {
    expect(recordConfig({ TURSO_DATABASE_URL: 'libsql://x', TURSO_AUTH_TOKEN: 't' }).on).toBe(false);
    expect(recordConfig({ WS_RECORD: '1' })).toEqual({ on: true, url: undefined, authToken: undefined });
    expect(recordConfig({ WS_RECORD: '1', TURSO_DATABASE_URL: ' libsql://x ', TURSO_AUTH_TOKEN: '' })).toEqual({ on: true, url: 'libsql://x', authToken: undefined });
  });

  it('npm run pedro asks, and nothing else does', () => {
    expect(readFileSync(join(ROOT, 'scripts/pedro.ts'), 'utf8')).toMatch(/WS_RECORD: '1'/);
    for (const file of ['server/main.ts', 'server/vitePlugin.ts', '.claude/launch.json', 'package.json']) expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/WS_RECORD: '1'|WS_RECORD=1 /);
  });

  it('the token stays on the server: no browser code reads it, and the example holds none', () => {
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => {
      const path = `${dir}/${name}`;
      return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
    });
    const browser = [...walk('src'), 'App.tsx', 'index.tsx'].filter(p => /\.tsx?$/.test(p));
    expect(browser.filter(p => /TURSO|VITE_TURSO|libsql:/.test(readFileSync(join(ROOT, p), 'utf8')))).toEqual([]);
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(example).toMatch(/^TURSO_DATABASE_URL=$/m);
    expect(example).toMatch(/^TURSO_AUTH_TOKEN=$/m);
  });
});

describe('a commit and its mark, and no network in between', () => {
  it('a commit marks what it wrote, and a refused one marks nothing', async () => {
    const h = await live(folder());
    await put(h.store, doc('kept', 'content', { v: 1 }));
    const before = (await h.keeper.status()).behind;
    expect(before).toBeGreaterThan(0);
    await expect(h.store.commit({ commitId: randomUUID(), ops: [
      { kind: 'put', doc: doc('not_kept', 'content', {}) },
      { kind: 'put', doc: rowDoc('gap', 9) }
    ] })).rejects.toThrow();
    expect((await h.keeper.status()).behind).toBe(before);
  }, 30_000);

  it('a document saved many times is one mark', async () => {
    const h = await live(folder());
    for (let i = 0; i < 20; i++) await h.store.commit({ commitId: `same_${i}`, ops: [{ kind: 'put', doc: doc('hub_state_one', 'territories', { i }) }] });
    // One document, and each commit's own row.
    expect((await h.keeper.status()).behind).toBe(21);
  }, 30_000);

  it('a commit lands at once while a write-down is stuck on a slow record', async () => {
    let readTheMarks = () => {};
    const marksRead = new Promise<void>(r => { readTheMarks = r; });
    const h = await live(folder(), undefined, { fault: (stage: string) => { if (stage === 'pending') readTheMarks(); } });
    await put(h.store, doc('first', 'content', {}));
    await double.fault('slow', { ms: 1500 });
    const going = h.keeper.writeDown('test');
    await marksRead;
    const began = performance.now();
    await put(h.store, doc('during', 'content', { v: 1 }));
    expect(performance.now() - began).toBeLessThan(800);
    await double.fault('none');
    expect((await going).status, h.said.join(' ')).toBe('WRITTEN');
    // What landed during it was not covered, and stays marked.
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'during'`))[0][0]).toBe(0);
    expect((await h.keeper.status()).behind).toBeGreaterThan(0);
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'during'`))[0][0]).toBe(1);
  }, 30_000);
});

describe('a dropped connection is not a record that stopped answering', () => {
  it('an answer lost once: applied once, called saved once it is read back, and nobody is told of an outage', async () => {
    const h = await live(folder());
    await put(h.store, doc('a', 'content', { v: 1 }));
    await double.fault('lost-answer');
    expect((await h.keeper.writeDown('test')).status, h.said.join(' ')).toBe('WRITTEN');
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(1);
    expect((await h.keeper.status())).toMatchObject({ state: 'READY', behind: 0 });
    expect(h.said.filter(l => l.includes('not answering'))).toEqual([]);
  }, 30_000);

  it('a connection dropped while a new folder comes up: it still comes up whole', async () => {
    const first = await live(folder());
    for (let i = 0; i < 3; i++) await put(first.store, doc(`doc_${i}`, 'content', { i }));
    expect((await first.keeper.writeDown('test')).status).toBe('WRITTEN');
    await first.close();

    await double.fault('drop', { times: 1 });
    const second = await live(folder());
    expect(second.said.filter(l => l.includes('not answering'))).toEqual([]);
    expect((await second.keeper.status())).toMatchObject({ state: 'READY', behind: 0 });
    for (let i = 0; i < 3; i++) expect(await second.store.get(`doc_${i}`), `doc_${i}`).not.toBeNull();
  }, 60_000);

  it('a connection that keeps dropping is an outage, and says so once', async () => {
    const h = await live(folder(), undefined, { retryFirstMs: 60_000 });
    await put(h.store, doc('a', 'content', { v: 1 }));
    await double.fault('drop', { times: 1000 });
    expect((await h.keeper.writeDown('test')).status).toBe('WAITING');
    expect((await h.keeper.writeDown('test')).status).toBe('WAITING');
    expect(h.said.filter(l => l.includes('not answering')).length).toBe(1);
    expect((await h.keeper.status()).behind).toBeGreaterThan(0);
  }, 30_000);
});

describe('a write-down goes up in as few requests as the record takes', () => {
  it('one that fits goes up in one request, with nothing staged', async () => {
    const h = await live(folder());
    await h.store.commit({ commitId: randomUUID(), ops: [
      { kind: 'put', doc: doc('hub_state_big', 'territories', { body: 'h'.repeat(1_300_000) }) },
      ...Array.from({ length: 40 }, (_, i) => ({ kind: 'put' as const, doc: rowDoc('a', i + 1) })),
      { kind: 'add', namespace: 'territories', id: 'treasury_hub', amount: 40, at: 1 }
    ] });
    await double.seen();
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    const seen = await double.seen();
    expect(seen.staged).toBe(0);
    expect(seen.crossings).toBe(1);
    expect((await double.sql('SELECT COUNT(*) FROM ledger_rows'))[0][0]).toBe(40);
  }, 60_000);

  it('one the record refuses as too large is halved until it is taken, and still lands whole and once', async () => {
    const h = await live(folder());
    await double.limit(8_000);
    await h.store.commit({ commitId: randomUUID(), ops: [
      ...Array.from({ length: 6 }, (_, i) => ({ kind: 'put' as const, doc: doc(`hub_part_${i}`, 'territories', { body: 'p'.repeat(3_000) }) })),
      ...Array.from({ length: 12 }, (_, i) => ({ kind: 'put' as const, doc: rowDoc('a', i + 1) }))
    ] });
    await double.seen();
    const receipt = await h.keeper.writeDown('test');
    expect(receipt.status).toBe('WRITTEN');
    const seen = await double.seen();
    expect(seen.staged).toBeGreaterThan(0);
    expect((await double.sql('SELECT COUNT(*) FROM documents'))[0][0]).toBe(6);
    expect((await double.sql('SELECT COUNT(*) FROM ledger_rows'))[0][0]).toBe(12);
    expect((await double.sql('SELECT id FROM cold_writedowns')).flat()).toEqual([receipt.id]);
    expect((await double.sql('SELECT COUNT(*) FROM cold_stage_documents'))[0][0]).toBe(0);
    expect((await h.keeper.status()).behind).toBe(0);
  }, 60_000);

  it('one row larger than any request the record takes: nothing is written, and it waits', async () => {
    // Set once the record is migrated: its migration goes up in one request of its own.
    const h = await live(folder());
    await double.limit(5_000);
    await put(h.store, doc('hub_state_big', 'territories', { body: 'h'.repeat(8_000) }));
    expect((await h.keeper.writeDown('test')).status).toBe('WAITING');
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(0);
    expect((await h.keeper.status()).behind).toBeGreaterThan(0);
  }, 60_000);

  it('a request has longer to answer the more it carries, from what Turso took', () => {
    const MB = 1024 * 1024;
    expect(requestDeadlineMs(0)).toBeGreaterThanOrEqual(10_000);
    // Measured: 16 MB once took 25 s to go up, and 64 MB took 11.5 s.
    expect(requestDeadlineMs(16 * MB)).toBeGreaterThan(2 * 25_000);
    expect(requestDeadlineMs(64 * MB)).toBeGreaterThan(requestDeadlineMs(16 * MB));
  });
});

describe('a write-down: whole, once, and verifiable', () => {
  // Met on Turso: about one fractional balance in five is read one step off when it goes up as a float.
  const FRACTIONS = [114.10000000000001, 110.80000000000003, 103.00000000000001, 91.99999999999999, 36.300000000000004, 96.00000000000001, 1000000 / 3, 7654321 * 0.07, 123456789012345680000];

  it('the stand-in reads a float as the real server does, so the next bar can fail', async () => {
    const [[echo]] = await double.sql('SELECT ?', [FRACTIONS[0]]);
    expect(echo).not.toBe(FRACTIONS[0]);
    expect(echo).toBeCloseTo(FRACTIONS[0], 9);
  }, 30_000);

  it('a balance with many digits goes up and comes back the same number', async () => {
    const h = await live(folder());
    await h.store.commit({ commitId: randomUUID(), ops: [
      ...FRACTIONS.map((gold, i) => ({ kind: 'put' as const, doc: doc(`treasury_fraction_${i}`, 'territories', { gold }) })),
      { kind: 'add', namespace: 'territories', id: 'wallet_a__b', amount: FRACTIONS[1], at: 7 }
    ] });
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    for (const [i, gold] of FRACTIONS.entries()) {
      expect((await double.sql(`SELECT gold FROM treasuries WHERE id = 'treasury_fraction_${i}'`))[0][0]).toBe(gold);
    }
    expect((await double.sql(`SELECT typeof(gold) FROM treasuries GROUP BY 1`)).flat()).toEqual(['real']);
    await closeOut();

    const again = await live(folderUrl(join(scratch(), 'again')));
    expect(again.go.loaded).toBeGreaterThan(0);
    for (const [i, gold] of FRACTIONS.entries()) {
      expect(JSON.parse((await again.store.get(`treasury_fraction_${i}`))!.dataText).gold).toBe(gold);
    }
  }, 60_000);

  // On Turso a batch whose sender was stopped still lands, some time after the sender is gone.
  it('a send that lands while its own second try is on the way is the same write-down, not another save', async () => {
    const first = await openColdDoor({ url: double.url });
    const second = await openColdDoor({ url: double.url });
    const down = { id: 'wd_same', prev: null, why: 'test', at: 1, digest: 'd', rows: { commits: [{ id: 'c', at: 1 }] } };
    const result = await first.writeDown(down, async stage => {
      if (stage === 'sending') expect((await second.writeDown(down)).status).toBe('APPLIED');
    });
    expect(result.status).toBe('ALREADY');
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(1);
    first.close();
    second.close();
  }, 30_000);

  it('carries all four tables, signed text byte for byte, numbers exact', async () => {
    const h = await live(folder());
    await h.store.commit({ commitId: 'the_one', ops: [
      { kind: 'put', doc: { ...doc('ws_a', 'characters', NASTY), metadata: { ...meta(1730000000999), signature: 's' } } },
      { kind: 'put', doc: rowDoc('a', 1) },
      { kind: 'put', doc: doc('treasury_exact', 'territories', { gold: 0.1 + 0.2 }) },
      { kind: 'add', namespace: 'territories', id: 'wallet_a__b', amount: 1 / 3, at: 7 }
    ] });
    const receipt = await h.keeper.writeDown('test');
    expect(receipt.status).toBe('WRITTEN');
    expect(receipt.digest).toMatch(/^[0-9a-f]{64}$/);

    expect((await double.sql(`SELECT data, updated_at, signature FROM documents WHERE id = 'ws_a'`))[0]).toEqual([NASTY, 1730000000999, 's']);
    expect((await double.sql(`SELECT data FROM ledger_rows`))[0][0]).toBe(rowDoc('a', 1).dataText);
    expect((await double.sql(`SELECT gold FROM treasuries WHERE id = 'treasury_exact'`))[0][0]).toBe(0.1 + 0.2);
    expect((await double.sql(`SELECT gold FROM treasuries WHERE id = 'wallet_a__b'`))[0][0]).toBe(1 / 3);
    expect((await double.sql(`SELECT COUNT(*) FROM commits WHERE id = 'the_one'`))[0][0]).toBe(1);
    expect((await double.sql(`SELECT id, rows, digest, why FROM cold_writedowns`))[0]).toEqual([receipt.id, receipt.rows, receipt.digest, 'test']);
    expect((await h.keeper.status()).behind).toBe(0);
    expect((await h.keeper.status()).last).toBe(receipt.id);
  }, 30_000);

  it('with nothing new there is nothing to send, and no empty manifest', async () => {
    const h = await live(folder());
    await put(h.store, doc('a', 'content', {}));
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    expect((await h.keeper.writeDown('test')).status).toBe('NOTHING');
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(1);
  }, 30_000);

  it('each one names the one before it, and a changed row goes up changed', async () => {
    const h = await live(folder());
    await put(h.store, doc('a', 'content', { v: 1 }));
    const first = await h.keeper.writeDown('test');
    await put(h.store, doc('a', 'content', { v: 2 }));
    const second = await h.keeper.writeDown('test');
    expect((await double.sql(`SELECT prev FROM cold_writedowns WHERE id = '${second.id}'`))[0][0]).toBe(first.id);
    expect((await double.sql(`SELECT data FROM documents WHERE id = 'a'`))[0][0]).toBe('{"v":2}');
  }, 30_000);

  it('rows larger than one request land whole, and nothing is left staged', async () => {
    const h = await live(folder());
    const big = 'x'.repeat(1_400_000);
    await h.store.commit({ commitId: randomUUID(), ops: ['one', 'two', 'three', 'four'].map(id => ({ kind: 'put' as const, doc: doc(`hub_state_${id}`, 'territories', { id, big }) })) });
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE length(data) > 1400000`))[0][0]).toBe(4);
    expect((await double.sql('SELECT COUNT(*) FROM cold_stage_documents'))[0][0]).toBe(0);
  }, 60_000);

  it('an answer lost on the way back: applied once, and the retry says so instead of sending it again', async () => {
    const h = await live(folder());
    await put(h.store, doc('a', 'content', { v: 1 }));
    await double.fault('lost-answer', { then: 'refuse' });
    expect((await h.keeper.writeDown('test')).status).toBe('WAITING');
    // It did land. The keeper does not know, and has kept its marks.
    await double.fault('none');
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(1);
    expect((await h.keeper.status()).behind).toBeGreaterThan(0);

    // More play, then the retry: it finds the one that landed, and sends only what is new.
    await put(h.store, doc('b', 'content', { v: 2 }));
    const receipt = await h.keeper.writeDown('retry');
    expect(receipt.status).toBe('WRITTEN');
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(2);
    expect((await double.sql('SELECT why, rows FROM cold_writedowns ORDER BY seq'))[1][1]).toBe(2);
    expect((await h.keeper.status()).behind).toBe(0);
  }, 30_000);

  it('two databases on one record: the second is refused, says so, and writes nothing', async () => {
    const a = await live(folder());
    await put(a.store, doc('from_a', 'content', {}));
    expect((await a.keeper.writeDown('test')).status).toBe('WRITTEN');

    const b = await openDatabase(folder());
    const said: string[] = [];
    const bKeeper = new RecordKeeper(b, { on: true, url: double.url }, { say: l => said.push(l) });
    const bStore = new SqlStore(b, {}, bKeeper);
    opened.push({ close: () => bStore.close() });
    await put(bStore, doc('from_b', 'content', {}));
    await bKeeper.goLive();
    expect((await bKeeper.status()).state).toBe('MOVED');
    expect((await bKeeper.writeDown('test')).status).toBe('MOVED');
    expect(said.join()).toMatch(/holds a save this database did not come from/);
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'from_b'`))[0][0]).toBe(0);
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'from_a'`))[0][0]).toBe(1);
  }, 60_000);

  it('a signed row that would change on the record is refused whole', async () => {
    const door = await openColdDoor({ url: double.url });
    await door.head();
    door.close();
    const h = await live(folder());
    await h.store.commit({ commitId: randomUUID(), ops: [{ kind: 'put', doc: rowDoc('a', 1) }, { kind: 'put', doc: doc('alongside', 'content', {}) }] });
    // Someone else's history at that place, with no write-down of its own to warn of it.
    await double.sql(`INSERT INTO ledger_rows (id, owner_uid, seq, prev_seq, ts, type, signature, data, version, created_at, updated_at) VALUES ('${rowDoc('a', 1).id}', 'a', 1, 0, 1, 'GOLD_DELTA', 'other', '{"other":true}', 1, 1, 1) RETURNING id`);
    const receipt = await h.keeper.writeDown('test');
    expect(receipt.status).toBe('FORK');
    expect(receipt.says).toMatch(/a chain only appends/);
    expect((await double.sql(`SELECT data FROM ledger_rows`))[0][0]).toBe('{"other":true}');
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'alongside'`))[0][0]).toBe(0);
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(0);
  }, 30_000);
});

describe('no record, or none answering: the game goes on', () => {
  it('none set up: commits land, it says so once, and it never claims to have saved', async () => {
    const h = await live(folder(), { on: true });
    expect((await put(h.store, doc('a', 'content', {}))).applied).toBe(true);
    expect((await h.keeper.writeDown('gate')).status).toBe('NO_RECORD');
    await h.keeper.writeDown('gate');
    const status = await h.keeper.status();
    expect(status.state).toBe('NONE');
    expect(status.says).toMatch(/kept on this machine only/);
    expect(status.behind).toBeGreaterThan(0);
    expect(h.said.length).toBe(1);
    expect((await h.store.maintain()).ok).toBe(true);
  }, 30_000);

  it('a game that never asked has no record to speak of, and health says nothing', async () => {
    const store = await openStore('pglite://memory');
    const health = await store.health();
    expect(health.record).toBeUndefined();
    expect((await store.writeDown('gate')).status).toBe('NO_RECORD');
    await store.close();
  }, 30_000);

  it('the record gone: commits land at once, it is told once, and the write-down lands when it returns', async () => {
    const h = await live(folder(), undefined, { retryFirstMs: 200 });
    await put(h.store, doc('before', 'content', {}));
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    await double.fault('refuse');

    await put(h.store, doc('during', 'content', { v: 1 }));
    expect((await h.keeper.writeDown('gate')).status).toBe('WAITING');
    await put(h.store, doc('during2', 'content', { v: 2 }));
    await new Promise(r => setTimeout(r, 600));
    await h.keeper.writeDown('gate');
    const waiting = await h.keeper.status();
    expect(waiting.state).toBe('WAITING');
    expect(waiting.says).toMatch(/not answering/);
    expect(waiting.behind).toBeGreaterThan(0);
    expect(h.said.filter(l => l.includes('not answering')).length).toBe(1);
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'during'`))[0][0]).toBe(0);

    await double.fault('none');
    for (let i = 0; i < 60 && (await h.keeper.status()).state !== 'READY'; i++) await new Promise(r => setTimeout(r, 100));
    const back = await h.keeper.status();
    expect(back.state).toBe('READY');
    expect(back.says).toBeUndefined();
    expect(back.behind).toBe(0);
    expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id IN ('during', 'during2')`))[0][0]).toBe(2);
  }, 60_000);

  it('a record killed outright changes nothing for play, and comes back from its own file', async () => {
    const file = double.file;
    const h = await live(folder(), undefined, { retryFirstMs: 60_000 });
    await put(h.store, doc('before', 'content', {}));
    expect((await h.keeper.writeDown('test')).status).toBe('WRITTEN');
    await double.stop();

    expect((await put(h.store, doc('during', 'content', {}))).applied).toBe(true);
    expect((await h.keeper.writeDown('gate')).status).toBe('WAITING');
    await closeOut();
    double = await startDouble(file);
  }, 60_000);

  it('a clean stop with no record answering does not hold a person at the door for long', async () => {
    const h = await live(folder(), { on: true, url: 'http://127.0.0.1:9' });
    await put(h.store, doc('a', 'content', {}));
    const began = performance.now();
    await h.close();
    expect(performance.now() - began).toBeLessThan(20_000);
  }, 40_000);
});

describe('coming up from the record', () => {
  it('a new database loads the save byte for byte, marks nothing, and owes nothing', async () => {
    const first = await live(folder());
    await first.store.commit({ commitId: 'c1', ops: [
      { kind: 'put', doc: { ...doc('ws_a', 'characters', NASTY), metadata: { ...meta(1730000000999), signature: 's' } } },
      { kind: 'put', doc: rowDoc('a', 1) },
      { kind: 'put', doc: doc('treasury_exact', 'territories', { gold: 0.1 + 0.2 }) }
    ] });
    await first.close();

    const second = await live(folder());
    expect(second.go.loaded).toBeGreaterThan(0);
    expect((await second.store.get('ws_a'))!.dataText).toBe(NASTY);
    expect((await second.store.get('ws_a'))!.metadata.updatedAt).toBe(1730000000999);
    expect((await second.store.get(rowDoc('a', 1).id))!.dataText).toBe(rowDoc('a', 1).dataText);
    expect(JSON.parse((await second.store.get('treasury_exact'))!.dataText).gold).toBe(0.1 + 0.2);
    expect((await second.keeper.status()).behind).toBe(0);
    expect((await second.keeper.writeDown('test')).status).toBe('NOTHING');

    // A retried commit from before the move still applies once, and play goes on from it.
    expect((await second.store.commit({ commitId: 'c1', ops: [{ kind: 'put', doc: doc('late', 'content', {}) }] })).applied).toBe(false);
    expect((await second.store.commit({ commitId: 'c2', ops: [{ kind: 'put', doc: rowDoc('a', 2) }] })).applied).toBe(true);
    expect((await second.keeper.writeDown('test')).status).toBe('WRITTEN');
  }, 60_000);

  it('a database in step with the record loads nothing', async () => {
    const url = folder();
    const first = await live(url);
    await put(first.store, doc('a', 'content', {}));
    await first.close();
    const again = await live(url);
    expect(again.go.loaded).toBe(0);
    expect((await again.keeper.status()).behind).toBe(0);
  }, 60_000);

  it('a database behind the record, with nothing of its own unsaved, catches up', async () => {
    const urlA = folder();
    const a = await live(urlA);
    await put(a.store, doc('v', 'content', { v: 1 }));
    await a.close();
    const b = await live(folder());
    await put(b.store, doc('v', 'content', { v: 2 }));
    await b.close();
    const aAgain = await live(urlA);
    expect(aAgain.go.loaded).toBeGreaterThan(0);
    expect(JSON.parse((await aAgain.store.get('v'))!.dataText)).toEqual({ v: 2 });
  }, 60_000);

  it('a stop during a load leaves a database that comes up the same way next time', async () => {
    const first = await live(folder());
    await put(first.store, doc('a', 'content', {}));
    await first.close();
    const url = folder();
    const dying = await openDatabase(url);
    const keeper = new RecordKeeper(dying, { on: true, url: double.url }, { say: () => undefined, fault: stage => { if (stage === 'loaded') throw new Error('stopped here'); } });
    expect((await keeper.goLive()).loaded).toBe(0);
    expect((await new SqlStore(dying).get('a'))).toBeNull();
    await dying.close();
    const whole = await live(url);
    expect(whole.go.loaded).toBeGreaterThan(0);
    expect(await whole.store.get('a')).not.toBeNull();
  }, 60_000);

  it('the record unreachable at the start: the game opens on what it has, and says so', async () => {
    const store = await openLiveStore(folder(), { WS_RECORD: '1', TURSO_DATABASE_URL: 'http://127.0.0.1:9' }, { say: () => undefined, retryFirstMs: 60_000 });
    expect((await store.health()).ok).toBe(true);
    expect((await store.health()).record!.state).toBe('WAITING');
    await store.close();
  }, 40_000);
});

describe('an old file, and what the record changes about it', () => {
  it('no record set up: the door says what to press, needs no account, and creates nothing', async () => {
    const f = join(scratch(), 'test-player');
    writeFileSync(`${f}.db`, 'an old save');
    await expect(openLiveStore(folderUrl(f), { WS_RECORD: '1' })).rejects.toThrow(/Carry it over here, which needs no account/);
    expect(existsSync(f)).toBe(false);
  });

  it('a record that answers but holds nothing: the door also names the way up', async () => {
    const f = join(scratch(), 'test-player');
    writeFileSync(`${f}.db`, 'an old save');
    await expect(openLiveStore(folderUrl(f), { WS_RECORD: '1', TURSO_DATABASE_URL: double.url })).rejects.toThrow(/--to-record/);
  }, 30_000);

  it('a record that holds the save: the old file no longer stands in the way, and is left alone', async () => {
    const first = await live(folder());
    await put(first.store, doc('the_save', 'content', {}));
    await first.close();
    const f = join(scratch(), 'test-player');
    writeFileSync(`${f}.db`, 'an old save');
    const store = await openLiveStore(folderUrl(f), { WS_RECORD: '1', TURSO_DATABASE_URL: double.url }, { say: () => undefined });
    expect(await store.get('the_save')).not.toBeNull();
    await store.close();
    expect(readFileSync(`${f}.db`, 'utf8')).toBe('an old save');
  }, 60_000);

  it('the vault can carry it over: the door answers only for the file the store named', async () => {
    const { createDbHandler, lazyStore } = await import('../server/http');
    const { carryOldSave } = await import('../server/carryDoor');
    const { createServer } = await import('node:http');
    const dir = scratch();
    const f = join(dir, 'test-player');
    const made = spawnSync(process.execPath, [...TSX, 'tests/fixtures/old-save.ts', `${f}.db`], { cwd: ROOT, encoding: 'utf8' });
    expect(made.stdout).toContain('MADE');
    const before = readFileSync(`${f}.db`);

    const lazy = lazyStore(() => openLiveStore(folderUrl(f), {}));
    const handler = createDbHandler(lazy.get, { carry: carryOldSave });
    const server = createServer((req, res) => { void handler(req, res, (req.url ?? '/').split('?')[0]); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as any).port;
    const call = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const closed = await call('/health');
      expect(closed.status).toBe(503);
      expect(((await closed.json()) as any).canCarry).toBe(true);

      // A path in the request is not looked at: there is nowhere to send one.
      const carried = (await (await call('/carry', { oldFile: join(dir, 'elsewhere.db'), folder: join(dir, 'elsewhere') })).json()) as any;
      expect(carried.ok).toBe(true);
      expect(carried.lines.join('\n')).toContain(`CARRIED: ${f}`);
      expect(existsSync(join(dir, 'elsewhere'))).toBe(false);
      expect(readFileSync(`${f}.db`).equals(before)).toBe(true);

      const open = (await (await call('/health')).json()) as any;
      expect(open.ok).toBe(true);
      expect(open.canCarry).toBeUndefined();
      // A store that opened has nothing to carry.
      expect((await call('/carry', {})).status).toBe(404);
    } finally {
      await lazy.close();
      await new Promise(r => server.close(r));
    }
  }, 120_000);
});

describe('the tool, up to the record', () => {
  const carryUp = (file: string, url?: string) => spawnSync(process.execPath, [...TSX, 'scripts/carry-save.ts', file, '--to-record'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, TURSO_DATABASE_URL: url ?? '', TURSO_AUTH_TOKEN: '' }
  }).stdout;

  const oldSave = (kind = 'plain') => {
    const file = join(scratch(), 'save.db');
    const made = spawnSync(process.execPath, [...TSX, 'tests/fixtures/old-save.ts', file, kind], { cwd: ROOT, encoding: 'utf8' });
    expect(made.stdout).toContain('MADE');
    return file;
  };

  it('with no record set up, it refuses plainly and points at the way that needs none', () => {
    const printed = carryUp(oldSave());
    expect(printed).toContain('NOT CARRIED');
    expect(printed).toMatch(/The game does not need one/);
  }, 60_000);

  it('goes up whole, checked, the old file untouched, and a new database comes up from it', async () => {
    const file = oldSave();
    const before = [readFileSync(file), readFileSync(`${file}-wal`)];
    const printed = carryUp(file, double.url);
    expect(printed).toContain('CARRIED: the record');
    expect(printed).not.toContain('NOT CARRIED');
    expect(printed).toMatch(/documents\s+1205 rows/);
    expect(printed).toMatch(/commits\s+900 rows/);
    expect(printed).toMatch(/balance treasury_world_a = 0\.30000000000000004/);
    expect(printed).toMatch(/Old file untouched/);
    expect(readFileSync(file).equals(before[0])).toBe(true);
    expect(readFileSync(`${file}-wal`).equals(before[1])).toBe(true);
    expect(existsSync(`${file}.carried-to-record.txt`)).toBe(true);

    const f = file.replace(/\.db$/, '');
    const store = await openLiveStore(folderUrl(f), { WS_RECORD: '1', TURSO_DATABASE_URL: double.url }, { say: () => undefined });
    expect((await store.get('only_in_the_log'))!.dataText).toBe('{"newest":true}');
    expect(JSON.parse((await store.get('treasury_world_a'))!.dataText).gold).toBe(0.1 + 0.2);
    expect(JSON.parse((await store.get('ledger_head_ws_abc'))!.dataText)).toEqual({ seq: 700 });
    expect((await store.health()).record!.behind).toBe(0);
    await store.close();
  }, 180_000);

  it('run a second time, it refuses: the record already holds a save', () => {
    const file = oldSave();
    expect(carryUp(file, double.url)).toContain('CARRIED: the record');
    const second = carryUp(file, double.url);
    expect(second).toContain('NOT CARRIED');
    expect(second).toMatch(/already holds a save/);
  }, 180_000);

  it('a save carried to a folder goes up by itself at the first downtime once a record exists', async () => {
    const file = oldSave();
    const f = file.replace(/\.db$/, '');
    const printed = spawnSync(process.execPath, [...TSX, 'scripts/carry-save.ts', file, f], { cwd: ROOT, encoding: 'utf8' }).stdout;
    expect(printed).toContain(`CARRIED: ${f}`);
    const h = await live(folderUrl(f));
    const receipt = await h.keeper.writeDown('maintenance');
    expect(receipt.status).toBe('WRITTEN');
    expect(receipt.rows).toBe(1205 + 700 + 4 + 900);
    expect((await double.sql('SELECT COUNT(*) FROM ledger_rows'))[0][0]).toBe(700);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// HARD STOPS: real processes, really stopped, at every moment a write-down has
// ---------------------------------------------------------------------------

function runKiller(env: Record<string, string>): Promise<{ stdout: string; code: number | null }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [...TSX, 'tests/fixtures/writedown-killer.ts'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout!.on('data', b => { stdout += b; });
    child.on('exit', code => resolve({ stdout, code }));
  });
}

/** The books as the record has them: whole at a commit's edge, or something is wrong. */
async function recordAddsUp(d: IDouble, expectSeq?: number) {
  const seqs = (await d.sql(`SELECT seq, data FROM ledger_rows WHERE owner_uid = 'stopped' ORDER BY seq`));
  const top = seqs.length;
  seqs.forEach(([seq], i) => expect(seq).toBe(i + 1));
  if (expectSeq !== undefined) expect(top).toBe(expectSeq);
  const treasury = (await d.sql(`SELECT gold FROM treasuries WHERE id = 'treasury_hub'`))[0]?.[0] ?? 0;
  expect(treasury).toBe(top * 10);
  if (top > 0) {
    const bank = JSON.parse((await d.sql(`SELECT data FROM documents WHERE id = 'stopped'`))[0][0]);
    expect(bank.payload.bank.gold).toBe(500 - top * 10);
    const hub = JSON.parse((await d.sql(`SELECT data FROM documents WHERE id = 'hub_state_stopped'`))[0][0]);
    expect(hub.seq).toBe(top);
    const side = JSON.parse((await d.sql(`SELECT data FROM documents WHERE id = 'hub_side_stopped'`))[0][0]);
    expect(side.seq).toBe(top);
  }
  return top;
}

describe('a row the record holds differently is not saved, whichever try finds it', () => {
  const otherThan = (id: string) => double.sql(`UPDATE documents SET data = '{"other":true}' WHERE id = ?`, [id]);
  const manifests = async () => (await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0];
  const heldBy = async (id: string) => (await double.sql('SELECT data FROM documents WHERE id = ?', [id]))[0][0];
  const stoppedAtApplied = async () => {
    const url = folderUrl(join(scratch(), 'stopped'));
    const run = await runKiller({ WS_KILL_URL: url, WS_KILL_RECORD: double.url, WS_KILL_AT: 'applied', WS_KILL_COMMITS: '3' });
    expect(run.stdout).toContain('ACK 3');
    return url;
  };

  it('a read-back that differs: the marks stay, nothing is called saved, and the next try puts it right', async () => {
    let once = true;
    const h = await live(folder(), undefined, { fault: async (stage: string) => { if (stage === 'applied' && once) { once = false; await otherThan('a'); } } });
    await put(h.store, doc('a', 'content', { v: 1 }));

    expect((await h.keeper.writeDown('test')).status).toBe('MISMATCH');
    const after = await h.keeper.status();
    expect(after).toMatchObject({ state: 'WAITING' });
    expect(after.behind).toBeGreaterThan(0);
    expect(after.last, 'called saved').toBeUndefined();
    expect(h.said.filter(l => l.includes('differs')).length).toBe(1);

    expect((await h.keeper.writeDown('test')).status, h.said.join(' ')).toBe('WRITTEN');
    expect(JSON.parse(await heldBy('a'))).toEqual({ v: 1 });
    expect(await h.keeper.status()).toMatchObject({ state: 'READY', behind: 0 });
    expect((await h.keeper.status()).says).toBeUndefined();
    const heads = await double.sql('SELECT id, prev FROM cold_writedowns ORDER BY seq');
    expect(heads.length).toBe(2);
    expect(heads[1][1]).toBe(heads[0][0]);
  }, 60_000);

  it('a row that differs every time: never saved, never taken for another save, and told once', async () => {
    const h = await live(folder(), undefined, { fault: async (stage: string) => { if (stage === 'applied') await otherThan('a'); } });
    await put(h.store, doc('a', 'content', { v: 1 }));
    for (let i = 0; i < 3; i++) {
      expect((await h.keeper.writeDown('test')).status, h.said.join(' ')).toBe('MISMATCH');
      const now = await h.keeper.status();
      expect(now.behind).toBeGreaterThan(0);
      expect(now.last, 'called saved').toBeUndefined();
    }
    expect(h.said.filter(l => l.includes('differs')).length).toBe(1);
    expect(h.said.filter(l => l.includes('did not come from'))).toEqual([]);
  }, 60_000);

  it('a read-back that differs waits for the next downtime, because a timer would write it all again and again', async () => {
    const h = await live(folder(), undefined, { retryFirstMs: 20, fault: async (stage: string) => { if (stage === 'applied') await otherThan('a'); } });
    await put(h.store, doc('a', 'content', { v: 1 }));
    expect((await h.keeper.writeDown('test')).status).toBe('MISMATCH');
    await new Promise(r => setTimeout(r, 600));
    expect(await manifests()).toBe(1);
    expect((await h.keeper.status()).behind).toBeGreaterThan(0);
  }, 30_000);

  it('a read-back that differs, then a restart: it follows the record it left, and is not told it holds another save', async () => {
    const url = folder();
    let once = true;
    const first = await live(url, undefined, { fault: async (stage: string) => { if (stage === 'applied' && once) { once = false; await otherThan('a'); } } });
    await put(first.store, doc('a', 'content', { v: 1 }));
    expect((await first.keeper.writeDown('test')).status).toBe('MISMATCH');
    await double.fault('refuse');
    await closeOut();
    await double.fault('none');

    const second = await live(url);
    expect(second.said.filter(l => l.includes('did not come from'))).toEqual([]);
    expect((await second.keeper.writeDown('test')).status, second.said.join(' ')).toBe('WRITTEN');
    expect(JSON.parse(await heldBy('a'))).toEqual({ v: 1 });
  }, 60_000);

  it('stopped at "applied" with a document the record holds differently: not saved, and the next try puts it right', async () => {
    const url = await stoppedAtApplied();
    await otherThan('stopped');

    const h = await live(url);
    expect(h.said.filter(l => l.includes('did not come from')), 'a stop is not another save').toEqual([]);
    expect((await h.keeper.writeDown('retry')).status, h.said.join(' ')).toBe('MISMATCH');
    const after = await h.keeper.status();
    expect(after.state).toBe('WAITING');
    expect(after.behind).toBeGreaterThan(0);
    expect(after.last, 'called saved').toBeUndefined();

    expect((await h.keeper.writeDown('retry')).status, h.said.join(' ')).toBe('WRITTEN');
    expect(await recordAddsUp(double, 3)).toBe(3);
    expect((await h.keeper.status())).toMatchObject({ state: 'READY', behind: 0 });
  }, 120_000);

  it('stopped at "applied" with a signed row the record holds differently: not saved, and it stops at the fork', async () => {
    const url = await stoppedAtApplied();
    await double.sql(`UPDATE ledger_rows SET data = '{"other":true}' WHERE id = 'ledger_stopped_00000001'`);

    const h = await live(url);
    expect((await h.keeper.writeDown('retry')).status, h.said.join(' ')).toBe('MISMATCH');
    expect((await h.keeper.writeDown('retry')).status, h.said.join(' ')).toBe('FORK');
    const after = await h.keeper.status();
    expect(after.state).toBe('FORK');
    expect(after.behind).toBeGreaterThan(0);
    expect(after.last, 'called saved').toBeUndefined();
    expect(JSON.parse((await double.sql(`SELECT data FROM ledger_rows WHERE id = 'ledger_stopped_00000001'`))[0][0])).toEqual({ other: true });
  }, 120_000);

  it('stopped at "applied", and the differing row changed since: its newer mark takes it out of the comparison', async () => {
    const url = await stoppedAtApplied();
    await otherThan('stopped');

    const h = await live(url);
    await put(h.store, doc('stopped', 'characters', { newer: true }));
    expect((await h.keeper.writeDown('retry')).status, h.said.join(' ')).toBe('WRITTEN');
    expect(JSON.parse(await heldBy('stopped'))).toEqual({ newer: true });
    expect(await h.keeper.status()).toMatchObject({ state: 'READY', behind: 0 });
    expect(await manifests()).toBe(2);
  }, 120_000);

  it('stopped at "applied" and the record holds it all as sent: read back, then saved', async () => {
    const url = await stoppedAtApplied();
    const h = await live(url);
    expect(h.said.filter(l => l.includes('did not come from'))).toEqual([]);
    expect((await h.keeper.writeDown('retry')).status, h.said.join(' ')).toBe('NOTHING');
    const after = await h.keeper.status();
    expect(after).toMatchObject({ state: 'READY', behind: 0 });
    expect(after.last).toBe((await double.sql('SELECT id FROM cold_writedowns'))[0][0]);
  }, 120_000);
});

describe('a process stopped hard during a write-down loses nothing Postgres holds', () => {
  // The stopped process's 1.5 MB documents make a 3 MB write-down: one request, or several where the record takes 2 MB.
  const PATHS: [string, number][] = [['pending', 0], ['sending', 0], ['applied', 0], ['verified', 0], ['staged-part', 2_000_000], ['staged', 2_000_000], ['applied', 2_000_000]];
  for (const [stage, limit] of PATHS) {
    it(`stopped at "${stage}"${limit ? ', split' : ', one request'}: the record is whole, and the next start finishes it exactly once`, async () => {
      const url = folderUrl(join(scratch(), 'stopped'));
      if (limit) await double.limit(limit);
      const run = await runKiller({ WS_KILL_URL: url, WS_KILL_RECORD: double.url, WS_KILL_AT: stage, WS_KILL_COMMITS: '3' });
      expect(run.stdout).toContain('ACK 3');
      expect(run.stdout).not.toContain('DOWN');
      expect(run.code === 0).toBe(false);

      // Before anything is retried: the record holds that write-down whole, or none of it.
      const landed = stage === 'applied' || stage === 'verified';
      expect(await recordAddsUp(double, landed ? 3 : 0)).toBe(landed ? 3 : 0);
      expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(landed ? 1 : 0);

      // The next start: Postgres still has every acknowledged commit, and its marks.
      const h = await live(url);
      expect(JSON.parse((await h.store.get('stopped'))!.dataText).payload.bank.gold).toBe(470);
      await h.store.commit({ commitId: randomUUID(), ops: [{ kind: 'put', doc: doc('after', 'content', {}) }] });
      const receipt = await h.keeper.writeDown('retry');
      expect(receipt.status).toBe('WRITTEN');
      expect(await recordAddsUp(double, 3)).toBe(3);
      expect((await double.sql(`SELECT COUNT(*) FROM documents WHERE id = 'after'`))[0][0]).toBe(1);
      expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(landed ? 2 : 1);
      expect((await double.sql('SELECT COUNT(*) FROM cold_stage_documents'))[0][0]).toBe(0);
      expect((await h.keeper.status()).behind).toBe(0);
    }, 120_000);
  }

  for (const at of ['in-flight:0', 'in-flight-stage:0']) {
    it(`stopped with a batch on the wire (${at === 'in-flight:0' ? 'the one request' : 'a staging part'}): the record holds it whole or not at all, and the next start finishes it`, async () => {
      const url = folderUrl(join(scratch(), 'stopped'));
      if (at === 'in-flight-stage:0') await double.limit(2_000_000);
      const run = await runKiller({ WS_KILL_URL: url, WS_KILL_RECORD: double.url, WS_KILL_AT: at, WS_KILL_COMMITS: '3' });
      expect(run.stdout).toContain('ACK 3');
      expect(run.stdout).not.toContain('DOWN');

      const landed = (await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0];
      expect(await recordAddsUp(double, landed === 1 ? 3 : 0)).toBe(landed === 1 ? 3 : 0);

      const h = await live(url);
      await h.store.commit({ commitId: randomUUID(), ops: [{ kind: 'put', doc: doc('after', 'content', {}) }] });
      expect((await h.keeper.writeDown('retry')).status).toBe('WRITTEN');
      expect(await recordAddsUp(double, 3)).toBe(3);
      expect((await double.sql('SELECT COUNT(*) FROM cold_stage_documents'))[0][0]).toBe(0);
      expect((await h.keeper.status()).behind).toBe(0);
    }, 120_000);
  }

  it('over and over on one folder and one record: nothing lost, and each commit on the record once', async () => {
    const url = folderUrl(join(scratch(), 'again'));
    let from = 1;
    for (const [stage, limit] of [['staged', 2_000_000], ['applied', 0], ['sending', 0], ['pending', 0], ['verified', 2_000_000], ['staged-part', 2_000_000], ['none', 0]] as const) {
      await double.limit(limit);
      const run = await runKiller({ WS_KILL_URL: url, WS_KILL_RECORD: double.url, WS_KILL_AT: stage, WS_KILL_FROM: String(from), WS_KILL_COMMITS: '2' });
      expect(run.stdout).toContain(`ACK ${from + 1}`);
      from += 2;
    }
    const h = await live(url);
    expect((await h.keeper.writeDown('retry')).status).not.toBe('WAITING');
    expect(await recordAddsUp(double, from - 1)).toBe(from - 1);
    const heads = await double.sql('SELECT id, prev FROM cold_writedowns ORDER BY seq');
    heads.forEach(([, prev], i) => expect(prev).toBe(i === 0 ? null : heads[i - 1][0]));
  }, 300_000);

  // Split, the crossing itself must still fit, so the documents are padded past a limit it fits under.
  for (const [at, limit] of [['sending', 0], ['staged', 5_000]] as const) {
  it(`the record itself stopped hard in the middle of a write-down (${at}): it comes back whole, and the next one lands`, async () => {
    const url = folder();
    const h = await live(url, undefined, { retryFirstMs: 60_000, fault: async (stage: string) => { if (stage === at) await double.stop(); } });
    if (limit) await double.limit(limit);
    const file = double.file;
    await h.store.commit({ commitId: randomUUID(), ops: [{ kind: 'put', doc: doc('a', 'content', {}) }, { kind: 'put', doc: rowDoc('a', 1) }, ...[0, 1].map(i => ({ kind: 'put' as const, doc: doc(`a_pad_${i}`, 'content', { pad: 'p'.repeat(3_000) }) }))] });
    expect((await h.keeper.writeDown('test')).status).toBe('WAITING');
    await closeOut();

    // It answers on another port now, as if it had moved. Nothing of that write-down is on it.
    double = await startDouble(file);
    expect((await double.sql('SELECT COUNT(*) FROM cold_writedowns'))[0][0]).toBe(0);
    expect((await double.sql('SELECT COUNT(*) FROM documents'))[0][0]).toBe(0);

    const again = await live(url);
    expect((await again.keeper.writeDown('retry')).status).toBe('WRITTEN');
    expect((await double.sql('SELECT COUNT(*) FROM documents'))[0][0]).toBe(3);
    expect((await double.sql('SELECT COUNT(*) FROM cold_stage_documents'))[0][0]).toBe(0);
  }, 120_000);
  }
});

describe('a send that lands after its sender gave up on it', () => {
  /** With `pad`, two documents over half of an 8,000-byte limit ride along, so the write-down is split. */
  const someRows = async (h: Awaited<ReturnType<typeof live>>, id: string, pad = false) => h.store.commit({ commitId: randomUUID(), ops: [
    { kind: 'put', doc: doc(id, 'content', { id }) },
    { kind: 'add', namespace: 'territories', id: 'treasury_hub', amount: 10, at: 1 },
    ...(pad ? [0, 1].map(i => ({ kind: 'put' as const, doc: doc(`${id}_pad_${i}`, 'content', { pad: 'p'.repeat(4_500) }) })) : [])
  ] });
  const heads = () => double.sql('SELECT id, prev FROM cold_writedowns ORDER BY seq');

  /** A write-down goes out, its connection is cut, and the record has it in hand and has not applied it. */
  async function goneOut(h: Awaited<ReturnType<typeof live>>, pad = false) {
    await someRows(h, 'first', pad);
    await double.fault('late-answer', { then: 'refuse' });
    expect((await h.keeper.writeDown('test')).status).toBe('WAITING');
    expect(await heads()).toEqual([]);
    await double.fault('none');
  }

  it('its rows gone from staging, it writes no manifest: the record never says it holds what it does not', async () => {
    const door = await openColdDoor({ url: double.url });
    await door.head();
    await double.limit(5_000);
    const down = { id: 'wd_empty', prev: null, why: 'test', at: 1, digest: 'd', rows: { commits: [{ id: 'c'.repeat(3_000), at: 1 }, { id: 'd'.repeat(3_000), at: 1 }] } };
    await expect(door.writeDown(down, async stage => {
      if (stage === 'staged') await double.sql('DELETE FROM cold_stage_commits');
    })).rejects.toThrow(/gone/);
    expect(await heads()).toEqual([]);
    door.close();
  }, 30_000);

  it('landing just after the next try looked for it: that try takes it as its own and goes on', async () => {
    const h = await live(folder());
    await goneOut(h);
    await someRows(h, 'second');
    await double.fault('land-after-has');
    const receipt = await h.keeper.writeDown('retry');
    expect(receipt.status).toBe('WRITTEN');
    const [first, second] = await heads();
    expect(first[1]).toBe(null);
    expect(second).toEqual([receipt.id, first[0]]);
    expect((await double.sql(`SELECT id FROM documents WHERE id IN ('first', 'second') ORDER BY id`)).flat()).toEqual(['first', 'second']);
    expect((await double.sql(`SELECT gold FROM treasuries WHERE id = 'treasury_hub'`))[0][0]).toBe(20);
    expect((await h.keeper.status()).behind).toBe(0);
  }, 60_000);

  it('landing as the next try sends its one request: that try takes it as its own and goes on', async () => {
    let armed = false;
    const h = await live(folder(), undefined, { fault: async (stage: string) => { if (armed && stage === 'sending') { armed = false; await double.fault('land'); } } });
    await goneOut(h);
    await someRows(h, 'second');
    armed = true;
    const receipt = await h.keeper.writeDown('retry');
    expect(receipt.status).toBe('WRITTEN');
    const [first, second] = await heads();
    expect(second).toEqual([receipt.id, first[0]]);
    expect((await double.sql(`SELECT id FROM documents WHERE id IN ('first', 'second') ORDER BY id`)).flat()).toEqual(['first', 'second']);
    expect((await double.sql(`SELECT gold FROM treasuries WHERE id = 'treasury_hub'`))[0][0]).toBe(20);
    expect((await h.keeper.status()).behind).toBe(0);
  }, 60_000);

  it('landing while the next try is staged: it lands nothing, and the next try is the one that crosses', async () => {
    let armed = false;
    const h = await live(folder(), undefined, { fault: async (stage: string) => { if (armed && stage === 'staged') { armed = false; await double.fault('land'); } } });
    await double.limit(8_000);
    await goneOut(h, true);
    await someRows(h, 'second', true);
    armed = true;
    const receipt = await h.keeper.writeDown('retry');
    expect(receipt.status).toBe('WRITTEN');
    expect(await heads()).toEqual([[receipt.id, null]]);
    expect((await double.sql(`SELECT id FROM documents WHERE id IN ('first', 'second') ORDER BY id`)).flat()).toEqual(['first', 'second']);
    expect((await double.sql(`SELECT gold FROM treasuries WHERE id = 'treasury_hub'`))[0][0]).toBe(20);
    expect((await h.keeper.status()).behind).toBe(0);
  }, 60_000);

  it('landing while this process is down: the next start does not take its own send for another save', async () => {
    const url = folder();
    let armed = false;
    const h = await live(url, undefined, { fault: (stage: string) => { if (stage === 'pending' && armed) throw new Error('stopped'); } });
    await goneOut(h);
    await someRows(h, 'second');
    armed = true;
    expect((await h.keeper.writeDown('retry')).status).toBe('WAITING');
    await closeOut();
    await double.fault('land');
    expect((await heads()).length).toBe(1);

    const again = await live(url);
    expect(again.go.loaded).toBe(0);
    expect((await again.keeper.status()).state).not.toBe('MOVED');
    const receipt = await again.keeper.writeDown('retry');
    expect(receipt.status).toBe('WRITTEN');
    expect((await double.sql(`SELECT id FROM documents WHERE id IN ('first', 'second') ORDER BY id`)).flat()).toEqual(['first', 'second']);
    expect((await again.keeper.status()).behind).toBe(0);
  }, 60_000);

  it('a send that landed differently, found this way, is still not called saved', async () => {
    let armed = false;
    const h = await live(folder(), undefined, { fault: (stage: string) => { if (armed && stage === 'pending') { armed = false; throw new Error('stopped'); } } });
    await goneOut(h);
    await someRows(h, 'second');
    armed = true;
    expect((await h.keeper.writeDown('retry')).status).toBe('WAITING');
    await double.fault('land');
    await double.sql('UPDATE documents SET data = \'{"other":true}\' WHERE id = \'first\'');

    expect((await h.keeper.writeDown('again')).status).toBe('MISMATCH');
    expect((await h.keeper.status()).last).toBeUndefined();
    expect((await h.keeper.status()).behind).toBeGreaterThan(0);

    const receipt = await h.keeper.writeDown('and again');
    expect(receipt.status).toBe('WRITTEN');
    expect(JSON.parse((await double.sql('SELECT data FROM documents WHERE id = \'first\''))[0][0])).toEqual({ id: 'first' });
    expect((await h.keeper.status()).behind).toBe(0);
  }, 60_000);
});

describe('downtime work runs on SQL', () => {
  it('maintenance writes down first, then adds the books up on the record, and says what it found', async () => {
    const h = await live(folder());
    await h.store.commit({ commitId: randomUUID(), ops: [
      { kind: 'put', doc: rowDoc('a', 1, -10) },
      { kind: 'add', namespace: 'territories', id: 'treasury_hub', amount: 10, at: 1 }
    ] });
    const result = await h.store.maintain();
    expect(result.ok).toBe(true);
    expect(result.record!.status).toBe('WRITTEN');
    expect(result.record!.audit!.ok).toBe(true);
    expect(result.record!.audit!.report).toMatchObject({ chains: 1, broken: [], treasury: { expected: 10, held: 10 } });
    const job = await double.sql('SELECT name, ok FROM cold_jobs');
    expect(job).toEqual([['the-books', 1]]);
  }, 30_000);

  it('books that do not add up are said out loud, stop nothing and change nothing', async () => {
    const h = await live(folder());
    await h.store.commit({ commitId: randomUUID(), ops: [{ kind: 'add', namespace: 'territories', id: 'treasury_hub', amount: 10, at: 1 }] });
    const result = await h.store.maintain();
    expect(result.ok).toBe(true);
    expect(result.record!.audit!.ok).toBe(false);
    expect(h.said.join()).toMatch(/did not add up/);
    expect((await h.keeper.status()).state).toBe('READY');
    expect(JSON.parse((await h.store.get('treasury_hub'))!.dataText).gold).toBe(10);
  }, 30_000);

  it('maintenance with no record answering still tidies the live store, and says it did not write', async () => {
    const h = await live(folder(), undefined, { retryFirstMs: 60_000 });
    await put(h.store, doc('a', 'content', {}));
    await double.fault('refuse');
    const result = await h.store.maintain();
    expect(result.ok).toBe(true);
    expect(result.record!.status).toBe('WAITING');
    expect((await h.store.get('a'))).not.toBeNull();
  }, 30_000);
});

describe('why these errors are what they are', () => {
  it('an unknown URL on the door is a person\'s to fix, and the game still opens', async () => {
    const store = await openLiveStore(folder(), { WS_RECORD: '1', TURSO_DATABASE_URL: 'file:data/record.db' }, { say: () => undefined });
    expect((await store.health()).ok).toBe(true);
    expect((await store.writeDown('gate')).status).toBe('WRONG_URL');
    expect((await store.health()).record!.state).toBe('WRONG_URL');
    await store.close();
  }, 30_000);

  it('a held folder is still refused the same plain way with a record in play', async () => {
    const f = folder();
    const first = await openLiveStore(f, { WS_RECORD: '1' }, { say: () => undefined });
    await expect(openDatabase(f)).rejects.toBeInstanceOf(DatabaseUnavailable);
    await first.close();
  }, 60_000);
});

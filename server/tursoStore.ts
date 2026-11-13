/**
 * THE HUB'S STORE ON TURSO ALONE (HT1). Pedro, 2026-11-13: "not neon, I'm not going to dabble in neon,
 * please rethink this option", and, to building the hub's store on Turso with no Postgres on the host:
 * "Yes, Turso only". A sibling of `SqlStore` (shared/SqlStore.ts), not a rewrite of it: the same law,
 * answered on Turso through the network driver (coldStore.ts, `openNetworkClient`), for a hub a
 * function host runs. The browser, the local stand-ins and anyone who names a Postgres keep SqlStore.
 *
 * ONE REQUEST A COMMIT, AND THE DATABASE DECIDES IT. Over HTTP an interactive transaction is one
 * request a statement, and a second instance can change anything between them. So a commit goes up as
 * ONE batch, which Turso runs whole or not at all under its write lock, and every decision the law
 * makes is taken there, by the batch's own SQL, on what stands at that moment:
 *
 *   1. the commit's own row goes in, with a nonce of this send, only if the verdict is 'go': not seen
 *      before, its guard absent, every ledger row either held as it is or the next of its chain, every
 *      head where its chain stands once the rows before it in the commit are counted;
 *   2. the verdict is read back, only if (1) did not land: why nothing was written, in the law's words;
 *   3. every op is written only if the commit's row carries this send's nonce.
 *
 * A refused commit leaves no mark, so the same commit id mended can still land. Each send carries its
 * own token and a retry knows the tokens of every send before it, so a send whose answer was lost,
 * asked again, finds its own row and says truly that it landed, and writes nothing more; and one that
 * reaches Turso after its sender gave up (which Turso did, 1 to 5 seconds late: coldStore.ts) finds the
 * commit seen under another token and writes nothing.
 *
 * WHAT POSTGRES CANNOT HOLD IS REFUSED HERE TOO. The store's law is one law on both bodies: a NUL in a
 * text, a version past 32 bits, a time past 64, are refused (StoreRefusal) as Postgres refuses them,
 * at the op where Postgres would, so a commit seen before is still only "not applied".
 *
 * GOLD GOES UP AS TEXT, as the record's door found it must (coldStore.ts), and the REAL column reads it.
 *
 * ITS OWN TABLES. Every name begins store_ (drizzle/turso), so a record written down into the same
 * database (server/record.ts, which only a Postgres store keeps) never meets them.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoreConflict, StoreRefusal } from '../shared/SqlStore';
import { cosineSimilarity } from '../shared/entities/data/similarity';
import type { CommitOp, ICommitRequest, ICommitResult, IHealth, IWireDoc, IWireQuery, IWireSearch, IWriteDownReceipt } from '../shared/entities/data/wire';
import { askAgainIfDropped, openNetworkClient, type Client, type IColdConfig } from './coldStore';
import type { IStore } from './store';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '..', 'drizzle', 'turso');

/** Every table this store makes. None is a name the record uses (server/recordRows.ts, drizzle/cold). */
export const STORE_TABLES = ['store_documents', 'store_ledger_rows', 'store_treasuries', 'store_commits', 'store_live_lines', 'store_live_places', 'store_migrations'] as const;

/** A database a function host reaches over the network: Turso's own address, or its HTTP one. Anything else is a Postgres or a folder. */
export const isTursoUrl = (url: string) => /^(libsql|https?):\/\//i.test(url.trim());

/** Said by a write-down and the daily call where the store is Turso (HT5). */
export const STORE_IS_ITS_RECORD = 'This store is kept on Turso itself, so there is nothing to write down: every commit is already there, once, and nothing is written twice.';

/** The database's own clock, in milliseconds, so every instance writes and compares one time. */
export const DB_NOW = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`;
const DAY_MS = 24 * 60 * 60_000;

const LEDGER_NS = 'transactions';
const TREASURY_NS = 'territories';
const HEAD_PREFIX = 'ledger_head_';
const ROW_ID = /^ledger_(.+)_(\d+)$/;
const TREASURY_PREFIX = 'treasury_';
const WALLET_PREFIX = 'wallet_';
/** Ids in one statement, as erase.ts asks. */
const IDS_PER_ASK = 500;
/** How often a write is tried again when Turso says another holds its lock. */
const BUSY_TRIES = 5;

type Statement = { sql: string; args: any[] };
type Route = { to: 'head'; uid: string } | { to: 'row'; uid: string; seq: number } | { to: 'treasury' } | { to: 'document' };

/** Where a document lives, by its id: the same routing as SqlStore's. */
function route(id: string, namespace?: string): Route {
  if (id.startsWith(HEAD_PREFIX) && (namespace === undefined || namespace === LEDGER_NS)) return { to: 'head', uid: id.slice(HEAD_PREFIX.length) };
  const row = ROW_ID.exec(id);
  if (row && (namespace === undefined || namespace === LEDGER_NS)) return { to: 'row', uid: row[1], seq: Number(row[2]) };
  if ((id.startsWith(TREASURY_PREFIX) || id.startsWith(WALLET_PREFIX)) && (namespace === undefined || namespace === TREASURY_NS)) return { to: 'treasury' };
  return { to: 'document' };
}

const DOCUMENT_COLUMNS: Record<string, 'doc_type' | 'genre' | 'owner_cert_uid'> = {
  'data.type': 'doc_type',
  'data.genre': 'genre',
  'metadata.ownerCertUid': 'owner_cert_uid'
};

const DOC_COLUMNS = 'id, namespace, data, embedding, doc_type, genre, owner_cert_uid, signature, version, created_at, updated_at';
const ROW_COLUMNS = 'id, owner_uid, seq, prev_seq, ts, type, signature, data, version, created_at, updated_at';
const TREASURY_COLUMNS = 'id, namespace, gold, created_at, updated_at';

const whole = (n: number) => Math.trunc(n);
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const parts = <T>(list: T[], size = IDS_PER_ASK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

function pathValue(doc: IWireDoc, path: string): unknown {
  const steps = path.split('.');
  const root: any = steps[0] === 'metadata' ? doc.metadata : steps[0] === 'data' ? JSON.parse(doc.dataText) : doc;
  return (steps[0] === 'metadata' || steps[0] === 'data' ? steps.slice(1) : steps).reduce((at: any, key) => at?.[key], root);
}

const toEmbedding = (text: unknown): number[] | undefined => {
  if (typeof text !== 'string' || !text) return undefined;
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
};

/** The first id after every id that starts with `prefix`, in byte order, or null when there is none. */
function pastPrefix(prefix: string): string | null {
  const points = [...prefix].map(c => c.codePointAt(0)!);
  while (points.length > 0 && points[points.length - 1] === 0x10ffff) points.pop();
  if (points.length === 0) return null;
  let last = points.pop()! + 1;
  if (last === 0xd800) last = 0xe000;
  return String.fromCodePoint(...points, last);
}

/** An index-friendly range on the id, and the exact test beside it: a prefix is literal, with no wildcards. */
function prefixCondition(prefix: string | undefined, column = 'id'): { sql: string; args: any[] } | null {
  if (!prefix) return null;
  const past = pastPrefix(prefix);
  return {
    sql: `${column} >= ?${past === null ? '' : ` AND ${column} < ?`} AND substr(${column}, 1, length(?)) = ?`,
    args: [prefix, ...(past === null ? [] : [past]), prefix, prefix]
  };
}

// --- what Postgres cannot hold, refused alike (the store's law is one law) ----------------------

const INT4_LEAST = -(2 ** 31);
const INT4_MOST = 2 ** 31 - 1;
const INT8_BOUND = 2 ** 63;

function cannotHold(texts: Record<string, unknown>, int4: Record<string, unknown>, int8: Record<string, unknown>, real: Record<string, unknown> = {}): string | null {
  for (const [name, value] of Object.entries(texts)) {
    if (typeof value === 'string' && value.includes('\u0000')) return `${name} holds a NUL character, which the store cannot keep in text.`;
  }
  for (const [name, value] of Object.entries(int4)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} is not a number.`;
    const n = whole(value);
    if (n < INT4_LEAST || n > INT4_MOST) return `${name} ${value} is out of range for a 32-bit whole number.`;
  }
  for (const [name, value] of Object.entries(int8)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} is not a number.`;
    if (Math.abs(whole(value)) >= INT8_BOUND) return `${name} ${value} is out of range for a 64-bit whole number.`;
  }
  for (const [name, value] of Object.entries(real)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} is not a number.`;
  }
  return null;
}

/** See GOLD GOES UP AS TEXT (coldStore.ts). */
const goldText = (n: number) => String(n);

const isBusy = (e: unknown) => /SQLITE_BUSY|database is locked/i.test(String((e as Error)?.message ?? e));
const isUnique = (e: unknown) => /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(String((e as Error)?.message ?? e));
const isTooBig = (e: unknown) => /too big|TOOBIG|too large/i.test(String((e as Error)?.message ?? e));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------

export class TursoStore implements IStore {
  private migrated: Promise<void> | null = null;

  constructor(/** @internal The network driver's client, for the live room's own tables (live/tursoLive.ts). */ readonly client: Client) {}

  /** Its tables made on first need, and asked again after a failure: an outage at the start is not the end of it. */
  ready(): Promise<void> {
    this.migrated ??= this.migrate().catch(e => { this.migrated = null; throw e; });
    return this.migrated;
  }

  /**
   * @internal One batch, one request, tried again on a dropped connection and while another holds the lock.
   * Given a function, each send is built afresh, so each carries its own token (`commit`).
   */
  async batch(statements: Statement[] | (() => Statement[]), mode: 'write' | 'deferred') {
    await this.ready();
    const build = typeof statements === 'function' ? statements : () => statements;
    return askAgainIfDropped(async () => {
      for (let tries = 1; ; tries++) {
        try {
          return await this.client.batch(build(), mode);
        } catch (e) {
          if (tries >= BUSY_TRIES || !isBusy(e)) throw e;
          await sleep(25 * 2 ** tries);
        }
      }
    });
  }

  /** @internal One statement, one request. */
  async execute(statement: Statement) {
    await this.ready();
    return askAgainIfDropped(() => this.client.execute(statement));
  }

  private async migrate(): Promise<void> {
    const [, done] = await askAgainIfDropped(() => this.client.batch([
      { sql: 'CREATE TABLE IF NOT EXISTS store_migrations (name text PRIMARY KEY NOT NULL, at integer NOT NULL)', args: [] },
      { sql: 'SELECT name FROM store_migrations', args: [] }
    ], 'write'));
    const applied = new Set(done.rows.map(r => String(r.name)));
    for (const name of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).sort()) {
      if (applied.has(name)) continue;
      const statements = readFileSync(join(MIGRATIONS, name), 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      // Another instance may be making the same tables this moment: everything here is made only if absent
      await askAgainIfDropped(() => this.client.batch([
        ...statements.map(sql => ({ sql, args: [] })),
        { sql: 'INSERT OR IGNORE INTO store_migrations (name, at) VALUES (?, ?)', args: [name, Date.now()] }
      ], 'write'));
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }

  async health(): Promise<IHealth> {
    await this.execute({ sql: 'SELECT id FROM store_commits LIMIT 1', args: [] });
    return { ok: true, service: 'worldseed-db', dialect: 'turso' };
  }

  /** HT5: the store is already on Turso, so a write-down has nothing to write, and says so. */
  async writeDown(_why: string): Promise<IWriteDownReceipt> {
    return { status: 'NOTHING', says: STORE_IS_ITS_RECORD };
  }

  /**
   * The daily call (HT5): nothing to write down, and what the live room left is tidied: the places of
   * instances gone a day, and lines emptied a day ago (an emptied line is kept a while so the other
   * instances read that it emptied: live/tursoLive.ts). Nothing of the game's own is touched.
   */
  async maintain(): Promise<{ ok: true; record?: IWriteDownReceipt }> {
    await this.batch([
      { sql: `DELETE FROM store_live_places WHERE at < ${DB_NOW} - ?`, args: [DAY_MS] },
      { sql: `DELETE FROM store_live_lines WHERE line = '' AND at < ${DB_NOW} - ?`, args: [DAY_MS] }
    ], 'write');
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // READS: one request each
  // ---------------------------------------------------------------------------

  async get(id: string): Promise<IWireDoc | null> {
    const where = route(id);
    if (where.to === 'head') return this.readHead(where.uid);
    if (where.to === 'document') {
      const { rows } = await this.execute({ sql: `SELECT ${DOC_COLUMNS} FROM store_documents WHERE id = ?`, args: [id] });
      return rows[0] ? documentToWire(rows[0]) : null;
    }
    // A row or a treasury not found there may be a document by that id, as SqlStore looks: both in one request
    const table = where.to === 'row' ? `SELECT ${ROW_COLUMNS} FROM store_ledger_rows WHERE id = ?` : `SELECT ${TREASURY_COLUMNS} FROM store_treasuries WHERE id = ?`;
    const [first, doc] = await this.batch([{ sql: table, args: [id] }, { sql: `SELECT ${DOC_COLUMNS} FROM store_documents WHERE id = ?`, args: [id] }], 'deferred');
    if (first.rows[0]) return where.to === 'row' ? rowToWire(first.rows[0]) : treasuryToWire(first.rows[0]);
    return doc.rows[0] ? documentToWire(doc.rows[0]) : null;
  }

  private async readHead(uid: string): Promise<IWireDoc | null> {
    const { rows } = await this.execute({ sql: 'SELECT seq, ts FROM store_ledger_rows WHERE owner_uid = ? ORDER BY seq DESC LIMIT 1', args: [uid] });
    const top = rows[0];
    if (!top) return null;
    return {
      id: `${HEAD_PREFIX}${uid}`,
      namespace: LEDGER_NS,
      dataText: JSON.stringify({ seq: Number(top.seq) }),
      metadata: { createdAt: Number(top.ts), updatedAt: Number(top.ts), ownerCertUid: uid, version: 1 }
    };
  }

  async query(q: IWireQuery): Promise<IWireDoc[]> {
    const filter = q.filter ?? {};
    for (const [path, want] of Object.entries(filter)) {
      if (want !== null && typeof want === 'object') throw new StoreRefusal(`The filter on "${path}" asks for more than equality, and this store will not pretend to honor it.`);
    }
    const paths = Object.entries(filter);
    const onlyIndexed = paths.every(([path]) => DOCUMENT_COLUMNS[path]);
    const severalTables = q.namespace === LEDGER_NS || q.namespace === TREASURY_NS;
    const limit = !severalTables && onlyIndexed ? q.limit : undefined;

    const conditions = ['namespace = ?'];
    const args: any[] = [q.namespace];
    const prefix = prefixCondition(q.idPrefix);
    if (prefix) { conditions.push(prefix.sql); args.push(...prefix.args); }
    for (const [path, want] of paths) {
      const column = DOCUMENT_COLUMNS[path];
      if (!column) continue;
      if (want === null) conditions.push(`${column} IS NULL`);
      else { conditions.push(`${column} = ?`); args.push(want); }
    }
    const statements: Statement[] = [{ sql: `SELECT ${DOC_COLUMNS} FROM store_documents WHERE ${conditions.join(' AND ')} ORDER BY id${limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(limit))}` : ''}`, args }];
    if (q.namespace === LEDGER_NS) {
      const owner = paths.find(([path]) => path === 'metadata.ownerCertUid');
      const rowConditions: string[] = [];
      const rowArgs: any[] = [];
      if (prefix) { rowConditions.push(prefix.sql); rowArgs.push(...prefix.args); }
      if (owner) { rowConditions.push('owner_uid = ?'); rowArgs.push(owner[1]); }
      statements.push({ sql: `SELECT ${ROW_COLUMNS} FROM store_ledger_rows${rowConditions.length ? ` WHERE ${rowConditions.join(' AND ')}` : ''} ORDER BY id`, args: rowArgs });
    } else if (q.namespace === TREASURY_NS) {
      statements.push({ sql: `SELECT ${TREASURY_COLUMNS} FROM store_treasuries${prefix ? ` WHERE ${prefix.sql}` : ''} ORDER BY id`, args: prefix ? prefix.args : [] });
    }

    const results = statements.length === 1 ? [await this.execute(statements[0])] : await this.batch(statements, 'deferred');
    const docs = results[0].rows.map(documentToWire);
    const extra = results.length > 1 ? results[1].rows.map(q.namespace === LEDGER_NS ? rowToWire : treasuryToWire) : [];
    let merged = [...docs, ...extra];
    if (extra.length > 0) merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const [path, want] of paths) {
      if (!DOCUMENT_COLUMNS[path] || extra.length > 0) merged = merged.filter(d => pathValue(d, path) === want);
    }
    return q.limit !== undefined ? merged.slice(0, q.limit) : merged;
  }

  async search(s: IWireSearch): Promise<IWireDoc[]> {
    const { rows } = await this.execute({ sql: `SELECT ${DOC_COLUMNS} FROM store_documents WHERE namespace = ? AND embedding IS NOT NULL`, args: [s.namespace] });
    return rows
      .map(row => {
        const doc = documentToWire(row);
        return { doc, score: cosineSimilarity(s.vector, doc.embedding ?? []) };
      })
      .filter(hit => hit.score >= s.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, s.limit)
      .map(hit => hit.doc);
  }

  // ---------------------------------------------------------------------------
  // THE COMMIT: one request, decided by the database
  // ---------------------------------------------------------------------------

  async commit(request: ICommitRequest): Promise<ICommitResult> {
    const planned = planCommit(request);
    // Every send of this commit, each its own token: the ops land only beside this send's own row, and a
    // retry knows a row any of its sends left for its own (a lost answer), whichever one landed it
    const sends: string[] = [];
    const build = (): Statement[] => {
      const send = randomUUID();
      sends.push(send);
      const mine = { sql: 'EXISTS (SELECT 1 FROM store_commits WHERE id = ? AND nonce = ?)', args: [request.commitId, send] };
      const ours = { sql: `EXISTS (SELECT 1 FROM store_commits WHERE id = ? AND nonce IN (${marks(sends.length)}))`, args: [request.commitId, ...sends] };
      return [
        { sql: `INSERT INTO store_commits (id, at, nonce) SELECT ?, ?, ? WHERE (${planned.verdict.sql}) = 'go'`, args: [request.commitId, Date.now(), send, ...planned.verdict.args] },
        { sql: `SELECT (${planned.verdict.sql}) AS v WHERE NOT ${ours.sql}`, args: [...planned.verdict.args, ...ours.args] },
        ...planned.writes.map(w => ({ sql: w.sql.replace('/*MINE*/', mine.sql), args: [...w.args, ...mine.args] }))
      ];
    };
    let results;
    try {
      results = await this.batch(build, 'write');
    } catch (e) {
      // Two ids for one place in a chain (`ledger_x_5` and `ledger_x_00000005`), raced: the loser reads again
      if (isUnique(e)) throw new StoreConflict('Another writer took that place first.');
      if (isTooBig(e)) throw new StoreRefusal(`The commit holds a value the database cannot store: ${(e as Error).message}`);
      throw e;
    }
    const said = results[1].rows[0];
    if (!said) return { applied: true };
    return planned.answer(String(said.v));
  }

  // ---------------------------------------------------------------------------
  // AROUND THE LAW: taking a player out (server/hub/erase.ts)
  // ---------------------------------------------------------------------------

  /** Every row of these chains and every one of these documents, out, in one request, whole or not at all. */
  async erase(docs: string[], chains: string[]): Promise<{ rows: number; documents: number }> {
    const statements: Statement[] = [
      ...parts(chains).map(ids => ({ sql: `DELETE FROM store_ledger_rows WHERE owner_uid IN (${marks(ids.length)})`, args: ids })),
      ...parts(docs).map(ids => ({ sql: `DELETE FROM store_documents WHERE id IN (${marks(ids.length)})`, args: ids }))
    ];
    if (statements.length === 0) return { rows: 0, documents: 0 };
    const results = await this.batch(statements, 'write');
    const chainParts = parts(chains).length;
    let rows = 0;
    let documents = 0;
    results.forEach((r, i) => { if (i < chainParts) rows += r.rowsAffected; else documents += r.rowsAffected; });
    return { rows, documents };
  }
}

export async function openTursoStore(config: IColdConfig): Promise<TursoStore> {
  return new TursoStore(await openNetworkClient(config));
}

// ------------------------------------------------------------------------------------------------
// THE VERDICT: the law's every decision, as one SQL expression the database evaluates
// ------------------------------------------------------------------------------------------------

interface IPlan {
  verdict: { sql: string; args: any[] };
  /** Each written only if the commit's own row is this send's (`/*MINE*\/`). */
  writes: Statement[];
  /** What a verdict other than 'go' means, in the law's own words. */
  answer: (verdict: string) => ICommitResult;
}

function planCommit(request: ICommitRequest): IPlan {
  if (!request || typeof request.commitId !== 'string' || !Array.isArray(request.ops)) throw new StoreRefusal('That is not a commit.');
  const whens: string[] = [];
  const args: any[] = [];
  const writes: Statement[] = [];
  /** The law's words for each verdict but 'go', by the verdict's kind and its op. */
  const words = new Map<string, (verdict: string[]) => string>();
  const when = (condition: string, conditionArgs: any[], then: string, thenArgs: any[] = []) => {
    whens.push(`WHEN ${condition} THEN ${then}`);
    args.push(...conditionArgs, ...thenArgs);
  };
  const refuse = (i: number, why: string) => { words.set(`refuse:${i}`, () => why); when('1', [], `'refuse:${i}'`); };

  when('EXISTS (SELECT 1 FROM store_commits WHERE id = ?)', [request.commitId], `'seen'`);
  if (request.guardAbsent) when('EXISTS (SELECT 1 FROM store_documents WHERE id = ?)', [request.guardAbsent], `'guard'`);

  // Where each chain stands once the rows before an op in this commit are counted: max(the chain's top, the highest seq before it)
  const top = `COALESCE((SELECT MAX(seq) FROM store_ledger_rows WHERE owner_uid = ?), 0)`;
  const highest = new Map<string, number>();
  const firstText = new Map<string, string>();

  request.ops.forEach((op: CommitOp, i) => {
    if (op.kind === 'add') {
      const problem = cannotHold({ id: op.id, namespace: op.namespace }, {}, { at: op.at }, { amount: op.amount });
      if (problem) return refuse(i, `The commit holds a value the database cannot store: ${problem}`);
      writes.push({
        sql: `INSERT INTO store_treasuries (${TREASURY_COLUMNS}) SELECT ?, ?, CAST(? AS REAL), ?, ? WHERE /*MINE*/ ON CONFLICT (id) DO UPDATE SET gold = gold + excluded.gold, updated_at = excluded.updated_at`,
        args: [op.id, op.namespace, goldText(op.amount), whole(op.at), whole(op.at)]
      });
      return;
    }

    const { doc } = op;
    const ifAbsent = op.kind === 'putIfAbsent';
    const where = route(doc.id, doc.namespace);

    if (where.to === 'head') {
      if (ifAbsent) return;
      let claimed: unknown;
      try { claimed = JSON.parse(doc.dataText)?.seq; } catch { return refuse(i, `Head ${doc.id} is not JSON text.`); }
      const before = highest.get(where.uid) ?? 0;
      when(`max(${top}, ?) IS NOT ?`, [where.uid, before, typeof claimed === 'number' ? claimed : null], `'head:${i}:' || max(${top}, ?)`, [where.uid, before]);
      words.set(`head:${i}`, v => `Ledger ${where.uid} is at seq ${v[2]}, not ${claimed}.`);
      return;
    }

    if (where.to === 'row') {
      const { uid, seq } = where;
      const before = highest.get(uid) ?? 0;
      highest.set(uid, Math.max(before, seq));
      const first = firstText.get(doc.id);
      if (first !== undefined) {
        // The same row twice in one commit: what stands by then is what the first left, unless it was held already
        if (!ifAbsent) {
          when('COALESCE((SELECT data FROM store_ledger_rows WHERE id = ?), ?) <> ?', [doc.id, first, doc.dataText], `'differs:${i}'`);
          words.set(`differs:${i}`, () => `Ledger ${uid} already holds a different row at seq ${seq}.`);
        }
        return;
      }
      firstText.set(doc.id, doc.dataText);
      const held = 'EXISTS (SELECT 1 FROM store_ledger_rows WHERE id = ?)';
      if (!ifAbsent) {
        when('COALESCE((SELECT data FROM store_ledger_rows WHERE id = ?) <> ?, 0)', [doc.id, doc.dataText], `'differs:${i}'`);
        words.set(`differs:${i}`, () => `Ledger ${uid} already holds a different row at seq ${seq}.`);
      }
      // Not held: it must be the next of its chain
      when(`NOT ${held} AND ? <> max(${top}, ?) + 1`, [doc.id, seq, uid, before], `'gap:${i}:' || max(${top}, ?)`, [uid, before]);
      words.set(`gap:${i}`, v => `Ledger ${uid} is at seq ${v[2]}; a row at seq ${seq} would break the chain.`);

      let signed: any;
      try { signed = JSON.parse(doc.dataText); } catch {
        when(`NOT ${held}`, [doc.id], `'refuse:${i}'`);
        words.set(`refuse:${i}`, () => `Row ${doc.id} is not JSON text.`);
        return;
      }
      const payload = signed?.payload;
      if (payload?.seq !== seq || payload?.prevSeq !== seq - 1 || typeof payload?.type !== 'string' || typeof signed?.signature !== 'string') {
        when(`NOT ${held}`, [doc.id], `'says:${i}'`);
        words.set(`says:${i}`, () => `Row ${doc.id} does not say what its id says.`);
        return;
      }
      const problem = cannotHold(
        { id: doc.id, type: payload.type, signature: signed.signature, data: doc.dataText, uid },
        { seq, version: doc.metadata.version },
        { ts: payload.ts, createdAt: doc.metadata.createdAt, updatedAt: doc.metadata.updatedAt }
      );
      if (problem) {
        when(`NOT ${held}`, [doc.id], `'refuse:${i}'`);
        words.set(`refuse:${i}`, () => `The commit holds a value the database cannot store: ${problem}`);
        return;
      }
      writes.push({
        sql: `INSERT INTO store_ledger_rows (${ROW_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE /*MINE*/ ON CONFLICT (id) DO NOTHING`,
        args: [doc.id, uid, seq, payload.prevSeq, whole(payload.ts), payload.type, signed.signature, doc.dataText, whole(doc.metadata.version), whole(doc.metadata.createdAt), whole(doc.metadata.updatedAt)]
      });
      return;
    }

    if (where.to === 'treasury') {
      let gold: unknown;
      try { gold = JSON.parse(doc.dataText)?.gold; } catch { return refuse(i, `Treasury ${doc.id} is not JSON text.`); }
      if (typeof gold !== 'number') return refuse(i, `Treasury ${doc.id} holds no number.`);
      const problem = cannotHold({ id: doc.id, namespace: doc.namespace }, {}, { createdAt: doc.metadata.createdAt, updatedAt: doc.metadata.updatedAt }, { gold });
      if (problem) return refuse(i, `The commit holds a value the database cannot store: ${problem}`);
      writes.push({
        sql: `INSERT INTO store_treasuries (${TREASURY_COLUMNS}) SELECT ?, ?, CAST(? AS REAL), ?, ? WHERE /*MINE*/ ON CONFLICT (id) ${ifAbsent ? 'DO NOTHING' : 'DO UPDATE SET namespace = excluded.namespace, gold = excluded.gold, created_at = excluded.created_at, updated_at = excluded.updated_at'}`,
        args: [doc.id, doc.namespace, goldText(gold), whole(doc.metadata.createdAt), whole(doc.metadata.updatedAt)]
      });
      return;
    }

    // A document
    let data: any;
    try { data = JSON.parse(doc.dataText); } catch { return refuse(i, 'A document\'s data is not JSON text.'); }
    const docType = typeof data?.type === 'string' ? data.type : null;
    const genre = typeof data?.genre === 'string' ? data.genre : null;
    const problem = cannotHold(
      { id: doc.id, namespace: doc.namespace, data: doc.dataText, type: docType, genre, ownerCertUid: doc.metadata.ownerCertUid, signature: doc.metadata.signature },
      { version: doc.metadata.version },
      { createdAt: doc.metadata.createdAt, updatedAt: doc.metadata.updatedAt }
    );
    if (problem) return refuse(i, `The commit holds a value the database cannot store: ${problem}`);
    const embedding = doc.embedding && doc.embedding.length > 0 ? JSON.stringify(doc.embedding) : null;
    writes.push({
      sql: `INSERT INTO store_documents (${DOC_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE /*MINE*/ ON CONFLICT (id) ${ifAbsent ? 'DO NOTHING' : 'DO UPDATE SET namespace = excluded.namespace, data = excluded.data, embedding = excluded.embedding, doc_type = excluded.doc_type, genre = excluded.genre, owner_cert_uid = excluded.owner_cert_uid, signature = excluded.signature, version = excluded.version, created_at = excluded.created_at, updated_at = excluded.updated_at'}`,
      args: [doc.id, doc.namespace, doc.dataText, embedding, docType, genre, doc.metadata.ownerCertUid ?? null, doc.metadata.signature ?? null, whole(doc.metadata.version), whole(doc.metadata.createdAt), whole(doc.metadata.updatedAt)]
    });
  });

  return {
    verdict: { sql: `CASE ${whens.join(' ')} ELSE 'go' END`, args },
    writes,
    answer(verdict) {
      const v = verdict.split(':');
      if (v[0] === 'seen' || v[0] === 'guard') return { applied: false };
      const said = words.get(`${v[0]}:${v[1]}`);
      if (!said) throw new Error(`The store could not read its own verdict: ${verdict}`);
      // Refused: no database holds it. Anything else is the chain's law, and the writer reads again
      if (v[0] === 'refuse') throw new StoreRefusal(said(v));
      throw new StoreConflict(said(v));
    }
  };
}

// --- rows to the wire ---------------------------------------------------------------------------

function documentToWire(row: any): IWireDoc {
  const embedding = toEmbedding(row.embedding);
  return {
    id: String(row.id),
    namespace: String(row.namespace),
    dataText: String(row.data),
    ...(embedding ? { embedding } : {}),
    metadata: {
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      ...(row.owner_cert_uid !== null ? { ownerCertUid: String(row.owner_cert_uid) } : {}),
      ...(row.signature !== null ? { signature: String(row.signature) } : {}),
      version: Number(row.version)
    }
  };
}

function rowToWire(row: any): IWireDoc {
  return {
    id: String(row.id),
    namespace: LEDGER_NS,
    dataText: String(row.data),
    metadata: { createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ownerCertUid: String(row.owner_uid), signature: String(row.signature), version: Number(row.version) }
  };
}

function treasuryToWire(row: any): IWireDoc {
  return {
    id: String(row.id),
    namespace: String(row.namespace),
    dataText: JSON.stringify({ gold: Number(row.gold) }),
    metadata: { createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ownerCertUid: 'SYSTEM', version: 1 }
  };
}

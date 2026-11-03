/**
 * THE COLD STORE DOOR (D133): Turso, the durable record. Pedro: "one is cheap to store
 * the other is the live service". Postgres runs the live game, and a commit never waits
 * on this. This door knows nothing of Postgres, and it does three things:
 *
 *   writeDown   a set of rows goes on the record, whole or not at all, once
 *   rows        what is on the record comes back up
 *   runDowntimeJob   SQL work on the record, during a downtime
 *
 * THE NETWORK DRIVER, NEVER THE FILE ONE. `@libsql/client/http` loads no native module.
 * The same package's file path is what crashed the old server (N16), so a `file:` URL is
 * refused here before the driver sees it. This is the only file that imports it.
 *
 * WHOLE AND ONCE. A write-down names the one before it and carries a hash of everything
 * it covers. It goes up as one batch: its manifest, then every row, each asking for the
 * manifest. The manifest's insert is the check: if the record has moved on it inserts
 * nothing, and nothing else lands. Sending the same one twice finds its manifest and
 * changes nothing. A batch is whole or nothing on Turso, which was stopped against it.
 *
 * AS FEW REQUESTS AS THE RECORD TAKES. There is no size of our own: Turso took a 64 MB row,
 * a 41.6 MB batch and a 64 MB answer. Only if the record refuses a write-down as too much does
 * it split: its rows go to staging in halves until each half is taken, then cross in one
 * batch with the manifest. A single row the record will not take is not written at all. A
 * read is the same: every row asked for at once, and halved only when the record refuses.
 *
 * A BATCH CAN OUTLIVE ITS SENDER. On Turso a batch on the wire when its sender was stopped
 * still landed, 1 to 5 seconds later or more, which is longer than a restart takes. Split,
 * the next try can clear staging under it, so the manifest also asks that every staged
 * row is still there: late and without its rows, it lands nothing.
 *
 * A DROPPED CONNECTION IS NOT AN OUTAGE. PGlite runs on this thread, so a few busy seconds
 * can outlast a server's keep-alive, and the next ask meets a connection already closed.
 * Everything here is safe to ask again, so it is, before anyone is told the record is gone.
 *
 * GOLD GOES UP AS TEXT. Turso reads a float off the JSON with one plain divide, which is not
 * always the nearest number: of ordinary fractional balances, about one in five landed a
 * step away from what was sent, and every such save came back as a mismatch. Text it reads
 * itself, and the column's REAL type makes that the very number, as measured on 82,000
 * values from 1e-40 to 1e40. The read-back still has the last word. Whole numbers up to
 * 2^53 cross as they are, and the way back down is exact.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORD_TABLES, RecordRow, RecordTableName, normalRow, tableOf } from './recordRows';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '..', 'drizzle', 'cold');

/**
 * A stuck request must not hold the next retry for ever, and a large one must have time to
 * go up. On Turso, 16 MB once took 25 s, the slowest it went, and 64 MB took 11.5 s. A request
 * gets 4 s for each MB it carries, over twice that slowest rate, on top of 30 s for anything
 * at all: a connect alone took over 10 s once.
 */
const BASE_DEADLINE_MS = 30_000;
const MS_PER_MB = 4_000;
/** How often one ask goes out if its connection keeps dropping. On Turso the second try was always enough. */
const TRIES = 3;
const DROPPED = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'UND_ERR_SOCKET']);

export const requestDeadlineMs = (bytes: number) => BASE_DEADLINE_MS + Math.ceil((bytes / (1024 * 1024)) * MS_PER_MB);

export interface IColdConfig {
  url: string;
  authToken?: string;
}

export interface IWriteDownHead {
  id: string;
  prev: string | null;
  why: string;
  at: number;
  rows: number;
  digest: string;
}

export interface IWriteDown {
  id: string;
  /** The write-down this one was built on. Null means the record must hold none. */
  prev: string | null;
  why: string;
  at: number;
  digest: string;
  rows: Partial<Record<RecordTableName, RecordRow[]>>;
}

export type WriteDownResult =
  | { status: 'APPLIED' }
  /** Its manifest was already there: an earlier send landed and its answer was lost. */
  | { status: 'ALREADY' }
  /** The record moved on from what this one was built on. Nothing was written. */
  | { status: 'MOVED'; head: string | null }
  /** A signed row would change. A chain only appends, so nothing was written. */
  | { status: 'FORK'; id: string };

export interface IColdSql {
  all(sql: string, args?: (string | number | null)[]): Promise<RecordRow[]>;
}

export interface IDowntimeJob {
  name: string;
  run(sql: IColdSql): Promise<{ ok: boolean; report: unknown }>;
}

export interface IColdDoor {
  head(): Promise<IWriteDownHead | null>;
  has(id: string): Promise<boolean>;
  writeDown(down: IWriteDown, fault?: (stage: string) => void | Promise<void>): Promise<WriteDownResult>;
  /** Rows of one table in id order, after a given id. Empty means the end. */
  rows(table: RecordTableName, after: string): Promise<RecordRow[]>;
  /** The given rows as the record holds them now. */
  read(table: RecordTableName, ids: string[]): Promise<RecordRow[]>;
  runDowntimeJob(job: IDowntimeJob): Promise<{ ok: boolean; report: unknown }>;
  close(): void;
}

/** This URL is not one this door will take. Not an outage: it stays wrong until someone changes it. */
export class ColdDoorRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColdDoorRefused';
  }
}

export function assertNetworkUrl(url: string): void {
  if (!/^(libsql|https?):\/\//i.test(url)) {
    throw new ColdDoorRefused(`The record is reached over the network, by a libsql:// or http(s):// URL, and "${url.split('?')[0]}" is not one. A file through this driver is what crashed the old server.`);
  }
}

function dropped(e: unknown): boolean {
  for (let at: any = e; at; at = at.cause) if (DROPPED.has(at.code)) return true;
  return false;
}

/**
 * The record will not take this much in one go: a request too large, too many bound values in
 * one statement, or an answer too large. Turso refused none of these in what it was given, so
 * how it would say so is not known: a 413, or a message saying it is too large or too many.
 */
function tooMuch(e: unknown): boolean {
  for (let at: any = e; at; at = at.cause) if (at.status === 413 || /too large|toobig|too many/i.test(String(at.message))) return true;
  return false;
}

/** A refused connection or a server's error is an answer, and goes straight back. Only a dropped connection goes out again. */
async function askAgainIfDropped<T>(ask: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await ask();
    } catch (e) {
      if (tries >= TRIES || !dropped(e)) throw e;
    }
  }
}

type Client = import('@libsql/client/http').Client;
type Statement = { sql: string; args: any[] };

const stage = (table: RecordTableName) => `cold_stage_${table}`;
const list = (columns: string[]) => columns.join(', ');
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
/** See GOLD GOES UP AS TEXT. What is not a number at all still reaches the driver, which refuses it. */
const sendable = (table: RecordTableName, column: string, value: unknown) => (table === 'treasuries' && column === 'gold' && Number.isFinite(value) ? String(value) : value ?? null);

/** A ledger row or a commit never changes once it is there. */
function onConflict(table: RecordTableName): string {
  const { columns } = tableOf(table);
  return table === 'ledger_rows' || table === 'commits'
    ? 'DO NOTHING'
    : `DO UPDATE SET ${columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`;
}

/** One row, straight in, if its write-down's manifest went in before it. */
function rowStatement(table: RecordTableName, id: string, row: RecordRow): Statement {
  const { columns } = tableOf(table);
  return {
    sql: `INSERT INTO ${table} (${list(columns)}) SELECT ${marks(columns.length)} WHERE EXISTS (SELECT 1 FROM cold_writedowns WHERE id = ?) ON CONFLICT (id) ${onConflict(table)}`,
    args: [...columns.map(c => sendable(table, c, row[c])), id]
  };
}

/** How each table crosses from staging, when a write-down had to be split. */
function applyStatement(table: RecordTableName, id: string): Statement {
  const { columns } = tableOf(table);
  return {
    sql: `INSERT INTO ${table} (${list(columns)}) SELECT ${list(columns)} FROM ${stage(table)} WHERE writedown = ? AND EXISTS (SELECT 1 FROM cold_writedowns WHERE id = ?) ON CONFLICT (id) ${onConflict(table)}`,
    args: [id, id]
  };
}

export async function openColdDoor(config: IColdConfig): Promise<IColdDoor> {
  assertNetworkUrl(config.url);
  const { createClient } = await import('@libsql/client/http');
  const client: Client = createClient({
    url: config.url,
    authToken: config.authToken,
    fetch: async (input: any, init?: any) => {
      const bytes = input instanceof Request ? (await input.clone().arrayBuffer()).byteLength : typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0;
      return fetch(input, { ...init, signal: AbortSignal.timeout(requestDeadlineMs(bytes)) });
    }
  });

  // Applied on first need, and asked again after a failure: an outage at the start is not the end of it.
  let migrated: Promise<void> | null = null;
  const ready = () => {
    migrated ??= migrate(client).catch(e => { migrated = null; throw e; });
    return migrated;
  };

  const headRow = async (): Promise<IWriteDownHead | null> => {
    const { rows } = await client.execute('SELECT id, prev, why, at, rows, digest FROM cold_writedowns ORDER BY seq DESC LIMIT 1');
    const row = rows[0];
    return row ? { id: String(row.id), prev: row.prev === null ? null : String(row.prev), why: String(row.why), at: Number(row.at), rows: Number(row.rows), digest: String(row.digest) } : null;
  };

  const has = async (id: string) => (await client.execute({ sql: 'SELECT 1 FROM cold_writedowns WHERE id = ?', args: [id] })).rows.length > 0;

  const read = async (table: RecordTableName, ids: string[]): Promise<RecordRow[]> => {
    if (ids.length === 0) return [];
    const shape = tableOf(table);
    try {
      const { rows } = await client.execute({ sql: `SELECT ${list(shape.columns)} FROM ${table} WHERE id IN (${marks(ids.length)})`, args: ids });
      return rows.map(row => normalRow(shape, row as unknown as RecordRow));
    } catch (e) {
      if (!tooMuch(e) || ids.length === 1) throw e;
      const half = Math.ceil(ids.length / 2);
      return [...await read(table, ids.slice(0, half)), ...await read(table, ids.slice(half))];
    }
  };

  /** Every row after `after`, or as many as the record gives in one answer: halved from all of them until it gives them. */
  const page = async (table: RecordTableName, after: string, limit?: number): Promise<RecordRow[]> => {
    const shape = tableOf(table);
    try {
      const { rows } = await client.execute({ sql: `SELECT ${list(shape.columns)} FROM ${table} WHERE id > ? ORDER BY id${limit ? ` LIMIT ${limit}` : ''}`, args: [after] });
      return rows.map(r => normalRow(shape, r as unknown as RecordRow));
    } catch (e) {
      if (!tooMuch(e) || limit === 1) throw e;
      const left = limit ?? Number((await client.execute({ sql: `SELECT COUNT(*) n FROM ${table} WHERE id > ?`, args: [after] })).rows[0].n);
      if (left <= 1) throw e;
      return page(table, after, Math.ceil(left / 2));
    }
  };

  return {
    head: () => askAgainIfDropped(async () => {
      await ready();
      return headRow();
    }),

    has: id => askAgainIfDropped(async () => {
      await ready();
      return has(id);
    }),

    writeDown: (down, fault = () => undefined) => askAgainIfDropped(async (): Promise<WriteDownResult> => {
      await ready();
      if (await has(down.id)) return { status: 'ALREADY' };
      const head = await headRow();
      if ((head?.id ?? null) !== down.prev) return { status: 'MOVED', head: head?.id ?? null };

      // A chain only appends. A row that differs is someone else's history, and is not ours to replace.
      const ledger = down.rows.ledger_rows ?? [];
      if (ledger.length > 0) {
        const held = new Map((await read('ledger_rows', ledger.map(r => String(r.id)))).map(r => [String(r.id), r.data]));
        for (const row of ledger) {
          const was = held.get(String(row.id));
          if (was !== undefined && was !== row.data) return { status: 'FORK', id: String(row.id) };
        }
      }

      const total = RECORD_TABLES.reduce((n, t) => n + (down.rows[t.name]?.length ?? 0), 0);
      const manifest = (asks: string, args: unknown[]): Statement => ({
        // Inserted only if the record still stands where this one was built. Everything after it asks for this row.
        sql: `INSERT INTO cold_writedowns (id, prev, why, at, rows, digest)
              SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT id FROM cold_writedowns ORDER BY seq DESC LIMIT 1) IS ?${asks}`,
        args: [down.id, down.prev, down.why, down.at, total, down.digest, down.prev, ...args]
      });
      // What a stopped split send left in staging is not this one's.
      const clearStaging = RECORD_TABLES.map(t => ({ sql: `DELETE FROM ${stage(t.name)}`, args: [] }));
      const landed = async (affected: number): Promise<WriteDownResult> => {
        if (affected > 0) return { status: 'APPLIED' };
        // Its own earlier send can land after this one started. Nothing moved at all means what it staged was cleared.
        const moved = (await headRow())?.id ?? null;
        if (moved === down.id) return { status: 'ALREADY' };
        if (moved === down.prev) throw new Error('What this write-down staged was gone before it crossed, so nothing was written.');
        return { status: 'MOVED', head: moved };
      };

      await fault('sending');
      try {
        const results = await client.batch([
          manifest('', []),
          ...RECORD_TABLES.flatMap(t => (down.rows[t.name] ?? []).map(row => rowStatement(t.name, down.id, row))),
          ...clearStaging
        ], 'write');
        await fault('applied');
        return landed(results[0].rowsAffected);
      } catch (e) {
        if (!tooMuch(e)) throw e;
      }

      // Too large for one request: staged in halves until each is taken, then across in one batch.
      await client.batch(clearStaging, 'write');
      const stageIn = async (part: Statement[]): Promise<void> => {
        try {
          await client.batch(part, 'write');
          await fault('staged-part');
        } catch (e) {
          if (!tooMuch(e)) throw e;
          if (part.length === 1) throw new Error('One row is larger than the record takes in one request, so nothing was written.');
          await stageIn(part.slice(0, Math.ceil(part.length / 2)));
          await stageIn(part.slice(Math.ceil(part.length / 2)));
        }
      };
      const staged = RECORD_TABLES.flatMap(shape => (down.rows[shape.name] ?? []).map(row => ({
        sql: `INSERT INTO ${stage(shape.name)} (writedown, ${list(shape.columns)}) VALUES (?, ${marks(shape.columns.length)})`,
        args: [down.id, ...shape.columns.map(c => sendable(shape.name, c, row[c]))]
      })));
      const half = Math.ceil(staged.length / 2);
      await stageIn(staged.slice(0, half));
      if (half < staged.length) await stageIn(staged.slice(half));
      await fault('staged');

      const allStaged = RECORD_TABLES.map(t => ` AND (SELECT COUNT(*) FROM ${stage(t.name)} WHERE writedown = ?) = ?`).join('');
      const results = await client.batch([
        manifest(allStaged, RECORD_TABLES.flatMap(t => [down.id, down.rows[t.name]?.length ?? 0])),
        ...RECORD_TABLES.map(t => applyStatement(t.name, down.id)),
        ...RECORD_TABLES.map(t => ({ sql: `DELETE FROM ${stage(t.name)} WHERE writedown = ?`, args: [down.id] }))
      ], 'write');
      await fault('applied');
      return landed(results[0].rowsAffected);
    }),

    rows: (table, after) => askAgainIfDropped(async () => {
      await ready();
      return page(table, after);
    }),

    read: (table, ids) => askAgainIfDropped(async () => {
      await ready();
      return read(table, ids);
    }),

    runDowntimeJob: job => askAgainIfDropped(async () => {
      await ready();
      const sql: IColdSql = {
        all: async (text, args = []) => (await client.execute({ sql: text, args })).rows as unknown as RecordRow[]
      };
      const { ok, report } = await job.run(sql);
      await client.execute({ sql: 'INSERT INTO cold_jobs (name, at, ok, report) VALUES (?, ?, ?, ?)', args: [job.name, Date.now(), ok ? 1 : 0, JSON.stringify(report)] });
      return { ok, report };
    }),

    close() {
      client.close();
    }
  };
}

/** The record's own migrations, in order, each recorded in the batch that applies it. */
async function migrate(client: Client): Promise<void> {
  await client.execute('CREATE TABLE IF NOT EXISTS cold_migrations (name text PRIMARY KEY NOT NULL, at integer NOT NULL)');
  const { rows } = await client.execute('SELECT name FROM cold_migrations');
  const done = new Set(rows.map(r => String(r.name)));
  for (const name of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const statements = readFileSync(join(MIGRATIONS, name), 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    await client.batch([
      ...statements.map(sql => ({ sql, args: [] })),
      { sql: 'INSERT INTO cold_migrations (name, at) VALUES (?, ?)', args: [name, Date.now()] }
    ], 'write');
  }
}

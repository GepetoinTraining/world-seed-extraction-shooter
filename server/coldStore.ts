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
 * it covers. Its rows land in staging tables, in as many requests as they need, then
 * cross in one batch with their manifest. The manifest's insert is the check: if the
 * record has moved on it inserts nothing, and every other statement asks for it. Sending
 * the same one twice finds its manifest and changes nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORD_TABLES, RecordRow, RecordTableName, normalRow, tableOf } from './recordRows';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '..', 'drizzle', 'cold');

/** A guess, until this has met Turso: one request's worth of staged text. A larger single row still goes alone. */
const STAGE_BYTES = 2 * 1024 * 1024;
const READ_PAGE = 500;
const IDS_PER_READ = 100;
/** Nothing here has a deadline of its own, and a stuck request must not hold the next retry for ever. */
const REQUEST_TIMEOUT_MS = 60_000;

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

type Client = import('@libsql/client/http').Client;
type Statement = { sql: string; args: any[] };

const stage = (table: RecordTableName) => `cold_stage_${table}`;
const list = (columns: string[]) => columns.join(', ');
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** How each table crosses from staging. A ledger row or a commit never changes once it is there. */
function applyStatement(table: RecordTableName, id: string): Statement {
  const { columns } = tableOf(table);
  const onConflict = table === 'ledger_rows' || table === 'commits'
    ? 'DO NOTHING'
    : `DO UPDATE SET ${columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`;
  return {
    sql: `INSERT INTO ${table} (${list(columns)}) SELECT ${list(columns)} FROM ${stage(table)} WHERE writedown = ? AND EXISTS (SELECT 1 FROM cold_writedowns WHERE id = ?) ON CONFLICT (id) ${onConflict}`,
    args: [id, id]
  };
}

export async function openColdDoor(config: IColdConfig): Promise<IColdDoor> {
  assertNetworkUrl(config.url);
  const { createClient } = await import('@libsql/client/http');
  const client: Client = createClient({
    url: config.url,
    authToken: config.authToken,
    fetch: (input: any, init?: any) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
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
    const shape = tableOf(table);
    const out: RecordRow[] = [];
    for (let at = 0; at < ids.length; at += IDS_PER_READ) {
      const some = ids.slice(at, at + IDS_PER_READ);
      const { rows } = await client.execute({ sql: `SELECT ${list(shape.columns)} FROM ${table} WHERE id IN (${marks(some.length)})`, args: some });
      for (const row of rows) out.push(normalRow(shape, row as unknown as RecordRow));
    }
    return out;
  };

  return {
    async head() {
      await ready();
      return headRow();
    },

    async has(id) {
      await ready();
      return has(id);
    },

    async writeDown(down, fault = () => undefined) {
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

      // What an earlier stopped try left behind is not this one's.
      await client.batch(RECORD_TABLES.map(t => ({ sql: `DELETE FROM ${stage(t.name)}`, args: [] })), 'write');

      for (const shape of RECORD_TABLES) {
        const insert = `INSERT INTO ${stage(shape.name)} (writedown, ${list(shape.columns)}) VALUES (?, ${marks(shape.columns.length)})`;
        let part: Statement[] = [];
        let bytes = 0;
        for (const row of down.rows[shape.name] ?? []) {
          const args = [down.id, ...shape.columns.map(c => row[c] ?? null)];
          const size = args.reduce<number>((n, a) => n + (typeof a === 'string' ? Buffer.byteLength(a) : 8), 0);
          if (part.length > 0 && bytes + size > STAGE_BYTES) {
            await client.batch(part, 'write');
            await fault('staged-part');
            part = [];
            bytes = 0;
          }
          part.push({ sql: insert, args });
          bytes += size;
        }
        if (part.length > 0) await client.batch(part, 'write');
      }
      await fault('staged');

      const total = RECORD_TABLES.reduce((n, t) => n + (down.rows[t.name]?.length ?? 0), 0);
      const results = await client.batch([
        {
          // Inserted only if the record still stands where this one was built. Everything below asks for this row.
          sql: `INSERT INTO cold_writedowns (id, prev, why, at, rows, digest)
                SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT id FROM cold_writedowns ORDER BY seq DESC LIMIT 1) IS ?`,
          args: [down.id, down.prev, down.why, down.at, total, down.digest, down.prev]
        },
        ...RECORD_TABLES.map(t => applyStatement(t.name, down.id)),
        ...RECORD_TABLES.map(t => ({ sql: `DELETE FROM ${stage(t.name)} WHERE writedown = ?`, args: [down.id] }))
      ], 'write');
      await fault('applied');

      if (results[0].rowsAffected === 0) return { status: 'MOVED', head: (await headRow())?.id ?? null };
      return { status: 'APPLIED' };
    },

    async rows(table, after) {
      await ready();
      const shape = tableOf(table);
      const { rows } = await client.execute({ sql: `SELECT ${list(shape.columns)} FROM ${table} WHERE id > ? ORDER BY id LIMIT ${READ_PAGE}`, args: [after] });
      return rows.map(r => normalRow(shape, r as unknown as RecordRow));
    },

    async read(table, ids) {
      await ready();
      return read(table, ids);
    },

    async runDowntimeJob(job) {
      await ready();
      const sql: IColdSql = {
        all: async (text, args = []) => (await client.execute({ sql: text, args })).rows as unknown as RecordRow[]
      };
      const { ok, report } = await job.run(sql);
      await client.execute({ sql: 'INSERT INTO cold_jobs (name, at, ok, report) VALUES (?, ?, ?, ?)', args: [job.name, Date.now(), ok ? 1 : 0, JSON.stringify(report)] });
      return { ok, report };
    },

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

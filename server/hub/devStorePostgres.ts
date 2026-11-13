/**
 * THE DEVELOPERS' VIEW'S BODY FOR THE STORE AS IT STANDS TODAY: SqlStore on Postgres, served or in a
 * folder (devStore.ts says what a body answers; dev.ts is the view, which knows no database). Every
 * line of SQL the view needs is here and nowhere else, so a body for another store is written beside
 * this one by the same shapes.
 *
 * A table is named in a query only from the database's own catalog (`information_schema`), through
 * `sql.identifier`; every value goes in as a bound parameter. Nothing here writes.
 */
import { sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDatabase } from '../../shared/dbShared';
import type { SqlStore } from '../../shared/SqlStore';
import { MIGRATIONS_FOLDER } from '../connection';
import {
  NO_TABLE, NOT_ONE_BY_ONE, num, parsed, plainRow,
  type DevCountOf, type IDevCount, type IDevDocumentLine, type IDevFindAsk, type IDevFound, type IDevPage, type IDevPageAsk,
  type IDevReceiptLine, type IDevStore, type IDevStoreState, type IDevTables
} from './devStore';

const DOCUMENTS = 'documents';
const LEDGER = 'ledger_rows';
const LINES = 'live_lines';
/** What orders a table newest first: the first of these it has, then its id. A sequence orders, but is no moment. */
const TIME_COLUMNS = ['updated_at', 'ts', 'at', 'seq', 'created_at'];
/** A long text in a list is cut; the row opened whole shows it all. */
const LIST_TEXT_MOST = 200;

const documentLine = (r: any): IDevDocumentLine => ({ table: DOCUMENTS, id: String(r.id), namespace: String(r.namespace), type: r.doc_type ?? null, owner: r.owner_cert_uid ?? null, createdAt: num(r.created_at), updatedAt: num(r.updated_at), bytes: num(r.bytes) });
const receiptLine = (r: any): IDevReceiptLine => ({ table: LEDGER, id: String(r.id), owner: String(r.owner_uid), seq: num(r.seq), type: String(r.type), ts: num(r.ts), bytes: num(r.bytes) });
const DOCUMENT_LINE = sql`id, namespace, doc_type, owner_cert_uid, created_at, updated_at, LENGTH(data) AS bytes`;
const RECEIPT_LINE = sql`id, owner_uid, seq, type, ts, LENGTH(data) AS bytes`;

export class PostgresDevStore implements IDevStore {
  constructor(private readonly store: SqlStore, private readonly database: IDatabase) {}

  private get db() { return this.database.db; }

  private async one(query: ReturnType<typeof sql>): Promise<any> {
    return ((await this.db.execute(query)).rows[0] ?? {}) as any;
  }

  // --- the store itself ---------------------------------------------------------------------------

  async state(): Promise<IDevStoreState> {
    const health = await this.store.health();
    const marked = Number((await this.one(sql`SELECT COUNT(*) AS n FROM cold_changes`)).n);
    return {
      dialect: health.dialect,
      migrations: await this.migrations(),
      record: health.record ? { asked: true, ...health.record, marked } : { asked: false, marked }
    };
  }

  /** How far the database's migrations stand against the ones this build carries. */
  private async migrations(): Promise<IDevStoreState['migrations']> {
    const journal = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
    const known: { tag: string; when: number }[] = existsSync(journal) ? JSON.parse(readFileSync(journal, 'utf8')).entries : [];
    try {
      const row = await this.one(sql`SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM drizzle.__drizzle_migrations`);
      const newest = num(row.newest);
      return { applied: Number(row.n), known: known.length, newest: known.find(m => m.when === newest)?.tag ?? null };
    } catch {
      return { applied: null, known: known.length, newest: null };
    }
  }

  async count(what: DevCountOf): Promise<IDevCount> {
    const of = 'of' in what ? what.of : null;
    if (of === 'receipts') {
      const row = await this.one(sql`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ledger_rows`);
      const latest = await this.one(sql`SELECT id, ts FROM ledger_rows ORDER BY ts DESC, id DESC LIMIT 1`);
      return { count: Number(row.n), latest: latest.id !== undefined ? { table: LEDGER, id: String(latest.id), at: Number(latest.ts) } : null, oldest: num(row.oldest) };
    }
    if (of === 'lines') {
      if (!(await this.tableNames()).includes(LINES)) return { count: 0, latest: null, oldest: null };
      const row = await this.one(sql`SELECT COUNT(*) AS n, MIN(at) AS oldest FROM live_lines`);
      const latest = await this.one(sql`SELECT key, at FROM live_lines ORDER BY at DESC, key DESC LIMIT 1`);
      return { count: Number(row.n), latest: latest.key !== undefined ? { table: LINES, id: String(latest.key), at: Number(latest.at) } : null, oldest: num(row.oldest) };
    }
    const where = of === 'live_events'
      ? sql`namespace = 'live' AND substr(id, 1, 11) = 'live_event_'`
      : sql`namespace = 'hub' AND doc_type = ${(what as { kind: string }).kind}`;
    const row = await this.one(sql`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM documents WHERE ${where}`);
    const latest = await this.one(sql`SELECT id, updated_at FROM documents WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT 1`);
    return { count: Number(row.n), latest: latest.id !== undefined ? { table: DOCUMENTS, id: String(latest.id), at: Number(latest.updated_at) } : null, oldest: num(row.oldest) };
  }

  // --- the data itself ----------------------------------------------------------------------------

  /** The tables this database holds, by its own catalog: nothing else is ever named in a query. */
  private async tableNames(): Promise<string[]> {
    const { rows } = await this.db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    return rows.map((r: any) => String(r.table_name));
  }

  private async columnsOf(table: string): Promise<string[]> {
    const { rows } = await this.db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`);
    return rows.map((r: any) => String(r.column_name));
  }

  async tables(): Promise<IDevTables> {
    const tables: IDevTables['tables'] = [];
    for (const name of await this.tableNames()) {
      const columns = await this.columnsOf(name);
      const by = TIME_COLUMNS.filter(c => c !== 'seq').find(c => columns.includes(c)) ?? null;
      const row = await this.one(by
        ? sql`SELECT COUNT(*) AS n, MAX(${sql.identifier(by)}) AS newest FROM ${sql.identifier(name)}`
        : sql`SELECT COUNT(*) AS n, NULL AS newest FROM ${sql.identifier(name)}`);
      tables.push({ name, rows: Number(row.n), newest: num(row.newest) });
    }
    const { rows: collections } = await this.db.execute(sql`SELECT namespace, doc_type, COUNT(*) AS n, MAX(updated_at) AS newest FROM documents GROUP BY namespace, doc_type ORDER BY namespace, doc_type`);
    const { rows: ledger } = await this.db.execute(sql`SELECT type, COUNT(*) AS n, MAX(ts) AS newest FROM ledger_rows GROUP BY type ORDER BY type`);
    return {
      tables,
      collections: collections.map((c: any) => ({ table: DOCUMENTS, namespace: String(c.namespace), type: c.doc_type === null ? null : String(c.doc_type), rows: Number(c.n), newest: num(c.newest) })),
      ledger: ledger.map((l: any) => ({ table: LEDGER, type: String(l.type), rows: Number(l.n), newest: num(l.newest) }))
    };
  }

  async page(ask: IDevPageAsk): Promise<IDevPage | typeof NO_TABLE> {
    const { table, page, size } = ask;
    if (!(await this.tableNames()).includes(table)) return NO_TABLE;
    const columns = await this.columnsOf(table);
    const filter = (value: string | undefined, column: string) => (value && columns.includes(column) ? sql`${sql.identifier(column)} = ${value}` : null);
    const conditions = table === DOCUMENTS
      ? [filter(ask.namespace, 'namespace'), filter(ask.type, 'doc_type'), filter(ask.owner, 'owner_cert_uid')]
      : table === LEDGER
        ? [filter(ask.owner, 'owner_uid'), filter(ask.type, 'type')]
        : [];
    const where = conditions.filter(Boolean) as ReturnType<typeof sql>[];
    const clause = where.length ? sql` WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const time = TIME_COLUMNS.find(c => columns.includes(c));
    const id = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : columns[0];
    const order = sql.join([...(time ? [sql`${sql.identifier(time)} DESC`] : []), sql`${sql.identifier(id)} DESC`], sql`, `);

    const counted = await this.one(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)}${clause}`);
    const shown = table === DOCUMENTS ? DOCUMENT_LINE : table === LEDGER ? RECEIPT_LINE : sql`*`;
    const { rows } = await this.db.execute(sql`SELECT ${shown} FROM ${sql.identifier(table)}${clause} ORDER BY ${order} LIMIT ${size} OFFSET ${page * size}`);
    const listed = rows.map((r: any) => (table === DOCUMENTS ? documentLine(r) : table === LEDGER ? receiptLine(r)
      : Object.fromEntries(Object.entries(plainRow(r)).map(([k, v]) => [k, typeof v === 'string' && v.length > LIST_TEXT_MOST ? `${v.slice(0, LIST_TEXT_MOST)}… (${v.length} characters)` : v]))));
    return { table, total: Number(counted.n), page, size, rows: listed as Record<string, unknown>[] };
  }

  async row(table: string, id: string): Promise<Record<string, unknown> | null | typeof NO_TABLE | typeof NOT_ONE_BY_ONE> {
    if (!(await this.tableNames()).includes(table)) return NO_TABLE;
    const columns = await this.columnsOf(table);
    const key = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : null;
    if (!key) return NOT_ONE_BY_ONE;
    const { rows } = await this.db.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE ${sql.identifier(key)} = ${id} LIMIT 1`);
    if (!rows[0]) return null;
    const found = plainRow(rows[0] as Record<string, unknown>);
    // What a row's text means, read as the hub reads it; a vector stays out, said by its length
    if ('data' in found) found.data = parsed(found.data);
    if ('line' in found) found.line = parsed(found.line);
    if (typeof found.embedding === 'string') found.embedding = `${(parsed(found.embedding) as unknown[] | null)?.length ?? 0} numbers`;
    return found;
  }

  async find(ask: IDevFindAsk): Promise<IDevFound> {
    const { id } = ask;
    const exact = ask.exact.length
      ? (await this.db.execute(sql`SELECT id FROM documents WHERE id IN (${sql.join(ask.exact.map(i => sql`${i}`), sql`, `)}) ORDER BY id`)).rows
      : [];
    const { rows: documents } = await this.db.execute(sql`SELECT ${DOCUMENT_LINE} FROM documents WHERE position(${id} in id) > 0 OR position(${id} in data) > 0 OR owner_cert_uid = ${id} ORDER BY updated_at DESC, id DESC LIMIT ${ask.documents}`);
    const owned = await this.one(sql`SELECT COUNT(*) AS n FROM ledger_rows WHERE owner_uid = ${id}`);
    const { rows: newest } = await this.db.execute(sql`SELECT ${RECEIPT_LINE} FROM ledger_rows WHERE owner_uid = ${id} ORDER BY seq DESC LIMIT ${ask.receipts}`);
    const mentioned = await this.one(sql`SELECT COUNT(*) AS n FROM ledger_rows WHERE owner_uid <> ${id} AND position(${id} in data) > 0`);
    return {
      exact: exact.map((r: any) => ({ table: DOCUMENTS, id: String(r.id) })),
      documents: documents.map(documentLine),
      ledger: { rows: Number(owned.n), newest: newest.map(receiptLine), mentionedIn: Number(mentioned.n) }
    };
  }
}

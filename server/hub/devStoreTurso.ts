/**
 * THE DEVELOPERS' VIEW'S BODY FOR THE STORE ON TURSO ALONE (HT21). Pedro, 2026-11-13: "Yes, Turso only".
 * The same answers as `PostgresDevStore` (devStorePostgres.ts) for the same data, over the store's own
 * tables (`store_documents`, `store_ledger_rows`, and the rest: tursoStore.ts), so nothing in the view's
 * routes or its page knows which database is underneath (devStore.ts says what a body answers).
 *
 * A table is named in a query only after it is found in the database's own catalog (`sqlite_master`),
 * and then quoted; every value goes in as a bound parameter. Nothing here writes.
 *
 * WHAT IS TRUE HERE THAT IS NOT ON A POSTGRES. The store is its own record: nothing is marked for a
 * write-down and nothing waits on one, and the state says so (HT5).
 */
import { readdirSync } from 'node:fs';
import { STORE_IS_ITS_RECORD, STORE_MIGRATIONS, type TursoStore } from '../tursoStore';
import {
  NO_TABLE, NOT_ONE_BY_ONE, num, parsed, plainRow,
  type DevCountOf, type IDevCount, type IDevDocumentLine, type IDevFindAsk, type IDevFound, type IDevPage, type IDevPageAsk,
  type IDevReceiptLine, type IDevStore, type IDevStoreState, type IDevTables
} from './devStore';

const DOCUMENTS = 'store_documents';
const LEDGER = 'store_ledger_rows';
const LINES = 'store_live_lines';
/** What orders a table newest first: the first of these it has, then its id. A sequence orders, but is no moment. */
const TIME_COLUMNS = ['updated_at', 'ts', 'at', 'seq', 'created_at'];
/** A long text in a list is cut; the row opened whole shows it all. */
const LIST_TEXT_MOST = 200;

const documentLine = (r: any): IDevDocumentLine => ({ table: DOCUMENTS, id: String(r.id), namespace: String(r.namespace), type: r.doc_type ?? null, owner: r.owner_cert_uid ?? null, createdAt: num(r.created_at), updatedAt: num(r.updated_at), bytes: num(r.bytes) });
const receiptLine = (r: any): IDevReceiptLine => ({ table: LEDGER, id: String(r.id), owner: String(r.owner_uid), seq: num(r.seq), type: String(r.type), ts: num(r.ts), bytes: num(r.bytes) });
const DOCUMENT_LINE = 'id, namespace, doc_type, owner_cert_uid, created_at, updated_at, LENGTH(data) AS bytes';
const RECEIPT_LINE = 'id, owner_uid, seq, type, ts, LENGTH(data) AS bytes';
/** A name found in the catalog, quoted for SQLite. */
const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** A row as the driver gives it, as a plain object of its columns. */
const asObject = (row: any, columns: string[]): Record<string, unknown> => Object.fromEntries(columns.map(c => [c, row[c]]));

export class TursoDevStore implements IDevStore {
  constructor(private readonly store: TursoStore) {}

  private async all(sql: string, args: unknown[] = []): Promise<any[]> {
    return (await this.store.execute({ sql, args: args as any[] })).rows as any[];
  }

  private async one(sql: string, args: unknown[] = []): Promise<any> {
    return (await this.all(sql, args))[0] ?? {};
  }

  // --- the store itself ---------------------------------------------------------------------------

  async state(): Promise<IDevStoreState> {
    const health = await this.store.health();
    return {
      dialect: health.dialect ?? 'turso',
      migrations: await this.migrations(),
      // The store is its own record: there is no other copy to be behind, and nothing is marked for one
      record: { asked: false, state: 'IN_STORE', says: STORE_IS_ITS_RECORD, behind: 0, marked: 0 }
    };
  }

  private async migrations(): Promise<IDevStoreState['migrations']> {
    let known: string[] = [];
    try { known = readdirSync(STORE_MIGRATIONS).filter(n => n.endsWith('.sql')).sort(); } catch { /* a build that carries none */ }
    try {
      const row = await this.one('SELECT COUNT(*) AS n, MAX(name) AS newest FROM store_migrations');
      return { applied: Number(row.n), known: known.length, newest: row.newest ? String(row.newest).replace(/\.sql$/, '') : null };
    } catch {
      return { applied: null, known: known.length, newest: null };
    }
  }

  async count(what: DevCountOf): Promise<IDevCount> {
    const of = 'of' in what ? what.of : null;
    if (of === 'receipts') {
      const row = await this.one(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ${LEDGER}`);
      const latest = await this.one(`SELECT id, ts FROM ${LEDGER} ORDER BY ts DESC, id DESC LIMIT 1`);
      return { count: Number(row.n), latest: latest.id !== undefined ? { table: LEDGER, id: String(latest.id), at: Number(latest.ts) } : null, oldest: num(row.oldest) };
    }
    if (of === 'lines') {
      // An emptied line is kept a while as an empty row, so the other instances read that it emptied (live/tursoLive.ts): it is no line
      const row = await this.one(`SELECT COUNT(*) AS n, MIN(at) AS oldest FROM ${LINES} WHERE line <> ''`);
      const latest = await this.one(`SELECT key, at FROM ${LINES} WHERE line <> '' ORDER BY at DESC, key DESC LIMIT 1`);
      return { count: Number(row.n), latest: latest.key !== undefined ? { table: LINES, id: String(latest.key), at: Number(latest.at) } : null, oldest: num(row.oldest) };
    }
    const where = of === 'live_events'
      ? { sql: `namespace = 'live' AND substr(id, 1, 11) = 'live_event_'`, args: [] as unknown[] }
      : { sql: `namespace = 'hub' AND doc_type = ?`, args: [(what as { kind: string }).kind] };
    const row = await this.one(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ${DOCUMENTS} WHERE ${where.sql}`, where.args);
    const latest = await this.one(`SELECT id, updated_at FROM ${DOCUMENTS} WHERE ${where.sql} ORDER BY updated_at DESC, id DESC LIMIT 1`, where.args);
    return { count: Number(row.n), latest: latest.id !== undefined ? { table: DOCUMENTS, id: String(latest.id), at: Number(latest.updated_at) } : null, oldest: num(row.oldest) };
  }

  // --- the data itself ----------------------------------------------------------------------------

  /** The tables this database holds, by its own catalog: nothing else is ever named in a query. */
  private async tableNames(): Promise<string[]> {
    return (await this.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`)).map(r => String(r.name));
  }

  private async columnsOf(table: string): Promise<string[]> {
    return (await this.all('SELECT name FROM pragma_table_info(?) ORDER BY cid', [table])).map(r => String(r.name));
  }

  async tables(): Promise<IDevTables> {
    const tables: IDevTables['tables'] = [];
    for (const name of await this.tableNames()) {
      const columns = await this.columnsOf(name);
      const by = TIME_COLUMNS.filter(c => c !== 'seq').find(c => columns.includes(c)) ?? null;
      const row = await this.one(by ? `SELECT COUNT(*) AS n, MAX(${quoted(by)}) AS newest FROM ${quoted(name)}` : `SELECT COUNT(*) AS n, NULL AS newest FROM ${quoted(name)}`);
      tables.push({ name, rows: Number(row.n), newest: num(row.newest) });
    }
    const collections = await this.all(`SELECT namespace, doc_type, COUNT(*) AS n, MAX(updated_at) AS newest FROM ${DOCUMENTS} GROUP BY namespace, doc_type ORDER BY namespace, doc_type`);
    const ledger = await this.all(`SELECT type, COUNT(*) AS n, MAX(ts) AS newest FROM ${LEDGER} GROUP BY type ORDER BY type`);
    return {
      tables,
      collections: collections.map(c => ({ table: DOCUMENTS, namespace: String(c.namespace), type: c.doc_type === null ? null : String(c.doc_type), rows: Number(c.n), newest: num(c.newest) })),
      ledger: ledger.map(l => ({ table: LEDGER, type: String(l.type), rows: Number(l.n), newest: num(l.newest) }))
    };
  }

  async page(ask: IDevPageAsk): Promise<IDevPage | typeof NO_TABLE> {
    const { table, page, size } = ask;
    if (!(await this.tableNames()).includes(table)) return NO_TABLE;
    const columns = await this.columnsOf(table);
    const conditions: string[] = [];
    const args: unknown[] = [];
    const filter = (value: string | undefined, column: string) => { if (value && columns.includes(column)) { conditions.push(`${quoted(column)} = ?`); args.push(value); } };
    if (table === DOCUMENTS) { filter(ask.namespace, 'namespace'); filter(ask.type, 'doc_type'); filter(ask.owner, 'owner_cert_uid'); }
    else if (table === LEDGER) { filter(ask.owner, 'owner_uid'); filter(ask.type, 'type'); }
    const clause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const time = TIME_COLUMNS.find(c => columns.includes(c));
    const id = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : columns[0];
    const order = [...(time ? [`${quoted(time)} DESC`] : []), `${quoted(id)} DESC`].join(', ');

    const counted = await this.one(`SELECT COUNT(*) AS n FROM ${quoted(table)}${clause}`, args);
    const shown = table === DOCUMENTS ? DOCUMENT_LINE : table === LEDGER ? RECEIPT_LINE : '*';
    const rows = await this.all(`SELECT ${shown} FROM ${quoted(table)}${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, size, page * size]);
    const listed = rows.map(r => (table === DOCUMENTS ? documentLine(r) : table === LEDGER ? receiptLine(r)
      : Object.fromEntries(Object.entries(plainRow(asObject(r, columns))).map(([k, v]) => [k, typeof v === 'string' && v.length > LIST_TEXT_MOST ? `${v.slice(0, LIST_TEXT_MOST)}… (${v.length} characters)` : v]))));
    return { table, total: Number(counted.n), page, size, rows: listed as Record<string, unknown>[] };
  }

  async row(table: string, id: string): Promise<Record<string, unknown> | null | typeof NO_TABLE | typeof NOT_ONE_BY_ONE> {
    if (!(await this.tableNames()).includes(table)) return NO_TABLE;
    const columns = await this.columnsOf(table);
    const key = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : null;
    if (!key) return NOT_ONE_BY_ONE;
    const rows = await this.all(`SELECT * FROM ${quoted(table)} WHERE ${quoted(key)} = ? LIMIT 1`, [id]);
    if (!rows[0]) return null;
    const found = plainRow(asObject(rows[0], columns));
    // What a row's text means, read as the hub reads it; a vector stays out, said by its length
    if ('data' in found) found.data = parsed(found.data);
    if ('line' in found) found.line = parsed(found.line);
    if (typeof found.embedding === 'string') found.embedding = `${(parsed(found.embedding) as unknown[] | null)?.length ?? 0} numbers`;
    return found;
  }

  async find(ask: IDevFindAsk): Promise<IDevFound> {
    const { id } = ask;
    const exact = ask.exact.length
      ? await this.all(`SELECT id FROM ${DOCUMENTS} WHERE id IN (${ask.exact.map(() => '?').join(', ')}) ORDER BY id`, ask.exact)
      : [];
    const documents = await this.all(`SELECT ${DOCUMENT_LINE} FROM ${DOCUMENTS} WHERE instr(id, ?) > 0 OR instr(data, ?) > 0 OR owner_cert_uid = ? ORDER BY updated_at DESC, id DESC LIMIT ?`, [id, id, id, ask.documents]);
    const owned = await this.one(`SELECT COUNT(*) AS n FROM ${LEDGER} WHERE owner_uid = ?`, [id]);
    const newest = await this.all(`SELECT ${RECEIPT_LINE} FROM ${LEDGER} WHERE owner_uid = ? ORDER BY seq DESC LIMIT ?`, [id, ask.receipts]);
    const mentioned = await this.one(`SELECT COUNT(*) AS n FROM ${LEDGER} WHERE owner_uid <> ? AND instr(data, ?) > 0`, [id, id]);
    return {
      exact: exact.map(r => ({ table: DOCUMENTS, id: String(r.id) })),
      documents: documents.map(documentLine),
      ledger: { rows: Number(owned.n), newest: newest.map(receiptLine), mentionedIn: Number(mentioned.n) }
    };
  }
}

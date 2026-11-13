/**
 * THE DEVELOPERS' VIEW OF THE DATA (Pedro, 2026-11-13: "I think we should protected route and
 * actually be able to see the DB and check the state of things... like a view from the data side as
 * devs"). Read-only routes under /api/hub/dev/, and a page at /dev/ (landing/dev/):
 *
 *   GET /dev/state     the state of things: the settings by name, whether the database answers and how
 *                      far its migrations stand, the record, the scheduled call's last run, erasures
 *                      still waiting, and how many of each thing this hub holds with the latest of each
 *   GET /dev/tables    every table, and every collection the documents and the ledger hold, with counts
 *   GET /dev/rows      ?table=&namespace=&type=&owner=&page=&size=   a table's rows, newest first, a page at a time
 *   GET /dev/row       ?table=&id=        one row, whole
 *   GET /dev/find      ?id=               what this hub holds of an account, a character or a world, by its id
 *
 * WHO MAY. A signed-in account whose key is on the list the host holds (`WS_DEV_ACCOUNTS`, account keys
 * separated by commas; on the hub we launch a key is `clerk_<id>`). Anyone else is answered exactly as
 * an address that does not exist (http.ts). With the list empty, nobody may.
 *
 * WHAT IT NEVER SHOWS. A password's hash or salt, a session's token, a one-time text, the hub's key, any
 * setting's value. The store keeps no token and no one-time text as written, only their hashes, inside
 * the ids `hub_session_…` and `hub_nonce_…`; those ids are shown by a short mark and never opened. The
 * rest is hidden by a rule on names, a list kept per kind of document, and, over everything this view
 * answers, every text a secret setting holds and anything shaped as a private key (`guard`).
 *
 * LIMITS, ON PURPOSE. It writes nothing. There is no box to type SQL into: the provider's own console
 * already shows the raw database, and this view is for what the hub means by its rows. No bulk export.
 * Each read is written to the function's log with who asked and for what, never the rows.
 */
import { sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDatabase } from '../../shared/dbShared';
import { MIGRATIONS_FOLDER } from '../connection';
import type { Hub, IAccount } from './Hub';
import { secretTexts, settingsRead } from './settings';

/** What stands where something was hidden. */
export const HIDDEN = '‹hidden›';
const PAGE_SIZE = 50;
const PAGE_MOST = 100;
const FIND_LEAST = 3;
const FIND_MOST = 100;
/** A long text in a list is cut; the row opened whole shows it all. */
const LIST_TEXT_MOST = 200;

export interface IDevViewParts {
  hub: Hub;
  database: IDatabase;
  /** The host's settings, for their names and to know what to hide. Never shown. */
  env: NodeJS.ProcessEnv;
  /** Settings this hub was given another way than by name (a local stand-in's own defaults, a key from a file), and how. */
  given?: Record<string, string>;
  say?: (line: string) => void;
}

export interface IDevAnswer { status: number; body: Record<string, unknown> }

// --- what is hidden -----------------------------------------------------------------------------

/** Names whose value is a secret wherever they stand. */
const SECRET_NAMES = new Set([
  'password', 'passwd', 'passphrase', 'salt', 'secret', 'token', 'nonce', 'otp', 'pem', 'cookie', 'authorization',
  'privatekey', 'private_key', 'apikey', 'api_key', 'secretkey', 'secret_key', 'clientsecret', 'client_secret',
  'authtoken', 'auth_token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token', 'sessiontoken', 'session_token'
]);
const SECRET_ENDING = /(password|secret|token|salt|privatekey|apikey)$/i;
/** Fields hidden in one kind of document, by its `type`: what the name rule would not catch. */
const SECRET_BY_KIND: Record<string, string[]> = {
  hub_account: ['salt', 'hash']
};
const PRIVATE_PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const PROVIDER_SECRET = /\b(sk_(live|test)_|whsec_)[A-Za-z0-9_+/=-]+/g;
/** A session or a one-time text is kept under its hash: shown by a short mark of it, never whole. */
const HASHED_ID = /\b(hub_(?:session|nonce)_)([0-9a-f]{8})[0-9a-f]{56}\b/g;
const KEPT_BY_HASH = /^hub_(session|nonce)_/;

const isSecretName = (name: string) => SECRET_NAMES.has(name.toLowerCase()) || SECRET_ENDING.test(name);

// --- reading rows -------------------------------------------------------------------------------

/** A value as JSON can carry it: a database's big numbers as numbers. */
const plain = (value: unknown): unknown => (typeof value === 'bigint' ? Number(value) : value);
const plainRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]));
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const parsed = (text: unknown) => {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return text; }
};

/** What orders a table newest first: the first of these it has, then its id. */
const TIME_COLUMNS = ['updated_at', 'ts', 'at', 'seq', 'created_at'];

export class DevView {
  private readonly accounts: Set<string>;
  private readonly secrets: string[];
  private readonly say: (line: string) => void;

  constructor(private readonly parts: IDevViewParts) {
    this.accounts = new Set((parts.env.WS_DEV_ACCOUNTS ?? '').split(',').map(k => k.trim()).filter(Boolean));
    this.secrets = secretTexts(parts.env);
    this.say = parts.say ?? (line => console.log(line));
  }

  /** Whether this account may read here: signed in, and its key on the host's list. */
  allows(account: IAccount | null): account is IAccount {
    return !!account && this.accounts.has(account.key);
  }

  /** A read, or null for a route this view does not have (answered as any address that does not exist). */
  async read(account: IAccount, route: string, query: URLSearchParams): Promise<IDevAnswer | null> {
    const routes: Record<string, (q: URLSearchParams) => Promise<IDevAnswer>> = {
      '/state': () => this.state(account),
      '/tables': () => this.tables(),
      '/rows': q => this.rows(q),
      '/row': q => this.row(q),
      '/find': q => this.find(q)
    };
    const run = routes[route];
    if (!run) return null;
    // Who asked and for what, never the rows
    const asked = ['table', 'namespace', 'type', 'owner', 'id', 'page', 'size']
      .filter(k => query.has(k)).map(k => `${k}=${String(query.get(k)).slice(0, 80)}`).join(' ');
    this.say(this.hideIn(`[DEV] ${account.handle} (${account.key}) read /dev${route}${asked ? ` ${asked}` : ''}`));
    const out = await run(query);
    return { status: out.status, body: this.guard(out.body) as Record<string, unknown> };
  }

  // ---------------------------------------------------------------------------------------------
  // THE STATE OF THINGS
  // ---------------------------------------------------------------------------------------------

  private async state(account: IAccount): Promise<IDevAnswer> {
    const { hub } = this.parts;
    let database: Record<string, unknown>;
    let record: Record<string, unknown> = { asked: false };
    try {
      const health = await hub.store.health();
      database = { answers: true, dialect: health.dialect, migrations: await this.migrations() };
      record = health.record ? { asked: true, ...health.record } : { asked: false };
      record.marked = await this.count('cold_changes');
    } catch (e) {
      database = { answers: false, problem: e instanceof Error ? e.message : String(e) };
    }
    if (database.answers === false) {
      return { status: 200, body: { ok: true, you: { handle: account.handle, key: account.key }, hub: this.hubSaid(), settings: this.settings(), database, record, at: hub.now() } };
    }
    const maintained = await this.hubDoc<{ at?: number }>('hub_maintenance');
    const erasures = await this.docsOf('hub_erase');
    return {
      status: 200,
      body: {
        ok: true,
        you: { handle: account.handle, key: account.key },
        hub: this.hubSaid(),
        settings: this.settings(),
        database,
        record,
        scheduled: { lastRun: maintained?.at ?? null },
        erasures: { waiting: erasures.count, oldest: erasures.oldest },
        counts: {
          accounts: await this.kind('hub_account'),
          sessions: await this.kind('hub_session'),
          characters: await this.kind('hub_character'),
          ledgerRows: await this.ledgerCount(),
          worlds: await this.kind('hub_world'),
          cities: await this.kind('hub_roll'),
          people: await this.kind('hub_person'),
          themes: await this.kind('hub_theme'),
          kinds: await this.kind('hub_kind'),
          loot: await this.kind('hub_loot'),
          pool: await this.kind('hub_pool'),
          jobs: await this.kind('hub_job'),
          lines: await this.linesCount(),
          liveEvents: await this.liveEvents()
        },
        at: hub.now()
      }
    };
  }

  /** Every setting by name, and where it came from; one this hub was given another way says how. Never a value. */
  private settings() {
    const given = this.parts.given ?? {};
    return settingsRead(this.parts.env).map(s => (!s.set && given[s.name] ? { ...s, set: true, given: given[s.name] } : s));
  }

  private hubSaid() {
    const { hub } = this.parts;
    return { id: hub.id, url: hub.publicUrl, accounts: hub.accounts };
  }

  /** How far the database's migrations stand against the ones this build carries. */
  private async migrations(): Promise<Record<string, unknown>> {
    const journal = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
    const known: { tag: string; when: number }[] = existsSync(journal) ? JSON.parse(readFileSync(journal, 'utf8')).entries : [];
    try {
      const { rows } = await this.parts.database.db.execute(sql`SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM drizzle.__drizzle_migrations`);
      const applied = Number((rows[0] as any).n);
      const newest = num((rows[0] as any).newest);
      return { applied, known: known.length, newest: known.find(m => m.when === newest)?.tag ?? null };
    } catch {
      return { applied: null, known: known.length, newest: null };
    }
  }

  private async count(table: string): Promise<number> {
    const { rows } = await this.parts.database.db.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)}`);
    return Number((rows[0] as any).n);
  }

  private async hubDoc<T>(id: string): Promise<T | null> {
    const doc = await this.parts.hub.store.get(id);
    return doc ? (parsed(doc.dataText) as T) : null;
  }

  private async docsOf(type: string): Promise<{ count: number; oldest: number | null }> {
    const { rows } = await this.parts.database.db.execute(sql`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM documents WHERE doc_type = ${type}`);
    return { count: Number((rows[0] as any).n), oldest: num((rows[0] as any).oldest) };
  }

  /** How many documents of one kind, and the latest of them. */
  private async kind(type: string): Promise<{ count: number; latest: { id: string; at: number } | null }> {
    const db = this.parts.database.db;
    const { rows } = await db.execute(sql`SELECT COUNT(*) AS n FROM documents WHERE namespace = 'hub' AND doc_type = ${type}`);
    const { rows: latest } = await db.execute(sql`SELECT id, updated_at FROM documents WHERE namespace = 'hub' AND doc_type = ${type} ORDER BY updated_at DESC, id DESC LIMIT 1`);
    return { count: Number((rows[0] as any).n), latest: latest[0] ? { id: String((latest[0] as any).id), at: Number((latest[0] as any).updated_at) } : null };
  }

  private async ledgerCount() {
    const db = this.parts.database.db;
    const { rows } = await db.execute(sql`SELECT COUNT(*) AS n, COUNT(DISTINCT owner_uid) AS chains FROM ledger_rows`);
    const { rows: latest } = await db.execute(sql`SELECT id, ts FROM ledger_rows ORDER BY ts DESC, id DESC LIMIT 1`);
    return { count: Number((rows[0] as any).n), chains: Number((rows[0] as any).chains), latest: latest[0] ? { id: String((latest[0] as any).id), at: Number((latest[0] as any).ts) } : null };
  }

  private async linesCount() {
    if (!(await this.tableNames()).includes('live_lines')) return { count: 0, latest: null };
    const db = this.parts.database.db;
    const { rows } = await db.execute(sql`SELECT COUNT(*) AS n FROM live_lines`);
    const { rows: latest } = await db.execute(sql`SELECT key, at FROM live_lines ORDER BY at DESC, key DESC LIMIT 1`);
    return { count: Number((rows[0] as any).n), latest: latest[0] ? { id: String((latest[0] as any).key), at: Number((latest[0] as any).at) } : null };
  }

  private async liveEvents() {
    const db = this.parts.database.db;
    const { rows } = await db.execute(sql`SELECT COUNT(*) AS n FROM documents WHERE namespace = 'live' AND substr(id, 1, 11) = 'live_event_'`);
    const { rows: latest } = await db.execute(sql`SELECT id, updated_at FROM documents WHERE namespace = 'live' AND substr(id, 1, 11) = 'live_event_' ORDER BY updated_at DESC, id DESC LIMIT 1`);
    return { count: Number((rows[0] as any).n), latest: latest[0] ? { id: String((latest[0] as any).id), at: Number((latest[0] as any).updated_at) } : null };
  }

  // ---------------------------------------------------------------------------------------------
  // THE DATA ITSELF
  // ---------------------------------------------------------------------------------------------

  /** The tables this database holds, by the database's own catalog: nothing else is ever named in a query. */
  private async tableNames(): Promise<string[]> {
    const { rows } = await this.parts.database.db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    return rows.map((r: any) => String(r.table_name));
  }

  private async columnsOf(table: string): Promise<string[]> {
    const { rows } = await this.parts.database.db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`);
    return rows.map((r: any) => String(r.column_name));
  }

  private async tables(): Promise<IDevAnswer> {
    const db = this.parts.database.db;
    const tables: { name: string; rows: number; newest: number | null }[] = [];
    for (const name of await this.tableNames()) {
      const columns = await this.columnsOf(name);
      // A sequence's number orders a table but is no time
      const by = TIME_COLUMNS.filter(c => c !== 'seq').find(c => columns.includes(c)) ?? null;
      const { rows } = await db.execute(by
        ? sql`SELECT COUNT(*) AS n, MAX(${sql.identifier(by)}) AS newest FROM ${sql.identifier(name)}`
        : sql`SELECT COUNT(*) AS n, NULL AS newest FROM ${sql.identifier(name)}`);
      tables.push({ name, rows: Number((rows[0] as any).n), newest: num((rows[0] as any).newest) });
    }
    const { rows: collections } = await db.execute(sql`SELECT namespace, doc_type, COUNT(*) AS n, MAX(updated_at) AS newest FROM documents GROUP BY namespace, doc_type ORDER BY namespace, doc_type`);
    const { rows: ledger } = await db.execute(sql`SELECT type, COUNT(*) AS n, MAX(ts) AS newest FROM ledger_rows GROUP BY type ORDER BY type`);
    return {
      status: 200,
      body: {
        ok: true,
        tables,
        collections: collections.map((c: any) => ({ table: 'documents', namespace: String(c.namespace), type: c.doc_type === null ? null : String(c.doc_type), rows: Number(c.n), newest: num(c.newest) })),
        ledger: ledger.map((l: any) => ({ table: 'ledger_rows', type: String(l.type), rows: Number(l.n), newest: num(l.newest) }))
      }
    };
  }

  private refuse(status: number, reason: string): IDevAnswer {
    return { status, body: { ok: false, reason } };
  }

  /** A table this database holds, by exactly the name asked, or the reason it is not. */
  private async tableOf(query: URLSearchParams): Promise<string | IDevAnswer> {
    const asked = query.get('table') ?? '';
    if (!(await this.tableNames()).includes(asked)) return this.refuse(400, 'There is no table of that name here. GET /dev/tables lists them.');
    return asked;
  }

  private async rows(query: URLSearchParams): Promise<IDevAnswer> {
    const table = await this.tableOf(query);
    if (typeof table !== 'string') return table;
    const whole = (name: string, least: number, most: number, otherwise: number) => {
      const n = Number(query.get(name));
      return query.has(name) && Number.isInteger(n) ? Math.min(Math.max(n, least), most) : otherwise;
    };
    const page = whole('page', 0, Number.MAX_SAFE_INTEGER, 0);
    const size = whole('size', 1, PAGE_MOST, PAGE_SIZE);
    const columns = await this.columnsOf(table);
    const filter = (name: string, column: string) => (query.get(name) && columns.includes(column) ? sql`${sql.identifier(column)} = ${query.get(name)}` : null);
    const conditions = table === 'documents'
      ? [filter('namespace', 'namespace'), filter('type', 'doc_type'), filter('owner', 'owner_cert_uid')]
      : table === 'ledger_rows'
        ? [filter('owner', 'owner_uid'), filter('type', 'type')]
        : [];
    const where = conditions.filter(Boolean) as ReturnType<typeof sql>[];
    const clause = where.length ? sql` WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const time = TIME_COLUMNS.find(c => columns.includes(c));
    const id = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : columns[0];
    const order = sql.join([...(time ? [sql`${sql.identifier(time)} DESC`] : []), sql`${sql.identifier(id)} DESC`], sql`, `);

    const db = this.parts.database.db;
    const { rows: counted } = await db.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)}${clause}`);
    const shown = table === 'documents'
      ? sql`id, namespace, doc_type, owner_cert_uid, created_at, updated_at, LENGTH(data) AS bytes`
      : table === 'ledger_rows'
        ? sql`id, owner_uid, seq, type, ts, LENGTH(data) AS bytes`
        : sql`*`;
    const { rows } = await db.execute(sql`SELECT ${shown} FROM ${sql.identifier(table)}${clause} ORDER BY ${order} LIMIT ${size} OFFSET ${page * size}`);
    const listed = rows.map((r: any) => (table === 'documents'
      ? { id: r.id, namespace: r.namespace, type: r.doc_type, owner: r.owner_cert_uid, createdAt: num(r.created_at), updatedAt: num(r.updated_at), bytes: num(r.bytes) }
      : table === 'ledger_rows'
        ? { id: r.id, owner: r.owner_uid, seq: num(r.seq), type: r.type, ts: num(r.ts), bytes: num(r.bytes) }
        : Object.fromEntries(Object.entries(plainRow(r)).map(([k, v]) => [k, typeof v === 'string' && v.length > LIST_TEXT_MOST ? `${v.slice(0, LIST_TEXT_MOST)}… (${v.length} characters)` : v]))));
    return { status: 200, body: { ok: true, table, total: Number((counted[0] as any).n), page, size, rows: listed } };
  }

  private async row(query: URLSearchParams): Promise<IDevAnswer> {
    const table = await this.tableOf(query);
    if (typeof table !== 'string') return table;
    const id = query.get('id') ?? '';
    if (KEPT_BY_HASH.test(id)) return this.refuse(400, 'A session or a one-time text is kept under the hash of a secret, which is not shown whole: its line in the list is all there is to see of it.');
    const columns = await this.columnsOf(table);
    const key = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : null;
    if (!key) return this.refuse(400, 'This table\'s rows are not opened one by one; its list shows them whole.');
    const { rows } = await this.parts.database.db.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE ${sql.identifier(key)} = ${id} LIMIT 1`);
    if (!rows[0]) return this.refuse(404, 'No row of that id in that table.');
    const found = plainRow(rows[0] as Record<string, unknown>);
    // What a row's text means, read as the hub reads it; a vector stays out, said by its length
    if ('data' in found) found.data = parsed(found.data);
    if ('line' in found) found.line = parsed(found.line);
    if (typeof found.embedding === 'string') found.embedding = `${(parsed(found.embedding) as unknown[] | null)?.length ?? 0} numbers`;
    return { status: 200, body: { ok: true, table, row: found } };
  }

  private async find(query: URLSearchParams): Promise<IDevAnswer> {
    const id = (query.get('id') ?? '').trim();
    if (id.length < FIND_LEAST) return this.refuse(400, `An id to find by is at least ${FIND_LEAST} characters.`);
    const db = this.parts.database.db;
    const ids = ['hub_account_', 'hub_character_', 'hub_world_', 'hub_person_', 'hub_roll_', 'hub_pool_', 'hub_kind_', 'hub_theme_', 'hub_loot_', 'hub_job_', ''].map(p => `${p}${id}`);
    const { rows: exact } = await db.execute(sql`SELECT id FROM documents WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)}) ORDER BY id`);
    const { rows: documents } = await db.execute(sql`SELECT id, namespace, doc_type, owner_cert_uid, created_at, updated_at, LENGTH(data) AS bytes FROM documents WHERE position(${id} in id) > 0 OR position(${id} in data) > 0 OR owner_cert_uid = ${id} ORDER BY updated_at DESC, id DESC LIMIT ${FIND_MOST}`);
    const { rows: owned } = await db.execute(sql`SELECT COUNT(*) AS n FROM ledger_rows WHERE owner_uid = ${id}`);
    const { rows: newest } = await db.execute(sql`SELECT id, owner_uid, seq, type, ts, LENGTH(data) AS bytes FROM ledger_rows WHERE owner_uid = ${id} ORDER BY seq DESC LIMIT 20`);
    const { rows: mentioned } = await db.execute(sql`SELECT COUNT(*) AS n FROM ledger_rows WHERE owner_uid <> ${id} AND position(${id} in data) > 0`);
    return {
      status: 200,
      body: {
        ok: true,
        id,
        exact: exact.map((r: any) => ({ table: 'documents', id: String(r.id) })),
        documents: documents.map((r: any) => ({ id: r.id, namespace: r.namespace, type: r.doc_type, owner: r.owner_cert_uid, createdAt: num(r.created_at), updatedAt: num(r.updated_at), bytes: num(r.bytes) })),
        ledger: {
          rows: Number((owned[0] as any).n),
          newest: newest.map((r: any) => ({ id: r.id, owner: r.owner_uid, seq: num(r.seq), type: r.type, ts: num(r.ts), bytes: num(r.bytes) })),
          mentionedIn: Number((mentioned[0] as any).n)
        }
      }
    };
  }

  // ---------------------------------------------------------------------------------------------
  // THE GUARD: over everything this view answers
  // ---------------------------------------------------------------------------------------------

  /** A text with every secret it holds hidden: a setting's value, a private key, a provider's secret, a hash a secret is kept under. */
  private hideIn(text: string): string {
    let out = text.replace(PRIVATE_PEM, HIDDEN).replace(PROVIDER_SECRET, HIDDEN).replace(HASHED_ID, '$1$2…');
    for (const secret of this.secrets) if (out.includes(secret)) out = out.split(secret).join(HIDDEN);
    return out;
  }

  /** @internal Everything an answer holds, walked: a secret's name hides its value, and every text is searched. */
  guard(value: unknown): unknown {
    if (typeof value === 'string') return this.hideIn(value);
    if (Array.isArray(value)) return value.map(v => this.guard(v));
    if (value && typeof value === 'object') {
      const kind = typeof (value as { type?: unknown }).type === 'string' ? SECRET_BY_KIND[(value as { type: string }).type] ?? [] : [];
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        this.hideIn(k),
        v !== null && v !== undefined && (isSecretName(k) || kind.includes(k)) ? HIDDEN : this.guard(plain(v))
      ]));
    }
    return plain(value);
  }
}

/**
 * THE DEVELOPERS' VIEW OF THE DATA (Pedro, 2026-11-13: "I think we should protected route and
 * actually be able to see the DB and check the state of things... like a view from the data side as
 * devs"). Read-only routes under /api/hub/dev/, and a page at /dev/ (landing/dev/):
 *
 *   GET /dev/state     the state of things: the settings by name, whether the store answers and how
 *                      far its migrations stand, the record, the scheduled call's last run, erasures
 *                      still waiting, and how many of each thing this hub holds with the latest of each
 *   GET /dev/tables    every table, and every collection the documents and the ledger hold, with counts
 *   GET /dev/rows      ?table=&namespace=&type=&owner=&page=&size=   a table's rows, newest first, a page at a time
 *   GET /dev/row       ?table=&id=        one row, whole
 *   GET /dev/find      ?id=               what this hub holds of an account, a character or a world, by its id
 *
 * NO DATABASE HERE (Pedro, 2026-11-13, on the hub's store on the host: "Yes, Turso only"). This file
 * reads only through `IDevStore` (devStore.ts); every line of a query language is in a body per kind
 * of store (devStorePostgres.ts today). Every table name it shows or passes on came from the store.
 *
 * WHO MAY. A signed-in account whose key is on the list the host holds (`WS_DEV_ACCOUNTS`, account keys
 * separated by commas; on the hub we launch a key is `clerk_<id>`). Anyone else is answered exactly as
 * an address that does not exist (http.ts). With the list empty, nobody may.
 *
 * WHAT IT NEVER SHOWS. A password's hash or salt, a session's token, a one-time text, the hub's key, any
 * setting's value. The store keeps no token and no one-time text as written, only their hashes, inside
 * the ids `hub_session_…` and `hub_nonce_…`; those ids are shown by a short mark and never opened. The
 * rest is hidden by a rule on names, a list kept per kind of document, and, over everything this view
 * answers, every text a secret setting holds and anything shaped as a private key (`guard`). The guard
 * stands over whatever a store's body answers, so a new body needs to hide nothing itself.
 *
 * LIMITS, ON PURPOSE. It writes nothing. There is no box to type a query into: the provider's own
 * console already shows the raw database, and this view is for what the hub means by its rows. No bulk
 * export. Each read is written to the function's log with who asked and for what, never the rows.
 */
import type { Hub, IAccount } from './Hub';
import { NO_TABLE, NOT_ONE_BY_ONE, parsed, plain, type DevCountOf, type IDevStore } from './devStore';
import { secretTexts, settingsRead } from './settings';

/** What stands where something was hidden. */
export const HIDDEN = '‹hidden›';
const PAGE_SIZE = 50;
const PAGE_MOST = 100;
const FIND_LEAST = 3;
const FIND_DOCUMENTS = 100;
const FIND_RECEIPTS = 20;
/** The documents an id may name exactly: an account's, a character's, a world's, and what the hub keeps beside them. */
const EXACT_PREFIXES = ['hub_account_', 'hub_character_', 'hub_world_', 'hub_person_', 'hub_roll_', 'hub_pool_', 'hub_kind_', 'hub_theme_', 'hub_loot_', 'hub_job_', ''];
/** What the state counts, in this order: the hub's own kinds of document, and the store's own kinds of thing. */
const COUNTED: [string, DevCountOf][] = [
  ['accounts', { kind: 'hub_account' }], ['sessions', { kind: 'hub_session' }], ['characters', { kind: 'hub_character' }],
  ['ledgerRows', { of: 'receipts' }], ['worlds', { kind: 'hub_world' }], ['cities', { kind: 'hub_roll' }],
  ['people', { kind: 'hub_person' }], ['themes', { kind: 'hub_theme' }], ['kinds', { kind: 'hub_kind' }],
  ['loot', { kind: 'hub_loot' }], ['pool', { kind: 'hub_pool' }], ['jobs', { kind: 'hub_job' }],
  ['lines', { of: 'lines' }], ['liveEvents', { of: 'live_events' }]
];

export interface IDevViewParts {
  hub: Hub;
  /** What the view reads, whatever the store underneath is (devStore.ts). */
  store: IDevStore;
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

  private refuse(status: number, reason: string): IDevAnswer {
    return { status, body: { ok: false, reason } };
  }

  // ---------------------------------------------------------------------------------------------
  // THE STATE OF THINGS
  // ---------------------------------------------------------------------------------------------

  private async state(account: IAccount): Promise<IDevAnswer> {
    const { hub, store } = this.parts;
    const said = { ok: true, you: { handle: account.handle, key: account.key }, hub: { id: hub.id, url: hub.publicUrl, accounts: hub.accounts }, settings: this.settings() };
    let found;
    try {
      found = await store.state();
    } catch (e) {
      return { status: 200, body: { ...said, database: { answers: false, problem: e instanceof Error ? e.message : String(e) }, record: { asked: false }, at: hub.now() } };
    }
    const maintained = await hub.store.get('hub_maintenance');
    const erasures = await store.count({ kind: 'hub_erase' });
    const counts: Record<string, unknown> = {};
    for (const [name, what] of COUNTED) {
      const { count, latest } = await store.count(what);
      counts[name] = { count, latest };
    }
    return {
      status: 200,
      body: {
        ...said,
        database: { answers: true, dialect: found.dialect, migrations: found.migrations },
        record: found.record,
        scheduled: { lastRun: (maintained ? (parsed(maintained.dataText) as { at?: number }).at : undefined) ?? null },
        erasures: { waiting: erasures.count, oldest: erasures.oldest },
        counts,
        at: hub.now()
      }
    };
  }

  /** Every setting by name, and where it came from; one this hub was given another way says how. Never a value. */
  private settings() {
    const given = this.parts.given ?? {};
    return settingsRead(this.parts.env).map(s => (!s.set && given[s.name] ? { ...s, set: true, given: given[s.name] } : s));
  }

  // ---------------------------------------------------------------------------------------------
  // THE DATA ITSELF
  // ---------------------------------------------------------------------------------------------

  private async tables(): Promise<IDevAnswer> {
    return { status: 200, body: { ok: true, ...(await this.parts.store.tables()) } };
  }

  private noTable(): IDevAnswer {
    return this.refuse(400, 'There is no table of that name here. GET /dev/tables lists them.');
  }

  private async rows(query: URLSearchParams): Promise<IDevAnswer> {
    const whole = (name: string, least: number, most: number, otherwise: number) => {
      const n = Number(query.get(name));
      return query.has(name) && Number.isInteger(n) ? Math.min(Math.max(n, least), most) : otherwise;
    };
    const text = (name: string) => query.get(name) || undefined;
    const out = await this.parts.store.page({
      table: query.get('table') ?? '',
      namespace: text('namespace'), type: text('type'), owner: text('owner'),
      page: whole('page', 0, Number.MAX_SAFE_INTEGER, 0),
      size: whole('size', 1, PAGE_MOST, PAGE_SIZE)
    });
    if (out === NO_TABLE) return this.noTable();
    return { status: 200, body: { ok: true, ...out } };
  }

  private async row(query: URLSearchParams): Promise<IDevAnswer> {
    const table = query.get('table') ?? '';
    const id = query.get('id') ?? '';
    // Refused before the store is asked: such an id is never looked up, whatever the store is
    if (KEPT_BY_HASH.test(id)) return this.refuse(400, 'A session or a one-time text is kept under the hash of a secret, which is not shown whole: its line in the list is all there is to see of it.');
    const found = await this.parts.store.row(table, id);
    if (found === NO_TABLE) return this.noTable();
    if (found === NOT_ONE_BY_ONE) return this.refuse(400, 'This table\'s rows are not opened one by one; its list shows them whole.');
    if (found === null) return this.refuse(404, 'No row of that id in that table.');
    return { status: 200, body: { ok: true, table, row: found } };
  }

  private async find(query: URLSearchParams): Promise<IDevAnswer> {
    const id = (query.get('id') ?? '').trim();
    if (id.length < FIND_LEAST) return this.refuse(400, `An id to find by is at least ${FIND_LEAST} characters.`);
    const found = await this.parts.store.find({ id, exact: EXACT_PREFIXES.map(p => `${p}${id}`), documents: FIND_DOCUMENTS, receipts: FIND_RECEIPTS });
    return { status: 200, body: { ok: true, id, ...found } };
  }

  // ---------------------------------------------------------------------------------------------
  // THE GUARD: over everything this view answers, whichever store answered it
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

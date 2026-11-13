// @vitest-environment node
/**
 * THE DEVELOPERS' VIEW KNOWS NO DATABASE (Pedro, 2026-11-13, on the hub's store on the host: "Yes,
 * Turso only"). The view reads through one small interface of its own (`IDevStore`,
 * server/hub/devStore.ts); every line of SQL it needs is in one body per store, today's beside
 * Postgres (server/hub/devStorePostgres.ts), so a body for Turso can be written beside it. So:
 *
 *   - a body kept in memory, with no database at all, serves every route, and the view's guard
 *     still hides what it must;
 *   - the routes' file and the page name no database, no query language and no table of their own:
 *     every table name they show or ask for came from the store's own answers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DevView, HIDDEN } from '../server/hub/dev';
import type { IDevStore, IDevPageAsk } from '../server/hub/devStore';
import type { Hub } from '../server/hub/Hub';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const NOW = 1_800_000_000_000;
const HASHED = `hub_session_${'ab12cd34'.repeat(8)}`;

/** A store in memory: a few documents, two receipts, and nothing that is a database. */
function memoryStore(): IDevStore & { asked: string[] } {
  const docs = [
    { id: 'hub_account_alder', namespace: 'hub', type: 'hub_account', owner: null, createdAt: NOW, updatedAt: NOW, bytes: 90, data: { type: 'hub_account', handle: 'alder', salt: 'c2FsdC1vZi1hbGRlcg==', hash: 'aGFzaC1vZi1hbGRlcg==' } },
    { id: HASHED, namespace: 'hub', type: 'hub_session', owner: null, createdAt: NOW - 1, updatedAt: NOW - 1, bytes: 60, data: { type: 'hub_session', account: 'alder' } }
  ];
  const asked: string[] = [];
  return {
    asked,
    async state() { asked.push('state'); return { dialect: 'memory', migrations: { applied: 1, known: 1, newest: 'only' }, record: { asked: false, marked: 0 } }; },
    async count(what) { asked.push(`count ${JSON.stringify(what)}`); return 'kind' in what && what.kind === 'hub_account' ? { count: 1, latest: { table: 'stuff', id: 'hub_account_alder', at: NOW }, oldest: NOW } : { count: 0, latest: null, oldest: null }; },
    async tables() {
      asked.push('tables');
      return { tables: [{ name: 'stuff', rows: 2, newest: NOW }], collections: [{ table: 'stuff', namespace: 'hub', type: 'hub_account', rows: 1, newest: NOW }], ledger: [] };
    },
    async page(ask: IDevPageAsk) {
      asked.push(`page ${ask.table} ${ask.page} ${ask.size}`);
      if (ask.table !== 'stuff') return 'NO_TABLE';
      const lines = docs.filter(d => !ask.type || d.type === ask.type).map(({ data: _, ...line }) => ({ table: 'stuff', ...line }));
      return { table: 'stuff', total: lines.length, page: ask.page, size: ask.size, rows: lines.slice(ask.page * ask.size, (ask.page + 1) * ask.size) };
    },
    async row(table, id) {
      asked.push(`row ${table} ${id}`);
      if (table !== 'stuff') return 'NO_TABLE';
      const doc = docs.find(d => d.id === id);
      return doc ? { id: doc.id, namespace: doc.namespace, data: doc.data } : null;
    },
    async find(ask) {
      asked.push(`find ${ask.id}`);
      const named = docs.filter(d => d.id.includes(ask.id) || JSON.stringify(d.data).includes(ask.id)).map(({ data: _, ...line }) => ({ table: 'stuff', ...line }));
      return { exact: docs.filter(d => ask.exact.includes(d.id)).map(d => ({ table: 'stuff', id: d.id })), documents: named, ledger: { rows: 0, newest: [], mentionedIn: 0 } };
    }
  };
}

const HUB = { id: 'hub_0123456789abcdef', publicUrl: 'https://hub.test', accounts: 'clerk', now: () => NOW, store: { get: async () => null } } as unknown as Hub;
const ME = { key: 'devhand', handle: 'devhand' };

describe('the developers\' view knows no database', () => {
  it('a store kept in memory serves every route, and what must be hidden still is', async () => {
    const store = memoryStore();
    const view = new DevView({ hub: HUB, store, env: { WS_DEV_ACCOUNTS: 'devhand' }, say: () => undefined });
    const ask = async (route: string, query = '') => (await view.read(ME, route, new URLSearchParams(query)))!;

    const state = await ask('/state');
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ok: true, database: { answers: true, dialect: 'memory', migrations: { applied: 1, known: 1 } }, record: { asked: false }, scheduled: { lastRun: null } });
    expect((state.body.counts as any).accounts).toEqual({ count: 1, latest: { table: 'stuff', id: 'hub_account_alder', at: NOW } });

    expect((await ask('/tables')).body).toMatchObject({ ok: true, tables: [{ name: 'stuff', rows: 2 }], collections: [{ table: 'stuff', type: 'hub_account' }] });

    const page = await ask('/rows', 'table=stuff&page=0&size=10');
    expect(page.body).toMatchObject({ ok: true, table: 'stuff', total: 2 });
    // A session's id is still only its short mark, whoever the store is
    expect((page.body.rows as { id: string }[]).map(r => r.id)).toEqual(['hub_account_alder', 'hub_session_ab12cd34…']);
    expect(store.asked).toContain('page stuff 0 10');

    const opened = await ask('/row', 'table=stuff&id=hub_account_alder');
    expect(opened.body).toMatchObject({ ok: true, table: 'stuff', row: { id: 'hub_account_alder', data: { handle: 'alder', salt: HIDDEN, hash: HIDDEN } } });
    expect((await ask('/row', `table=stuff&id=${HASHED}`)).status).toBe(400);
    expect(store.asked.some(a => a.startsWith(`row stuff ${HASHED}`))).toBe(false);
    expect((await ask('/row', 'table=stuff&id=nobody')).status).toBe(404);
    expect((await ask('/rows', 'table=elsewhere')).status).toBe(400);

    const found = await ask('/find', 'id=alder');
    expect(found.body).toMatchObject({ ok: true, id: 'alder', exact: [{ table: 'stuff', id: 'hub_account_alder' }] });
    expect(JSON.stringify(found.body)).not.toContain('ab12cd34ab12cd34');
  });

  it('a store that does not answer is said, and the rest of the state waits for it', async () => {
    const store = { ...memoryStore(), state: async () => { throw new Error('the store is asleep'); } };
    const view = new DevView({ hub: HUB, store, env: { WS_DEV_ACCOUNTS: 'devhand' }, say: () => undefined });
    const out = (await view.read(ME, '/state', new URLSearchParams()))!;
    expect(out.body).toMatchObject({ ok: true, database: { answers: false, problem: 'the store is asleep' } });
    expect(out.body).not.toHaveProperty('counts');
  });

  it('the routes and the page name no database, no query language and no table of their own', () => {
    // A table is named only as a string the code asks with; the words in its comments and labels may say "documents"
    const tableNamed = /['"`](documents|ledger_rows|live_lines|cold_changes|cold_state|commits|treasuries)['"`]/;
    const view = read('server/hub/dev.ts');
    for (const word of ['drizzle', 'sql`', 'SELECT', 'information_schema', 'IDatabase', '../connection', 'pglite', 'libsql']) {
      expect(view.includes(word), `server/hub/dev.ts names ${word}`).toBe(false);
    }
    expect(view).not.toMatch(tableNamed);
    const page = read('landing/dev/dev.js');
    for (const word of ['select ', 'postgres', 'turso', 'pglite', 'libsql']) {
      expect(page.toLowerCase().includes(word), `landing/dev/dev.js names ${word}`).toBe(false);
    }
    expect(page).not.toMatch(tableNamed);
    // Every line of SQL the view needs is in the one body
    const body = read('server/hub/devStorePostgres.ts');
    expect(body).toMatch(/implements IDevStore/);
    expect(body).toMatch(/information_schema/);
  });
});

/**
 * THE DEVELOPERS' PAGE (landing/dev/), driven in a page with the hub's answers stood in for. It is
 * a static file, so it may say what the data routes may not: that this account is not on the list,
 * and what its account key is, which is how the owner learns what to put on the list. Everything is
 * told by shape, place and words, never by hue alone (Pedro is colourblind), and nothing is written
 * into the page as markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const PAGE = readFileSync(resolve(root, 'landing', 'dev', 'index.html'), 'utf8');
const SCRIPT = readFileSync(resolve(root, 'landing', 'dev', 'dev.js'), 'utf8');

const STATE = {
  ok: true,
  you: { handle: 'alder', key: 'clerk_user_2abc' },
  hub: { id: 'hub_0123456789abcdef', url: 'https://hub.test', accounts: 'clerk' },
  settings: [
    { name: 'WS_HUB_DATABASE_URL', what: 'the store, a served Postgres', needed: true, set: true, from: 'DATABASE_URL' },
    { name: 'WS_HUB_KEY', what: 'the hub\'s signing key', needed: true, set: true, from: 'WS_HUB_KEY' },
    { name: 'CRON_SECRET', what: 'what the host\'s scheduled call carries', needed: false, set: false, from: null },
    { name: 'WS_PUBLIC_URL', what: 'the hub\'s own address', needed: true, set: true, from: null, given: 'given to this server directly' }
  ],
  database: { answers: true, dialect: 'postgres', migrations: { applied: 2, known: 2, newest: '0001_cold_marks' } },
  record: { asked: true, state: 'READY', behind: 3, last: 'wd_abc' },
  scheduled: { lastRun: 1_800_000_000_000 },
  erasures: { waiting: 0, oldest: null },
  counts: { accounts: { count: 2, latest: { table: 'documents', id: 'hub_account_clerk_user_2abc', at: 1_800_000_000_000 } }, ledgerRows: { count: 0, latest: null } },
  at: 1_800_000_000_000
};
const TABLES = {
  ok: true,
  tables: [{ name: 'documents', rows: 4 }, { name: 'ledger_rows', rows: 0 }],
  collections: [{ table: 'documents', namespace: 'hub', type: 'hub_account', rows: 2, newest: 1_800_000_000_000 }],
  ledger: []
};
const ROWS = { ok: true, table: 'documents', page: 0, size: 50, total: 1, rows: [{ table: 'documents', id: 'hub_account_clerk_user_2abc', namespace: 'hub', type: 'hub_account', owner: null, updatedAt: 1_800_000_000_000, bytes: 80 }] };
const ROW = { ok: true, table: 'documents', row: { id: 'hub_account_clerk_user_2abc', namespace: 'hub', data: { type: 'hub_account', handle: 'alder', note: '<img src=x onerror=alert(1)>' } } };
const FOUND = { ok: true, id: 'alder', exact: [{ table: 'documents', id: 'hub_account_clerk_user_2abc' }], documents: ROWS.rows, ledger: { rows: 0, newest: [] } };

type Answers = Record<string, { status: number; body: unknown }>;

/** The page as served, its script run, the hub's answers stood in for. Returns what the page asked for. */
async function open(answers: Answers) {
  document.documentElement.innerHTML = PAGE.replace(/<!DOCTYPE[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '');
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(url);
    const path = url.split('?')[0];
    const answer = answers[url] ?? answers[path] ?? { status: 404, body: { ok: false, reason: 'No such route on this hub.' } };
    return { status: answer.status, ok: answer.status < 300, json: async () => answer.body };
  }));
  (0, eval)(SCRIPT);
  await settle();
  return asked;
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };
const text = (id: string) => document.getElementById(id)?.textContent ?? '';

describe('the developers\' page', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('is the site\'s own page: its stylesheet, its own script, and nothing written in as markup', () => {
    expect(PAGE).toContain('<link rel="stylesheet" href="/landing.css">');
    expect(PAGE).toContain('<script src="/dev/dev.js" defer></script>');
    expect(PAGE).not.toMatch(/<script>(?!<\/script>)/);
    expect(PAGE).toMatch(/<meta name="robots" content="noindex">/);
    for (const word of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) expect(SCRIPT).not.toContain(word);
  });

  it('asks nobody signed in to sign in first, on the site\'s first page', async () => {
    await open({ '/api/hub/session': { status: 401, body: { ok: false, reason: 'Sign in first.' } } });
    expect(text('who-said')).toMatch(/Sign in/);
    expect(document.querySelector('#who-said a')?.getAttribute('href')).toBe('/');
    expect(document.getElementById('dev-body')?.hidden).toBe(true);
  });

  it('tells someone not on the list so, and shows them their own account key for it', async () => {
    await open({ '/api/hub/session': { status: 200, body: { ok: true, account: { handle: 'alder', key: 'clerk_user_2abc' } } } });
    expect(text('who-said')).toMatch(/not on this hub's list/);
    expect(text('key-text')).toBe('clerk_user_2abc');
    expect(document.getElementById('who-key')?.hidden).toBe(false);
    expect(text('who-key')).toMatch(/WS_DEV_ACCOUNTS/);
    expect(document.getElementById('dev-body')?.hidden).toBe(true);
  });

  it('shows a developer the state of things, each told by a shape and a word', async () => {
    await open({ '/api/hub/dev/state': { status: 200, body: STATE }, '/api/hub/dev/tables': { status: 200, body: TABLES } });
    expect(document.getElementById('dev-body')?.hidden).toBe(false);
    expect(text('who-said')).toMatch(/alder/);
    const items = [...document.querySelectorAll('#settings-list li')];
    expect(items).toHaveLength(4);
    const item = (name: string) => items.find(li => li.textContent!.includes(name))!;
    expect(item('WS_PUBLIC_URL').textContent).toMatch(/set, given to this server directly/);
    expect(item('WS_PUBLIC_URL').querySelector('.mark')?.getAttribute('data-mark')).toBe('ok');
    expect(item('WS_HUB_DATABASE_URL').querySelector('.mark')?.getAttribute('data-mark')).toBe('ok');
    expect(item('WS_HUB_DATABASE_URL').textContent).toMatch(/set, read from DATABASE_URL/);
    expect(item('CRON_SECRET').querySelector('.mark')?.getAttribute('data-mark')).toBe('none');
    expect(item('CRON_SECRET').textContent).toMatch(/not set/);
    expect(text('db-list')).toMatch(/2 of 2 migrations/);
    expect(text('db-list')).toMatch(/READY/);
    expect(text('db-list')).toMatch(/3 changes not yet on the record/);
    expect(text('counts')).toMatch(/accounts/);
    expect(text('counts')).toMatch(/hub_account_clerk_user_2abc/);
    expect(text('table-list')).toMatch(/documents/);
    expect(text('table-list')).toMatch(/hub_account/);
  });

  it('pages a collection\'s rows, opens one whole as text, and finds by an id', async () => {
    const asked = await open({
      '/api/hub/dev/state': { status: 200, body: STATE },
      '/api/hub/dev/tables': { status: 200, body: TABLES },
      '/api/hub/dev/rows': { status: 200, body: ROWS },
      '/api/hub/dev/row': { status: 200, body: ROW },
      '/api/hub/dev/find': { status: 200, body: FOUND }
    });
    const collection = [...document.querySelectorAll('#table-list button')].find(b => b.textContent!.includes('hub_account')) as HTMLButtonElement;
    collection.click();
    await settle();
    expect(asked.some(u => u.startsWith('/api/hub/dev/rows?') && u.includes('table=documents') && u.includes('namespace=hub') && u.includes('type=hub_account') && u.includes('page=0'))).toBe(true);
    expect(text('rows-table')).toMatch(/hub_account_clerk_user_2abc/);
    (document.querySelector('#rows-table button') as HTMLButtonElement).click();
    await settle();
    expect(asked.some(u => u.startsWith('/api/hub/dev/row?') && u.includes('id=hub_account_clerk_user_2abc'))).toBe(true);
    // Whole, as text: what a row holds is never read as markup
    expect(text('row-text')).toContain('"handle": "alder"');
    expect(text('row-text')).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('#row-text img')).toBeNull();

    const form = document.getElementById('find-form') as HTMLFormElement;
    (form.elements.namedItem('id') as HTMLInputElement).value = 'alder';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(asked).toContain('/api/hub/dev/find?id=alder');
    expect(text('find-out')).toMatch(/hub_account_clerk_user_2abc/);
  });
});

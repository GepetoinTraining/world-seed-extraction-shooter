// @vitest-environment node
/**
 * TWO DATABASES, ONE BASE. Registered before the build.
 *
 * Pedro plays on test-pedro; every test session and every `npm run dev` uses
 * test-claude. They share what was found (the definitions, every item's history,
 * the bank's registry of claims) and nothing that belongs to a character.
 *
 * Moved on purpose from two SQLite files to two Postgres folders. A folder has one
 * opener at a time, so these bars open each side only to look, and hold one open
 * when they mean to see a running server refuse the sync.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { DatabaseUnavailable, folderUrl, IDatabase, openDatabase } from '../server/connection';
import { syncAtStart, syncBase } from '../server/syncBase';
import { databaseUrl } from '../server/vitePlugin';

const ROOT = resolve(__dirname, '..');
let template: string; let dir: string; let aFolder: string; let aUrl: string; let bUrl: string;

const doc = (id: string, namespace: string, data: unknown, updatedAt = 1000, signature: string | null = null) =>
  sql`INSERT INTO documents (id, namespace, data, version, created_at, updated_at, signature) VALUES (${id}, ${namespace}, ${typeof data === 'string' ? data : JSON.stringify(data)}, 1, 1000, ${updatedAt}, ${signature})`;

/** One look at a database, which is closed again before anything else may open it. */
async function on<T>(url: string, look: (d: IDatabase) => Promise<T>): Promise<T> {
  const d = await openDatabase(url);
  try { return await look(d); } finally { await d.close(); }
}
const run = (url: string, ...statements: ReturnType<typeof sql>[]) => on(url, async d => { for (const s of statements) await d.db.execute(s); });
const rows = async (url: string, statement: ReturnType<typeof sql>) => on(url, async d => (await d.db.execute(statement)).rows as any[]);
const ids = async (url: string, where = sql`true`) => (await rows(url, sql`SELECT id FROM documents WHERE ${where} ORDER BY id`)).map(r => String(r.id));
const dataOf = async (url: string, id: string) => String((await rows(url, sql`SELECT data FROM documents WHERE id = ${id}`))[0].data);
const countOf = async (url: string, table: string) => Number((await rows(url, sql`SELECT COUNT(*) n FROM ${sql.raw(table)}`))[0].n);

beforeAll(async () => {
  // Made once and copied for each bar: a fresh folder takes seconds, and a copy does not.
  template = join(mkdtempSync(join(tmpdir(), 'ws-sync-template-')), 'a');
  await run(folderUrl(template),
    doc('res_tree_log', 'content', { id: 'res_tree_log', name: 'Hardwood Log' }),
    doc('prov_itm_1', 'items', '{ "itemId":"itm_1",  "spacing":"kept" }', 1000, 'sig-1'),
    doc('mint_registry_v1', 'items', { rows: [['h1', 'itm_1'], ['h2', 'itm_2']] }),
    doc('ws_abc_character', 'characters', { username: 'BASALT' }),
    doc('session_1', 'transactions', { sealed: true }),
    doc('hub_state_world_1', 'territories', { lots: [{ ownerId: 'ws_abc_character' }] }),
    doc('home_hub_ws_abc_character', 'territories', { hubWorldUid: 'world_1' }),
    doc('browser_import_localhost:3101', 'territories', { imported: 1 }),
    doc('inst_g2_seed_32', 'worlds', { seed: 'seed' }),
    doc('world_1', 'content', { type: 'world_certificate', genre: 'HUB' }),
    doc('world_carts_world_1', 'content', { carts: [] }),
    sql`INSERT INTO ledger_rows (id, owner_uid, seq, prev_seq, ts, type, signature, data, version, created_at, updated_at)
        VALUES ('ledger_abc_1', 'ws_abc_character', 1, 0, 1, 'GOLD_DELTA', 's', '{}', 1, 1, 1)`,
    sql`INSERT INTO treasuries (id, namespace, gold, created_at, updated_at) VALUES ('treasury_world_1', 'territories', 100000, 1, 1)`
  );
}, 60_000);

afterAll(() => { try { rmSync(join(template, '..'), { recursive: true, force: true }); } catch { /* left for the OS */ } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-sync-'));
  aFolder = join(dir, 'a');
  cpSync(template, aFolder, { recursive: true });
  aUrl = folderUrl(aFolder);
  bUrl = folderUrl(join(dir, 'b'));
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS */ }
});

describe('the shared base', () => {
  it('builds a fresh database that holds what was found', async () => {
    await syncBase(aUrl, bUrl);
    expect(await ids(bUrl)).toEqual(['mint_registry_v1', 'prov_itm_1', 'res_tree_log']);
  }, 60_000);

  it('never carries a character, a ledger, a treasury, a hub, a session or a world', async () => {
    await syncBase(aUrl, bUrl);
    for (const namespace of ['characters', 'transactions', 'territories', 'worlds']) {
      expect(await ids(bUrl, sql`namespace = ${namespace}`), namespace).toEqual([]);
    }
    expect(await ids(bUrl, sql`id LIKE 'world%'`)).toEqual([]);
    expect(await countOf(bUrl, 'ledger_rows')).toBe(0);
    expect(await countOf(bUrl, 'treasuries')).toBe(0);
  }, 60_000);

  it('leaves the other database\'s characters exactly where they are', async () => {
    await syncBase(aUrl, bUrl);
    expect(await ids(aUrl, sql`namespace = 'characters'`)).toEqual(['ws_abc_character']);
    expect(await countOf(aUrl, 'ledger_rows')).toBe(1);
  }, 60_000);

  it('copies documents byte for byte, signature included, so they still verify', async () => {
    await syncBase(aUrl, bUrl);
    expect(await dataOf(bUrl, 'prov_itm_1')).toBe('{ "itemId":"itm_1",  "spacing":"kept" }');
    expect((await rows(bUrl, sql`SELECT signature FROM documents WHERE id = 'prov_itm_1'`))[0].signature).toBe('sig-1');
  }, 60_000);

  it('shares in both directions, so what either one finds reaches the other', async () => {
    await syncBase(aUrl, bUrl);
    await run(bUrl, doc('prov_itm_9', 'items', { itemId: 'itm_9' }));
    await syncBase(aUrl, bUrl);
    expect(await ids(aUrl, sql`id = 'prov_itm_9'`)).toEqual(['prov_itm_9']);
  }, 60_000);

  it('keeps the newer of two versions of one document', async () => {
    await syncBase(aUrl, bUrl);
    await run(bUrl, sql`UPDATE documents SET data = '{"events":2}', updated_at = 2000 WHERE id = 'prov_itm_1'`);
    await syncBase(aUrl, bUrl);
    expect(await dataOf(aUrl, 'prov_itm_1')).toBe('{"events":2}');
    await run(aUrl, sql`UPDATE documents SET data = '{"events":3}', updated_at = 3000 WHERE id = 'prov_itm_1'`);
    await syncBase(aUrl, bUrl);
    expect(await dataOf(bUrl, 'prov_itm_1')).toBe('{"events":3}');
  }, 60_000);

  it('merges the registry of claims, and the first claim holds', async () => {
    await syncBase(aUrl, bUrl);
    await run(bUrl, sql`UPDATE documents SET data = ${JSON.stringify({ rows: [['h1', 'itm_other'], ['h3', 'itm_3']] })}, updated_at = 5000 WHERE id = 'mint_registry_v1'`);
    await syncBase(aUrl, bUrl);
    for (const url of [aUrl, bUrl]) {
      const claims = new Map<string, string>(JSON.parse(await dataOf(url, 'mint_registry_v1')).rows);
      expect(claims.get('h1')).toBe('itm_1');
      expect(claims.get('h2')).toBe('itm_2');
      expect(claims.get('h3')).toBe('itm_3');
    }
  }, 60_000);

  it('changes nothing the second time', async () => {
    const first = await syncBase(aUrl, bUrl);
    expect(first.toTarget).toBeGreaterThan(0);
    const second = await syncBase(aUrl, bUrl);
    expect(second.toTarget).toBe(0);
    expect(second.toSource).toBe(0);
  }, 60_000);

  it('refuses to sync a database with itself', async () => {
    await expect(syncBase(aUrl, aUrl)).rejects.toThrow();
  });

  it('syncs folders only: an old file or a served database is refused, and nothing is written', async () => {
    await expect(syncBase('file:old.db', bUrl)).rejects.toBeInstanceOf(DatabaseUnavailable);
    await expect(syncBase(aUrl, 'postgres://nobody@127.0.0.1/none')).rejects.toBeInstanceOf(DatabaseUnavailable);
    expect(existsSync(join(dir, 'b'))).toBe(false);
  });
});

describe('a folder has one opener, and the sync lives with that', () => {
  it('refuses plainly if a running server holds either side, and writes to neither', async () => {
    await syncBase(aUrl, bUrl);
    await run(aUrl, doc('prov_itm_new', 'items', { itemId: 'itm_new' }));

    const held = await openDatabase(bUrl);
    let said = '';
    try {
      expect(await syncAtStart(aUrl, bUrl, line => { said += line; })).toBe(false);
    } finally {
      await held.close();
    }
    expect(said).toMatch(/not synced this time/);
    expect(await ids(bUrl, sql`id = 'prov_itm_new'`)).toEqual([]);

    // And the source was let go: the next sync has both.
    expect(await syncAtStart(aUrl, bUrl, () => undefined)).toBe(true);
    expect(await ids(bUrl, sql`id = 'prov_itm_new'`)).toEqual(['prov_itm_new']);
  }, 60_000);

  it('a mistake that is not about opening still throws', async () => {
    await expect(syncAtStart(aUrl, aUrl, () => undefined)).rejects.toThrow(/itself/);
  });

  it('refuses when one side is an uncarried old save, creating nothing there', async () => {
    const oldBeside = join(dir, 'old');
    mkdirSync(`${oldBeside}.db`, { recursive: true });
    let said = '';
    expect(await syncAtStart(aUrl, folderUrl(oldBeside), line => { said += line; })).toBe(false);
    expect(said).toContain('db:carry');
    expect(existsSync(oldBeside)).toBe(false);
  }, 60_000);
});

describe('scripts/pedro.ts, on two databases of its own', () => {
  const script = (dataRoot: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/pedro.ts', '--sync-only'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, WS_DATA_ROOT: dataRoot }
  });

  it('syncs both folders, and says what it did', async () => {
    mkdirSync(join(dir, 'data'));
    cpSync(template, join(dir, 'data/test-claude'), { recursive: true });
    const out = script(dir);
    expect(out.stdout).toMatch(/Shared base synced: 3 into test-pedro, 0 into test-claude/);
    expect(out.status).toBe(0);
    expect(await ids(folderUrl(join(dir, 'data/test-pedro')))).toEqual(['mint_registry_v1', 'prov_itm_1', 'res_tree_log']);
  }, 60_000);

  it('run alone with a side held, it says so and fails', async () => {
    mkdirSync(join(dir, 'data'));
    cpSync(template, join(dir, 'data/test-claude'), { recursive: true });
    const held = await openDatabase(folderUrl(join(dir, 'data/test-claude')));
    try {
      const out = script(dir);
      expect(out.stdout).toMatch(/not synced this time/);
      expect(out.status).toBe(1);
    } finally {
      await held.close();
    }
  }, 60_000);
});

describe('who uses which database', () => {
  it('npm run dev and every launch entry use test-claude, never the player\'s', () => {
    const saved = process.env.WS_DATABASE_URL;
    delete process.env.WS_DATABASE_URL;
    expect(databaseUrl(ROOT)).toMatch(/^pglite:\/\/.*data\/test-claude$/);
    if (saved !== undefined) process.env.WS_DATABASE_URL = saved;
    expect(readFileSync(join(ROOT, 'server/main.ts'), 'utf8')).toContain('defaultDatabaseUrl(root)');
    expect(readFileSync(join(ROOT, 'server/connection.ts'), 'utf8')).toContain('data/test-claude');
    expect(readFileSync(join(ROOT, '.claude/launch.json'), 'utf8')).not.toContain('pedro');
  });

  it('npm run pedro uses test-pedro on its own port, so no browser has saves to import there', () => {
    const source = readFileSync(join(ROOT, 'scripts/pedro.ts'), 'utf8');
    expect(source).toContain('data/test-pedro');
    const port = Number(/PEDRO_PORT = (\d+)/.exec(source)?.[1]);
    const launch = JSON.parse(readFileSync(join(ROOT, '.claude/launch.json'), 'utf8'));
    expect(port).toBeGreaterThan(0);
    expect(launch.configurations.map((c: { port: number }) => c.port)).not.toContain(port);
    expect(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.pedro).toContain('scripts/pedro.ts');
  });
});

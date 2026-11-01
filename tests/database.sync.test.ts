// @vitest-environment node
/**
 * TWO DATABASES, ONE BASE. Registered before the build.
 *
 * Pedro plays on test-pedro; every test session and every `npm run dev` uses
 * test-claude. They share what was found (the definitions, every item's history,
 * the bank's registry of claims) and nothing that belongs to a character.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, Client } from '@libsql/client';
import { openDatabase } from '../server/connection';
import { syncBase } from '../server/syncBase';
import { databaseUrl } from '../server/vitePlugin';

const ROOT = resolve(__dirname, '..');
let dir: string; let aUrl: string; let bUrl: string; let a: Client; let b: Client;

const doc = (id: string, namespace: string, data: unknown, updatedAt = 1000, signature: string | null = null) => ({
  sql: `INSERT INTO documents (id, namespace, data, version, created_at, updated_at, signature) VALUES (?, ?, ?, 1, 1000, ?, ?)`,
  args: [id, namespace, typeof data === 'string' ? data : JSON.stringify(data), updatedAt, signature]
});
const ids = async (c: Client, where = '1=1') =>
  (await c.execute(`SELECT id FROM documents WHERE ${where} ORDER BY id`)).rows.map(r => String(r.id));
const dataOf = async (c: Client, id: string) =>
  String((await c.execute({ sql: 'SELECT data FROM documents WHERE id = ?', args: [id] })).rows[0].data);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ws-sync-'));
  aUrl = `file:${join(dir, 'a.db').replace(/\\/g, '/')}`;
  bUrl = `file:${join(dir, 'b.db').replace(/\\/g, '/')}`;
  await (await openDatabase(aUrl)).close();
  a = createClient({ url: aUrl });
  await a.batch([
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
    {
      sql: `INSERT INTO ledger_rows (id, owner_uid, seq, prev_seq, ts, type, signature, data, version, created_at, updated_at)
            VALUES ('ledger_abc_1', 'ws_abc_character', 1, 0, 1, 'GOLD_DELTA', 's', '{}', 1, 1, 1)`,
      args: []
    },
    {
      sql: `INSERT INTO treasuries (id, namespace, gold, created_at, updated_at) VALUES ('treasury_world_1', 'territories', 100000, 1, 1)`,
      args: []
    }
  ], 'write');
  b = createClient({ url: bUrl });
});

afterEach(() => {
  a.close();
  b.close();
  // Windows may hold a just-closed database file for a moment; a leftover temp file is harmless.
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS */ }
});

describe('the shared base', () => {
  it('builds a fresh database that holds what was found', async () => {
    await syncBase(aUrl, bUrl);
    expect(await ids(b)).toEqual(['mint_registry_v1', 'prov_itm_1', 'res_tree_log']);
  });

  it('never carries a character, a ledger, a treasury, a hub, a session or a world', async () => {
    await syncBase(aUrl, bUrl);
    for (const namespace of ['characters', 'transactions', 'territories', 'worlds']) {
      expect(await ids(b, `namespace = '${namespace}'`), namespace).toEqual([]);
    }
    expect(await ids(b, `id LIKE 'world%'`)).toEqual([]);
    expect((await b.execute('SELECT COUNT(*) n FROM ledger_rows')).rows[0].n).toBe(0);
    expect((await b.execute('SELECT COUNT(*) n FROM treasuries')).rows[0].n).toBe(0);
  });

  it('leaves the other database\'s characters exactly where they are', async () => {
    await syncBase(aUrl, bUrl);
    expect(await ids(a, `namespace = 'characters'`)).toEqual(['ws_abc_character']);
    expect((await a.execute('SELECT COUNT(*) n FROM ledger_rows')).rows[0].n).toBe(1);
  });

  it('copies documents byte for byte, signature included, so they still verify', async () => {
    await syncBase(aUrl, bUrl);
    expect(await dataOf(b, 'prov_itm_1')).toBe('{ "itemId":"itm_1",  "spacing":"kept" }');
    const row = (await b.execute(`SELECT signature FROM documents WHERE id = 'prov_itm_1'`)).rows[0];
    expect(row.signature).toBe('sig-1');
  });

  it('shares in both directions, so what either one finds reaches the other', async () => {
    await syncBase(aUrl, bUrl);
    await b.execute(doc('prov_itm_9', 'items', { itemId: 'itm_9' }));
    await syncBase(aUrl, bUrl);
    expect(await ids(a, `id = 'prov_itm_9'`)).toEqual(['prov_itm_9']);
  });

  it('keeps the newer of two versions of one document', async () => {
    await syncBase(aUrl, bUrl);
    await b.execute(`UPDATE documents SET data = '{"events":2}', updated_at = 2000 WHERE id = 'prov_itm_1'`);
    await syncBase(aUrl, bUrl);
    expect(await dataOf(a, 'prov_itm_1')).toBe('{"events":2}');
    await a.execute(`UPDATE documents SET data = '{"events":3}', updated_at = 3000 WHERE id = 'prov_itm_1'`);
    await syncBase(aUrl, bUrl);
    expect(await dataOf(b, 'prov_itm_1')).toBe('{"events":3}');
  });

  it('merges the registry of claims, and the first claim holds', async () => {
    await syncBase(aUrl, bUrl);
    await b.execute({
      sql: `UPDATE documents SET data = ?, updated_at = 5000 WHERE id = 'mint_registry_v1'`,
      args: [JSON.stringify({ rows: [['h1', 'itm_other'], ['h3', 'itm_3']] })]
    });
    await syncBase(aUrl, bUrl);
    for (const c of [a, b]) {
      const rows = new Map<string, string>(JSON.parse(await dataOf(c, 'mint_registry_v1')).rows);
      expect(rows.get('h1')).toBe('itm_1');
      expect(rows.get('h2')).toBe('itm_2');
      expect(rows.get('h3')).toBe('itm_3');
    }
  });

  it('changes nothing the second time', async () => {
    const first = await syncBase(aUrl, bUrl);
    expect(first.toTarget).toBeGreaterThan(0);
    const second = await syncBase(aUrl, bUrl);
    expect(second.toTarget).toBe(0);
    expect(second.toSource).toBe(0);
  });

  it('refuses to sync a database with itself', async () => {
    await expect(syncBase(aUrl, aUrl)).rejects.toThrow();
  });
});

describe('who uses which database', () => {
  it('npm run dev and every launch entry use test-claude, never the player\'s', () => {
    const saved = process.env.WS_DATABASE_URL;
    delete process.env.WS_DATABASE_URL;
    expect(databaseUrl(ROOT)).toMatch(/data\/test-claude\.db$/);
    if (saved !== undefined) process.env.WS_DATABASE_URL = saved;
    expect(readFileSync(join(ROOT, 'server/main.ts'), 'utf8')).toContain('data/test-claude.db');
    expect(readFileSync(join(ROOT, '.claude/launch.json'), 'utf8')).not.toContain('pedro');
  });

  it('npm run pedro uses test-pedro on its own port, so no browser has saves to import there', () => {
    const script = readFileSync(join(ROOT, 'scripts/pedro.ts'), 'utf8');
    expect(script).toContain('data/test-pedro.db');
    const port = Number(/PEDRO_PORT = (\d+)/.exec(script)?.[1]);
    const launch = JSON.parse(readFileSync(join(ROOT, '.claude/launch.json'), 'utf8'));
    expect(port).toBeGreaterThan(0);
    expect(launch.configurations.map((c: { port: number }) => c.port)).not.toContain(port);
    expect(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.pedro).toContain('scripts/pedro.ts');
  });
});

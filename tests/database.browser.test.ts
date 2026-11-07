// @vitest-environment node
/**
 * THE STORE IN THE BROWSER (Pedro, 2026-11-04: "the DB layer needs to be local (idb) or postgress
 * for online play"). The same SqlStore, on PGlite, which in a browser keeps its files in IndexedDB.
 * These bars open it in memory, the way PGlite does under Node; the browser differs only in where
 * PGlite keeps the files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { join } from 'node:path';
import { openBrowserStore, BROWSER_MIGRATIONS } from '../src/entities/data/BrowserStore';
import { StoreConflict, SqlStore } from '../shared/SqlStore';
import { StoreClient, StoreRefused, useVault } from '../shared/entities/data/StoreClient';

const row = (uid: string, seq: number, note: string) => ({
  id: `ledger_${uid}_${String(seq).padStart(8, '0')}`,
  namespace: 'transactions',
  dataText: JSON.stringify({ payload: { seq, prevSeq: seq - 1, ts: 1, type: 'GOLD_DELTA', data: { note } }, signature: `s${seq}${note}`, certUid: uid, timestamp: 1 }),
  metadata: { createdAt: 1, updatedAt: 1, ownerCertUid: uid, version: 1 }
});

const opened: SqlStore[] = [];
afterEach(async () => {
  StoreClient.useServer();
  await Promise.all(opened.splice(0).map(s => s.close()));
});

describe('the store, opened in a browser', () => {
  it('carries the server\'s migrations exactly, by the same hashes', async () => {
    const onDisk = readMigrationFiles({ migrationsFolder: join(process.cwd(), 'drizzle', 'pg') });
    expect(BROWSER_MIGRATIONS.map(m => m.hash)).toEqual(onDisk.map(m => m.hash));
    const store = await openBrowserStore('memory://');
    opened.push(store);
    expect(await store.health()).toMatchObject({ ok: true, service: 'worldseed-db' });
  });

  it('keeps the chain\'s law: rows append, one onto the last, and never change', async () => {
    const store = await openBrowserStore('memory://');
    opened.push(store);
    await store.commit({ commitId: 'c1', ops: [{ kind: 'put', doc: row('ws_b', 1, 'first') }] });
    await expect(store.commit({ commitId: 'c2', ops: [{ kind: 'put', doc: row('ws_b', 1, 'other') }] })).rejects.toBeInstanceOf(StoreConflict);
    await expect(store.commit({ commitId: 'c3', ops: [{ kind: 'put', doc: row('ws_b', 3, 'gap') }] })).rejects.toBeInstanceOf(StoreConflict);
    expect((await store.get('ledger_head_ws_b'))?.dataText).toBe(JSON.stringify({ seq: 1 }));
  });

  it('one tab holds it: a second opener in the same browser is told the game is open elsewhere', async () => {
    const taken = { request: async (_name: string, _options: unknown, grant: (lock: unknown) => unknown) => grant(null) };
    await expect(openBrowserStore('memory://', { locks: taken as any })).rejects.toThrow(/another tab/i);
  });
});

describe('the store client, with the store in the page', () => {
  it('reads, writes and refuses as it does over the wire, with no server', async () => {
    const store = await openBrowserStore('memory://');
    opened.push(store);
    StoreClient.useLocal(Promise.resolve(store));

    expect(await StoreClient.health()).toMatchObject({ ok: true, service: 'worldseed-db' });
    await StoreClient.commit({ commitId: 'k1', ops: [{ kind: 'put', doc: row('ws_c', 1, 'first') }] });
    expect((await StoreClient.get(row('ws_c', 1, 'first').id))?.dataText).toBe(row('ws_c', 1, 'first').dataText);
    expect(await StoreClient.query({ namespace: 'transactions', idPrefix: 'ledger_ws_c_' })).toHaveLength(1);

    const refused = await StoreClient.commit({ commitId: 'k2', ops: [{ kind: 'put', doc: row('ws_c', 1, 'other') }] }).catch(e => e);
    expect(refused).toBeInstanceOf(StoreRefused);
    expect(refused.conflict).toBe(true);
    expect(useVault.getState().status).toBe('OPEN');
  });

  it('a store that will not open closes the vault with its reason, and nothing pretends to have landed', async () => {
    StoreClient.configure({ retryMs: 5 });
    StoreClient.useLocal(Promise.reject(new Error('The game is open in another tab.')));
    expect(await StoreClient.checkVault()).toMatchObject({ ok: false, reason: expect.stringMatching(/another tab/) });
    expect(useVault.getState()).toMatchObject({ status: 'CLOSED' });
    StoreClient.configure({ retryMs: 400 });
  });
});

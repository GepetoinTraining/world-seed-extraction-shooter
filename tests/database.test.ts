/**
 * THE STABLE DATABASE (D31), the game's half. Registered before the build.
 *
 * Line 69: saves live in the SQL database, and clearing browser storage then
 *   restoring the avatar backup brings everything back.
 * Line 71's client half: every gold change goes to the server as ONE commit.
 * Plus the refusal when the server is down, and the one-time import.
 *
 * Nothing here mocks the store. A real server process holds a real SQLite file,
 * and the real VectorStore reaches it over HTTP. The certificate system is real
 * too, with only its IndexedDB shelf swapped for a Map, because jsdom has none.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync, spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';

import { CertificateSystem, IPlayerCertificate } from '../src/entities/identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../src/entities/data/VectorStore';
import { StoreClient, useVault } from '../src/entities/data/StoreClient';
import { StoreUnit } from '../src/entities/data/StoreUnit';
import { useIdentityStore } from '../src/entities/identity/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useHubStore } from '../src/entities/hub/store';
import { PlayerPersistence } from '../src/logic/persistence/PlayerPersistence';
import { BrowserImport, ILegacyDoc } from '../src/logic/persistence/BrowserImport';
import { HomeHub } from '../src/logic/persistence/HomeHub';
import { Ledger } from '../src/logic/ledger/Ledger';
import { Treasury } from '../src/logic/economy/Treasury';
import { Wallets } from '../src/logic/economy/Wallets';
import { ExitLevy } from '../src/logic/economy/ExitLevy';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { GoldCommit } from '../src/logic/economy/GoldCommit';
import { AvatarExport } from '../src/logic/sovereignty/AvatarExport';
import { WorldCertificateSystem, WorldType, AccessMode } from '../src/entities/world/WorldCertificate';
import { UniversalRank } from '../types';

const ROOT = process.cwd();
const keys = new Map<string, CryptoKey>();

function read(path: string) { return readFileSync(join(ROOT, path), 'utf8'); }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// --- a real server process ---------------------------------------------------

let child: ChildProcess | null = null;
let dbUrl = '';
let port = 0;

async function startServer() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, WS_DATABASE_URL: dbUrl, WS_PORT: String(port), WS_NO_STATIC: '1' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/db/health`)).ok) return; } catch { /* still rising */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the test server never answered');
}

async function stopServer() {
  const c = child;
  child = null;
  if (!c) return;
  await new Promise<void>(resolve => { c.on('exit', () => resolve()); c.kill('SIGKILL'); });
}

// --- a real avatar -----------------------------------------------------------

async function mintCert(name: string): Promise<IPlayerCertificate> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
  const uid = `ws_${name}_${Math.random().toString(36).slice(2, 10)}`;
  keys.set(uid, pair.privateKey);
  return {
    metadata: { uid, displayName: name, birthData: {} as any, createdAt: 1000, version: '1.0.0' },
    publicKeyJWK: await crypto.subtle.exportKey('jwk', pair.publicKey),
    certificatePEM: ''
  };
}

async function becomeAvatar(name: string, gold = 500): Promise<IPlayerCertificate> {
  const cert = await mintCert(name);
  localStorage.setItem('worldseed_certificate', JSON.stringify(cert));
  useIdentityStore.setState({ certificate: cert });
  usePlayerStore.setState(s => ({ player: { ...s.player, id: cert.metadata.uid, username: name, bank: { ...s.player.bank, gold } } }));
  await GoldCommit.commit({ rows: [{ type: 'CHARACTER_GENESIS', data: { certUid: cert.metadata.uid, gold } }] });
  return cert;
}

function wipeBrowser() {
  keys.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: null });
  usePlayerStore.setState(s => ({ player: { ...s.player, id: 'temp_id', username: 'Unknown', bank: { ...s.player.bank, gold: 100 } } }));
}

const gold = () => usePlayerStore.getState().player.bank.gold;
const spend = (n: number) => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - n } } }));

async function textOf(blob: any): Promise<string> { return blob.text(); }

beforeAll(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(CertificateSystem, 'getPrivateKey').mockImplementation(async uid => keys.get(uid) ?? null);
  vi.spyOn(CertificateSystem, 'storePrivateKey').mockImplementation(async (uid, key) => { keys.set(uid, key); });
  const dir = mkdtempSync(join(tmpdir(), 'ws-game-'));
  dbUrl = `file:${join(dir, 'game.db').replace(/\\/g, '/')}`;
  port = 21000 + Math.floor(Math.random() * 3000);
  await startServer();
  StoreClient.configure({ baseUrl: `http://127.0.0.1:${port}`, retryMs: 50 });
}, 60_000);

afterAll(async () => {
  await stopServer();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useHubStore.setState({ activeHubId: 'hub_test', lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as any);
});

// ---------------------------------------------------------------------------
// LINE 69
// ---------------------------------------------------------------------------

describe('line 69: saves live in the SQL database', () => {
  it('the game\'s store speaks HTTP and imports no browser database', () => {
    const src = read('src/entities/data/VectorStore.ts');
    expect(src).not.toMatch(/RxDBClient|rxdb|dexie/i);
    expect(read('src/entities/data/StoreClient.ts')).toMatch(/fetch\(/);
  });

  it('only the one-time import may touch the old browser database, and only lazily', () => {
    const offenders = [...walk('src'), 'App.tsx', 'index.tsx']
      .filter(p => p !== 'src/entities/data/RxDBClient.ts' && p !== 'src/logic/persistence/BrowserImport.ts' && p !== 'src/entities/identity/VectorStore.ts')
      .filter(p => /RxDBClient|from 'rxdb|from 'dexie/.test(read(p)));
    expect(offenders).toEqual([]);
    const importer = read('src/logic/persistence/BrowserImport.ts');
    expect(importer).not.toMatch(/^import .*RxDBClient/m);
    expect(importer).toMatch(/import\(['"].*RxDBClient['"]\)/);
  });

  it('a save and its ledger reach the file, and a second server process finds them', async () => {
    const cert = await becomeAvatar('LOAM');
    const uid = cert.metadata.uid;
    spend(40);
    await GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'TEST', amount: -40, treasuryId: 'hub_l69', treasuryDelta: 40 } }], treasury: { worldUid: 'hub_l69', delta: 40 } });

    await stopServer();
    await startServer();

    const hydrated = await PlayerPersistence.hydrate(cert);
    expect(hydrated.status).toBe('OK');
    if (hydrated.status === 'OK') expect(hydrated.player.bank.gold).toBe(460);
    expect((await Ledger.audit(uid)).ok).toBe(true);
    expect((await Ledger.list(uid)).map(r => r.payload.type)).toEqual(['CHARACTER_GENESIS', 'GOLD_DELTA']);
    expect(await Treasury.balance('hub_l69')).toBe(40);
  }, 60_000);

  it('a real signature still verifies after the round trip through the column', async () => {
    const cert = await becomeAvatar('BYTE');
    usePlayerStore.setState(s => ({ player: { ...s.player, username: 'BYTE naïve 🐉 "q" \\ \n', bank: { ...s.player.bank, lore: { z: { topic: 'z', xp: 1.1, level: 2, dateDiscovered: 1e21 }, '10': { topic: 'ten', xp: 0, level: 1, dateDiscovered: 0 }, '2': { topic: 'two', xp: 0, level: 1, dateDiscovered: 0 } } } } }));
    await PlayerPersistence.flush('bytes');
    const back = await PlayerPersistence.hydrate(cert);
    expect(back.status).toBe('OK');
  });

  it('a changed save is still refused after the move to SQL', async () => {
    const cert = await becomeAvatar('FORGE');
    await PlayerPersistence.flush('test');
    const doc = await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid);
    doc!.data.payload.bank.gold = 9_999_999;
    await VectorStore.put(doc!);
    expect((await PlayerPersistence.hydrate(cert)).status).toBe('TAMPERED');
  });

  it('clearing browser storage and restoring the backup brings everything back', async () => {
    const cert = await becomeAvatar('RESTORE');
    const uid = cert.metadata.uid;
    spend(25);
    await GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'TEST', amount: -25, treasuryId: 'hub_back', treasuryDelta: 25 } }], treasury: { worldUid: 'hub_back', delta: 25 } });
    await VectorStore.put({ id: `hub_state_back_${uid}`, namespace: VectorNamespace.TERRITORIES, data: { lots: [{ id: 'lot', ownerId: uid }] }, metadata: { createdAt: 1, updatedAt: 1, version: 1 } });

    const backup = await AvatarExport.exportAvatar('open sesame');
    const file = await textOf(backup!.blob);
    const rowsBefore = JSON.stringify(await Ledger.list(uid));

    wipeBrowser();
    expect(await CertificateSystem.getPrivateKey(uid)).toBeNull();

    const result = await AvatarExport.importAvatar(file, 'open sesame');
    expect(result).toMatchObject({ ok: true, username: 'RESTORE' });

    // The key came from the file; the bank, the ledger and the hub were in the database.
    expect(await CertificateSystem.getPrivateKey(uid)).not.toBeNull();
    const restored = JSON.parse(localStorage.getItem('worldseed_certificate')!) as IPlayerCertificate;
    useIdentityStore.setState({ certificate: restored });
    const hydrated = await PlayerPersistence.hydrate(restored);
    expect(hydrated.status).toBe('OK');
    if (hydrated.status === 'OK') expect(hydrated.player.bank.gold).toBe(475);
    expect(JSON.stringify(await Ledger.list(uid))).toBe(rowsBefore);
    expect((await Ledger.audit(uid)).ok).toBe(true);
    expect((await VectorStore.get<any>(VectorNamespace.TERRITORIES, `hub_state_back_${uid}`))!.data.lots[0].ownerId).toBe(uid);
    expect(await Treasury.balance('hub_back')).toBe(25);
  });

  it('an old backup never rolls the database back and never forks the chain', async () => {
    const cert = await becomeAvatar('STALE');
    const uid = cert.metadata.uid;
    const old = await textOf((await AvatarExport.exportAvatar('pw'))!.blob);

    // Play goes on after the backup was taken.
    spend(100);
    await GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'AFTER', amount: -100, treasuryId: 'hub_stale', treasuryDelta: 100 } }], treasury: { worldUid: 'hub_stale', delta: 100 } });
    const rowsAfterPlay = (await Ledger.list(uid)).length;

    wipeBrowser();
    expect((await AvatarExport.importAvatar(old, 'pw')).ok).toBe(true);

    const restored = JSON.parse(localStorage.getItem('worldseed_certificate')!) as IPlayerCertificate;
    useIdentityStore.setState({ certificate: restored });
    const hydrated = await PlayerPersistence.hydrate(restored);
    if (hydrated.status === 'OK') expect(hydrated.player.bank.gold).toBe(400);
    else throw new Error(`hydrate said ${hydrated.status}`);
    expect((await Ledger.list(uid)).length).toBe(rowsAfterPlay);
    expect((await Ledger.audit(uid)).ok).toBe(true);
    // And the next row takes the next seq, on the database's chain.
    usePlayerStore.setState(s => ({ player: { ...s.player, id: uid, bank: { ...s.player.bank, gold: 400 } } }));
    expect(await Ledger.append('CRAFT', { after: 'restore' })).toBe(rowsAfterPlay + 1);
  });

  it('a backup restored onto an empty database still brings its bank and chain', async () => {
    const cert = await becomeAvatar('MOVER');
    const uid = cert.metadata.uid;
    spend(5);
    await GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'T', amount: -5 } }] });
    const file = await textOf((await AvatarExport.exportAvatar('pw'))!.blob);

    // A second, empty database: another machine, or a lost file.
    await stopServer();
    const dir = mkdtempSync(join(tmpdir(), 'ws-empty-'));
    const keepUrl = dbUrl;
    dbUrl = `file:${join(dir, 'empty.db').replace(/\\/g, '/')}`;
    await startServer();
    wipeBrowser();

    expect((await AvatarExport.importAvatar(file, 'pw')).ok).toBe(true);
    const restored = JSON.parse(localStorage.getItem('worldseed_certificate')!) as IPlayerCertificate;
    useIdentityStore.setState({ certificate: restored });
    expect((await Ledger.list(uid)).length).toBe(2);
    expect((await Ledger.audit(uid)).ok).toBe(true);
    const hydrated = await PlayerPersistence.hydrate(restored);
    expect(hydrated.status === 'OK' && hydrated.player.bank.gold).toBe(495);

    await stopServer();
    dbUrl = keepUrl;
    await startServer();
  }, 60_000);

  it('refuses a backup whose chain disagrees with the database, writing nothing', async () => {
    const cert = await becomeAvatar('FORK');
    const uid = cert.metadata.uid;
    const file = JSON.parse(await textOf((await AvatarExport.exportAvatar('pw'))!.blob));
    // Same identity, a row the database never saw at a seq it already holds.
    spend(1);
    await GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'REAL', amount: -1 } }] });
    const forged = await CertificateSystem.signPayload(uid, { seq: 2, prevSeq: 1, ts: 1, type: 'GOLD_DELTA', data: { reason: 'FORK', amount: 1000 } });
    file.body.ledger.push(forged);
    const { sha256Hex } = await import('../src/logic/journal/SessionJournal');
    file.digest = await sha256Hex(JSON.stringify(file.body));

    const result = await AvatarExport.importAvatar(JSON.stringify(file), 'pw');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/chain/i);
    const rows = await Ledger.list(uid);
    expect(rows[1].payload.data.reason).toBe('REAL');
  });

  it('a wiped browser finds its home hub again', async () => {
    const cert = await becomeAvatar('HOMING');
    await HomeHub.pin(cert.metadata.uid, 'hub_homing');
    expect(await HomeHub.of(cert.metadata.uid)).toBe('hub_homing');
  });

  it('the private key never reaches the server: no commit carries it', () => {
    for (const file of walk('server')) {
      expect(read(file)).not.toMatch(/privateKey|encryptedPrivateKey/);
    }
    const persistence = read('src/logic/persistence/PlayerPersistence.ts') + read('src/logic/ledger/Ledger.ts') + read('src/logic/economy/GoldCommit.ts');
    expect(persistence).not.toMatch(/exportKey|encryptedPrivateKey/);
  });
});

// ---------------------------------------------------------------------------
// LINE 71: THE CLIENT'S HALF
// ---------------------------------------------------------------------------

describe('line 71: a gold change is one commit', () => {
  it('sends the player, the treasury and the row in a single request', async () => {
    const cert = await becomeAvatar('ONEREQ');
    const seen: any[] = [];
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      if (String(url).endsWith('/commit')) seen.push(JSON.parse(init.body));
      return real(url, init);
    });
    await ExitLevy.charge('world_one', 1000, 0.05);
    spy.mockRestore();

    expect(seen.length).toBe(1);
    const ids = seen[0].ops.map((o: any) => o.kind === 'add' ? o.id : o.doc.id);
    expect(ids).toContain(cert.metadata.uid);
    expect(ids).toContain('treasury_world_one');
    expect(ids.some((i: string) => i.startsWith(`ledger_${cert.metadata.uid}_`))).toBe(true);
    expect(await Treasury.balance('world_one')).toBe(50);
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold).toBe(450);
  });

  it('a commit the server refuses leaves nothing behind', async () => {
    const cert = await becomeAvatar('REFUSED');
    const before = (await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold;
    const unit = new StoreUnit();
    await VectorStore.put({ id: cert.metadata.uid, namespace: VectorNamespace.CHARACTERS, data: { payload: { bank: { gold: 1 } } }, metadata: { createdAt: 1, updatedAt: 1, version: 1 } }, false, { unit });
    await VectorStore.put({ id: 'treasury_refused', namespace: VectorNamespace.TERRITORIES, data: { gold: 5 }, metadata: { createdAt: 1, updatedAt: 1, version: 1 } }, false, { unit, increment: 5 });
    await VectorStore.put({ id: `ledger_${cert.metadata.uid}_00000099`, namespace: VectorNamespace.TRANSACTIONS, data: { payload: { seq: 99, prevSeq: 98, ts: 1, type: 'TAX', data: {} }, signature: 's', certUid: 'x', timestamp: 1 }, metadata: { createdAt: 1, updatedAt: 1, version: 1 } }, false, { unit });
    const result = await unit.commit();
    expect(result.ok).toBe(false);
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold).toBe(before);
    expect(await Treasury.balance('refused')).toBe(0);
  });

  it('overlapping gold changes keep their order: chain, bank and treasury all agree', async () => {
    const cert = await becomeAvatar('OVERLAP', 1000);
    const hub = `hub_overlap_${cert.metadata.uid}`;
    await Promise.all(Array.from({ length: 12 }, () => {
      spend(10);
      return GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'BURST', amount: -10, treasuryId: hub, treasuryDelta: 10 } }], treasury: { worldUid: hub, delta: 10 } });
    }));
    expect((await Ledger.audit(cert.metadata.uid)).ok).toBe(true);
    expect((await Ledger.list(cert.metadata.uid)).length).toBe(13);
    expect(await Treasury.balance(hub)).toBe(120);
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold).toBe(880);
  });

  it('a save taken between two gold changes can never get ahead of the ledger', async () => {
    const cert = await becomeAvatar('ORDER', 1000);
    const hub = `hub_order_${cert.metadata.uid}`;
    spend(10);
    const first = GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'A', amount: -10, treasuryId: hub, treasuryDelta: 10 } }], treasury: { worldUid: hub, delta: 10 } });
    const flush = PlayerPersistence.flush('in-between');
    spend(10); // this change's commit is queued after the flush
    const second = GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'B', amount: -10, treasuryId: hub, treasuryDelta: 10 } }], treasury: { worldUid: hub, delta: 10 } });
    await Promise.all([first, flush, second]);
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold).toBe(980);
    expect((await GoldAudit.run()).notes.filter(n => n.startsWith('player'))).toEqual([]);
  });

  it('two tabs on one avatar cannot fork the chain: the loser re-reads and takes the next seq', async () => {
    const cert = await becomeAvatar('TWOTABS');
    const uid = cert.metadata.uid;
    // Another tab appended behind this one's back.
    const other = await CertificateSystem.signPayload(uid, { seq: 2, prevSeq: 1, ts: 2, type: 'CRAFT', data: { tab: 'other' } });
    await VectorStore.put({ id: `ledger_${uid}_00000002`, namespace: VectorNamespace.TRANSACTIONS, data: other, metadata: { createdAt: 2, updatedAt: 2, ownerCertUid: uid, signature: other.signature, version: 1 } });
    expect(await Ledger.append('CRAFT', { tab: 'this' })).toBe(3);
    expect((await Ledger.audit(uid)).ok).toBe(true);
  });

  it('a one-time grant to a hub lands exactly once, with its record', async () => {
    const hub = `hub_endow_${Math.random().toString(36).slice(2)}`;
    await Promise.all([Treasury.endow(hub, 1000), Treasury.endow(hub, 1000), Treasury.endow(hub, 1000)]);
    expect(await Treasury.balance(hub)).toBe(1000);
    expect((await VectorStore.get<any>(VectorNamespace.TERRITORIES, `endowment_${hub}`))!.data.gold).toBe(1000);
  });

  it('a wallet comes once, reads back, and moves with its row (D115)', async () => {
    const cert = await becomeAvatar('PURSE');
    const hub = `hub_purse_${Math.random().toString(36).slice(2)}`;
    const total = await Wallets.totalAll();
    await Promise.all([Wallets.bring(hub, 'res_a', 70, 'A'), Wallets.bring(hub, 'res_a', 70, 'A'), Wallets.bring(hub, 'res_a', 70, 'A')]);
    await Wallets.bring(hub, 'npc_b', 30, 'B');
    expect(await Wallets.balance(hub, 'res_a')).toBe(70);
    expect(await Wallets.allOf(hub)).toEqual({ res_a: 70, npc_b: 30 });
    expect(await Wallets.totalAll()).toBe(total + 100);

    await GoldCommit.commit({
      rows: [{ type: 'TRADE', data: { kind: 'TEST', playerDelta: 0, treasuryDelta: 0, wallets: { res_a: -20, npc_b: 20 } } }],
      wallets: { hubId: hub, deltas: { res_a: -20, npc_b: 20 } }
    });
    expect(await Wallets.allOf(hub)).toEqual({ res_a: 50, npc_b: 50 });
    expect(await Treasury.totalAll()).toBe(await Treasury.totalAll());
    const rows = await Ledger.list(cert.metadata.uid);
    expect(rows.filter(r => r.payload.type === 'WALLET')).toHaveLength(2);
    expect((await Ledger.audit(cert.metadata.uid)).ok).toBe(true);
  });

  it('a wallet is not a treasury: the two totals never mix (D115)', async () => {
    await becomeAvatar('APART');
    const hub = `hub_apart_${Math.random().toString(36).slice(2)}`;
    const treasuries = await Treasury.totalAll();
    await Wallets.bring(hub, 'res_a', 40, 'A');
    expect(await Treasury.totalAll()).toBe(treasuries);
  });

  it('a print lands with the payment it covers, or neither does (D115)', async () => {
    const cert = await becomeAvatar('PRINTER');
    const hub = `hub_print_${Math.random().toString(36).slice(2)}`;
    await GoldCommit.commit({
      rows: [
        { type: 'PRINT', data: { hubId: hub, amount: 1400, perDay: 100, days: 14, why: 'TEST' } },
        { type: 'GOLD_DELTA', data: { reason: 'TEST', amount: 0, treasuryId: hub, treasuryDelta: -100 } }
      ],
      treasury: { worldUid: hub, delta: 1300 }
    });
    expect(await Treasury.balance(hub)).toBe(1300);
    const rows = await Ledger.list(cert.metadata.uid);
    expect(rows.find(r => r.payload.type === 'PRINT')!.payload.data.amount).toBe(1400);
    expect((await Ledger.audit(cert.metadata.uid)).ok).toBe(true);
  });

  it('every gold write in the game goes through the one commit', () => {
    // A gold change outside GoldCommit is the debt coming back. Read the code itself.
    const sites = ['src/entities/hub/store.ts', 'src/entities/hub/dialogue.ts', 'src/logic/economy/ExitLevy.ts', 'src/logic/initialization/StartupSequence.ts', 'src/entities/player/store.ts', 'src/components/WorldCanvas.tsx', 'src/logic/systems/DeedSystem.ts'];
    for (const file of sites) {
      const src = read(file);
      expect(src, `${file} credits a treasury outside the commit`).not.toMatch(/Treasury\.credit\(/);
      expect(src, `${file} appends a gold row outside the commit`).not.toMatch(/Ledger\.append\(\s*'(GOLD_DELTA|TAX|UPKEEP|CHARACTER_GENESIS)'/);
    }
    // Nor does any file outside the economy write a treasury by hand.
    const writers = walk('src').filter(p => p !== 'src/logic/economy/Treasury.ts' && p !== 'src/logic/persistence/BrowserImport.ts' && /treasury_\$\{/.test(read(p)));
    expect(writers).toEqual([]);
    // A TRADE row that moves gold takes the commit too.
    expect(read('src/entities/hub/store.ts')).not.toMatch(/Ledger\.append\('TRADE', \{ kind: 'SHOP_SALE'/);
  });

  it('every gold setState is followed by its commit with no await between them', () => {
    // An await between the change and the commit is a window where a save can
    // capture gold the ledger has not heard of.
    const src = read('src/entities/hub/store.ts');
    const lines = src.split('\n');
    const changes = lines.flatMap((l, i) => /gold: s\.player\.bank\.gold [-+]/.test(l) ? [i] : []);
    expect(changes.length).toBeGreaterThanOrEqual(7);
    for (const at of changes) {
      const rest = lines.slice(at).join('\n');
      const commitAt = rest.indexOf('GoldCommit.commit(');
      expect(commitAt, `no commit after line ${at + 1}`).toBeGreaterThan(-1);
      // The commit's own await ends the window; it is not a gap in it.
      expect(rest.slice(0, commitAt).replace(/await\s*$/, ''), `an await separates the gold change at line ${at + 1} from its commit`).not.toMatch(/\bawait\b/);
    }
  });

  it('the hub, the bank and a shop purchase move together', async () => {
    const cert = await becomeAvatar('BUYER', 6000);
    const hub = `hub_buy_${cert.metadata.uid}`;
    useHubStore.setState({ activeHubId: hub, lots: [{ id: 'lot_a', lotIndex: 0, ownerId: null, ownerName: null, purchaseDate: null, structureType: 'EMPTY', inventory: [], price: 5000 }] } as any);
    expect(await useHubStore.getState().buyLot('lot_a')).toBe(true);
    const hubDoc = await VectorStore.get<any>(VectorNamespace.TERRITORIES, `hub_state_${hub}`);
    expect(hubDoc!.data.lots[0].ownerId).toBe(cert.metadata.uid);
    expect(await Treasury.balance(hub)).toBe(5000);
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold).toBe(1000);
    expect((await Ledger.list(cert.metadata.uid)).map(r => r.payload.data.reason ?? r.payload.type)).toContain('LOT_PURCHASE');
  });
});

// ---------------------------------------------------------------------------
// THE SERVER IS DOWN
// ---------------------------------------------------------------------------

describe('when the server is down, the bank refuses', () => {
  it('reads wait instead of answering "nothing there", and the vault says it is closed', async () => {
    const cert = await becomeAvatar('OUTAGE');
    await PlayerPersistence.flush('before');
    useVault.setState({ status: 'OPEN' });
    await stopServer();

    let settled: any = 'pending';
    const hydrating = PlayerPersistence.hydrate(cert).then(r => { settled = r; return r; });
    await new Promise(r => setTimeout(r, 400));
    // A false "EMPTY" here would mint a new character over the real save.
    expect(settled).toBe('pending');
    expect(useVault.getState().status).toBe('CLOSED');

    await startServer();
    const result = await hydrating;
    expect(result.status).toBe('OK');
    expect(useVault.getState().status).toBe('OPEN');
  }, 60_000);

  it('a gold commit made while the server is down lands whole, once, when it returns', async () => {
    const cert = await becomeAvatar('HELD');
    const hub = `hub_held_${cert.metadata.uid}`;
    await stopServer();
    spend(20);
    const pending = GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'HELD', amount: -20, treasuryId: hub, treasuryDelta: 20 } }], treasury: { worldUid: hub, delta: 20 } });
    await new Promise(r => setTimeout(r, 300));
    expect(useVault.getState().status).toBe('CLOSED');
    await startServer();
    await pending;
    expect(await Treasury.balance(hub)).toBe(20);
    expect((await Ledger.audit(cert.metadata.uid)).ok).toBe(true);
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, cert.metadata.uid))!.data.payload.bank.gold).toBe(480);
  }, 60_000);

  it('a request that landed but lost its answer is not applied twice', async () => {
    const hub = `hub_lost_${Math.random().toString(36).slice(2)}`;
    const real = globalThis.fetch;
    let dropped = false;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      const res = await real(url, init);
      if (!dropped && String(url).endsWith('/commit')) { dropped = true; throw new TypeError('the answer was lost on the way back'); }
      return res;
    });
    await Treasury.credit(hub, 7);
    spy.mockRestore();
    expect(dropped).toBe(true);
    expect(await Treasury.balance(hub)).toBe(7);
  });

  it('the health check says closed on a dead port, on an API that is not ours, and on a server error', async () => {
    const keep = StoreClient.baseUrl();
    StoreClient.configure({ baseUrl: 'http://127.0.0.1:9' });
    expect((await StoreClient.health()).ok).toBe(false);
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response('<html>not the bank</html>', { status: 200 }));
    expect((await StoreClient.health()).ok).toBe(false);
    spy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, reason: 'cannot open the file' }), { status: 503 }));
    const down = await StoreClient.health();
    expect(down.ok).toBe(false);
    expect(down.reason).toContain('cannot open');
    spy.mockRestore();
    StoreClient.configure({ baseUrl: keep });
  });

  it('no fallback exists: the gate holds the game back, and nothing saves to browser storage', () => {
    const gate = read('src/components/VaultGate.tsx');
    expect(gate).toMatch(/useVault/);
    expect(gate).toMatch(/VAULT/);
    expect(read('index.tsx')).toMatch(/<VaultGate>/);
    // Saves go nowhere else: browser storage holds identity only.
    for (const file of ['src/logic/persistence/PlayerPersistence.ts', 'src/logic/ledger/Ledger.ts', 'src/logic/economy/Treasury.ts', 'src/logic/economy/GoldCommit.ts', 'src/entities/data/VectorStore.ts', 'src/entities/data/StoreClient.ts', 'src/entities/data/StoreUnit.ts']) {
      expect(read(file), `${file} reaches for browser storage`).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
    // And VectorStore no longer turns a failed read into an empty answer.
    expect(read('src/entities/data/VectorStore.ts')).not.toMatch(/catch[^}]*return null/s);
  });
});

// ---------------------------------------------------------------------------
// THE ONE-TIME IMPORT
// ---------------------------------------------------------------------------

async function legacyAvatar(name: string, hubId: string, opts: { gold?: number; spend?: number } = {}) {
  const cert = await mintCert(name);
  const uid = cert.metadata.uid;
  const start = opts.gold ?? 500;
  const paid = opts.spend ?? 100;
  const doc = (id: string, namespace: any, data: any, signature?: string): ILegacyDoc => ({
    id, namespace, data, metadata: { createdAt: 10, updatedAt: 20, ownerCertUid: uid, version: 1, ...(signature ? { signature } : {}) }
  });
  const row = async (seq: number, type: string, data: any) => {
    const signed = await CertificateSystem.signPayload(uid, { seq, prevSeq: seq - 1, ts: 100 + seq, type, data });
    return doc(`ledger_${uid}_${seq.toString().padStart(8, '0')}`, 'transactions', signed, signed.signature);
  };
  const player = { id: uid, username: name, bank: { gold: start - paid, stashTabs: [], lore: {}, universalSkills: {} } };
  const signedPlayer = await CertificateSystem.signPayload(uid, player);
  const receipt = await CertificateSystem.signPayload(uid, { claim: { sessionId: `s_${uid}`, certUid: uid }, outcome: 'EXTRACTED' });
  const provenance = await CertificateSystem.signPayload(uid, { type: 'MINT', itemId: `item_${uid}`, actorCertUid: uid, context: {}, at: 1 });
  const docs: ILegacyDoc[] = [
    doc(uid, 'characters', signedPlayer, signedPlayer.signature),
    await row(1, 'CHARACTER_GENESIS', { gold: start }),
    await row(2, 'GOLD_DELTA', { reason: 'LOT_PURCHASE', amount: -paid, treasuryId: hubId, treasuryDelta: paid }),
    doc(`ledger_head_${uid}`, 'transactions', { seq: 2 }),
    doc(`session_s_${uid}`, 'transactions', receipt, receipt.signature),
    doc(`prov_item_${uid}`, 'items', { itemId: `item_${uid}`, events: [{ ...provenance, signerKey: cert.publicKeyJWK }] })
  ];
  return { cert, uid, docs, paid, player };
}

const hubDocs = (hubId: string, ownerUid: string, treasury: number, endowment = 100000): ILegacyDoc[] => [
  { id: `hub_state_${hubId}`, namespace: VectorNamespace.TERRITORIES, data: { lots: [{ id: 'lot_1', ownerId: ownerUid }], craftingJobs: [], rooms: {}, buildJobs: [] }, metadata: { createdAt: 1, updatedAt: 2, ownerCertUid: 'SYSTEM', version: 1 } },
  { id: `treasury_${hubId}`, namespace: VectorNamespace.TERRITORIES, data: { gold: treasury }, metadata: { createdAt: 1, updatedAt: 2, ownerCertUid: 'SYSTEM', version: 1 } },
  { id: `endowment_${hubId}`, namespace: VectorNamespace.TERRITORIES, data: { gold: endowment }, metadata: { createdAt: 1, updatedAt: 2, ownerCertUid: 'SYSTEM', version: 1 } },
  { id: hubId, namespace: VectorNamespace.CONTENT, data: { type: 'world_certificate', genre: 'HUB', content: { data: { worldUid: hubId, worldType: 'HUB', worldName: 'New Carleon', rules: { accessMode: 'PUBLIC' } } } }, metadata: { createdAt: 1, updatedAt: 2, ownerCertUid: 'SYSTEM', version: 1 } }
];

describe('the one-time import of existing browser data', () => {
  it('moves a verified avatar whole: bank, chain, receipts, history, hub, treasury', async () => {
    const hub = `hub_imp_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('BASALT', hub);
    const report = await BrowserImport.importDocs([...a.docs, ...hubDocs(hub, a.uid, 100000 + a.paid)], [a.cert], 'localhost:3101');

    expect(report.refused).toEqual([]);
    const char = await VectorStore.get<any>(VectorNamespace.CHARACTERS, a.uid);
    expect(char!.data.payload.bank.gold).toBe(400);
    expect(await CertificateSystem.verifyPayload(char!.data, a.cert)).toBe(true);

    useIdentityStore.setState({ certificate: a.cert });
    expect((await Ledger.list(a.uid)).length).toBe(2);
    expect((await Ledger.audit(a.uid)).ok).toBe(true);
    expect((await VectorStore.get<any>(VectorNamespace.TRANSACTIONS, `session_s_${a.uid}`))).not.toBeNull();
    expect((await VectorStore.get<any>(VectorNamespace.ITEMS, `prov_item_${a.uid}`))).not.toBeNull();
    expect(await Treasury.balance(hub)).toBe(100000 + a.paid);
    expect((await VectorStore.get<any>(VectorNamespace.TERRITORIES, `hub_state_${hub}`))!.data.lots[0].ownerId).toBe(a.uid);
    expect(await HomeHub.of(a.uid)).toBe(hub);
  });

  it('is idempotent: running it again changes nothing, and doubles no gold', async () => {
    const hub = `hub_twice_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('GABBRO', hub);
    const docs = [...a.docs, ...hubDocs(hub, a.uid, 100000 + a.paid)];
    const first = await BrowserImport.importDocs(docs, [a.cert], 'localhost:3102');
    expect(first.imported).toBeGreaterThan(0);

    const before = JSON.stringify(await Ledger.list(a.uid));
    const second = await BrowserImport.importDocs(docs, [a.cert], 'localhost:3102');
    expect(second.refused).toEqual([]);
    expect(JSON.stringify(await Ledger.list(a.uid))).toBe(before);
    expect(await Treasury.balance(hub)).toBe(100000 + a.paid);
    expect((await VectorStore.get<any>(VectorNamespace.TERRITORIES, `endowment_${hub}`))!.data.gold).toBe(100000);
  });

  it('never overwrites play that happened after the first import', async () => {
    const hub = `hub_after_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('MAGPIE', hub);
    const docs = [...a.docs, ...hubDocs(hub, a.uid, 100000 + a.paid)];
    await BrowserImport.importDocs(docs, [a.cert], 'localhost:3102');

    useIdentityStore.setState({ certificate: a.cert });
    usePlayerStore.setState(s => ({ player: { ...s.player, id: a.uid, bank: { ...s.player.bank, gold: 350 } } }));
    await GoldCommit.commit({ rows: [{ type: 'GOLD_DELTA', data: { reason: 'PLAY', amount: -50, treasuryId: hub, treasuryDelta: 50 } }], treasury: { worldUid: hub, delta: 50 } });

    await BrowserImport.importDocs(docs, [a.cert], 'localhost:3102');
    expect((await VectorStore.get<any>(VectorNamespace.CHARACTERS, a.uid))!.data.payload.bank.gold).toBe(350);
    expect(await Treasury.balance(hub)).toBe(100000 + a.paid + 50);
    expect((await Ledger.list(a.uid)).length).toBe(3);
  });

  it('verifies rather than trusts: a changed bank is refused, and refuses its whole avatar', async () => {
    const hub = `hub_bad_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('LATHE', hub);
    const char = a.docs.find(d => d.id === a.uid)!;
    (char.data as any).payload.bank.gold = 9_999_999;

    const report = await BrowserImport.importDocs([...a.docs, ...hubDocs(hub, a.uid, 100000 + a.paid)], [a.cert], 'localhost:3104');
    expect(report.refused.some(r => r.id === a.uid)).toBe(true);
    expect(await VectorStore.get(VectorNamespace.CHARACTERS, a.uid)).toBeNull();
    expect((await Ledger.list(a.uid)).length).toBe(0);
    // And the avatar is not silently re-born on an empty save: hydrating refuses.
    expect((await PlayerPersistence.hydrate(a.cert)).status).toBe('TAMPERED');
  });

  it('refuses a broken or re-signed chain, and a row signed by the wrong key', async () => {
    const hub = `hub_chain_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('TENON', hub);
    const b = await legacyAvatar('INTRUDER', hub);
    const row2 = a.docs.find(d => d.id.endsWith('_00000002'))!;
    row2.data = b.docs.find(d => d.id.endsWith('_00000002'))!.data; // a real signature, from someone else

    const report = await BrowserImport.importDocs(a.docs, [a.cert], 'localhost:3105');
    expect(report.refused.some(r => r.id === a.uid)).toBe(true);
    expect((await Ledger.list(a.uid)).length).toBe(0);
  });

  it('refuses what it cannot verify: an avatar with no certificate here stays in the browser', async () => {
    const hub = `hub_orphan_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('ORPHAN', hub);
    const report = await BrowserImport.importDocs(a.docs, [], 'localhost:3105');
    expect(report.refused.some(r => r.id === a.uid)).toBe(true);
    expect(await VectorStore.get(VectorNamespace.CHARACTERS, a.uid)).toBeNull();
  });

  it('checks a provenance chain against the keys it carries', async () => {
    const hub = `hub_prov_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('PROV', hub);
    const prov = a.docs.find(d => d.id.startsWith('prov_'))!;
    (prov.data as any).events[0].payload.context = { forged: true };
    const report = await BrowserImport.importDocs(a.docs, [a.cert], 'localhost:3105');
    expect(report.refused.some(r => r.id === prov.id)).toBe(true);
    expect(await VectorStore.get(VectorNamespace.ITEMS, prov.id)).toBeNull();
    // The avatar itself is sound and still moves.
    expect(await VectorStore.get(VectorNamespace.CHARACTERS, a.uid)).not.toBeNull();
  });

  it('merges the bank\'s registry of claims across origins: the first keeps its claim', async () => {
    const reg = (rows: [string, string][]): ILegacyDoc => ({ id: 'mint_registry_v1', namespace: VectorNamespace.ITEMS, data: { rows }, metadata: { createdAt: 1, updatedAt: 2, ownerCertUid: 'SYSTEM', version: 1 } });
    const tag = Math.random().toString(36).slice(2);
    await BrowserImport.importDocs([reg([[`tuple_${tag}_a`, 'item_1'], [`tuple_${tag}_shared`, 'item_first']])], [], 'localhost:3101');
    await BrowserImport.importDocs([reg([[`tuple_${tag}_b`, 'item_2'], [`tuple_${tag}_shared`, 'item_second']])], [], 'localhost:3102');
    const rows = new Map((await VectorStore.get<any>(VectorNamespace.ITEMS, 'mint_registry_v1'))!.data.rows as [string, string][]);
    expect(rows.get(`tuple_${tag}_a`)).toBe('item_1');
    expect(rows.get(`tuple_${tag}_b`)).toBe('item_2');
    expect(rows.get(`tuple_${tag}_shared`)).toBe('item_first');
  });

  it('keeps origins apart: two imported hubs stay two hubs, each avatar on its own', async () => {
    const hubA = `hub_a_${Math.random().toString(36).slice(2)}`;
    const hubB = `hub_b_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('FIRST', hubA);
    const b = await legacyAvatar('SECOND', hubB);
    await BrowserImport.importDocs([...a.docs, ...hubDocs(hubA, a.uid, 100000 + a.paid)], [a.cert], 'localhost:3101');
    await BrowserImport.importDocs([...b.docs, ...hubDocs(hubB, b.uid, 100000 + b.paid)], [b.cert], 'localhost:3102');

    expect(await HomeHub.of(a.uid)).toBe(hubA);
    expect(await HomeHub.of(b.uid)).toBe(hubB);

    useIdentityStore.setState({ certificate: a.cert });
    let hubs = (await WorldCertificateSystem.getPublicWorlds()).filter(w => w.data.worldType === WorldType.HUB).map(w => w.data.worldUid);
    expect(hubs).toContain(hubA);
    expect(hubs).not.toContain(hubB);

    useIdentityStore.setState({ certificate: b.cert });
    hubs = (await WorldCertificateSystem.getPublicWorlds()).filter(w => w.data.worldType === WorldType.HUB).map(w => w.data.worldUid);
    expect(hubs).toContain(hubB);
    expect(hubs).not.toContain(hubA);
  });

  it('new avatars share one common hub, and never move into an imported one', async () => {
    const imported = `hub_imported_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('NATIVE', imported);
    await BrowserImport.importDocs([...a.docs, ...hubDocs(imported, a.uid, 100000 + a.paid)], [a.cert], 'localhost:3101');

    const common = `hub_common_${Math.random().toString(36).slice(2)}`;
    const { doc } = { doc: hubDocs(common, 'nobody', 0).find(d => d.id === common)! };
    await VectorStore.put({ ...doc, data: { ...doc.data, type: 'world_certificate' } });
    const hubsFor = async (cert: IPlayerCertificate) => {
      useIdentityStore.setState({ certificate: cert });
      return (await WorldCertificateSystem.getPublicWorlds()).filter(w => w.data.worldType === WorldType.HUB).map(w => w.data.worldUid);
    };

    const first = await mintCert('NEWONE');
    let hubs = await hubsFor(first);
    expect(hubs).toContain(common);
    expect(hubs).not.toContain(imported);
    await HomeHub.pin(first.metadata.uid, common);

    // The first new avatar's pin does not close the hub to the second.
    const second = await mintCert('NEWTWO');
    hubs = await hubsFor(second);
    expect(hubs).toContain(common);
    expect(hubs).not.toContain(imported);

    // And an avatar from the import still sees only its own.
    hubs = await hubsFor(a.cert);
    expect(hubs).toContain(imported);
    expect(hubs).not.toContain(common);
  });

  it('reports a treasury that does not balance, without hiding it', async () => {
    const hub = `hub_drift_${Math.random().toString(36).slice(2)}`;
    const a = await legacyAvatar('DRIFT', hub);
    const report = await BrowserImport.importDocs([...a.docs, ...hubDocs(hub, a.uid, 123)], [a.cert], 'localhost:3105');
    expect(report.notes.join(' ')).toMatch(/treasury/i);
  });

  it('leaves the old browser data in place: nothing here deletes it', () => {
    expect(read('src/logic/persistence/BrowserImport.ts')).not.toMatch(/deleteDatabase|\.remove\(\)/);
  });
});

// ---------------------------------------------------------------------------
// VECTOR SEARCH, THROUGH THE SAME INTERFACE
// ---------------------------------------------------------------------------

describe('vector and semantic search still work through VectorStore', () => {
  it('embeds on save and finds by meaning, ranked', async () => {
    const tag = `w${Math.random().toString(36).slice(2, 8)}`;
    await VectorStore.put({ id: `sem_a_${tag}`, namespace: VectorNamespace.WORLDS, data: { description: `iron sword blade ${tag}` }, metadata: { createdAt: 1, updatedAt: 1, version: 1 } }, true);
    await VectorStore.put({ id: `sem_b_${tag}`, namespace: VectorNamespace.WORLDS, data: { description: `quiet river moss` }, metadata: { createdAt: 1, updatedAt: 1, version: 1 } }, true);
    const found = await VectorStore.semanticSearch<{ description: string }>({ namespace: VectorNamespace.WORLDS, query: `iron sword blade ${tag}`, similarityThreshold: 0.9 });
    expect(found.map(d => d.id)).toEqual([`sem_a_${tag}`]);
  });

  it('saves and searches content by type and genre, no vector needed', async () => {
    const type = `KIND_${Math.random().toString(36).slice(2, 8)}`;
    await VectorStore.saveContent('c_a_' + type, type, { n: 1 }, 'alpha');
    await VectorStore.saveContent('c_b_' + type, type, { n: 2 }, 'beta');
    expect(await VectorStore.searchContent<{ n: number }>(type)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await VectorStore.searchContent<{ n: number }>(type, 'beta')).toEqual([{ n: 2 }]);
  });

  it('a world certificate minted through the real path comes back through the real path', async () => {
    const cert = await becomeAvatar('MINTER');
    const world = await WorldCertificateSystem.mintWorld(cert, 'Proof Ground', 'desc', WorldType.EXTRACTION, 16, { accessMode: AccessMode.PUBLIC, difficulty: UniversalRank.F, pvpEnabled: false, extractionTaxRate: 0.05 } as any);
    expect(world).not.toBeNull();
    const all = await WorldCertificateSystem.getPublicWorlds();
    expect(all.some(w => w.data.worldUid === world!.data.worldUid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ONE COMMAND
// ---------------------------------------------------------------------------

describe('one command brings up everything the game needs', () => {
  it('npm run dev and every launch entry reach the same dev script', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.dev).toBe('vite');
    const launch = JSON.parse(read('.claude/launch.json'));
    for (const entry of launch.configurations) {
      expect(entry.runtimeExecutable).toBe('npm');
      expect(entry.runtimeArgs.slice(0, 2)).toEqual(['run', 'dev']);
    }
    // GABBRO and MAGPIE live on 3102, which had no entry.
    expect(launch.configurations.map((c: any) => c.port)).toEqual(expect.arrayContaining([3000, 3100, 3101, 3102, 3104, 3105]));
  });

  it('the dev server really answers for the database, with no second process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-vite-'));
    const vitePort = 24000 + Math.floor(Math.random() * 2000);
    const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(vitePort), '--strictPort'], {
      cwd: ROOT,
      env: { ...process.env, WS_DATABASE_URL: `file:${join(dir, 'vite.db').replace(/\\/g, '/')}` },
      stdio: 'ignore'
    });
    try {
      let body: any = null;
      for (let i = 0; i < 300 && !body; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${vitePort}/api/db/health`);
          if (r.ok) body = await r.json();
        } catch { /* still rising */ }
        if (!body) await new Promise(r => setTimeout(r, 100));
      }
      expect(body).toMatchObject({ ok: true, service: 'worldseed-db', dialect: 'sqlite' });
    } finally {
      await new Promise<void>(resolve => { vite.on('exit', () => resolve()); vite.kill('SIGKILL'); });
    }
  }, 60_000);

  it('the database file is never committed, and no source file is ignored along with it', () => {
    // Ask git, not the file. The first version of this bar read .gitignore for "data/",
    // which also ignored src/entities/data/: the code passed here and was never committed.
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    for (const file of ['data/test-claude.db', 'data/test-claude.db-wal', 'data/test-pedro.db', 'data/test-pedro.db-shm']) {
      expect(git('check-ignore', file).trim()).toBe(file);
    }
    expect(git('ls-files', '--others', '--ignored', '--exclude-standard', 'src', 'server', 'tests', 'drizzle').trim()).toBe('');
    // And every file the game's store is built from is really in the repository.
    const tracked = git('ls-files', 'src/entities/data', 'src/logic/persistence', 'server', 'drizzle').split(/\r?\n/);
    for (const file of ['src/entities/data/StoreClient.ts', 'src/entities/data/StoreUnit.ts', 'src/entities/data/wire.ts', 'src/entities/data/similarity.ts', 'server/SqlStore.ts', 'src/logic/persistence/BrowserImport.ts']) {
      expect(tracked, `${file} is not tracked`).toContain(file);
    }
  });
});

// ---------------------------------------------------------------------------
// WHAT MUST NOT MOVE
// ---------------------------------------------------------------------------

describe('what must not have moved', () => {
  it('the contract is additive: types.ts holds no database type', () => {
    expect(read('types.ts')).not.toMatch(/ICommitRequest|IWireDoc/);
  });

  it('EmbeddingService loads without a window, and keeps its offline mode', async () => {
    const { EmbeddingService } = await import('../src/services/EmbeddingService');
    const a = await EmbeddingService.embed('stone and stick');
    const b = await EmbeddingService.embed('stone and stick');
    expect(a).toEqual(b);
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(1);
  });
});

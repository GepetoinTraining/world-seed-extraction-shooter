/**
 * THE RECORD, the game's half (D133). Nothing mocks the store: a real server process holds
 * a real folder, the game's own client signs real rows, and the real network driver writes
 * them down to a stand-in for Turso in its own process. Then the folder is thrown away and a
 * new one comes up from the record, and the game's own audits read it. A real signature
 * crossing both stores and still verifying is the point.
 *
 * It has not met Turso: see tests/fixtures/record-double.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CertificateSystem, IPlayerCertificate } from '../src/entities/identity/certificateSystem';
import { VectorNamespace, VectorStore } from '../src/entities/data/VectorStore';
import { StoreClient } from '../src/entities/data/StoreClient';
import { useIdentityStore } from '../src/entities/identity/store';
import { usePlayerStore } from '../src/entities/player/store';
import { Ledger } from '../src/logic/ledger/Ledger';
import { Treasury } from '../src/logic/economy/Treasury';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { GoldCommit } from '../src/logic/economy/GoldCommit';
import { PlayerPersistence } from '../src/logic/persistence/PlayerPersistence';
import { gatesGoneDown } from '../src/logic/systems/RecordDoor';

const ROOT = process.cwd();
const TSX = ['--disable-warning=ExperimentalWarning', '--import', 'tsx'];
const GRANT = 1_000_000;
const HUB = 'hub_record';

const keys = new Map<string, CryptoKey>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let dir = '';
let doubleChild: ChildProcess | null = null;
let recordUrl = '';
let server: ChildProcess | null = null;
let port = 0;

async function startDouble() {
  const doublePort = 45000 + Math.floor(Math.random() * 5000);
  doubleChild = spawn(process.execPath, [...TSX, 'tests/fixtures/record-double.ts', join(dir, 'record.sqlite'), String(doublePort)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>(resolve => doubleChild!.stdout!.on('data', b => { if (String(b).includes('READY')) resolve(); }));
  recordUrl = `http://127.0.0.1:${doublePort}`;
}

async function startServer(folder: string) {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, WS_DATABASE_URL: `pglite://${join(dir, folder).replace(/\\/g, '/')}`, WS_PORT: String(port), WS_NO_STATIC: '1', WS_RECORD: '1', TURSO_DATABASE_URL: recordUrl, TURSO_AUTH_TOKEN: '' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 600; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/db/health`)).ok) return; } catch { /* still rising */ }
    await sleep(50);
  }
  throw new Error('the server never answered');
}

async function stopHard() {
  const c = server;
  server = null;
  if (c) await new Promise<void>(resolve => { c.on('exit', () => resolve()); c.kill('SIGKILL'); });
}

const askWriteDown = async (why: string) => (await fetch(`http://127.0.0.1:${port}/api/db/record`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ why }) })).json() as Promise<any>;

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

beforeAll(async () => {
  vi.spyOn(CertificateSystem, 'getPrivateKey').mockImplementation(async uid => keys.get(uid) ?? null);
  dir = mkdtempSync(join(tmpdir(), 'ws-record-game-'));
  port = 22000 + Math.floor(Math.random() * 3000);
  await startDouble();
  await startServer('first');
  StoreClient.configure({ baseUrl: `http://127.0.0.1:${port}`, retryMs: 50 });
}, 120_000);

afterAll(async () => {
  await stopHard();
  if (doubleChild) await new Promise<void>(resolve => { doubleChild!.on('exit', () => resolve()); doubleChild!.kill('SIGKILL'); });
  vi.restoreAllMocks();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS */ }
});

describe('a real avatar, across both stores', () => {
  it('goes up, its folder is thrown away, and it comes back whole with its signatures good', async () => {
    const cert = await mintCert('LEDGE');
    const uid = cert.metadata.uid;
    localStorage.setItem('worldseed_certificate', JSON.stringify(cert));
    useIdentityStore.setState({ certificate: cert });
    usePlayerStore.setState(s => ({ player: { ...s.player, id: uid, username: 'LEDGE naïve 🐉 "q"', bank: { ...s.player.bank, gold: GRANT } } }));
    await GoldCommit.commit({ rows: [{ type: 'CHARACTER_GENESIS', data: { certUid: uid, gold: GRANT } }] });

    let spent = 0;
    const spend = async (n: number) => {
      usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - n } } }));
      spent += n;
      const seq = await GoldCommit.commit({
        rows: [{ type: 'GOLD_DELTA', data: { reason: 'RECORD', amount: -n, treasuryId: HUB, treasuryDelta: n } }],
        treasury: { worldUid: HUB, delta: n },
        hubDoc: { id: `hub_state_${HUB}`, namespace: VectorNamespace.TERRITORIES, data: { spent, body: 'hub'.repeat(350_000) }, metadata: { createdAt: 1, updatedAt: spent, version: 1 } }
      });
      expect(seq).not.toBeNull();
    };
    for (let i = 0; i < 5; i++) await spend(7);

    const first = await askWriteDown('gate');
    expect(first.status).toBe('WRITTEN');
    expect((await StoreClient.health()).record).toMatchObject({ state: 'READY', behind: 0 });

    // More play, then a hard stop with it not yet written down: it is on Postgres, and only there.
    for (let i = 0; i < 3; i++) await spend(5);
    expect((await StoreClient.health()).record!.behind).toBeGreaterThan(0);
    await stopHard();

    // Same folder: nothing lost. It goes up at the next downtime.
    await startServer('first');
    expect((await Ledger.list(uid)).length).toBe(9);
    const second = await askWriteDown('maintenance');
    expect(second.status).toBe('WRITTEN');
    await stopHard();

    // A new folder, as on a new machine. Everything comes up from the record.
    await startServer('second');
    const comeUp = (await StoreClient.health()).record;
    expect(comeUp, JSON.stringify(comeUp)).toMatchObject({ state: 'READY', behind: 0 });
    const hydrated = await PlayerPersistence.hydrate(cert);
    expect(hydrated.status).toBe('OK');
    if (hydrated.status === 'OK') {
      expect(hydrated.player.bank.gold).toBe(GRANT - spent);
      expect(hydrated.player.username).toBe('LEDGE naïve 🐉 "q"');
    }
    expect(await Ledger.audit(uid)).toEqual({ ok: true, rows: 9 });
    const audit = await GoldAudit.run();
    expect(audit.notes).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(await Treasury.balance(HUB)).toBe(spent);
    const hub = await VectorStore.get<any>(VectorNamespace.TERRITORIES, `hub_state_${HUB}`);
    expect(hub!.data.spent).toBe(spent);

    // And play goes on from there, onto the same chain.
    await spend(1);
    expect(await Ledger.audit(uid)).toEqual({ ok: true, rows: 10 });

    // The books added up on the record agree with the game's own.
    const job = await (await fetch(`http://127.0.0.1:${port}/api/db/maintain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json() as any;
    expect(job.record.status).toBe('WRITTEN');
    expect(job.record.audit.ok).toBe(true);
    expect(job.record.audit.report.treasury.held).toBe(audit.actualTreasuryTotal + 1);
  }, 300_000);
});

describe('a gate going down is a downtime', () => {
  it('says so once, when an open gate is next seen shut, and not for one first seen shut', () => {
    const seen = new Map<string, string>();
    expect(gatesGoneDown([{ id: 'a', phase: 'UP' }, { id: 'b', phase: 'OFF' }], seen)).toEqual([]);
    expect(gatesGoneDown([{ id: 'a', phase: 'UP' }, { id: 'b', phase: 'OFF' }], seen)).toEqual([]);
    expect(gatesGoneDown([{ id: 'a', phase: 'OFF' }, { id: 'b', phase: 'SCAN' }], seen)).toEqual(['a']);
    expect(gatesGoneDown([{ id: 'a', phase: 'OFF' }, { id: 'b', phase: 'UP' }], seen)).toEqual([]);
    expect(gatesGoneDown([{ id: 'a', phase: 'SCAN' }, { id: 'b', phase: 'OFF' }], seen)).toEqual(['b']);
  });
});

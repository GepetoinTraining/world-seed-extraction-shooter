/**
 * THE FOLDER: Postgres on disk, the game's own client against a real server.
 *
 * Nothing here mocks the store. A real server process holds a real PGlite folder
 * and is really killed, with commits in flight, carrying a whole hub document.
 * Afterwards the two audits the game itself runs are read: the ledger's and the
 * gold's. A commit the server acknowledged must be there, whole, after every kill.
 *
 * WS_FOLDER_ROUNDS asks for more kills than the bar's usual six.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { CertificateSystem, IPlayerCertificate } from '../src/entities/identity/certificateSystem';
import { VectorNamespace, VectorStore } from '../shared/entities/data/VectorStore';
import { StoreClient } from '../shared/entities/data/StoreClient';
import { useIdentityStore } from '../src/entities/identity/store';
import { usePlayerStore } from '../src/entities/player/store';
import { Ledger } from '../src/logic/ledger/Ledger';
import { Treasury } from '../src/logic/economy/Treasury';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { GoldCommit } from '../src/logic/economy/GoldCommit';

const ROOT = process.cwd();
const ROUNDS = Number(process.env.WS_FOLDER_ROUNDS ?? 6);
const GRANT = 1_000_000;
const STEP = 10;
const HUB = 'hub_folder';

const keys = new Map<string, CryptoKey>();
let child: ChildProcess | null = null;
let dir = '';
let url = '';
let port = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function startServer(): Promise<number> {
  const began = performance.now();
  child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, WS_DATABASE_URL: url, WS_PORT: String(port), WS_NO_STATIC: '1' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 600; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/db/health`)).ok) return performance.now() - began; } catch { /* still rising */ }
    await sleep(50);
  }
  throw new Error('the server never answered');
}

async function killServer() {
  const c = child;
  child = null;
  if (!c) return;
  await new Promise<void>(resolve => { c.on('exit', () => resolve()); c.kill('SIGKILL'); });
}

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
  dir = mkdtempSync(join(tmpdir(), 'ws-folder-'));
  url = `pglite://${join(dir, 'game').replace(/\\/g, '/')}`;
  port = 26000 + Math.floor(Math.random() * 3000);
  await startServer();
  StoreClient.configure({ baseUrl: `http://127.0.0.1:${port}`, retryMs: 50 });
}, 120_000);

afterAll(async () => {
  await killServer();
  vi.restoreAllMocks();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS */ }
});

describe('a folder, a real server, and hard stops in the middle of writes', () => {
  it('loses no acknowledged commit, and both audits read clean after every stop', async () => {
    const cert = await mintCert('KILN');
    const uid = cert.metadata.uid;
    localStorage.setItem('worldseed_certificate', JSON.stringify(cert));
    useIdentityStore.setState({ certificate: cert });
    usePlayerStore.setState(s => ({ player: { ...s.player, id: uid, username: 'KILN', bank: { ...s.player.bank, gold: GRANT } } }));
    await GoldCommit.commit({ player: usePlayerStore.getState().player, rows: [{ type: 'CHARACTER_GENESIS', data: { certUid: uid, gold: GRANT } }] });

    let acknowledged = 0;
    let lastHub = '';
    const reopenings: number[] = [];

    const oneCommit = () => {
      const n = acknowledged + 1;
      usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - STEP } } }));
      // About a megabyte, rewritten whole: what a hub save does today.
      const data = { save: n, body: 'hub'.repeat(350_000) };
      lastHub = sha(JSON.stringify(data));
      return GoldCommit.commit({
        player: usePlayerStore.getState().player,
        rows: [{ type: 'GOLD_DELTA', data: { reason: 'FOLDER', amount: -STEP, treasuryId: HUB, treasuryDelta: STEP } }],
        treasury: { worldUid: HUB, delta: STEP },
        hubDoc: { id: `hub_state_${HUB}`, namespace: VectorNamespace.TERRITORIES, data, metadata: { createdAt: 1, updatedAt: n, version: 1 } }
      });
    };

    for (let round = 0; round < ROUNDS; round++) {
      // A stretch of whole commits, then one left in flight when the kill lands.
      const until = Date.now() + 150 + Math.random() * 800;
      while (Date.now() < until) {
        const seq = await oneCommit();
        expect(seq).not.toBeNull();
        acknowledged++;
      }
      const inFlight = oneCommit();
      await sleep(Math.random() * 40);
      await killServer();

      const rowsPromised = acknowledged;
      reopenings.push(await startServer());

      // The kill may have landed before or after that last commit reached the disk.
      // Either way every acknowledged row is there, and the client's retry lands it once.
      expect((await Ledger.list(uid)).length - 1).toBeGreaterThanOrEqual(rowsPromised);
      expect(await inFlight).not.toBeNull();
      acknowledged++;

      expect((await Ledger.list(uid)).length).toBe(acknowledged + 1);
      expect(await Ledger.audit(uid)).toEqual({ ok: true, rows: acknowledged + 1 });
      const audit = await GoldAudit.run(usePlayerStore.getState().player);
      expect(audit.notes).toEqual([]);
      expect(audit.ok).toBe(true);
      expect(audit.actualPlayerGold).toBe(GRANT - acknowledged * STEP);
      expect(await Treasury.balance(HUB)).toBe(acknowledged * STEP);
      const hub = await VectorStore.get<any>(VectorNamespace.TERRITORIES, `hub_state_${HUB}`);
      expect(sha(JSON.stringify(hub!.data))).toBe(lastHub);
    }

    console.log(`[folder] ${ROUNDS} hard stops, ${acknowledged} commits acknowledged and found; reopening after a stop: ${reopenings.map(ms => ms.toFixed(0)).join(', ')} ms`);
  }, 600_000);
});

// @vitest-environment node
/**
 * THE HUB, deployed (DEPLOY.md). It holds accounts and checks receipts; it runs nobody's play.
 * These bars stand on a store in memory and on characters whose keys are made here the way the
 * browser makes them, signing the same text (`signedText`), so a row the game signs is a row the
 * hub can check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, SqlStore } from '../server/SqlStore';
import { Hub } from '../server/hub/Hub';
import { makeHubKey, verifyStatement } from '../server/hub/keys';
import { createHubHandler } from '../server/hub/http';
import { createHubListener } from '../server/hub/server';
import { createHubBridge } from '../server/runner';
import { signedText } from '../src/entities/identity/signedText';
import { addressOf, dayIndexOf } from '../src/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../src/logic/ledger/chainLaw';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');

/** A character as the browser makes one: an RSA key, a certificate naming it, rows signed over `signedText`. */
async function makeCharacter(uid: string) {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async <T>(payload: T, timestamp = Date.now()) => ({
    payload,
    signature: b64(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))),
    certUid: uid,
    timestamp
  });
  const certificate = { metadata: { uid, displayName: 'TESTER', createdAt: 1 }, publicKeyJWK };
  let seq = 0;
  const row = (type = 'GOLD_DELTA', data: Record<string, unknown> = { amount: 5 }) => {
    seq++;
    return sign({ seq, prevSeq: seq - 1, ts: 1_000 + seq, type, data });
  };
  /** A row in the newer form (D135): its moment's address, and the link to the row before it. */
  let lastSignature: string | null = null;
  const linked = async (ts: number, data: Record<string, unknown> = { amount: 5 }) => {
    seq++;
    const prev = lastSignature ? await linkOf(lastSignature) : null;
    const signed = await sign({ seq, prevSeq: seq - 1, ts, type: 'GOLD_DELTA', data, v: ROW_VERSION, prev, clock: { ...addressOf(ts), by: 'machine' } }, ts);
    lastSignature = signed.signature;
    return signed;
  };
  return { uid, certificate, sign, row, linked };
}

describe('the hub', () => {
  let store: SqlStore;
  let hub: Hub;
  let clock: number;
  const key = makeHubKey();

  beforeEach(async () => {
    store = await openStore('pglite://memory');
    clock = 1_800_000_000_000;
    hub = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
  });
  afterEach(async () => { await store.close(); });

  const signedIn = async (handle = 'tester', password = 'correct horse battery') => {
    expect((await hub.createAccount(handle, password)).ok).toBe(true);
    const session = await hub.signIn(handle, password);
    if (!session.ok) throw new Error(session.reason);
    return session.token;
  };

  const registered = async (token: string, uid = 'ws_aaaaaaaa_x1_bbbbbbbb') => {
    const character = await makeCharacter(uid);
    const nonce = await hub.nonce(token);
    if (!nonce.ok) throw new Error(nonce.reason);
    const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce });
    const out = await hub.registerCharacter(token, character.certificate, proof);
    return { character, out };
  };

  describe('accounts', () => {
    it('an account is made once, and a handle is the same handle in any case', async () => {
      expect(await hub.createAccount('Tester', 'correct horse battery')).toMatchObject({ ok: true, account: { handle: 'Tester' } });
      expect(await hub.createAccount('tester', 'another long password')).toMatchObject({ ok: false, status: 409 });
      expect(await hub.createAccount('TESTER', 'another long password')).toMatchObject({ ok: false, status: 409 });
    });

    it('a handle with no letters, or a password too short to stand, is refused with a reason', async () => {
      expect(await hub.createAccount('  ', 'correct horse battery')).toMatchObject({ ok: false, status: 400 });
      expect(await hub.createAccount('has space', 'correct horse battery')).toMatchObject({ ok: false, status: 400 });
      const short = await hub.createAccount('tester', 'short');
      expect(short).toMatchObject({ ok: false, status: 400 });
      expect(short.ok ? '' : short.reason).toMatch(/password/i);
    });

    it('a password is never kept as written', async () => {
      await hub.createAccount('tester', 'correct horse battery');
      const docs = await store.query({ namespace: 'hub' });
      expect(docs.length).toBeGreaterThan(0);
      for (const d of docs) expect(d.dataText).not.toContain('correct horse battery');
    });

    it('signing in answers a token that names the account; a wrong password or an unknown handle answers nothing', async () => {
      const token = await signedIn();
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(await hub.session(token)).toMatchObject({ handle: 'tester' });
      expect(await hub.signIn('tester', 'wrong password here')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.signIn('nobody', 'correct horse battery')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.session('not-a-token')).toBeNull();
    });

    it('a token is never kept as written either', async () => {
      const token = await signedIn();
      for (const d of await store.query({ namespace: 'hub' })) {
        expect(d.dataText).not.toContain(token);
        expect(d.id).not.toContain(token);
      }
    });

    it('signing out ends the session', async () => {
      const token = await signedIn();
      await hub.signOut(token);
      expect(await hub.session(token)).toBeNull();
    });

    it('after repeated wrong passwords a handle waits, even for the right one, and then signs in', async () => {
      await hub.createAccount('tester', 'correct horse battery');
      for (let i = 0; i < 5; i++) await hub.signIn('tester', `wrong ${i} attempt`);
      const held = await hub.signIn('tester', 'correct horse battery');
      expect(held).toMatchObject({ ok: false, status: 429 });
      clock += 60 * 60_000;
      expect((await hub.signIn('tester', 'correct horse battery')).ok).toBe(true);
    });
  });

  describe('characters', () => {
    it('a character is registered with a proof its own key signed, and the statement verifies with the hub\'s key', async () => {
      const token = await signedIn();
      const { out } = await registered(token);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(verifyStatement(key.publicKeyPem, out.issued.text, out.issued.signature)).toBe(true);
      const said = JSON.parse(out.issued.text);
      expect(said).toMatchObject({ kind: 'worldseed-hub-character', hub: key.id, issuer: 'https://hub.test', uid: 'ws_aaaaaaaa_x1_bbbbbbbb', account: 'tester', at: clock });
      expect(verifyStatement(key.publicKeyPem, out.issued.text.replace('tester', 'someone'), out.issued.signature)).toBe(false);
      expect(await hub.characters(token)).toMatchObject({ ok: true, characters: [{ uid: 'ws_aaaaaaaa_x1_bbbbbbbb', held: 0, standing: 'GOOD' }] });
    });

    it('another account cannot take a character that is held', async () => {
      const first = await signedIn('first');
      const { character } = await registered(first);
      const second = await signedIn('second');
      const nonce = await hub.nonce(second);
      if (!nonce.ok) throw new Error(nonce.reason);
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce });
      expect(await hub.registerCharacter(second, character.certificate, proof)).toMatchObject({ ok: false, status: 409 });
    });

    it('a proof signed by another key, over a nonce that was not given, or given twice, is refused', async () => {
      const token = await signedIn();
      const character = await makeCharacter('ws_cccccccc_x1_dddddddd');
      const other = await makeCharacter('ws_cccccccc_x1_dddddddd');

      const n1 = await hub.nonce(token);
      if (!n1.ok) throw new Error(n1.reason);
      expect(await hub.registerCharacter(token, character.certificate, await other.sign({ claim: 'hub-character', hub: key.id, nonce: n1.nonce }))).toMatchObject({ ok: false, status: 400 });

      expect(await hub.registerCharacter(token, character.certificate, await character.sign({ claim: 'hub-character', hub: key.id, nonce: 'made-up' }))).toMatchObject({ ok: false, status: 400 });

      const n2 = await hub.nonce(token);
      if (!n2.ok) throw new Error(n2.reason);
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: n2.nonce });
      expect((await hub.registerCharacter(token, character.certificate, proof)).ok).toBe(true);
      const again = await makeCharacter('ws_eeeeeeee_x1_ffffffff');
      expect(await hub.registerCharacter(token, again.certificate, await again.sign({ claim: 'hub-character', hub: key.id, nonce: n2.nonce }))).toMatchObject({ ok: false, status: 400 });
    });

    it('a nonce one account was given does not serve another', async () => {
      const first = await signedIn('first');
      const second = await signedIn('second');
      const character = await makeCharacter('ws_cccccccc_x1_dddddddd');
      const nonce = await hub.nonce(first);
      if (!nonce.ok) throw new Error(nonce.reason);
      expect(await hub.registerCharacter(second, character.certificate, await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }))).toMatchObject({ ok: false, status: 400 });
    });
  });

  describe('receipts', () => {
    it('signed rows are checked and held, and the acknowledgement names the seq and the head, signed with the hub\'s time', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const rows = [await character.row('CHARACTER_GENESIS', {}), await character.row(), await character.row()];
      const out = await hub.checkReceipts(token, character.uid, rows);
      expect(out).toMatchObject({ ok: true, held: 3, standing: 'GOOD' });
      if (!out.ok) return;
      expect(verifyStatement(key.publicKeyPem, out.ack.text, out.ack.signature)).toBe(true);
      expect(JSON.parse(out.ack.text)).toMatchObject({ kind: 'worldseed-hub-receipt', hub: key.id, uid: character.uid, seq: 3, at: clock });
      expect(JSON.parse(out.ack.text).head).toMatch(/^[0-9a-f]{64}$/);
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 3, standing: 'GOOD', head: JSON.parse(out.ack.text).head });
    });

    it('sending the same rows again holds nothing twice, and more rows go on from the head', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const first = [await character.row(), await character.row()];
      await hub.checkReceipts(token, character.uid, first);
      const more = [await character.row()];
      expect(await hub.checkReceipts(token, character.uid, [...first, ...more])).toMatchObject({ ok: true, held: 3 });
      expect(await hub.checkReceipts(token, character.uid, first)).toMatchObject({ ok: true, held: 3 });
    });

    it('a row with a bad signature is refused, and nothing in its batch is held', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const good = await character.row();
      const bad = await character.row();
      bad.payload.data = { amount: 5000 };
      expect(await hub.checkReceipts(token, character.uid, [good, bad])).toMatchObject({ ok: false, status: 400 });
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 0 });
    });

    it('a row signed by another key is refused', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const stranger = await makeCharacter(character.uid);
      expect(await hub.checkReceipts(token, character.uid, [await stranger.row()])).toMatchObject({ ok: false, status: 400 });
    });

    it('a gap is refused, and says where the hub stands', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      await character.row();
      const out = await hub.checkReceipts(token, character.uid, [await character.row()]);
      expect(out).toMatchObject({ ok: false, status: 409, held: 0 });
    });

    it('a rewritten row at a held seq is a challenge: the first chain stands, and the standing says so', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const one = await character.row();
      const two = await character.row();
      await hub.checkReceipts(token, character.uid, [one, two]);

      // The same key signs a different row two: the person rewrote their own history.
      const rewritten = await character.sign({ ...two.payload, data: { amount: 9999 } });
      const out = await hub.checkReceipts(token, character.uid, [one, rewritten]);
      expect(out).toMatchObject({ ok: false, status: 409, challenge: { seq: 2 }, standing: 'CHALLENGED' });

      const record = await hub.record(token, character.uid);
      expect(record).toMatchObject({ ok: true, held: 2, standing: 'CHALLENGED' });
      const heldTwo = await store.get(`ledger_${character.uid}_00000002`);
      expect(JSON.parse(heldTwo!.dataText).payload.data).toEqual({ amount: 5 });
    });

    it('receipts for a character another account holds are refused', async () => {
      const first = await signedIn('first');
      const { character } = await registered(first);
      const second = await signedIn('second');
      expect(await hub.checkReceipts(second, character.uid, [await character.row()])).toMatchObject({ ok: false, status: 403 });
      expect(await hub.record(second, character.uid)).toMatchObject({ ok: false, status: 403 });
    });

    it('nothing is asked of a signed-out caller', async () => {
      expect(await hub.nonce('not-a-token')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.characters('not-a-token')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.checkReceipts('not-a-token', 'ws_x', [])).toMatchObject({ ok: false, status: 401 });
    });
  });

  describe('time (D135)', () => {
    it('the hub states its own time as the clock\'s address, signed', () => {
      const said = hub.clock();
      expect(verifyStatement(key.publicKeyPem, said.text, said.signature)).toBe(true);
      expect(JSON.parse(said.text)).toEqual({ kind: 'worldseed-hub-clock', hub: key.id, issuer: 'https://hub.test', at: clock, day: dayIndexOf(clock), address: addressOf(clock) });
    });

    it('rows in the newer form go on from the row the hub holds, each linked to the last', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const first = [await character.linked(clock - 3 * 86_400_000), await character.linked(clock - 2 * 86_400_000)];
      expect(await hub.checkReceipts(token, character.uid, first)).toMatchObject({ ok: true, held: 2 });
      expect(await hub.checkReceipts(token, character.uid, [first[1], await character.linked(clock - 60_000)])).toMatchObject({ ok: true, held: 3 });
    });

    it('a row from a day the hub has not reached is refused, and nothing in its batch is held', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const today = await character.linked(clock - 60_000);
      const tomorrow = await character.linked(clock + 86_400_000);
      const out = await hub.checkReceipts(token, character.uid, [today, tomorrow]);
      expect(out).toMatchObject({ ok: false, status: 400 });
      expect(out.reason).toMatch(/day/);
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 0 });
    });

    it('a row whose moment does not match its own time is refused', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const ts = clock - 86_400_000;
      const lying = await character.sign({ seq: 1, prevSeq: 0, ts, type: 'GOLD_DELTA', data: {}, v: ROW_VERSION, prev: null, clock: { ...addressOf(clock - 9 * 86_400_000), by: 'machine' } }, ts);
      expect(await hub.checkReceipts(token, character.uid, [lying])).toMatchObject({ ok: false, status: 400 });
    });

    it('a row that names another row before it than the one the hub holds is a challenge: the history under the head was written over', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const one = await character.linked(clock - 5 * 60_000);
      await hub.checkReceipts(token, character.uid, [one]);
      const strayTwo = await character.sign({ seq: 2, prevSeq: 1, ts: clock - 60_000, type: 'GOLD_DELTA', data: {}, v: ROW_VERSION, prev: await linkOf('another row one'), clock: { ...addressOf(clock - 60_000), by: 'machine' } }, clock - 60_000);
      expect(await hub.checkReceipts(token, character.uid, [strayTwo])).toMatchObject({ ok: false, status: 409, standing: 'CHALLENGED', challenge: { seq: 2 } });
      expect(await hub.record(token, character.uid)).toMatchObject({ held: 1, standing: 'CHALLENGED' });
    });
  });

  describe('over HTTP', () => {
    let server: Server | undefined;
    let landing: string | undefined;
    afterEach(async () => {
      await new Promise<void>(r => (server ? server.close(() => r()) : r()));
      server = undefined;
      if (landing) rmSync(landing, { recursive: true, force: true });
      landing = undefined;
    });

    const listen = async () => {
      landing = mkdtempSync(join(tmpdir(), 'ws-landing-'));
      writeFileSync(join(landing, 'index.html'), '<!DOCTYPE html><title>World Seed</title><p>landing</p>');
      server = createServer(createHubListener({ api: createHubHandler(hub), landingDir: landing }));
      await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
      return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    };

    const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    it('the hub says what it is and whose key it signs with', async () => {
      const base = await listen();
      const health = await (await fetch(`${base}/api/hub/health`)).json();
      expect(health).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { id: key.id, publicKeyPem: key.publicKeyPem } });
      const time = await (await fetch(`${base}/api/hub/clock`)).json();
      expect(time.ok).toBe(true);
      expect(verifyStatement(key.publicKeyPem, time.statement.text, time.statement.signature)).toBe(true);
    });

    it('a POST that is not JSON is refused, and a signed-in route without a token is 401', async () => {
      const base = await listen();
      const form = await fetch(`${base}/api/hub/accounts`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"handle":"a","password":"b"}' });
      expect(form.status).toBe(415);
      expect((await fetch(`${base}/api/hub/session`)).status).toBe(401);
      expect((await post(`${base}/api/hub/characters/nonce`, {})).status).toBe(401);
    });

    it('an account, a session, a character and its receipts, all over the wire', async () => {
      const base = await listen();
      expect((await post(`${base}/api/hub/accounts`, { handle: 'wire', password: 'correct horse battery' })).status).toBe(200);
      const { token } = await (await post(`${base}/api/hub/sessions`, { handle: 'wire', password: 'correct horse battery' })).json();
      const auth = { Authorization: `Bearer ${token}` };
      expect(await (await fetch(`${base}/api/hub/session`, { headers: auth })).json()).toMatchObject({ ok: true, account: { handle: 'wire' } });

      const character = await makeCharacter('ws_11111111_x1_22222222');
      const { nonce } = await (await post(`${base}/api/hub/characters/nonce`, {}, auth)).json();
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce });
      expect((await post(`${base}/api/hub/characters`, { certificate: character.certificate, proof }, auth)).status).toBe(200);
      const receipt = await (await post(`${base}/api/hub/receipts`, { uid: character.uid, rows: [await character.row()] }, auth)).json();
      expect(receipt).toMatchObject({ ok: true, held: 1 });
      expect(await (await fetch(`${base}/api/hub/record/${character.uid}`, { headers: auth })).json()).toMatchObject({ ok: true, held: 1 });

      expect((await post(`${base}/api/hub/session/end`, {}, auth)).status).toBe(200);
      expect((await fetch(`${base}/api/hub/session`, { headers: auth })).status).toBe(401);
    });

    it('the deployed server serves the landing page and the hub, and nothing of play', async () => {
      const base = await listen();
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toMatch(/text\/html/);
      expect(await page.text()).toContain('landing');
      for (const path of ['/api/db/health', '/api/intelligence/status', '/api/db/commit']) {
        expect((await fetch(`${base}${path}`)).status).toBe(404);
      }
      expect((await fetch(`${base}/../../package.json`)).status).not.toBe(200);
    });

    it('through the runner\'s bridge, the browser never holds the token: the runner does', async () => {
      const hubBase = await listen();
      const bridge = createHubBridge({ hubUrl: hubBase });
      const runner = createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path.startsWith('/api/hub')) return void bridge(req, res, path.slice('/api/hub'.length) || '/');
        res.statusCode = 404; res.end();
      });
      await new Promise<void>(r => runner.listen(0, '127.0.0.1', () => r()));
      const base = `http://127.0.0.1:${(runner.address() as AddressInfo).port}`;
      try {
        expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ configured: true, signedIn: null });
        expect((await post(`${base}/api/hub/accounts`, { handle: 'bridged', password: 'correct horse battery' })).status).toBe(200);
        const signIn = await post(`${base}/api/hub/sessions`, { handle: 'bridged', password: 'correct horse battery' });
        const said = await signIn.json();
        expect(said).toMatchObject({ ok: true, account: { handle: 'bridged' } });
        expect(said.token).toBeUndefined();
        expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ configured: true, signedIn: 'bridged' });
        expect(await (await fetch(`${base}/api/hub/session`)).json()).toMatchObject({ ok: true, account: { handle: 'bridged' } });
        expect((await post(`${base}/api/hub/session/end`, {})).status).toBe(200);
        expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ signedIn: null });
      } finally {
        await new Promise<void>(r => runner.close(() => r()));
      }
    });
  });
});

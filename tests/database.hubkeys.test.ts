// @vitest-environment node
/**
 * THE ACCOUNT IS THE ROOT OF A CHARACTER'S KEYS (server/hub/Hub.ts, bringCharacter). Pedro,
 * 2026-11-18: "the account takes precedence, so when someone logs in again we need to serve them the
 * data we have", and of a key per browser: "sure, but the central node of the keys must be the
 * account, what we then do is allow the person to export character from their idb to ours for
 * changing where they'll play".
 *
 * A character's key is made in a browser and never leaves it. The hub keeps the character itself
 * with its receipts, and a browser signed in to the account takes the character over with a key of
 * its own. These bars stand on the hub itself over a store in memory, with characters signed the
 * way a browser signs them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { openBody, type IBody } from '../server/hub/body';
import { Hub } from '../server/hub/Hub';
import { makeHubKey } from '../server/hub/keys';
import { Eraser } from '../server/hub/erase';
import { signedText } from '../shared/entities/identity/signedText';
import { addressOf } from '../shared/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../shared/logic/ledger/chainLaw';
import { sha256Hex } from '../shared/logic/ledger/sha256';
import { CertificateSystem, type IPlayerCertificate } from '../src/entities/identity/certificateSystem';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const START = 1_800_000_000_000;
let NOW = START;
let turn = 0;

/** A key as a browser makes one, and what it signs. */
async function makeKey() {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async <T>(uid: string, payload: T, timestamp = NOW) => ({
    payload,
    signature: Buffer.from(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))).toString('base64'),
    certUid: uid,
    timestamp
  });
  return { jwk, sign, hash: sha256Hex(`${jwk.n}.${jwk.e}`) };
}
type Key = Awaited<ReturnType<typeof makeKey>>;

/** A character's chain, written row on row by whichever key holds it now. */
function chainOf(uid: string) {
  let seq = 0;
  let last: string | null = null;
  return {
    get seq() { return seq; },
    async row(key: Key, type: string, data: Record<string, unknown>) {
      seq++;
      const ts = NOW - 60_000 + seq;
      const signed = await key.sign(uid, { seq, prevSeq: seq - 1, ts, type, data, v: ROW_VERSION, prev: last ? await linkOf(last) : null, clock: { ...addressOf(ts), by: 'machine' } }, ts);
      last = signed.signature;
      return signed;
    }
  };
}

/** The character itself as a browser keeps it: its player doc, signed. */
const saveOf = (key: Key, uid: string, more: Record<string, unknown> = {}) => key.sign(uid, { id: uid, username: 'TESTER', bank: { gold: 5 }, ...more });

let body: IBody;
let hub: Hub;

async function account(name: string): Promise<string> {
  const handle = `${name}_${turn}`;
  await hub.createAccount(handle, 'a long enough password');
  const out = await hub.signIn(handle, 'a long enough password');
  if (!out.ok) throw new Error('The account could not sign in.');
  return (out as { token: string }).token;
}

async function proofOf(token: string, key: Key, uid: string, claim: string) {
  const nonce = (await hub.nonce(token) as { nonce: string }).nonce;
  return key.sign(uid, { claim, hub: hub.id, nonce });
}

/** A character born on the hub and played a little: registered, two rows held, its save sent with them. */
async function played(token: string, name = 'c') {
  const uid = `${name}_${turn}`;
  const key = await makeKey();
  const registered = await hub.registerCharacter(token, { metadata: { uid, displayName: 'TESTER', createdAt: 123 }, publicKeyJWK: key.jwk }, await proofOf(token, key, uid, 'hub-character')) as { ok: boolean; mint: string };
  expect(registered.ok).toBe(true);
  const chain = chainOf(uid);
  const rows = [await chain.row(key, 'CHARACTER_GENESIS', { certUid: uid, username: 'TESTER', gold: 0, mint: registered.mint }), await chain.row(key, 'GOLD_DELTA', { amount: 5 })];
  const save = await saveOf(key, uid);
  expect(await hub.checkReceipts(token, uid, rows, { save })).toMatchObject({ ok: true, held: 2, saved: 2 });
  return { uid, key, chain, rows, save, mint: registered.mint };
}

beforeAll(async () => {
  body = await openBody('pglite://memory', {}, { say: () => undefined });
  hub = new Hub(body.store, makeHubKey(), { publicUrl: 'https://hub.test', now: () => NOW });
}, 120_000);
afterAll(async () => { await body.store.close(); });
beforeEach(() => { turn++; NOW = START + turn * 86_400_000; });

describe('the character itself goes up with its receipts', () => {
  it('is kept as the save of the head the hub holds, and the account\'s list says so', async () => {
    const token = await account('alder');
    const { uid, key } = await played(token);
    expect(await hub.record(token, uid)).toMatchObject({ ok: true, held: 2, saved: 2, key: key.hash });
    expect((await hub.characters(token) as { characters: unknown[] }).characters).toMatchObject([{ uid, held: 2, saved: 2, key: key.hash }]);
  });

  it('rows sent with no save leave the save behind, and the next send brings it up', async () => {
    const token = await account('alder');
    const { uid, key, chain, rows } = await played(token);
    expect(await hub.checkReceipts(token, uid, [rows[1], await chain.row(key, 'GOLD_DELTA', { amount: 1 })])).toMatchObject({ ok: true, held: 3, saved: 2 });
    // Nothing new to send, and the save alone goes up
    const last = (await hub.rowsOf(token, uid, 3) as { rows: unknown[] }).rows;
    expect(await hub.checkReceipts(token, uid, last, { save: await saveOf(key, uid, { bank: { gold: 6 } }) })).toMatchObject({ ok: true, held: 3, saved: 3 });
  });

  it('passes over a save that is not this character\'s, or not signed by it, and the receipts stand', async () => {
    const token = await account('alder');
    const { uid, key, chain, rows } = await played(token);
    const other = await makeKey();
    const next = [rows[1], await chain.row(key, 'GOLD_DELTA', { amount: 1 })];
    // Signed by a key that is not the character's
    expect(await hub.checkReceipts(token, uid, next, { save: await saveOf(other, uid) })).toMatchObject({ ok: true, held: 3, saved: 2 });
    // The character's own key over another's doc, and a thing that is no doc at all
    expect(await hub.checkReceipts(token, uid, [next[1]], { save: await key.sign(uid, { id: 'someone_else' }) })).toMatchObject({ ok: true, saved: 2 });
    expect(await hub.checkReceipts(token, uid, [next[1]], { save: 'everything' })).toMatchObject({ ok: true, saved: 2 });
    expect(await hub.checkReceipts(token, uid, [next[1]], { save: { ...(await saveOf(key, uid)), signature: 'AAAA' } })).toMatchObject({ ok: true, saved: 2 });
  });

  it('goes with the account when the account is deleted', async () => {
    const token = await account('alder');
    const { uid } = await played(token);
    const who = (await hub.session(token))!;
    expect(await hub.store.get(`hub_character_save_${uid}`)).not.toBeNull();
    await new Eraser(hub, body.eraseHere, body.record).erase(who.key);
    expect(await hub.store.get(`hub_character_save_${uid}`)).toBeNull();
    expect(await hub.store.get(`hub_character_${uid}`)).toBeNull();
  });
});

describe('a browser signed in to the account takes the character over', () => {
  it('its own new key becomes the character\'s from the next row on, and it is handed the save, the keys before and the hub\'s word', async () => {
    const token = await account('alder');
    const { uid, key, save, mint } = await played(token);
    const fresh = await makeKey();
    const out = await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(token, fresh, uid, 'hub-character-key')) as any;
    expect(out).toMatchObject({ ok: true, uid, displayName: 'TESTER', createdAt: 123, held: 2, mint, save: { seq: 2 } });
    expect(out.save.doc).toEqual(save);
    expect(out.formerKeys).toEqual([{ kty: 'RSA', n: key.jwk.n, e: key.jwk.e }]);
    expect(JSON.parse(out.key.text)).toMatchObject({ kind: 'worldseed-hub-character-key', uid, publicKey: fresh.hash, was: key.hash, from: 3, issuer: 'https://hub.test' });
    expect(await hub.record(token, uid)).toMatchObject({ key: fresh.hash, held: 2 });
    // Its rows come down in order, as held
    expect((await hub.rowsOf(token, uid, 1) as { rows: { payload: { seq: number } }[]; next: number | null })).toMatchObject({ rows: [{ payload: { seq: 1 } }, { payload: { seq: 2 } }], next: null });
    expect((await hub.rowsOf(token, uid, 2) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('plays on from there: the new key\'s rows are held on the old key\'s, and the row the old key signed last still reads', async () => {
    const token = await account('alder');
    const { uid, chain, rows } = await played(token);
    const fresh = await makeKey();
    await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(token, fresh, uid, 'hub-character-key'));
    // The game sends from the last row the hub holds, which the key before signed
    const next = await chain.row(fresh, 'GOLD_DELTA', { amount: 2 });
    expect(await hub.checkReceipts(token, uid, [rows[1], next], { save: await saveOf(fresh, uid, { bank: { gold: 7 } }) })).toMatchObject({ ok: true, held: 3, saved: 3, standing: 'GOOD' });
  });

  it('the browser it was taken from is told so, and what it adds is not held', async () => {
    const token = await account('alder');
    const { uid, key, chain, rows } = await played(token);
    const fresh = await makeKey();
    await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(token, fresh, uid, 'hub-character-key'));
    const stale = await chain.row(key, 'GOLD_DELTA', { amount: 9 });
    const refused = await hub.checkReceipts(token, uid, [rows[1], stale]) as any;
    expect(refused).toMatchObject({ ok: false, status: 409, moved: true, held: 2, reason: expect.stringMatching(/another browser now/) });
    expect(await hub.record(token, uid)).toMatchObject({ held: 2, standing: 'GOOD' });
    // A key that was never the character's is still just a key that is not its own
    const stranger = await makeKey();
    const forged = await stranger.sign(uid, { ...stale.payload });
    expect(await hub.checkReceipts(token, uid, [forged])).toMatchObject({ ok: false, status: 400, reason: expect.stringMatching(/not signed by this character/) });
  });

  it('can be taken back, and each key signs only its own stretch', async () => {
    const token = await account('alder');
    const { uid, key, chain, rows } = await played(token);
    const second = await makeKey();
    await hub.bringCharacter(token, uid, second.jwk, await proofOf(token, second, uid, 'hub-character-key'));
    const third = await chain.row(second, 'GOLD_DELTA', { amount: 2 });
    await hub.checkReceipts(token, uid, [rows[1], third], { save: await saveOf(second, uid) });
    const back = await makeKey();
    const out = await hub.bringCharacter(token, uid, back.jwk, await proofOf(token, back, uid, 'hub-character-key')) as any;
    expect(out).toMatchObject({ ok: true, held: 3 });
    expect(out.formerKeys.map((k: { n: string; e: string }) => sha256Hex(`${k.n}.${k.e}`))).toEqual([key.hash, second.hash]);
    expect(JSON.parse(out.key.text)).toMatchObject({ from: 4, was: second.hash, publicKey: back.hash });
    const fourth = await chain.row(back, 'GOLD_DELTA', { amount: 1 });
    expect(await hub.checkReceipts(token, uid, [third, fourth], { save: await saveOf(back, uid) })).toMatchObject({ ok: true, held: 4, saved: 4 });
  });

  it('asked again with the key the character already signs with, changes nothing', async () => {
    const token = await account('alder');
    const { uid, key } = await played(token);
    const out = await hub.bringCharacter(token, uid, key.jwk, await proofOf(token, key, uid, 'hub-character-key')) as any;
    expect(out).toMatchObject({ ok: true, held: 2, key: null, formerKeys: [] });
    expect(await hub.record(token, uid)).toMatchObject({ key: key.hash });
  });

  it('is refused while the hub holds rows it has no save of: there is nothing to play on from', async () => {
    const token = await account('alder');
    const { uid, key, chain, rows } = await played(token);
    await hub.checkReceipts(token, uid, [rows[1], await chain.row(key, 'GOLD_DELTA', { amount: 1 })]);
    const fresh = await makeKey();
    const refused = await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(token, fresh, uid, 'hub-character-key')) as any;
    expect(refused).toMatchObject({ ok: false, status: 409, held: 3, saved: 2, reason: expect.stringMatching(/sends itself/) });
    expect(await hub.record(token, uid)).toMatchObject({ key: key.hash });
    expect((await hub.characters(token) as { characters: unknown[] }).characters).toMatchObject([{ held: 3, saved: 2 }]);
  });

  it('is the account\'s alone, and only for a key the browser proves it holds', async () => {
    const token = await account('alder');
    const { uid, key } = await played(token);
    const fresh = await makeKey();
    // Another account, even with a good proof of its own
    const other = await account('birch');
    expect(await hub.bringCharacter(other, uid, fresh.jwk, await proofOf(other, fresh, uid, 'hub-character-key'))).toMatchObject({ ok: false, status: 403 });
    // Nobody signed in
    expect(await hub.bringCharacter('not a token', uid, fresh.jwk, {})).toMatchObject({ ok: false, status: 401 });
    // A proof signed by another key than the one it names; one made for registering; one over a text of another account's
    expect(await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(token, key, uid, 'hub-character-key'))).toMatchObject({ ok: false, reason: expect.stringMatching(/not signed by the key it names/) });
    expect(await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(token, fresh, uid, 'hub-character'))).toMatchObject({ ok: false, reason: expect.stringMatching(/what it is for/) });
    expect(await hub.bringCharacter(token, uid, fresh.jwk, await proofOf(other, fresh, uid, 'hub-character-key'))).toMatchObject({ ok: false, reason: expect.stringMatching(/text this hub gave you/) });
    // A proof used once is used
    const proof = await proofOf(token, fresh, uid, 'hub-character-key');
    expect(await hub.bringCharacter(token, uid, fresh.jwk, proof)).toMatchObject({ ok: true });
    expect(await hub.bringCharacter(token, uid, fresh.jwk, proof)).toMatchObject({ ok: false, reason: expect.stringMatching(/used already/) });
    expect(await hub.record(token, uid)).toMatchObject({ key: fresh.hash });
  });
});

describe('in the browser, what an earlier key signed still reads', () => {
  it('a signature holds under the key the character signs with now, or one it signed with before, and no other', async () => {
    const old = await makeKey();
    const now = await makeKey();
    const stranger = await makeKey();
    const cert = (publicKeyJWK: JsonWebKey, formerKeys?: JsonWebKey[]) => ({ metadata: { uid: 'c1' }, publicKeyJWK, ...(formerKeys ? { formerKeys } : {}) }) as unknown as IPlayerCertificate;
    const byOld = await old.sign('c1', { said: 'then' });
    const byNow = await now.sign('c1', { said: 'now' });
    expect(await CertificateSystem.verifyPayload(byNow, cert(now.jwk, [old.jwk]))).toBe(true);
    expect(await CertificateSystem.verifyPayload(byOld, cert(now.jwk, [old.jwk]))).toBe(true);
    expect(await CertificateSystem.verifyPayload(byOld, cert(now.jwk))).toBe(false);
    expect(await CertificateSystem.verifyPayload(await stranger.sign('c1', { said: 'then' }), cert(now.jwk, [old.jwk]))).toBe(false);
    // What was signed is still what must be read
    expect(await CertificateSystem.verifyPayload({ ...byOld, payload: { said: 'something else' } }, cert(now.jwk, [old.jwk]))).toBe(false);
  });

  it('a key made here signs before it is written anywhere, and its certificate reads', async () => {
    const pair = await CertificateSystem.makeKeyPair();
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const signed = await CertificateSystem.signWith(pair.privateKey, 'c1', { claim: 'hub-character-key' });
    expect(signed.certUid).toBe('c1');
    expect(await CertificateSystem.verifyPayload(signed, { metadata: { uid: 'c1' }, publicKeyJWK: jwk } as unknown as IPlayerCertificate)).toBe(true);
    const pem = await CertificateSystem.selfSigned({ uid: 'c1', displayName: 'TESTER', birthData: { coordinates: { latitude: 0, longitude: 0, accuracy: 0 }, timestamp: 1, entropy: '', userAgent: '' }, createdAt: 1, version: '1.0.0' }, pair);
    expect(pem).toMatch(/^-----BEGIN WORLDSEED CERTIFICATE-----/);
  });
});

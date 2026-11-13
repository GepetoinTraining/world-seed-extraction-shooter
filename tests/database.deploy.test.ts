// @vitest-environment node
/**
 * THE HUB, AS IT IS DEPLOYED (DEPLOY.md, HUB_WIRING.md). What stands between the hub a single
 * process ran and one a function host runs as several instances, with accounts by e-mail:
 *
 *   - Clerk's word is read with a key and no call (clerk.ts), and a signed-in person gets this
 *     hub's own session;
 *   - a character's first row names the mint this hub gave it;
 *   - an account's data is taken out, here and on the record;
 *   - two instances share one world: its events in one order, a chest's first claim the only one,
 *     where players stand, and a line of people waiting to talk;
 *   - the whole of it behind one handler, whichever way the host hands over the address.
 *
 * These bars stand on real HTTP servers and sockets over stores in memory. Clerk and Turso are
 * stood in for: a key pair made here signs what Clerk would, and the record's double answers as
 * Turso does (tests/fixtures/record-double.ts).
 *
 * The hub's store has two bodies, and what a host runs is held on both: Postgres, with the record
 * written down to Turso, and Turso alone, with no Postgres anywhere (server/tursoStore.ts), its
 * instances hearing each other on a beat (server/live/tursoLive.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlStore } from '../shared/SqlStore';
import { oneWriterAtATime, openDatabase } from '../server/connection';
import type { IStore } from '../server/store';
import { openBody, type IBody } from '../server/hub/body';
import { tursoLines } from '../server/live/tursoLive';
import { openTursoStore } from '../server/tursoStore';
import { startDouble, type IDouble } from './fixtures/turso-double';
import { Hub, mintOf } from '../server/hub/Hub';
import { makeHubKey } from '../server/hub/keys';
import { createHubHandler } from '../server/hub/http';
import { hubPathOf } from '../server/hub/function';
import { appPathOf, createHubApp } from '../server/hub/app';
import { clerkConfigFrom, clerkFrontendHost, readClerkToken, readClerkWebhook, type IClerkConfig } from '../server/hub/clerk';
import { Eraser } from '../server/hub/erase';
import { LiveRoom, type LiveAccess } from '../server/live/room';
import { LocalWire, type ILiveBus } from '../server/live/bus';
import { memoryLines, tableLines, type ILineBook } from '../server/live/lines';
import { TalkLine, emptyLine } from '../shared/logic/live/TalkLine';
import { signedText } from '../shared/entities/identity/signedText';
import { addressOf } from '../shared/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../shared/logic/ledger/chainLaw';

const NOW = 1_800_000_000_000;
const until = async (check: () => boolean | Promise<boolean>, ms = 4000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('Waited and it did not come.');
    await new Promise(r => setTimeout(r, 10));
  }
};
const rest = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- Clerk, stood in for: a key pair that signs what Clerk would ------------------------------

const clerkKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const WEBHOOK_SECRET = Buffer.from('a secret both sides hold').toString('base64');
const PUBLISHABLE = `pk_test_${Buffer.from('clerk.hub.test$').toString('base64')}`;
const b64u = (value: object | Buffer) => (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url');

function clerkToken(claims: Record<string, unknown> = {}, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }, key = clerkKeys.privateKey) {
  const at = Math.floor(NOW / 1000);
  const body = { sub: 'user_2abcDEF123', azp: 'https://hub.test', iat: at, nbf: at - 5, exp: at + 60, handle: 'alder', ...claims };
  const text = `${b64u(header)}.${b64u(body)}`;
  return `${text}.${b64u(signBytes('RSA-SHA256', Buffer.from(text), key))}`;
}

const clerkEnv = (more: Record<string, string> = {}) => ({
  CLERK_JWT_KEY: clerkKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
  CLERK_WEBHOOK_SECRET: `whsec_${WEBHOOK_SECRET}`,
  CLERK_SECRET_KEY: 'sk_test_only_here',
  ...more
});
const clerkConfig = (more: Record<string, string> = {}) => clerkConfigFrom(clerkEnv(more), 'https://hub.test') as IClerkConfig;

function webhook(body: object, at = NOW, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(body);
  const id = 'msg_1';
  const stamp = String(Math.floor(at / 1000));
  const signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${id}.${stamp}.${raw}`).digest('base64');
  return { raw, headers: { 'svix-id': id, 'svix-timestamp': stamp, 'svix-signature': `v1,${signature}`, 'content-type': 'application/json' } };
}

// --- a character as the browser makes one -------------------------------------------------------

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

async function makeCharacter(uid: string) {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async <T>(payload: T, timestamp = NOW) => ({
    payload,
    signature: Buffer.from(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))).toString('base64'),
    certUid: uid,
    timestamp
  });
  let seq = 0;
  let last: string | null = null;
  const row = async (type: string, data: Record<string, unknown>, ts = NOW - 60_000 + seq) => {
    seq++;
    const signed = await sign({ seq, prevSeq: seq - 1, ts, type, data, v: ROW_VERSION, prev: last ? await linkOf(last) : null, clock: { ...addressOf(ts), by: 'machine' } }, ts);
    last = signed.signature;
    return signed;
  };
  return { uid, certificate: { metadata: { uid, displayName: 'TESTER', createdAt: 1 }, publicKeyJWK }, sign, row };
}

// --- the Turso stand-in, one for the file, emptied where a bar needs it ------------------------

let turso: IDouble;
beforeAll(async () => { turso = await startDouble(); }, 30_000);
afterAll(async () => { await turso?.stop(); });

/** The two bodies of the hub's store, as a host opens them (server/hub/body.ts). */
const BODIES: { name: string; url: () => Promise<string>; again: () => string; record: string }[] = [
  { name: 'Postgres', url: async () => 'pglite://memory', again: () => 'pglite://memory', record: 'NO_RECORD' },
  // `url` empties the stand-in; `again` is a second store on what stands
  { name: 'Turso alone', url: async () => { await turso.reset(); return turso.url; }, again: () => turso.url, record: 'IN_STORE' }
];

// --- a hub behind a real server -----------------------------------------------------------------

interface IStand { origin: string; server: Server; hub: Hub; store: IStore; body: IBody; eraser: Eraser; clerk: IClerkConfig; maintained: number; close: () => Promise<void> }

async function standHub(options: { env?: NodeJS.ProcessEnv; clerk?: IClerkConfig | null; url?: string } = {}): Promise<IStand> {
  const env = options.env ?? {};
  const body = await openBody(options.url ?? 'pglite://memory', env, { say: () => undefined });
  const { store } = body;
  const clerk = options.clerk === undefined ? clerkConfig() : options.clerk;
  const hub = new Hub(store, makeHubKey(), { publicUrl: 'https://hub.test', now: () => NOW, accounts: clerk ? 'clerk' : 'builtin' });
  const eraser = new Eraser(hub, body.eraseHere, body.record);
  const stand = { maintained: 0 } as IStand;
  const handler = createHubHandler(hub, { clerk, eraser, cronSecret: 'the-hosts-word', maintain: async () => { stand.maintained++; return { record: [await body.maintain()], erasuresWaiting: await eraser.sweep() }; } });
  const server = createServer((req, res) => void handler(req, res, hubPathOf(req.url)));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return Object.assign(stand, {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, hub, store, body, eraser, clerk: clerk as IClerkConfig,
    close: async () => { await new Promise<void>(r => server.close(() => r())); await store.close(); }
  });
}

/** A browser's side: it keeps the hub's cookie as a browser would. */
function visitor(origin: string) {
  let cookie = '';
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${origin}/api/hub${path}`, body === undefined
      ? { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  };
  return { call, get cookie() { return cookie; } };
}

async function signedInWithCharacter(stand: IStand, uid = 'ws_aaaaaaaa_x1_bbbbbbbb', claims: Record<string, unknown> = {}) {
  const me = visitor(stand.origin);
  expect((await me.call('/sessions/clerk', { token: clerkToken(claims) })).body).toMatchObject({ ok: true });
  const character = await makeCharacter(uid);
  const nonce = (await me.call('/characters/nonce', {})).body.nonce;
  const proof = await character.sign({ claim: 'hub-character', hub: stand.hub.id, nonce });
  const registered = (await me.call('/characters', { certificate: character.certificate, proof })).body;
  expect(registered).toMatchObject({ ok: true, uid });
  return { me, character, registered };
}

// ================================================================================================

describe('accounts by e-mail and password: what Clerk signs is read with a key and no call', () => {
  const config = clerkConfig();

  it('a token Clerk signed, in its time, from this hub\'s own page, names its account and its handle', () => {
    expect(readClerkToken(config, clerkToken(), NOW)).toEqual({ userId: 'user_2abcDEF123', handle: 'alder' });
    expect(readClerkToken(config, clerkToken({ handle: undefined }), NOW)).toEqual({ userId: 'user_2abcDEF123' });
  });

  it('anything else is refused with a reason: another key, another algorithm, run out, not yet, another site, no account', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const refused = (token: unknown, now = NOW) => readClerkToken(config, token, now);
    expect(refused(clerkToken({}, undefined, other))).toMatchObject({ problem: expect.stringMatching(/not signed/) });
    // A token that says how it should be checked is not believed: 'none', or the public key used as a shared secret
    expect(refused(`${b64u({ alg: 'none' })}.${b64u({ sub: 'user_x', azp: 'https://hub.test', exp: NOW })}.`)).toHaveProperty('problem');
    const hs = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'user_x', azp: 'https://hub.test', exp: Math.floor(NOW / 1000) + 60 })}`;
    expect(refused(`${hs}.${createHmac('sha256', clerkEnv().CLERK_JWT_KEY).update(hs).digest('base64url')}`)).toMatchObject({ problem: expect.stringMatching(/not signed the way/) });
    expect(refused(clerkToken(), NOW + 5 * 60_000)).toMatchObject({ problem: expect.stringMatching(/run out/) });
    expect(refused(clerkToken({ nbf: Math.floor(NOW / 1000) + 600 }))).toMatchObject({ problem: expect.stringMatching(/not good yet/) });
    expect(refused(clerkToken({ azp: 'https://elsewhere.test' }))).toMatchObject({ problem: expect.stringMatching(/not made for this hub/) });
    expect(refused(clerkToken({ azp: undefined }))).toMatchObject({ problem: expect.stringMatching(/not made for this hub/) });
    expect(refused(clerkToken({ sub: '../../etc' }))).toMatchObject({ problem: expect.stringMatching(/no account/) });
    expect(refused('not.a.token.at.all')).toHaveProperty('problem');
    expect(refused(undefined)).toHaveProperty('problem');
  });

  it('what Clerk sends is taken only if its sender signed these very bytes, lately', () => {
    const { raw, headers } = webhook({ type: 'user.deleted', data: { id: 'user_2abcDEF123' } });
    expect(readClerkWebhook(config, headers, raw, NOW)).toEqual({ type: 'user.deleted', data: { id: 'user_2abcDEF123' } });
    expect(readClerkWebhook(config, headers, raw.replace('user_2abcDEF123', 'user_someone_else'), NOW)).toMatchObject({ problem: expect.stringMatching(/not signed/) });
    expect(readClerkWebhook(config, headers, raw, NOW + 6 * 60_000)).toMatchObject({ problem: expect.stringMatching(/too long ago/) });
    expect(readClerkWebhook(config, webhook({ type: 'user.deleted', data: {} }, NOW, Buffer.from('another secret').toString('base64')).headers, raw, NOW)).toHaveProperty('problem');
    expect(readClerkWebhook(config, {}, raw, NOW)).toMatchObject({ problem: 'That is not signed.' });
    expect(readClerkWebhook(clerkConfig({ CLERK_WEBHOOK_SECRET: '' }), headers, raw, NOW)).toHaveProperty('problem');
  });

  it('a hub with no Clerk named keeps its own accounts; a key that does not read is said, never passed over', () => {
    expect(clerkConfigFrom({}, 'https://hub.test')).toBeNull();
    expect(clerkConfigFrom({ CLERK_JWT_KEY: 'not a key', CLERK_PUBLISHABLE_KEY: PUBLISHABLE }, 'https://hub.test')).toMatchObject({ problem: expect.stringMatching(/CLERK_JWT_KEY/) });
    expect(clerkConfigFrom({ CLERK_JWT_KEY: clerkEnv().CLERK_JWT_KEY }, 'https://hub.test')).toMatchObject({ problem: expect.stringMatching(/CLERK_PUBLISHABLE_KEY/) });
    // A key pasted into a host's settings with its line breaks written out still reads
    expect(clerkConfigFrom({ ...clerkEnv(), CLERK_JWT_KEY: clerkEnv().CLERK_JWT_KEY.replace(/\n/g, '\\n') }, 'https://hub.test')).toHaveProperty('publicKey');
    expect(clerkFrontendHost(PUBLISHABLE)).toBe('clerk.hub.test');
  });
});

describe.each(BODIES)('the hub we launch, its store on $name: signing in, a character\'s birth, and everything deleted', ({ url, again, record }) => {
  let stand: IStand;
  beforeEach(async () => { stand = await standHub({ url: await url() }); });
  afterEach(async () => { await stand.close(); });

  it('someone Clerk signed in gets this hub\'s own session in its cookie, and an account from that moment', async () => {
    const me = visitor(stand.origin);
    expect((await me.call('/where')).body).toMatchObject({ signedIn: null, accounts: 'clerk', clerk: { publishableKey: PUBLISHABLE } });
    const out = await me.call('/sessions/clerk', { token: clerkToken() });
    expect(out.body).toEqual({ ok: true, account: { handle: 'alder' } });
    expect(me.cookie).toMatch(/^ws_hub=/);
    expect((await me.call('/where')).body).toMatchObject({ signedIn: 'alder' });
    // The account is there though they have done nothing else, with no password and no e-mail in it
    const account = await stand.store.get('hub_account_clerk_user_2abcDEF123');
    expect(JSON.parse(account!.dataText)).toEqual({ type: 'hub_account', handle: 'alder', provider: 'clerk', createdAt: NOW });
    // A handle changed at Clerk is the handle here from the next sign-in
    expect((await visitor(stand.origin).call('/sessions/clerk', { token: clerkToken({ handle: 'alder_again' }) })).body).toMatchObject({ account: { handle: 'alder_again' } });
  });

  it('a token that does not read gets no session, and nobody makes an account or signs in here by handle', async () => {
    const me = visitor(stand.origin);
    expect(await me.call('/sessions/clerk', { token: clerkToken({ azp: 'https://elsewhere.test' }) })).toMatchObject({ status: 401, body: { ok: false } });
    expect(me.cookie).toBe('');
    expect(await me.call('/accounts', { handle: 'tester', password: 'correct horse battery' })).toMatchObject({ status: 403 });
    expect(await me.call('/sessions', { handle: 'tester', password: 'correct horse battery' })).toMatchObject({ status: 403 });
  });

  it('a hub that keeps its own accounts has no Clerk door, and says which it is', async () => {
    const own = await standHub({ clerk: null, url: again() });
    try {
      const me = visitor(own.origin);
      expect((await me.call('/where')).body).toMatchObject({ accounts: 'builtin' });
      expect((await me.call('/where')).body).not.toHaveProperty('clerk');
      expect(await me.call('/sessions/clerk', { token: clerkToken() })).toMatchObject({ status: 404 });
      expect((await me.call('/accounts', { handle: 'tester', password: 'correct horse battery' })).body).toMatchObject({ ok: true });
    } finally {
      await own.close();
    }
  });

  it('a character registered as it is made is given its mint, and a first row that names it is held as witnessed', async () => {
    const { me, character, registered } = await signedInWithCharacter(stand);
    expect(registered.mint).toBe(mintOf(registered.issued));
    expect(registered.mint).toMatch(/^[0-9a-f]{64}$/);

    const genesis = await character.row('CHARACTER_GENESIS', { certUid: character.uid, username: 'TESTER', gold: 0, mint: registered.mint });
    const sent = await me.call('/receipts', { uid: character.uid, rows: [genesis] });
    expect(sent.body).toMatchObject({ ok: true, held: 1 });
    expect((await me.call('/characters')).body.characters[0]).toMatchObject({ uid: character.uid, held: 1, born: 'WITNESSED', mint: registered.mint });
  });

  it('a first row that names another mint is refused whole; one that names none is held as claimed', async () => {
    const { me, character } = await signedInWithCharacter(stand);
    const forged = await character.row('CHARACTER_GENESIS', { certUid: character.uid, username: 'TESTER', gold: 0, mint: 'f'.repeat(64) });
    const refused = await me.call('/receipts', { uid: character.uid, rows: [forged] });
    expect(refused).toMatchObject({ status: 400, body: { ok: false, reason: expect.stringMatching(/names a mint this hub did not give/) } });
    expect((await me.call('/characters')).body.characters[0]).toMatchObject({ held: 0, born: null });

    const other = await signedInWithCharacter(stand, 'ws_cccccccc_x2_dddddddd', { sub: 'user_other', handle: 'birch' });
    const plain = await other.character.row('CHARACTER_GENESIS', { certUid: other.character.uid, username: 'TESTER', gold: 0 });
    expect((await other.me.call('/receipts', { uid: other.character.uid, rows: [plain] })).body).toMatchObject({ ok: true, held: 1 });
    expect((await other.me.call('/characters')).body.characters[0]).toMatchObject({ born: 'CLAIMED' });
  });

  it('what the hub holds of an account is shown in counts, and deleted only on its own handle', async () => {
    const { me, character, registered } = await signedInWithCharacter(stand);
    await me.call('/receipts', { uid: character.uid, rows: [await character.row('CHARACTER_GENESIS', { certUid: character.uid, username: 'TESTER', gold: 0, mint: registered.mint }), await character.row('GOLD_DELTA', { amount: 5 })] });
    expect((await me.call('/account')).body).toMatchObject({ ok: true, account: { handle: 'alder', since: NOW }, characters: [{ uid: character.uid, receipts: 2, standing: 'GOOD' }], people: 0, worlds: 0 });

    expect(await me.call('/account/delete', {})).toMatchObject({ status: 400 });
    expect(await me.call('/account/delete', { confirm: 'someone_else' })).toMatchObject({ status: 400 });
    expect((await me.call('/account')).body).toMatchObject({ ok: true });
    expect(await visitor(stand.origin).call('/account/delete', { confirm: 'alder' })).toMatchObject({ status: 401 });
  });

  it('deleting takes out the account, its sessions, its characters and every row, asks Clerk to delete the sign-in, and leaves everyone else whole', async () => {
    // Clerk's own API, stood in for: it is asked once, for this account, with the hub's key
    const asked: { method?: string; url?: string; auth?: string }[] = [];
    const clerkApi = createServer((req, res) => { asked.push({ method: req.method, url: req.url, auth: req.headers.authorization }); res.statusCode = 200; res.end('{}'); });
    await new Promise<void>(r => clerkApi.listen(0, '127.0.0.1', () => r()));
    stand.clerk.api = `http://127.0.0.1:${(clerkApi.address() as AddressInfo).port}`;

    const { me, character, registered } = await signedInWithCharacter(stand);
    await me.call('/receipts', { uid: character.uid, rows: [await character.row('CHARACTER_GENESIS', { certUid: character.uid, username: 'TESTER', gold: 0, mint: registered.mint }), await character.row('GOLD_DELTA', { amount: 5 })] });
    const other = await signedInWithCharacter(stand, 'ws_cccccccc_x2_dddddddd', { sub: 'user_other', handle: 'birch' });
    await other.me.call('/receipts', { uid: other.character.uid, rows: [await other.character.row('CHARACTER_GENESIS', { certUid: other.character.uid, username: 'TESTER', gold: 0 })] });

    const out = await me.call('/account/delete', { confirm: 'alder' });
    await new Promise<void>(r => clerkApi.close(() => r()));
    expect(out.body).toEqual({ ok: true, erased: { characters: 1, rows: 2, documents: 3, record: 'NONE' }, signIn: 'DELETED' });
    expect(asked).toEqual([{ method: 'DELETE', url: '/v1/users/user_2abcDEF123', auth: 'Bearer sk_test_only_here' }]);

    // Nothing of them is left, by any name they had here
    expect((await me.call('/where')).body).toMatchObject({ signedIn: null });
    const everything = [...await stand.store.query({ namespace: 'hub' }), ...await stand.store.query({ namespace: 'transactions' })];
    for (const d of everything) {
      expect(d.id).not.toContain(character.uid);
      expect(d.id).not.toContain('user_2abcDEF123');
      expect(d.dataText).not.toContain(character.uid);
      expect(d.dataText).not.toContain('user_2abcDEF123');
    }
    expect(await stand.store.get(`ledger_head_${character.uid}`)).toBeNull();
    // The other account, its character and its row stand as they were
    expect((await other.me.call('/account')).body).toMatchObject({ ok: true, account: { handle: 'birch' }, characters: [{ uid: other.character.uid, receipts: 1 }] });
    // Asked again, there is nothing to delete, and that is an answer
    expect(await stand.eraser.erase('clerk_user_2abcDEF123')).toEqual({ characters: 0, rows: 0, documents: 0, record: 'NONE' });
  });

  it('Clerk saying the account was deleted there takes it out here too; a word not signed takes nothing', async () => {
    const { me, character } = await signedInWithCharacter(stand);
    const { raw, headers } = webhook({ type: 'user.deleted', data: { id: 'user_2abcDEF123', deleted: true } });

    const forged = await fetch(`${stand.origin}/api/hub/clerk`, { method: 'POST', headers: { ...headers, 'svix-signature': 'v1,AAAA' }, body: raw });
    expect(forged.status).toBe(401);
    expect((await me.call('/where')).body).toMatchObject({ signedIn: 'alder' });

    const real = await fetch(`${stand.origin}/api/hub/clerk`, { method: 'POST', headers, body: raw });
    expect(await real.json()).toMatchObject({ ok: true, erased: { characters: 1, documents: 3 } });
    expect((await me.call('/where')).body).toMatchObject({ signedIn: null });
    expect(await stand.store.get(`hub_character_${character.uid}`)).toBeNull();

    // Any other word from Clerk is heard and changes nothing
    const created = webhook({ type: 'user.created', data: { id: 'user_new' } });
    expect((await fetch(`${stand.origin}/api/hub/clerk`, { method: 'POST', headers: created.headers, body: created.raw })).status).toBe(200);
    expect(await stand.store.get('hub_account_clerk_user_new')).toBeNull();
  });

  it('the scheduled call runs only on the host\'s own word', async () => {
    const me = visitor(stand.origin);
    expect((await me.call('/maintenance')).status).toBe(401);
    expect((await me.call('/maintenance', undefined, { Authorization: 'Bearer a-guess' })).status).toBe(401);
    expect(stand.maintained).toBe(0);
    expect(await me.call('/maintenance', undefined, { Authorization: 'Bearer the-hosts-word' })).toMatchObject({ status: 200, body: { ok: true, record: [record], erasuresWaiting: 0 } });
    expect(stand.maintained).toBe(1);
  });
});

// ================================================================================================
// THE RECORD FORGETS TOO
// ================================================================================================

describe('an account deleted here is deleted on the record', () => {
  const ROOT = process.cwd();
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ } } });

  let child: ChildProcess;
  let recordUrl: string;
  const recordSql = async (text: string) => {
    const res = await fetch(`${recordUrl}/__sql`, { method: 'POST', body: JSON.stringify({ sql: text, args: [] }) });
    return ((await res.json()) as any).rows.map((row: any[]) => row.map((c: any) => (c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value)));
  };
  const count = async (text: string) => Number((await recordSql(text))[0][0]);

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-deploy-'));
    dirs.push(dir);
    const port = 30000 + Math.floor(Math.random() * 15000);
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'tests/fixtures/record-double.ts', join(dir, 'record.sqlite'), String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', b => { if (String(b).includes('READY')) resolve(); });
      child.on('exit', code => reject(new Error(`The double stopped: ${code}`)));
    });
    child.removeAllListeners('exit');
    recordUrl = `http://127.0.0.1:${port}`;
  }, 30_000);
  afterEach(async () => {
    await new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); child.on('exit', () => resolve()); child.kill('SIGKILL'); });
  });

  it('its rows and documents go from the record, a write-down that lands late is caught at the next maintenance, and then nothing remembers it', async () => {
    const env = { WS_RECORD: '1', TURSO_DATABASE_URL: recordUrl };
    const stand = await standHub({ env });
    try {
      const { me, character, registered } = await signedInWithCharacter(stand);
      await me.call('/receipts', { uid: character.uid, rows: [await character.row('CHARACTER_GENESIS', { certUid: character.uid, username: 'TESTER', gold: 0, mint: registered.mint }), await character.row('GOLD_DELTA', { amount: 5 })] });
      const other = await signedInWithCharacter(stand, 'ws_cccccccc_x2_dddddddd', { sub: 'user_other', handle: 'birch' });
      await other.me.call('/receipts', { uid: other.character.uid, rows: [await other.character.row('CHARACTER_GENESIS', { certUid: other.character.uid, username: 'TESTER', gold: 0 })] });

      expect((await stand.store.writeDown('test')).status).toBe('WRITTEN');
      const theirs = `owner_uid = '${character.uid}'`;
      const account = `id = 'hub_account_clerk_user_2abcDEF123' OR id = 'hub_character_${character.uid}'`;
      expect(await count(`SELECT COUNT(*) FROM ledger_rows WHERE ${theirs}`)).toBe(2);
      expect(await count(`SELECT COUNT(*) FROM documents WHERE ${account}`)).toBe(2);

      expect(await stand.eraser.erase('clerk_user_2abcDEF123')).toMatchObject({ characters: 1, rows: 2, record: 'CLEARED' });
      expect(await count(`SELECT COUNT(*) FROM ledger_rows WHERE ${theirs}`)).toBe(0);
      expect(await count(`SELECT COUNT(*) FROM documents WHERE ${account}`)).toBe(0);
      expect(await count(`SELECT COUNT(*) FROM ledger_rows WHERE owner_uid = '${other.character.uid}'`)).toBe(1);
      // What the record keeps of the job is a count
      const job = (await recordSql(`SELECT report FROM cold_jobs WHERE name = 'erase' ORDER BY seq DESC LIMIT 1`))[0][0];
      expect(job).not.toContain(character.uid);
      expect(job).not.toContain('user_2abcDEF123');

      // A write-down that was on its way lands after: the rows are back on the record
      await recordSql(`INSERT INTO ledger_rows (id, owner_uid, seq, prev_seq, ts, type, signature, data, version, created_at, updated_at) VALUES ('ledger_${character.uid}_00000001', '${character.uid}', 1, 0, 1, 'GOLD_DELTA', 's', '{}', 1, 1, 1)`);
      const me2 = visitor(stand.origin);
      const first = await me2.call('/maintenance', undefined, { Authorization: 'Bearer the-hosts-word' });
      expect(first.body).toMatchObject({ ok: true, erasuresWaiting: 1 });
      expect(await count(`SELECT COUNT(*) FROM ledger_rows WHERE ${theirs}`)).toBe(0);
      // The next maintenance finds none of it, and the note that remembered the ids is itself deleted, here and there
      const second = await me2.call('/maintenance', undefined, { Authorization: 'Bearer the-hosts-word' });
      expect(second.body).toMatchObject({ ok: true, erasuresWaiting: 0 });
      expect(await stand.store.query({ namespace: 'hub', filter: { 'data.type': 'hub_erase' } })).toEqual([]);
      expect(await count(`SELECT COUNT(*) FROM documents WHERE doc_type = 'hub_erase'`)).toBe(0);
      expect(await count(`SELECT COUNT(*) FROM documents WHERE data LIKE '%${character.uid}%'`)).toBe(0);
      // And the record still takes what comes after: the chain of write-downs was not broken by it
      await other.me.call('/receipts', { uid: other.character.uid, rows: [await other.character.row('GOLD_DELTA', { amount: 1 })] });
      expect((await stand.store.writeDown('after')).status).toBe('WRITTEN');
      expect(await count(`SELECT COUNT(*) FROM ledger_rows WHERE owner_uid = '${other.character.uid}'`)).toBe(2);
    } finally {
      await stand.close();
    }
  }, 60_000);

  it('with the record out of reach the hub\'s own copy still goes, and the record is tried again at maintenance', async () => {
    const stand = await standHub({ env: { WS_RECORD: '1', TURSO_DATABASE_URL: 'http://127.0.0.1:9' } });
    try {
      const { character } = await signedInWithCharacter(stand);
      expect(await stand.eraser.erase('clerk_user_2abcDEF123')).toMatchObject({ characters: 1, record: 'WAITING' });
      expect(await stand.store.get(`hub_character_${character.uid}`)).toBeNull();
      expect((await stand.store.query({ namespace: 'hub', filter: { 'data.type': 'hub_erase' } })).length).toBe(1);
      expect(await stand.eraser.sweep()).toBe(1);
    } finally {
      await stand.close();
    }
  }, 60_000);
});

// ================================================================================================
// SEVERAL INSTANCES, ONE ROOM
// ================================================================================================

/**
 * What two instances share, per body. On Postgres: one database, and a wire for the nudge between them.
 * On Turso alone: two stores of their own on one database, each hearing the other on a beat read from
 * the table (tursoLive.ts), its timings shortened here so a bar takes moments.
 */
interface IInstances { parts: { store: IStore; bus: ILiveBus; lines: ILineBook }[]; close: () => Promise<void> }
const TWO_INSTANCES: { name: string; open: () => Promise<IInstances> }[] = [
  {
    name: 'Postgres, nudged between instances',
    open: async () => {
      const database = await openDatabase('pglite://memory');
      const store = new SqlStore(database);
      const wire = new LocalWire();
      // One store and one table of lines, as two instances have one database; each its own end of the wire
      const lines = await tableLines(database);
      return { parts: [0, 1].map(() => ({ store, bus: wire.join(), lines })), close: () => store.close() };
    }
  },
  {
    name: 'Turso alone, read on a beat',
    open: async () => {
      await turso.reset();
      const bodies = [await openBody(turso.url, {}), await openBody(turso.url, {})];
      const parts = [];
      for (const body of bodies) parts.push({ store: body.store, bus: await body.bus({ beatMs: 25, paceMs: 60, aliveMs: 400, staleMs: 1500 }), lines: await body.lines() });
      return { parts, close: async () => { for (const body of bodies) await body.store.close(); } };
    }
  }
];

describe.each(TWO_INSTANCES)('online play on two instances, $name: one world, one order, one line', ({ open: openInstances }) => {
  const WORLD = 'world_live_1';
  const doc = (id: string, data: unknown, at = 1) => ({ id, namespace: 'territories', dataText: JSON.stringify(data), metadata: { createdAt: at, updatedAt: at, version: 1 } });
  const access: LiveAccess = async (_token, uid) => (uid.startsWith('ws_') ? { ok: true, worldUid: WORLD } : { ok: false, status: 401, reason: 'Sign in to the hub first.' });

  let instances: IInstances;
  let sides: { room: LiveRoom; server: Server; origin: string }[];
  const open: WebSocket[] = [];

  function listen(side: number, uid: string) {
    const heard: any[] = [];
    const ws = new WebSocket(`${sides[side].origin.replace('http', 'ws')}/api/hub/live/socket?uid=${uid}`);
    open.push(ws);
    const opened = new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('refused')); });
    ws.onmessage = m => heard.push(JSON.parse(String(m.data)));
    const say = (message: object) => ws.send(JSON.stringify(message));
    return { ws, heard, opened, say, subscribe: (since: number | string = 0) => say({ subscribe: `world:${WORLD}`, since }) };
  }
  const post = (side: number, path: string, body: unknown, uid = 'ws_alder') =>
    fetch(`${sides[side].origin}/api/hub/live${path}?uid=${uid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const commit = (side: number, id: string, data: unknown, commitId: string) => post(side, '/commit', { commitId, ops: [{ kind: 'put', doc: doc(id, data) }] });
  const where = (place: string) => ({ where: { place, x: 1, z: 2, facing: 'down', moving: false, t: 10, name: 'Someone', archetype: 'NOMAD' } });

  beforeEach(async () => {
    instances = await openInstances();
    sides = [];
    for (let i = 0; i < 2; i++) {
      const { store, bus, lines } = instances.parts[i];
      const room = new LiveRoom(store, access, Date.now, { bus, lines, holdMs: 400, beatMs: 0 });
      const server = createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path.startsWith('/api/hub/live')) return void room.http(req, res, path.slice('/api/hub/live'.length), 't');
        res.statusCode = 404;
        res.end();
      });
      server.on('upgrade', (req, raw) => void room.upgrade(req, raw, 't'));
      await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
      sides.push({ room, server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    }
  });
  afterEach(async () => {
    for (const ws of open.splice(0)) { try { ws.close(); } catch { /* closed already */ } }
    for (const side of sides) { await side.room.close(); side.server.closeAllConnections(); await new Promise<void>(r => side.server.close(() => r())); }
    await instances.close();
  });

  it('what lands on one instance is told to a socket on the other, by number, and a first join may ask for none of what came before', async () => {
    await commit(0, `world_carts_${WORLD}`, { n: 0 }, 'before');
    const a = listen(0, 'ws_alder');
    const b = listen(1, 'ws_birch');
    await Promise.all([a.opened, b.opened]);
    a.subscribe('now');
    b.subscribe(0);
    await until(() => a.heard.some(m => m.ready) && b.heard.some(m => m.ready));
    expect(a.heard).toEqual([{ ready: { channel: `world:${WORLD}`, seq: 1 } }]);
    expect(b.heard.filter(m => m.seq).map(m => m.seq)).toEqual([1]);

    await commit(1, `world_population_${WORLD}`, { n: 1 }, 'e2');
    await commit(0, `world_carts_${WORLD}`, { n: 2 }, 'e3');
    await until(() => a.heard.filter(m => m.seq).length === 2 && b.heard.filter(m => m.seq).length === 3);
    expect(a.heard.filter(m => m.seq).map(m => [m.seq, m.docs[0].id])).toEqual([[2, `world_population_${WORLD}`], [3, `world_carts_${WORLD}`]]);
    expect(b.heard.filter(m => m.seq).map(m => m.seq)).toEqual([1, 2, 3]);
  });

  it('commits reaching both instances at once take one number each, with none skipped and none twice', async () => {
    const a = listen(0, 'ws_alder');
    await a.opened;
    a.subscribe(0);
    await until(() => a.heard.some(m => m.ready));
    const sent = await Promise.all(Array.from({ length: 12 }, (_, i) => commit(i % 2, `world_${i % 2 ? 'carts' : 'population'}_${WORLD}`, { i }, `c${i}`)));
    for (const res of sent) expect(await res.json()).toEqual({ applied: true });
    expect(await sides[0].room.head(WORLD)).toBe(12);
    const events = await sides[1].room.since(WORLD, 0);
    expect(events.map(e => e.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(events.map(e => JSON.parse(e.docs[0].dataText).i)).size).toBe(12);
    await until(() => a.heard.filter(m => m.seq).length >= 12);
    expect(a.heard.filter(m => m.seq).map(m => m.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // A commit asked again, of either instance, lands nothing more
    expect(await (await commit(1, `world_population_${WORLD}`, { i: 0 }, 'c0')).json()).toEqual({ applied: false });
    expect(await sides[0].room.head(WORLD)).toBe(12);
  });

  it('one chest claimed on both instances at the same moment has one winner, and the other is shown what stands', async () => {
    for (let round = 0; round < 6; round++) {
      const chestId = `q${round}_chest`;
      const [x, y] = await Promise.all([
        post(0, '/chests', { op: 'loot', chestId, cycle: 4, saw: null }, 'ws_alder'),
        post(1, '/chests', { op: 'loot', chestId, cycle: 4, saw: null }, 'ws_birch')
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      const lost = await (x.status === 409 ? x : y).json() as any;
      expect(lost).toMatchObject({ ok: false, reason: 'Someone reached it first.', record: { chests: { [chestId]: { lootedAt: 4 } } } });
    }
    // Every claim that won is an event, and nothing else is
    expect(await sides[0].room.head(WORLD)).toBe(6);
  });

  it('where a player stands crosses instances, and so does their leaving', async () => {
    const a = listen(0, 'ws_alder');
    const b = listen(1, 'ws_birch');
    await Promise.all([a.opened, b.opened]);
    a.subscribe('now');
    b.subscribe('now');
    await until(() => a.heard.some(m => m.ready) && b.heard.some(m => m.ready));
    b.say(where('field'));
    await rest(100);
    a.say(where('field'));
    await until(() => b.heard.some(m => m.where?.uid === 'ws_alder'));
    expect(b.heard.find(m => m.where)).toEqual({ where: { place: 'field', x: 1, z: 2, facing: 'down', moving: false, t: 10, name: 'Someone', archetype: 'NOMAD', uid: 'ws_alder' } });
    // birch said where they were before alder was in the field, and says it again, as a browser does every second
    b.say(where('field'));
    await until(() => a.heard.some(m => m.where?.uid === 'ws_birch'));
    a.say({ gone: true });
    await until(() => b.heard.some(m => m.gone));
    expect(b.heard.filter(m => m.gone)).toEqual([{ gone: 'ws_alder' }]);
  });

  it('a line is one line on both instances; a socket the host closed is held, and its player keeps their turn by coming back on the other', async () => {
    const a = listen(0, 'ws_alder');
    const b = listen(1, 'ws_birch');
    await Promise.all([a.opened, b.opened]);
    a.subscribe('now');
    b.subscribe('now');
    await until(() => a.heard.some(m => m.ready) && b.heard.some(m => m.ready));
    // birch is in the field first, so alder's arrival finds someone there to tell
    b.say(where('field'));
    await rest(100);
    a.say(where('field'));
    await until(() => b.heard.some(m => m.where));

    a.say({ talk: { op: 'ask', npc: 'npc_smith' } });
    await until(() => a.heard.some(m => m.line));
    b.say({ talk: { op: 'ask', npc: 'npc_smith' } });
    const line = { npc: 'npc_smith', focus: ['ws_alder'], waiting: [['ws_birch']] };
    await until(() => a.heard.some(m => m.line?.waiting.length === 1) && b.heard.some(m => m.line?.waiting.length === 1));
    expect(a.heard.filter(m => m.line).at(-1)).toEqual({ line });
    expect(b.heard.filter(m => m.line).at(-1)).toEqual({ line });
    expect(sides[0].room.lineOf(WORLD, 'field', 'npc_smith')).toEqual({ focus: ['ws_alder'], waiting: [['ws_birch']] });
    expect(sides[1].room.lineOf(WORLD, 'field', 'npc_smith')).toEqual({ focus: ['ws_alder'], waiting: [['ws_birch']] });

    // The host closes alder's socket. They are back on the other instance before the hold runs out
    const told = b.heard.length;
    a.ws.close();
    await rest(150);
    const again = listen(1, 'ws_alder');
    await again.opened;
    again.subscribe('now');
    again.say(where('field'));
    await rest(700);
    expect(b.heard.slice(told).filter(m => m.gone || m.line)).toEqual([]);
    expect(sides[1].room.lineOf(WORLD, 'field', 'npc_smith').focus).toEqual(['ws_alder']);

    // This time they do not come back: after the hold, the field is told and birch is heard
    again.ws.close();
    await until(() => b.heard.some(m => m.gone === 'ws_alder'));
    await until(() => b.heard.filter(m => m.line).at(-1)?.line.focus[0] === 'ws_birch');
    expect(b.heard.filter(m => m.line).at(-1)).toEqual({ line: { npc: 'npc_smith', focus: ['ws_birch'], waiting: [] } });
    await until(() => sides[0].room.lineOf(WORLD, 'field', 'npc_smith').focus[0] === 'ws_birch');
  });
});

describe('where the room keeps its lines', () => {
  it('the tables and the memory keep the same law: one change whole, an emptied line gone, lines found by where they are', async () => {
    const database = await openDatabase('pglite://memory');
    await turso.reset();
    const onTurso = await openTursoStore({ url: turso.url });
    try {
      for (const book of [memoryLines(), await tableLines(database), await tursoLines(onTurso)]) {
        const key = 'w|field|npc_smith';
        expect(await book.read(key)).toEqual(emptyLine());
        const asked = await book.change(key, l => TalkLine.ask(l, 'ws_alder', [], 5).line);
        expect(asked).toMatchObject({ changed: true, was: emptyLine(), next: { turns: [{ who: ['ws_alder'], since: 5, last: 5 }] } });
        // Asking again changes nothing, and says so
        expect((await book.change(key, l => TalkLine.ask(l, 'ws_alder', [], 9).line)).changed).toBe(false);
        await book.change('w|field|npc_baker', l => TalkLine.ask(l, 'ws_birch', [], 6).line);
        await book.change('w|cellar|npc_smith', l => TalkLine.ask(l, 'ws_cedar', [], 7).line);
        expect((await book.under('w|field|')).map(([k]) => k).sort()).toEqual(['w|field|npc_baker', 'w|field|npc_smith']);
        expect((await book.change(key, l => TalkLine.leave(l, 'ws_alder'))).changed).toBe(true);
        expect(await book.read(key)).toEqual(emptyLine());
        expect((await book.under('w|field|')).map(([k]) => k)).toEqual(['w|field|npc_baker']);
        // Leaving a line that is not there is nothing
        expect((await book.change(key, l => TalkLine.leave(l, 'ws_alder'))).changed).toBe(false);
      }
      // The table is the room's own: no migration made it, and the record's marks never see it
      const { rows } = await database.db.execute(`SELECT COUNT(*)::int n FROM cold_changes WHERE tbl = 'live_lines'`);
      expect(rows[0].n).toBe(0);
    } finally {
      await database.close();
      await onTurso.close();
    }
  });
});

// ================================================================================================
// THE WHOLE OF IT, AS THE HOST RUNS IT
// ================================================================================================

describe('the hub as one function', () => {
  it('reads the asked address whichever way the host hands it over', () => {
    expect(appPathOf('/api/hub/health')).toBe('/health');
    expect(appPathOf('/api/hub/live/socket?uid=ws_a')).toBe('/live/socket');
    expect(appPathOf('/api/hub')).toBe('/');
    // Rewritten to the function's own address, with the asked one carried beside it (vercel.json)
    expect(appPathOf('/api/hub?__path=health')).toBe('/health');
    expect(appPathOf('/api/hub?__path=live/socket&uid=ws_a')).toBe('/live/socket');
    expect(appPathOf('/api/hub?__path=characters/nonce')).toBe('/characters/nonce');
    expect(appPathOf(undefined)).toBe('/');
  });

  it('answers the hub\'s routes and online play from one handler, takes only the socket\'s upgrade, and says why when it cannot open', async () => {
    const app = createHubApp({ databaseUrl: 'pglite://memory', key: makeHubKey(), publicUrl: 'https://hub.test', env: { ...clerkEnv(), CRON_SECRET: 'the-hosts-word' } });
    const server = createServer((req, res) => void app.handle(req, res));
    server.on('upgrade', (req, raw) => app.upgrade(req, raw));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(`${origin}/api/hub/health`)).json()).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { url: 'https://hub.test', accounts: 'clerk' } });
      expect(await (await fetch(`${origin}/api/hub?__path=health`)).json()).toMatchObject({ ok: true, service: 'worldseed-hub' });
      // Online play is behind the hub's own word: nobody signed in is let in, by request or by socket
      expect((await fetch(`${origin}/api/hub/live/get?uid=ws_a`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
      const refused = new WebSocket(`${origin.replace('http', 'ws')}/api/hub/live/socket?uid=ws_a`);
      await new Promise<void>(resolve => { refused.onerror = () => resolve(); refused.onclose = () => resolve(); });
      const elsewhere = new WebSocket(`${origin.replace('http', 'ws')}/api/hub/health`);
      await new Promise<void>(resolve => { elsewhere.onerror = () => resolve(); elsewhere.onclose = () => resolve(); });
      expect(await (await fetch(`${origin}/api/hub/maintenance`, { headers: { Authorization: 'Bearer the-hosts-word' } })).json()).toMatchObject({ ok: true, record: ['NO_RECORD'], erasuresWaiting: 0 });
      expect((await fetch(`${origin}/api/hub/maintenance`)).status).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
      await app.close();
    }

    // The same, its store on Turso alone: no Postgres anywhere, and the daily call has nothing to write down
    await turso.reset();
    const alone = createHubApp({ databaseUrl: turso.url, key: makeHubKey(), publicUrl: 'https://hub.test', env: { ...clerkEnv(), CRON_SECRET: 'the-hosts-word', WS_RECORD: '1', TURSO_DATABASE_URL: 'http://127.0.0.1:9' } });
    const host = createServer((req, res) => void alone.handle(req, res));
    host.on('upgrade', (req, raw) => alone.upgrade(req, raw));
    await new Promise<void>(r => host.listen(0, '127.0.0.1', () => r()));
    const there = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(`${there}/api/hub/health`)).json()).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { url: 'https://hub.test', accounts: 'clerk' } });
      expect((await fetch(`${there}/api/hub/live/get?uid=ws_a`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
      // WS_RECORD names a record that does not answer, and it does not matter: on Turso the store is its own record
      expect(await (await fetch(`${there}/api/hub/maintenance`, { headers: { Authorization: 'Bearer the-hosts-word' } })).json()).toMatchObject({ ok: true, record: ['IN_STORE'], erasuresWaiting: 0 });
      // Its tables are its own, by name, and the record's are not there
      const tables = (await turso.sql(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).map(r => String(r[0]));
      expect(tables.filter(t => !t.startsWith('store_'))).toEqual([]);
      expect(tables).toEqual(expect.arrayContaining(['store_documents', 'store_ledger_rows', 'store_treasuries', 'store_commits', 'store_live_lines', 'store_live_places', 'store_migrations']));
    } finally {
      host.closeAllConnections();
      await new Promise<void>(r => host.close(() => r()));
      await alone.close();
    }

    const broken = createHubApp({ problem: 'WS_HUB_DATABASE_URL is not set: this hub has no store to check against.' });
    const out: { status?: number; body?: string } = {};
    await broken.handle({ url: '/api/hub/health', method: 'GET', headers: {} } as any, { setHeader: () => undefined, end: (b: string) => { out.body = b; }, set statusCode(s: number) { out.status = s; } } as any);
    expect(out.status).toBe(503);
    expect(out.body).toContain('WS_HUB_DATABASE_URL is not set');
  });

  it('every transaction on a served Postgres takes its turn first, and is otherwise what it was', async () => {
    const order: string[] = [];
    const db = {
      name: 'the database',
      who() { return this.name; },
      transaction: async (run: (tx: any) => Promise<unknown>, config?: unknown) => { order.push(`begin ${JSON.stringify(config)}`); const out = await run({ id: 'tx' }); order.push('commit'); return out; }
    };
    const turned = oneWriterAtATime(db, async tx => { order.push(`lock ${tx.id}`); });
    expect(await turned.transaction(async (tx: any) => { order.push(`work ${tx.id}`); return 7; }, { isolationLevel: 'repeatable read' })).toBe(7);
    expect(order).toEqual(['begin {"isolationLevel":"repeatable read"}', 'lock tx', 'work tx', 'commit']);
    // Everything else is the database's own, still bound to it
    expect(turned.who()).toBe('the database');
    expect(turned.name).toBe('the database');
  });
});

// @vitest-environment node
/**
 * THE DEVELOPERS' VIEW OF THE DATA (Pedro, 2026-11-13: "I think we should protected route and
 * actually be able to see the DB and check the state of things... like a view from the data side as
 * devs"). Read-only routes under /api/hub/dev/, behind a list of accounts the host holds:
 *
 *   - anyone not on the list is answered exactly as an address that does not exist;
 *   - the state of things: settings by name, the database and its migrations, the record, the
 *     scheduled call's last run, erasures waiting, how many of each thing and the latest of each;
 *   - the data itself: every table and collection, paged newest first, one row opened whole, and
 *     found by an account's, a character's or a world's id;
 *   - never a password's hash or salt, a session's token, a one-time text, the hub's key or a
 *     setting's value, by any route: a row holding each kind is seeded, and every answer searched;
 *   - it writes nothing, and each read is logged with who asked and for what, never the rows.
 *
 * On a hub behind a real server, over a database in memory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SqlStore } from '../shared/SqlStore';
import type { IDatabase } from '../shared/dbShared';
import { openLive } from '../server/record';
import { Hub } from '../server/hub/Hub';
import { makeHubKey } from '../server/hub/keys';
import { createHubHandler } from '../server/hub/http';
import { hubPathOf } from '../server/hub/function';
import { DevView, HIDDEN } from '../server/hub/dev';
import { tableLines } from '../server/live/lines';
import { signedText } from '../shared/entities/identity/signedText';
import { addressOf } from '../shared/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../shared/logic/ledger/chainLaw';

const NOW = 1_800_000_000_000;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const HUB_PEM = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** The host's settings, each holding a value no answer may carry. */
const ENV: Record<string, string> = {
  WS_HUB_DATABASE_URL: 'postgres://hub-user:store-word-31415@db.host.test/hub',
  WS_HUB_KEY: HUB_PEM,
  WS_PUBLIC_URL: 'https://hub.test',
  TURSO_DATABASE_URL: 'libsql://record-host.turso.test',
  TURSO_AUTH_TOKEN: 'turso-token-zyxwvutsrq',
  CRON_SECRET: 'cron-word-1a2b3c4d5e6f',
  CLERK_SECRET_KEY: 'sk_test_clerk_secret_998877',
  CLERK_WEBHOOK_SECRET: 'whsec_webhook_secret_665544'
};

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
  const row = async (type: string, data: Record<string, unknown>) => {
    const ts = NOW - 60_000 + seq;
    seq++;
    const signed = await sign({ seq, prevSeq: seq - 1, ts, type, data, v: ROW_VERSION, prev: last ? await linkOf(last) : null, clock: { ...addressOf(ts), by: 'machine' } }, ts);
    last = signed.signature;
    return signed;
  };
  return { uid, certificate: { metadata: { uid, displayName: 'TESTER', createdAt: 1 }, publicKeyJWK }, sign, row };
}

interface IStand { origin: string; server: Server; hub: Hub; store: SqlStore; database: IDatabase; said: string[]; close: () => Promise<void> }

async function standHub(devAccounts: string): Promise<IStand> {
  const { store, database } = await openLive('pglite://memory', {}, { say: () => undefined } as any);
  const hub = new Hub(store, makeHubKey(HUB_PEM), { publicUrl: 'https://hub.test', now: () => NOW });
  const said: string[] = [];
  const dev = new DevView({ hub, database, env: { ...ENV, WS_DEV_ACCOUNTS: devAccounts }, say: line => said.push(line) });
  const handler = createHubHandler(hub, { dev, cronSecret: ENV.CRON_SECRET, maintain: async () => ({ record: ['NO_RECORD'] }) });
  const server = createServer((req, res) => void handler(req, res, hubPathOf(req.url)));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, hub, store, database, said,
    close: async () => { await new Promise<void>(r => server.close(() => r())); await store.close(); }
  };
}

/** What a request answers, whole: status, the type it says it is, its body as text. */
async function raw(origin: string, path: string, token?: string, init: RequestInit = {}) {
  const res = await fetch(`${origin}/api/hub${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), text: await res.text() };
}

describe('the developers\' view of the data', () => {
  let stand: IStand;
  let devToken: string;
  let playerToken: string;
  let characterUid: string;
  let nonceText: string;
  let salt: string;
  let hash: string;
  const PLAYER_PASSWORD = 'player password nine-nine-one';
  const DEV_PASSWORD = 'developer password four-four-two';
  const WORLD = 'world_seen_by_devs_1';

  const dev = async (path: string) => {
    const out = await raw(stand.origin, path, devToken);
    expect(out.status, `${path}: ${out.text}`).toBe(200);
    expect(out.cache).toBe('no-store');
    return JSON.parse(out.text);
  };

  beforeAll(async () => {
    stand = await standHub('devhand, someone_else');
    const { hub, store, database } = stand;
    for (const [handle, password] of [['devhand', DEV_PASSWORD], ['player_one', PLAYER_PASSWORD]]) expect((await hub.createAccount(handle, password)).ok).toBe(true);
    const signIn = async (handle: string, password: string) => { const out = await hub.signIn(handle, password); if (!out.ok) throw new Error(out.reason); return out.token; };
    devToken = await signIn('devhand', DEV_PASSWORD);
    playerToken = await signIn('player_one', PLAYER_PASSWORD);
    const account = JSON.parse((await store.get('hub_account_player_one'))!.dataText);
    salt = account.salt;
    hash = account.hash;

    // A character, its birth and two receipts: what a player sends
    const character = await makeCharacter('ws_aaaaaaaa_x1_bbbbbbbb');
    characterUid = character.uid;
    const nonce = await hub.nonce(playerToken);
    if (!nonce.ok) throw new Error(nonce.reason);
    nonceText = nonce.nonce;
    const proof = await character.sign({ claim: 'hub-character', hub: hub.id, nonce: nonceText });
    const registered = await hub.registerCharacter(playerToken, character.certificate, proof);
    if (!registered.ok) throw new Error(registered.reason);
    const sent = await hub.checkReceipts(playerToken, characterUid, [
      await character.row('CHARACTER_GENESIS', { certUid: characterUid, username: 'TESTER', gold: 0, mint: registered.mint }),
      await character.row('GOLD_DELTA', { amount: 5 })
    ]);
    if (!sent.ok) throw new Error(sent.reason);

    // What other parts keep, written as they write it: a world, a person, a job whose body carries
    // every secret this hub knows (as a careless poster's might), an erasure waiting, and the live room's own
    await hub.commit([
      { kind: 'put', doc: hub.doc(`hub_world_${WORLD}`, { type: 'hub_world', worldUid: WORLD, creator: characterUid, themeId: 'theme_x', kinds: [], at: NOW }) },
      { kind: 'put', doc: hub.doc('hub_person_person_0123456789abcdef', { type: 'hub_person', city: 'hub_0123456789abcdef', account: 'player_one', record: {}, mint: { text: '{}', signature: 'sig' } }) },
      { kind: 'put', doc: hub.doc('hub_job_j1', { type: 'hub_job', id: 'j1', kind: 'pass', path: '/x', postedBy: 'player_one', at: NOW, state: 'OPEN', body: { said: `the cron word is ${ENV.CRON_SECRET}, the store is ${ENV.WS_HUB_DATABASE_URL}`, key: HUB_PEM, clerk: ENV.CLERK_SECRET_KEY, turso: ENV.TURSO_AUTH_TOKEN, hook: ENV.CLERK_WEBHOOK_SECRET, apiKey: 'a-key-someone-pasted', password: 'a-password-someone-pasted' } }) },
      { kind: 'put', doc: hub.doc('hub_erase_00000000000000000000000000000001', { type: 'hub_erase', docs: ['hub_account_gone'], chains: [], at: NOW }) },
      { kind: 'put', doc: { id: `live_event_${WORLD}_000000000001`, namespace: 'live', dataText: JSON.stringify({ channel: `world:${WORLD}`, seq: 1, at: NOW, docs: [] }), metadata: { createdAt: NOW, updatedAt: NOW, version: 1 } } }
    ]);
    await tableLines(database);
    await database.db.execute(sql`INSERT INTO live_lines (key, line, at) VALUES (${`line:${WORLD}:npc_1`}, ${'{"queue":[]}'}, ${NOW})`);

    // The host's scheduled call, once
    expect((await raw(stand.origin, '/maintenance', ENV.CRON_SECRET)).status).toBe(200);
  }, 60_000);
  afterAll(async () => { await stand?.close(); });

  it('answers anyone not on the list exactly as an address that does not exist, and an empty list lets nobody in', async () => {
    const nowhere = await raw(stand.origin, '/nothing-here');
    expect(nowhere.status).toBe(404);
    for (const path of ['/dev/state', '/dev/tables', '/dev/rows?table=documents', '/dev/find?id=player_one', '/dev', '/dev/']) {
      for (const token of [undefined, playerToken, 'not-a-session']) {
        const out = await raw(stand.origin, path, token);
        expect({ status: out.status, type: out.type, text: out.text }, `${path} as ${token ?? 'nobody'}`).toEqual({ status: nowhere.status, type: nowhere.type, text: nowhere.text });
      }
    }
    // Only GET reads; anything else is answered as it would be anywhere else that does not exist
    const posted = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    const postNowhere = await raw(stand.origin, '/nothing-here', devToken, posted);
    const postDev = await raw(stand.origin, '/dev/state', devToken, posted);
    expect({ status: postDev.status, text: postDev.text }).toEqual({ status: postNowhere.status, text: postNowhere.text });

    const closed = await standHub('');
    try {
      expect((await closed.hub.createAccount('devhand', DEV_PASSWORD)).ok).toBe(true);
      const token = await closed.hub.signIn('devhand', DEV_PASSWORD);
      if (!token.ok) throw new Error(token.reason);
      const out = await raw(closed.origin, '/dev/state', token.token);
      const there = await raw(closed.origin, '/nothing-here');
      expect({ status: out.status, text: out.text }).toEqual({ status: there.status, text: there.text });
    } finally {
      await closed.close();
    }
  });

  it('shows a signed-in person their own account key, which is what goes on the list', async () => {
    const out = JSON.parse((await raw(stand.origin, '/session', playerToken)).text);
    expect(out).toEqual({ ok: true, account: { handle: 'player_one', key: 'player_one' } });
  });

  it('says the state of things: settings by name, the database, the record, the scheduled call, erasures and counts', async () => {
    const state = await dev('/dev/state');
    expect(state).toMatchObject({ ok: true, you: { handle: 'devhand', key: 'devhand' }, hub: { id: stand.hub.id, url: 'https://hub.test', accounts: 'builtin' } });
    const setting = (name: string) => state.settings.find((s: { name: string }) => s.name === name);
    expect(setting('WS_HUB_DATABASE_URL')).toEqual({ name: 'WS_HUB_DATABASE_URL', what: expect.any(String), needed: true, set: true, from: 'WS_HUB_DATABASE_URL' });
    expect(setting('CLERK_JWT_KEY')).toMatchObject({ set: false, from: null });
    expect(setting('WS_DEV_ACCOUNTS')).toMatchObject({ set: true });
    expect(state.database).toMatchObject({ answers: true, migrations: { applied: 2, known: 2, newest: '0001_cold_marks' } });
    // Turso's names are there but the record was never asked for: said as such
    expect(state.record).toMatchObject({ asked: false });
    expect(state.scheduled).toEqual({ lastRun: NOW });
    expect(state.erasures).toEqual({ waiting: 1, oldest: NOW });
    expect(state.counts).toMatchObject({
      accounts: { count: 2 }, characters: { count: 1, latest: { id: `hub_character_${characterUid}` } }, sessions: { count: 2 },
      ledgerRows: { count: 2, latest: { id: `ledger_${characterUid}_00000002` } }, worlds: { count: 1, latest: { id: `hub_world_${WORLD}` } },
      people: { count: 1 }, lines: { count: 1 }, liveEvents: { count: 1 }
    });
  });

  it('says a setting this hub was given another way (a local stand-in\'s default, a key from a file) as given, not as missing', async () => {
    const view = new DevView({ hub: stand.hub, database: stand.database, env: { WS_DEV_ACCOUNTS: 'devhand' }, given: { WS_HUB_KEY: 'given to this server directly' }, say: () => undefined });
    const out = await view.read({ key: 'devhand', handle: 'devhand' }, '/state', new URLSearchParams());
    const settings = (out!.body.settings as { name: string }[]);
    expect(settings.find(s => s.name === 'WS_HUB_KEY')).toMatchObject({ set: true, from: null, given: 'given to this server directly' });
    expect(settings.find(s => s.name === 'WS_PUBLIC_URL')).toMatchObject({ set: false, needed: true });
  });

  it('lists every table and collection with its count, pages rows newest first, and opens one whole', async () => {
    const { tables, collections, ledger } = await dev('/dev/tables');
    const names = tables.map((t: { name: string }) => t.name);
    for (const name of ['documents', 'ledger_rows', 'treasuries', 'commits', 'cold_changes', 'cold_state', 'live_lines']) expect(names).toContain(name);
    for (const t of tables) {
      const { rows } = await stand.database.db.execute(sql`SELECT COUNT(*) AS n FROM ${sql.identifier(t.name)}`);
      expect(t.rows, t.name).toBe(Number((rows[0] as { n: unknown }).n));
    }
    expect(collections).toContainEqual(expect.objectContaining({ namespace: 'hub', type: 'hub_account', rows: 2 }));
    expect(ledger).toContainEqual(expect.objectContaining({ type: 'GOLD_DELTA', rows: 1 }));

    // Newest first, a page at a time
    const first = await dev('/dev/rows?table=ledger_rows&size=1&page=0');
    const second = await dev('/dev/rows?table=ledger_rows&size=1&page=1');
    const third = await dev('/dev/rows?table=ledger_rows&size=1&page=2');
    expect(first).toMatchObject({ table: 'ledger_rows', total: 2, page: 0, size: 1 });
    expect(first.rows.map((r: { id: string }) => r.id)).toEqual([`ledger_${characterUid}_00000002`]);
    expect(second.rows.map((r: { id: string }) => r.id)).toEqual([`ledger_${characterUid}_00000001`]);
    expect(third.rows).toEqual([]);
    const accounts = await dev('/dev/rows?table=documents&namespace=hub&type=hub_account');
    expect(accounts.rows.map((r: { id: string }) => r.id).sort()).toEqual(['hub_account_devhand', 'hub_account_player_one']);

    // One row, whole: a receipt as the character signed it
    const opened = await dev(`/dev/row?table=ledger_rows&id=ledger_${characterUid}_00000001`);
    expect(opened.row).toMatchObject({ id: `ledger_${characterUid}_00000001`, owner_uid: characterUid, seq: 1, type: 'CHARACTER_GENESIS' });
    expect(opened.row.data).toMatchObject({ payload: { seq: 1, type: 'CHARACTER_GENESIS', data: { certUid: characterUid } }, certUid: characterUid });
    const account = await dev('/dev/row?table=documents&id=hub_account_player_one');
    expect(account.row.data).toMatchObject({ type: 'hub_account', handle: 'player_one', salt: HIDDEN, hash: HIDDEN });
    const lines = await dev('/dev/rows?table=live_lines');
    expect(lines.rows).toHaveLength(1);

    // A session is kept under the hash of its token: listed by a short mark of it, never opened by it
    const sessions = await dev('/dev/rows?table=documents&namespace=hub&type=hub_session');
    expect(sessions.rows).toHaveLength(2);
    for (const r of sessions.rows) expect(r.id).toMatch(/^hub_session_[0-9a-f]{8}…$/);
    const refused = await raw(stand.origin, `/dev/row?table=documents&id=${encodeURIComponent(sessions.rows[0].id)}`, devToken);
    expect(refused.status).toBe(400);
    // A table that is not there, or a name that is not a table, is refused without reaching the database
    expect((await raw(stand.origin, '/dev/rows?table=pg_shadow', devToken)).status).toBe(400);
    expect((await raw(stand.origin, '/dev/rows?table=documents;DROP%20TABLE%20documents', devToken)).status).toBe(400);
  });

  it('finds what this hub holds by an account\'s, a character\'s or a world\'s id', async () => {
    const byAccount = await dev('/dev/find?id=player_one');
    expect(byAccount.exact).toContainEqual({ table: 'documents', id: 'hub_account_player_one' });
    expect(byAccount.documents.map((d: { id: string }) => d.id)).toContain(`hub_character_${characterUid}`);
    const byCharacter = await dev(`/dev/find?id=${characterUid}`);
    expect(byCharacter.exact).toContainEqual({ table: 'documents', id: `hub_character_${characterUid}` });
    expect(byCharacter.ledger).toMatchObject({ rows: 2 });
    expect(byCharacter.documents.map((d: { id: string }) => d.id)).toContain(`hub_world_${WORLD}`);
    const byWorld = await dev(`/dev/find?id=${WORLD}`);
    expect(byWorld.exact).toContainEqual({ table: 'documents', id: `hub_world_${WORLD}` });
    expect(byWorld.documents.map((d: { id: string }) => d.id)).toContain(`live_event_${WORLD}_000000000001`);
    expect((await raw(stand.origin, '/dev/find?id=ab', devToken)).status).toBe(400);
  });

  it('never shows a password\'s hash or salt, a session\'s token, a one-time text, the hub\'s key or a setting\'s value, by any route, and writes nothing', async () => {
    const count = async () => {
      const out: Record<string, number> = {};
      for (const t of ['documents', 'ledger_rows', 'treasuries', 'commits', 'cold_changes', 'cold_state', 'live_lines']) {
        const { rows } = await stand.database.db.execute(sql`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(${sql.identifier(t)}::text)), 0) AS size FROM ${sql.identifier(t)}`);
        out[t] = Number((rows[0] as { n: unknown }).n) * 1e9 + Number((rows[0] as { size: unknown }).size);
      }
      return out;
    };
    const before = await count();
    const saidBefore = stand.said.length;

    // Every route, every page of every table and collection, every row opened, found by every id
    const texts: string[] = [];
    const read = async (path: string) => { const out = await raw(stand.origin, path, devToken); texts.push(out.text); return out.status === 200 ? JSON.parse(out.text) : null; };
    await read('/dev/state');
    const listed = await read('/dev/tables');
    const pages: string[] = [
      ...listed.tables.map((t: { name: string }) => `table=${t.name}`),
      ...listed.collections.map((c: { namespace: string; type: string | null }) => `table=documents&namespace=${encodeURIComponent(c.namespace)}${c.type ? `&type=${encodeURIComponent(c.type)}` : ''}`)
    ];
    for (const query of pages) {
      for (let page = 0; ; page++) {
        const out = await read(`/dev/rows?${query}&size=100&page=${page}`);
        if (!out || out.rows.length === 0) break;
        for (const row of out.rows) {
          const id = row.id ?? row.key;
          if (id !== undefined) await read(`/dev/row?table=${out.table}&id=${encodeURIComponent(String(id))}`);
        }
      }
    }
    for (const id of ['player_one', 'devhand', characterUid, WORLD, 'hub_session', 'hub_nonce', 'hub_job']) await read(`/dev/find?id=${encodeURIComponent(id)}`);
    const everything = texts.join('\n');

    const sessionTokens = [devToken, playerToken];
    const pemBody = HUB_PEM.trim().split('\n').slice(1, -1);
    const never = [
      salt, hash, PLAYER_PASSWORD, DEV_PASSWORD,
      ...sessionTokens, ...sessionTokens.map(sha256),
      nonceText, sha256(nonceText),
      ...pemBody, pemBody.join(''), 'PRIVATE KEY',
      ...Object.values(ENV).filter(v => v !== ENV.WS_PUBLIC_URL), 'store-word-31415',
      'a-key-someone-pasted', 'a-password-someone-pasted'
    ];
    for (const text of never) expect(everything.includes(text), `a dev route showed ${text.slice(0, 12)}…`).toBe(false);
    // What was hidden is said to be hidden, where it stood
    expect(everything).toContain(HIDDEN);
    expect(everything).toContain('the cron word is');

    // Nothing written by any of it
    expect(await count()).toEqual(before);

    // Each read is in the log with who asked and for what, and never a row
    const lines = stand.said.slice(saidBefore);
    expect(lines.length).toBe(texts.length);
    for (const line of lines) {
      expect(line).toMatch(/^\[DEV\] devhand \(devhand\) read \/dev\/(state|tables|rows|row|find)/);
      for (const text of ['publicKeyJWK', 'TESTER', 'CHARACTER_GENESIS', 'the cron word', ...never]) expect(line).not.toContain(text);
    }
  }, 120_000);
});

// @vitest-environment node
/**
 * THE WORLDS OPEN ON A HUB (server/hub/open.ts, src/logic/live/OpenWorlds.ts). Pedro, 2026-11-18: "we
 * need to make the multiplayer always on WHEN someone is in server, it's ready to deploty the
 * websocket, if there's a web socket we log people into to it, unless they choose to host their own,
 * then we tunnel theirs as an option like old warcraft 3 used to do".
 *
 * The hub is the lobby: it lists what is open, serves a world to whoever enters it, and its room keeps
 * what each world's players share. A player opens a world they minted, and closes it. These bars
 * stand on the hub itself and its room over one store in memory, and the game's own client against a
 * real server for the world that closes while someone is in it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openBody, type IBody } from '../server/hub/body';
import { Hub } from '../server/hub/Hub';
import { makeHubKey } from '../server/hub/keys';
import { Eraser } from '../server/hub/erase';
import { HostedWorld } from '../server/hub/hosted';
import { OpenWorlds } from '../server/hub/open';
import { LiveRoom, type LiveAccess } from '../server/live/room';
import { tokenOf } from '../server/hub/http';
import { signedText } from '../shared/entities/identity/signedText';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { NOT_OPEN_STATUS, OPEN_BEAT_MS, OPEN_FOR_MS } from '../shared/logic/live/open';
import { StoreClient } from '../shared/entities/data/StoreClient';
import { LiveClient, useLive } from '../src/logic/live/LiveClient';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const START = 1_800_000_000_000;
let NOW = START;
let turn = 0;

let body: IBody;
let hub: Hub;
let room: LiveRoom;
let open: OpenWorlds;

const doc = (id: string, data: unknown, at = 1) => ({ id, namespace: 'territories', dataText: JSON.stringify(data), metadata: { createdAt: at, updatedAt: at, version: 1 } });
const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('Waited and it did not come.');
    await new Promise(r => setTimeout(r, 10));
  }
};

async function account(name: string): Promise<string> {
  const handle = `${name}_${turn}`;
  await hub.createAccount(handle, 'a long enough password');
  const out = await hub.signIn(handle, 'a long enough password');
  if (!out.ok) throw new Error('The account could not sign in.');
  return (out as { token: string }).token;
}

/** A character as a browser makes one, registered under the account. */
async function character(token: string, name: string, displayName = name.toUpperCase()): Promise<string> {
  const uid = `${name}_${turn}`;
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const nonce = (await hub.nonce(token) as { nonce: string }).nonce;
  const payload = { claim: 'hub-character', hub: hub.id, nonce };
  const proof = { payload, signature: Buffer.from(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, NOW)))).toString('base64'), certUid: uid, timestamp: NOW };
  const out = await hub.registerCharacter(token, { metadata: { uid, displayName, createdAt: 123 }, publicKeyJWK: jwk }, proof);
  expect(out.ok).toBe(true);
  return uid;
}

/** What a maker's game sends to open a world: its certificate, the theme it stands on, what its minting added. */
const manifestOf = (worldUid: string, maker: string, name = 'Saltmarsh') => ({
  world: { worldUid, name, creatorCertUid: maker, themeId: FIRST_THEME_PACK.themeId },
  certificate: { data: { worldUid, worldName: name, creatorCertUid: maker, worldType: 'EXTRACTION', rules: { themeId: FIRST_THEME_PACK.themeId } } },
  themes: [FIRST_THEME_PACK],
  mint: { worldUid, themeId: FIRST_THEME_PACK.themeId, writtenAt: 1, batch: { scope: `mint_${worldUid}`, bases: [], materials: [], uses: [] } }
});

/** Two accounts, each with a character, and a world the first one minted. */
async function two() {
  const hostToken = await account('host');
  const guestToken = await account('guest');
  const host = await character(hostToken, 'alder');
  const guest = await character(guestToken, 'birch');
  return { hostToken, guestToken, host, guest, world: `world_open_${turn}` };
}

beforeAll(async () => {
  body = await openBody('pglite://memory', {}, { say: () => undefined });
  hub = new Hub(body.store, makeHubKey(), { publicUrl: 'https://hub.test', now: () => NOW });
  const access: LiveAccess = (token, uid, worldUid) => open.access(token, uid, worldUid);
  room = new LiveRoom(body.store, access, () => NOW);
  open = new OpenWorlds(hub, { seed: (w, d, k) => room.seed(w, d, k), shut: (w, k) => room.shut(w, k), take: w => room.take(w) });
}, 120_000);
afterAll(async () => { await room.close(); await body.store.close(); });
beforeEach(() => { turn++; NOW = START + turn * 86_400_000; });

describe('the lobby: every world open on the hub, for whoever is signed in', () => {
  it('a world its maker opened is listed for everyone signed in, and served to a character that enters it', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    expect(await open.list('not-a-token')).toMatchObject({ ok: false, status: 401 });
    expect((await open.list(guestToken) as any).worlds.filter((w: any) => w.worldUid === world)).toEqual([]);

    expect(await open.open(hostToken, host, manifestOf(world, host), [])).toMatchObject({ ok: true, worldUid: world, resumed: false });
    const mine = (await open.list(hostToken) as any).worlds.find((w: any) => w.worldUid === world);
    expect(mine).toMatchObject({ name: 'Saltmarsh', by: 'PLAYER', host: 'ALDER', mine: true, answering: true });
    const theirs = (await open.list(guestToken) as any).worlds.find((w: any) => w.worldUid === world);
    expect(theirs).toMatchObject({ name: 'Saltmarsh', by: 'PLAYER', host: 'ALDER', mine: false, answering: true });

    // Served whole: the certificate another game lists it by, its theme, and what its minting added
    const served = await open.enter(guestToken, guest, world) as any;
    expect(served).toMatchObject({ ok: true, worldUid: world, by: 'PLAYER', manifest: { certificate: { data: { worldUid: world } }, themes: [{ themeId: FIRST_THEME_PACK.themeId }], mint: { worldUid: world } } });
    // And the room lets both of them play it live, each under their own character only
    expect(await open.access(guestToken, guest, world)).toEqual({ ok: true, worldUid: world });
    expect(await open.access(hostToken, host, world)).toEqual({ ok: true, worldUid: world });
    expect(await open.access(guestToken, host, world)).toMatchObject({ ok: false, status: 403 });
    expect(await open.access('not-a-token', guest, world)).toMatchObject({ ok: false, status: 401 });
  });

  it('only the character that minted a world opens it, with its own certificate, on themes the law takes', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    // Someone else's world, and one's own under another account's token
    expect(await open.open(guestToken, guest, manifestOf(world, host), [])).toMatchObject({ ok: false, status: 403 });
    expect(await open.open(guestToken, host, manifestOf(world, host), [])).toMatchObject({ ok: false, status: 403 });
    // No certificate, or another world's
    expect(await open.open(hostToken, host, { ...manifestOf(world, host), certificate: undefined }, [])).toMatchObject({ ok: false, status: 400 });
    expect(await open.open(hostToken, host, { ...manifestOf(world, host), certificate: { data: { worldUid: 'another' } } }, [])).toMatchObject({ ok: false, status: 400 });
    // A theme whose id is not its words is the law's to refuse (Hub.checkWorld)
    const forged = { ...FIRST_THEME_PACK, name: 'Something else entirely' };
    expect(await open.open(hostToken, host, { ...manifestOf(world, host), themes: [forged] }, [])).toMatchObject({ ok: false, status: 400, reason: expect.stringMatching(/cannot be opened/) });
    expect((await open.list(hostToken) as any).worlds.filter((w: any) => w.worldUid === world)).toEqual([]);
  });

  it('a character that owes the hub receipts, or whose rerun was challenged, opens and enters nothing', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    const held = (await hub.read<any>(`hub_character_${host}`))!;
    await hub.commit([{ kind: 'put', doc: hub.doc(`hub_character_${host}`, { ...held.data, owed: [{ seq: 1, sessionId: 's', receiptHash: 'h', actionCount: 1 }] }, held.doc.metadata.createdAt) }]);
    expect(await open.open(hostToken, host, manifestOf(world, host), [])).toMatchObject({ ok: false, status: 409, owed: 1 });
    await hub.commit([{ kind: 'put', doc: hub.doc(`hub_character_${host}`, held.data, held.doc.metadata.createdAt) }]);
    expect((await open.open(hostToken, host, manifestOf(world, host), [])).ok).toBe(true);

    const theirs = (await hub.read<any>(`hub_character_${guest}`))!;
    await hub.commit([{ kind: 'put', doc: hub.doc(`hub_character_${guest}`, { ...theirs.data, standing: 'CHALLENGED' }, theirs.doc.metadata.createdAt) }]);
    expect(await open.enter(guestToken, guest, world)).toMatchObject({ ok: false, status: 403, standing: 'CHALLENGED' });
    expect(await open.access(guestToken, guest, world)).toMatchObject({ ok: false, status: 403 });
  });

  it('the world the hub hosts itself stands first in the list, and is the one meant when none is named', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    await new HostedWorld(hub).publish({ world: { worldUid: 'world_hosted_open', name: 'The Common World', creatorCertUid: 'operator', themeId: FIRST_THEME_PACK.themeId }, themes: [FIRST_THEME_PACK] });
    await open.open(hostToken, host, manifestOf(world, host), []);
    const listed = (await open.list(guestToken) as any).worlds;
    expect(listed[0]).toMatchObject({ worldUid: 'world_hosted_open', by: 'HUB', host: null, mine: false, answering: true });
    expect(listed.some((w: any) => w.worldUid === world)).toBe(true);
    expect(await open.access(guestToken, guest)).toEqual({ ok: true, worldUid: 'world_hosted_open' });
    expect(await open.access(guestToken, guest, 'world_hosted_open')).toEqual({ ok: true, worldUid: 'world_hosted_open' });
    expect(await open.access(guestToken, guest, world)).toEqual({ ok: true, worldUid: world });
    // Nobody opens the hub's own world as theirs
    expect(await open.open(hostToken, host, manifestOf('world_hosted_open', host), [])).toMatchObject({ ok: false, status: 409 });
  });
});

describe('hosting one\'s own: the room is the tunnel', () => {
  it('the room starts from what the host\'s game holds, chests among them, and everyone plays on that copy', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    const chests = { chests: { chest_1: { lootedAt: 2 } }, guards: {} };
    expect(await open.open(hostToken, host, manifestOf(world, host), [doc(`world_chests_${world}`, chests), doc(`world_carts_${world}`, { carts: ['c1'] })])).toMatchObject({ ok: true, resumed: false });
    expect(await room.head(world)).toBe(1);
    expect((await room.take(world)).map(d => [d.id, JSON.parse(d.dataText)])).toEqual([[`world_chests_${world}`, chests], [`world_carts_${world}`, { carts: ['c1'] }]]);

    // A guest's change lands in the room, by number, for everyone
    expect((await room.commit(world, { commitId: `g_${turn}`, ops: [{ kind: 'put', doc: doc(`world_carts_${world}`, { carts: ['c1', 'c2'] }) as any }] })).status).toBe(200);
    expect(await room.head(world)).toBe(2);
    expect(guest && hostToken && guestToken).toBeTruthy();
  });

  it('a world is opened with its own shared documents and nothing else: anything more is refused whole, and nothing is listed', async () => {
    const { hostToken, host, world } = await two();
    const out = await open.open(hostToken, host, manifestOf(world, host), [doc(`world_carts_${world}`, {}), doc(`player_${host}`, { gold: 1e9 })]);
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(await room.head(world)).toBe(0);
    expect(await body.store.get(`player_${host}`)).toBeNull();
    expect((await open.list(hostToken) as any).worlds.filter((w: any) => w.worldUid === world)).toEqual([]);
    // Another world's documents are not this world's
    expect(await open.open(hostToken, host, manifestOf(world, host), [doc('world_carts_someone_elses', {})])).toMatchObject({ ok: false, status: 400 });
  });

  it('a host that stops answering is not listed and lets nobody else in; heard from again, the world is back as the room held it', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    await open.open(hostToken, host, manifestOf(world, host), [doc(`world_carts_${world}`, { carts: ['c1'] })]);
    // Beats keep it open past any length of time
    for (let i = 0; i < 5; i++) {
      NOW += OPEN_BEAT_MS;
      expect(await open.beat(hostToken, [world])).toEqual({ ok: true, open: [world] });
    }
    expect((await open.list(guestToken) as any).worlds.some((w: any) => w.worldUid === world)).toBe(true);
    // Only the account that opened it says so
    expect(await open.beat(guestToken, [world])).toEqual({ ok: true, open: [] });

    NOW += OPEN_FOR_MS + 1;
    expect((await open.list(guestToken) as any).worlds.some((w: any) => w.worldUid === world)).toBe(false);
    expect((await open.list(hostToken) as any).worlds.find((w: any) => w.worldUid === world)).toMatchObject({ mine: true, answering: false });
    expect(await open.access(guestToken, guest, world)).toMatchObject({ ok: false, status: NOT_OPEN_STATUS });
    expect(await open.enter(guestToken, guest, world)).toMatchObject({ ok: false, status: NOT_OPEN_STATUS, notOpen: true });
    // The host is let in all the while: the room's copy is the world's shared part until it is closed
    expect(await open.access(hostToken, host, world)).toEqual({ ok: true, worldUid: world });

    expect(await open.beat(hostToken, [world])).toEqual({ ok: true, open: [world] });
    expect((await open.list(guestToken) as any).worlds.find((w: any) => w.worldUid === world)).toMatchObject({ answering: true });
    expect(await open.access(guestToken, guest, world)).toEqual({ ok: true, worldUid: world });
    expect(JSON.parse((await room.take(world))[0].dataText)).toEqual({ carts: ['c1'] });
  });

  it('opened again while it is still open, the room\'s copy stands and what the game sends is not read', async () => {
    const { hostToken, host, world } = await two();
    await open.open(hostToken, host, manifestOf(world, host), [doc(`world_carts_${world}`, { carts: ['c1'] })]);
    await room.commit(world, { commitId: `g_${turn}`, ops: [{ kind: 'put', doc: doc(`world_carts_${world}`, { carts: ['c1', 'c2'] }) as any }] });
    NOW += OPEN_FOR_MS * 4;
    // The host's game stopped, came back with its older copy, and opens it again
    expect(await open.open(hostToken, host, manifestOf(world, host), [doc(`world_carts_${world}`, { carts: ['c1'] })])).toMatchObject({ ok: true, resumed: true });
    expect(JSON.parse((await room.take(world))[0].dataText)).toEqual({ carts: ['c1', 'c2'] });
    expect((await open.list(hostToken) as any).worlds.find((w: any) => w.worldUid === world)).toMatchObject({ answering: true });
  });

  it('closing hands what was shared back to the host, tells everyone in it, and lets nobody in after; asked again, the same comes back', async () => {
    const { hostToken, guestToken, host, guest, world } = await two();
    await open.open(hostToken, host, manifestOf(world, host), [doc(`world_chests_${world}`, { chests: {}, guards: {} }), doc(`world_carts_${world}`, { carts: ['c1'] })]);
    // A guest claims a chest while it is open: the room's write, in its queue
    expect(await room.chests(world, { op: 'loot', chestId: 'q7_chest', cycle: 0, saw: null })).toMatchObject({ status: 200, body: { ok: true } });

    // Only the account that opened it closes it
    expect(await open.close(guestToken, world)).toMatchObject({ ok: false, status: 403 });
    expect(await open.close(hostToken, 'world_never_opened')).toMatchObject({ ok: false, status: 404 });

    const closed = await open.close(hostToken, world) as any;
    expect(closed).toMatchObject({ ok: true, worldUid: world });
    const back = Object.fromEntries(closed.docs.map((d: any) => [d.id, JSON.parse(d.dataText)]));
    expect(back[`world_carts_${world}`]).toEqual({ carts: ['c1'] });
    expect(back[`world_chests_${world}`].chests.q7_chest).toEqual({ lootedAt: 0 });

    // The world's last event says it closed, so every instance tells its own sockets in turn
    const events = await room.since(world, 0);
    expect(events[events.length - 1]).toMatchObject({ closed: true, docs: [] });
    expect((await open.list(guestToken) as any).worlds.some((w: any) => w.worldUid === world)).toBe(false);
    expect((await open.list(hostToken) as any).worlds.some((w: any) => w.worldUid === world)).toBe(false);
    expect(await open.access(guestToken, guest, world)).toMatchObject({ ok: false, status: NOT_OPEN_STATUS });
    expect(await open.access(hostToken, host, world)).toMatchObject({ ok: false, status: NOT_OPEN_STATUS });
    expect(await open.beat(hostToken, [world])).toEqual({ ok: true, open: [] });

    // The answer was lost on the way: asked again, the same documents, and no second closing event
    const again = await open.close(hostToken, world) as any;
    expect(again).toMatchObject({ ok: true, closedAt: closed.closedAt });
    expect(again.docs.map((d: any) => d.dataText)).toEqual(closed.docs.map((d: any) => d.dataText));
    expect((await room.since(world, 0)).filter(e => e.closed).length).toBe(1);

    // Opened once more, the room starts from the host's game again, whatever it held before
    NOW += 60_000;
    expect(await open.open(hostToken, host, manifestOf(world, host), [doc(`world_carts_${world}`, { carts: [] })])).toMatchObject({ ok: true, resumed: false });
    expect(JSON.parse((await room.take(world)).find(d => d.id === `world_carts_${world}`)!.dataText)).toEqual({ carts: [] });
  });

  it('an account deleted takes the worlds it opened out of the list', async () => {
    const { hostToken, guestToken, host, world } = await two();
    await open.open(hostToken, host, manifestOf(world, host), []);
    const who = await hub.session(hostToken);
    await new Eraser(hub, body.eraseHere, body.record).erase(who!.key);
    expect((await open.list(guestToken) as any).worlds.some((w: any) => w.worldUid === world)).toBe(false);
    expect(await hub.read(`hub_open_world_${world}`)).toBeNull();
  });
});

describe('in the game: a world that closes while someone is in it', () => {
  let server: Server;
  let origin: string;
  let shut = false;
  let liveRoom: LiveRoom;
  const WORLD = 'world_closing_1';

  beforeAll(async () => {
    const access: LiveAccess = async (_token, uid, worldUid) => {
      if (shut) return { ok: false, status: NOT_OPEN_STATUS, reason: 'Saltmarsh was closed to others by its host.' };
      return uid.startsWith('ws_') && worldUid === WORLD ? { ok: true, worldUid: WORLD } : { ok: false, status: 403, reason: 'Not let in.' };
    };
    liveRoom = new LiveRoom(body.store, access);
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path.startsWith('/api/hub/live')) return void liveRoom.http(req, res, path.slice('/api/hub/live'.length), tokenOf(req));
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, raw) => void liveRoom.upgrade(req, raw, tokenOf(req)));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    LiveClient.leave();
    StoreClient.useServer();
    server.closeAllConnections?.();
    await new Promise(r => server.close(() => r(undefined)));
    await liveRoom.close();
  });
  beforeEach(() => { shut = false; LiveClient.leave(); });

  /** This game's own store, saying what it was asked. */
  const ownStore = () => {
    const asked: string[] = [];
    StoreClient.useLocal(Promise.resolve({
      commit: async (c: any) => { asked.push(...c.ops.map((o: any) => `put ${o.doc.id}`)); return { applied: true }; },
      get: async (id: string) => { asked.push(`get ${id}`); return null; }
    }));
    return asked;
  };

  it('the socket names its world, and the room\'s closing event puts the game on its own copy: nothing waits on the room after', async () => {
    const asked = ownStore();
    LiveClient.join({ worldUid: WORLD, uid: 'ws_birch', origin, socket: url => new WebSocket(url) as any });
    await until(() => useLive.getState().status === 'LIVE');
    await StoreClient.commit({ commitId: `c1_${Date.now()}`, ops: [{ kind: 'put', doc: doc(`world_carts_${WORLD}`, { carts: ['a'] }) as any }] });
    expect(asked).toEqual([]);
    expect(LiveClient.isLive(WORLD)).toBe(true);

    // Its host closes it: the last event, told to everyone listening
    await liveRoom.shut(WORLD, `close_${Date.now()}`);
    await until(() => useLive.getState().status === 'CLOSED');
    expect(LiveClient.isLive(WORLD)).toBe(false);
    expect(LiveClient.world()).toBe(WORLD);
    expect(useLive.getState().reason).toMatch(/your own copy/);
    expect(await LiveClient.chests({ op: 'loot', chestId: 'q7_chest', cycle: 0, saw: null })).toBeNull();

    shut = true;
    await StoreClient.commit({ commitId: `c2_${Date.now()}`, ops: [{ kind: 'put', doc: doc(`world_carts_${WORLD}`, { carts: ['a', 'b'] }) as any }] });
    await StoreClient.get(`world_chests_${WORLD}`);
    expect(asked).toEqual([`put world_carts_${WORLD}`, `get world_chests_${WORLD}`]);

    LiveClient.leave();
    expect(useLive.getState().status).toBe('OFF');
  });

  it('a request the room answers "not open" is answered from the game\'s own store instead, the asking one among them', async () => {
    const asked = ownStore();
    LiveClient.join({ worldUid: WORLD, uid: 'ws_birch', origin, socket: url => new WebSocket(url) as any });
    await until(() => useLive.getState().status === 'LIVE');
    // The host stopped being heard from: no event says so, the room's next answer does
    shut = true;
    expect(await StoreClient.commit({ commitId: `c3_${Date.now()}`, ops: [{ kind: 'put', doc: doc(`world_population_${WORLD}`, { n: 1 }) as any }] })).toEqual({ applied: true });
    expect(asked).toEqual([`put world_population_${WORLD}`]);
    expect(useLive.getState()).toMatchObject({ status: 'CLOSED', reason: expect.stringMatching(/closed to others by its host\. You are on your own copy/) });
    expect(LiveClient.isLive(WORLD)).toBe(false);
  });

  it('the lobby saying a world is not open any more puts a game inside it on its own copy', async () => {
    const asked = ownStore();
    LiveClient.join({ worldUid: WORLD, uid: 'ws_birch', origin, socket: url => new WebSocket(url) as any });
    await until(() => useLive.getState().status === 'LIVE');
    LiveClient.fall('some_other_world');
    expect(LiveClient.isLive(WORLD)).toBe(true);
    LiveClient.fall(WORLD);
    expect(useLive.getState().status).toBe('CLOSED');
    await StoreClient.get(`world_carts_${WORLD}`);
    expect(asked).toEqual([`get world_carts_${WORLD}`]);
  });
});

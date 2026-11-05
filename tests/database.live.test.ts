// @vitest-environment node
/**
 * ONLINE PLAY (Pedro, 2026-11-04: "we serve a postgress we socket to join them and keep it live").
 * The world we host keeps what its players share in one store; commits stay HTTP, every change comes
 * to everyone over a socket, by number, and a player who drops asks for what they missed. These bars
 * stand on a real HTTP server and real sockets over a store in memory; the hub's word on who may is
 * a stand-in here (the hosted server asks HostedWorld.connect, barred in database.pool.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqlStore } from '../server/SqlStore';
import { openStore } from '../server/openStore';
import { LiveRoom, type LiveAccess } from '../server/live/room';
import { tokenOf } from '../server/hub/http';
import { StoreClient } from '../src/entities/data/StoreClient';
import { LiveClient, useLive, type ILiveEvent } from '../src/logic/live/LiveClient';
import { presence } from '../src/logic/live/Presence';

const WORLD = 'world_live_1';
const doc = (id: string, data: unknown, at = 1) => ({ id, namespace: 'territories', dataText: JSON.stringify(data), metadata: { createdAt: at, updatedAt: at, version: 1 } });
const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('Waited and it did not come.');
    await new Promise(r => setTimeout(r, 10));
  }
};

/** A socket from Node's own WebSocket, gathering what it is told. */
function listen(url: string) {
  const heard: any[] = [];
  const ws = new WebSocket(url);
  const opened = new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('refused')); });
  ws.onmessage = m => heard.push(JSON.parse(String(m.data)));
  return { ws, heard, opened };
}

describe('online play: the world we host, live', () => {
  let store: SqlStore;
  let room: LiveRoom;
  let server: Server;
  let origin: string;
  const access: LiveAccess = async (token, uid) => {
    if (uid === 'ws_barred') return { ok: false, status: 403, reason: 'Barred from this world.' };
    if (!uid.startsWith('ws_')) return { ok: false, status: 401, reason: 'Sign in to the hub first.' };
    return { ok: true, worldUid: WORLD };
  };

  beforeEach(async () => {
    store = await openStore('pglite://memory');
    room = new LiveRoom(store, access);
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path.startsWith('/api/hub/live')) return void room.http(req, res, path.slice('/api/hub/live'.length), tokenOf(req));
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, raw) => void room.upgrade(req, raw, tokenOf(req)));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    LiveClient.leave();
    server.closeAllConnections?.();
    await new Promise(r => server.close(() => r(undefined)));
    await store.close();
  });

  const post = (path: string, body: unknown, uid = 'ws_alder') =>
    fetch(`${origin}/api/hub/live${path}?uid=${uid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const commit = (id: string, data: unknown, commitId: string, uid = 'ws_alder') => post('/commit', { commitId, ops: [{ kind: 'put', doc: doc(id, data) }] }, uid);
  const socketUrl = (uid = 'ws_birch') => `${origin.replace('http', 'ws')}/api/hub/live/socket?uid=${uid}`;

  it('a commit on the world\'s own documents lands once, and is an event with the next number', async () => {
    const res = await commit(`world_carts_${WORLD}`, { carts: ['c1'] }, 'cm_1');
    expect(await res.json()).toEqual({ applied: true });
    expect(await (await commit(`world_carts_${WORLD}`, { carts: [] }, 'cm_1')).json()).toEqual({ applied: false });
    expect(await room.head(WORLD)).toBe(1);
    const got = await (await post('/get', { id: `world_carts_${WORLD}` })).json();
    expect(JSON.parse(got.doc.dataText)).toEqual({ carts: ['c1'] });
    // A world's chests are never written whole: they are claimed (below)
    expect((await commit(`world_chests_${WORLD}`, { chests: {}, guards: {} }, 'cm_whole')).status).toBe(400);
  });

  it('a commit that writes anything but the world\'s own documents is refused whole, and a character not let in is refused before its body is read', async () => {
    const mixed = await post('/commit', { commitId: 'cm_2', ops: [{ kind: 'put', doc: doc(`world_carts_${WORLD}`, {}) }, { kind: 'put', doc: doc('player_ws_alder', { gold: 1e9 }) }] });
    expect(mixed.status).toBe(400);
    expect(await room.head(WORLD)).toBe(0);
    expect(await store.get(`world_carts_${WORLD}`)).toBeNull();
    expect((await commit(`world_carts_${WORLD}`, {}, 'cm_3', 'ws_barred')).status).toBe(403);
    // Only the world's shared documents: its treasury, and anything in a house, are not the room's
    expect((await commit(`treasury_${WORLD}`, { gold: 1 }, 'cm_4')).status).toBe(400);
    expect((await commit(`home_chest_${WORLD}`, { items: [] }, 'cm_5')).status).toBe(400);
    expect((await post('/get', { id: 'player_ws_alder' })).status).toBe(400);
  });

  it('everyone listening is told every change, in order; one who joins late, or comes back, asks by number and misses nothing', async () => {
    const a = listen(socketUrl('ws_alder'));
    await a.opened;
    a.ws.send(JSON.stringify({ subscribe: `world:${WORLD}`, since: 0 }));
    await until(() => a.heard.some(m => m.ready));

    await commit(`world_population_${WORLD}`, { n: 1 }, 'e1');
    await commit(`world_carts_${WORLD}`, { n: 2 }, 'e2');
    await until(() => a.heard.filter(m => m.seq).length === 2);
    expect(a.heard.filter(m => m.seq).map(m => [m.seq, m.docs[0].id])).toEqual([[1, `world_population_${WORLD}`], [2, `world_carts_${WORLD}`]]);

    // Late, from nothing: both, then ready at 2
    const b = listen(socketUrl());
    await b.opened;
    b.ws.send(JSON.stringify({ subscribe: `world:${WORLD}`, since: 0 }));
    await until(() => b.heard.some(m => m.ready));
    expect(b.heard.map(m => m.seq ?? `ready ${m.ready.seq}`)).toEqual([1, 2, 'ready 2']);

    // Back after a drop, from 2: only what came since
    b.ws.close();
    await commit(`world_population_${WORLD}`, { n: 3 }, 'e3');
    const c = listen(socketUrl());
    await c.opened;
    c.ws.send(JSON.stringify({ subscribe: `world:${WORLD}`, since: 2 }));
    await until(() => c.heard.some(m => m.ready));
    expect(c.heard.map(m => m.seq ?? `ready ${m.ready.seq}`)).toEqual([3, 'ready 3']);
    a.ws.close();
    c.ws.close();
  });

  it('a chest is claimed in the order claims reach the room: the first gets it, the second is told someone reached it first, and the write is the room\'s, after (Pedro, 2026-11-04)', async () => {
    const claim = (uid: string, saw: number | null, cycle = 4) => post('/chests', { op: 'loot', chestId: 'q7_chest', cycle, saw }, uid);
    // Sent at once: the room takes them one at a time, in arrival order
    const [first, second] = await Promise.all([claim('ws_alder', null), claim('ws_birch', null)]);
    const answers = [await first.json(), await second.json()];
    expect(answers.filter(a => a.ok)).toHaveLength(1);
    const lost = answers.find(a => !a.ok)!;
    expect(lost).toMatchObject({ ok: false, reason: 'Someone reached it first.', record: { chests: { q7_chest: { lootedAt: 4 } } } });
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    // Restocked by a later cycle: whoever saw it as it stands claims it, once
    expect(await (await claim('ws_birch', 4, 9)).json()).toMatchObject({ ok: true, record: { chests: { q7_chest: { lootedAt: 9 } } } });
    expect((await claim('ws_alder', 4, 9)).status).toBe(409);
    // A guard's fall only moves forward, whoever reports it
    await post('/chests', { op: 'fell', guardId: 'q7_guard1', cycle: 6 });
    expect(await (await post('/chests', { op: 'fell', guardId: 'q7_guard1', cycle: 5 }, 'ws_birch')).json()).toMatchObject({ ok: true, record: { guards: { q7_guard1: { fellAt: 6 } } } });
    expect(await room.head(WORLD)).toBe(4);
  });

  it('a socket for another world, or for a character not let in, is refused', async () => {
    const a = listen(socketUrl());
    await a.opened;
    a.ws.send(JSON.stringify({ subscribe: 'world:somewhere_else', since: 0 }));
    await until(() => a.heard.some(m => m.refused));
    a.ws.close();
    const barred = listen(socketUrl('ws_barred'));
    await expect(barred.opened).rejects.toThrow();
  });

  it('where a player is goes to the others in the same place, under the socket\'s own uid, and is never kept; moving on or closing tells the place left they are gone (Pedro, 2026-11-05)', async () => {
    const where = (place: string, x: number, o: object = {}) => ({ where: { place, x, z: 4, facing: 'down', moving: true, t: 1000 + x, name: 'Alder', archetype: 'NOMAD', ...o } });
    const join = async (uid: string) => {
      const s = listen(socketUrl(uid));
      await s.opened;
      s.ws.send(JSON.stringify({ subscribe: `world:${WORLD}`, since: 0 }));
      await until(() => s.heard.some(m => m.ready));
      return s;
    };
    const alder = await join('ws_alder'), birch = await join('ws_birch'), cedar = await join('ws_cedar');
    birch.ws.send(JSON.stringify(where('field', 0)));
    cedar.ws.send(JSON.stringify(where('cellar', 0)));
    await new Promise(r => setTimeout(r, 50));
    // alder says where they are, claiming to be someone else: the room puts on the socket's own uid
    alder.ws.send(JSON.stringify(where('field', 12, { uid: 'ws_cedar', gold: 1e9 })));
    await until(() => birch.heard.some(m => m.where));
    expect(birch.heard.find(m => m.where).where).toEqual({ place: 'field', x: 12, z: 4, facing: 'down', moving: true, t: 1012, name: 'Alder', archetype: 'NOMAD', uid: 'ws_alder' });
    // Only the same place hears it, and the one who said it is not told back
    expect(cedar.heard.some(m => m.where)).toBe(false);
    expect(alder.heard.filter(m => m.where && m.where.uid === 'ws_alder')).toEqual([]);
    // Nothing of it is kept: no event, no document
    expect(await room.head(WORLD)).toBe(0);
    expect(await store.query({ namespace: 'live' })).toEqual([]);
    // Anything not the shape of a place is dropped where it lands
    alder.ws.send(JSON.stringify({ where: { place: 'field', x: 'everywhere' } }));
    // alder walks into the cellar: the field is told they are gone, the cellar hears them
    alder.ws.send(JSON.stringify(where('cellar', 20)));
    await until(() => birch.heard.some(m => m.gone) && cedar.heard.some(m => m.where));
    expect(birch.heard.filter(m => m.gone)).toEqual([{ gone: 'ws_alder' }]);
    expect(birch.heard.filter(m => m.where)).toHaveLength(1);
    // alder closes: the cellar is told
    alder.ws.close();
    await until(() => cedar.heard.some(m => m.gone));
    expect(cedar.heard.filter(m => m.gone)).toEqual([{ gone: 'ws_alder' }]);
    birch.ws.close();
    cedar.ws.close();
  });

  it('in the game: this player says where they are, at most ten times a second, and the others are drawn from what they hear', async () => {
    StoreClient.useLocal(Promise.resolve({ commit: async () => ({ applied: true }), get: async () => null }));
    const other = listen(socketUrl('ws_alder'));
    await other.opened;
    other.ws.send(JSON.stringify({ subscribe: `world:${WORLD}`, since: 0 }));
    await until(() => other.heard.some(m => m.ready));
    other.ws.send(JSON.stringify({ where: { place: WORLD, x: 0, z: 0, facing: 'down', moving: false, t: 5, name: 'Alder', archetype: 'NOMAD' } }));

    LiveClient.join({ worldUid: WORLD, uid: 'ws_birch', origin, socket: url => new WebSocket(url) as any });
    await until(() => useLive.getState().status === 'LIVE');
    const me = (x: number, t: number) => ({ place: WORLD, x, z: 0, facing: 'right' as const, moving: true, t, name: 'Birch', archetype: 'NOMAD' as const });
    // Every 16 ms frame for a second: said on the first frame 100 ms or more after the last, every 112 ms, so nine
    for (let t = 0; t < 1000; t += 16) LiveClient.say(me(t / 10, t), t);
    await until(() => other.heard.filter(m => m.where).length >= 9);
    await new Promise(r => setTimeout(r, 50));
    const told = other.heard.filter(m => m.where);
    expect(told.map(m => m.where.t)).toEqual([0, 112, 224, 336, 448, 560, 672, 784, 896]);
    expect(told.every(m => m.where.uid === 'ws_birch')).toBe(true);
    // alder said again (a still player, a second later): birch hears and draws them
    other.ws.send(JSON.stringify({ where: { place: WORLD, x: 30, z: 0, facing: 'down', moving: false, t: 1005, name: 'Alder', archetype: 'NOMAD' } }));
    await until(() => presence.at(WORLD, Date.now()).length === 1);
    expect(presence.at(WORLD, Date.now())[0]).toMatchObject({ uid: 'ws_alder', name: 'Alder', x: 30, moving: false });
    // Leaving the world: alder is told birch is gone, and birch draws no one
    LiveClient.leave();
    await until(() => other.heard.some(m => m.gone));
    expect(presence.size()).toBe(0);
    other.ws.close();
    StoreClient.useServer();
  });

  it('in the game: joining routes the world\'s documents to the room, and another player\'s change comes in over the socket; this game\'s own documents stay its own', async () => {
    const local: string[] = [];
    // This game's own store, in a stand-in: what reaches it is noted
    StoreClient.useLocal(Promise.resolve({ commit: async (c: any) => { local.push(...c.ops.map((o: any) => o.doc.id)); return { applied: true }; }, get: async () => null }));
    const heard: ILiveEvent[] = [];
    const stop = LiveClient.on(e => heard.push(e));
    LiveClient.join({ worldUid: WORLD, uid: 'ws_birch', origin, socket: url => new WebSocket(url) as any });
    await until(() => useLive.getState().status === 'LIVE');

    // birch's own commit: the world's part goes live; the rest, a house's chest among it, stays in this game
    expect(await StoreClient.commit({ commitId: 'g1', ops: [{ kind: 'put', doc: doc(`world_carts_${WORLD}`, { carts: ['a'] }) as any }, { kind: 'put', doc: doc('player_ws_birch', { gold: 5 }) as any }, { kind: 'put', doc: doc(`home_chest_${WORLD}`, { items: [] }) as any }] })).toEqual({ applied: true });
    expect(local).toEqual(['player_ws_birch', `home_chest_${WORLD}`]);
    expect(await room.head(WORLD)).toBe(1);

    // birch claims a chest through the room's queue; alder, elsewhere, empties another: birch hears it
    expect(await LiveClient.chests({ op: 'loot', chestId: 'a_chest', cycle: 1, saw: null })).toMatchObject({ ok: true, record: { chests: { a_chest: { lootedAt: 1 } } } });
    await post('/chests', { op: 'loot', chestId: 'b_chest', cycle: 2, saw: null });
    await until(() => heard.length === 3);
    const remote = JSON.parse(heard[2].docs[0].dataText);
    expect(remote).toEqual({ chests: { a_chest: { lootedAt: 1 }, b_chest: { lootedAt: 2 } }, guards: {} });
    expect(useLive.getState().seq).toBe(3);
    stop();
    LiveClient.leave();
    StoreClient.useServer();
  });
});

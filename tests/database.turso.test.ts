// @vitest-environment node
/**
 * THE HUB'S STORE ON TURSO ALONE (Pedro, 2026-11-13: "not neon, I'm not going to dabble in neon,
 * please rethink this option", and, to building the hub's store on Turso with no Postgres on the
 * host: "Yes, Turso only"). What the bars over both bodies cannot show, because only Turso's body
 * has it:
 *
 *   - a commit is ONE request, whole or not at all, and the database's own conditions decide it;
 *   - an answer lost on the way, or a request that lands after its sender gave up, lands once, and a
 *     retry says truly whether it landed;
 *   - two instances racing on one chain take one place each, and none is skipped;
 *   - taking a player out is one request on the store itself, with nothing left to wait on;
 *   - a write-down means nothing more where the store is Turso, and the daily call tidies the room;
 *   - its tables are its own, and a record written down into the same database never meets them;
 *   - the live room with no LISTEN and NOTIFY: where a player stands is never a row per move, and what
 *     it costs is counted.
 *
 * Over Turso's stand-in (tests/fixtures/record-double.ts): it proves the driver path and the SQL, and
 * nothing of Turso's own limits or timing. What the real one showed is in the ledger (HT rows).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { StoreConflict } from '../shared/SqlStore';
import type { ICommitRequest, IWireDoc } from '../shared/entities/data/wire';
import { openTursoStore, STORE_TABLES, type TursoStore } from '../server/tursoStore';
import { openColdDoor } from '../server/coldStore';
import { RECORD_TABLES } from '../server/recordRows';
import { tursoBus, tursoLines, TURSO_LIVE } from '../server/live/tursoLive';
import { LiveRoom, type LiveAccess } from '../server/live/room';
import { TalkLine } from '../shared/logic/live/TalkLine';
import { Hub } from '../server/hub/Hub';
import { makeHubKey } from '../server/hub/keys';
import { Eraser } from '../server/hub/erase';
import { startDouble, type IDouble } from './fixtures/turso-double';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const until = async (check: () => boolean | Promise<boolean>, ms = 4000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('Waited and it did not come.');
    await new Promise(r => setTimeout(r, 10));
  }
};
const rest = (ms: number) => new Promise(r => setTimeout(r, ms));

const wire = (id: string, namespace: string, data: unknown): IWireDoc => ({ id, namespace, dataText: JSON.stringify(data), metadata: { createdAt: 1000, updatedAt: 2000, version: 1 } });
function rowDoc(uid: string, seq: number, data: Record<string, unknown> = { amount: -1 }): IWireDoc {
  const signed = { payload: { seq, prevSeq: seq - 1, ts: 5000 + seq, type: 'GOLD_DELTA', data }, signature: `sig_${uid}_${seq}`, certUid: uid, timestamp: 9000 + seq };
  return { id: `ledger_${uid}_${seq.toString().padStart(8, '0')}`, namespace: 'transactions', dataText: JSON.stringify(signed), metadata: { createdAt: 5000 + seq, updatedAt: 5000 + seq, ownerCertUid: uid, signature: signed.signature, version: 1 } };
}
const headDoc = (uid: string, seq: number) => wire(`ledger_head_${uid}`, 'transactions', { seq });

let turso: IDouble;
beforeAll(async () => { turso = await startDouble(); }, 30_000);
afterAll(async () => { await turso?.stop(); });

describe('a commit on Turso is one request, and the database decides it', () => {
  let store: TursoStore;
  beforeEach(async () => {
    await turso.reset();
    store = await openTursoStore({ url: turso.url });
    // Its tables made, so what is counted below is the commits' own
    await store.health();
    await turso.seen();
  });
  afterEach(async () => { await store.close(); });

  it('a commit that writes a document, a ledger row, its head and a treasury at once crosses in one request', async () => {
    const out = await store.commit({ commitId: 'c1', ops: [
      { kind: 'put', doc: wire('hub_character_a', 'hub', { type: 'hub_character', uid: 'a' }) },
      { kind: 'put', doc: rowDoc('a', 1) },
      { kind: 'put', doc: headDoc('a', 1) },
      { kind: 'add', namespace: 'territories', id: 'treasury_w', amount: 5, at: 7 }
    ] });
    expect(out).toEqual({ applied: true });
    expect((await turso.seen()).pipelines).toBe(1);
    // A read is one request too, even where the store looks in two tables
    expect(JSON.parse((await store.get('ledger_a_00000001'))!.dataText).payload.seq).toBe(1);
    expect((await turso.seen()).pipelines).toBe(1);
  });

  it('a refused commit is one request that wrote nothing, and says why in the store\'s own words', async () => {
    await store.commit({ commitId: 'c1', ops: [{ kind: 'put', doc: rowDoc('a', 1) }] });
    await turso.seen();
    await expect(store.commit({ commitId: 'c2', ops: [
      { kind: 'put', doc: wire('keep', 'characters', { gold: 1 }) },
      { kind: 'put', doc: rowDoc('a', 3) }
    ] })).rejects.toThrow(/Ledger a is at seq 1; a row at seq 3 would break the chain/);
    expect((await turso.seen()).pipelines).toBe(1);
    expect(await store.get('keep')).toBeNull();
    expect(await turso.sql('SELECT COUNT(*) FROM store_commits WHERE id = ?', ['c2'])).toEqual([[0]]);
    // The same commit id, mended, still lands: a refusal leaves no mark
    expect(await store.commit({ commitId: 'c2', ops: [{ kind: 'put', doc: rowDoc('a', 2) }] })).toEqual({ applied: true });
  });

  it('a commit whose answer was lost lands once, and its retry says truly that it landed', async () => {
    await turso.fault({ mode: 'lost-answer', match: 'INSERT INTO store_commits' });
    const out = await store.commit({ commitId: 'lost', ops: [{ kind: 'add', namespace: 'territories', id: 'treasury_lost', amount: 10, at: 1 }] });
    expect(out).toEqual({ applied: true });
    expect(JSON.parse((await store.get('treasury_lost'))!.dataText)).toEqual({ gold: 10 });
    // Asked again by its sender later, it is the same commit: once
    expect(await store.commit({ commitId: 'lost', ops: [{ kind: 'add', namespace: 'territories', id: 'treasury_lost', amount: 10, at: 1 }] })).toEqual({ applied: false });
    expect(JSON.parse((await store.get('treasury_lost'))!.dataText)).toEqual({ gold: 10 });
  });

  it('a request that lands after its sender gave up on it lands nothing more than the retry did', async () => {
    await turso.fault({ mode: 'late-answer', match: 'INSERT INTO store_commits' });
    const out = await store.commit({ commitId: 'late', ops: [{ kind: 'add', namespace: 'territories', id: 'treasury_late', amount: 3, at: 1 }, { kind: 'put', doc: rowDoc('b', 1) }] });
    expect(out).toEqual({ applied: true });
    // On Turso such a request landed 1 to 5 seconds after its sender stopped (coldStore.ts)
    await turso.fault({ mode: 'land' });
    expect(JSON.parse((await store.get('treasury_late'))!.dataText)).toEqual({ gold: 3 });
    expect(await turso.sql('SELECT COUNT(*) FROM store_ledger_rows')).toEqual([[1]]);
  });

  it('two instances appending to one chain at once take one place each, and none is skipped', async () => {
    const other = await openTursoStore({ url: turso.url });
    try {
      const append = async (on: TursoStore, who: number) => {
        for (;;) {
          const head = await on.get('ledger_head_race');
          const seq = head ? JSON.parse(head.dataText).seq + 1 : 1;
          try {
            await on.commit({ commitId: randomUUID(), ops: [{ kind: 'put', doc: rowDoc('race', seq, { who }) }, { kind: 'put', doc: headDoc('race', seq) }] });
            return;
          } catch (e) {
            if (!(e instanceof StoreConflict)) throw e;
          }
        }
      };
      await Promise.all(Array.from({ length: 16 }, (_, i) => append(i % 2 ? other : store, i)));
      const rows = await store.query({ namespace: 'transactions', idPrefix: 'ledger_race_' });
      expect(rows.map(r => JSON.parse(r.dataText).payload.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
      expect(new Set(rows.map(r => JSON.parse(r.dataText).payload.data.who)).size).toBe(16);
    } finally {
      await other.close();
    }
  }, 30_000);

  it('a one-time guard taken by two instances at once lands once', async () => {
    const other = await openTursoStore({ url: turso.url });
    try {
      const grant = (on: TursoStore): Promise<{ applied: boolean }> => on.commit({ commitId: randomUUID(), guardAbsent: 'endowment_x', ops: [
        { kind: 'put', doc: wire('endowment_x', 'territories', { gold: 100 }) },
        { kind: 'add', namespace: 'territories', id: 'treasury_x', amount: 100, at: 1 }
      ] } as ICommitRequest);
      const results = await Promise.all([grant(store), grant(other), grant(store), grant(other)]);
      expect(results.filter(r => r.applied)).toHaveLength(1);
      expect(JSON.parse((await store.get('treasury_x'))!.dataText)).toEqual({ gold: 100 });
    } finally {
      await other.close();
    }
  });
});

describe('a line of people waiting to talk, kept on Turso by two instances at once', () => {
  it('every ask lands once, in a line both read the same: a change is never written over another', async () => {
    await turso.reset();
    const one = await openTursoStore({ url: turso.url });
    const two = await openTursoStore({ url: turso.url });
    try {
      const books = [await tursoLines(one), await tursoLines(two)];
      const key = 'w|field|npc_smith';
      await Promise.all(Array.from({ length: 12 }, (_, i) => books[i % 2].change(key, l => TalkLine.ask(l, `ws_${i}`, [], i).line)));
      const line = await books[0].read(key);
      expect(TalkLine.everyone(line).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `ws_${i}`).sort());
      expect(await books[1].read(key)).toEqual(line);
    } finally {
      await one.close();
      await two.close();
    }
  }, 30_000);
});

describe('taking a player out, where the store is Turso', () => {
  it('is one request on the store itself, whole, with nothing remembered and nothing left for a maintenance', async () => {
    await turso.reset();
    const store = await openTursoStore({ url: turso.url });
    try {
      const hub = new Hub(store, makeHubKey(), { publicUrl: 'https://hub.test', now: () => 1_800_000_000_000 });
      const eraser = new Eraser(hub, store, { on: false });
      await store.commit({ commitId: 'seed', ops: [
        { kind: 'put', doc: wire('hub_account_x', 'hub', { type: 'hub_account', handle: 'x' }) },
        { kind: 'put', doc: wire('hub_character_cx', 'hub', { type: 'hub_character', uid: 'cx', account: 'x' }) },
        { kind: 'put', doc: rowDoc('cx', 1) },
        { kind: 'put', doc: rowDoc('cx', 2) },
        { kind: 'put', doc: rowDoc('other', 1) }
      ] });
      await turso.seen();
      const gone = await store.erase(['hub_account_x', 'hub_character_cx'], ['cx']);
      expect(gone).toEqual({ rows: 2, documents: 2 });
      expect((await turso.seen()).pipelines).toBe(1);
      expect(await turso.sql('SELECT owner_uid FROM store_ledger_rows')).toEqual([['other']]);
      // Through the hub's own eraser: no note remembers the ids, and nothing waits on a record
      expect(await eraser.erase('x')).toEqual({ characters: 0, rows: 0, documents: 0, record: 'NONE' });
      expect(await store.query({ namespace: 'hub', filter: { 'data.type': 'hub_erase' } })).toEqual([]);
      expect(await eraser.sweep()).toBe(0);
    } finally {
      await store.close();
    }
  });
});

describe('the record, where the store is already Turso', () => {
  it('a write-down has nothing to write: every commit is already there, and it says so', async () => {
    await turso.reset();
    const store = await openTursoStore({ url: turso.url });
    try {
      expect(await store.writeDown('maintenance')).toMatchObject({ status: 'NOTHING', says: expect.stringMatching(/Turso/) });
      expect(await store.maintain()).toEqual({ ok: true });
      expect(await store.health()).toMatchObject({ ok: true, dialect: 'turso' });
    } finally {
      await store.close();
    }
  });

  it('the daily call tidies what the room left: places of instances long gone, and lines emptied long ago', async () => {
    await turso.reset();
    const store = await openTursoStore({ url: turso.url });
    try {
      await store.health();
      const day = 24 * 60 * 60_000;
      const now = Date.now();
      await turso.sql(`INSERT INTO store_live_places (world, instance, at, places) VALUES ('w', 'gone', ?, '{}'), ('w', 'here', ?, '{}')`, [now - 2 * day, now]);
      await turso.sql(`INSERT INTO store_live_lines (key, world, line, v, at, by) VALUES ('w|a|n', 'w', '', 3, ?, 'x'), ('w|b|n', 'w', '', 1, ?, 'x'), ('w|c|n', 'w', '{"turns":[{"who":["u"],"parties":{},"since":1,"last":1}]}', 1, ?, 'x')`, [now - 2 * day, now, now - 2 * day]);
      expect(await store.maintain()).toEqual({ ok: true });
      expect(await turso.sql('SELECT instance FROM store_live_places ORDER BY instance')).toEqual([['here']]);
      // An emptied line long ago goes; one emptied a moment ago stays, so other instances still read that it emptied; a line still held is never touched
      expect(await turso.sql('SELECT key FROM store_live_lines ORDER BY key')).toEqual([['w|b|n'], ['w|c|n']]);
    } finally {
      await store.close();
    }
  });

  it('its tables are its own: a record written down into the same database never meets them, and its migrations drop and alter nothing', async () => {
    const recordNames = new Set([...RECORD_TABLES.map(t => t.name), 'cold_writedowns', 'cold_jobs', 'cold_migrations', ...RECORD_TABLES.map(t => `cold_stage_${t.name}`)]);
    for (const name of STORE_TABLES) expect(recordNames.has(name), name).toBe(false);
    const folder = join(process.cwd(), 'drizzle', 'turso');
    for (const file of readdirSync(folder).filter(n => n.endsWith('.sql'))) {
      const text = readFileSync(join(folder, file), 'utf8');
      expect(text, file).not.toMatch(/\b(DROP|ALTER)\b/i);
      for (const made of text.matchAll(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS (\w+)/g)) expect(made[1].startsWith('store_'), made[1]).toBe(true);
    }

    await turso.reset();
    const store = await openTursoStore({ url: turso.url });
    const door = await openColdDoor({ url: turso.url });
    try {
      await store.commit({ commitId: 'mine', ops: [{ kind: 'put', doc: wire('same_id', 'hub', { from: 'the store' }) }] });
      expect(await door.writeDown({ id: 'wd_1', prev: null, why: 'test', at: 1, digest: 'd', rows: { documents: [{ id: 'same_id', namespace: 'hub', data: '{"from":"the record"}', embedding: null, doc_type: null, genre: null, owner_cert_uid: null, signature: null, version: 1, created_at: 1, updated_at: 1 }] } })).toEqual({ status: 'APPLIED' });
      expect(JSON.parse((await store.get('same_id'))!.dataText)).toEqual({ from: 'the store' });
      expect((await door.read('documents', ['same_id']))[0].data).toBe('{"from":"the record"}');
    } finally {
      door.close();
      await store.close();
    }
  });
});

// ================================================================================================
// THE ROOM WITH NO LISTEN AND NOTIFY: WHAT IT COSTS
// ================================================================================================

describe('the live room on Turso alone: a beat is the word, and a place is never a row per move', () => {
  const WORLD = 'world_cost';
  const access: LiveAccess = async () => ({ ok: true, worldUid: WORLD });
  /** Shortened twentyfold from what a host runs (TURSO_LIVE), so the bar takes seconds. The law is the same. */
  const SHORT = { beatMs: TURSO_LIVE.beatMs / 20, paceMs: TURSO_LIVE.paceMs / 20, aliveMs: TURSO_LIVE.aliveMs / 20, staleMs: TURSO_LIVE.staleMs / 20 };

  const sides: { room: LiveRoom; server: Server; origin: string; store: TursoStore }[] = [];
  const sockets: WebSocket[] = [];

  async function side() {
    const store = await openTursoStore({ url: turso.url });
    const room = new LiveRoom(store, access, Date.now, { bus: await tursoBus(store, SHORT), lines: await tursoLines(store), holdMs: 0, beatMs: 0 });
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path.startsWith('/api/hub/live')) return void room.http(req, res, path.slice('/api/hub/live'.length), 't');
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, raw) => void room.upgrade(req, raw, 't'));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const made = { room, server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
    sides.push(made);
    return made;
  }

  async function player(on: { origin: string }, uid: string) {
    const heard: any[] = [];
    const ws = new WebSocket(`${on.origin.replace('http', 'ws')}/api/hub/live/socket?uid=${uid}`);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('refused')); });
    ws.onmessage = m => heard.push({ at: Date.now(), ...JSON.parse(String(m.data)) });
    ws.send(JSON.stringify({ subscribe: `world:${WORLD}`, since: 'now' }));
    await until(() => heard.some(m => m.ready));
    const where = (x: number) => ws.send(JSON.stringify({ where: { place: 'field', x, z: 2, facing: 'down', moving: true, t: Date.now(), name: uid, archetype: 'NOMAD' } }));
    return { heard, where };
  }

  const placeWrites = (seen: { statements: string[] }) => seen.statements.filter(s => /^INSERT INTO store_live_places/.test(s)).length;

  beforeEach(async () => { await turso.reset(); });
  afterEach(async () => {
    for (const ws of sockets.splice(0)) { try { ws.close(); } catch { /* closed already */ } }
    for (const s of sides.splice(0)) { await s.room.close(); s.server.closeAllConnections(); await new Promise<void>(r => s.server.close(() => r())); await s.store.close(); }
  });

  it('one player alone on one instance, saying where they are ten times a second: one request a beat, and one place row in all', async () => {
    const one = await side();
    const alder = await player(one, 'ws_alder');
    await rest(SHORT.beatMs * 2);
    await turso.seen();
    const span = SHORT.beatMs * 40;
    let said = 0;
    const started = Date.now();
    while (Date.now() - started < span) { alder.where(said++); await rest(SHORT.beatMs / 5); }
    const seen = await turso.seen();
    // A beat is one request, whatever the player says in it, and saying where is never a write while nobody else could hear
    expect(seen.pipelines).toBeLessThanOrEqual(Math.ceil(span / SHORT.beatMs) + 2);
    expect(placeWrites(seen)).toBe(0);
    expect(said).toBeGreaterThan(60);
  }, 30_000);

  it('two instances, a player on each: one walking, one standing. Places are written at a pace per instance, never per move, and reach the other within a pace and a beat', async () => {
    const one = await side();
    const two = await side();
    const alder = await player(one, 'ws_alder');
    const birch = await player(two, 'ws_birch');
    // Both in the field: a place is passed only to those standing in it
    alder.where(0);
    birch.where(0);
    await until(() => alder.heard.some(m => m.where?.uid === 'ws_birch') && birch.heard.some(m => m.where?.uid === 'ws_alder'));
    await turso.seen();

    const span = SHORT.beatMs * 60;
    const sent: { x: number; at: number }[] = [];
    const started = Date.now();
    let x = 0;
    let standing = 0;
    while (Date.now() - started < span) {
      alder.where(++x);
      sent.push({ x, at: Date.now() });
      // Standing still, a browser says it again once a second: here once a beat
      if (++standing % 5 === 0) birch.where(0);
      await rest(SHORT.beatMs / 5);
    }
    await rest(SHORT.paceMs + SHORT.beatMs * 2);
    const seen = await turso.seen();

    // Walking: at most one row a pace. Standing: at most one a heartbeat. Never one a move
    const most = Math.ceil(span / SHORT.paceMs) + Math.ceil(span / SHORT.aliveMs) + 4;
    expect(placeWrites(seen)).toBeLessThanOrEqual(most);
    expect(placeWrites(seen)).toBeLessThan(x / 3);
    // Two instances, each one request a beat, and the writes ride inside those requests
    expect(seen.pipelines).toBeLessThanOrEqual(2 * (Math.ceil((span + SHORT.paceMs + SHORT.beatMs * 2) / SHORT.beatMs) + 2));

    // birch saw alder walk, and the last place said reached them
    const seenOfAlder = birch.heard.filter(m => m.where?.uid === 'ws_alder' && m.where.x > 0);
    expect(seenOfAlder.at(-1)?.where.x).toBe(x);
    // How late: each place birch was first told, against when alder said it (a place standing is said again now and then,
    // which is not lateness). Within a pace and a beat, and a little for the requests
    const first = new Map<number, number>();
    for (const m of seenOfAlder) if (!first.has(m.where.x)) first.set(m.where.x, m.at);
    const late = [...first].map(([x, at]) => at - sent.find(s => s.x === x)!.at);
    expect(Math.max(...late)).toBeLessThanOrEqual(SHORT.paceMs + 2 * SHORT.beatMs + 150);
  }, 30_000);

  it('an event landed on one instance reaches a socket on the other within a beat, and an idle beat writes nothing', async () => {
    const one = await side();
    const two = await side();
    const birch = await player(two, 'ws_birch');
    await rest(SHORT.beatMs * 3);
    await turso.seen();
    await rest(SHORT.beatMs * 10);
    const idle = await turso.seen();
    expect(idle.statements.filter(s => /^(INSERT|UPDATE|DELETE)/.test(s))).toEqual([]);

    const at = Date.now();
    const res = await fetch(`${one.origin}/api/hub/live/commit?uid=ws_alder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commitId: 'e1', ops: [{ kind: 'put', doc: wire(`world_carts_${WORLD}`, 'territories', { n: 1 }) }] }) });
    expect(await res.json()).toEqual({ applied: true });
    await until(() => birch.heard.some(m => m.seq === 1));
    expect(birch.heard.find(m => m.seq === 1).at - at).toBeLessThanOrEqual(SHORT.beatMs + 150);
  }, 30_000);
});

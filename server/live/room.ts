/**
 * ONLINE PLAY: THE WORLD WE HOST, SHARED LIVE (Pedro, 2026-11-04: "the DB layer needs to be local
 * (idb) or postgress for online play, we serve a postgress we socket to join them and keep it live
 * speaking to the Turso DB, which they can't access, and they run the code locally on the browser").
 *
 * The game still runs in each player's browser. What the players of our world share (its chests,
 * its carts, its population: every document whose id carries the world's uid) lives in one Postgres
 * on the hosted server, kept by the keeper that writes it down to Turso (server/record.ts). Players
 * never reach Turso.
 *
 * COMMANDS STAY HTTP, EVENTS COME OVER A SOCKET (DATA_LAYER_PLAN §7). A commit is the same idempotent
 * request the game already makes, to /api/hub/live/commit. Each one that lands is also an event, kept
 * in the same transaction with the next number on its channel, so a player who drops and comes back
 * asks for what they missed by number and gets every event since, from the store: nothing is held in
 * memory that a restart would lose, and no window of events is dropped.
 *
 * A WORLD'S CHESTS ARE CLAIMED, NEVER WRITTEN WHOLE (Pedro: "queue it, the first or best lag gets the
 * first spot, the write happens AFTER"): /chests takes one claim at a time, in arrival order.
 *
 *   server -> client   { channel: 'world:<uid>', seq, docs: [IWireDoc] } | { ready: { channel, seq } } | { refused }
 *   client -> server   { subscribe: 'world:<uid>', since: <seq> | 'now' }
 *
 * OTHER PLAYERS: where each is, passed on and never kept (shared/logic/live/Presence.ts).
 *   client -> server   { where: IWhere } | { gone: true }
 *   server -> client   { where: IWhere & { uid } } | { gone: <uid> }   to those in the same place only
 *
 * ONE CONVERSATION AT A TIME (shared/logic/live/TalkLine.ts): someone being talked to hears one turn,
 * and the rest wait in line in the order they reached the room.
 *   client -> server   { talk: { op: 'ask' | 'said' | 'leave', npc, party? } }
 *   server -> client   { line: { npc, focus: [uid], waiting: [[uid]] } }   to everyone in that line, and to one who left it
 *
 * WHO MAY. Every request and every socket names a character, and the hub's own check decides
 * (HostedWorld.connect, asked over the hub's route so this file holds no account logic): the account
 * holds it, it is in good standing on our world and on the hub, and it owes the hub no receipts.
 * A world's documents only: anything else in a commit is refused whole.
 *
 * SEVERAL INSTANCES, ONE ROOM. A function host runs as many instances of this as it likes and pins
 * each socket to one (DEPLOY.md), so nothing below may live in one instance's memory alone:
 *   - the order of events is the database's: an event takes its number only if nobody holds it yet,
 *     and one that finds it taken reads again and takes the next. A chest is decided again on what
 *     stands then, so the first claim to land is still the only one that wins;
 *   - each instance tells its own sockets, in order, from the store. A nudge from the instance that
 *     landed something makes that at once (bus.ts), and a slow beat makes it anyway;
 *   - where a player stands is passed between instances as it is said;
 *   - a line is kept in the room's own table (lines.ts), and each instance tells its own of a change;
 *   - a socket the host closed on its timer comes back a moment later, perhaps elsewhere, so a
 *     player whose socket closed is held in their place and their lines for `holdMs` first.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { SqlStore } from '../../shared/SqlStore';
import type { CommitOp, ICommitRequest, IWireDoc, IWireQuery } from '../../shared/entities/data/wire';
import { acceptSocket, type ISocket } from './socket';
import { isShared, type ChestIntent } from '../../shared/logic/live/shared';
import { ChestSystem, emptyChestRecord, type IChestRecord } from '../../shared/entities/world/ChestSystem';
import { isWhere, whereOf } from '../../shared/logic/live/Presence';
import { TalkLine, emptyLine, type ILine } from '../../shared/logic/live/TalkLine';
import { soloBus, type ILiveBus } from './bus';
import { memoryLines, type ILineBook } from './lines';

/** One shape, ok or not: this project compiles without strict null checks, where a union on `ok` does not narrow. */
export type LiveAccess = (token: string, uid: string) => Promise<{ ok: boolean; worldUid?: string; status?: number; reason?: string }>;

const LIVE_NS = 'live';
const channelOf = (worldUid: string) => `world:${worldUid}`;
const headId = (worldUid: string) => `live_head_${worldUid}`;
const eventId = (worldUid: string, seq: number) => `live_event_${worldUid}_${seq.toString().padStart(12, '0')}`;

/** The world's shared documents only (shared.ts): a house's chests and everything else stay in the browser. */
export const ownedBy = isShared;
const chestsId = (worldUid: string) => `world_chests_${worldUid}`;

export interface ILiveEvent { channel: string; seq: number; at: number; docs: IWireDoc[] }

export interface ILiveParts {
  /** The word between instances. One instance alone needs none. */
  bus?: ILiveBus;
  /** Where the lines are kept. One instance alone keeps them in memory. */
  lines?: ILineBook;
  /** How long a player whose socket closed is still held in their place and lines. 0 lets go at once. */
  holdMs?: number;
  /** How often the numbers are looked at again, whatever was heard. */
  beatMs?: number;
}

/** Past this many events behind, one read of them all is cheaper than asking for each. */
const ASK_EACH_UP_TO = 256;
const BEAT_MS = 5_000;

export class LiveRoom {
  /** Commits land one at a time here, so this instance asks the database for one number at a time. */
  private line: Promise<unknown> = Promise.resolve();
  private readonly listening = new Map<string, Set<ISocket>>();
  /** Where each socket's player last said they were: held only while the socket is open. */
  private readonly places = new Map<ISocket, string>();
  /** Each open socket's player, as checked when it opened. */
  private readonly players = new Map<ISocket, string>();
  /** The last event this instance told its own sockets of, by world. */
  private readonly told = new Map<string, number>();
  private readonly catching = new Map<string, Promise<void>>();
  /** Each line as this instance last saw it: who to tell of a change, and what its operator reads. */
  private readonly seen = new Map<string, ILine>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Players whose socket closed, held a moment in case it comes back. */
  private readonly holds = new Map<string, { place: string; timer: ReturnType<typeof setTimeout> }>();
  private beat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly bus: ILiveBus;
  private readonly lines: ILineBook;
  private readonly holdMs: number;
  private readonly beatMs: number;
  private readonly stopHearing: () => void;

  constructor(private readonly store: SqlStore, private readonly access: LiveAccess, private readonly now: () => number = Date.now, parts: ILiveParts = {}) {
    this.bus = parts.bus ?? soloBus();
    this.lines = parts.lines ?? memoryLines();
    this.holdMs = parts.holdMs ?? 0;
    this.beatMs = parts.beatMs ?? BEAT_MS;
    this.stopHearing = this.bus.hear(word => this.heard(word));
  }

  private doc(id: string, data: object): IWireDoc {
    const at = this.now();
    return { id, namespace: LIVE_NS, dataText: JSON.stringify(data), metadata: { createdAt: at, updatedAt: at, version: 1 } };
  }

  async head(worldUid: string): Promise<number> {
    const doc = await this.store.get(headId(worldUid));
    return doc ? Number(JSON.parse(doc.dataText).seq) || 0 : 0;
  }

  /** Every event after `since`, in order, from the store. */
  async since(worldUid: string, since: number): Promise<ILiveEvent[]> {
    const head = await this.head(worldUid);
    if (!(since < head)) return [];
    if (head - since <= ASK_EACH_UP_TO) {
      const events: ILiveEvent[] = [];
      for (let seq = Math.max(0, Math.floor(since)) + 1; seq <= head; seq++) {
        const doc = await this.store.get(eventId(worldUid, seq));
        if (doc) events.push(JSON.parse(doc.dataText) as ILiveEvent);
      }
      return events;
    }
    const docs = await this.store.query({ namespace: LIVE_NS, idPrefix: `live_event_${worldUid}_` });
    return docs.map(d => JSON.parse(d.dataText) as ILiveEvent).filter(e => e.seq > since).sort((a, b) => a.seq - b.seq);
  }

  async get(worldUid: string, id: string) {
    if (!ownedBy(worldUid, id)) return { status: 400, body: { error: 'Online play reads only this world\'s own documents.' } };
    return { status: 200, body: { doc: await this.store.get(id) } };
  }

  async query(worldUid: string, q: IWireQuery) {
    const docs = (await this.store.query(q)).filter(d => ownedBy(worldUid, d.id));
    return { status: 200, body: { docs } };
  }

  /** One at a time, in the order they came: a channel's numbers, and a chest's first claim, are the order things reached the room. */
  private queued<T>(run: () => Promise<T>): Promise<T> {
    const next = this.line.then(run, run);
    this.line = next.catch(() => undefined);
    return next;
  }

  /**
   * Documents and their event at one number, in one transaction, if nobody holds that number yet.
   * False means it did not land: another instance took the number first, or this very commit
   * landed before and is being asked again.
   */
  private async landAt(worldUid: string, seq: number, commitId: string, ops: CommitOp[]): Promise<boolean> {
    const event: ILiveEvent = { channel: channelOf(worldUid), seq, at: this.now(), docs: ops.map(op => (op as { doc: IWireDoc }).doc) };
    const result = await this.store.commit({
      commitId,
      guardAbsent: eventId(worldUid, seq),
      ops: [...ops, { kind: 'putIfAbsent', doc: this.doc(eventId(worldUid, seq), event) }, { kind: 'put', doc: this.doc(headId(worldUid), { seq }) }]
    });
    if (!result.applied) return false;
    this.landed(worldUid, event);
    return true;
  }

  /** At the next number, whichever that turns out to be. Inside the queue only. */
  private async land(worldUid: string, commitId: string, ops: CommitOp[]): Promise<{ applied: boolean }> {
    for (;;) {
      const seq = (await this.head(worldUid)) + 1;
      if (await this.landAt(worldUid, seq, commitId, ops)) return { applied: true };
      // Nobody took that number, so the commit itself is one that landed before: applied once, as asked
      if ((await this.head(worldUid)) < seq) return { applied: false };
    }
  }

  /** What landed here is told here at once, and the other instances are nudged to tell their own. */
  private landed(worldUid: string, event: ILiveEvent) {
    const was = this.told.get(worldUid);
    if (was !== undefined) {
      if (event.seq === was + 1) { this.tell(worldUid, event); this.told.set(worldUid, event.seq); }
      else void this.catchUp(worldUid);
    }
    this.bus.say({ e: worldUid, seq: event.seq });
  }

  /** Every event this instance's sockets have not been told, in order, from the store. One catching up at a time for a world. */
  private catchUp(worldUid: string): Promise<void> {
    const run = (this.catching.get(worldUid) ?? Promise.resolve()).then(async () => {
      const from = this.told.get(worldUid);
      if (from === undefined || !this.listening.get(worldUid)?.size) return;
      for (const event of await this.since(worldUid, from)) {
        if (event.seq <= (this.told.get(worldUid) ?? 0)) continue;
        this.tell(worldUid, event);
        this.told.set(worldUid, event.seq);
      }
    }).catch(e => { console.error('[LIVE] Catching up on a world failed, and is tried again on the next beat:', e); });
    this.catching.set(worldUid, run);
    return run;
  }

  /** A commit on the world's shared documents. A world's chests are claimed, never written whole (chests below). */
  commit(worldUid: string, request: ICommitRequest) {
    return this.queued(async () => {
      if (!request || typeof request.commitId !== 'string' || !Array.isArray(request.ops)) return { status: 400, body: { error: 'That is not a commit.' } };
      const stray = request.ops.find((op: CommitOp) => op.kind === 'add' || !ownedBy(worldUid, op.doc.id));
      if (stray) return { status: 400, body: { error: 'Online play writes only this world\'s shared documents. Nothing in this commit was applied.' } };
      if (request.ops.some(op => (op as { doc: IWireDoc }).doc.id === chestsId(worldUid))) return { status: 400, body: { error: 'A world\'s chests are claimed one at a time, at /chests. Nothing in this commit was applied.' } };
      try {
        return { status: 200, body: await this.land(worldUid, request.commitId, request.ops) };
      } catch (e) {
        const name = (e as Error)?.name;
        if (name === 'StoreConflict') return { status: 409, body: { conflict: true, error: (e as Error).message } };
        if (name === 'StoreRefusal') return { status: 400, body: { error: (e as Error).message } };
        throw e;
      }
    });
  }

  /**
   * A chest claimed, or a guard fallen (Pedro: "queue it, the first or best lag gets the first spot,
   * the write happens AFTER"). Claims are taken in the order they reach the room. A claim names what
   * its player saw of the chest; if that is no longer what stands, someone reached it first, and the
   * claim is refused with the record as it stands. The write is the room's, after the claim is decided.
   * If another instance lands anything in between, the claim is decided again on what stands then.
   */
  chests(worldUid: string, intent: ChestIntent) {
    return this.queued(async () => {
      const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
      if (!intent || !whole(intent.cycle)) return { status: 400, body: { ok: false, reason: 'A claim names its cycle.' } };
      for (;;) {
        const stood = await this.head(worldUid);
        const held = await this.store.get(chestsId(worldUid));
        const record: IChestRecord = held ? JSON.parse(held.dataText) : emptyChestRecord();
        let next: IChestRecord;
        if (intent.op === 'loot') {
          if (!ChestSystem.isChest(intent.chestId)) return { status: 400, body: { ok: false, reason: 'That is not a chest.' } };
          const stands = record.chests[intent.chestId]?.lootedAt ?? null;
          if (stands !== intent.saw) return { status: 409, body: { ok: false, first: false, reason: 'Someone reached it first.', record } };
          if (stands !== null && intent.cycle < stands) return { status: 400, body: { ok: false, reason: 'A claim cannot come from a cycle before the one that stands.' } };
          next = ChestSystem.looted(record, intent.chestId, intent.cycle);
        } else if (intent.op === 'fell') {
          if (typeof intent.guardId !== 'string' || !ChestSystem.chestOfGuard(intent.guardId)) return { status: 400, body: { ok: false, reason: 'That is not a chest\'s guard.' } };
          // A fall only moves forward: two players felling one guard leave the later cycle
          next = ChestSystem.merge(record, { chests: {}, guards: { [intent.guardId]: { fellAt: intent.cycle } } });
        } else {
          return { status: 400, body: { ok: false, reason: 'A claim loots a chest or fells a guard.' } };
        }
        const at = this.now();
        const doc: IWireDoc = { id: chestsId(worldUid), namespace: 'territories', dataText: JSON.stringify(next), metadata: { createdAt: held?.metadata.createdAt ?? at, updatedAt: at, ownerCertUid: 'SYSTEM', version: 1 } };
        // A commit of its own each try, so one that does not land can only mean the number was taken
        if (await this.landAt(worldUid, stood + 1, `chests_${worldUid}_${at}_${Math.random().toString(36).slice(2)}`, [{ kind: 'put', doc }])) {
          return { status: 200, body: { ok: true, record: next } };
        }
      }
    });
  }

  private tell(worldUid: string, event: ILiveEvent) {
    const text = JSON.stringify(event);
    for (const s of this.listening.get(worldUid) ?? []) s.send(text);
  }

  /** HTTP: /get, /query, /commit, each with ?uid= naming the character, checked before the body is read. */
  async http(req: IncomingMessage, res: ServerResponse, path: string, token: string) {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://live');
    const may = await this.access(token, url.searchParams.get('uid') ?? '');
    if (!may.ok || !may.worldUid) return send(may.status ?? 403, { error: may.reason ?? 'Not let in.' });
    if (req.method !== 'POST') return send(405, { error: 'Online play asks by POST.' });
    let body: any;
    try {
      body = JSON.parse(await readAll(req) || '{}');
    } catch {
      return send(400, { error: 'That is not JSON.' });
    }
    const worldUid = may.worldUid;
    const out = path === '/get' ? await this.get(worldUid, String(body.id ?? ''))
      : path === '/query' ? await this.query(worldUid, body)
      : path === '/commit' ? await this.commit(worldUid, body)
      : path === '/chests' ? await this.chests(worldUid, body)
      : { status: 404, body: { error: `No such door: ${path}` } };
    send(out.status, out.body);
  }

  /** The socket: checked as the upgrade comes, then a channel subscribed from a number. */
  async upgrade(req: IncomingMessage, raw: Duplex, token: string) {
    const url = new URL(req.url ?? '/', 'http://live');
    const may = await this.access(token, url.searchParams.get('uid') ?? '');
    if (!may.ok || !may.worldUid) {
      raw.end(`HTTP/1.1 ${may.status ?? 403} Refused\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${may.reason}`);
      return;
    }
    const socket = acceptSocket(req, raw);
    if (!socket) return;
    const worldUid = may.worldUid;
    const uid = url.searchParams.get('uid') ?? '';
    this.players.set(socket, uid);
    socket.onMessage(async text => {
      let asked: { subscribe?: string; since?: number | string; where?: unknown; gone?: unknown; talk?: unknown };
      try { asked = JSON.parse(text); } catch { return socket.send(JSON.stringify({ refused: 'That is not JSON.' })); }
      try {
        // Where this player is, passed on and never kept (Presence.ts)
        if (asked.where !== undefined) return this.where(worldUid, uid, socket, asked.where);
        if (asked.gone !== undefined) return void await this.left(worldUid, uid, socket);
        if (asked.talk !== undefined) return void await this.talk(worldUid, uid, socket, asked.talk);
        if (asked.subscribe !== channelOf(worldUid)) return socket.send(JSON.stringify({ refused: `This socket is for ${channelOf(worldUid)}.` }));
        const listeners = this.listening.get(worldUid) ?? new Set<ISocket>();
        this.listening.set(worldUid, listeners);
        // Listening first, then what was missed: an event that lands in between is sent twice, and a client keeps the higher number
        listeners.add(socket);
        // From its first listener on, this instance tells every event of the world in order
        if (!this.told.has(worldUid)) this.told.set(worldUid, await this.head(worldUid));
        this.startBeat();
        // 'now' is for a first join, which reads the documents themselves and needs none of what came before
        const since = asked.since === 'now' ? Infinity : Number.isFinite(asked.since) ? Number(asked.since) : 0;
        for (const e of await this.since(worldUid, since)) socket.send(JSON.stringify(e));
        socket.send(JSON.stringify({ ready: { channel: channelOf(worldUid), seq: await this.head(worldUid) } }));
      } catch (e) {
        console.error('[LIVE] A socket\'s message failed:', e);
      }
    });
    socket.onClose(() => {
      const place = this.places.get(socket);
      this.places.delete(socket);
      this.listening.get(worldUid)?.delete(socket);
      this.players.delete(socket);
      if (place === undefined || this.closed) return;
      // Still here on another socket of this instance: nothing was left
      for (const [other, who] of this.players) if (who === uid && this.places.get(other) === place) return;
      if (this.holdMs <= 0) return this.quietly(this.away(worldUid, uid, place, null));
      const key = holdKey(worldUid, uid);
      const timer = setTimeout(() => { this.holds.delete(key); if (!this.closed) this.quietly(this.away(worldUid, uid, place, null)); }, this.holdMs);
      (timer as { unref?: () => void }).unref?.();
      this.holds.set(key, { place, timer });
    });
  }

  private startBeat() {
    if (this.beat || this.beatMs <= 0) return;
    this.beat = setInterval(() => {
      for (const [worldUid, sockets] of this.listening) if (sockets.size > 0) void this.catchUp(worldUid);
    }, this.beatMs);
    (this.beat as { unref?: () => void }).unref?.();
  }

  /** What another instance said (bus.ts). */
  private heard(word: any) {
    if (this.closed || !word || typeof word !== 'object') return;
    if (word.again) { for (const worldUid of this.listening.keys()) void this.catchUp(worldUid); return; }
    if (typeof word.e === 'string') return void this.catchUp(word.e);
    const p = word.p;
    if (p && typeof p.world === 'string' && typeof p.place === 'string' && p.where && typeof p.where.uid === 'string') {
      this.quietly(this.back(p.world, p.where.uid, p.place));
      return this.tellPlace(p.world, p.place, null, { where: p.where });
    }
    const g = word.g;
    if (g && typeof g.world === 'string' && typeof g.place === 'string' && typeof g.uid === 'string') return this.tellPlace(g.world, g.place, null, { gone: g.uid });
    const l = word.l;
    if (l && typeof l.world === 'string' && typeof l.key === 'string' && typeof l.npc === 'string') this.quietly(this.lineHeard(l.world, l.key, l.npc));
  }

  /**
   * OTHER PLAYERS (Presence.ts). A player says where they are; the room puts on who said it and
   * passes it to everyone listening in the same place, on every instance, and keeps none of it: one
   * lost in a restart is said again a moment later. The uid is the socket's own, checked as it
   * opened, never the message's. Moving to another place, or closing, tells the place left that
   * they are gone.
   */
  private where(worldUid: string, uid: string, socket: ISocket, told: unknown) {
    if (!isWhere(told)) return;
    const said = whereOf(told);
    const was = this.places.get(socket);
    if (was !== undefined && was !== said.place) this.quietly(this.away(worldUid, uid, was, socket));
    this.quietly(this.back(worldUid, uid, said.place));
    this.places.set(socket, said.place);
    const where = { ...said, uid };
    this.tellPlace(worldUid, said.place, socket, { where });
    this.bus.say({ p: { world: worldUid, place: said.place, where } });
  }

  /** A player held after their socket closed is heard from again, here or on another instance: they never left. */
  private async back(worldUid: string, uid: string, place: string) {
    const key = holdKey(worldUid, uid);
    const held = this.holds.get(key);
    if (!held) return;
    clearTimeout(held.timer);
    this.holds.delete(key);
    // Back, but somewhere else: the place they were held in is left after all
    if (held.place !== place) await this.away(worldUid, uid, held.place, null);
  }

  /** The player said they left the place they stood in. */
  private async left(worldUid: string, uid: string, socket: ISocket) {
    const was = this.places.get(socket);
    if (was === undefined) return;
    this.places.delete(socket);
    await this.away(worldUid, uid, was, socket);
  }

  /** Gone from a place: out of every line there, and everyone there is told, on every instance. */
  private async away(worldUid: string, uid: string, place: string, from: ISocket | null) {
    this.tellPlace(worldUid, place, from, { gone: uid });
    this.bus.say({ g: { world: worldUid, place, uid } });
    await this.leaveLines(worldUid, place, uid);
  }

  /**
   * ONE CONVERSATION AT A TIME (TalkLine.ts). A player asks to talk with someone in the place they
   * stand, says something in their turn, or leaves the line. Everyone in the line is told who is
   * heard and who waits. The uid is the socket's own, never the message's.
   */
  private async talk(worldUid: string, uid: string, socket: ISocket, told: unknown) {
    const t = told as { op?: unknown; npc?: unknown; party?: unknown };
    const place = this.places.get(socket);
    if (!t || typeof t !== 'object' || typeof t.npc !== 'string' || !t.npc || place === undefined) return;
    if (t.op !== 'ask' && t.op !== 'said' && t.op !== 'leave') return;
    const party = Array.isArray(t.party) ? t.party.filter((p): p is string => typeof p === 'string') : [];
    const key = lineKey(worldUid, place, t.npc);
    const now = this.now();
    const { was, next, changed } = await this.lines.change(key, line =>
      t.op === 'ask' ? TalkLine.ask(line, uid, party, now).line
        : t.op === 'said' ? TalkLine.said(line, uid, now)
        : TalkLine.leave(line, uid));
    // Asking again, already in line, still tells them where they stand
    this.lineChanged(worldUid, key, t.npc, was, next, changed, t.op === 'ask' ? [uid] : []);
  }

  /** A player gone from a place leaves every line there. */
  private async leaveLines(worldUid: string, place: string, uid: string) {
    const prefix = lineKey(worldUid, place, '');
    for (const [key, line] of await this.lines.under(prefix)) {
      if (!TalkLine.everyone(line).includes(uid)) continue;
      const { was, next, changed } = await this.lines.change(key, l => TalkLine.leave(l, uid));
      this.lineChanged(worldUid, key, key.slice(prefix.length), was, next, changed, []);
    }
  }

  /** A line changed here: this instance's own are told, the others are nudged, and its silence is watched. */
  private lineChanged(worldUid: string, key: string, npc: string, was: ILine, next: ILine, changed: boolean, alsoTell: string[]) {
    this.keep(key, next);
    this.tellLine(worldUid, npc, next, new Set([...TalkLine.everyone(was), ...TalkLine.everyone(next), ...alsoTell]));
    if (changed) this.bus.say({ l: { world: worldUid, key, npc } });
    this.watch(worldUid, key, npc, next);
  }

  /** Another instance changed a line: read as it stands, and this instance's own are told. */
  private async lineHeard(worldUid: string, key: string, npc: string) {
    const was = this.seen.get(key) ?? emptyLine();
    const next = await this.lines.read(key);
    this.keep(key, next);
    this.tellLine(worldUid, npc, next, new Set([...TalkLine.everyone(was), ...TalkLine.everyone(next)]));
    this.watch(worldUid, key, npc, next);
  }

  private keep(key: string, line: ILine) {
    if (line.turns.length === 0) this.seen.delete(key);
    else this.seen.set(key, line);
  }

  /** A turn that sits silent while someone waits is let go when its time comes, by whichever instance gets there first. */
  private watch(worldUid: string, key: string, npc: string, line: ILine) {
    const timer = this.idleTimers.get(key);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(key);
    const at = TalkLine.idleAt(line);
    if (at === null) return;
    const wake = setTimeout(async () => {
      this.idleTimers.delete(key);
      if (this.closed) return;
      try {
        const { was, next, changed } = await this.lines.change(key, l => TalkLine.idle(l, this.now()).line);
        if (changed) this.lineChanged(worldUid, key, npc, was, next, true, []);
        else { this.keep(key, next); this.watch(worldUid, key, npc, next); }
      } catch (e) {
        console.error('[LIVE] A silent turn could not be let go, and is looked at again when the line next changes:', e);
      }
    }, Math.max(0, at - this.now()));
    (wake as { unref?: () => void }).unref?.();
    this.idleTimers.set(key, wake);
  }

  private tellLine(worldUid: string, npc: string, line: ILine, to: Set<string>) {
    const text = JSON.stringify({ line: { npc, ...TalkLine.view(line) } });
    for (const s of this.listening.get(worldUid) ?? []) if (to.has(this.players.get(s) ?? '')) s.send(text);
  }

  /** The line of someone being talked to, as this instance last saw it (for its operator and tests). */
  lineOf(worldUid: string, place: string, npc: string) { return TalkLine.view(this.seen.get(lineKey(worldUid, place, npc)) ?? emptyLine()); }

  /** To everyone on this instance listening on the world and standing in `place`, but the one who said it. */
  private tellPlace(worldUid: string, place: string, from: ISocket | null, message: object) {
    const text = JSON.stringify(message);
    for (const s of this.listening.get(worldUid) ?? []) if (s !== from && this.places.get(s) === place) s.send(text);
  }

  /** How many are listening on a world on this instance, for its operator. */
  listeners(worldUid: string) { return this.listening.get(worldUid)?.size ?? 0; }

  /** Work started and not waited on: what goes wrong in it is said here, where someone can read it. */
  private quietly(work: Promise<unknown>) {
    work.catch(e => { if (!this.closed) console.error('[LIVE] Something the room does on its own failed:', e); });
  }

  /** A clean stop: nothing is waited on and nothing is lost, since the store holds what matters. */
  async close() {
    this.closed = true;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const { timer } of this.holds.values()) clearTimeout(timer);
    this.holds.clear();
    this.stopHearing();
    await this.bus.close();
  }
}

const lineKey = (worldUid: string, place: string, npc: string) => `${worldUid}|${place}|${npc}`;
const holdKey = (worldUid: string, uid: string) => `${worldUid}|${uid}`;

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

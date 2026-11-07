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
 *   client -> server   { subscribe: 'world:<uid>', since: <seq> }
 *
 * OTHER PLAYERS: where each is, passed on and never kept (src/logic/live/Presence.ts).
 *   client -> server   { where: IWhere } | { gone: true }
 *   server -> client   { where: IWhere & { uid } } | { gone: <uid> }   to those in the same place only
 *
 * ONE CONVERSATION AT A TIME (src/logic/live/TalkLine.ts): someone being talked to hears one turn,
 * and the rest wait in line in the order they reached the room. Held while sockets are open, never kept.
 *   client -> server   { talk: { op: 'ask' | 'said' | 'leave', npc, party? } }
 *   server -> client   { line: { npc, focus: [uid], waiting: [[uid]] } }   to everyone in that line, and to one who left it
 *
 * WHO MAY. Every request and every socket names a character, and the hub's own check decides
 * (HostedWorld.connect, asked over the hub's route so this file holds no account logic): the account
 * holds it, it is in good standing on our world and on the hub, and it owes the hub no receipts.
 * A world's documents only: anything else in a commit is refused whole.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { SqlStore } from '../SqlStore';
import type { CommitOp, ICommitRequest, IWireDoc, IWireQuery } from '../../src/entities/data/wire';
import { acceptSocket, type ISocket } from './socket';
import { isShared, type ChestIntent } from '../../src/logic/live/shared';
import { ChestSystem, emptyChestRecord, type IChestRecord } from '../../src/entities/world/ChestSystem';
import { isWhere, whereOf } from '../../src/logic/live/Presence';
import { TalkLine, emptyLine, type ILine } from '../../src/logic/live/TalkLine';

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

export class LiveRoom {
  /** Commits land one at a time, so a channel's numbers are in the order they landed. */
  private line: Promise<unknown> = Promise.resolve();
  private readonly listening = new Map<string, Set<ISocket>>();
  /** Where each socket's player last said they were: held only while the socket is open. */
  private readonly places = new Map<ISocket, string>();
  /** Each open socket's player, as checked when it opened. */
  private readonly players = new Map<ISocket, string>();
  /** One line for each person being talked to, by world, place and person (TalkLine.ts). */
  private readonly lines = new Map<string, ILine>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly store: SqlStore, private readonly access: LiveAccess, private readonly now: () => number = Date.now) {}

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

  /** Documents and their event, in one transaction; then told to everyone listening. Inside the queue only. */
  private async land(worldUid: string, commitId: string, ops: CommitOp[]): Promise<{ applied: boolean }> {
    const seq = (await this.head(worldUid)) + 1;
    const event: ILiveEvent = { channel: channelOf(worldUid), seq, at: this.now(), docs: ops.map(op => (op as { doc: IWireDoc }).doc) };
    const result = await this.store.commit({ commitId, ops: [...ops, { kind: 'put', doc: this.doc(eventId(worldUid, seq), event) }, { kind: 'put', doc: this.doc(headId(worldUid), { seq }) }] });
    if (result.applied) this.tell(worldUid, event);
    return result;
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
   */
  chests(worldUid: string, intent: ChestIntent) {
    return this.queued(async () => {
      const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
      if (!intent || !whole(intent.cycle)) return { status: 400, body: { ok: false, reason: 'A claim names its cycle.' } };
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
      await this.land(worldUid, `chests_${worldUid}_${at}_${Math.random().toString(36).slice(2)}`, [{ kind: 'put', doc }]);
      return { status: 200, body: { ok: true, record: next } };
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
      let asked: { subscribe?: string; since?: number; where?: unknown; gone?: unknown; talk?: unknown };
      try { asked = JSON.parse(text); } catch { return socket.send(JSON.stringify({ refused: 'That is not JSON.' })); }
      // Where this player is, passed on and never kept (Presence.ts)
      if (asked.where !== undefined) return this.where(worldUid, uid, socket, asked.where);
      if (asked.gone !== undefined) return this.away(worldUid, uid, socket);
      if (asked.talk !== undefined) return this.talk(worldUid, uid, socket, asked.talk);
      if (asked.subscribe !== channelOf(worldUid)) return socket.send(JSON.stringify({ refused: `This socket is for ${channelOf(worldUid)}.` }));
      const listeners = this.listening.get(worldUid) ?? new Set<ISocket>();
      this.listening.set(worldUid, listeners);
      // Listening first, then what was missed: an event that lands in between is sent twice, and a client keeps the higher number
      listeners.add(socket);
      const since = Number.isFinite(asked.since) ? Number(asked.since) : 0;
      for (const e of await this.since(worldUid, since)) socket.send(JSON.stringify(e));
      socket.send(JSON.stringify({ ready: { channel: channelOf(worldUid), seq: await this.head(worldUid) } }));
    });
    socket.onClose(() => {
      this.away(worldUid, uid, socket);
      this.listening.get(worldUid)?.delete(socket);
      this.players.delete(socket);
    });
  }

  /**
   * OTHER PLAYERS (Presence.ts). A player says where they are; the room puts on who said it and
   * passes it to everyone listening in the same place, and keeps none of it: one lost in a restart
   * is said again a moment later. The uid is the socket's own, checked as it opened, never the
   * message's. Moving to another place, or closing, tells the place left that they are gone.
   */
  private where(worldUid: string, uid: string, socket: ISocket, told: unknown) {
    if (!isWhere(told)) return;
    const said = whereOf(told);
    const was = this.places.get(socket);
    if (was !== undefined && was !== said.place) {
      this.leaveLines(worldUid, was, uid);
      this.tellPlace(worldUid, was, socket, { gone: uid });
    }
    this.places.set(socket, said.place);
    this.tellPlace(worldUid, said.place, socket, { where: { ...said, uid } });
  }

  private away(worldUid: string, uid: string, socket: ISocket) {
    const was = this.places.get(socket);
    if (was === undefined) return;
    this.places.delete(socket);
    this.leaveLines(worldUid, was, uid);
    this.tellPlace(worldUid, was, socket, { gone: uid });
  }

  /**
   * ONE CONVERSATION AT A TIME (TalkLine.ts). A player asks to talk with someone in the place they
   * stand, says something in their turn, or leaves the line. Everyone in the line is told who is
   * heard and who waits. The uid is the socket's own, never the message's.
   */
  private talk(worldUid: string, uid: string, socket: ISocket, told: unknown) {
    const t = told as { op?: unknown; npc?: unknown; party?: unknown };
    const place = this.places.get(socket);
    if (!t || typeof t !== 'object' || typeof t.npc !== 'string' || !t.npc || place === undefined) return;
    const party = Array.isArray(t.party) ? t.party.filter((p): p is string => typeof p === 'string') : [];
    const key = lineKey(worldUid, place, t.npc);
    const was = this.lines.get(key) ?? emptyLine();
    const now = this.now();
    const next = t.op === 'ask' ? TalkLine.ask(was, uid, party, now).line
      : t.op === 'said' ? TalkLine.said(was, uid, now)
      : t.op === 'leave' ? TalkLine.leave(was, uid)
      : null;
    if (!next) return;
    // Asking again, already in line, still tells them where they stand
    this.setLine(worldUid, key, t.npc, was, next, t.op === 'ask' ? [uid] : []);
  }

  /** A player gone from a place leaves every line there. */
  private leaveLines(worldUid: string, place: string, uid: string) {
    const prefix = lineKey(worldUid, place, '');
    for (const [key, line] of [...this.lines]) {
      if (!key.startsWith(prefix) || !TalkLine.everyone(line).includes(uid)) continue;
      this.setLine(worldUid, key, key.slice(prefix.length), line, TalkLine.leave(line, uid), []);
    }
  }

  private setLine(worldUid: string, key: string, npc: string, was: ILine, next: ILine, alsoTell: string[]) {
    if (next.turns.length === 0) this.lines.delete(key);
    else this.lines.set(key, next);
    this.tellLine(worldUid, npc, next, new Set([...TalkLine.everyone(was), ...TalkLine.everyone(next), ...alsoTell]));
    // A turn that sits silent while someone waits is let go when its time comes
    const timer = this.idleTimers.get(key);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(key);
    const at = TalkLine.idleAt(next);
    if (at === null) return;
    const wake = setTimeout(() => {
      this.idleTimers.delete(key);
      const line = this.lines.get(key);
      if (!line) return;
      const out = TalkLine.idle(line, this.now());
      if (out.dropped.length > 0) this.setLine(worldUid, key, npc, line, out.line, []);
      else if (TalkLine.idleAt(line) !== null) this.setLine(worldUid, key, npc, line, line, []);
    }, Math.max(0, at - this.now()));
    (wake as { unref?: () => void }).unref?.();
    this.idleTimers.set(key, wake);
  }

  private tellLine(worldUid: string, npc: string, line: ILine, to: Set<string>) {
    const text = JSON.stringify({ line: { npc, ...TalkLine.view(line) } });
    for (const s of this.listening.get(worldUid) ?? []) if (to.has(this.players.get(s) ?? '')) s.send(text);
  }

  /** The line of someone being talked to, as the room holds it (for its operator and tests). */
  lineOf(worldUid: string, place: string, npc: string) { return TalkLine.view(this.lines.get(lineKey(worldUid, place, npc)) ?? emptyLine()); }

  /** To everyone listening on the world and standing in `place`, but the one who said it. */
  private tellPlace(worldUid: string, place: string, from: ISocket, message: object) {
    const text = JSON.stringify(message);
    for (const s of this.listening.get(worldUid) ?? []) if (s !== from && this.places.get(s) === place) s.send(text);
  }

  /** How many are listening on a world, for its operator. */
  listeners(worldUid: string) { return this.listening.get(worldUid)?.size ?? 0; }
}

const lineKey = (worldUid: string, place: string, npc: string) => `${worldUid}|${place}|${npc}`;

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

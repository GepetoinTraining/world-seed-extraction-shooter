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
 *   server -> client   { channel: 'world:<uid>', seq, docs: [IWireDoc] } | { ready: { channel, seq } } | { refused }
 *   client -> server   { subscribe: 'world:<uid>', since: <seq> }
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

/** One shape, ok or not: this project compiles without strict null checks, where a union on `ok` does not narrow. */
export type LiveAccess = (token: string, uid: string) => Promise<{ ok: boolean; worldUid?: string; status?: number; reason?: string }>;

const LIVE_NS = 'live';
const channelOf = (worldUid: string) => `world:${worldUid}`;
const headId = (worldUid: string) => `live_head_${worldUid}`;
const eventId = (worldUid: string, seq: number) => `live_event_${worldUid}_${seq.toString().padStart(12, '0')}`;

/** A world's own documents carry its uid in their id (world_chests_<uid>, world_carts_<uid>, world_population_<uid>). */
export const ownedBy = (worldUid: string, id: unknown) => typeof id === 'string' && id.includes(worldUid);

export interface ILiveEvent { channel: string; seq: number; at: number; docs: IWireDoc[] }

export class LiveRoom {
  /** Commits land one at a time, so a channel's numbers are in the order they landed. */
  private line: Promise<unknown> = Promise.resolve();
  private readonly listening = new Map<string, Set<ISocket>>();

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

  /** A commit on the world's documents, and its event, in one transaction; then told to everyone listening. */
  commit(worldUid: string, request: ICommitRequest) {
    const run = async () => {
      if (!request || typeof request.commitId !== 'string' || !Array.isArray(request.ops)) return { status: 400, body: { error: 'That is not a commit.' } };
      const stray = request.ops.find((op: CommitOp) => op.kind === 'add' || !ownedBy(worldUid, op.doc.id) || op.doc.namespace === LIVE_NS);
      if (stray) return { status: 400, body: { error: 'Online play writes only this world\'s own documents. Nothing in this commit was applied.' } };
      const seq = (await this.head(worldUid)) + 1;
      const event: ILiveEvent = { channel: channelOf(worldUid), seq, at: this.now(), docs: request.ops.map(op => (op as { doc: IWireDoc }).doc) };
      try {
        const result = await this.store.commit({ ...request, ops: [...request.ops, { kind: 'put', doc: this.doc(eventId(worldUid, seq), event) }, { kind: 'put', doc: this.doc(headId(worldUid), { seq }) }] });
        if (result.applied) this.tell(worldUid, event);
        return { status: 200, body: result };
      } catch (e) {
        const name = (e as Error)?.name;
        if (name === 'StoreConflict') return { status: 409, body: { conflict: true, error: (e as Error).message } };
        if (name === 'StoreRefusal') return { status: 400, body: { error: (e as Error).message } };
        throw e;
      }
    };
    const next = this.line.then(run, run);
    this.line = next.catch(() => undefined);
    return next;
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
    socket.onMessage(async text => {
      let asked: { subscribe?: string; since?: number };
      try { asked = JSON.parse(text); } catch { return socket.send(JSON.stringify({ refused: 'That is not JSON.' })); }
      if (asked.subscribe !== channelOf(worldUid)) return socket.send(JSON.stringify({ refused: `This socket is for ${channelOf(worldUid)}.` }));
      const listeners = this.listening.get(worldUid) ?? new Set<ISocket>();
      this.listening.set(worldUid, listeners);
      // Listening first, then what was missed: an event that lands in between is sent twice, and a client keeps the higher number
      listeners.add(socket);
      const since = Number.isFinite(asked.since) ? Number(asked.since) : 0;
      for (const e of await this.since(worldUid, since)) socket.send(JSON.stringify(e));
      socket.send(JSON.stringify({ ready: { channel: channelOf(worldUid), seq: await this.head(worldUid) } }));
    });
    socket.onClose(() => this.listening.get(worldUid)?.delete(socket));
  }

  /** How many are listening on a world, for its operator. */
  listeners(worldUid: string) { return this.listening.get(worldUid)?.size ?? 0; }
}

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

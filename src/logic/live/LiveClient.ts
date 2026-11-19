/**
 * ONLINE PLAY, IN THE BROWSER (server/live/room.ts). Joining our world live does two things: the
 * world's own documents (its chests, carts, population) are read and written in the room's store
 * instead of this browser's, and a socket brings every change another player commits, by number.
 * A dropped socket comes back on its own and asks for everything after the last number it saw, so
 * nothing in between is missed. The game itself still runs here; the room only keeps what is shared.
 *
 * A WORLD A PLAYER OPENED CAN CLOSE (server/hub/open.ts). Its host closes it, or stops being heard
 * from. The room says so (its last event, or 410 to a request), and this game goes on from its own
 * copy of what was shared: the documents are read and written here again, nobody else is drawn, and
 * nothing waits on a room that will not answer. `status` says CLOSED until the world is left.
 */
import { create } from 'zustand';
import { StoreClient, liveTransport, type Transport } from '../../../shared/entities/data/StoreClient';
import { NOT_OPEN_STATUS } from '../../../shared/logic/live/open';
import type { IWireDoc } from '../../../shared/entities/data/wire';
import { isShared, type ChestIntent } from '../../../shared/logic/live/shared';
import type { IChestRecord } from '../../../shared/entities/world/ChestSystem';
import { presence, shouldSay, whereOf, type IWhere } from '../../../shared/logic/live/Presence';
import type { ILineView } from '../../../shared/logic/live/TalkLine';

export interface ILiveEvent { channel: string; seq: number; at: number; docs: IWireDoc[]; closed?: true }
export type LiveStatus = 'OFF' | 'JOINING' | 'LIVE' | 'DROPPED' | 'REFUSED' | 'CLOSED';

interface ILiveState { status: LiveStatus; worldUid: string | null; seq: number; reason: string | null }
export const useLive = create<ILiveState>(() => ({ status: 'OFF', worldUid: null, seq: 0, reason: null }));

type SocketLike = { send(text: string): void; close(): void; onopen: any; onmessage: any; onclose: any; onerror: any };

export interface IJoinOptions {
  worldUid: string;
  uid: string;
  /** The page's own origin by default: the room is on the hosted server that serves the game. */
  origin?: string;
  /** For tests: how a socket is made. The browser's own WebSocket by default. */
  socket?: (url: string) => SocketLike;
}

const FIRST_RETRY_MS = 400;
const MOST_RETRY_MS = 8_000;

const listeners = new Set<(e: ILiveEvent) => void>();
/** Who hears the lines of people being talked to (TalkLine.ts), as the room tells them. */
const lineListeners = new Set<(npc: string, view: ILineView) => void>();
let current: { worldUid: string; uid: string; origin: string; socket: SocketLike | null; stopRoute: () => void; left: boolean; fallen: boolean; retryMs: number; timer?: ReturnType<typeof setTimeout> } | null = null;

const ON_OWN_COPY = 'You are on your own copy of it until you leave.';
const CLOSED_SAID = `This world was closed to others by its host. ${ON_OWN_COPY}`;

/** The world is not open any more: this game goes on from its own copy. */
function fall(me: NonNullable<typeof current>, reason: string) {
  if (me.fallen || me.left) return;
  me.fallen = true;
  if (me.timer) clearTimeout(me.timer);
  try { me.socket?.close(); } catch { /* already closed */ }
  presence.clear();
  lastSaid = null;
  if (current === me) useLive.setState({ status: 'CLOSED', reason });
}
/** What this browser last said of where its player is, and when (Presence.ts). */
let lastSaid: { where: IWhere; at: number } | null = null;

export const LiveClient = {
  /** Every change another player commits to the world, in order. Returns how to stop listening. */
  on(fn: (e: ILiveEvent) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  join(o: IJoinOptions) {
    LiveClient.leave();
    const origin = (o.origin ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '');
    const make = o.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    // The world's shared documents only (shared.ts): a house's chests and everything else stay in this browser
    const room = liveTransport(origin, o.uid, o.worldUid);
    // To the room while the world is open; from the moment it is not, to this game's own store, the asking request among them
    const via: Transport = async (path, body) => {
      if (me.fallen) return StoreClient.own(path, body);
      const res = await room(path, body);
      if (res.status !== NOT_OPEN_STATUS) return res;
      const said = await res.json().catch(() => ({} as any));
      fall(me, typeof said?.error === 'string' ? `${said.error} ${ON_OWN_COPY}` : CLOSED_SAID);
      return StoreClient.own(path, body);
    };
    const stopRoute = StoreClient.route(id => isShared(o.worldUid, id), via);
    const me = { worldUid: o.worldUid, uid: o.uid, origin, socket: null as SocketLike | null, stopRoute, left: false, fallen: false, retryMs: FIRST_RETRY_MS, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    current = me;
    useLive.setState({ status: 'JOINING', worldUid: o.worldUid, seq: 0, reason: null });

    const url = `${origin.replace(/^http/, 'ws')}/api/hub/live/socket?uid=${encodeURIComponent(o.uid)}&world=${encodeURIComponent(o.worldUid)}`;
    const connect = () => {
      if (me.left || me.fallen) return;
      const socket = make(url);
      me.socket = socket;
      socket.onopen = () => {
        // A first join reads the documents themselves, so it asks for nothing that came before; a socket that comes back asks from its last number
        const seq = useLive.getState().seq;
        socket.send(JSON.stringify({ subscribe: `world:${o.worldUid}`, since: seq > 0 ? seq : 'now' }));
        // A new socket says where this player is at once, so the room knows their place again
        lastSaid = null;
      };
      socket.onmessage = (m: { data: unknown }) => {
        let said: any;
        try { said = JSON.parse(String(m.data)); } catch { return; }
        if (said.refused) { useLive.setState({ status: 'REFUSED', reason: String(said.refused) }); return; }
        // Another player, where they are, or gone (Presence.ts)
        if (said.where) { presence.hear(said.where, Date.now()); return; }
        if (typeof said.gone === 'string') { presence.gone(said.gone); return; }
        // A line of someone being talked to: who is heard and who waits (TalkLine.ts)
        if (said.line && typeof said.line.npc === 'string') {
          const view: ILineView = { focus: Array.isArray(said.line.focus) ? said.line.focus : [], waiting: Array.isArray(said.line.waiting) ? said.line.waiting : [] };
          for (const fn of lineListeners) fn(said.line.npc, view);
          return;
        }
        if (said.ready) { me.retryMs = FIRST_RETRY_MS; useLive.setState(s => ({ status: 'LIVE', seq: Math.max(s.seq, Number(said.ready.seq) || 0) })); return; }
        // An event sent twice (it landed while this socket caught up) is taken once
        if (typeof said.seq !== 'number' || said.seq <= useLive.getState().seq) return;
        useLive.setState({ seq: said.seq });
        // The world's last event: its host closed it (server/hub/open.ts)
        if (said.closed === true) { fall(me, CLOSED_SAID); return; }
        for (const fn of listeners) fn(said as ILiveEvent);
      };
      socket.onerror = () => undefined;
      socket.onclose = () => {
        if (me.left || me.fallen) return;
        if (useLive.getState().status !== 'REFUSED') useLive.setState({ status: 'DROPPED' });
        me.timer = setTimeout(connect, me.retryMs);
        me.retryMs = Math.min(me.retryMs * 2, MOST_RETRY_MS);
      };
    };
    connect();
  },

  /** Is this world the one played live right now? One whose host closed it is not: it is this game's own copy. */
  isLive: (worldUid: string | null | undefined): boolean => !!current && !current.left && !current.fallen && current.worldUid === worldUid,

  /** The world joined, live or fallen back to this game's own copy, until it is left. */
  world: (): string | null => (current && !current.left ? current.worldUid : null),

  /** The lobby says this world is not open any more (OpenWorlds.ts): on from this game's own copy. */
  fall(worldUid: string, reason: string = CLOSED_SAID) {
    if (current && !current.left && current.worldUid === worldUid) fall(current, reason);
  },

  /**
   * Where this player is, said to the others in the same place (Presence.ts): at most every
   * SAY_EVERY_MS, and only when something changed or a still player has not been heard a while.
   * Called every frame; most calls say nothing.
   */
  say(where: IWhere, now = Date.now()) {
    const me = current;
    if (!me || me.left || me.fallen || !me.socket || useLive.getState().status !== 'LIVE') return;
    if (!shouldSay(lastSaid?.where ?? null, where, now, lastSaid?.at ?? 0)) return;
    const one = whereOf(where);
    lastSaid = { where: one, at: now };
    try { me.socket.send(JSON.stringify({ where: one })); } catch { /* the socket comes back on its own */ }
  },

  /** This player left the place (out of the world, back to the hub): the others stop drawing them. */
  unsay() {
    const me = current;
    if (!lastSaid) return;
    lastSaid = null;
    try { me?.socket?.send(JSON.stringify({ gone: true })); } catch { /* closing tells them too */ }
  },

  /**
   * ONE CONVERSATION AT A TIME (TalkLine.ts): ask to talk with someone in this place, say that this
   * turn is still talking, or leave the line. The room answers with the line, to `onLine`. False when
   * not playing live, and then nobody else is there to wait for.
   */
  talk(op: 'ask' | 'said' | 'leave', npc: string, party: readonly string[] = []): boolean {
    const me = current;
    if (!me || me.left || me.fallen || !me.socket || useLive.getState().status !== 'LIVE') return false;
    try { me.socket.send(JSON.stringify({ talk: { op, npc, party } })); } catch { return false; }
    return true;
  },

  /** Every line the room tells this player of. Returns how to stop listening. */
  onLine(fn: (npc: string, view: ILineView) => void): () => void {
    lineListeners.add(fn);
    return () => { lineListeners.delete(fn); };
  },

  /** This player's own uid while playing live. */
  me: (): string | null => (current && !current.left && !current.fallen ? current.uid : null),

  /**
   * A chest claimed or a guard fallen, in the room's queue. The answer is the record as it stands
   * after: on a claim refused, someone reached the chest first. Null when not playing live.
   */
  async chests(intent: ChestIntent): Promise<{ ok: boolean; record?: IChestRecord; reason?: string } | null> {
    const me = current;
    if (!me || me.left || me.fallen) return null;
    try {
      const res = await fetch(`${me.origin}/api/hub/live/chests?uid=${encodeURIComponent(me.uid)}&world=${encodeURIComponent(me.worldUid)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent), credentials: 'same-origin' });
      const out = await res.json().catch(() => ({}));
      // Not open any more: null, as when not playing live, and whoever asked goes on from this game's own copy
      if (res.status === NOT_OPEN_STATUS) { fall(me, typeof out?.error === 'string' ? `${out.error} ${ON_OWN_COPY}` : CLOSED_SAID); return null; }
      return { ok: !!out.ok, ...(out.record ? { record: out.record } : {}), ...(out.reason ? { reason: String(out.reason) } : {}) };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  },

  leave() {
    if (!current) return;
    LiveClient.unsay();
    presence.clear();
    current.left = true;
    if (current.timer) clearTimeout(current.timer);
    current.stopRoute();
    try { current.socket?.close(); } catch { /* already closed */ }
    current = null;
    useLive.setState({ status: 'OFF', worldUid: null, seq: 0, reason: null });
  }
};

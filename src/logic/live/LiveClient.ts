/**
 * ONLINE PLAY, IN THE BROWSER (server/live/room.ts). Joining our world live does two things: the
 * world's own documents (its chests, carts, population) are read and written in the room's store
 * instead of this browser's, and a socket brings every change another player commits, by number.
 * A dropped socket comes back on its own and asks for everything after the last number it saw, so
 * nothing in between is missed. The game itself still runs here; the room only keeps what is shared.
 */
import { create } from 'zustand';
import { StoreClient, liveTransport } from '../../entities/data/StoreClient';
import type { IWireDoc } from '../../entities/data/wire';
import { isShared, type ChestIntent } from './shared';
import type { IChestRecord } from '../../entities/world/ChestSystem';
import { presence, shouldSay, whereOf, type IWhere } from './Presence';

export interface ILiveEvent { channel: string; seq: number; at: number; docs: IWireDoc[] }
export type LiveStatus = 'OFF' | 'JOINING' | 'LIVE' | 'DROPPED' | 'REFUSED';

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
let current: { worldUid: string; uid: string; origin: string; socket: SocketLike | null; stopRoute: () => void; left: boolean; retryMs: number; timer?: ReturnType<typeof setTimeout> } | null = null;
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
    const stopRoute = StoreClient.route(id => isShared(o.worldUid, id), liveTransport(origin, o.uid));
    const me = { worldUid: o.worldUid, uid: o.uid, origin, socket: null as SocketLike | null, stopRoute, left: false, retryMs: FIRST_RETRY_MS, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    current = me;
    useLive.setState({ status: 'JOINING', worldUid: o.worldUid, seq: 0, reason: null });

    const url = `${origin.replace(/^http/, 'ws')}/api/hub/live/socket?uid=${encodeURIComponent(o.uid)}`;
    const connect = () => {
      if (me.left) return;
      const socket = make(url);
      me.socket = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ subscribe: `world:${o.worldUid}`, since: useLive.getState().seq }));
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
        if (said.ready) { me.retryMs = FIRST_RETRY_MS; useLive.setState(s => ({ status: 'LIVE', seq: Math.max(s.seq, Number(said.ready.seq) || 0) })); return; }
        // An event sent twice (it landed while this socket caught up) is taken once
        if (typeof said.seq !== 'number' || said.seq <= useLive.getState().seq) return;
        useLive.setState({ seq: said.seq });
        for (const fn of listeners) fn(said as ILiveEvent);
      };
      socket.onerror = () => undefined;
      socket.onclose = () => {
        if (me.left) return;
        if (useLive.getState().status !== 'REFUSED') useLive.setState({ status: 'DROPPED' });
        me.timer = setTimeout(connect, me.retryMs);
        me.retryMs = Math.min(me.retryMs * 2, MOST_RETRY_MS);
      };
    };
    connect();
  },

  /** Is this world the one played live right now? */
  isLive: (worldUid: string | null | undefined): boolean => !!current && !current.left && current.worldUid === worldUid,

  /**
   * Where this player is, said to the others in the same place (Presence.ts): at most every
   * SAY_EVERY_MS, and only when something changed or a still player has not been heard a while.
   * Called every frame; most calls say nothing.
   */
  say(where: IWhere, now = Date.now()) {
    const me = current;
    if (!me || me.left || !me.socket || useLive.getState().status !== 'LIVE') return;
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
   * A chest claimed or a guard fallen, in the room's queue. The answer is the record as it stands
   * after: on a claim refused, someone reached the chest first. Null when not playing live.
   */
  async chests(intent: ChestIntent): Promise<{ ok: boolean; record?: IChestRecord; reason?: string } | null> {
    const me = current;
    if (!me || me.left) return null;
    try {
      const res = await fetch(`${me.origin}/api/hub/live/chests?uid=${encodeURIComponent(me.uid)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent), credentials: 'same-origin' });
      const out = await res.json().catch(() => ({}));
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

/**
 * THE LOBBY, IN THE GAME (server/hub/open.ts, shared/logic/live/open.ts). Pedro, 2026-11-18: "we need
 * to make the multiplayer always on WHEN someone is in server... if there's a web socket we log people
 * into to it, unless they choose to host their own, then we tunnel theirs as an option like old
 * warcraft 3 used to do".
 *
 * ALWAYS ON. Played from the domain, signed in, with the first order behind them (Pedro, 2026-11-04:
 * "it opens after the player has gone through tutorial"), a player has every world open on the hub
 * among their zones without asking: `sync` reads the list, has the hub serve each world this game
 * does not hold yet, and marks it live (HostedLink), so entering it joins its room. A world that is
 * no longer open is not offered, and a player inside one when it closes goes on from their own copy.
 *
 * HOSTING ONE'S OWN. `open` sends a world this character minted with what its players will share as
 * this game holds it; from then on the room's copy is the one played, by its host too. `close` takes
 * that part back into this game's own store. While this game is open it says its open worlds are
 * still open, on a beat (`start`).
 *
 * Under a runner or in development none of this runs: a world played with others is reached there
 * through CONNECT HUB TO ONLINE WORLD, as before.
 */
import { create } from 'zustand';
import { HubClient } from '../hub/HubClient';
import { HubLink } from '../hub/HubLink';
import { HostedLink } from './HostedLink';
import { LiveClient } from './LiveClient';
import { ThemeStore } from '../theme/ThemeStore';
import { MintStore } from '../theme/writing/MintAdditionsWriter';
import { Tutorial } from '../systems/Tutorial';
import { useIdentityStore } from '../../entities/identity/store';
import { usePlayerStore } from '../../entities/player/store';
import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { StoreClient } from '../../../shared/entities/data/StoreClient';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { SHARED_FAMILIES } from '../../../shared/logic/live/shared';
import { OPEN_BEAT_MS, type IOpenManifest, type IOpenWorldRow } from '../../../shared/logic/live/open';
import type { IWireDoc } from '../../../shared/entities/data/wire';

interface IOpenState {
  /** Every world open on the hub, as it last said. */
  rows: IOpenWorldRow[];
  /** Changes whenever what is offered changes: what a list of zones reads again on. */
  stamp: string;
  /** Why nothing is listed, or why one world could not be served, in a person's words. */
  note: string | null;
  /** The world being opened or closed right now. */
  busy: string | null;
}

export const useOpenWorlds = create<IOpenState>(() => ({ rows: [], stamp: '', note: null, busy: null }));

const stampOf = (rows: IOpenWorldRow[]) => rows.map(r => `${r.worldUid}:${r.mine ? 'm' : 'o'}${r.answering ? 'a' : 's'}`).sort().join('|');
const me = () => useIdentityStore.getState().certificate?.metadata.uid ?? null;
const certificateOf = async (worldUid: string) => (await VectorStore.get<{ content?: any }>(VectorNamespace.CONTENT, worldUid))?.data?.content ?? null;

/** A world the hub served: its themes, its certificate and what its minting added, kept here as this game keeps its own. */
async function install(manifest: IOpenManifest): Promise<string | null> {
  for (const theme of manifest.themes ?? []) {
    const banked = await ThemeStore.bank(theme);
    if (!banked.ok) return `Its theme would not install here: ${banked.reason}`;
  }
  const cert = manifest.certificate;
  if (!cert?.data?.worldUid) return 'The hub sent no certificate for it.';
  await VectorStore.saveContent(cert.data.worldUid, 'world_certificate', cert, cert.data.worldType);
  if (manifest.mint?.batch && manifest.mint.worldUid === cert.data.worldUid) await MintStore.save(manifest.mint as any);
  return null;
}

/** What a host took back from the room, written into this game's own store, once. */
async function keep(worldUid: string, closedAt: number, docs: IWireDoc[]) {
  if (LiveClient.world() === worldUid) LiveClient.leave();
  if (docs.length > 0) await StoreClient.commit({ commitId: `take_${worldUid}_${closedAt}`, ops: docs.map(doc => ({ kind: 'put' as const, doc })) });
  HostedLink.forget(worldUid);
}

let syncing: Promise<void> | null = null;

export const OpenWorlds = {
  /** Does the lobby run in this game? Played from the domain only (HubLink.required). */
  on: (): boolean => HubLink.required(),

  rowOf: (worldUid: string): IOpenWorldRow | null => useOpenWorlds.getState().rows.find(r => r.worldUid === worldUid) ?? null,

  /**
   * Is this world offered among the zones? One this game holds only because the hub served it is
   * offered while it is open and its host is answering; everything else is this game's own.
   */
  offered(worldUid: string): boolean {
    const mark = HostedLink.markOf(worldUid);
    if (mark !== 'JOINED' && !(mark === 'HUB' && OpenWorlds.on())) return true;
    const row = OpenWorlds.rowOf(worldUid);
    return !!row && row.answering;
  },

  /** The list, read again, and this game brought level with it. One at a time; a second call waits on the first. */
  sync(): Promise<void> {
    return (syncing ??= (async () => {
      try { await level(); } catch (e) { console.warn('[ONLINE] The worlds open on the hub could not be read:', e); } finally { syncing = null; }
    })());
  },

  /** Open a world this character minted to others. */
  async open(worldUid: string): Promise<{ ok: boolean; reason?: string }> {
    const uid = me();
    if (!uid) return { ok: false, reason: 'No character is played.' };
    if (useOpenWorlds.getState().busy) return { ok: false, reason: 'One at a time.' };
    useOpenWorlds.setState({ busy: worldUid });
    try {
      const cert = await certificateOf(worldUid);
      if (!cert?.data?.worldUid) return { ok: false, reason: 'This game does not hold that world.' };
      if (cert.data.creatorCertUid !== uid) return { ok: false, reason: 'A world is opened to others by the character that minted it.' };
      const themeId = ContentRegistry.standing(cert.data.rules?.themeId);
      const pack = ContentRegistry.get(themeId);
      if (!pack) return { ok: false, reason: 'The theme this world stands on is not in this game.' };
      const mint = await MintStore.load(worldUid).catch(() => null);
      // What its players will share, as this game holds it. Already played from the room (it was open, and this game stopped), the room's copy stands
      const docs: IWireDoc[] = [];
      if (LiveClient.world() !== worldUid) {
        for (const family of SHARED_FAMILIES) {
          const doc = await StoreClient.get(`${family}${worldUid}`);
          if (doc) docs.push(doc);
        }
      }
      // What the hub is still owed goes first: a character owing receipts opens nothing
      await HubLink.sendNow().catch(() => undefined);
      const manifest: IOpenManifest = { world: { worldUid, name: String(cert.data.worldName ?? worldUid), creatorCertUid: uid, themeId }, certificate: cert, themes: [pack], mint };
      const out = await HubClient.openWorld(uid, manifest, docs);
      if (!out.ok) return { ok: false, reason: out.reason ?? 'The hub did not open it.' };
      HostedLink.remember(worldUid, 'MINE');
      await OpenWorlds.sync();
      return { ok: true };
    } finally {
      useOpenWorlds.setState({ busy: null });
    }
  },

  /** Close one of this game's own to others, and take what its players shared back into this game. */
  async close(worldUid: string): Promise<{ ok: boolean; reason?: string }> {
    if (useOpenWorlds.getState().busy) return { ok: false, reason: 'One at a time.' };
    useOpenWorlds.setState({ busy: worldUid });
    try {
      // Marked first, so an answer lost on the way is asked for again (level, below)
      HostedLink.remember(worldUid, 'CLOSING');
      const out = await HubClient.closeWorld(worldUid);
      if (!out.ok) {
        if (out.status === 404) { HostedLink.forget(worldUid); return { ok: true }; }
        return { ok: false, reason: out.reason ?? 'The hub did not close it. It is asked again by itself.' };
      }
      await keep(worldUid, out.closedAt ?? 0, out.docs ?? []);
      await OpenWorlds.sync();
      return { ok: true };
    } finally {
      useOpenWorlds.setState({ busy: null });
    }
  },

  /** While the game is open: this game's open worlds are said to be open still, and the list is read again. Returns how to stop. */
  start(everyMs = OPEN_BEAT_MS): () => void {
    if (!OpenWorlds.on()) return () => undefined;
    const tick = async () => {
      const mine = HostedLink.marked('MINE');
      if (mine.length > 0) await HubClient.beatWorlds(mine).catch(() => undefined);
      await OpenWorlds.sync();
    };
    void tick();
    const timer = setInterval(() => void tick(), everyMs);
    return () => clearInterval(timer);
  }
};

async function level(): Promise<void> {
  const uid = me();
  if (!OpenWorlds.on() || !uid) return;
  const set = (rows: IOpenWorldRow[], note: string | null) => useOpenWorlds.setState({ rows, stamp: stampOf(rows), note });
  // Pedro, 2026-11-04: worlds played with others open once the first order is behind them
  if (Tutorial.firstOrderOpen(usePlayerStore.getState().player)) return set([], null);

  // A close whose answer never came back: asked again, and the same documents come back
  for (const worldUid of HostedLink.marked('CLOSING')) {
    const out = await HubClient.closeWorld(worldUid);
    if (out.ok) await keep(worldUid, out.closedAt ?? 0, out.docs ?? []);
    else if (out.status === 404) HostedLink.forget(worldUid);
  }

  const listed = await HubClient.openWorlds();
  if (!listed.ok || !Array.isArray(listed.worlds)) {
    // The marks stay as they are: a hub that cannot be reached closes nothing
    useOpenWorlds.setState({ note: listed.status === 401 ? 'Sign in on the site\'s first page to play with others.' : listed.reason ?? 'The hub could not be reached.' });
    return;
  }
  const rows = listed.worlds;
  const open = new Set(rows.map(r => r.worldUid));
  let note: string | null = null;

  for (const row of rows) {
    const mark = HostedLink.markOf(row.worldUid);
    if (row.mine) {
      // One of this account's own, open: played from the room here too, if this game holds the world at all
      if (mark !== 'MINE' && mark !== 'CLOSING' && await certificateOf(row.worldUid)) HostedLink.remember(row.worldUid, 'MINE');
      continue;
    }
    if (mark === 'JOINED' || mark === 'HUB') continue;
    let served = await HubClient.enterWorld(uid, row.worldUid);
    if (!served.ok && served.owed) {
      await HubLink.sendNow().catch(() => undefined);
      served = await HubClient.enterWorld(uid, row.worldUid);
    }
    if (!served.ok || !served.manifest) { note = `${row.name}: ${served.reason ?? 'the hub did not serve it.'}`; continue; }
    const problem = await install(served.manifest);
    if (problem) { note = `${row.name}: ${problem}`; continue; }
    HostedLink.remember(row.worldUid, row.by === 'HUB' ? 'HUB' : 'JOINED');
  }

  // One of this game's own that the hub no longer lists was closed from elsewhere: its shared part is taken back
  for (const worldUid of HostedLink.marked('MINE')) {
    if (open.has(worldUid)) continue;
    const out = await HubClient.closeWorld(worldUid);
    if (out.ok) await keep(worldUid, out.closedAt ?? 0, out.docs ?? []);
    else if (out.status === 404) HostedLink.forget(worldUid);
  }

  // Inside a world that is not open any more: on from this game's own copy (LiveClient)
  const inside = LiveClient.world();
  const row = inside ? rows.find(r => r.worldUid === inside) : null;
  if (inside && HostedLink.markOf(inside) !== 'MINE' && (!row || !row.answering)) LiveClient.fall(inside);

  set(rows, note);
}

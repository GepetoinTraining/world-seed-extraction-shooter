/**
 * THE WORLDS OPEN ON THIS HUB (shared/logic/live/open.ts). Pedro, 2026-11-18: "we need to make the
 * multiplayer always on WHEN someone is in server, it's ready to deploty the websocket, if there's a
 * web socket we log people into to it, unless they choose to host their own, then we tunnel theirs as
 * an option like old warcraft 3 used to do".
 *
 * THE LOBBY. `list` answers every world open here: the one this hub's operator hosts (hosted.ts) and
 * each one a player opened. `enter` hands a world's manifest to a character let into it, so a game
 * signed in has those worlds among its zones without asking anyone, and `access` is the room's word
 * on who may play one live.
 *
 * HOSTING ONE'S OWN. Its maker opens it (`open`), with the law's check on what it stands on
 * (Hub.checkWorld) and what its players will share as it stands in the maker's own game, which the
 * room takes as its start. From then until it is closed, the room's copy is the world's shared part:
 * the host plays on it too. `close` hands that part back to the host, for their own game to keep.
 *
 * THE TUNNEL IS THE ROOM. Nobody reaches a host's machine. A function host pins a socket to one of
 * its instances and keeps none of them, so a pass-through to the host's browser would cross instances
 * through the store, a beat a hop. What players share is small and already has a room that keeps it
 * by number (live/room.ts); a host's world uses that room, under its own uid.
 *
 * A HOST THAT STOPS ANSWERING. The host's game says each of its open worlds is still open on a beat
 * (`beat`, OPEN_BEAT_MS). One not heard from in OPEN_FOR_MS is not listed and lets nobody but its
 * host in. Nothing is lost: the room holds what it held, and the world is listed again when its host
 * is heard from.
 *
 *   hub_open_world_{worldUid}   who opened it, its manifest, when it opened, when its host last said so, when it closed
 */
import type { Hub, IRefusal } from './Hub';
import { refuse } from './Hub';
import { HostedWorld } from './hosted';
import type { IWireDoc } from '../../shared/entities/data/wire';
import { NOT_OPEN_STATUS, OPEN_FOR_MS, type IOpenManifest, type IOpenWorldRow } from '../../shared/logic/live/open';

/** What opening and closing ask of the room that keeps the world's shared part (live/room.ts). */
export interface IOpenRoom {
  /** The world's shared documents as its host's game holds them: the room's start. */
  seed(worldUid: string, docs: unknown, key: string): Promise<{ ok: boolean; reason?: string }>;
  /** Everyone listening is told it closed, and the shared documents are handed back as they stand. */
  shut(worldUid: string, key: string): Promise<IWireDoc[]>;
  /** The shared documents as they stand, for a close asked a second time. */
  take(worldUid: string): Promise<IWireDoc[]>;
}

interface IOpenDoc {
  type: 'hub_open_world';
  worldUid: string; name: string; themeId: string;
  account: string; hostUid: string; hostName: string;
  manifest: IOpenManifest;
  openedAt: number; beatAt: number; closedAt: number | null;
}

/** A manifest is a certificate, a theme and what a minting added: larger than this is not one. */
const MANIFEST_BYTES = 3 * 1024 * 1024;
const openId = (worldUid: string) => `hub_open_world_${worldUid}`;
const WORLD_UID = /^[A-Za-z0-9_-]{1,96}$/;

export class OpenWorlds {
  private readonly hosted: HostedWorld;

  constructor(private readonly hub: Hub, private readonly room: IOpenRoom | null = null) {
    this.hosted = new HostedWorld(hub);
  }

  private answering(doc: IOpenDoc): boolean {
    return doc.closedAt === null && this.hub.now() - doc.beatAt <= OPEN_FOR_MS;
  }

  private async held(worldUid: unknown) {
    return typeof worldUid === 'string' && WORLD_UID.test(worldUid) ? this.hub.read<IOpenDoc>(openId(worldUid)) : null;
  }

  /** The character named is this account's, in good standing here, and owes the hub nothing (as hosted.ts asks). */
  private async character(account: { key: string }, uid: unknown): Promise<{ name: string } | IRefusal> {
    if (typeof uid !== 'string') return refuse(400, 'Name the character.');
    const held = await this.hub.read<{ account: string; displayName?: string; standing?: string; owed?: unknown[] }>(`hub_character_${uid}`);
    if (!held || held.data.account !== account.key) return refuse(403, 'That character is not one this account holds here.');
    if (held.data.standing === 'CHALLENGED') return refuse(403, 'This hub\'s rerun of this character did not land where its own did, so worlds played with others are closed to it. Everything else plays on.', { standing: 'CHALLENGED' });
    const owed = held.data.owed?.length ?? 0;
    if (owed > 0) return refuse(409, `This hub has not been sent ${owed} of this character's session receipt${owed === 1 ? '' : 's'} to rerun. They go up by themselves; try again in a moment.`, { owed });
    return { name: String(held.data.displayName ?? '') };
  }

  /** Every world open here, for whoever is signed in. One's own are listed whether or not their host is answering. */
  async list(token: unknown): Promise<{ ok: true; worlds: IOpenWorldRow[] } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const worlds: IOpenWorldRow[] = [];
    const ours = await this.hosted.describe();
    if (ours.ok) worlds.push({ worldUid: ours.world.worldUid, name: ours.world.name, themeId: ours.world.themeId, by: 'HUB', host: null, mine: false, answering: true, openedAt: 0 });
    const docs = await this.hub.store.query({ namespace: 'hub', filter: { 'data.type': 'hub_open_world' } });
    for (const doc of docs) {
      const open = JSON.parse(doc.dataText) as IOpenDoc;
      if (open.closedAt !== null) continue;
      const mine = open.account === account.key;
      const answering = this.answering(open);
      if (!answering && !mine) continue;
      worlds.push({ worldUid: open.worldUid, name: open.name, themeId: open.themeId, by: 'PLAYER', host: open.hostName || null, mine, answering, openedAt: open.openedAt });
    }
    worlds.sort((a, b) => (a.by === b.by ? a.openedAt - b.openedAt : a.by === 'HUB' ? -1 : 1));
    return { ok: true, worlds };
  }

  /**
   * A world's maker opens it to others. `docs` is what its players share, as the maker's game holds
   * it. A world still open (its host's game stopped and came back) is taken up as the room holds it,
   * and `docs` is not read: the room's copy is the later one.
   */
  async open(token: unknown, uid: unknown, manifest: any, docs: unknown): Promise<{ ok: true; worldUid: string; resumed: boolean; openedAt: number } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const world = manifest?.world;
    if (typeof world?.worldUid !== 'string' || !WORLD_UID.test(world.worldUid) || typeof world?.creatorCertUid !== 'string' || typeof world?.themeId !== 'string' || !Array.isArray(manifest?.themes)) {
      return refuse(400, 'A world is opened with its manifest: the world, its maker, its theme, and the themes it stands on.');
    }
    if (manifest.certificate?.data?.worldUid !== world.worldUid) return refuse(400, 'A world is opened with its own certificate, which is what another game lists it by.');
    if (JSON.stringify(manifest).length > MANIFEST_BYTES) return refuse(413, 'That is more than a world\'s manifest carries.');
    if (world.creatorCertUid !== uid) return refuse(403, 'A world is opened to others by the character that minted it.');
    const host = await this.character(account, uid);
    if ('ok' in host) return host;
    const ours = await this.hosted.describe();
    if (ours.ok && ours.world.worldUid === world.worldUid) return refuse(409, 'That is the world this hub hosts itself.');

    // The law's own check of what it stands on: the same one a world is sent to at any time
    const check = await this.hub.checkWorld(token, { world: { worldUid: world.worldUid, creatorCertUid: world.creatorCertUid, themeId: world.themeId }, themes: manifest.themes, ...(Array.isArray(manifest.kinds) ? { kinds: manifest.kinds } : {}), ...(Array.isArray(manifest.loot) ? { loot: manifest.loot } : {}) });
    if (!check.ok) {
      const c = check as any;
      const why = c.reason ?? c.world?.reason ?? c.themes?.refused?.[0]?.reason ?? c.kinds?.refused?.[0]?.reason ?? c.loot?.refused?.[0]?.reason ?? 'The law refused part of it.';
      return refuse(c.themes ? 400 : c.status ?? 400, `This world cannot be opened to others: ${why}`);
    }

    const now = this.hub.now();
    const held = await this.held(world.worldUid);
    if (held && held.data.closedAt === null) {
      if (held.data.account !== account.key) return refuse(409, 'That world is open under another account.');
      await this.hub.commit([{ kind: 'put', doc: this.hub.doc(openId(world.worldUid), { ...held.data, beatAt: now }, held.doc.metadata.createdAt) }]);
      return { ok: true, worldUid: world.worldUid, resumed: true, openedAt: held.data.openedAt };
    }
    // The room takes its start before anyone is told the world is open
    if (this.room) {
      const seeded = await this.room.seed(world.worldUid, docs, `open_${world.worldUid}_${now}`);
      if (!seeded.ok) return refuse(400, seeded.reason ?? 'What this world\'s players share could not be taken as sent.');
    }
    const name = String(manifest.certificate?.data?.worldName ?? world.name ?? world.worldUid);
    const kept: IOpenDoc = {
      type: 'hub_open_world', worldUid: world.worldUid, name, themeId: world.themeId,
      account: account.key, hostUid: uid as string, hostName: host.name,
      manifest: { ...manifest, world: { ...world, name } }, openedAt: now, beatAt: now, closedAt: null
    };
    await this.hub.commit([{ kind: 'put', doc: this.hub.doc(openId(world.worldUid), kept as unknown as Record<string, unknown>, held?.doc.metadata.createdAt) }]);
    return { ok: true, worldUid: world.worldUid, resumed: false, openedAt: now };
  }

  /** The host's game, saying its open worlds are still open. Answers which of them are. */
  async beat(token: unknown, worlds: unknown): Promise<{ ok: true; open: string[] } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const open: string[] = [];
    for (const worldUid of Array.isArray(worlds) ? worlds.slice(0, 64) : []) {
      const held = await this.held(worldUid);
      if (!held || held.data.closedAt !== null || held.data.account !== account.key) continue;
      await this.hub.commit([{ kind: 'put', doc: this.hub.doc(openId(held.data.worldUid), { ...held.data, beatAt: this.hub.now() }, held.doc.metadata.createdAt) }]);
      open.push(held.data.worldUid);
    }
    return { ok: true, open };
  }

  /**
   * The host closes it. Everyone in it is told, and what its players shared comes back for the host's
   * own game to keep. Asked again (the answer was lost on the way), the same documents come back.
   */
  async close(token: unknown, worldUid: unknown): Promise<{ ok: true; worldUid: string; closedAt: number; docs: IWireDoc[] } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const held = await this.held(worldUid);
    if (!held) return refuse(404, 'That world is not one opened on this hub.');
    if (held.data.account !== account.key) return refuse(403, 'A world is closed by the account that opened it.');
    if (held.data.closedAt !== null) return { ok: true, worldUid: held.data.worldUid, closedAt: held.data.closedAt, docs: this.room ? await this.room.take(held.data.worldUid) : [] };
    const closedAt = this.hub.now();
    // Closed in the list first, so nobody is let in while the room hands its part back
    await this.hub.commit([{ kind: 'put', doc: this.hub.doc(openId(held.data.worldUid), { ...held.data, closedAt }, held.doc.metadata.createdAt) }]);
    const docs = this.room ? await this.room.shut(held.data.worldUid, `close_${held.data.worldUid}_${held.data.openedAt}`) : [];
    return { ok: true, worldUid: held.data.worldUid, closedAt, docs };
  }

  /** The room's word and a game's: may this character play this world live, and whose world is it. */
  private async let(token: unknown, uid: unknown, worldUid: unknown): Promise<{ ok: true; worldUid: string; manifest: IOpenManifest; by: 'HUB' | 'PLAYER'; host: boolean } | IRefusal> {
    const ours = await this.hosted.describe();
    if (ours.ok && (worldUid === undefined || worldUid === null || worldUid === '' || worldUid === ours.world.worldUid)) {
      const out = await this.hosted.connect(token, uid);
      if (!out.ok) return out as IRefusal;
      return { ok: true, worldUid: ours.world.worldUid, manifest: out.manifest as IOpenManifest, by: 'HUB', host: false };
    }
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const held = await this.held(worldUid);
    if (!held) return refuse(NOT_OPEN_STATUS, 'That world is not open on this hub.', { notOpen: true });
    const host = held.data.account === account.key;
    if (held.data.closedAt !== null) return refuse(NOT_OPEN_STATUS, `${held.data.name} was closed to others by its host.`, { notOpen: true });
    if (!host && !this.answering(held.data)) return refuse(NOT_OPEN_STATUS, `${held.data.name}'s host has not been heard from, so it is not open now.`, { notOpen: true });
    const who = await this.character(account, uid);
    if ('ok' in who) return who;
    return { ok: true, worldUid: held.data.worldUid, manifest: held.data.manifest, by: 'PLAYER', host };
  }

  /** Entering a world open here: the character is checked, then the world is served to its game. */
  async enter(token: unknown, uid: unknown, worldUid: unknown): Promise<{ ok: true; worldUid: string; manifest: IOpenManifest; by: 'HUB' | 'PLAYER' } | IRefusal> {
    const out = await this.let(token, uid, worldUid);
    if (!out.ok) return out;
    return { ok: true, worldUid: out.worldUid, manifest: out.manifest, by: out.by };
  }

  /** The room's word on a request or a socket (live/room.ts, LiveAccess). No world named means the one this hub hosts. */
  async access(token: unknown, uid: unknown, worldUid?: unknown): Promise<{ ok: boolean; worldUid?: string; status?: number; reason?: string }> {
    const out = await this.let(token, uid, worldUid);
    return out.ok ? { ok: true, worldUid: out.worldUid } : { ok: false, status: (out as IRefusal).status, reason: (out as IRefusal).reason };
  }
}

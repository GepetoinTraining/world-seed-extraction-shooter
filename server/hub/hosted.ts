/**
 * THE WORLD WE HOST (Pedro, 2026-11-04: "The server still needs it for the world we'll host for
 * everyone, that one is the solid deploy plan"; and on reaching it: "it opens after the player has
 * gone through tutorial, from the nexus menu, and then what they see is the connect hub to online
 * world, we check their account (so we can blacklist FROM OUR WORLD, not the game itself) and serve
 * the world to their hub").
 *
 * The hosted world is published by its operator (`publish`, from the live server's own machine,
 * never a route). Connecting a hub to it checks the account: the character must be one this
 * account holds here. A character's standing on our world is its own: BARRED keeps that character
 * out of our world only, and everything else (its account, its own hub, every other world) plays
 * on. Then the world's manifest goes to the hub, which lists it among its worlds and deploys into it
 * as into any.
 */
import type { Hub } from './Hub';
import { refuse, type IRefusal } from './Hub';
import type { IThemePack } from '../../src/logic/theme/ThemeTypes';

export interface IHostedManifest {
  world: { worldUid: string; name: string; creatorCertUid: string; themeId: string; [more: string]: unknown };
  /** The world's own certificate, which a hub saves and lists as it lists any world. */
  certificate?: Record<string, unknown>;
  themes: IThemePack[];
  [more: string]: unknown;
}

export type WorldStanding = 'GOOD' | 'BARRED';

const HOSTED_ID = 'hub_hosted_world';

export class HostedWorld {
  constructor(private readonly hub: Hub) {}

  private async manifest(): Promise<IHostedManifest | null> {
    return (await this.hub.read<{ manifest: IHostedManifest }>(HOSTED_ID))?.data.manifest ?? null;
  }

  /** The operator's: what the world we host is. Not a route. */
  async publish(manifest: IHostedManifest): Promise<void> {
    const held = await this.hub.read<Record<string, unknown>>(HOSTED_ID);
    await this.hub.commit([{ kind: 'put', doc: this.hub.doc(HOSTED_ID, { type: 'hub_hosted', manifest, at: this.hub.now() }, held?.doc.metadata.createdAt) }]);
  }

  /** What anyone may know: which world it is. */
  async describe(): Promise<{ ok: true; world: { worldUid: string; name: string; themeId: string } } | IRefusal> {
    const manifest = await this.manifest();
    if (!manifest) return refuse(404, 'This hub hosts no world.');
    const { worldUid, name, themeId } = manifest.world;
    return { ok: true, world: { worldUid, name, themeId } };
  }

  private standingId(worldUid: string, uid: string) {
    return `hub_world_standing_${worldUid}_${uid}`;
  }

  /** The operator's: a character's standing on our world. Not a route. */
  async setStanding(uid: string, standing: WorldStanding, why: string): Promise<void> {
    const manifest = await this.manifest();
    if (!manifest) throw new Error('This hub hosts no world.');
    const id = this.standingId(manifest.world.worldUid, uid);
    const held = await this.hub.read<Record<string, unknown>>(id);
    await this.hub.commit([{ kind: 'put', doc: this.hub.doc(id, { type: 'hub_world_standing', worldUid: manifest.world.worldUid, uid, standing, why, at: this.hub.now() }, held?.doc.metadata.createdAt) }]);
  }

  /** Connecting a hub: the account is checked, then the world is served. */
  async connect(token: unknown, uid: unknown): Promise<{ ok: true; manifest: IHostedManifest; standing: WorldStanding } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const manifest = await this.manifest();
    if (!manifest) return refuse(404, 'This hub hosts no world.');
    if (typeof uid !== 'string') return refuse(400, 'Name the character that is connecting.');
    const held = await this.hub.read<{ account: string; standing?: string; owed?: unknown[] }>(`hub_character_${uid}`);
    if (!held || held.data.account !== account.key) return refuse(403, 'That character is not one this account holds here. Register it under THE HUB first.');
    // D134: our world takes a character whose arithmetic this hub has rerun and found whole
    if (held.data.standing === 'CHALLENGED') return refuse(403, `This hub's rerun of this character did not land where its own did, so ${manifest.world.name} is closed to it. Everything else plays on.`, { standing: 'CHALLENGED' });
    const owed = held.data.owed?.length ?? 0;
    if (owed > 0) return refuse(409, `This hub has not been sent ${owed} of this character's session receipt${owed === 1 ? '' : 's'} to rerun. Send its receipts under THE HUB first.`, { owed });
    const standing = await this.hub.read<{ standing: WorldStanding; why?: string }>(this.standingId(manifest.world.worldUid, uid));
    if (standing?.data.standing === 'BARRED') {
      return refuse(403, `This character's standing on ${manifest.world.name} is barred${standing.data.why ? `: ${standing.data.why}` : '.'} That is ${manifest.world.name} only: everything else, your own hub and every other world, plays on.`, { standing: 'BARRED' });
    }
    return { ok: true, manifest, standing: 'GOOD' };
  }
}

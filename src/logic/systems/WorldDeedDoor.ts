/**
 * The deed, reaching out: where a world deed meets the store, the ledger and the mint.
 * The rules are in WorldDeed and stay pure.
 *
 * The world's certificate and the spend are two writes, and the deed leaves the stash in
 * the same tick the press lands, so a second press finds nothing to spend. A mint that
 * fails hands the deed back. A tab killed between the two writes leaves a world and an
 * unspent deed: the person keeps their deed rather than lose it to a closed tab.
 */

import { IItem } from '../../../types';
import { IPlayerCertificate } from '../../entities/identity/certificateSystem';
import { IWorldCertificate, IWorldRules, WorldCertificateSystem, WorldType } from '../../entities/world/WorldCertificate';
import { usePlayerStore } from '../../entities/player/store';
import { GoldCommit } from '../economy/GoldCommit';
import { addToStash, removeFromStash, stashItems } from './TemplateSystem';
import { WorldDeed, isWorldDeed } from './WorldDeed';

export interface IDeedMintResult { ok: boolean; reason?: string; world?: IWorldCertificate }

export const WorldDeedDoor = {
  async mint(
    certificate: IPlayerCertificate,
    deedId: string,
    worldName: string,
    worldDescription: string,
    worldType: WorldType,
    rules: Partial<IWorldRules>
  ): Promise<IDeedMintResult> {
    const deed = stashItems().find(i => i.id === deedId);
    if (!deed || !isWorldDeed(deed)) return { ok: false, reason: 'That deed is not in your stash. A world costs a deed.' };
    const size = deed.worldDeedData!.size;
    if (!WorldDeed.offered(size)) return { ok: false, reason: `The bank does not sign a world of ${size}×${size} yet. The deed stays yours.` };

    // In the same tick as the press: this is what makes a second press find nothing.
    removeFromStash([deed.id]);
    const giveBack = (reason: string): IDeedMintResult => {
      addToStash([deed]);
      return { ok: false, reason };
    };

    let world: IWorldCertificate | null;
    try {
      world = await WorldCertificateSystem.mintWorld(certificate, worldName, worldDescription, worldType, size, { ...rules, mintedWithDeed: deed.id });
    } catch (e) {
      return giveBack(e instanceof Error ? e.message : 'Unknown error during signing.');
    }
    if (!world) return giveBack('The certificate refused to sign. The deed stays yours.');

    await GoldCommit.commit({
      rows: [{ type: 'TRADE', data: { kind: 'WORLD_DEED_SPENT', deedId: deed.id, worldUid: world.data.worldUid, size, playerDelta: 0, treasuryDelta: 0 } }]
    });
    return { ok: true, world };
  },

  /** An old save takes its free deed once, on load, and the row and the bank land as one. */
  async grantOnLoad(): Promise<IItem | null> {
    const before = usePlayerStore.getState().player;
    const after = WorldDeed.migrate(before);
    if (after === before) return null;
    usePlayerStore.setState({ player: after });
    const deed = WorldDeed.free(after.id);
    await GoldCommit.commit({
      rows: [{ type: 'TRADE', data: { kind: 'WORLD_DEED_GRANTED', deedId: deed.id, size: deed.worldDeedData!.size, playerDelta: 0, treasuryDelta: 0 } }]
    });
    return deed;
  }
};

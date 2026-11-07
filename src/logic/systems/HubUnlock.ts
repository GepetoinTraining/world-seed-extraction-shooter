/**
 * THE UNLOCK (D49, Pedro: per hub): the first rest in a hub that settles a magic
 * discovery unlocks that hub. Worlds signed after it, and the shelf, carry prefixes
 * and suffixes; a world signed before it stays exactly as it was pinned.
 */

import { Ledger } from '../ledger/Ledger';
import { useHubStore } from '../../entities/hub/store';
import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { SHELF_STATE } from '../../../shared/logic/theme/shelf';

const keyOf = (hubId: string) => `magic_unlocked_${hubId}`;

export class HubUnlock {

  static async isUnlocked(hubId = useHubStore.getState().activeHubId ?? ''): Promise<boolean> {
    if (!hubId) return false;
    const doc = await VectorStore.get<{ by: string; at: number }>(VectorNamespace.TERRITORIES, keyOf(hubId));
    SHELF_STATE.magicUnlocked = !!doc?.data;
    return !!doc?.data;
  }

  /** The first keeps the claim, signed. Later discoveries in the hub change nothing. */
  static async unlock(by: string, what: string, hubId = useHubStore.getState().activeHubId ?? ''): Promise<boolean> {
    if (!hubId || await this.isUnlocked(hubId)) return false;
    await VectorStore.put({
      id: keyOf(hubId), namespace: VectorNamespace.TERRITORIES, data: { by, what, at: Date.now() },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
    SHELF_STATE.magicUnlocked = true;
    await Ledger.append('TECH', { kind: 'MAGIC_UNLOCKED', hubId, by, what });
    return true;
  }
}

/**
 * WHEN A HUB'S TUTORIAL BEGAN TO TURN.
 *
 * The tutorial has no certificate, so nothing signed says when it was made. Its cycles need a
 * start all the same (Pedro's own run, 2026-11-10: "the chests always respawn"): a chest refills
 * on a world's cycles, and a world with no start has none. So the first time a hub lists its
 * tutorial, the moment is written down beside the hub's other world records, and that is the
 * start for everyone who plays there, for good.
 */

import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { TUTORIAL_WORLD_ID } from '../../logic/systems/Tutorial';

const DOC_ID = `world_start_${TUTORIAL_WORLD_ID}`;

export const TutorialStart = {
  /** The start on record, or `now` written down as it. */
  async at(now: number): Promise<number> {
    const doc = await VectorStore.get<{ startedAt: number }>(VectorNamespace.TERRITORIES, DOC_ID);
    if (typeof doc?.data?.startedAt === 'number') return doc.data.startedAt;
    await VectorStore.put({
      id: DOC_ID, namespace: VectorNamespace.TERRITORIES, data: { startedAt: now },
      metadata: { createdAt: now, updatedAt: now, ownerCertUid: 'SYSTEM', version: 1 }
    });
    return now;
  }
};

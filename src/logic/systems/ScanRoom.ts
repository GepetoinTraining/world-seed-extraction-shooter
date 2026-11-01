/**
 * Where the browser's scan pass keeps its papers: beside the world's record, in the same
 * database. A batch and an answer are each one row, written once through the store's own
 * guard, so the first client to touch one owns it, whoever else is running.
 */

import { VectorNamespace, VectorStore } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { DirectorStore } from '../../entities/world/DirectorStore';
import { CreatureLines } from '../theme/CreatureLines';
import type { IScanRoom, IWindowAnswer, IWindowBatch } from './ScanPass';

const batchKey = (worldId: string, id: string) => `scan_${worldId}_batch_${id}`;
const answerKey = (worldId: string, batch: string) => `scan_${worldId}_answer_${batch}`;

const doc = <T>(id: string, data: T) => ({
  id, namespace: VectorNamespace.TERRITORIES, data,
  metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
});

/** True only if this commit did the writing. */
async function firstWriter<T>(id: string, data: T): Promise<boolean> {
  const unit = new StoreUnit();
  unit.onlyIfAbsent(id);
  await VectorStore.put(doc(id, data), false, { unit });
  const result = await unit.commit();
  return result.ok && !!result.applied;
}

export const scanRoom: IScanRoom = {
  load: worldId => DirectorStore.load(worldId),
  save: (worldId, record) => DirectorStore.save(worldId, record),
  catchUp: (worldId, generation, world) => DirectorStore.catchUp(worldId, generation, world),
  define: (record, themeId) => CreatureLines.define(record, themeId),

  async papers(worldId) {
    const [batches, answers] = await Promise.all([
      VectorStore.query<IWindowBatch>({ namespace: VectorNamespace.TERRITORIES, idPrefix: `scan_${worldId}_batch_` }),
      VectorStore.query<IWindowAnswer>({ namespace: VectorNamespace.TERRITORIES, idPrefix: `scan_${worldId}_answer_` })
    ]);
    return { batches: batches.map(d => d.data), answers: answers.map(d => d.data) };
  },

  claim: (worldId, batch) => firstWriter(batchKey(worldId, batch.id), batch),

  async update(worldId, batch) {
    await VectorStore.put(doc(batchKey(worldId, batch.id), batch));
  },

  answer: (worldId, answer) => firstWriter(answerKey(worldId, answer.batch), answer)
};

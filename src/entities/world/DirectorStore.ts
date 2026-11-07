/**
 * Where a world's Director record lives: plain data beside the world, in the same
 * database. The world's clock moves it, a session's fights feed it, and a chunk reads it.
 */

import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { Director, IDirectorRecord, emptyDirectorRecord } from '../../../shared/entities/world/Director';
import { CreatureLines, ILineWorld } from '../../../shared/logic/theme/CreatureLines';

const keyOf = (worldUid: string) => `director_${worldUid}`;

export const DirectorStore = {
  async load(worldUid: string): Promise<IDirectorRecord> {
    const doc = await VectorStore.get<IDirectorRecord>(VectorNamespace.TERRITORIES, keyOf(worldUid));
    return doc?.data ?? emptyDirectorRecord();
  },

  async save(worldUid: string, record: IDirectorRecord): Promise<void> {
    await VectorStore.put({
      id: keyOf(worldUid), namespace: VectorNamespace.TERRITORIES, data: JSON.parse(JSON.stringify(record)) as IDirectorRecord,
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
  },

  /**
   * A world's clock says where it stands; on opening, its record comes up to that. A
   * regeneration is when lines change and are signed, and the kinds it has already
   * grown join the tables before any of its chunks is read.
   */
  async catchUp(worldUid: string, generation: number, world: ILineWorld): Promise<IDirectorRecord> {
    const record = await this.load(worldUid);
    const caught = Director.catchUp(record, generation);
    const regenerated = caught !== record ? await CreatureLines.regenerate(caught, world) : caught;
    if (regenerated !== record) await this.save(worldUid, regenerated);
    await CreatureLines.define(regenerated, world.themeId);
    return regenerated;
  }
};

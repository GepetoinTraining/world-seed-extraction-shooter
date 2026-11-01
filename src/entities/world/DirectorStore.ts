/**
 * Where a world's Director record lives: plain data beside the world, in the same
 * database. The world's clock moves it, a session's fights feed it, and a chunk reads it.
 */

import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { Director, IDirectorRecord, emptyDirectorRecord } from './Director';

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

  /** A world's clock says where it stands; on opening, its record comes up to that. */
  async catchUp(worldUid: string, generation: number): Promise<IDirectorRecord> {
    const record = await this.load(worldUid);
    const caught = Director.catchUp(record, generation);
    if (caught !== record) await this.save(worldUid, caught);
    return caught;
  }
};

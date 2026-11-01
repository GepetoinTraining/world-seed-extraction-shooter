/**
 * Where a world's Director record lives: plain data beside the world, in the same
 * database. A rest moves it, a session's fights feed it, and a chunk reads it.
 */

import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { Director, IDirectorRecord, emptyDirectorRecord } from './Director';

const keyOf = (worldUid: string) => `director_${worldUid}`;

export const DirectorStore = {
  async load(worldUid: string): Promise<IDirectorRecord> {
    const doc = await VectorStore.get<IDirectorRecord>(VectorNamespace.WORLDS, keyOf(worldUid));
    return doc?.data ?? emptyDirectorRecord();
  },

  async save(worldUid: string, record: IDirectorRecord): Promise<void> {
    await VectorStore.put({
      id: keyOf(worldUid), namespace: VectorNamespace.WORLDS, data: record,
      metadata: { createdAt: Date.now(), owner: 'director' }
    } as never);
  },

  /** A rest passes for every world this hub serves. A generation is the only thing that moves. */
  async evolveAll(worldUids: string[]): Promise<void> {
    for (const uid of worldUids) await this.save(uid, Director.evolve(await this.load(uid)));
  }
};

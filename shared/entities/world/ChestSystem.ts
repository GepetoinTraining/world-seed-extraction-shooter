/**
 * THE CHESTS. Pedro: "they should refill on timers, they're position is marked, that's
 * knowledge, but the refill timer should be rarity and rank adjusted, then a chance on
 * every cycle for the world", and of a rare chest in an F chunk guarded by two D rank
 * creatures: "they must re-spawn before the chest can roll to respawn. so in cycle it
 * never does ... you adjust the chance down and check deterministically when the cycle
 * is build the world up".
 *
 * A world's chunks stay a pure function of seed and place; this record lies over them,
 * as carts do. Only what was taken is written. Whether a chest stands full again is
 * computed from that record, the seed and the cycle, so it is the same for everyone and
 * nothing has to run while a world is shut. A world outside the clock has no cycles and
 * keeps no record, so it refills at every drop as it always did.
 *
 * Every number here is a guess until Wave 12.
 */

import { IPlayer, Rarity, UniversalRank } from '../../types';
import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { RANK_ORDER } from '../player/systems/ProgressionSystem';
import { IChunk, IWorldEntity } from './types';

export interface IChestRecord {
  /** The cycle each chest was last emptied in, by entity id. */
  chests: Record<string, { lootedAt: number }>;
  /** The cycle each guard last fell in, by entity id. */
  guards: Record<string, { fellAt: number }>;
}

export const emptyChestRecord = (): IChestRecord => ({ chests: {}, guards: {} });

/** Cycles to wait before a chest can roll: one, and half a cycle more per step of rank and rarity. */
const WAIT_BASE = 1;
const WAIT_STEPS_PER_CYCLE = 2;
/** The d20 a restock must beat. Common at rank F asks 2 or better. */
const DC_BASE = 2;
const DC_PER_RARITY = 3;
const DC_PER_RANK = 1;
const D20 = 20;
/** How long a fallen guard stays down: a cycle, and one more per two steps of its rank. */
const GUARD_RANKS_PER_CYCLE = 2;

/** Common is the floor: scrap is not rarer than common, it is only less. */
const rarityStep = (rarity: Rarity | undefined): number =>
  Math.max(0, [Rarity.COMMON, Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY, Rarity.ARTIFACT].indexOf(rarity as Rarity));
const rankStep = (rank: UniversalRank | undefined): number => Math.max(0, RANK_ORDER.indexOf(rank as UniversalRank));

const GUARD_ID = /^(.*)_guard\d+$/;
const CHEST_ID = /_chest$/;

export class ChestSystem {

  /**
   * Two readings of one world's chests, made one (online play): a chest emptied in either is emptied,
   * at the later cycle; a guard fallen in either has fallen, at the later cycle. Order does not matter.
   */
  static merge(a: IChestRecord, b: IChestRecord): IChestRecord {
    const chests: IChestRecord['chests'] = { ...a.chests };
    for (const [id, c] of Object.entries(b.chests)) chests[id] = { lootedAt: Math.max(c.lootedAt, chests[id]?.lootedAt ?? -Infinity) };
    const guards: IChestRecord['guards'] = { ...a.guards };
    for (const [id, g] of Object.entries(b.guards)) guards[id] = { fellAt: Math.max(g.fellAt, guards[id]?.fellAt ?? -Infinity) };
    return { chests, guards };
  }

  static isChest(entityId: string): boolean {
    return CHEST_ID.test(entityId);
  }

  /** The chest a guard stands over: they are generated together, in one quadrant. */
  static chestOfGuard(entityId: string): string | null {
    const found = GUARD_ID.exec(entityId);
    return found ? `${found[1]}_chest` : null;
  }

  static waitCycles(rank: UniversalRank | undefined, rarity: Rarity | undefined): number {
    return WAIT_BASE + Math.floor((rankStep(rank) + rarityStep(rarity)) / WAIT_STEPS_PER_CYCLE);
  }

  /** The number to beat on a d20. Past 20 it stays 20: a natural 20 always restocks, so nothing is gone forever. */
  static restockDC(rank: UniversalRank | undefined, rarity: Rarity | undefined): number {
    return Math.min(D20, DC_BASE + rarityStep(rarity) * DC_PER_RARITY + rankStep(rank) * DC_PER_RANK);
  }

  static guardCycles(rank: UniversalRank | undefined): number {
    return 1 + Math.floor(rankStep(rank) / GUARD_RANKS_PER_CYCLE);
  }

  /** Is this guard down in this cycle? A fall can only speak for the cycles from its own on. */
  static guardDown(record: IChestRecord, guard: Pick<IWorldEntity, 'id' | 'rank'>, cycle: number): boolean {
    const fell = record.guards[guard.id];
    return !!fell && cycle >= fell.fellAt && cycle < fell.fellAt + this.guardCycles(guard.rank);
  }

  /** The d20 for this chest as this cycle builds the world. The same seed, chest and cycle roll the same. */
  static rolled(seed: string, chestId: string, cycle: number): number {
    return Rng.fromKey(`${seed}:chest:${chestId}:restock:${cycle}`).int(1, D20 + 1);
  }

  /** Does this chest stand empty in this cycle? Never refilled inside the cycle it was emptied in. */
  static standsEmpty(seed: string, record: IChestRecord, chest: Pick<IWorldEntity, 'id' | 'rank' | 'rarity'>, guards: Pick<IWorldEntity, 'id' | 'rank'>[], cycle: number): boolean {
    const looted = record.chests[chest.id];
    if (!looted) return false;
    const first = looted.lootedAt + this.waitCycles(chest.rank, chest.rarity);
    const dc = this.restockDC(chest.rank, chest.rarity);
    for (let c = first; c <= cycle; c++) {
      if (guards.some(g => this.guardDown(record, g, c))) continue;
      if (this.rolled(seed, chest.id, c) >= dc) return false;
    }
    return true;
  }

  /** Lays the record over a chunk as it is built: who is still down, and what stands empty. */
  static layOver(seed: string, chunk: IChunk, record: IChestRecord, cycle: number): void {
    const guards = (chestId: string) => chunk.entities.filter(e => this.chestOfGuard(e.id) === chestId);
    const standing = chunk.entities.map(e => {
      if (e.container && this.isChest(e.id) && this.standsEmpty(seed, record, e, guards(e.id), cycle)) {
        return { ...e, container: { ...e.container, looted: true } };
      }
      return e;
    });
    chunk.entities = standing.filter(e => !(this.chestOfGuard(e.id) && this.guardDown(record, e, cycle)));
  }

  static looted(record: IChestRecord, chestId: string, cycle: number): IChestRecord {
    return { ...record, chests: { ...record.chests, [chestId]: { lootedAt: cycle } } };
  }

  static fell(record: IChestRecord, guardId: string, cycle: number): IChestRecord {
    return { ...record, guards: { ...record.guards, [guardId]: { fellAt: cycle } } };
  }

  // -------------------------------------------------------------------------
  // WHAT A CHARACTER KNOWS. Where a chest is, and how it was last seen; never how it is now.
  // -------------------------------------------------------------------------

  /** Marks a chest in sight. The same person back, same reference, when nothing new was learned. */
  static mark(player: IPlayer, worldId: string, chest: Pick<IWorldEntity, 'id' | 'position' | 'container'>): IPlayer {
    const empty = !!chest.container?.looted;
    const known = player.chestMarks?.[worldId]?.[chest.id];
    if (known && known.empty === empty) return player;
    return {
      ...player,
      chestMarks: {
        ...player.chestMarks,
        [worldId]: { ...player.chestMarks?.[worldId], [chest.id]: { x: chest.position.x, y: chest.position.y, empty } }
      }
    };
  }
}

const docId = (worldUid: string) => `world_chests_${worldUid}`;

export const ChestStore = {
  async load(worldUid: string): Promise<IChestRecord> {
    const doc = await VectorStore.get<IChestRecord>(VectorNamespace.TERRITORIES, docId(worldUid));
    return doc?.data ?? emptyChestRecord();
  },

  async save(worldUid: string, record: IChestRecord): Promise<void> {
    await VectorStore.put({
      id: docId(worldUid), namespace: VectorNamespace.TERRITORIES, data: JSON.parse(JSON.stringify(record)) as IChestRecord,
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
  }
};

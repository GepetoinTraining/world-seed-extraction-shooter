/**
 * WHAT IS TAKEN FROM THE GROUND COMES BACK (RG). Pedro, 2026-11-12, after playing a good while: "The worlds
 * need to regenerate the materials, even the tutorial one, right now it's not a lot of variance."
 *
 * A world's land is a pure function of its seed and is built again at every opening, so until this a taking
 * was forgotten: a stripped vein stood whole at the next visit, the same thing in the same place. This record
 * lies over the land as the chests' does (`ChestSystem`). Only what was taken is written: the turn of the
 * world's gate a place was first taken in since it last stood full, how much was left, and what it was.
 *
 * Nothing runs while nobody is there. Whoever looks next reads the place off the record and the turn the
 * game's clock says it is: still bare until its wait is up, and from the turn it came back, holding what it
 * held (ML17, Pedro: "once something exists it's determined"), so a hub can check it by this file alone.
 *
 * It brings back what the land laid: a tree, a find scattered on the ground, a loose stone, a rare find.
 * Chests, a leader's store and bodies have their own records and are not materials. What a person threw
 * or dropped is not ground, and is not remembered here.
 *
 * It changes nothing the land is built from (`GROUND_VERSION`): a chunk is laid exactly as its world pinned,
 * and an empty record lays nothing over it. So it holds in every world that turns, a standing one included.
 */

import { UniversalRank } from '../../types';
import { EntityType, IChunk, IWorldEntity } from './types';
import { CHUNK_QUADRANTS } from './grid';
import { IGenerationContext, isTimber } from './WorldGenerator';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS, ResourceDef } from '../item/data/resourceDefinitions';
import { isLooseStone } from '../item/Throwable';
import { MaterialPropertyType } from '../economy/types';
import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { groundReturnTurns } from '../../logic/theme/ThemeFormula';

/** One place taken: the turn its clock started, what is left of it, and what it was then. */
export interface ITaken {
  at: number;
  left: number;
  kind: string;
  /** The quality it had, when it was a place that had come back. */
  quality?: number;
}

/** What has been taken from one world's ground, by place. */
export interface IGroundRecord {
  taken: Record<string, ITaken>;
}

export const emptyGroundRecord = (): IGroundRecord => ({ taken: {} });

/** What a place was laid as, read from its id: it comes back as one of the same. */
export type PlaceRole = 'tree' | 'scatter' | 'rare' | 'loose';

/** A place the land lays (`WorldGenerator.fillQuadrant`, `layLoose`): `ent_<qx>_<qy>_` and its role. */
const PLACE = /^ent_(-?\d+)_(-?\d+)_(t\d+|r\d+|rare|loose\d+)$/;


const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const definitionOf = (kind: string): ResourceDef | undefined => RESOURCE_DEFINITIONS[kind];

export class GroundReturn {

  static roleOf(entityId: string): PlaceRole | null {
    const found = PLACE.exec(entityId);
    if (!found) return null;
    const tail = found[3];
    if (tail === 'rare') return 'rare';
    if (tail.startsWith('loose')) return 'loose';
    return tail.startsWith('t') ? 'tree' : 'scatter';
  }

  static isPlace(entityId: string): boolean {
    return this.roleOf(entityId) !== null;
  }

  /** The chunk a place lies in, from its id alone. */
  static chunkKeyOf(entityId: string): string | null {
    const found = PLACE.exec(entityId);
    if (!found) return null;
    return `${Math.floor(Number(found[1]) / CHUNK_QUADRANTS)},${Math.floor(Number(found[2]) / CHUNK_QUADRANTS)}`;
  }

  /** How many turns of its gate a thing takes to come back, read from how hard it is (the formula), never its name. */
  static waitOf(def: Pick<ResourceDef, 'materialProps'> | undefined): number {
    return groundReturnTurns(def?.materialProps?.[MaterialPropertyType.HARDNESS] ?? 1);
  }

  /** The turn a taken place stands again. */
  static comesBackOn(taken: ITaken): number {
    return taken.at + this.waitOf(definitionOf(taken.kind));
  }

  /**
   * A place taken from. Its clock starts at the first taking since it last stood full, so taking the rest
   * later does not put it back; one taken again after it came back starts again, as what came back.
   */
  static took(record: IGroundRecord, place: IWorldEntity, left: number, turn: number): IGroundRecord {
    if (place.type !== EntityType.RESOURCE || !this.isPlace(place.id)) return record;
    const had = record.taken[place.id];
    const next: ITaken = had && turn < this.comesBackOn(had)
      ? { ...had, left: Math.max(0, Math.min(had.left, left)) }
      : { at: turn, left: Math.max(0, left), kind: place.definitionId, ...(place.quality !== undefined ? { quality: place.quality } : {}) };
    return { taken: { ...record.taken, [place.id]: next } };
  }

  /** What a place's role may come back as, on its own land, from its world's own: sorted, so every machine picks alike. */
  static poolOf(role: PlaceRole, biome: string, context: Pick<IGenerationContext, 'resourceDefinitions'>): ResourceDef[] {
    const own = (context.resourceDefinitions as ResourceDef[]).slice().sort(byId);
    const table = BIOME_RESOURCES[biome] ?? [];
    const land = own.filter(d => table.includes(d.id));
    switch (role) {
      case 'tree': return land.filter(isTimber);
      case 'scatter': return land;
      case 'rare': return own.filter(d => d.rareFind && d.habitat?.includes(biome));
      case 'loose': return own.filter(d => isLooseStone(d as never));
    }
  }

  /**
   * What comes back to a place (ML17, Pedro, 2026-11-12: "once something exists it's determined"): what the place
   * held when it was taken, as much as its kind holds, with the quality it had. Nothing is rolled: the same place
   * gives back the same thing on every return, on any machine.
   */
  static cameBack(taken: ITaken): { kind: string; uses: number; quality?: number } {
    const def = definitionOf(taken.kind);
    return { kind: taken.kind, uses: Math.max(1, def?.uses ?? 1), ...(taken.quality !== undefined ? { quality: taken.quality } : {}) };
  }

  /**
   * How a place stands on a turn. Nobody took it: as the land laid it. Taken and its wait not up: what is left
   * of what it was, saying when it comes back. Its wait up: what came back on that turn, whenever it is read.
   */
  static standing(seed: string, place: IWorldEntity, biome: string, record: IGroundRecord, turn: number,
    _context: Pick<IGenerationContext, 'resourceDefinitions'> & { groundVersion?: number }, startsAt?: (turn: number) => number, _landRank?: UniversalRank | string): IWorldEntity {
    const taken = record.taken[place.id];
    if (!taken) return place;
    const { regrowAt: _regrowAt, returning: _returning, quality: _quality, ...rest } = place;
    const due = this.comesBackOn(taken);
    if (turn < due) {
      return {
        ...rest, definitionId: taken.kind, rank: (definitionOf(taken.kind)?.rank as UniversalRank) ?? place.rank, usesRemaining: taken.left,
        ...(taken.quality !== undefined ? { quality: taken.quality } : {}),
        returning: { turn: due, ...(startsAt ? { at: startsAt(due) } : {}) }
      };
    }
    const back = this.cameBack(taken);
    return { ...rest, definitionId: back.kind, rank: (definitionOf(back.kind)?.rank as UniversalRank) ?? place.rank, usesRemaining: back.uses, ...(back.quality !== undefined ? { quality: back.quality } : {}) };
  }

  /** Lays the record over a chunk as it is built. Places it does not name are left exactly as laid. */
  static layOver(seed: string, chunk: IChunk, record: IGroundRecord, turn: number,
    context: Pick<IGenerationContext, 'resourceDefinitions'> & { groundVersion?: number }, startsAt?: (turn: number) => number): void {
    if (Object.keys(record.taken).length === 0) return;
    if (!chunk.entities.some(e => record.taken[e.id])) return;
    chunk.entities = chunk.entities.map(e => (record.taken[e.id] ? this.standing(seed, e, chunk.biome, record, turn, context, startsAt, chunk.difficulty) : e));
  }

  /** Two readings of one world's ground, made one (online play): the later taking stands, in either order. */
  static merge(a: IGroundRecord, b: IGroundRecord): IGroundRecord {
    const later = (x: ITaken, y: ITaken): ITaken =>
      x.at !== y.at ? (x.at > y.at ? x : y) : x.left !== y.left ? (x.left < y.left ? x : y) : (x.kind <= y.kind ? x : y);
    const taken: IGroundRecord['taken'] = { ...a.taken };
    for (const [id, t] of Object.entries(b.taken)) taken[id] = taken[id] ? later(taken[id], t) : t;
    return { taken };
  }
}

const docId = (worldUid: string) => `world_ground_${worldUid}`;

export const GroundStore = {
  docId,

  async load(worldUid: string): Promise<IGroundRecord> {
    const doc = await VectorStore.get<IGroundRecord>(VectorNamespace.TERRITORIES, docId(worldUid));
    return doc?.data?.taken ? doc.data : emptyGroundRecord();
  },

  async save(worldUid: string, record: IGroundRecord): Promise<void> {
    await VectorStore.put({
      id: docId(worldUid), namespace: VectorNamespace.TERRITORIES, data: JSON.parse(JSON.stringify(record)) as IGroundRecord,
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
  }
};

/**
 * THE FIRST ORDER'S LANE (TQ, call 4): the tutorial's ground always holds what the five need.
 *
 * The tutorial is one world for every character on a hub, turning every ten hours: a chest emptied stays empty through its
 * cycle, and a person brought out never stands there again (TQ2). So what the five need is laid for each newcomer, keyed
 * by who they are: what one takes is never another's. It is laid from the way in (the known block's drop) to the way out
 * (the beacon nearest it), in Pedro's order: three creatures of the kind a newcomer fells most easily, a chest, a place a
 * bare hand takes and one the person's own tool takes, and one person who wants out. Each stands on open ground nearest
 * its share of the way, one to a tile, outside the clear ground around the drop.
 *
 * It is laid after the land and before the world's records, so those records hold over it as over anything: a chest
 * opened stays empty its cycle, a person brought out is gone. Nothing of the land moves for it, and it rolls nothing.
 * Pure: a function of the map, the world's content and the person.
 */

import { FirstTask, IItem, Rarity, UniversalRank } from '../../../shared/types';
import { EntityType, IChunk, IMap, IWorldEntity } from '../../../shared/entities/world/types';
import { DROP_CLEAR_TILES, IGenerationContext, WorldGenerator, isTimber } from '../../../shared/entities/world/WorldGenerator';
import { TerrainSystem } from '../../../shared/entities/world/TerrainSystem';
import { CHUNK_TILES, TILE_PX, tileCenter, tileOf } from '../../../shared/entities/world/grid';
import { RESOURCE_DEFINITIONS, type ResourceDef } from '../../../shared/entities/item/data/resourceDefinitions';
import { ExtractLaw } from '../../../shared/logic/systems/ExtractLaw';
import { isLooseStone } from '../../../shared/entities/item/Throwable';
import { fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { Tutorial } from './Tutorial';

/** Where along the way, past the drop's clear ground, each stands: his order, spaced evenly short of the beacon. */
const SHARE: Record<Exclude<FirstTask, 'OUT'>, number> = { FELL: 1 / 6, CHEST: 2 / 6, MATERIAL: 3 / 6, PERSON: 4 / 6 };
/** Two tiles past the clear ground, so nothing of the lane stands at its edge. */
const PAST_CLEAR_TILES = 2;
/** Three bodies stand a few tiles apart round their point; two places, a few tiles along. In tiles. */
const BODY_OFFSETS = [[0, 0], [2, 1], [-1, 2]];
const PLACE_STEP_TILES = 3;

const ELITE = ['elite', 'boss', 'titan', 'god'];
const RANKS = Object.values(UniversalRank) as string[];
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const defOf = (r: any): ResourceDef => (RESOURCE_DEFINITIONS[r.id] ?? r) as ResourceDef;

export interface ILanePiece {
  task: Exclude<FirstTask, 'OUT'>;
  /** Laid as this, at the open tile nearest `position`. */
  entity: IWorldEntity;
}

/** The lane's people, in turn: the first, then whoever stands after one has left. */
const personId = (key: string, n: number) => (n === 0 ? `${key}_npc` : `${key}_npc${n}`);

export interface IWay { from: { x: number; y: number }; to: { x: number; y: number }; length: number }

export const FirstOrderLane = {
  /** What a person's lane is named by: theirs alone. */
  keyOf(personId: string): string {
    return `fo_${fnv1a(`first-order:${personId}`).toString(36)}`;
  },

  /** From the known block's drop to the beacon nearest it. */
  way(map: IMap): IWay | null {
    const block = Tutorial.knownBlock(map);
    const drop = WorldGenerator.dropPoint(map, block.x, block.y);
    const exit = WorldGenerator.nearestExit(map, drop.x, drop.z);
    if (!exit) return null;
    return { from: { x: drop.x, y: drop.z }, to: { x: exit.x, y: exit.y }, length: exit.distance };
  },

  /** The kind a newcomer fells most easily: no elite, the lowest rank, then the least held and dealt, then by id. */
  creatureOf(context: Pick<IGenerationContext, 'mobDefinitions'>): any | null {
    const plain = context.mobDefinitions.filter((m: any) => !(m.tags ?? []).some((t: string) => ELITE.includes(t)));
    return [...plain].sort((a: any, b: any) =>
      RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) || a.baseHealth * a.baseDamage - b.baseHealth * b.baseDamage || byId(a, b))[0] ?? null;
  },

  /** A place a bare hand takes: no tool asked, no loose stone, nothing very rare; the lowest rank, then by id. */
  handPlaceOf(context: Pick<IGenerationContext, 'resourceDefinitions'>): ResourceDef | null {
    return context.resourceDefinitions.map(defOf)
      .filter(d => d.harvestConfig && ExtractLaw.asks(d).length === 0 && !isLooseStone(d) && !(d as any).rareFind)
      .sort((a, b) => RANKS.indexOf(String(a.rank)) - RANKS.indexOf(String(b.rank)) || byId(a, b))[0] ?? null;
  },

  /** A place a tool this person carries takes; none where they carry none that fits anything. */
  toolPlaceOf(context: Pick<IGenerationContext, 'resourceDefinitions'>, carried: IItem[]): ResourceDef | null {
    return context.resourceDefinitions.map(defOf)
      .filter(d => d.harvestConfig && ExtractLaw.asks(d).length > 0 && !(d as any).rareFind && !!ExtractLaw.toolFor(carried, d))
      .sort((a, b) => RANKS.indexOf(String(a.rank)) - RANKS.indexOf(String(b.rank)) || byId(a, b))[0] ?? null;
  },

  /**
   * What this person's lane holds, each at the point of the way it is meant for. `gone` says who has left the world for
   * good (`Population.left`): someone of the lane carried out, which the fourth does not count, gives way to the next, so
   * the lane always holds one person to bring out.
   */
  pieces(map: IMap, context: IGenerationContext, person: { id: string; carried: IItem[]; gone?: (id: string) => boolean }): ILanePiece[] {
    const way = this.way(map);
    if (!way || way.length <= 0) return [];
    const key = this.keyOf(person.id);
    const clear = (DROP_CLEAR_TILES + PAST_CLEAR_TILES) * TILE_PX;
    const dx = (way.to.x - way.from.x) / way.length, dy = (way.to.y - way.from.y) / way.length;
    const at = (share: number, tilesAlong = 0, side: [number, number] = [0, 0]) => {
      const d = clear + share * Math.max(0, way.length - clear) + tilesAlong * TILE_PX;
      return { x: way.from.x + dx * d + side[0] * TILE_PX, y: way.from.y + dy * d + side[1] * TILE_PX };
    };
    const out: ILanePiece[] = [];
    const base = { rank: UniversalRank.F, rarity: Rarity.COMMON };

    const kind = this.creatureOf(context);
    if (kind) BODY_OFFSETS.forEach((side, i) => out.push({
      task: 'FELL',
      // The body's numbers are the ground's, laid when its chunk is (`WorldGenerator.plainBodyAt`)
      entity: { id: `${key}_c${i}`, type: EntityType.MOB, definitionId: kind.id, position: at(SHARE.FELL, 0, side as [number, number]), ...base, isHostile: true }
    }));

    out.push({
      task: 'CHEST',
      entity: { id: `${key}_chest`, type: EntityType.CONTAINER, definitionId: 'chest_ruin', position: at(SHARE.CHEST), ...base, isHostile: false, container: { lootRank: UniversalRank.F, looted: false, hasLore: true } }
    });

    const places = [this.handPlaceOf(context), this.toolPlaceOf(context, person.carried)];
    places.forEach((def, i) => {
      if (!def) return;
      out.push({
        task: 'MATERIAL',
        entity: { id: `${key}_p${i}`, type: EntityType.RESOURCE, definitionId: def.id, position: at(SHARE.MATERIAL, i * PLACE_STEP_TILES), rank: (def.rank as UniversalRank) ?? UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, usesRemaining: (def as any).uses ?? 1 }
      });
    });

    // Someone who wants out: easy to warm, and a gift of anything carried brings them round (`int_gift_`, `int_recruit_`)
    let n = 0;
    while (person.gone?.(personId(key, n))) n++;
    const id = personId(key, n);
    out.push({
      task: 'PERSON',
      entity: {
        id, type: EntityType.NPC, definitionId: 'npc_survivor', position: at(SHARE.PERSON), ...base, isHostile: false,
        npc: { name: WorldGenerator.personName(id, context), temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 50, attempts: 0 }
      }
    });
    return out;
  },

  /**
   * Lays the pieces meant for this chunk as it is built: each on the open tile of the chunk nearest its point, on
   * mainland, not under a trunk and one to a tile. A creature stands at the chunk's rank by the ground's law.
   */
  layOn(chunk: IChunk, pieces: ILanePiece[], seed: string, context: IGenerationContext): void {
    const x0 = chunk.x * CHUNK_TILES, y0 = chunk.y * CHUNK_TILES;
    const mine = pieces.filter(p => Math.floor(tileOf(p.entity.position.x) / CHUNK_TILES) === chunk.x && Math.floor(tileOf(p.entity.position.y) / CHUNK_TILES) === chunk.y);
    if (mine.length === 0) return;
    const taken = new Set(chunk.entities.map(e => `${tileOf(e.position.x)},${tileOf(e.position.y)}`));
    const trunks = new Set(chunk.entities.filter(e => e.type === EntityType.RESOURCE && isTimber(RESOURCE_DEFINITIONS[e.definitionId])).map(e => `${tileOf(e.position.x)},${tileOf(e.position.y)}`));
    const open = (tx: number, ty: number) =>
      tx >= x0 && ty >= y0 && tx < x0 + CHUNK_TILES && ty < y0 + CHUNK_TILES && !taken.has(`${tx},${ty}`) && !trunks.has(`${tx},${ty}`)
      && !TerrainSystem.isBlockedTile(seed, tx, ty) && WorldGenerator.isMainland(seed, tx, ty);
    for (const piece of mine) {
      const tx = tileOf(piece.entity.position.x), ty = tileOf(piece.entity.position.y);
      let spot: { x: number; y: number } | null = null;
      for (let r = 0; r < CHUNK_TILES && !spot; r++) {
        for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (open(tx + dx, ty + dy)) spot = { x: tx + dx, y: ty + dy };
        }
      }
      if (!spot) continue;
      taken.add(`${spot.x},${spot.y}`);
      const position = { x: tileCenter(spot.x), y: tileCenter(spot.y) };
      const kind = piece.entity.type === EntityType.MOB ? context.mobDefinitions.find((m: any) => m.id === piece.entity.definitionId) : null;
      chunk.entities.push(kind
        ? WorldGenerator.plainBodyAt(chunk, piece.entity.id, kind, position, context)
        : { ...piece.entity, position, ...(piece.entity.container ? { container: { ...piece.entity.container, lootRank: chunk.difficulty } } : {}) });
    }
  }
};

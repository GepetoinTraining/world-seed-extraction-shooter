import { BiomeType, EntityType, IChunk, IMap, ISector, IWorldEntity, ScanLevel } from './types';
import { GenreType } from './definitions';
import { TerrainSystem } from './TerrainSystem';
import {
  CHUNK_QUADRANTS, GRID_VERSION, QUADRANT_TILES, SECTOR_CHUNKS, SECTOR_PX, SECTOR_TILES,
  chunkOf, sectorOf, tileCenter, tileOf
} from './grid';
import { UniversalRank, Rarity } from '../../../types';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { hash2, layerSeed, valueNoise } from '../../logic/rng/noise';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { Director, IDirectorPool, IDirectorRecord } from './Director';

export interface IGenerationContext {
  mobDefinitions: any[];
  resourceDefinitions: any[];
  /** R4: the world's own difficulty rule. Absent only for bars that pin the noise alone. */
  difficulty?: UniversalRank;
  /** D53: the theme this world pinned. */
  themeId?: string;
  /** D48: how this world's monsters have come along, and what they may become. */
  director?: IDirectorRecord;
  directorPool?: IDirectorPool;
  /** What a world's record lays over a chunk once it is built. The build itself stays pure. */
  lay?: (chunk: IChunk) => void;
}

/** Timber: what makes a forest, and what a trunk is. Read from what it is, never by a name. */
export const isTimber = (def: any): boolean => {
  const tags: string[] = def?.tags ?? [];
  return tags.includes('flora') && tags.includes('wood') && !tags.includes('seed');
};

/** R4: an elite is rare, and alone. Read from its tags, so a theme's own elite counts. */
const ELITE_TAGS = ['elite', 'boss', 'titan', 'god'];
const isElite = (mob: any) => (mob.tags ?? []).some((t: string) => ELITE_TAGS.includes(t));
const ELITE_WEIGHT = 0.04;
/** Each rank further from the chunk's own counts for this much less. */
const RANK_FALLOFF = 0.35;

// Rolls pick by index, so definitions need an order the database cannot change.
const byId = (a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sorted = new WeakMap<IGenerationContext, IGenerationContext>();
function ordered(context: IGenerationContext): IGenerationContext {
  let value = sorted.get(context);
  if (!value) {
    value = {
      ...context,
      mobDefinitions: [...context.mobDefinitions].sort(byId),
      resourceDefinitions: [...context.resourceDefinitions].sort(byId)
    };
    sorted.set(context, value);
  }
  return value;
}

// Periods are in chunks, chosen so a region is several screens of walking across.
const BIOME_PERIOD = 7;
/** R4: how far above a world's difficulty its worst ground reaches. */
const MAX_CLIMB = 2;
const RANK_PERIOD = 14;
const FOREST_PERIOD = 3;
const EXITS_PER_SIDE = 2;
const MAINLAND_TILES = 3000;
const EXIT_SEARCH_TILES = 48;

const RANK_BANDS: [number, UniversalRank, Rarity][] = [
  [0.42, UniversalRank.F, Rarity.COMMON],
  [0.50, UniversalRank.E, Rarity.UNCOMMON],
  [0.57, UniversalRank.D, Rarity.RARE],
  [0.63, UniversalRank.C, Rarity.EPIC],
  [0.68, UniversalRank.B, Rarity.LEGENDARY],
  [0.74, UniversalRank.A, Rarity.LEGENDARY],
  [1.01, UniversalRank.S, Rarity.ARTIFACT]
];

const FIRST_NAMES = ['Kael', 'Vector', 'Sera', 'Io', 'Null', 'Cassin', 'Orrin', 'Vesta'];
const SURNAMES = ['Steelweave', 'Basalt', 'Error', 'Null', 'Gantry', 'Mireforge', 'Siltvane'];
const TEMPERAMENTS = ['AGGRESSIVE', 'COWARD', 'TERRITORIAL', 'PASSIVE', 'OPPORTUNIST'] as const;
const OBJECTIVES = ['SURVIVE', 'HOARD', 'WITNESS', 'PROTECT_ASSET'] as const;
const WANTS = ['GOLD', 'GIFT', 'RESPECT'] as const;

const clampTile = (t: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, t));
const exitCache = new Map<string, { x: number; y: number }[]>();
const dropCache = new Map<string, { x: number; y: number } | null>();
const DROP_CLEAR_TILES = 14;

/** Places things on tiles, keeping them on open ground and one to a tile. */
class TileField {
  private taken = new Set<string>();
  constructor(private seed: string, private x0: number, private y0: number) {}

  reserve(tx: number, ty: number) { this.taken.add(`${tx},${ty}`); }

  private free(tx: number, ty: number) {
    return !this.taken.has(`${tx},${ty}`) && !TerrainSystem.isBlockedTile(this.seed, tx, ty);
  }

  /** The nearest free tile to a wanted one, inside this quadrant. Null if there is none. */
  place(tx: number, ty: number): { x: number; y: number } | null {
    const lo = (v: number) => clampTile(v, 0, QUADRANT_TILES - 1);
    const wx = lo(tx - this.x0), wy = lo(ty - this.y0);
    for (let r = 0; r < QUADRANT_TILES; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const qx = wx + dx, qy = wy + dy;
        if (qx < 0 || qy < 0 || qx >= QUADRANT_TILES || qy >= QUADRANT_TILES) continue;
        const ax = this.x0 + qx, ay = this.y0 + qy;
        if (this.free(ax, ay)) {
          this.reserve(ax, ay);
          return { x: tileCenter(ax), y: tileCenter(ay) };
        }
      }
    }
    return null;
  }
}

/** Pedro: "very very rare". One quadrant in two thousand: about one a sector and a half. */
export const RARE_FIND_CHANCE = 1 / 2000;

export class WorldGenerator {

  /** Opens a world. Only sector summaries are worked out; chunks are built when reached. */
  static generate(seed: string, size: number, context?: IGenerationContext): IMap {
    const sectors: Record<string, ISector> = {};
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (this.sectorExists(seed, size, x, y)) sectors[`${x},${y}`] = this.sectorSummary(seed, x, y, context?.difficulty);
    }
    return { seed, width: size, height: size, gridVersion: GRID_VERSION, sectors, chunks: {}, generatedAt: Date.now() };
  }

  /** The world is a rough disc of sectors. */
  static sectorExists(seed: string, size: number, sx: number, sy: number): boolean {
    if (sx < 0 || sy < 0 || sx >= size || sy >= size) return false;
    const center = Math.floor(size / 2);
    const dist = Math.hypot(sx - center, sy - center) / (size / 2);
    const noise = hash2(layerSeed(seed, 'shape:v2'), sx, sy) / 0x100000000;
    return dist < 0.8 + noise * 0.3;
  }

  // ---------------------------------------------------------------------------
  // REGIONS: pure functions of a chunk's place.
  // ---------------------------------------------------------------------------

  static biomeAt(seed: string, cx: number, cy: number): BiomeType {
    const wet = valueNoise(layerSeed(seed, 'biome:wet:v2'), cx, cy, BIOME_PERIOD);
    const built = valueNoise(layerSeed(seed, 'biome:built:v2'), cx, cy, BIOME_PERIOD);
    if (built > 0.6) return wet > 0.5 ? BiomeType.CYBER_CITY : BiomeType.INDUSTRIAL;
    if (wet > 0.54) return BiomeType.OVERGROWTH;
    return built < 0.44 ? BiomeType.WASTELAND : BiomeType.RUINS;
  }


  /**
   * R4's first fault: a world's difficulty did nothing. It sets the floor now, and the
   * noise climbs at most two ranks above it, so a world said to be E is never mostly S.
   */
  private static rankBand(seed: string, cx: number, cy: number, difficulty?: UniversalRank) {
    const n = valueNoise(layerSeed(seed, 'rank:v2'), cx, cy, RANK_PERIOD);
    const band = RANK_BANDS.find(([limit]) => n < limit)!;
    if (!difficulty) return band;
    const order = Object.values(UniversalRank);
    const index = RANK_BANDS.indexOf(band);
    const climb = Math.min(MAX_CLIMB, Math.floor((index / RANK_BANDS.length) * (MAX_CLIMB + 1)));
    const step = Math.min(order.length - 1, order.indexOf(difficulty) + climb);
    return [band[0], order[step], band[2]] as typeof band;
  }

  static rankAt(seed: string, cx: number, cy: number, difficulty?: UniversalRank): UniversalRank {
    return this.rankBand(seed, cx, cy, difficulty)[1];
  }

  private static sectorSummary(seed: string, sx: number, sy: number, difficulty?: UniversalRank): ISector {
    const counts: Partial<Record<BiomeType, number>> = {};
    const order = Object.values(UniversalRank);
    let top = 0;
    let rarity = Rarity.COMMON;
    // Every second chunk is enough for a summary, and a large world has thousands of sectors.
    for (let y = 0; y < SECTOR_CHUNKS; y += 2) for (let x = 0; x < SECTOR_CHUNKS; x += 2) {
      const cx = sx * SECTOR_CHUNKS + x, cy = sy * SECTOR_CHUNKS + y;
      const biome = this.biomeAt(seed, cx, cy);
      counts[biome] = (counts[biome] || 0) + 1;
      const [, rank, r] = this.rankBand(seed, cx, cy, difficulty);
      if (order.indexOf(rank) > top) { top = order.indexOf(rank); rarity = r; }
    }
    const biome = (Object.entries(counts) as [BiomeType, number][]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    return {
      id: `sec_${sx}_${sy}`, x: sx, y: sy, biome, difficulty: order[top], rarity,
      entities: [], scanLevel: ScanLevel.UNKNOWN, hasExtraction: true
    };
  }

  // ---------------------------------------------------------------------------
  // EXITS: a few to a sector, so a run stays about the same length in any world.
  // ---------------------------------------------------------------------------

  static exitsInSector(map: Pick<IMap, 'seed'>, sx: number, sy: number): { x: number; y: number }[] {
    const key = `${map.seed}:${sx},${sy}`;
    const held = exitCache.get(key);
    if (held) return held;

    const seed = layerSeed(map.seed, 'exit:v2');
    const block = Math.floor(SECTOR_TILES / EXITS_PER_SIDE);
    const margin = 8;
    const out: { x: number; y: number }[] = [];
    for (let by = 0; by < EXITS_PER_SIDE; by++) for (let bx = 0; bx < EXITS_PER_SIDE; bx++) {
      const span = block - margin * 2;
      const lx = margin + hash2(seed, sx * 4 + bx, sy * 4 + by) % span;
      const ly = margin + hash2(seed + 1, sx * 4 + bx, sy * 4 + by) % span;
      const spot = this.nearestMainlandTile(map.seed, sx, sy, sx * SECTOR_TILES + bx * block + lx, sy * SECTOR_TILES + by * block + ly, EXIT_SEARCH_TILES);
      if (spot) out.push({ x: tileCenter(spot.x), y: tileCenter(spot.y) });
    }
    if (exitCache.size > 4096) exitCache.clear();
    exitCache.set(key, out);
    return out;
  }

  /** Open ground joined to plenty more, so an island can never hold a drop or an exit. */
  private static isMainland(seed: string, tx: number, ty: number): boolean {
    const seen = new Set<number>();
    const pack = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
    let frontier = [[tx, ty]];
    seen.add(pack(tx, ty));
    while (frontier.length > 0) {
      const next: number[][] = [];
      for (const [x, y] of frontier) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, key = pack(nx, ny);
          if (seen.has(key) || TerrainSystem.isBlockedTile(seed, nx, ny)) continue;
          seen.add(key);
          if (seen.size >= MAINLAND_TILES) return true;
          next.push([nx, ny]);
        }
      }
      frontier = next;
    }
    return false;
  }

  /** Searches outward, staying inside the sector, in steps that skip over small gaps. */
  private static nearestMainlandTile(seed: string, sx: number, sy: number, tx: number, ty: number, radius: number): { x: number; y: number } | null {
    for (let r = 0; r <= radius; r += r < 4 ? 1 : 4) {
      for (let dy = -r; dy <= r; dy += Math.max(1, r)) for (let dx = -r; dx <= r; dx += Math.max(1, r)) {
        const x = tx + dx, y = ty + dy;
        if (Math.floor(x / SECTOR_TILES) !== sx || Math.floor(y / SECTOR_TILES) !== sy) continue;
        if (!TerrainSystem.isBlockedTile(seed, x, y) && this.isMainland(seed, x, y)) return { x, y };
      }
    }
    return null;
  }

  static nearestExit(map: IMap, px: number, py: number): { x: number; y: number; distance: number } | null {
    const sx = sectorOf(px), sy = sectorOf(py);
    let best: { x: number; y: number; distance: number } | null = null;
    for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 1; x++) {
      if (!map.sectors[`${x},${y}`]) continue;
      for (const e of this.exitsInSector(map, x, y)) {
        const distance = Math.hypot(e.x - px, e.y - py);
        if (!best || distance < best.distance) best = { ...e, distance };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // MOVEMENT against the edge of the world.
  // ---------------------------------------------------------------------------

  static isInWorld(map: IMap, px: number, py: number): boolean {
    return !!map.sectors[`${sectorOf(px)},${sectorOf(py)}`];
  }

  static isWalkableTile(map: IMap, tx: number, ty: number): boolean {
    return this.isInWorld(map, tileCenter(tx), tileCenter(ty)) && !TerrainSystem.isBlockedTile(map.seed, tx, ty);
  }

  static resolveMove(map: IMap, x: number, z: number, dx: number, dz: number) {
    return TerrainSystem.resolveMove(map.seed, x, z, dx, dz, undefined,
      (nx, nz) => this.isInWorld(map, nx, nz) && !this.trunkAt(map, nx, nz));
  }

  /**
   * D3: a standing trunk blocks its tile, and you walk under the crown. A stump
   * blocks nothing. Checked at the destination only, so nothing is ever trapped.
   */
  static trunkAt(map: IMap, px: number, pz: number): boolean {
    const chunk = map.chunks[`${chunkOf(px)},${chunkOf(pz)}`];
    if (!chunk) return false;
    const tx = tileOf(px), ty = tileOf(pz);
    for (const e of chunk.entities) {
      if (e.type !== EntityType.RESOURCE || !isTimber(RESOURCE_DEFINITIONS[e.definitionId])) continue;
      if ((e.usesRemaining ?? 3) <= 0) continue;
      if (tileOf(e.position.x) === tx && tileOf(e.position.y) === ty) return true;
    }
    return false;
  }

  /** Where a drop into a sector lands: its middle, or the nearest open ground to it. */
  static dropPoint(map: IMap, sx: number, sy: number): { x: number; z: number } {
    const spot = this.dropTile(map.seed, sx, sy);
    return spot ? { x: tileCenter(spot.x), z: tileCenter(spot.y) } : { x: (sx + 0.5) * SECTOR_PX, z: (sy + 0.5) * SECTOR_PX };
  }

  private static dropTile(seed: string, sx: number, sy: number): { x: number; y: number } | null {
    const key = `${seed}:${sx},${sy}`;
    if (dropCache.has(key)) return dropCache.get(key)!;
    const mid = SECTOR_TILES >> 1;
    const spot = this.nearestMainlandTile(seed, sx, sy, sx * SECTOR_TILES + mid, sy * SECTOR_TILES + mid, SECTOR_TILES >> 1);
    if (dropCache.size > 4096) dropCache.clear();
    dropCache.set(key, spot);
    return spot;
  }

  // ---------------------------------------------------------------------------
  // SPAWNS
  // ---------------------------------------------------------------------------

  /**
   * Enemies a chunk may spawn: what lives on this ground, at or below its rank. When
   * nothing is that low, only the weakest non-boss qualifies.
   */
  private static spawnPool(context: IGenerationContext, biome: BiomeType, rank: UniversalRank): any[] {
    const order = Object.values(UniversalRank);
    const rankOf = (m: any) => order.indexOf(m.rank);
    // Ground with nothing of its own borrows from everyone, or the region would stand empty.
    const own = context.mobDefinitions.filter((m: any) => !m.habitat || m.habitat.includes(biome));
    const living = own.length > 0 ? own : context.mobDefinitions;
    const eligible = living.filter((m: any) => rankOf(m) <= order.indexOf(rank));
    if (eligible.length > 0) return eligible;

    const regulars = living.filter((m: any) => !isElite(m));
    const candidates = regulars.length > 0 ? regulars : living;
    const lowest = Math.min(...candidates.map(rankOf));
    return candidates.filter((m: any) => rankOf(m) === lowest);
  }

  /**
   * R4's second fault: the pool was flat, so a third of a rich chunk's packs were dragons.
   * A pick is weighted toward the chunk's own rank, and an elite is scarce.
   */
  private static pickSpawn(rng: { next: () => number }, pool: any[], rank: UniversalRank): any {
    const order = Object.values(UniversalRank);
    const weight = (m: any) => Math.pow(RANK_FALLOFF, Math.abs(order.indexOf(rank) - order.indexOf(m.rank))) * (isElite(m) ? ELITE_WEIGHT : 1);
    const total = pool.reduce((sum, m) => sum + weight(m), 0);
    let roll = rng.next() * total;
    for (const m of pool) {
      roll -= weight(m);
      if (roll <= 0) return m;
    }
    return pool[pool.length - 1];
  }

  /** A chunk from its place alone: same seed and place, same chunk, in any world and any order. */
  static buildChunk(seed: string, exits: { x: number; y: number }[], cx: number, cy: number, context: IGenerationContext): IChunk {
    const ctx = ordered(context);
    const biome = this.biomeAt(seed, cx, cy);
    const [, rank, rarity] = this.rankBand(seed, cx, cy, ctx.difficulty);

    const chunk: IChunk = {
      id: `chk_${cx}_${cy}`, x: cx, y: cy, biome, difficulty: rank, rarity,
      entities: [], scanLevel: ScanLevel.UNKNOWN, isTraversable: true, hasExtraction: false
    };

    const inChunk = exits.filter(e => chunkOf(e.x) === cx && chunkOf(e.y) === cy);
    inChunk.forEach((e, i) => {
      chunk.hasExtraction = true;
      chunk.entities.push({
        id: `ent_${cx}_${cy}_beacon${i}`, type: EntityType.EXTRACTION, definitionId: 'extraction_beacon',
        position: { x: e.x, y: e.y }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false
      });
    });

    for (let qy = 0; qy < CHUNK_QUADRANTS; qy++) for (let qx = 0; qx < CHUNK_QUADRANTS; qx++) {
      this.fillQuadrant(chunk, seed, cx * CHUNK_QUADRANTS + qx, cy * CHUNK_QUADRANTS + qy, biome, rank, rarity, ctx, inChunk);
    }
    return chunk;
  }

  /** Does this quadrant hold a very rare find, if the world has one for this ground? */
  static rareFindAt(seed: string, qx: number, qy: number): boolean {
    return Rng.fromKey(`${seed}:rare:v1:${qx},${qy}`).next() < RARE_FIND_CHANCE;
  }

  private static fillQuadrant(
    chunk: IChunk, seed: string, qx: number, qy: number, biome: BiomeType,
    rank: UniversalRank, rarity: Rarity, ctx: IGenerationContext, exits: { x: number; y: number }[]
  ) {
    const rng = Rng.fromKey(`${seed}:quad:v2:${qx},${qy}`);
    const x0 = qx * QUADRANT_TILES, y0 = qy * QUADRANT_TILES;
    const field = new TileField(seed, x0, y0);
    exits.forEach(e => field.reserve(tileOf(e.x), tileOf(e.y)));
    const tile = () => [x0 + rng.int(0, QUADRANT_TILES), y0 + rng.int(0, QUADRANT_TILES)];
    const id = (suffix: string) => `ent_${qx}_${qy}_${suffix}`;
    const push = (e: IWorldEntity) => chunk.entities.push(e);

    // The ground around a drop is kept clear, so nobody lands in a fight.
    const drop = this.dropTile(seed, Math.floor(x0 / SECTOR_TILES), Math.floor(y0 / SECTOR_TILES));
    const nearDrop = (px: number, py: number) => !!drop && Math.hypot(tileOf(px) - drop.x, tileOf(py) - drop.y) < DROP_CLEAR_TILES;

    const mob = (suffix: string, template: any, tx: number, ty: number) => {
      const at = field.place(tx, ty);
      if (!at || nearDrop(at.x, at.y)) return;
      const body = id(suffix);
      template = Director.kindOf(seed, body, template, ctx.director);
      const variant = Director.variantOf(seed, body, template.id, template.name, ctx.director, ctx.directorPool, template.tags, template.generation);
      push({
        id: body, type: EntityType.MOB, definitionId: template.id, position: at,
        rank: template.rank, rarity: Rarity.COMMON, isHostile: true, health: template.baseHealth + variant.bonusHealth,
        ...(variant.displayName ? { displayName: variant.displayName } : {}),
        ...(variant.traits.length > 0 || variant.learned.length > 0 ? {
          bonusHealth: variant.bonusHealth, bonusDamage: variant.bonusDamage, learned: variant.learned
        } : {})
      });
    };

    // Ruins first: they anchor everything around them.
    if (rng.next() < 0.1) {
      const [sx, sy] = tile();
      const at = field.place(sx, sy);
      if (at) {
        push({ id: id('struct'), type: EntityType.STRUCTURE, definitionId: 'struct_ruin', position: at, rank, rarity, isHostile: false });
        const chest = field.place(sx + rng.int(-2, 3), sy + rng.int(-2, 3));
        if (chest) {
          push({
            id: id('chest'), type: EntityType.CONTAINER, definitionId: 'chest_ruin', position: chest, rank, rarity, isHostile: false,
            container: { lootRank: rank, looted: false, hasLore: true }
          });
        }
        const guards = this.spawnPool(ctx, biome, rank).filter((m: any) => !isElite(m));
        for (let g = 0; g < 2 && guards.length > 0; g++) mob(`guard${g}`, this.pickSpawn(rng, guards, rank), sx + rng.int(-3, 4), sy + rng.int(-3, 4));
      }
    }

    // Packs: enemies come in small groups, with empty ground between them.
    if (rng.next() < 0.45) {
      const pool = this.spawnPool(ctx, biome, rank);
      if (pool.length > 0) {
        const template = this.pickSpawn(rng, pool, rank);
        const [px, py] = tile();
        const count = isElite(template) ? 1 : rng.int(1, 4);
        for (let i = 0; i < count; i++) mob(`m${i}`, template, px + rng.int(-2, 3), py + rng.int(-2, 3));
      }
    }

    // What grows or lies here, from the biome's own table.
    const allowed = BIOME_RESOURCES[biome] || [];
    const pool = ctx.resourceDefinitions.filter((r: any) => allowed.includes(r.id));
    const resource = (suffix: string, template: any, tx: number, ty: number) => {
      const at = field.place(tx, ty);
      if (!at) return;
      push({
        id: id(suffix), type: EntityType.RESOURCE, definitionId: template.id, position: at,
        rank: template.rank || UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, usesRemaining: template.uses ?? 1
      });
    };

    const tree = pool.find(isTimber);
    const woodland = valueNoise(layerSeed(seed, 'forest:v2'), qx, qy, FOREST_PERIOD);
    if (tree && woodland > 0.5) {
      const count = rng.int(9, 19);
      for (let i = 0; i < count; i++) {
        const [tx, ty] = tile();
        resource(`t${i}`, tree, tx, ty);
      }
    }
    const scatter = rng.int(1, 5);
    for (let i = 0; i < scatter && pool.length > 0; i++) {
      const [tx, ty] = tile();
      resource(`r${i}`, rng.pick(pool), tx, ty);
    }
    // A plant that refills energy stands outside that table, on a roll of its own, so a
    // pack without one generates exactly what it always did.
    const rare = ctx.resourceDefinitions.filter((r: any) => r.rareFind && r.habitat?.includes(biome));
    if (rare.length > 0 && this.rareFindAt(seed, qx, qy)) {
      const own = Rng.fromKey(`${seed}:rare:pick:${qx},${qy}`);
      resource('rare', own.pick(rare), x0 + own.int(0, QUADRANT_TILES), y0 + own.int(0, QUADRANT_TILES));
    }

    // People, rarely, with a rolled sheet.
    if (rng.next() < 0.06) {
      const [nx, ny] = tile();
      const at = field.place(nx, ny);
      if (at) {
        const temperament = rng.pick([...TEMPERAMENTS]);
        push({
          id: id('npc'), type: EntityType.NPC, definitionId: 'npc_survivor', position: at, rank, rarity, isHostile: false,
          npc: {
            name: `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`,
            temperament, objective: rng.pick([...OBJECTIVES]), want: rng.pick([...WANTS]),
            // Passive folk start warmer; aggressive ones colder
            disposition: temperament === 'PASSIVE' ? 50 : temperament === 'AGGRESSIVE' ? 10 : 30,
            attempts: 0
          }
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ON DEMAND
  // ---------------------------------------------------------------------------

  /** A chunk of this world, built the first time it is asked for. Null beyond the world's edge. */
  static chunkAt(map: IMap, cx: number, cy: number, context: IGenerationContext): IChunk | null {
    const key = `${cx},${cy}`;
    const held = map.chunks[key];
    if (held) return held;
    const sx = Math.floor(cx / SECTOR_CHUNKS), sy = Math.floor(cy / SECTOR_CHUNKS);
    if (!map.sectors[`${sx},${sy}`]) return null;
    const chunk = this.buildChunk(map.seed, this.exitsInSector(map, sx, sy), cx, cy, context);
    context.lay?.(chunk);
    map.chunks[key] = chunk;
    return chunk;
  }

  /** Everything in a sector, for a deep scan. */
  static sectorContents(map: IMap, sx: number, sy: number, context: IGenerationContext): IWorldEntity[] {
    const out: IWorldEntity[] = [];
    if (!map.sectors[`${sx},${sy}`]) return out;
    const exits = this.exitsInSector(map, sx, sy);
    for (let y = 0; y < SECTOR_CHUNKS; y++) for (let x = 0; x < SECTOR_CHUNKS; x++) {
      const cx = sx * SECTOR_CHUNKS + x, cy = sy * SECTOR_CHUNKS + y;
      let chunk = map.chunks[`${cx},${cy}`];
      if (!chunk) {
        chunk = this.buildChunk(map.seed, exits, cx, cy, context);
        context.lay?.(chunk);
      }
      out.push(...chunk.entities);
    }
    return out;
  }

  /** The chunks a square around a point touches. */
  static chunkKeysInBox(px: number, py: number, radius: number): string[] {
    const keys: string[] = [];
    for (let y = chunkOf(py - radius); y <= chunkOf(py + radius); y++) {
      for (let x = chunkOf(px - radius); x <= chunkOf(px + radius); x++) keys.push(`${x},${y}`);
    }
    return keys;
  }

  /** Makes sure everything around a point exists, returning any chunks just built. */
  static loadAround(map: IMap, px: number, py: number, radius: number, context: IGenerationContext): IChunk[] {
    const built: IChunk[] = [];
    this.chunkKeysInBox(px, py, radius).forEach(key => {
      if (map.chunks[key]) return;
      const [x, y] = key.split(',').map(Number);
      const chunk = this.chunkAt(map, x, y, context);
      if (chunk) built.push(chunk);
    });
    return built;
  }
}

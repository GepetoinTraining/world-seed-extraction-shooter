import { IMap, IChunk, BiomeType, EntityType, ScanLevel } from './types';
import { GenreType } from './definitions';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { Director } from './Director'; 
import { UniversalRank, Rarity } from '../../../types';

class SeededRNG {
  private seed: number;
  constructor(seed: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    this.seed = h >>> 0;
  }
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (this.next() * (max - min));
  }
  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }
}

export class WorldGenerator {
  
  static generate(seed: string, size: number = 32): IMap {
    const rng = new SeededRNG(seed);
    const chunks: Record<string, IChunk> = {};
    const extractionPoints: string[] = [];
    const center = Math.floor(size / 2);

    const currentMutations = Director.getEvolutionaryMutations(() => rng.next());

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const dx = x - center;
        const dy = y - center;
        const dist = Math.sqrt(dx*dx + dy*dy) / (size / 2);
        const noise = rng.next();
        
        // 80% chance to spawn a chunk, creating organic islands
        if (dist < 0.8 + (noise * 0.3)) {
          const chunk = this.createChunk(x, y, dist, noise, rng, currentMutations);
          chunks[`${x},${y}`] = chunk;
        }
      }
    }

    const chunkKeys = Object.keys(chunks);
    if (chunkKeys.length > 0) {
        // Place at least one extraction point
        const exitKey = rng.pick(chunkKeys);
        chunks[exitKey].hasExtraction = true;
        extractionPoints.push(exitKey);
    }

    return {
      seed,
      width: size,
      height: size,
      chunks,
      generatedAt: Date.now(),
      extractionPoints
    };
  }

  // --- HELPER: WEIGHTED RARITY ROLL ---
  private static rollRarity(rng: SeededRNG): { rank: UniversalRank, rarity: Rarity } {
      const roll = rng.next() * 100;
      if (roll < 45) return { rank: UniversalRank.F, rarity: Rarity.COMMON };
      if (roll < 65) return { rank: UniversalRank.E, rarity: Rarity.UNCOMMON };
      if (roll < 80) return { rank: UniversalRank.D, rarity: Rarity.RARE };
      if (roll < 90) return { rank: UniversalRank.C, rarity: Rarity.EPIC };
      if (roll < 95) return { rank: UniversalRank.B, rarity: Rarity.LEGENDARY };
      if (roll < 99) return { rank: UniversalRank.A, rarity: Rarity.LEGENDARY };
      return { rank: UniversalRank.S, rarity: Rarity.ARTIFACT };
  }

  private static createChunk(x: number, y: number, distFromCenter: number, noise: number, rng: SeededRNG, mutations: string[]): IChunk {
    // Biome Logic
    let biome = BiomeType.WASTELAND;
    if (distFromCenter < 0.3) biome = BiomeType.INDUSTRIAL;
    else if (distFromCenter < 0.6) biome = noise > 0.5 ? BiomeType.RUINS : BiomeType.OVERGROWTH;

    // Genre Logic (Flavor)
    let genre = GenreType.POST_APOC;
    if (noise > 0.8) genre = GenreType.ELDRITCH;
    else if (noise > 0.6) genre = GenreType.SCIFI;
    else if (noise < 0.2) genre = GenreType.FANTASY;

    const { rank, rarity } = this.rollRarity(rng);

    const chunk: IChunk = {
      id: `chk_${x}_${y}`,
      x, y,
      biome,
      difficulty: rank,
      rarity,
      entities: [],
      scanLevel: ScanLevel.UNKNOWN, 
      isTraversable: true,
      hasExtraction: false
    };

    // 1. GENERATE MOBS
    const mobCount = Math.floor(rng.range(1, 4));
    for(let i=0; i<mobCount; i++) {
        const genreMobs = Object.values(MOB_DEFINITIONS).filter(m => m.genre === genre);
        const rankIndex = Object.values(UniversalRank).indexOf(rank);
        
        // Filter mobs that fit the chunk rank
        let validMobs = genreMobs.filter(m => {
            const mobRankIndex = Object.values(UniversalRank).indexOf(m.rank);
            return mobRankIndex <= rankIndex; 
        });
        
        if (validMobs.length === 0) validMobs = genreMobs.filter(m => m.tags.includes('grunt'));

        if (validMobs.length > 0) {
            const template = rng.pick(validMobs);
            chunk.entities.push({
                id: crypto.randomUUID(),
                type: EntityType.MOB,
                definitionId: template.id,
                position: { x: (x * 100) + rng.range(10, 90), y: (y * 100) + rng.range(10, 90) }, 
                rank: template.rank,
                rarity: Rarity.COMMON, 
                isHostile: true,
                health: template.baseHealth,
            });
        }
    }

    // 2. GENERATE RESOURCES (Extractables)
    const resourceDensity = biome === BiomeType.OVERGROWTH ? 0.8 : (biome === BiomeType.WASTELAND ? 0.2 : 0.4);
    
    if (rng.next() < resourceDensity) {
        const count = Math.floor(rng.range(1, 6));
        for(let i=0; i<count; i++) {
            const typeRoll = rng.next();
            let defId = 'res_rock_small'; 

            if (biome === BiomeType.OVERGROWTH) {
                if (typeRoll < 0.4) defId = 'res_tree_log';
                else if (typeRoll < 0.7) defId = 'res_plant_fiber';
                else defId = 'res_berry_bush';
            } else if (biome === BiomeType.INDUSTRIAL) {
                if (typeRoll < 0.5) defId = 'res_scrap_metal';
                else defId = 'res_glass_shards';
            }

            chunk.entities.push({
                id: crypto.randomUUID(),
                type: EntityType.RESOURCE,
                definitionId: defId,
                position: { x: (x * 100) + rng.range(5, 95), y: (y * 100) + rng.range(5, 95) },
                rank: UniversalRank.F,
                rarity: Rarity.COMMON,
                isHostile: false
            });
        }
    }

    // 3. GENERATE RUINS (POI)
    if (rng.next() > 0.85) { 
        const ruinType = noise > 0.6 ? 'ruin_bunker' : 'ruin_shrine';
        const ruinX = (x * 100) + 50;
        const ruinY = (y * 100) + 50;
        
        // Structure
        chunk.entities.push({
            id: crypto.randomUUID(),
            type: EntityType.STRUCTURE,
            definitionId: ruinType,
            position: { x: ruinX, y: ruinY },
            rank: UniversalRank.D,
            rarity: Rarity.UNCOMMON
        });

        // Loot Container
        chunk.entities.push({
            id: crypto.randomUUID(),
            type: EntityType.CONTAINER,
            definitionId: 'cont_supply_crate',
            position: { x: ruinX + 2, y: ruinY + 2 },
            rank: UniversalRank.D,
            rarity: Rarity.UNCOMMON,
            lootTableId: 'loot_ruins_generic'
        });
    }

    return chunk;
  }
}
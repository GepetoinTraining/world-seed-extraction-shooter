import { IMap, IChunk, BiomeType, EntityType, ScanLevel } from './types';
import { GenreType } from './definitions';
import { Director } from './Director'; 
import { UniversalRank, Rarity } from '../../../types';

// New Interface for injected data
export interface IGenerationContext {
  mobDefinitions: any[];
  resourceDefinitions: any[];
}

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
  
  // NOW ACCEPTS CONTEXT
  static generate(seed: string, size: number, context: IGenerationContext): IMap {
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
        
        if (dist < 0.8 + (noise * 0.3)) {
          const chunk = this.createChunk(x, y, dist, noise, rng, currentMutations, context);
          chunks[`${x},${y}`] = chunk;
        }
      }
    }

    const chunkKeys = Object.keys(chunks);
    if (chunkKeys.length > 0) {
        const exitCount = Math.max(1, Math.floor(size / 10));
        for(let i=0; i<exitCount; i++) {
            const exitKey = rng.pick(chunkKeys);
            chunks[exitKey].hasExtraction = true;
            extractionPoints.push(exitKey);
        }
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

  private static createChunk(
    x: number, y: number, distFromCenter: number, noise: number, rng: SeededRNG, mutations: string[],
    context: IGenerationContext
  ): IChunk {
    let biome = BiomeType.WASTELAND;
    if (distFromCenter < 0.3) biome = BiomeType.INDUSTRIAL;
    else if (distFromCenter < 0.6) biome = noise > 0.5 ? BiomeType.RUINS : BiomeType.OVERGROWTH;

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

    // 1. GENERATE MOBS (Dynamic)
    const mobCount = Math.floor(rng.range(1, 4));
    for(let i=0; i<mobCount; i++) {
        const genreMobs = context.mobDefinitions.filter((m: any) => m.genre === genre);
        const rankIndex = Object.values(UniversalRank).indexOf(rank);
        
        let validMobs = genreMobs.filter((m: any) => {
            const mobRankIndex = Object.values(UniversalRank).indexOf(m.rank);
            return mobRankIndex <= rankIndex; 
        });
        
        if (validMobs.length === 0 && genreMobs.length > 0) validMobs = [genreMobs[0]]; 

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

    // 2. GENERATE RESOURCES (Dynamic)
    if (rng.next() < 0.5 && context.resourceDefinitions.length > 0) {
        const count = Math.floor(rng.range(1, 6));
        for(let i=0; i<count; i++) {
            const template = rng.pick(context.resourceDefinitions);
            if (template) {
                chunk.entities.push({
                    id: crypto.randomUUID(),
                    type: EntityType.RESOURCE,
                    definitionId: template.id,
                    position: { x: (x * 100) + rng.range(5, 95), y: (y * 100) + rng.range(5, 95) },
                    rank: UniversalRank.F,
                    rarity: Rarity.COMMON,
                    isHostile: false
                });
            }
        }
    }

    return chunk;
  }
}
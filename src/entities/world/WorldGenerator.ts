import { IMap, IChunk, BiomeType, EntityType, IWorldEntity, ScanLevel } from './types';
import { BIOME_DEFINITIONS, GenreType } from './definitions';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions'; 
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
        
        if (dist < 0.8 + (noise * 0.3)) {
          const chunk = this.createChunk(x, y, dist, noise, rng, currentMutations);
          chunks[`${x},${y}`] = chunk;
        }
      }
    }

    const chunkKeys = Object.keys(chunks);
    if (chunkKeys.length > 0) {
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
      
      // Distribution: 30/20/15/10/5/4/1 (+15 buffer into Common)
      // Normalized:
      // 0-45: F (Common)
      // 45-65: E (Uncommon)
      // 65-80: D (Rare)
      // 80-90: C (Epic)
      // 90-95: B (Legendary)
      // 95-99: A (Mythic)
      // 99-100: S (Artifact)

      if (roll < 45) return { rank: UniversalRank.F, rarity: Rarity.COMMON };
      if (roll < 65) return { rank: UniversalRank.E, rarity: Rarity.UNCOMMON };
      if (roll < 80) return { rank: UniversalRank.D, rarity: Rarity.RARE };
      if (roll < 90) return { rank: UniversalRank.C, rarity: Rarity.EPIC };
      if (roll < 95) return { rank: UniversalRank.B, rarity: Rarity.LEGENDARY };
      if (roll < 99) return { rank: UniversalRank.A, rarity: Rarity.LEGENDARY }; // Mythic visually Legendary
      return { rank: UniversalRank.S, rarity: Rarity.ARTIFACT };
  }

  private static createChunk(x: number, y: number, distFromCenter: number, noise: number, rng: SeededRNG, mutations: string[]): IChunk {
    let biome = BiomeType.WASTELAND;
    if (distFromCenter < 0.3) biome = BiomeType.INDUSTRIAL;
    else if (distFromCenter < 0.6) biome = noise > 0.5 ? BiomeType.RUINS : BiomeType.OVERGROWTH;

    let genre = GenreType.POST_APOC;
    if (noise > 0.8) genre = GenreType.ELDRITCH;
    else if (noise > 0.6) genre = GenreType.SCIFI;
    else if (noise < 0.2) genre = GenreType.FANTASY;

    // --- USE WEIGHTED ROLL ---
    const { rank, rarity } = this.rollRarity(rng);

    const chunk: IChunk = {
      id: `chk_${x}_${y}`,
      x, y,
      biome,
      difficulty: rank, // Chunk Difficulty matches the Rarity Tier
      rarity,
      entities: [],
      scanLevel: ScanLevel.UNKNOWN, 
      isTraversable: true,
      hasExtraction: false
    };

    // Populate Mobs
    const mobCount = Math.floor(rng.range(1, 4));
    for(let i=0; i<mobCount; i++) {
        const genreMobs = Object.values(MOB_DEFINITIONS).filter(m => m.genre === genre);
        
        // Filter mobs that fit the Chunk Rank
        // e.g. If Chunk is Rank S, we allow Bosses. If Rank F, only Grunts.
        // We filter "Up to" the rank.
        const rankIndex = Object.values(UniversalRank).indexOf(rank);
        
        let validMobs = genreMobs.filter(m => {
            const mobRankIndex = Object.values(UniversalRank).indexOf(m.rank);
            return mobRankIndex <= rankIndex; // Allow weaker mobs too
        });
        
        // If no mobs match (e.g. we have no S-Rank mobs yet), fallback to grunts
        if (validMobs.length === 0) validMobs = genreMobs.filter(m => m.tags.includes('grunt'));

        if (validMobs.length > 0) {
            const template = rng.pick(validMobs);
            
            const globalX = (x * 100) + rng.range(10, 90);
            const globalY = (y * 100) + rng.range(10, 90);

            // Report Spawn
            Director.reportSpawn(mutations as any); // Cast for type safety if needed

            chunk.entities.push({
                id: crypto.randomUUID(),
                type: EntityType.MOB,
                definitionId: template.id,
                position: { x: globalX, y: globalY }, 
                rank: template.rank,
                rarity: Rarity.COMMON, 
                isHostile: true,
                health: template.baseHealth,
                // mutations: mutations // (Implicitly handled by Director tracking for now)
            });
        }
    }

    return chunk;
  }
}
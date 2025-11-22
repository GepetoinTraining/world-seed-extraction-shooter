import { IMap, IChunk, BiomeType, EntityType, IWorldEntity, ScanLevel } from './types';
import { BIOME_DEFINITIONS, GenreType } from './definitions';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions'; // Import the new Mob Manual
import { UniversalRank, Rarity } from '../../../types';

// ... SeededRNG Class (Same as before) ...
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

    // 1. Generate Map Chunks
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const dx = x - center;
        const dy = y - center;
        const dist = Math.sqrt(dx*dx + dy*dy) / (size / 2);
        const noise = rng.next();
        
        if (dist < 0.8 + (noise * 0.3)) {
          const chunk = this.createChunk(x, y, dist, noise, rng);
          chunks[`${x},${y}`] = chunk;
        }
      }
    }

    // 2. Extraction Logic (Simplified for brevity, ensure at least one exists)
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

  private static createChunk(x: number, y: number, distFromCenter: number, noise: number, rng: SeededRNG): IChunk {
    // Biome & Genre Logic
    let biome = BiomeType.WASTELAND;
    if (distFromCenter < 0.3) biome = BiomeType.INDUSTRIAL;
    else if (distFromCenter < 0.6) biome = noise > 0.5 ? BiomeType.RUINS : BiomeType.OVERGROWTH;

    let genre = GenreType.POST_APOC;
    if (noise > 0.8) genre = GenreType.ELDRITCH;
    else if (noise > 0.6) genre = GenreType.SCIFI;
    else if (noise < 0.2) genre = GenreType.FANTASY;

    // Rarity
    let rarity = Rarity.COMMON;
    if (rng.next() > 0.9) rarity = Rarity.RARE;
    if (rng.next() > 0.98) rarity = Rarity.EPIC;

    const chunk: IChunk = {
      id: `chk_${x}_${y}`,
      x, y,
      biome,
      difficulty: UniversalRank.E,
      rarity,
      entities: [],
      scanLevel: ScanLevel.UNKNOWN, 
      isTraversable: true,
      hasExtraction: false
    };

    
    // Populate Mobs based on Genre
    const mobCount = Math.floor(rng.range(1, 4));
    for(let i=0; i<mobCount; i++) {
        // Filter MOB_DEFINITIONS by current Genre
        // In optimized code, we'd pre-index these. Here we filter on fly.
        const genreMobs = Object.values(MOB_DEFINITIONS).filter(m => m.genre === genre);
        
        // Filter by Rarity/Difficulty? 
        // Simple logic: Common chunk = Grunts. Epic chunk = Elites.
        let validMobs = genreMobs.filter(m => m.tags.includes('grunt'));
        
        if (rarity === Rarity.RARE && rng.next() > 0.5) {
            validMobs = genreMobs.filter(m => m.tags.includes('elite'));
        }
        
        // SUPER RARE BOSS SPAWN
        if (rarity === Rarity.EPIC && rng.next() > 0.95) {
             validMobs = genreMobs.filter(m => m.tags.includes('boss'));
        }

        // ... Mob generation loop ...
        if (validMobs.length > 0) {
            const template = rng.pick(validMobs);
            
            // FIXED: Coordinates are now Global (Chunk X * 100 + Offset)
            // Assuming 1 Chunk = 100 World Units (matched with TACTICAL_SCALE in Canvas)
            const globalX = (x * 100) + rng.range(10, 90);
            const globalY = (y * 100) + rng.range(10, 90);

            chunk.entities.push({
                id: crypto.randomUUID(),
                type: EntityType.MOB,
                definitionId: template.id,
                position: { x: globalX, y: globalY }, // <-- GLOBAL COORDS
                rank: template.rank,
                rarity: Rarity.COMMON, 
                isHostile: true,
                health: template.baseHealth 
            });
        }

        }
    

    return chunk;
  }
}
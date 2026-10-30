import { IMap, IChunk, BiomeType, EntityType, ScanLevel } from './types';
import { GenreType } from './definitions';
import { Director } from './Director';
import { UniversalRank, Rarity } from '../../../types';
// Wave 1.3: shared deterministic RNG (same algorithm as before — goldens safe)
import { SeededRNG } from '../../logic/rng/DeterministicRNG';
import { BIOME_RESOURCES } from '../item/data/resourceDefinitions';

// New Interface for injected data
export interface IGenerationContext {
  mobDefinitions: any[];
  resourceDefinitions: any[];
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
            if (chunks[exitKey].hasExtraction) continue; // don't double-mark
            chunks[exitKey].hasExtraction = true;
            extractionPoints.push(exitKey);

            // Wave 2.5: the beacon is a visible, physical thing in the world
            const [bx, by] = exitKey.split(',').map(Number);
            chunks[exitKey].entities.push({
                id: `ent_${bx}_${by}_beacon`,
                type: EntityType.EXTRACTION,
                definitionId: 'extraction_beacon',
                position: { x: bx * 100 + 50, y: by * 100 + 50 },
                rank: UniversalRank.F,
                rarity: Rarity.COMMON,
                isHostile: false
            });
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
    // ~40% of chunks host 1-2 mobs; keeps aggro manageable at 100px chunk scale
    const mobCount = rng.next() < 0.4 ? Math.floor(rng.range(1, 3)) : 0;
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
                // Deterministic id: same seed -> same entities (test line 20)
                id: `ent_${x}_${y}_m${i}`,
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

    // 2. GENERATE RESOURCES (Wave 2.2: biome spawn tables, depleting uses)
    if (rng.next() < 0.5 && context.resourceDefinitions.length > 0) {
        const biomePool = context.resourceDefinitions.filter((r: any) =>
            !BIOME_RESOURCES[biome] || BIOME_RESOURCES[biome].includes(r.id)
        );
        const pool = biomePool.length > 0 ? biomePool : context.resourceDefinitions;
        const count = Math.floor(rng.range(1, 5));
        for(let i=0; i<count; i++) {
            const template: any = rng.pick(pool);
            if (template) {
                chunk.entities.push({
                    id: `ent_${x}_${y}_r${i}`,
                    type: EntityType.RESOURCE,
                    definitionId: template.id,
                    position: { x: (x * 100) + rng.range(5, 95), y: (y * 100) + rng.range(5, 95) },
                    rank: template.rank || UniversalRank.F,
                    rarity: Rarity.COMMON,
                    isHostile: false,
                    usesRemaining: template.uses ?? 1
                });
            }
        }
    }

    // 3. RUINS & STRUCTURES (Wave 2.3): a container chest + a garrison
    if (rng.next() < 0.08) {
        const sx = (x * 100) + rng.range(25, 75);
        const sy = (y * 100) + rng.range(25, 75);

        chunk.entities.push({
            id: `ent_${x}_${y}_struct`,
            type: EntityType.STRUCTURE,
            definitionId: 'struct_ruin',
            position: { x: sx, y: sy },
            rank, rarity,
            isHostile: false
        });

        // The chest inside — loot rank = chunk difficulty, always carries lore
        chunk.entities.push({
            id: `ent_${x}_${y}_chest`,
            type: EntityType.CONTAINER,
            definitionId: 'chest_ruin',
            position: { x: sx + rng.range(-15, 15), y: sy + rng.range(-15, 15) },
            rank, rarity,
            isHostile: false,
            container: { lootRank: rank, looted: false, hasLore: true }
        });

        // The garrison: two extra mobs guarding it
        const genreMobs = context.mobDefinitions.filter((m: any) => m.genre === genre);
        for (let g = 0; g < 2 && genreMobs.length > 0; g++) {
            const guard: any = rng.pick(genreMobs);
            chunk.entities.push({
                id: `ent_${x}_${y}_guard${g}`,
                type: EntityType.MOB,
                definitionId: guard.id,
                position: { x: sx + rng.range(-30, 30), y: sy + rng.range(-30, 30) },
                rank: guard.rank,
                rarity: Rarity.COMMON,
                isHostile: true,
                health: guard.baseHealth
            });
        }
    }

    // 4. NPC ENTITIES (Wave 2.4): a rolled sheet, extractable socially
    if (rng.next() < 0.05) {
        const firstNames = ['Kael', 'Vector', 'Sera', 'Io', 'Null', 'Cassin', 'Orrin', 'Vesta'];
        const surnames = ['Steelweave', 'Basalt', 'Error', 'Null', 'Gantry', 'Mireforge', 'Siltvane'];
        const temperaments = ['AGGRESSIVE', 'COWARD', 'TERRITORIAL', 'PASSIVE', 'OPPORTUNIST'] as const;
        const objectives = ['SURVIVE', 'HOARD', 'WITNESS', 'PROTECT_ASSET'] as const;
        const wants = ['GOLD', 'GIFT', 'RESPECT'] as const;

        const temperament = rng.pick([...temperaments]);
        chunk.entities.push({
            id: `ent_${x}_${y}_npc`,
            type: EntityType.NPC,
            definitionId: 'npc_survivor',
            position: { x: (x * 100) + rng.range(20, 80), y: (y * 100) + rng.range(20, 80) },
            rank, rarity,
            isHostile: false,
            npc: {
                name: `${rng.pick([...firstNames])} ${rng.pick([...surnames])}`,
                temperament,
                objective: rng.pick([...objectives]),
                want: rng.pick([...wants]),
                // Passive folk start warmer; aggressive ones colder
                disposition: temperament === 'PASSIVE' ? 50 : temperament === 'AGGRESSIVE' ? 10 : 30,
                attempts: 0
            }
        });
    }

    return chunk;
  }
}
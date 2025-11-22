import { BiomeType, EntityType } from './types';
import { UniversalRank } from '../../../types';

// --- NEW: GENRE SYSTEM ---
export enum GenreType {
  FANTASY = 'FANTASY',       // Swords, Magic
  SCIFI = 'SCIFI',           // Lasers, Mechs
  POST_APOC = 'POST_APOC',   // Scrap, Ballistics
  ELDRITCH = 'ELDRITCH',     // Tentacles, Void
  RETRO = 'RETRO'            // Pixel art, Chiptune vibes
}

export const GENRE_DEFINITIONS = {
  [GenreType.FANTASY]: { description: "Mana-rich atmosphere.", lootTags: ['magic', 'blade'] },
  [GenreType.SCIFI]: { description: "High-tech interference.", lootTags: ['tech', 'energy'] },
  [GenreType.POST_APOC]: { description: "Radiation warning.", lootTags: ['physical', 'scrap'] },
  [GenreType.ELDRITCH]: { description: "Sanity draining.", lootTags: ['void', 'chaos'] },
  [GenreType.RETRO]: { description: "8-bit resonance.", lootTags: ['glitch', 'data'] }
};

export const BIOME_DEFINITIONS = {
  [BiomeType.WASTELAND]: {
    color: '#a8a29e', 
    mobDensity: 0.3,
    resourceDensity: 0.2,
    // We now define generic slots that the Generator fills based on Genre
    spawnSlots: ['mob_grunt', 'mob_scout'], 
    resourceSlots: ['res_common', 'res_uncommon']
  },
  [BiomeType.OVERGROWTH]: {
    color: '#059669', 
    mobDensity: 0.5,
    resourceDensity: 0.6,
    spawnSlots: ['mob_beast', 'mob_plant'],
    resourceSlots: ['res_organic', 'res_wood']
  },
  // ... (Other biomes follow pattern) ...
};

// --- THE "EVERYTHING" ENTITY LIST ---
// We define entities by Function + Genre.
// The Generator will pick: "I need a FANTASY GRUNT" -> "Goblin"
export const ENTITY_DEFINITIONS: Record<string, any> = {
  // --- FANTASY ---
  'mob_fantasy_grunt': { name: 'Goblin Scavenger', type: EntityType.MOB, baseRank: UniversalRank.F, genre: GenreType.FANTASY, tags: ['grunt'] },
  'mob_fantasy_elite': { name: 'Orc Warlord', type: EntityType.MOB, baseRank: UniversalRank.C, genre: GenreType.FANTASY, tags: ['elite'] },
  'boss_fantasy_tower': { name: 'Lich of the Spire', type: EntityType.MOB, baseRank: UniversalRank.S, genre: GenreType.FANTASY, tags: ['boss'] },

  // --- SCI-FI ---
  'mob_scifi_grunt': { name: 'Security Drone', type: EntityType.MOB, baseRank: UniversalRank.F, genre: GenreType.SCIFI, tags: ['grunt'] },
  'mob_scifi_elite': { name: 'Exo-Suit Trooper', type: EntityType.MOB, baseRank: UniversalRank.C, genre: GenreType.SCIFI, tags: ['elite'] },
  'boss_scifi_core': { name: 'Rogue AI Core', type: EntityType.MOB, baseRank: UniversalRank.S, genre: GenreType.SCIFI, tags: ['boss'] },

  // --- EXTRACTION ---
  'str_extraction_beacon': { name: 'Extraction Beacon', type: EntityType.EXTRACTION, baseRank: UniversalRank.S, tags: ['utility'] }
};
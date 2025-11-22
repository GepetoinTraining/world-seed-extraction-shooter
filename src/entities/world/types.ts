import { UniversalRank, Rarity } from '../../../types';

export enum BiomeType {
  WASTELAND = 'WASTELAND',
  OVERGROWTH = 'OVERGROWTH',
  RUINS = 'RUINS',
  INDUSTRIAL = 'INDUSTRIAL',
  CYBER_CITY = 'CYBER_CITY'
}

export enum EntityType {
  MOB = 'MOB',
  NPC = 'NPC',
  RESOURCE = 'RESOURCE',
  STRUCTURE = 'STRUCTURE',
  EXTRACTION = 'EXTRACTION'
}

// NEW: The Intel Levels
export enum ScanLevel {
  UNKNOWN = 0,    // Black Void
  BASIC = 1,      // Color/Biome known, Difficulty Estimate
  DETAILED = 2,   // Entity Counts ("3 Mobs", "1 Chest")
  COMPLETE = 3    // Full JSON Access ("Cyber-Demon dropping S-Rank Sword")
}

export interface IWorldEntity {
  id: string;
  type: EntityType;
  definitionId: string; 
  position: { x: number; y: number }; 
  rank: UniversalRank;
  rarity: Rarity;
  health?: number;
  isHostile?: boolean;
  lootTableId?: string;
}

export interface IChunk {
  id: string;
  x: number; 
  y: number; 
  biome: BiomeType;
  difficulty: UniversalRank; 
  rarity: Rarity; 
  
  entities: IWorldEntity[]; // The "Truth" (Server Side)
  
  // --- CLIENT STATE ---
  scanLevel: ScanLevel; // How much of the truth is visible?
  
  isTraversable: boolean;
  hasExtraction: boolean;
}

export interface IMap {
  seed: string;
  width: number; 
  height: number; 
  chunks: Record<string, IChunk>; 
  
  generatedAt: number;
  extractionPoints: string[]; 
}
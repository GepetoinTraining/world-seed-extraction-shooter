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
  EXTRACTION = 'EXTRACTION',
  CONTAINER = 'CONTAINER', // <-- FIXED: Added this missing type
  CART = 'CART' // Wave 10C (D16): a towed world entity that outlives your death
}

// Wave 10C (D16): the theft is a signed fact — who towed it away, when, under
// whose signature. The owner's claim is never erased; that is the point.
export interface ICartTheft {
  by: string;        // the thief's certificate uid
  byName: string;
  at: number;        // epoch ms
  signature?: string; // the thief's own signature over the act (the bank honors even this)
}

/**
 * Wave 10C (D16): a cart — its own grid, bigger than any pack. It stays in the
 * world across your death or an extraction without it; anyone may tow it away.
 */
export interface ICartState {
  cartItemId: string;                  // the packed-kit item this cart unfolds from
  ownerId: string;
  ownerName: string;
  sealSignature?: string;              // the owner's seal over the deploy record
  gridW: number;
  gridH: number;
  items: import('../../../types').IItem[];
  layout: Record<string, import('../../../types').IGridPlacement>;
  towedBy?: string;                    // certificate uid of whoever holds the tow bar
  theftLog: ICartTheft[];
}

// NEW: The Intel Levels
export enum ScanLevel {
  UNKNOWN = 0,    // Black Void
  BASIC = 1,      // Color/Biome known, Difficulty Estimate
  DETAILED = 2,   // Entity Counts ("3 Mobs", "1 Chest")
  COMPLETE = 3    // Full JSON Access ("Cyber-Demon dropping S-Rank Sword")
}

// Wave 2.4: a rolled NPC sheet. Dialogue is menu-driven; the sheet is data.
export interface INpcSheet {
  name: string;
  temperament: 'AGGRESSIVE' | 'COWARD' | 'TERRITORIAL' | 'PASSIVE' | 'OPPORTUNIST';
  objective: 'SURVIVE' | 'HOARD' | 'WITNESS' | 'PROTECT_ASSET';
  want: 'GOLD' | 'GIFT' | 'RESPECT';      // what moves their disposition
  disposition: number;                     // 0-100; >= 70 unlocks RECRUIT
  attempts: number;                        // social rolls made (keys the RNG)
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

  // Wave 2.2: extractable nodes
  usesRemaining?: number;   // veins deplete; flora has 1 use
  regrowAt?: number;        // flora only: when the node comes back (epoch ms)

  // Wave 2.3: containers (chests in ruins)
  // Wave 3.3: `items` = explicit contents (ground caches, overflow); when set,
  // opening gives exactly these instead of generated loot. `cacheOwner` keeps
  // ownership separate from containment (primordial owner-forest rule):
  // a cache on the ground is still YOURS.
  container?: {
    lootRank: UniversalRank;
    looted: boolean;
    hasLore: boolean;
    items?: import('../../../types').IItem[];
    cacheOwner?: string;
  };

  // Wave 2.4: social extraction
  npc?: INpcSheet;

  // Wave 10C (D16): the cart's whole state rides on its entity
  cart?: ICartState;
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

/** What you scan and drop into: 8 by 8 chunks. */
export interface ISector {
  id: string;
  x: number;
  y: number;
  biome: BiomeType; // the most common in it
  difficulty: UniversalRank; // the highest in it
  rarity: Rarity;
  entities: IWorldEntity[]; // revealed by a deep scan
  scanLevel: ScanLevel;
  hasExtraction: boolean;
}

export interface IMap {
  seed: string;
  width: number; // in sectors
  height: number; // in sectors
  gridVersion: number;
  sectors: Record<string, ISector>;
  chunks: Record<string, IChunk>; // only the ones built so far

  generatedAt: number;
}

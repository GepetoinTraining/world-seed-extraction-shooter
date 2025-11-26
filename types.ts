/**
 * --------------------------------------------------------------------------
 * PROJECT: WORLD SEED (THE UNIVERSAL CONTRACT)
 * ARCHITECT: [System]
 * VERSION: 1.1.0 (Integration Phase)
 * --------------------------------------------------------------------------
 * PHILOSOPHY:
 * 1. VALUE is a function of TIME + RISK.
 * 2. POWER is Universal (F-SSS).
 * 3. LOGIC is Strict (Types define reality).
 */

// ==========================================================================
// 1. THE UNIVERSAL LANGUAGE OF POWER (F-SSS)
// ==========================================================================

export enum UniversalRank {
  F   = 'F',     // Trash / Broken (IP: 0-100)
  E   = 'E',     // Common / Civil (IP: 101-300)
  D   = 'D',     // Uncommon / Militia (IP: 301-500)
  C   = 'C',     // Rare / Professional (IP: 501-700)
  B   = 'B',     // Epic / Elite (IP: 701-900)
  A   = 'A',     // Legendary / Heroic (IP: 901-1100)
  S   = 'S',     // Mythic / Demigod (IP: 1101-1300)
  SS  = 'SS',    // Transcendent / World-Alter (IP: 1301-1500)
  SSS = 'SSS'    // Singularity / Admin-Tier (IP: 1500+)
}

export enum Rarity {
  SCRAP = 'SCRAP',         // Grey
  COMMON = 'COMMON',       // White
  UNCOMMON = 'UNCOMMON',   // Green
  RARE = 'RARE',           // Blue
  EPIC = 'EPIC',           // Purple
  LEGENDARY = 'LEGENDARY', // Orange
  ARTIFACT = 'ARTIFACT'    // Red (Unique History)
}

export enum GenreType {
  FANTASY = 'FANTASY',       // Swords, Magic
  SCIFI = 'SCIFI',           // Lasers, Mechs
  POST_APOC = 'POST_APOC',   // Scrap, Ballistics
  ELDRITCH = 'ELDRITCH',     // Tentacles, Void
  RETRO = 'RETRO'            // Pixel art, Chiptune vibes
}

// ==========================================================================
// 2. THE ECONOMY & ITEM TYPES
// ==========================================================================

export enum ItemType {
  GEAR = 'GEAR',             // Swords, Guns, Helmets
  CRAFTING_ORB = 'CRAFTING', // "Chaos Orb", "Nanite Canister"
  CONSUMABLE = 'CONSUMABLE', // Potions, Food
  RESOURCE = 'RESOURCE',     // Raw Iron, Plasteel
  COSMETIC = 'COSMETIC',     // Skins (No Stats)
  DEED = 'DEED'              // <-- ADDED: Land Ownership Documents
}

export enum SlotType {
  HEAD = 'HEAD',
  CHEST = 'CHEST',
  MAIN_HAND = 'MAIN_HAND',
  OFF_HAND = 'OFF_HAND',
  LEGS = 'LEGS',
  FEET = 'FEET',
  ACCESSORY = 'ACCESSORY',
  BAG = 'BAG',
  NONE = 'NONE'              // <-- ADDED: For resources/consumables
}

// ==========================================================================
// 3. THE ITEM CONTRACT
// ==========================================================================

export interface IAffix {
  id: string;
  name: string; // e.g. "Sharp", "of the Bear"
  type: 'PREFIX' | 'SUFFIX';
  stats: Record<string, number>;
  tier: number;
}

export interface IItem {
  /** Unique UUID. The "Soul" of the item. */
  id: string;
  
  /** The Universal ID (e.g., "weapon_sword_starter") for rendering logic. */
  universalDefinitionId: string;

  /** Display Name */
  name: string;
  
  /** Generated flavor text */
  description: string;

  type: ItemType;
  slot: SlotType;
  rank: UniversalRank;
  rarity: Rarity;

  /** Quality roll (-0.20 to +0.20). Affects stats. */
  quality: number;
  
  /** Required Level to use */
  level: number; 

  /** Gold Value (for Shops/Economy) */
  value: number;

  /** Calculated "Weight" for PvP matchmaking */
  itemPower: number;

  /** Rolled modifiers */
  affixes: IAffix[];

  /** Gameplay stats (Damage, Defense, Weight, etc) */
  stats: {
    damage?: number;
    defense?: number;
    attackSpeed?: number;
    durability?: number;
    maxDurability?: number;
    weight?: number; 
    [key: string]: any; 
  };

  /** Visual rendering instructions */
  visuals: {
    modelId: string; // e.g., 'sword_low_poly_01'
    colorHex: string;
    particleEffect?: string;
    iconUrl?: string; // Kept for legacy compatibility
  };
  
  /** Helper for UI to grab icon quickly without digging into visuals */
  icon: string; 

  /** Provenance/History */
  history: {
    craftedByPlayerId?: string;
    foundInLayerId?: string;
    dropDate: number;
    killCount: number;
  };

  // --- STATE FLAGS ---
  isIdentified: boolean; 

  // --- SPECIFIC DATA BLOCKS (Optional) ---
  
  /** Populated ONLY if type === 'DEED' */
  deedData?: {
    originBiome: string;
    originLayer: string;
    coordinateHash: string;
    rank: UniversalRank;
    allowedStructures: ('HOUSE' | 'WORKSHOP' | 'VENDOR')[];
  };
}

// ==========================================================================
// 4. THE WORLD (SEED & LAYERS)
// ==========================================================================

export enum LayerTheme {
  PRIME_MATERIAL = 'PRIME_MATERIAL', 
  HIGH_FANTASY = 'HIGH_FANTASY',    
  HARD_SCIFI = 'HARD_SCIFI',        
  CYBERPUNK = 'CYBERPUNK',          
  THE_VOID = 'THE_VOID'             
}

export interface IWorldSeed {
  seedId: string;
  generationTimestamp: number;
  topologyHash: string; 
  poiMap: Map<string, { 
    id: string; 
    x: number; 
    y: number; 
    type: 'STRONGHOLD' | 'CITY' | 'DUNGEON';
    controllingGuildId?: string; 
  }>;
}

export interface ILayer {
  id: string;
  name: string;
  theme: LayerTheme;
  isPersistent: boolean; 
  pvpMode: 'DISABLED' | 'OPEN' | 'SCALED';
  itemRankCap?: UniversalRank; 
}

// ==========================================================================
// 5. SOCIETY & GOVERNANCE
// ==========================================================================

export enum StructureType {
  RESIDENCE = 'RESIDENCE',    
  HARVESTER = 'HARVESTER',    
  VENDOR = 'VENDOR',          
  MUNICIPAL = 'MUNICIPAL',    
  GUILD_HALL = 'GUILD_HALL'   
}

export interface IWorldStructure {
  id: string;
  layerId: string;
  ownerId: string;
  cityId?: string;
  type: StructureType;
  position: { x: number; y: number; z: number };
  rotation: number;
  persistentState: Record<string, any>;
  inventory: IItem[]; 
  taxPaidUntil: number;
  upkeepCostPerDay: number;
}

export interface IPlayerCity {
  id: string;
  layerId: string;
  name: string;
  mayorPlayerId: string;
  radius: number; 
  center: { x: number; y: number; z: number };
  citizenIds: string[];
  taxRate: number; 
  treasury: number; 
  upkeepCostPerWeek: number;
}

// ==========================================================================
// 6. PLAYER, PERSISTENCE & LORE
// ==========================================================================

export interface ILoreEntry {
  topic: string; 
  xp: number;
  level: number;
  dateDiscovered: number;
}

export interface IBank {
  accountId: string;
  gold: number; 
  
  stashTabs: {
    name: string;
    items: IItem[];
  }[];

  universalSkills: Record<string, number>;
  
  // Persistent Knowledge Base
  lore: Record<string, ILoreEntry>;
}

export interface IActiveSession {
  sessionId: string;
  layerId: string;
  inventory: IItem[];
  health: number;
  maxHealth: number;
  energy: number;
  position: { x: number; y: number; z: number };
  statusEffects: string[];
}

export interface IPlayer {
  id: string;
  username: string;
  bank: IBank;           // The "Soul"
  currentSession?: IActiveSession; // The "Body"
  guildId?: string;
  ownedCityId?: string;
}
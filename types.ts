/**
 * --------------------------------------------------------------------------
 * PROJECT: WORLD SEED (THE UNIVERSAL CONTRACT)
 * ARCHITECT: [System]
 * VERSION: 1.0.0 (Genesis)
 * --------------------------------------------------------------------------
 * * PHILOSOPHY (THE ALPHA):
 * This SDK does not just define data; it defines "Meaning."
 * * 1. VALUE is a function of TIME + RISK.
 * 2. POWER is Universal (F-SSS); FORM is Local (Layer-Dependent).
 * 3. SOCIETY is built on INTERDEPENDENCE (Crafter needs Fighter needs Mayor).
 * * This contract enables a "Silicon-Based Intelligence" to learn:
 * - Survival (Session/Hot State)
 * - Persistence (Bank/Cold State)
 * - Society (Cities/Taxes)
 */

// ==========================================================================
// 1. THE UNIVERSAL LANGUAGE OF POWER (F-SSS)
// ==========================================================================

/**
 * The Universal Rank System.
 * This allows a "Sci-Fi" Rifle to be mathematically balanced against a "Fantasy" Sword.
 * Used for "Item Power" (IP) scaling in PvP.
 */
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

// ==========================================================================
// 2. THE ECONOMY (DUAL-CURRENCY MODEL)
// ==========================================================================

/**
 * The type of item determines its economic function.
 * - GEAR: Permanent power (The goal).
 * - CRAFTING: Consumable currency (The sink).
 */
export enum ItemType {
  GEAR = 'GEAR',             // Swords, Guns, Helmets
  CRAFTING_ORB = 'CRAFTING', // "Chaos Orb", "Nanite Canister" (Consumed on use)
  CONSUMABLE = 'CONSUMABLE', // Potions, Food
  RESOURCE = 'RESOURCE',     // Raw Iron, Plasteel
  COSMETIC = 'COSMETIC'      // Skins (No Stats)
}

export enum SlotType {
  HEAD = 'HEAD',
  CHEST = 'CHEST',
  MAIN_HAND = 'MAIN_HAND',
  OFF_HAND = 'OFF_HAND',
  LEGS = 'LEGS',
  FEET = 'FEET',
  ACCESSORY = 'ACCESSORY',
  BAG = 'BAG' // For inventory expansion
}

// ==========================================================================
// 3. THE ITEM CONTRACT (THE VECTORIZED OBJECT)
// ==========================================================================

export interface IAffix {
  id: string;
  name: string; // e.g. "Sharp", "of the Bear"
  type: 'PREFIX' | 'SUFFIX';
  /** The raw stats added by this affix */
  stats: Record<string, number>;
  /** The tier (1-10) rolled for this affix based on Item Rank */
  tier: number;
}

export interface IItem {
  /** Unique UUID. The "Soul" of the item. */
  id: string;
  
  /** * The Universal ID (e.g., "weapon_sword_starter"). 
   * The Layer uses this to decide *how* to render it.
   */
  universalDefinitionId: string;

  /** Layer-specific name (e.g., "Iron Sword" vs "Plasma Baton") */
  name: string;
  
  /** Generated flavor text to give the item "history" */
  description: string;

  type: ItemType;
  slot: SlotType;
  rank: UniversalRank;
  rarity: Rarity;

  /** 
   * The Quality roll (-0.20 to +0.20).
   * Affects base IP and stats.
   */
  quality: number;

  /**
   * The calculated "Weight" of the item. 
   * Used for PvP matchmaking brackets.
   */
  itemPower: number;

  /**
   * Rolled modifiers.
   */
  affixes: IAffix[];

  /**
   * Key-Value store for gameplay stats.
   * Interpreted differently by Layer logic (Physics vs Magic).
   */
  stats: {
    damage?: number;
    defense?: number;
    attackSpeed?: number;
    durability: number;
    maxDurability: number;
    weight: number; // Affects carry capacity
    [key: string]: any; // Allow Layer-specific extensions
  };

  /**
   * VISUALS (The "NerveGear" Renderer Instruction)
   * The Client reads the 'layerId' it is currently in, and requests
   * the asset defined here.
   */
  visuals: {
    modelId: string; // e.g., 'sword_low_poly_01'
    colorHex: string;
    particleEffect?: string;
    iconUrl?: string;
  };

  /**
   * PROVENANCE (The "Why")
   * Tracks the life of the item to give it sentimental value.
   */
  history: {
    craftedByPlayerId?: string;
    foundInLayerId?: string;
    dropDate: number;
    killCount: number;
  };
}

// ==========================================================================
// 4. THE WORLD (SEED & LAYERS)
// ==========================================================================

export enum LayerTheme {
  PRIME_MATERIAL = 'PRIME_MATERIAL', // Balanced, Earth-like (Gathering)
  HIGH_FANTASY = 'HIGH_FANTASY',     // Magic-dense (PvE/Raids)
  HARD_SCIFI = 'HARD_SCIFI',         // Tech-dense (PvP/Extraction)
  CYBERPUNK = 'CYBERPUNK',           // Social/Economic Hubs
  THE_VOID = 'THE_VOID'              // High-risk, Permadeath only
}

/**
 * The Immutable "Truth" of the planet.
 * Shared by ALL Layers.
 */
export interface IWorldSeed {
  seedId: string;
  generationTimestamp: number;
  
  /** The raw topology (Heightmap/Biomes) */
  topologyHash: string; 

  /** * Points of Interest that exist in ALL realities.
   * Example: At {x:500, y:500}, there is ALWAYS a "Stronghold".
   * - Fantasy Layer: Renders a Castle.
   * - Sci-Fi Layer: Renders a Bunker.
   */
  poiMap: Map<string, { 
    id: string; 
    x: number; 
    y: number; 
    type: 'STRONGHOLD' | 'CITY' | 'DUNGEON';
    controllingGuildId?: string; // Cross-Layer Territory Control
  }>;
}

export interface ILayer {
  id: string;
  name: string;
  theme: LayerTheme;
  
  /** * PlanetSide Model vs RotMG Model 
   * true = Always Online, Territory Control
   * false = Spun up on demand, Instanced
   */
  isPersistent: boolean; 
  
  /** * PvP Rules
   * 'SCALED' means IP Caps are enforced (Fair fights).
   */
  pvpMode: 'DISABLED' | 'OPEN' | 'SCALED';
  itemRankCap?: UniversalRank; 
}

// ==========================================================================
// 5. SOCIETY & GOVERNANCE (THE SWG MODEL)
// ==========================================================================

export enum StructureType {
  RESIDENCE = 'RESIDENCE',     // Private housing
  HARVESTER = 'HARVESTER',     // Passive resource generation (The Economy)
  VENDOR = 'VENDOR',           // Player shops
  MUNICIPAL = 'MUNICIPAL',     // City walls, Turrets
  GUILD_HALL = 'GUILD_HALL'    // Social hub
}

/**
 * A persistent object placed on a specific Layer.
 * Requires "Upkeep" (Gold Sink) to remain.
 */
export interface IWorldStructure {
  id: string;
  layerId: string;
  ownerId: string;
  cityId?: string; // Belongs to a player city?
  
  type: StructureType;
  position: { x: number; y: number; z: number };
  rotation: number;
  
  /** State specific to the structure type (e.g., Harvester efficiency) */
  persistentState: Record<string, any>;
  
  inventory: IItem[]; // Stored items
  
  /** * THE GOLD SINK
   * Unix timestamp. If current > paidUntil, structure enters "Decay".
   */
  taxPaidUntil: number;
  upkeepCostPerDay: number;
}

/**
 * The "Grand MMORPG" Political Unit.
 * Allows players to govern territory.
 */
export interface IPlayerCity {
  id: string;
  layerId: string;
  name: string;
  mayorPlayerId: string;
  
  /** The territory radius controlled by this city */
  radius: number; 
  center: { x: number; y: number; z: number };
  
  citizenIds: string[];
  
  /** * THE GOVERNANCE MODEL 
   * Tax Rate: % of Gold looted by players within radius that goes to Treasury.
   */
  taxRate: number; 
  treasury: number; // Stored Gold
  
  /** If Treasury < Upkeep, City dissolves. */
  upkeepCostPerWeek: number;
}

// ==========================================================================
// 6. PLAYER & PERSISTENCE (HOT VS COLD STATE)
// ==========================================================================

/**
 * The "Cold" State (Database).
 * This data is safe. It represents the User's "Soul".
 */
export interface IBank {
  accountId: string;
  
  /** The Sovereign Currency (Platform-Managed) */
  gold: number; 
  
  /** The "PoE" Stash (Crafting Orbs + Gear) */
  stashTabs: {
    name: string;
    items: IItem[];
  }[];

  /** * Universal Skill Progression.
   * Allows "Transfer of Skill" (SAO).
   * e.g., { "swordsmanship": 50, "marksmanship": 20 }
   */
  universalSkills: Record<string, number>;
}

/**
 * The "Hot" State (In-Memory / RAM).
 * This data is at risk. It represents the "Body".
 */
export interface IActiveSession {
  sessionId: string;
  layerId: string;
  
  /** The items currently CARRIED (Risk of loss on death) */
  inventory: IItem[];
  
  health: number;
  maxHealth: number;
  energy: number;
  position: { x: number; y: number; z: number };
  
  /** Temporary buffs/debuffs for this run */
  statusEffects: string[];
}

/**
 * The Master Player Record.
 */
export interface IPlayer {
  id: string;
  username: string;
  
  bank: IBank;                 // The "Soul"
  currentSession?: IActiveSession; // The "Body" (undefined if in Hub)
  
  guildId?: string;
  ownedCityId?: string;
}
/**
 * --------------------------------------------------------------------------
 * PROJECT: WORLD SEED (THE UNIVERSAL CONTRACT)
 * ARCHITECT: [System]
 * VERSION: 1.2.1 (Hotfix: Types)
 * --------------------------------------------------------------------------
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
  SCRAP = 'SCRAP',
  COMMON = 'COMMON',
  UNCOMMON = 'UNCOMMON',
  RARE = 'RARE',
  EPIC = 'EPIC',
  LEGENDARY = 'LEGENDARY',
  ARTIFACT = 'ARTIFACT'
}

export enum GenreType {
  FANTASY = 'FANTASY',
  SCIFI = 'SCIFI',
  POST_APOC = 'POST_APOC',
  ELDRITCH = 'ELDRITCH',
  RETRO = 'RETRO'
}

// ==========================================================================
// 2. THE ECONOMY & ITEM TYPES
// ==========================================================================

export enum ItemType {
  GEAR = 'GEAR',
  CRAFTING_ORB = 'CRAFTING',
  CONSUMABLE = 'CONSUMABLE',
  RESOURCE = 'RESOURCE',
  COSMETIC = 'COSMETIC',
  DEED = 'DEED',
  CONTAINER = 'CONTAINER',
  STRUCTURE = 'STRUCTURE',
  COMMODITY = 'COMMODITY',
  TOOL = 'TOOL'
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
  NONE = 'NONE'
}

// ==========================================================================
// 3. THE ITEM CONTRACT
// ==========================================================================

export interface IAffix {
  id: string;
  name: string;
  type: 'PREFIX' | 'SUFFIX';
  stats: Record<string, number>;
  tier: number;
}

export interface IHarvestConfig {
  interactionType: string;
  requiredToolTags: string[];
  minToolPower: number;
  energyCost: number;
  baseTimeSeconds: number;
}

export interface IItem {
  id: string;
  universalDefinitionId: string;
  name: string;
  description: string;
  type: ItemType;
  slot: SlotType;
  rank: UniversalRank;
  rarity: Rarity;
  quality: number;
  level: number;
  value: number;
  itemPower: number;
  
  // FIXED: Added missing 'tags' property
  tags: string[]; 
  
  affixes: IAffix[];
  
  // Physics
  dimensions: { width: number; height: number };
  weight: number; 

  stats: {
    damage?: number;
    defense?: number;
    attackSpeed?: number;
    durability?: number;
    maxDurability?: number;
    [key: string]: any;
  };

  visuals: {
    modelId: string;
    colorHex: string;
    particleEffect?: string;
    iconUrl?: string;
  };
  
  icon: string;

  history: {
    craftedByPlayerId?: string;
    foundInLayerId?: string;
    dropDate: number;
    killCount: number;
  };

  isIdentified: boolean;

  deedData?: {
    originBiome: string;
    originLayer: string;
    coordinateHash: string;
    rank: UniversalRank;
    allowedStructures: ('HOUSE' | 'WORKSHOP' | 'VENDOR')[];
  };

  toolData?: {
    toolTags: string[];
    toolPower: number;
    efficiency: number;
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

export interface IAttributes {
    strength: number; 
    constitution: number; 
    agility: number; 
    dexterity: number; 
    endurance: number;
    intelligence: number; 
    focus: number; 
    engineering: number; 
    hacking: number; 
    perception: number;
    charisma: number; 
    intimidation: number; 
    subterfuge: number; 
    bartering: number; 
    leadership: number;
}

export interface ILoreEntry {
  topic: string;
  xp: number;
  level: number;
  dateDiscovered: number;
}

export interface ISkillState {
  id: string;
  level: number;
  currentXp: number;
  tags: string[];
  scalingAttribute: string;
  origin?: {
    timestamp: number;
    triggerAction: string;
    location: string;
    resonance: number;
  };
}

export interface IBank {
  accountId: string;
  gold: number;
  stashTabs: {
    name: string;
    items: IItem[];
  }[];
  universalSkills: Record<string, ISkillState>;
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

// NEW: Interaction Types for UI
export enum InteractionType {
  HARVEST = 'HARVEST',
  PICKUP = 'PICKUP',
  OPEN = 'OPEN',
  STUDY = 'STUDY',
  ANALYZE = 'ANALYZE',
  COMMUNE = 'COMMUNE',
  HACK = 'HACK'
}

export interface IInteractionOption {
  id: string;
  label: string;
  type: InteractionType;
  icon: string;
  energyCost: number;
  timeCostSeconds: number;
  requirements: {
    toolType?: string;
    skillId?: string;
    minSkillLevel?: number;
    consumableId?: string;
  };
  consequence: {
    lootTableId?: string;
    knowledgeId?: string;
    xpTags?: string[];
  };
}

export interface IMaterialKnowledge {
  resourceId: string;
  knowledgeLevel: number;
  discoveredAffixes: string[];
}

// NEW: The "Float Memory" System
export interface ICognitiveFrame {
  id: string;
  name: string;
  description: string;
  type: 'LOGIC' | 'INSTINCT' | 'SOCIAL';
  modifiers: Partial<Record<keyof IAttributes, number>>; // +Buffs and -Debuffs
  colorHex: string;
}

export interface IPlayer {
  id: string;
  username: string;
  bank: IBank;
  currentSession?: IActiveSession;
  guildId?: string;
  ownedCityId?: string;
  materialMastery: Record<string, IMaterialKnowledge>;
  
  // FIXED: Separated Base vs Effective Attributes
  baseAttributes: IAttributes; // Raw stats (XP/Levels)
  attributes: IAttributes;     // Effective stats (Base + Frames + Gear)
  
  // NEW: 3 Slots for Thinking Frames
  floatMemory: [ICognitiveFrame | null, ICognitiveFrame | null, ICognitiveFrame | null];
}

export interface IInteractionOption {
  id: string;
  label: string;             // "Mine Iron Vein"
  type: InteractionType;
  icon: string;              // "⛏️"
  energyCost: number;
  timeCostSeconds: number;
  
  // The Condition
  requirements: {
    toolType?: string;       // "pickaxe"
    skillId?: string;        // "skill_mining"
    minSkillLevel?: number;
    consumableId?: string;   // "scanner_battery"
  };
  
  // The Consequence
  consequence: {
    lootTableId?: string;
    knowledgeId?: string;
    xpTags?: string[];
  };
}

export interface IMaterialKnowledge {
  resourceId: string;        // "res_iron"
  knowledgeLevel: number;    // 0 = Unknown, 1 = Name, 2 = Basic Props, 3 = Affixes
  discoveredAffixes: string[]; // IDs of affixes this player knows exist on this material
}
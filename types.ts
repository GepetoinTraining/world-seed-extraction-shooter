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
  TOOL = 'TOOL',
  LORE = 'LORE', // Wave 2.3: lore fragments & social contracts (contract upgrade: additive)
  TEMPLATE = 'TEMPLATE' // Wave 10B: a signed building plan, designed at the scribe's table (additive)
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
  NONE = 'NONE',
  // Wave 10C (contract upgrade: additive): the slot tree grows the full body.
  EYES = 'EYES',           // D17: glasses — the natural home for identify/scan affixes (10E)
  SHOULDER = 'SHOULDER',   // themed per genre: cape, pauldron, scrap spaulder…
  NECKLACE = 'NECKLACE',
  EARRING = 'EARRING',
  RING = 'RING',           // two body positions (RING_1 / RING_2) accept it
  QUIVER = 'QUIVER',
  BELT = 'BELT',           // D17: opens pouch slots
  TOOL = 'TOOL',           // tools ARE the extraction: used from their own slot, never swapped for a weapon
  POUCH = 'POUCH'          // a bag type whose rule names what it stacks; rides IN a belt
}

// ==========================================================================
// 2B. THE SLOT TREE (Wave 10C — the body replaces Wave 4's three buckets)
// ==========================================================================

/** The fifteen fixed body positions. TOOL and POUCH slots are counted families. */
export const BODY_SLOT_IDS = [
  'HEAD', 'EYES', 'RIGHT_HAND', 'LEFT_HAND', 'CHEST', 'LEGS', 'BOOTS',
  'SHOULDER', 'BAG', 'NECKLACE', 'EARRING', 'RING_1', 'RING_2', 'QUIVER', 'BELT'
] as const;
export type BodySlotId = typeof BODY_SLOT_IDS[number];
export type ToolSlotId = `TOOL_${number}`;
export type PouchSlotId = `POUCH_${number}`;
export type EquipSlotId = BodySlotId | ToolSlotId | PouchSlotId;

/** Dedicated tool slots. Start with one; raising this constant is the whole cost of more. */
export const TOOL_SLOT_COUNT = 1;
export const toolSlotIds = (count: number = TOOL_SLOT_COUNT): ToolSlotId[] =>
  Array.from({ length: count }, (_, i) => `TOOL_${i + 1}` as ToolSlotId);
export const pouchSlotIds = (count: number): PouchSlotId[] =>
  Array.from({ length: count }, (_, i) => `POUCH_${i + 1}` as PouchSlotId);

/**
 * D22 — THE HEAD BUDGET. Four positions, each holding EITHER its gear OR a
 * cognitive frame; three frames at most, so max frames still leaves one piece
 * of gear up there. The reason is a stat law, not geography: see the partition.
 */
export type HeadPositionId = 'HEAD' | 'EYES' | 'EARRING' | 'NECKLACE';
export const HEAD_BUDGET_POSITIONS: HeadPositionId[] = ['HEAD', 'EYES', 'EARRING', 'NECKLACE'];
export const MAX_FRAMES = 3;

/**
 * D22 — THE STAT PARTITION IS LAW. Mental stats come ONLY from cognitive
 * frames; physical gear never carries them, in any slot, so the trade is
 * always mind against matter and can never be dodged by mental-stat jewelry.
 * 10E's affix banks enforce the same line: a mental affix only rolls on a frame.
 */
export const PHYSICAL_ATTRIBUTES = ['strength', 'constitution', 'agility', 'dexterity', 'endurance'] as const;
export const MENTAL_ATTRIBUTES = [
  'intelligence', 'focus', 'engineering', 'hacking', 'perception',
  'charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership'
] as const;

/** D21 — a slot marked protected for this session, by a named magic (items land in 10E). */
export interface ISlotProtection {
  slot: EquipSlotId;
  by: string; // the charm or scroll that holds the line; the dev hook names itself
}

/**
 * Wave 10C — the harness. Equipped items leave the pack grid and live here:
 * the weight law (equipped gear exempt from carry weight) falls out of that.
 * Persists on the player — the harness comes home; the haul is what is risked.
 */
export interface IEquipmentState {
  slots: Partial<Record<EquipSlotId, string>>;          // slot id -> item id in `items`
  items: IItem[];                                        // what the body wears
  frames: Partial<Record<HeadPositionId, string>>;       // D22: cognitive frame ids by position
  protected: ISlotProtection[];                          // D21: session marks
}

// ==========================================================================
// 2C. THE ANATOMY OF ITEMS (Wave 10D — composition, the chain, the budget)
// ==========================================================================

/** Where an atom of an item's composition entered the economy. */
export type MaterialOrigin =
  | 'HARVEST'        // taken from the world by hand or tool
  | 'PURCHASE'       // minted at a counter, gold on record
  | 'IMPROVISATION'  // combined in the field, no bench, no apology
  | 'WORLD'          // rolled by the world itself (loot, chests, genesis)
  | 'CONSTRUCTION'   // minted by a finished shell (bench, counter)
  | 'SALVAGE';       // torn back out of a demolished piece, bitten

/** One step of labor in an item's transformation chain. */
export interface ICompositionStep {
  recipeId: string;
  name: string;
  laborSeconds: number;
  /** null = improvised: no facility, anywhere, including the field (the floor). */
  facility: string | null;
}

/**
 * Wave 10D — what an item is MADE OF: its atoms and the chain that made it.
 * Counts and labor are per item (a batch's share divides at compose time), so
 * the same chain gives byte-identical composition on every machine. The chain
 * is the power budget: more chain, better item. Versioned: the rules may grow,
 * old items keep the law they were made under.
 */
export interface IComposition {
  version: number;
  materials: { defId: string; name: string; count: number; origin: MaterialOrigin }[];
  steps: ICompositionStep[];
  /** Longest transformation path — THE POWER BUDGET. 0 = raw or world-rolled. */
  depth: number;
  /** Total labor invested in this one item, seconds (batch share included). */
  laborSeconds: number;
  /** How many items the final step minted from these atoms (the record). */
  batchYield: number;
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

  // Wave 10C (contract upgrade: additive)
  /** 10C.2: stat requirements against the fifteen attributes; unmet refuses in voice. */
  requirements?: Partial<IAttributes>;
  /** D17: a POUCH is a bag type whose rule names what it stacks (tags), up to capacity. */
  pouchData?: {
    accepts: string[];   // tags that answer the rule; one must match
    capacity: number;    // how many items it stacks
    contents: IItem[];   // what rides inside, quick-usable without opening the pack
  };
  /** D17: a belt opens this many pouch slots while worn. */
  beltData?: {
    pouchSlots: number;
  };
  /** D16: a packed cart. Used in the field, it becomes a towed world entity with this grid. */
  cartData?: {
    gridW: number;
    gridH: number;
  };

  // Wave 10D (contract upgrade: additive)
  /** 10D.2: what this item is made of — its atoms and its chain. */
  composition?: IComposition;
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
  carryItemIds?: string[]; // stash items taken into the next session, beside tools
  stashTabs: {
    name: string;
    items: IItem[];
  }[];
  universalSkills: Record<string, ISkillState>;
  lore: Record<string, ILoreEntry>;
}

// Wave 3.1: where an item sits in the session grid (contract upgrade: additive)
export interface IGridPlacement {
  x: number;
  y: number;
  rotated: boolean; // swaps the item's width/height
}

// Wave 4.1: what the agent is actually wielding/wearing (item ids into the
// session inventory — the items stay in the pack grid; equipped = referenced)
export interface IEquippedSlots {
  mainHand?: string;
  armor?: string;
  accessory?: string;
}

export interface IActiveSession {
  sessionId: string;
  layerId: string;
  inventory: IItem[];
  // Wave 3.1: spatial layout of the inventory (itemId -> cell). Optional so
  // pre-Wave-3 session snapshots stay valid; the system repairs missing layouts.
  inventoryLayout?: Record<string, IGridPlacement>;
  // What came in with the player; everything else in the pack was found in the field
  kitItemIds?: string[];
  // Wave 4.1: equipped gear (additive contract change)
  // Wave 10C: LEGACY — the three buckets migrate into IPlayer.equipment's slot
  // tree on load (LoadoutSystem.migrate). Kept so old session snapshots parse.
  equipped?: IEquippedSlots;
  // Wave 10C (D16): the cart entity this agent is towing, if any
  towingCartId?: string;
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
  archetype?: string; // chosen at birth; an avatar's look is derived from it
  // Wave 9.5 (contract upgrade: additive): kills feed the universal rank.
  // rankXp is lifetime kill XP; attributePoints are granted on each rank-up
  // and spent into baseAttributes. The rank itself is derived from rankXp.
  rankXp?: number;
  attributePoints?: number;
  bank: IBank;
  currentSession?: IActiveSession;
  guildId?: string;
  ownedCityId?: string;
  materialMastery: Record<string, IMaterialKnowledge>;
  
  // FIXED: Separated Base vs Effective Attributes
  baseAttributes: IAttributes; // Raw stats (XP/Levels)
  attributes: IAttributes;     // Effective stats (Base + Frames + Gear)
  
  // NEW: 3 Slots for Thinking Frames
  // Wave 10C (D22): LEGACY MIRROR — frames now live at equipment.frames, keyed
  // by head position. This array is kept in sync (order: budget positions) so
  // older readers keep working; the head budget is the truth.
  floatMemory: [ICognitiveFrame | null, ICognitiveFrame | null, ICognitiveFrame | null];

  // Wave 10C (contract upgrade: additive): the harness — the full slot tree,
  // the head budget's frames, and D21's protection marks. Persists in the bank
  // doc: the harness comes home, the haul is what is risked.
  equipment?: IEquipmentState;
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
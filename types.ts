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
  TEMPLATE = 'TEMPLATE', // Wave 10B: a signed building plan, designed at the scribe's table (additive)
  MAP = 'MAP', // D85: what a character scanned of one world, written at the scribe's table (additive)
  WORLD_DEED = 'WORLD_DEED' // D72: what minting a world spends. Not the lot's DEED (additive)
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

/** D21 — a slot marked protected for this session, by a named magic (10E mints the items). */
export interface ISlotProtection {
  slot: EquipSlotId;
  by: string; // the charm or scroll that holds the line
  /** 10E (scrolls): the magic holds until this clock, then lapses. Absent = until spent. */
  until?: number;
  startedAt?: number;
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
  /** What skills gave that is always true of this body. StatSystem.total reads it beside what is worn. */
  passives?: Record<string, number>;
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
  | 'SALVAGE'        // torn back out of a demolished piece, bitten
  | 'FARMED';        // grown on a plot, or taken from a herd at home

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
// 2D. THE AFFIX BANK (Wave 10E — D19, D20, D22)
// ==========================================================================

/**
 * One banked affix. An entry starts as a NAME — it does nothing until a later
 * batch defines its effect (statModifiers absent = name-only). Ranges may be
 * NEGATIVE (D19: downside pays for upside). D22 binds the bank: a mental-stat
 * entry's allowedTags must be exactly ['frame'] or the whole batch is refused.
 */
export interface IBankedAffix {
  id: string;
  name: string;
  type: 'PREFIX' | 'SUFFIX';
  /** The theme the batch was run for: a biome, 'GLOBAL', or 'CART' (D16's security family). */
  theme: string;
  allowedTags: string[];
  tier: number;
  statModifiers?: Record<string, [number, number]>;
  /** D53: the world theme this entry belongs to. Absent means it answers every shelf. */
  themeId?: string;
}

/** D20: one batched LLM agent run — a run banks NAMES; a later run defines EFFECTS. */
export interface IAffixBatch {
  runId: string;
  kind: 'NAMES' | 'EFFECTS';
  model: string;   // who ran the batch, on the record
  ranAt: number;
  names?: Omit<IBankedAffix, 'statModifiers'>[];
  effects?: { id: string; statModifiers: Record<string, [number, number]> }[];
}

/**
 * D20: a versioned content pack — the bank as of its version (one version per
 * batch folded in). A world pins the version at mint; added content never
 * changes an existing world (the determinism one-way door).
 */
export interface IContentPack {
  packId: string;
  version: number;
  name: string;
  batches: { runId: string; kind: 'NAMES' | 'EFFECTS'; model: string; ranAt: number }[];
  entries: IBankedAffix[];
}

export interface ISignedContentPack {
  pack: IContentPack;
  signerUid: string;
  signature: string;
}

// ==========================================================================
// 2E. THE TAG LAW AND THE WEB (D27, D28, D29)
// ==========================================================================

/** What a tag is. Every kind states, once, whether it counts toward a skill's identity. */
export type TagKind =
  | 'tool'        // what the work is done with
  | 'family'      // the broad nature of a thing worked: living, mineral, built...
  | 'material'    // the substance worked
  | 'trade'       // a body of work that has no one tool: carpentry, a schooled eye
  | 'action'      // work done with the body and no object: melee, talk
  | 'descriptive' // a quality that never splits a skill: crafted, heavy
  | 'magnitude'   // how much of something: grunt, elite, boss. Rank rides beside identity
  | 'use'         // what a thing answers: a bill, a meal, a station
  | 'class'       // what kind of item: tool, armor, pouch
  | 'scope'       // what a banked affix may roll on
  | 'stat'        // an attribute named in a context
  | 'context'     // what sort of moment an action was, and nothing more
  | 'verb'        // what a held skill lets its holder do
  | 'element';    // what a magic is made of. No fixed list: a theme registers its own (Layer 1)

export const TAG_KIND_IDENTITY: Record<TagKind, boolean> = {
  tool: true, family: true, material: true, trade: true, action: true,
  descriptive: false, magnitude: false, use: false, class: false, scope: false, stat: false, context: false, element: true, verb: false
};

/** THE TAG LAW, clause 1: one registry. A tag has a kind and one meaning, forever. */
export interface ITagEntry {
  tag: string;
  kind: TagKind;
  meaning: string;
  /** Words that mean the same thing. They can never be registered. */
  refuses?: string[];
  /** Clause 2: retired, never reused. The spelling stays on the books. */
  retired?: { runId: string; replacedBy?: string; why: string };
}

/** A tool the web knows: its tag, what it works, and what its holder can do with it. */
export interface IWebTool {
  id: string;
  name: string;
  tag: string;
  rank: UniversalRank;
  /** True when the item already lives in the item definitions. Otherwise this entry mints it. */
  existing?: boolean;
  basePower?: number;
  powerStat?: string;
  /** Material tags it answers. Any match connects it. */
  works: string[];
  /** A verb opens at its rung (D27): the same pair gains actions as it is mastered. */
  verbs: { verb: string; rung: number }[];
}

/** A good or a raw material that exists only because a batch said so. */
export interface IWebMaterial {
  id: string;
  name: string;
  tags: string[];
  rank: UniversalRank;
  rarity: Rarity;
  weight: number;
  width?: number;
  height?: number;
  description?: string;
  type?: ItemType;
  stats?: Record<string, number>;
  /** Raw and sold on the alchemist's shelf: how a batch's material reaches play with no code. */
  shelfPrice?: number;
}

/** D25: a further station, opened by a skill's tool + material connection, never by a list. */
export interface IWebStation {
  id: string;
  name: string;
  description?: string;
  connection: { tool: string[]; material: string[] };
  /** Asked on top of a further bench's own bill, at shellBillFor. */
  bill: { tag: string; count: number }[];
  /** D8: higher technology asks for a bigger room. */
  minArea: number;
  weight: number;
  width: number;
  height: number;
  /** D91: stations that must stand first, though no recipe says so. Read by `hubTech`. */
  after?: string[];
}

export interface IWebRecipe {
  id: string;
  name: string;
  description: string;
  inputs: { itemId: string; quantity: number; consume: boolean }[];
  outputs: { itemId: string; quantity: number; probability: number }[];
  energyCost: number;
  laborTimeSeconds: number;
  requiredFacility: 'WORKSHOP';
  requiredStation: string;
  /** A held skill must carry this verb (hasVerb). The verb is the gate, not a list. */
  requiresVerb?: string;
  /** The trade the work grows, and whose additions the step draws (D26). */
  trade: string;
  requiredSkill?: string;
  minSkillLevel?: number;
}

/** Loot teaches: a piece bearing these tags implies this tool + material connection. */
export interface IWebDesign {
  matches: string[];
  tool: string;
  material: string[];
}

export interface IWebVerbLink {
  tags: string[];
  verb: string;
  rung: number;
}

/** D20: one batched run. Refused WHOLE when any entry breaks the law. */
export interface IWebBatch {
  runId: string;
  model: string;
  ranAt: number;
  tags?: ITagEntry[];
  retire?: { tag: string; replacedBy?: string; why: string }[];
  tools?: IWebTool[];
  materials?: IWebMaterial[];
  goods?: IWebMaterial[];
  stations?: IWebStation[];
  recipes?: IWebRecipe[];
  designs?: IWebDesign[];
  verbLinks?: IWebVerbLink[];
  /** Clause 6: a word attaches to an id. A later batch may rename; nothing else moves. */
  names?: { tags: string[]; name: string; flavor?: string }[];
}

export interface IWebPack {
  packId: string;
  version: number;
  batches: { runId: string; model: string; ranAt: number }[];
  tags: ITagEntry[];
  tools: IWebTool[];
  materials: IWebMaterial[];
  goods: IWebMaterial[];
  stations: IWebStation[];
  recipes: IWebRecipe[];
  designs: IWebDesign[];
  verbLinks: IWebVerbLink[];
  names: { tags: string[]; name: string; flavor?: string }[];
}

export interface ISignedWebPack {
  pack: IWebPack;
  signerUid: string;
  signature: string;
}

/** The work toward a skill not yet held, batched until a rest (D30). */
export interface ISkillProgress {
  id: string;
  tags: string[];
  /** The deepest rank worked. Magnitude rides beside the identity (clause 5). */
  rank: number;
  attempts: number;
  weight: number;
}

/** One credit: who, when. */
export interface IWebCredit {
  uid: string;
  name: string;
  at: number;
}

/** A skill as the hub knows it. The web is the hub's; the exp stays on each person. */
export interface IWebNodeRecord {
  id: string;
  tags: string[];
  rank: number;
  firstBy: IWebCredit;
  rungRecord: IWebCredit & { rung: number };
  /** Q9: the name the first to reach it gave it (creation's or the dream's, signed), so the hub calls one skill one thing. Absent: the bank's words. */
  name?: string;
  flavor?: string;
}

/** A skill the hub holds and nobody knows of: it opens nothing until the web reaches it. */
export interface IWebSilentRecord {
  id: string;
  tags: string[];
  rank: number;
  by: IWebCredit;
  rung: number;
}

export interface IHubWeb {
  nodes: Record<string, IWebNodeRecord>;
  /** D119: "added to the hub silently, the players cannot know, they need to make the web reach it." */
  silent?: Record<string, IWebSilentRecord>;
}

// ==========================================================================
// 3. THE ITEM CONTRACT
// ==========================================================================

/**
 * The raw materials leg (D26): the stats a banked addition acts through when it
 * stands in a building or a piece of furniture. On gear these lines stay on the
 * affix's record and off the acting stats; everything else works the other way.
 */
export const ROOM_ACTING_STATS = ['upkeep_discount_pct', 'craft_speed_pct'] as const;

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
  /** Layer 3: an ability this piece carries, and when it fires. It acts unstudied (D19). */
  carries?: { ability: string; trigger: string };
  /** Layer 3: what a scroll casts when it is used. */
  casts?: string;
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
  identifyAttempts?: number; // D32: field rolls spent on it so far. Only another attempt can roll differently.

  /** The raw materials leg (D26): a trade note, whose reading opens what a process adds. */
  loreData?: { processFamily: string; tier: number };

  /** D27, Wave 11's seam: the person an Escort Bond names, enough to read their sheet back. */
  bondData?: {
    worldSeed: string;
    entityId: string;
    webVersion?: number;
    /** D119: the theme they came from, whose pool their profession is dealt from. */
    themeId?: string;
    rank: UniversalRank;
    rarity: Rarity;
    sheet: {
      name: string;
      temperament: string;
      objective: string;
      want: string;
      disposition: number;
      attempts: number;
    };
  };

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

  // Wave 10E (contract upgrade: additive)
  /** D21: a charm naming its protection — how many slots, chosen or random, and its uses. */
  charmData?: {
    slots: number;
    chosen: boolean;
    uses: number;
  };
  /** D21: a scroll's protection runs on a clock — slots held until the time is spent. */
  /** D85: a world's sectors as a scribe held them. Levels and counts, never a name (D60). */
  /** D72, D80: what minting a world spends. It names a size and no holder, so it can change hands. */
  worldDeedData?: { size: number; source: 'FREE' | 'FOUND' };
  /** D65: what is alive in this cage: the body, its kind and the proof of its line. */
  creatureData?: import('./src/logic/systems/Capture').ICaged;
  /** Line 37: the bed this came off, the seed it grew from, and how many plantings stand behind it. */
  farmLine?: { lotId: string; bed: number; seedItemId: string; seedName: string; plantings: number; firstOrigin: string; plantedAt: number; reapedAt: number };
  /** D115: bought from a bargain bin at this price. A counter pays no more than this for it. */
  binPrice?: number;

  mapData?: {
    worldId: string;
    worldName: string;
    scribeUid: string;
    scribeName: string;
    writtenAt: number;
    sectors: NonNullable<IPlayer['survey']>[string];
  };
  scrollData?: {
    slots: number;
    chosen: boolean;
    durationSeconds: number;
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
  /** D118: all the lore ever gained under this topic. Spending never lowers it: it is what a person knows. */
  xp: number;
  level: number;
  dateDiscovered: number;
  /** D118: the highest rank studied under this topic. What lore teaches from it is born at this rank. */
  peak?: number;
}

/** D118: what a study can be aimed at. Anything: Pedro, "You can study anything and everything". */
export type StudyTargetKind = 'item' | 'person' | 'creature' | 'building' | 'place' | 'thing';

/** Pedro: "roll based, failure damages it, major failure loses it, major win doubles the amount gained". */
export type StudyOutcome = 'major_win' | 'success' | 'failure' | 'major_failure';

/** What was looked at, as the person could see it. Only what the screen showed is ever said. */
export interface IStudyTarget {
  kind: StudyTargetKind;
  /** Its id, for the key and the count. It never goes to the door. */
  ref: string;
  name: string;
  tags: string[];
  /** Its rank, if it has one. Otherwise it stands at the rank of whoever is looking. */
  rank?: UniversalRank;
  /** An unread piece: its name and tags were kept from the person, so they are kept from the door. */
  hidden?: boolean;
  /** D99, for C8: a piece of junk. What studying one opens is not read here. */
  junk?: boolean;
  /** Pedro: a finished product asks for a workstation for it. This is the work it asks for. */
  station?: string;
}

/** One sitting, logged when it landed and answered at a dream. */
export interface IStudySitting {
  id: string;
  target: IStudyTarget;
  outcome: StudyOutcome;
  /** The rank it was rolled against, as an index. It sets what the sitting pays. */
  rankIndex: number;
  energy: number;
  at: number;
  /** Sittings on this thing before this one. */
  before: number;
}

/** A person's record of a thing they have sat with. Harm is what a failure leaves on what cannot be taken away. */
export interface IStudyMark {
  sittings: number;
  harm: number;
  /** Lost: it will not sit for this person until this day. */
  lostUntilDay?: number;
}

/** What a skill's circles earned: something to cast, or something always true. */
export interface ISkillGift {
  id: string;
  kind: 'active' | 'passive';
  name: string;
  blurb: string;
  elements?: string[];
  delivery?: string;
  effect?: string;
  cost?: string;
  stat?: string;
  value?: number;
  /** D118: how many times a dream has spent lore to raise this passive. */
  raises?: number;
}

export interface ISkillState {
  id: string;
  level: number;
  currentXp: number;
  tags: string[];
  scalingAttribute: string;
  /** D28: the deepest rank this skill has worked. It rides beside the identity, never in it. */
  rank?: number;
  /** How rare the skill is: the rank it settled at. It sets the skill's pace and weight, and deeper work does not move it. */
  bornRank?: number;
  /** Levels poured into this skill. Each third one earns an active skill or a passive bonus at a rest. */
  circles?: number;
  /** D28: a track from an old save the law cannot read. Kept whole, off the web. */
  legacy?: boolean;
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
    layout?: Record<string, IGridPlacement>; // the usability pass: where things sit in the vault's grid
  }[];
  universalSkills: Record<string, ISkillState>;
  lore: Record<string, ILoreEntry>;
  /** D118: lore as a resource, what study gives and a dream spends. Absent only on a save from before it. */
  loreHeld?: number;
  /** What the purse held when a dream last had the chance to spend it. A dream is asked again only for more. */
  loreOffered?: number;
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

/**
 * Q16 (Pedro, 2026-11-04): a person brought out walks beside you and fights back when engaged.
 * If they fall, they are carried out as a heavy body nobody may open, and they come back on the
 * other side, as a player does. Their health is their own, from their own sheet.
 */
export interface IEscort {
  entityId: string;
  name: string;
  /** Their own sheet's stats: what their health, their blow and their body's weight are read from. */
  stats: IAttributes;
  health: number;
  maxHealth: number;
  lastStrikeAt: number;
  /** How many blows they have thrown, so each one rolls on its own key. */
  strikes: number;
  /** What Mags reads when they reach the city: the same bond the field always wrote. */
  bond: NonNullable<IItem['bondData']>;
  fallen?: boolean;
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
  /** D65: what walks beside this person for a while, and the cage it goes home in. */
  tamed?: { entityId: string; item: IItem; until: number }[];
  /** Q16: the people brought out, walking beside this person to the beacon, or carried. */
  escorts?: IEscort[];
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
  /** Layer 1: what is working on this body right now, on the clock. */
  activeEffects?: { kind: string; magnitude: number; until: number; nextAt: number; tickMs?: number; startedAt?: number }[];
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

/** Who a person was, as the creation flow settled it. `origin` is the bank's id, and it is never shown. */
export interface ICreationRecord {
  origin: string;
  main: string;
  sub: string;
  kit: string;
  /** What Kami called them, when he set it up himself. */
  className?: string;
  /** The world the Seed spoke of, which the mint then offers first. */
  themeId?: string;
  answers: Record<string, string>;
  said?: string;
  line: string;
  by: 'DOOR' | 'FLOOR';
}

export interface IPlayer {
  id: string;
  username: string;
  /** D72: this character has had its free deed. Set once, whether or not it still holds it. */
  freeDeedGiven?: boolean;
  /** Absent on a character from before the flow. */
  creation?: ICreationRecord;
  archetype?: string; // chosen at birth; an avatar's look is derived from it
  // D83: rank and level are two things. rankXp is lifetime experience, and it no
  // longer decides the rank; attributePoints are granted on each level and spent
  // into baseAttributes.
  rankXp?: number;
  attributePoints?: number;
  /** D83: set by the guild for hard quests. An old save takes the rank its experience earned, once. */
  rank?: UniversalRank;
  /** D83: experience since the last rank. A grant sets it back to zero; the level reads from it. */
  levelXp?: number;
  /** D83: levels climbed at earlier ranks. They stay yours through a reset, and each is a circle to fill. */
  levelsBanked?: number;
  /** Chests this character has seen, by world and id: where, and how they were last seen. Knowledge, never the truth of now. */
  chestMarks?: Record<string, Record<string, { x: number; y: number; empty: boolean }>>;
  /** What each skill's circles have earned, by skill id. Its numbers were rolled here, never by a model. */
  skillGifts?: Record<string, ISkillGift[]>;
  /** D51: what is left of today's energy between sessions. Undefined means a full day. */
  energyToday?: number;
  dayCount?: number;
  /** D43, D50: what play queued, for the next rest. */
  restQueue?: { studies: string[]; weaves: string[][]; met: string[]; ground: string[]; sittings?: IStudySitting[] };
  /** What was filed at the door and has not come back. */
  pendingDream?: { batchId: string; themeId?: string; asked: { skills: string[]; weaves: string[]; gifts?: string[]; sittings?: string[] }; filedAt?: number };
  /** D118: every sitting this character has taken. It keys the next roll, so a reload rolls nothing new. */
  studyCount?: number;
  /** D118: what this character has sat with, by `StudySystem.keyOf`. */
  studyMarks?: Record<string, IStudyMark>;
  /** D79: a rest takes real time, and until then this character is down. */
  rest?: { until: number; place: 'INN' | 'BED' | 'FIELD'; startedAt?: number };
  /** Q2, Q14: when this character sealed a run out of the tutorial, its first order. Unset, the order stands. */
  tutorialSealedAt?: number;
  /** D68: what this character has scanned, per world and sector. Theirs, wherever they go (D81). */
  survey?: Record<string, Record<string, {
    level: number;
    generation: number;
    contacts: Record<string, number>;
    changed: number;
    prior?: { contacts: Record<string, number>; changed: number; generation: number };
    /** D93: the territories read here, by a scan or on foot. A sector can hold several, and they go stale like the rest (D68). */
    holdings?: { generation: number; seat: string; chunks: string[]; anchors: number; marks: { fn: string; ground: string; built: boolean }[]; named?: string }[];
  }>>;
  /** D58: what a rest's model said of a skill, and what it lets the holder do. */
  skillWords?: Record<string, { name: string; flavor: string; grants: string[] }>;
  /** Layer 4: aether per element, from what was gathered. */
  reserves?: Record<string, number>;
  weaveNames?: Record<string, string>;
  knownAbilities?: string[];
  /** What the focus casts right now. Absent: the plain burst. */
  activeCast?: { kind: 'weave'; elements: string[] } | { kind: 'ability'; id: string } | { kind: 'gift'; id: string };
  bank: IBank;
  currentSession?: IActiveSession;
  guildId?: string;
  ownedCityId?: string;
  materialMastery: Record<string, IMaterialKnowledge>;
  /** D27: work toward skills not yet held, by skill id. It settles only at a rest (D30). */
  skillProgress?: Record<string, ISkillProgress>;
  
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
  graded?: boolean;          // D27: the rung between props and affixes: what it can become
}
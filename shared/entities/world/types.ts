import { UniversalRank, Rarity } from '../../types';

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
  /** 10E (D16's addendum): the lock level the thief had to break, on the record. */
  brokeLock?: number;
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
  items: import('../../types').IItem[];
  layout: Record<string, import('../../types').IGridPlacement>;
  towedBy?: string;                    // certificate uid of whoever holds the tow bar
  theftLog: ICartTheft[];
  /** 10E (D16's addendum): security affixes from the kit, captured at unfold. */
  security?: { lockLevel: number; alarm: boolean; by: string };
  /** The interface pass, 2026-11-11: what the cart is (its size word), weighs, and bears before the tow slows. */
  size?: string;
  weight?: number;
  bears?: number;
  /** The kit as it was unfolded, so folding it back gives the same cart. A cart saved before has none. */
  kit?: import('../../types').IItem;
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
  asks?: number;                           // Q50: times asked what they want (keys that roll); set by talking, never by generation
  // D27: DERIVED at read time from (world seed, entity id, pinned web version),
  // never stored at generation: a stored field would move the golden vectors.
  stats?: import('../../types').IAttributes;
  skills?: Record<string, import('../../types').ISkillState>;
  // D116: dealt the same way, under its own stream, so nothing above moves.
  alignment?: string;
}

/** Something working on an entity right now, on the clock. */
export interface IEntityStatus {
  kind: string;
  magnitude: number;
  until: number;
  nextAt: number;
}

/** What a thing is winding up to do, shown before it lands (R4, Layer 2). */
export interface ITelegraph {
  startedAt: number;
  until: number;
  delivery: string;
  reachPx: number;
  angle: number;
  /** The fight's shapes: the ground a blow will cover, drawn where it was aimed when it began. */
  shape?: { reachPx: number; innerPx: number; halfAngle: number };
  /** The fight's shapes: the volley a shot will leave as, its lanes drawn before it flies. */
  volley?: string;
}

/** What a leader's ground holds, read at a chunk. Plain words, and no creature's name (D60). */
export interface IHoldingOnEntity {
  seat: string;
  chunks: string[];
  anchors: number;
}

/** D93: a thing a leader raised. A function with a reader, and what it was drawn from. */
export interface IEntityStructure {
  fn: string;
  built: boolean;
  heldBy: string;
  maxHealth: number;
  material?: string;
  paid?: number;
  bill?: number;
  /** A watch post, where orders say it calls the bands in. */
  alarm?: boolean;
  /** Down, in this opening. A post relights by its ward's clock. */
  brokenAt?: number;
}

/** D93: what a plan set for the bodies to read. No model is called during play (D46). */
export interface IEntityOrders {
  posture: 'hold' | 'sortie' | 'fall_back';
  alarmCalls: boolean;
  seat?: { x: number; y: number };
}

export interface IWorldEntity {
  /** D93: a territory's. Who this body or structure answers to, and what it holds. */
  heldBy?: string;
  structure?: IEntityStructure;
  ward?: import('./Wards').IWard;
  warded?: boolean;
  orders?: IEntityOrders;
  holding?: IHoldingOnEntity;
  statuses?: IEntityStatus[];
  telegraph?: ITelegraph;
  /** The fight's law (part 3): laid under a ground that follows it (`BODIES_FROM_GROUND`). Absent, the body is as a standing world wrote it. */
  law?: number;
  /** D60: the only name a person ever reads for this body. Absent means masked. */
  displayName?: string;
  /** D48: what the Director made of this body. Absent means it is as it was born. */
  bonusHealth?: number;
  bonusDamage?: number;
  learned?: string[];
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
  /** RG: a place the land laid, taken, and coming back: on which turn of its gate, and when that turn begins by the game's clock. */
  returning?: { turn: number; at?: number };
  /** RG: a place that came back was rolled anew, its quality with it, on the gear's scale; what is taken from it carries it. */
  quality?: number;

  // Wave 2.3: containers (chests in ruins)
  // Wave 3.3: `items` = explicit contents (ground caches, overflow); when set,
  // opening gives exactly these instead of generated loot. `cacheOwner` keeps
  // ownership separate from containment (primordial owner-forest rule):
  // a cache on the ground is still YOURS.
  container?: {
    lootRank: UniversalRank;
    looted: boolean;
    hasLore: boolean;
    items?: import('../../types').IItem[];
    cacheOwner?: string;
  };

  // Wave 2.4: social extraction
  npc?: INpcSheet;
  /** Q16: this person walks beside someone to the beacon. Fallen, they lie where they fell until carried. */
  escort?: { by: string; fallen?: boolean };

  // D114: a monster someone has talked to. The meter is on `npc`, this is where that leaves it.
  bargain?: { stance: 'AGGRESSIVE' | 'NEUTRAL' | 'FRIENDLY'; holding?: boolean; wants?: string; wantsHeard?: boolean };

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

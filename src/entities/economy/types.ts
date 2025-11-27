/**
 * ECONOMIC PROTOCOL
 * The flow of value from Entropy (Extraction) to Order (Services).
 */

import { UniversalRank } from '../../../types';

export enum EconomicSector {
  PRIMARY = 'PRIMARY',           // Extraction, Agriculture (Raw Materials)
  LOGISTICS = 'LOGISTICS',       // Commoditization, Transport (Trade)
  SECONDARY = 'SECONDARY',       // Transformation, Manufacturing (Industry)
  TERTIARY = 'TERTIARY'          // Commerce, Services (Consumption)
}

// ============================================================================
// 1. EXTRACTION & HUSBANDRY (The Source)
// "Taking from the world."
// ============================================================================

export interface IHarvestSource {
  id: string;
  name: string;
  type: 'VEIN' | 'FLORA' | 'FAUNA' | 'ATMOSPHERE';
  
  // What does it yield?
  potentialDrops: {
    resourceId: string;
    chance: number; // 0-1
    minQuantity: number;
    maxQuantity: number;
  }[];

  // Requirements to extract
  hardness: number; // Tool power required
  regenerationRate: number; // Seconds to replenish
}

export interface IFarmPlot {
  id: string;
  ownerId: string;
  
  // Biological State
  seedId?: string;
  growthProgress: number; // 0-100%
  health: number;         // 0-100% (Affected by pests/water)
  
  // Inputs Required
  waterSaturation: number;
  nutrientLevel: number;
  
  state: 'FALLOW' | 'GROWING' | 'READY' | 'DEAD';
}

// ============================================================================
// 2. COMMODITIZATION (The Trade Layer)
// "Standardizing the chaos for transport."
// ============================================================================

/**
 * A Commodity is a standardized container of resources.
 * It solves the "Inventory Tetris" problem for bulk trade by 
 * having fixed dimensions regardless of the raw count (up to a limit).
 */
export interface ICommodity {
  id: string;
  resourceId: string;     // What's inside?
  quantity: number;       // How much? (e.g., 1000 Iron Ore)
  purity: number;         // 0-1.0 (Quality Multiplier)
  
  // Logistics Data
  batchId: string;        // Traceability (Who mined it?)
  packagingType: 'CRATE' | 'BARREL' | 'PALLET' | 'TANK';
  weight: number;         // Total weight
}

// ============================================================================
// 3. TRANSFORMATION (The Universal B2B Interface)
// "The catch-all for turning Input A into Output B."
// ============================================================================

export interface ITransformationRecipe {
  id: string;
  name: string;
  description: string;
  
  // The Equation
  inputs: { itemId: string; quantity: number; consume: boolean }[];
  outputs: { itemId: string; quantity: number; probability: number }[];
  
  // The Cost of Transformation
  energyCost: number;
  laborTimeSeconds: number;
  requiredFacility: string; // e.g., 'smelter_t1', 'assembler_t2'
  
  // The Skill Factor
  requiredSkill: string;    // e.g., 'skill_engineering'
  minSkillLevel: number;
}

export interface IIndustrialFacility {
  id: string;
  structureId: string;      // Links to world structure
  activeRecipeId?: string;
  
  // Buffer (Inventory)
  inputBuffer: string[];    // Item IDs
  outputBuffer: string[];   // Item IDs
  
  status: 'IDLE' | 'PROCESSING' | 'JAMMED' | 'NO_POWER';
  progress: number;         // 0-100% of current cycle
}

// ============================================================================
// 4. COMMERCE (B2C Retail)
// "Where value meets desire."
// ============================================================================

export interface IMarketListing {
  id: string;
  sellerId: string;         // NPC or Player
  itemId: string;           // The specific item/commodity
  
  // Pricing
  unitPrice: number;
  currency: 'GOLD' | 'CREDITS';
  
  // Stock Control
  quantityAvailable: number;
  isInfinite: boolean;      // For NPC vendors
}

// ============================================================================
// 5. SERVICES (Intangible Value)
// "Exchanging wealth for state change."
// ============================================================================

export enum ServiceType {
  REPAIR = 'REPAIR',             // Restore Item Durability
  HEALING = 'HEALING',           // Restore Player HP
  IDENTIFICATION = 'IDENTIFY',   // Reveal Item Stats
  LOGISTICS = 'LOGISTICS',       // Move Items from A to B
  INFORMATION = 'INTEL'          // Reveal Map/Lore
}

export interface IServiceOffer {
  id: string;
  providerId: string;       // NPC/Building ID
  type: ServiceType;
  name: string;
  
  // The Cost Function
  basePrice: number;
  scalingFactor: number;    // e.g., Price per 1% durability missing
  
  // The Effect
  effectiveness: number;    // 0-1.0 (How good is the repair?)
  durationSeconds: number;  // How long does it take?
}

// ============================================================================
// 6. MATERIAL SCIENCE (The "Infinite" Engine)
// "Properties determine reality."
// ============================================================================

export enum MaterialPropertyType {
  DENSITY = 'DENSITY',             // Affects HP / Weight
  HARDNESS = 'HARDNESS',           // Affects Defense / Tool Tier req
  CONDUCTIVITY = 'CONDUCTIVITY',   // Affects Tech speed / Lightning dmg
  RESONANCE = 'RESONANCE',         // Affects Magic capacity
  LUMINOSITY = 'LUMINOSITY',       // Emits light
  TOXICITY = 'TOXICITY',           // Area denial / Poison
  ELASTICITY = 'ELASTICITY'        // Earthquake resistance / Bounce
}

/**
 * The DNA of a material. 
 * Hidden from players unless they have the "Materials Engineer" skill.
 */
export interface IMaterialProfile {
  properties: Partial<Record<MaterialPropertyType, number>>; // 0.0 to 100.0+
  hiddenTags: string[]; // e.g., 'ancient', 'cursed'
}

// ============================================================================
// 7. CONSTRUCTION (The "Will" Implementation)
// ============================================================================

export enum BuildingCategory {
  RESIDENTIAL = 'RESIDENTIAL', // Houses (Pop cap)
  INDUSTRIAL = 'INDUSTRIAL',   // Factories (Processing)
  COMMERCIAL = 'COMMERCIAL',   // Shops (Trading)
  DEFENSIVE = 'DEFENSIVE',     // Turrets/Walls
  ARCANE = 'ARCANE'            // Mage Towers (Rituals)
}

/**
 * A Blueprint is a "Recipe" for a building.
 * It does NOT ask for specific items (e.g. "Oak Log").
 * It asks for *properties* (e.g. "Any Rigid Material").
 */
export interface IBlueprint {
  id: string;
  name: string;
  category: BuildingCategory;
  
  // The "Shape" of the cost
  requirements: {
    slotName: string;        // e.g. "Frame", "Insulation", "Wiring"
    materialTag: string;     // e.g. "structural", "fiber", "conductor"
    quantityVolume: number;  // Cubic Meters / Units needed
  }[];

  baseConstructionTime: number; // Cycles
  baseStats: Record<string, number>; // e.g. { hp: 1000, slots: 4 }
}

/**
 * A physical building in the world.
 * Its final stats are derived from the SPECIFIC materials used.
 */
export interface IConstructedBuilding {
  id: string;
  lotId: string;
  blueprintId: string;
  
  // The "DNA" of this specific instance
  // We record EXACTLY what was put into each slot
  materialsUsed: {
    slotName: string;
    itemDefId: string; // "res_void_wood" vs "res_pine"
    quantity: number;
  }[];

  // Calculated Result (Cached)
  finalStats: {
    maxHealth: number;
    efficiency: number;    // 1.0 = standard speed
    upkeepCost: number;
    specialEffects: string[]; // e.g. ["MANA_REGEN_AURA", "THORNS"]
  };

  condition: number; // Current HP
}

// ============================================================================
// 8. THE BUILDER MARKET (Labor)
// ============================================================================

export interface IBuilderNPC {
  id: string;
  name: string;
  rank: UniversalRank;
  
  // Skills affect outcome
  speedMultiplier: number;     // Builds faster
  efficiencyMultiplier: number; // Wastes less material
  
  // Wage
  costPerCycle: number;
}
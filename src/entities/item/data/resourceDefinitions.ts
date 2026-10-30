import { UniversalRank, Rarity, ItemType, SlotType, IItem, IHarvestConfig } from '../../../../types';
import { MaterialPropertyType } from '../../economy/types';

/**
 * EXTRACTABLES TAXONOMY (Wave 2.2) — README item 3a, in full.
 *
 * Flora:    grains (grassy seeds), shrubs (berries), fruit (food & poison),
 *           trees (logs + saplings)
 * Minerals: ore veins, sand (glass), rocks, pebbles
 *
 * Material properties drive physics (primordial pattern):
 *   weight per unit = DENSITY * 0.5 kg
 * Harvest gating: empty requiredToolTags = bare hands; otherwise the
 * InteractionEngine demands a tool with the tag and enough power.
 *
 * `uses` is how many times a world node yields before depleting.
 * `regrowMs` set = flora: the node comes back. Unset = mineral: gone forever.
 */

export type ResourceDef = Partial<IItem> & {
  id: string;
  name: string;
  harvestConfig?: IHarvestConfig;
  materialProps?: Partial<Record<MaterialPropertyType, number>>;
  uses?: number;        // node uses before depletion (default 1)
  regrowMs?: number;    // flora regrow time; minerals never regrow
  yieldPerUse?: [number, number]; // min/max items per harvest
};

const handsConfig = (energy: number, seconds: number): IHarvestConfig => ({
  interactionType: 'HARVEST',
  requiredToolTags: [],      // bare hands
  minToolPower: 0,
  energyCost: energy,
  baseTimeSeconds: seconds
});

export const RESOURCE_DEFINITIONS: Record<string, ResourceDef> = {

  // ==========================================================================
  // FLORA — fauna-adjacent extractables (grains, berries, fruit, trees)
  // ==========================================================================

  'res_grain_wild': {
    id: 'res_grain_wild',
    name: 'Wild Grain',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 0.2,
    dimensions: { width: 1, height: 1 },
    icon: '🌾',
    visuals: { modelId: 'grain', colorHex: '#d9b44a' },
    materialProps: { [MaterialPropertyType.DENSITY]: 0.4 },
    harvestConfig: handsConfig(2, 1.0),
    uses: 1,
    regrowMs: 90_000,
    yieldPerUse: [2, 4],
    tags: ['flora', 'grain', 'food']
  },

  'res_berry_bush': {
    id: 'res_berry_bush',
    name: 'Stim-Berries',
    type: ItemType.CONSUMABLE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 0.2,
    dimensions: { width: 1, height: 1 },
    icon: '🍒',
    visuals: { modelId: 'berry', colorHex: '#ef4444' },
    stats: { health_restore: 5 },
    materialProps: { [MaterialPropertyType.DENSITY]: 0.4 },
    harvestConfig: handsConfig(2, 1.0),
    uses: 2,
    regrowMs: 120_000,
    yieldPerUse: [1, 3],
    tags: ['flora', 'berry', 'food']
  },

  'res_fruit_amber': {
    id: 'res_fruit_amber',
    name: 'Amberfruit',
    type: ItemType.CONSUMABLE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 0.3,
    dimensions: { width: 1, height: 1 },
    icon: '🍑',
    visuals: { modelId: 'fruit', colorHex: '#f59e0b' },
    stats: { health_restore: 10 },
    materialProps: { [MaterialPropertyType.DENSITY]: 0.6 },
    harvestConfig: handsConfig(3, 1.5),
    uses: 2,
    regrowMs: 180_000,
    yieldPerUse: [1, 2],
    tags: ['flora', 'fruit', 'food']
  },

  'res_fruit_gallpod': {
    id: 'res_fruit_gallpod',
    name: 'Gallpod',
    description: 'Smells sweet. The error code is in the aftertaste.',
    type: ItemType.CONSUMABLE,
    rank: UniversalRank.E,
    rarity: Rarity.UNCOMMON,
    weight: 0.3,
    dimensions: { width: 1, height: 1 },
    icon: '🫐',
    visuals: { modelId: 'fruit', colorHex: '#7c3aed' },
    stats: { health_restore: -15 }, // poison-bearing; alchemy input later
    materialProps: { [MaterialPropertyType.DENSITY]: 0.6, [MaterialPropertyType.TOXICITY]: 8 },
    harvestConfig: handsConfig(3, 1.5),
    uses: 1,
    regrowMs: 240_000,
    yieldPerUse: [1, 2],
    tags: ['flora', 'fruit', 'poison']
  },

  'res_plant_fiber': {
    id: 'res_plant_fiber',
    name: 'Tough Fiber',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 0.1,
    dimensions: { width: 1, height: 1 },
    icon: '🌿',
    visuals: { modelId: 'fiber', colorHex: '#84cc16' },
    materialProps: { [MaterialPropertyType.DENSITY]: 0.2, [MaterialPropertyType.ELASTICITY]: 12 },
    harvestConfig: handsConfig(2, 1.0),
    uses: 1,
    regrowMs: 90_000,
    yieldPerUse: [1, 3],
    tags: ['flora', 'fiber']
  },

  'res_tree_log': {
    id: 'res_tree_log',
    name: 'Hardwood Log',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 5.0,
    dimensions: { width: 1, height: 3 },
    icon: '🪵',
    visuals: { modelId: 'log', colorHex: '#78350f' },
    materialProps: { [MaterialPropertyType.DENSITY]: 10, [MaterialPropertyType.HARDNESS]: 15 },
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['axe', 'saw', 'laser_cutter'],
      minToolPower: 5,
      energyCost: 8,
      baseTimeSeconds: 3.0
    },
    uses: 3,              // a tree gives three fellings of logs...
    yieldPerUse: [1, 2],
    tags: ['flora', 'wood']
  },

  'res_tree_sapling': {
    id: 'res_tree_sapling',
    name: 'Sapling',
    description: 'A future forest, if anyone lives long enough to plant it.',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.UNCOMMON,
    weight: 1.0,
    dimensions: { width: 1, height: 2 },
    icon: '🌱',
    visuals: { modelId: 'sapling', colorHex: '#22c55e' },
    materialProps: { [MaterialPropertyType.DENSITY]: 2 },
    harvestConfig: handsConfig(4, 2.0),
    uses: 1,
    regrowMs: 300_000,
    yieldPerUse: [1, 1],
    tags: ['flora', 'wood', 'seed']
  },

  // ==========================================================================
  // MINERALS — mining, sand, rocks and pebbles
  // ==========================================================================

  'res_pebbles': {
    id: 'res_pebbles',
    name: 'Pebbles',
    description: 'The minable portion of a rock, pre-mined by erosion.',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 0.5,
    dimensions: { width: 1, height: 1 },
    icon: '🪨',
    visuals: { modelId: 'pebble', colorHex: '#78716c' },
    materialProps: { [MaterialPropertyType.DENSITY]: 5, [MaterialPropertyType.HARDNESS]: 20 },
    harvestConfig: handsConfig(2, 0.5),
    uses: 1,
    yieldPerUse: [2, 5],
    tags: ['mineral', 'stone']
  },

  'res_sand': {
    id: 'res_sand',
    name: 'Silica Sand',
    description: 'Glass waiting for a furnace.',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 1.5,
    dimensions: { width: 1, height: 1 },
    icon: '⏳',
    visuals: { modelId: 'sand', colorHex: '#eab308' },
    materialProps: { [MaterialPropertyType.DENSITY]: 3, [MaterialPropertyType.CONDUCTIVITY]: 2 },
    harvestConfig: handsConfig(4, 2.0),
    uses: 2,
    yieldPerUse: [1, 3],
    tags: ['mineral', 'sand', 'glass']
  },

  'res_rock_small': {
    id: 'res_rock_small',
    name: 'Dense Stone',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 2.0,
    dimensions: { width: 1, height: 1 },
    icon: '🪨',
    visuals: { modelId: 'rock', colorHex: '#57534e' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 30 },
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['pickaxe', 'drill', 'impact_hammer'],
      minToolPower: 10,
      energyCost: 5,
      baseTimeSeconds: 2.0
    },
    uses: 2,
    yieldPerUse: [1, 2],
    tags: ['mineral', 'stone']
  },

  'res_iron_vein': {
    id: 'res_iron_vein',
    name: 'Iron Ore',
    type: ItemType.RESOURCE,
    rank: UniversalRank.E,
    rarity: Rarity.COMMON,
    weight: 4.0,
    dimensions: { width: 1, height: 1 },
    icon: '⛏️',
    visuals: { modelId: 'ore_vein', colorHex: '#9ca3af' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 45, [MaterialPropertyType.CONDUCTIVITY]: 20 },
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['pickaxe', 'drill', 'mining_laser'],
      minToolPower: 10,
      energyCost: 10,
      baseTimeSeconds: 3.0
    },
    uses: 4,              // a vein; runs dry, never regrows
    yieldPerUse: [1, 2],
    tags: ['mineral', 'ore', 'metal']
  },

  'res_titanium_vein': {
    id: 'res_titanium_vein',
    name: 'Titanium Deposit',
    type: ItemType.RESOURCE,
    rank: UniversalRank.C,
    rarity: Rarity.RARE,
    weight: 10.0,
    dimensions: { width: 2, height: 2 },
    icon: '⛓️',
    visuals: { modelId: 'ore_vein', colorHex: '#e5e7eb' },
    materialProps: { [MaterialPropertyType.DENSITY]: 20, [MaterialPropertyType.HARDNESS]: 80 },
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['pickaxe', 'mining_laser'],
      minToolPower: 50,
      energyCost: 20,
      baseTimeSeconds: 5.0
    },
    uses: 3,
    yieldPerUse: [1, 1],
    tags: ['mineral', 'ore', 'metal', 'rare']
  },

  'res_scrap_metal': {
    id: 'res_scrap_metal',
    name: 'Rusted Plate',
    type: ItemType.RESOURCE,
    rank: UniversalRank.E,
    rarity: Rarity.COMMON,
    weight: 3.5,
    dimensions: { width: 2, height: 2 },
    icon: '🔩',
    visuals: { modelId: 'scrap', colorHex: '#b45309' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 35, [MaterialPropertyType.CONDUCTIVITY]: 30 },
    harvestConfig: handsConfig(6, 2.0),
    uses: 1,
    yieldPerUse: [1, 2],
    tags: ['mineral', 'metal', 'salvage']
  },

  'res_glass_shards': {
    id: 'res_glass_shards',
    name: 'Glass Shards',
    type: ItemType.RESOURCE,
    rank: UniversalRank.F,
    rarity: Rarity.COMMON,
    weight: 0.5,
    dimensions: { width: 1, height: 1 },
    icon: '💎',
    visuals: { modelId: 'shard', colorHex: '#a5f3fc' },
    materialProps: { [MaterialPropertyType.DENSITY]: 4, [MaterialPropertyType.LUMINOSITY]: 5 },
    harvestConfig: handsConfig(2, 0.5),
    uses: 1,
    yieldPerUse: [1, 3],
    tags: ['mineral', 'glass', 'salvage']
  }
};

/** Biome spawn tables: which extractables grow where (Wave 2.2 placement). */
export const BIOME_RESOURCES: Record<string, string[]> = {
  WASTELAND:  ['res_pebbles', 'res_sand', 'res_scrap_metal', 'res_grain_wild'],
  OVERGROWTH: ['res_tree_log', 'res_tree_sapling', 'res_berry_bush', 'res_fruit_amber', 'res_fruit_gallpod', 'res_plant_fiber', 'res_grain_wild'],
  RUINS:      ['res_pebbles', 'res_rock_small', 'res_glass_shards', 'res_scrap_metal'],
  INDUSTRIAL: ['res_scrap_metal', 'res_iron_vein', 'res_glass_shards', 'res_sand'],
  CYBER_CITY: ['res_glass_shards', 'res_scrap_metal', 'res_titanium_vein', 'res_iron_vein']
};

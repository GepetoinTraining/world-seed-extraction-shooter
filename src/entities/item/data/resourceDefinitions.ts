import { UniversalRank, Rarity, ItemType, SlotType, IItem, IHarvestConfig } from '../../../../types';

// FIXED: Added IHarvestConfig to the type definition
type ResourceDef = Partial<IItem> & { 
  id: string; 
  name: string;
  harvestConfig?: IHarvestConfig; 
};

export const RESOURCE_DEFINITIONS: Record<string, ResourceDef> = {
  // --- FLORA ---
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
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['axe', 'saw', 'laser_cutter'], 
      minToolPower: 5,
      energyCost: 8,
      baseTimeSeconds: 3.0
    }
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
    visuals: { modelId: 'fiber', colorHex: '#84cc16' }
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
    stats: { health_restore: 5 }
  },
  
  // --- MINERALS ---
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
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['pickaxe', 'drill', 'impact_hammer'],
      minToolPower: 10,
      energyCost: 5,
      baseTimeSeconds: 2.0
    }
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
    visuals: { modelId: 'scrap', colorHex: '#b45309' }
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
    visuals: { modelId: 'shard', colorHex: '#a5f3fc' }
  },
  'res_titanium_vein': {
    id: 'res_titanium_vein',
    name: 'Titanium Deposit',
    type: ItemType.RESOURCE,
    rank: UniversalRank.C,
    weight: 10.0,
    dimensions: { width: 2, height: 2 },
    icon: '⛓️',
    visuals: { modelId: 'ore_vein', colorHex: '#e5e7eb' },
    harvestConfig: {
      interactionType: 'HARVEST',
      requiredToolTags: ['pickaxe', 'mining_laser'],
      minToolPower: 50,
      energyCost: 20,
      baseTimeSeconds: 5.0
    }
  }
};
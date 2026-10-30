/**
 * TRANSFORMATION RECIPES (Wave 5.2)
 *
 * The production chain starts here: raw extractables in, refined goods out.
 * Recipes run at a WORKSHOP on an OWNED lot, consume inputs up front, and
 * finish on the clock (accumulate/resolve: the job is timestamps; outputs
 * mint when someone looks).
 */

import { ITransformationRecipe, MaterialPropertyType } from '../types';
import { ResourceDef } from '../../item/data/resourceDefinitions';
import { ItemType, UniversalRank, Rarity } from '../../../../types';

export const RECIPE_DEFINITIONS: Record<string, ITransformationRecipe> = {
  'recipe_plank': {
    id: 'recipe_plank',
    name: 'Mill Planks',
    description: 'One log becomes two usable planks.',
    inputs: [{ itemId: 'res_tree_log', quantity: 1, consume: true }],
    outputs: [{ itemId: 'crf_plank', quantity: 2, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 10,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_carpentry',
    minSkillLevel: 0
  },
  'recipe_ingot': {
    id: 'recipe_ingot',
    name: 'Smelt Iron',
    description: 'Two ore make one honest ingot.',
    inputs: [{ itemId: 'res_iron_vein', quantity: 2, consume: true }],
    outputs: [{ itemId: 'crf_iron_ingot', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 15,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_smelting',
    minSkillLevel: 0
  },
  'recipe_cloth': {
    id: 'recipe_cloth',
    name: 'Weave Cloth',
    description: 'Three fibers, one bolt.',
    inputs: [{ itemId: 'res_plant_fiber', quantity: 3, consume: true }],
    outputs: [{ itemId: 'crf_cloth', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 10,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_weaving',
    minSkillLevel: 0
  },
  'recipe_glass': {
    id: 'recipe_glass',
    name: 'Fire Glass',
    description: 'Sand remembers being a window.',
    inputs: [{ itemId: 'res_sand', quantity: 2, consume: true }],
    outputs: [{ itemId: 'crf_glass', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 12,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_glassblowing',
    minSkillLevel: 0
  }
};

/** Crafted goods: minted via ItemFactory.createResourceItem like any resource. */
export const CRAFTED_DEFINITIONS: Record<string, ResourceDef> = {
  'crf_plank': {
    id: 'crf_plank', name: 'Cut Plank', type: ItemType.RESOURCE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 2.0, dimensions: { width: 1, height: 2 }, icon: '🪚',
    visuals: { modelId: 'plank', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 4, [MaterialPropertyType.HARDNESS]: 18 },
    tags: ['crafted', 'wood', 'building']
  },
  'crf_iron_ingot': {
    id: 'crf_iron_ingot', name: 'Iron Ingot', type: ItemType.RESOURCE,
    rank: UniversalRank.E, rarity: Rarity.COMMON,
    weight: 3.0, dimensions: { width: 1, height: 1 }, icon: '🧱',
    visuals: { modelId: 'ingot', colorHex: '#9ca3af' },
    materialProps: { [MaterialPropertyType.DENSITY]: 6, [MaterialPropertyType.HARDNESS]: 55, [MaterialPropertyType.CONDUCTIVITY]: 25 },
    tags: ['crafted', 'metal', 'building']
  },
  'crf_cloth': {
    id: 'crf_cloth', name: 'Woven Cloth', type: ItemType.RESOURCE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 0.3, dimensions: { width: 1, height: 1 }, icon: '🧵',
    visuals: { modelId: 'cloth', colorHex: '#e879f9' },
    materialProps: { [MaterialPropertyType.DENSITY]: 0.6, [MaterialPropertyType.ELASTICITY]: 20 },
    tags: ['crafted', 'cloth']
  },
  'crf_glass': {
    id: 'crf_glass', name: 'Glass Pane', type: ItemType.RESOURCE,
    rank: UniversalRank.F, rarity: Rarity.UNCOMMON,
    weight: 1.0, dimensions: { width: 1, height: 2 }, icon: '🪟',
    visuals: { modelId: 'glass', colorHex: '#a5f3fc' },
    materialProps: { [MaterialPropertyType.DENSITY]: 2, [MaterialPropertyType.LUMINOSITY]: 10 },
    tags: ['crafted', 'glass', 'building']
  }
};

/** Build costs in gold (paid to the hub treasury) and daily upkeep. */
export const STRUCTURE_COSTS: Record<'HOUSE' | 'WORKSHOP' | 'VENDOR', { build: number; upkeepPerDay: number }> = {
  HOUSE:    { build: 100, upkeepPerDay: 5 },
  WORKSHOP: { build: 150, upkeepPerDay: 10 },
  VENDOR:   { build: 250, upkeepPerDay: 15 }
};

/** The hub's cut of every player-shop sale. */
export const PLAYER_SHOP_TAX = 0.05;

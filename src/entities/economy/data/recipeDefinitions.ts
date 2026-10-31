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
  },
  // Wave 10 (D9): furniture is an item like any other. The first of the line:
  // plant the trees, mill the planks, build the tables, sell them.
  'recipe_table': {
    id: 'recipe_table',
    name: 'Join a Table',
    description: 'Three planks, one table. A workstation, a shelf, a thing to sell.',
    inputs: [{ itemId: 'crf_plank', quantity: 3, consume: true }],
    outputs: [{ itemId: 'stn_table', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 20,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_carpentry',
    minSkillLevel: 0
  },
  // Wave 10B (D14): paper and ink are the template economy's raw goods. Paper
  // is beaten from planks; the ink is iron gall, the oldest recipe there is.
  'recipe_paper': {
    id: 'recipe_paper',
    name: 'Press Paper',
    description: 'One plank beaten thin: two sheets that remember the tree.',
    inputs: [{ itemId: 'crf_plank', quantity: 1, consume: true }],
    outputs: [{ itemId: 'crf_paper', quantity: 2, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 8,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_carpentry',
    minSkillLevel: 0
  },
  'recipe_ink': {
    id: 'recipe_ink',
    name: 'Boil Iron Gall Ink',
    description: 'A gallpod and raw iron, boiled black. Everything signed is signed in this.',
    inputs: [
      { itemId: 'res_fruit_gallpod', quantity: 1, consume: true },
      { itemId: 'res_iron_vein', quantity: 1, consume: true }
    ],
    outputs: [{ itemId: 'crf_ink', quantity: 2, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 12,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_alchemy',
    minSkillLevel: 0
  },
  'recipe_scribe_table': {
    id: 'recipe_scribe_table',
    name: "Join a Scribe's Table",
    description: 'Two planks and a well of ink. Where plans, and one day scrolls, get written.',
    inputs: [
      { itemId: 'crf_plank', quantity: 2, consume: true },
      { itemId: 'crf_ink', quantity: 1, consume: true }
    ],
    outputs: [{ itemId: 'stn_scribe', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 20,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_carpentry',
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
  },

  // Wave 10 (D8/D9): stations are items. A WORKSHOP shell mints its bench and a
  // VENDOR shell mints its counter when construction completes; tables are
  // crafted, carried, placed and sold like anything else.
  'stn_bench': {
    id: 'stn_bench', name: 'Work Bench', type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 12.0, dimensions: { width: 2, height: 1 }, icon: '🔨',
    visuals: { modelId: 'bench', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 30 },
    tags: ['crafted', 'station', 'wood', 'heavy']
  },
  'stn_counter': {
    id: 'stn_counter', name: 'Shop Counter', type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 14.0, dimensions: { width: 3, height: 1 }, icon: '🪙',
    visuals: { modelId: 'counter', colorHex: '#ffd700' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 25 },
    tags: ['crafted', 'station', 'wood', 'heavy']
  },
  'stn_table': {
    id: 'stn_table', name: 'Joined Table', type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 8.0, dimensions: { width: 2, height: 2 }, icon: '🪑',
    visuals: { modelId: 'table', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 5, [MaterialPropertyType.HARDNESS]: 20 },
    tags: ['crafted', 'station', 'wood']
  },

  // Wave 10B (D12/D14): the writing economy. Paper and ink pay for every plan
  // minted or copied; the scribe's table is the generalist station it happens at.
  'crf_paper': {
    id: 'crf_paper', name: 'Pressed Paper', type: ItemType.RESOURCE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 0.2, dimensions: { width: 1, height: 1 }, icon: 'paper_icon',
    visuals: { modelId: 'paper', colorHex: '#e7e5e4' },
    materialProps: { [MaterialPropertyType.DENSITY]: 0.4, [MaterialPropertyType.ELASTICITY]: 8 },
    tags: ['crafted', 'paper']
  },
  'crf_ink': {
    id: 'crf_ink', name: 'Iron Gall Ink', type: ItemType.RESOURCE,
    rank: UniversalRank.F, rarity: Rarity.UNCOMMON,
    weight: 0.4, dimensions: { width: 1, height: 1 }, icon: 'ink_icon',
    visuals: { modelId: 'ink', colorHex: '#1c1917' },
    materialProps: { [MaterialPropertyType.DENSITY]: 1.2, [MaterialPropertyType.TOXICITY]: 6 },
    tags: ['crafted', 'ink']
  },
  'stn_scribe': {
    id: 'stn_scribe', name: "Scribe's Table", type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.UNCOMMON,
    weight: 9.0, dimensions: { width: 2, height: 1 }, icon: 'scribe_icon',
    visuals: { modelId: 'scribe', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 6, [MaterialPropertyType.HARDNESS]: 22 },
    tags: ['crafted', 'station', 'wood']
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

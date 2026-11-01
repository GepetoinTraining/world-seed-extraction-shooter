import { ITransformationRecipe, MaterialPropertyType } from '../../../src/entities/economy/types';
import { ResourceDef } from '../../../src/entities/item/data/resourceDefinitions';
import { IGearRecipe } from '../../../src/entities/economy/data/recipeDefinitions';
import { ItemType, UniversalRank, Rarity } from '../../../types';

export const TEST_RECIPES: Record<string, ITransformationRecipe> = {
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
  },
  // Wave 10D (10D.5): stone joins the building economy. Two dense stones cut
  // one honest block, and the block carries the 'building' tag — a wall at last.
  'recipe_masonry': {
    id: 'recipe_masonry',
    name: 'Cut Stone Block',
    description: 'Two stones squared into one. The oldest wall there is.',
    inputs: [{ itemId: 'res_rock_small', quantity: 2, consume: true }],
    outputs: [{ itemId: 'crf_stone_block', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 15,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_masonry',
    minSkillLevel: 0
  },
  // The raw materials leg (line 45): the sourcing audit found these raw materials
  // with no process of their own. Each now has one, and D26 gives each its pool.
  'recipe_straw_paper': {
    id: 'recipe_straw_paper',
    name: 'Press Straw Paper',
    description: 'Three heads of grain threshed and the stalks pressed. It takes ink, and it does not ask for a tree.',
    inputs: [{ itemId: 'res_grain_wild', quantity: 3, consume: true }],
    outputs: [{ itemId: 'crf_paper', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 8,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_carpentry',
    minSkillLevel: 0
  },
  'recipe_flint_glass': {
    id: 'recipe_flint_glass',
    name: 'Flux with Crushed Pebble',
    description: 'One sand and two crushed pebbles. Less sand, more patience, and the pane still holds.',
    inputs: [
      { itemId: 'res_sand', quantity: 1, consume: true },
      { itemId: 'res_pebbles', quantity: 2, consume: true }
    ],
    outputs: [{ itemId: 'crf_glass', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 14,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_glassblowing',
    minSkillLevel: 0
  },
  'recipe_shard_glass': {
    id: 'recipe_shard_glass',
    name: 'Melt Shards Whole',
    description: "Three shards of somebody's window, melted back into one of yours.",
    inputs: [{ itemId: 'res_glass_shards', quantity: 3, consume: true }],
    outputs: [{ itemId: 'crf_glass', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 10,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_glassblowing',
    minSkillLevel: 0
  },
  'recipe_scrap_ingot': {
    id: 'recipe_scrap_ingot',
    name: 'Melt Down Scrap',
    description: 'Two rusted plates burn off what they were, and leave one ingot.',
    inputs: [{ itemId: 'res_scrap_metal', quantity: 2, consume: true }],
    outputs: [{ itemId: 'crf_iron_ingot', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 15,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_smelting',
    minSkillLevel: 0
  },
  'recipe_titanium_bar': {
    id: 'recipe_titanium_bar',
    name: 'Draw a Titanium Bar',
    description: 'Two deposits, a long fire, one bar. The vein goes down; nobody asks what it is a vein of.',
    inputs: [{ itemId: 'res_titanium_vein', quantity: 2, consume: true }],
    outputs: [{ itemId: 'crf_titanium_bar', quantity: 1, probability: 1.0 }],
    energyCost: 0,
    laborTimeSeconds: 40,
    requiredFacility: 'WORKSHOP',
    requiredSkill: 'skill_smelting',
    minSkillLevel: 0
  }
};

export const TEST_GEAR_RECIPES: Record<string, IGearRecipe> = {
  'improv_club': {
    id: 'improv_club',
    name: 'Lash Stone to Haft',
    description: 'A stone, a length of hardwood, and no apology. The crudest thing the bank will sign.',
    inputs: [
      { itemId: 'res_rock_small', quantity: 1 },
      { itemId: 'res_tree_log', quantity: 1 }
    ],
    outputBase: 'wpn_improvised_club',
    laborTimeSeconds: 5,
    requiredFacility: null
  },
  'recipe_iron_maul': {
    id: 'recipe_iron_maul',
    name: 'Hang an Iron Head',
    description: 'Two planks shaped to a haft, an ingot hung as the head. The chain shows in the swing.',
    inputs: [
      { itemId: 'crf_plank', quantity: 2 },
      { itemId: 'crf_iron_ingot', quantity: 1 }
    ],
    outputBase: 'wpn_iron_maul_t1',
    laborTimeSeconds: 30,
    requiredFacility: 'WORKSHOP'
  },
  // Wave 10E (D6's crafting half): a rank S making — the maker names the thing.
  // The chain is long on purpose: three ingots drawn to a blade, planks for the
  // grip, cloth to wrap it — the depth IS the budget, and the name is earned.
  'recipe_masterwork_blade': {
    id: 'recipe_masterwork_blade',
    name: 'Draw a Masterwork Blade',
    description: 'Three ingots drawn long, a plank grip, a cloth wrap. Rank S work: the maker writes the name, and the bank signs it.',
    inputs: [
      { itemId: 'crf_iron_ingot', quantity: 3 },
      { itemId: 'crf_plank', quantity: 1 },
      { itemId: 'crf_cloth', quantity: 1 }
    ],
    outputBase: 'wpn_masterwork_blade',
    laborTimeSeconds: 120,
    requiredFacility: 'WORKSHOP'
  }
};

/** Crafted goods: minted via ItemFactory.createResourceItem like any resource. */
export const TEST_CRAFTED: Record<string, ResourceDef> = {
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
  },

  // Wave 10D (10D.5): masonry. Stone finally answers a building bill.
  'crf_stone_block': {
    id: 'crf_stone_block', name: 'Cut Stone Block', type: ItemType.RESOURCE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 4.5, dimensions: { width: 1, height: 1 }, icon: 'stone_icon',
    visuals: { modelId: 'stone_block', colorHex: '#78716c' },
    materialProps: { [MaterialPropertyType.DENSITY]: 9, [MaterialPropertyType.HARDNESS]: 40 },
    tags: ['crafted', 'stone', 'building']
  },

  // The raw materials leg (line 45): titanium gets a process, and the rank and
  // rarity it carries open the deep pools (D26).
  'crf_titanium_bar': {
    id: 'crf_titanium_bar', name: 'Titanium Bar', type: ItemType.RESOURCE,
    rank: UniversalRank.C, rarity: Rarity.RARE,
    weight: 9.0, dimensions: { width: 1, height: 2 }, icon: 'titanium_icon',
    visuals: { modelId: 'ingot', colorHex: '#e5e7eb' },
    materialProps: { [MaterialPropertyType.DENSITY]: 18, [MaterialPropertyType.HARDNESS]: 90 },
    tags: ['crafted', 'metal', 'building']
  }
};

// D27: what the web's batches add joins this table as data, with no code change.

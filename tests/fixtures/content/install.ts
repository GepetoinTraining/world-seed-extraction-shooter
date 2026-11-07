/**
 * THE TEST CONTENT: what the game shipped with until D53 said "that was a test".
 *
 * It no longer ships. It lives here so the bars that pin behaviour keep their
 * ground: the same 9 creatures, tables and batches, installed into the same
 * shared records a theme fills in the game. Nothing under `src` may import this.
 */

import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { ITEM_DEFINITIONS, CRAFTED_GEAR_BASES } from '../../../shared/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS, BIOME_RESOURCES } from '../../../shared/entities/item/data/resourceDefinitions';
import { AFFIX_DEFINITIONS } from '../../../shared/entities/item/data/affixDefinitions';
import { AFFIX_BATCHES } from '../../../shared/entities/generation/packs/affixBatches';
import { WEB_BATCHES } from '../../../shared/entities/generation/packs/webBatches';
import { RECIPE_DEFINITIONS, GEAR_RECIPES, CRAFTED_DEFINITIONS, absorbWebBatch } from '../../../shared/entities/economy/data/recipeDefinitions';
import { registerCompositionDefs } from '../../../shared/logic/economy/CompositionSystem';
import { LORE_FRAGMENTS } from '../../../src/entities/lore/LoreBible';
import { SHELF } from '../../../shared/logic/theme/shelf';
import { TEST_MOBS } from './mobs';
import { TEST_ITEM_DEFINITIONS, TEST_CRAFTED_GEAR_BASES } from './items';
import { TEST_RESOURCES, TEST_BIOME_RESOURCES } from './resources';
import { TEST_AFFIX_DEFINITIONS } from './affixes';
import { TEST_AFFIX_BATCHES } from './affixBatches';
import { TEST_WEB_BATCH } from './webBatch';
import { TEST_RECIPES, TEST_GEAR_RECIPES, TEST_CRAFTED } from './recipes';
import { TEST_LORE } from './lore';

export function installTestContent(): void {
  if (WEB_BATCHES.some(b => b.runId === TEST_WEB_BATCH.runId)) return;
  Object.assign(MOB_DEFINITIONS, TEST_MOBS);
  ITEM_DEFINITIONS.weapon_bases.push(...TEST_ITEM_DEFINITIONS.weapon_bases);
  ITEM_DEFINITIONS.armor_bases.push(...TEST_ITEM_DEFINITIONS.armor_bases);
  ITEM_DEFINITIONS.tool_bases.push(...TEST_ITEM_DEFINITIONS.tool_bases);
  CRAFTED_GEAR_BASES.push(...TEST_CRAFTED_GEAR_BASES);
  Object.assign(RESOURCE_DEFINITIONS, TEST_RESOURCES);
  Object.assign(BIOME_RESOURCES, TEST_BIOME_RESOURCES);
  AFFIX_DEFINITIONS.prefixes.push(...TEST_AFFIX_DEFINITIONS.prefixes);
  AFFIX_DEFINITIONS.suffixes.push(...TEST_AFFIX_DEFINITIONS.suffixes);
  AFFIX_BATCHES.push(...TEST_AFFIX_BATCHES);
  Object.assign(RECIPE_DEFINITIONS, TEST_RECIPES);
  Object.assign(GEAR_RECIPES, TEST_GEAR_RECIPES);
  Object.assign(CRAFTED_DEFINITIONS, TEST_CRAFTED);
  WEB_BATCHES.push(TEST_WEB_BATCH);
  absorbWebBatch(TEST_WEB_BATCH);
  registerCompositionDefs(RESOURCE_DEFINITIONS);
  LORE_FRAGMENTS.push(...TEST_LORE);
  SHELF.tools.push('tool_axe_field_t1', 'tool_pick_rusty_t1', 'tool_pick_tempered_t3');
  SHELF.carrier.push('cart_field_t1', 'pouch_vial_t1', 'pouch_scroll_t1');
  SHELF.wardrobe.push(
    'arm_legs_padded_t1', 'arm_shoulder_t1', 'eye_glasses_t1', 'acc_necklace_t1',
    'acc_earring_t1', 'acc_ring_signet_t1', 'quiver_hide_t1', 'bag_satchel_t1', 'belt_canvas_t1', 'arm_boots_generic_t1'
  );
  SHELF.consumables.push('res_berry_bush', 'res_fruit_amber', 'res_fruit_gallpod');
}

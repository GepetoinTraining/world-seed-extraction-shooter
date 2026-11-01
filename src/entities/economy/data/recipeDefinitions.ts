/**
 * TRANSFORMATION RECIPES (Wave 5.2)
 *
 * The production chain starts here: raw extractables in, refined goods out.
 * Recipes run at a WORKSHOP on an OWNED lot, consume inputs up front, and
 * finish on the clock (accumulate/resolve: the job is timestamps; outputs
 * mint when someone looks).
 */

import { ITransformationRecipe } from '../types';
import { ResourceDef } from '../../item/data/resourceDefinitions';
import { IWebBatch, ItemType, UniversalRank, Rarity } from '../../../../types';
import { registerCompositionDefs } from '../../../logic/economy/CompositionSystem';

/** What the installed themes let a bench make (D53). Empty until one is installed. */
export const RECIPE_DEFINITIONS: Record<string, ITransformationRecipe> = {};

/**
 * Wave 10D (10D.2): recipes whose output is GEAR, minted with its chain as its
 * power budget. requiredFacility null = IMPROVISED: no bench, anywhere,
 * including the field — the deliberate floor of the whole item system.
 */
export interface IGearRecipe {
  id: string;
  name: string;
  description: string;
  inputs: { itemId: string; quantity: number }[];
  outputBase: string;            // an id in CRAFTED_GEAR_BASES
  laborTimeSeconds: number;
  requiredFacility: string | null;
}

export const GEAR_RECIPES: Record<string, IGearRecipe> = {};

/** Goods and stations from every installed theme: minted like any resource. */
export const CRAFTED_DEFINITIONS: Record<string, ResourceDef> = {};

/** Recipes stay in the web's own pack: they stand at further stations, not at every bench. */
export function absorbWebBatch(batch: IWebBatch): void {
  for (const good of [...(batch.materials ?? []), ...(batch.goods ?? [])]) {
    CRAFTED_DEFINITIONS[good.id] = {
      id: good.id, name: good.name, description: good.description,
      type: good.type ?? ItemType.RESOURCE, rank: good.rank, rarity: good.rarity,
      weight: good.weight, dimensions: { width: good.width ?? 1, height: good.height ?? 1 },
      icon: `${good.id}_icon`, visuals: { modelId: good.id, colorHex: '#9ca3af' },
      stats: good.stats, tags: good.tags
    };
  }
  for (const station of batch.stations ?? []) {
    CRAFTED_DEFINITIONS[station.id] = {
      id: station.id, name: station.name, description: station.description,
      type: ItemType.STRUCTURE, rank: UniversalRank.F, rarity: Rarity.UNCOMMON,
      weight: station.weight, dimensions: { width: station.width, height: station.height },
      icon: `${station.id}_icon`, visuals: { modelId: station.id, colorHex: '#a16207' },
      tags: ['crafted', 'station'],
      stationMinArea: station.minArea, stationFunction: 'WORKSHOP'
    };
  }
  // Wave 10D: crafted goods price through the composition law like any atom.
  registerCompositionDefs(CRAFTED_DEFINITIONS);
}

/** Build costs in gold (paid to the hub treasury) and daily upkeep. */
export const STRUCTURE_COSTS: Record<'HOUSE' | 'WORKSHOP' | 'VENDOR' | 'FARM', { build: number; upkeepPerDay: number }> = {
  HOUSE:    { build: 100, upkeepPerDay: 5 },
  WORKSHOP: { build: 150, upkeepPerDay: 10 },
  VENDOR:   { build: 250, upkeepPerDay: 15 },
  // A guess until Wave 12: the same as empty ground. A plot is ploughed land, with nothing raised on it.
  FARM:     { build: 0, upkeepPerDay: 5 }
};

/** The hub's cut of every player-shop sale. */
export const PLAYER_SHOP_TAX = 0.05;

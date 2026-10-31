/**
 * IMPROVISED CRAFTING (Wave 10D.2 — the floor, on purpose)
 *
 * A stone and a stick combine with NO bench and NO processing into the crudest
 * item the game can make — anywhere, including the field. The chain is the
 * power budget, and this is depth one of it: the deliberate floor every longer
 * route is measured against.
 *
 * Pure: takes a recipe id and the items in reach, returns the mint or the
 * refusal in voice. The caller moves the items and signs the record.
 */

import { IItem } from '../../../types';
import { GEAR_RECIPES, CRAFTED_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { ItemFactory } from '../../entities/item/ItemFactory';
import { CompositionSystem } from '../economy/CompositionSystem';
import { Rng } from '../rng/DeterministicRNG';

export interface IImproviseResult {
  ok: boolean;
  reason?: string;
  item?: IItem;
  consumedIds: string[];
}

const defName = (defId: string): string =>
  RESOURCE_DEFINITIONS[defId]?.name ?? CRAFTED_DEFINITIONS[defId]?.name ?? defId;

export function improvise(recipeId: string, inReach: IItem[], rngKey: string): IImproviseResult {
  const recipe = GEAR_RECIPES[recipeId];
  if (!recipe) return { ok: false, reason: 'The bank knows no such making.', consumedIds: [] };
  if (recipe.requiredFacility !== null) {
    return { ok: false, reason: `${recipe.name} asks for a ${recipe.requiredFacility}. Hands are not enough.`, consumedIds: [] };
  }

  // pick the bill from what is in reach, never the same item twice
  const picked: IItem[] = [];
  const taken = new Set<string>();
  for (const req of recipe.inputs) {
    let need = req.quantity;
    for (const item of inReach) {
      if (need <= 0) break;
      if (item.universalDefinitionId === req.itemId && !taken.has(item.id)) {
        picked.push(item); taken.add(item.id); need--;
      }
    }
    if (need > 0) {
      return { ok: false, reason: `Refused: no ${defName(req.itemId)} in reach.`, consumedIds: [] };
    }
  }

  const composition = CompositionSystem.compose(
    { recipeId: recipe.id, name: recipe.name, laborSeconds: recipe.laborTimeSeconds, facility: null },
    picked.map(i => i.composition ?? CompositionSystem.root({ id: i.universalDefinitionId, name: i.name }, 'IMPROVISATION')),
    1
  );

  // Wave 10E (D6's crafting half): the components' affixes ride onto what they make
  const item = ItemFactory.createComposedItem(recipe.outputBase, composition, Rng.fromKey(rngKey), {
    inheritedAffixes: picked.flatMap(i => i.affixes ?? [])
  });
  if (!item) return { ok: false, reason: 'The pattern is known but the shape is not.', consumedIds: [] };

  return { ok: true, item, consumedIds: picked.map(i => i.id) };
}

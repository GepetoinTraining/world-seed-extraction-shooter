/**
 * SALVAGE: what a thing comes apart into. The word is the one the game already uses for
 * taking a built piece down (Wave 10D.5), and the same bite applies: what comes back has
 * been through it.
 *
 * A thing with a chain gives back some of what its chain says, and a small thing may give
 * back nothing: it is lost in the taking apart. A raw thing is already a component.
 * A thing rolled with no chain comes apart into what the world holds, keyed by the piece,
 * and worth less than it was, so nobody can stand between a counter and a shelf for gold.
 * No table: the pool is read from the live definitions. Pure and keyed.
 */

import { IItem, ItemType } from '../../../types';
import { CRAFTED_DEFINITIONS, GEAR_RECIPES, RECIPE_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { ItemFactory } from '../../entities/item/ItemFactory';
import { CompositionSystem } from '../economy/CompositionSystem';
import { Anchors } from '../economy/Anchors';
import { Rng } from '../rng/DeterministicRNG';
import { IVendorRecipe, IWorkTools } from './VendorSystem';

/** The same bite a wall takes coming down, and the same floor. Guesses until Wave 12. */
const SALVAGE_BITE = -0.1;
const SALVAGE_FLOOR = -0.2;
/** What a rolled piece's components come to, at most, against what it was worth. */
const ROLLED_SHARE = 0.5;
/**
 * What comes back of a chain's atoms. Under one, so making and salvaging in a circle only
 * ever shrinks: a chain's count can be a fraction (one log, two planks), and a whole number
 * of anything is drawn from it by a keyed roll, never rounded up into material from nothing.
 */
const CHAIN_KEEP = 0.75;

const defOf = (id: string): ResourceDef | undefined => RESOURCE_DEFINITIONS[id] ?? CRAFTED_DEFINITIONS[id];

const mint = (def: ResourceDef, key: string, quality = SALVAGE_BITE): IItem =>
  ItemFactory.createResourceItem(def, Rng.fromKey(key), { origin: 'SALVAGE', quality: Math.max(SALVAGE_FLOOR, quality) });

const mintEach = (lines: { def: ResourceDef; count: number }[], key: string, quality?: number): IItem[] =>
  lines.flatMap(({ def, count }) => Array.from({ length: count }, (_, i) => mint(def, `${key}:${def.id}:${i}`, quality)));

/** What the ground gives up to a tool: something a rolled piece could have been made of. */
const hardGoods = (): ResourceDef[] =>
  Object.values(RESOURCE_DEFINITIONS)
    .filter(d => d.type !== ItemType.CONSUMABLE && !d.rareFind && (d.harvestConfig?.minToolPower ?? 0) > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

export const SalvageSystem = {
  /** What it comes apart into. Null if it cannot be taken apart at all. */
  components(item: IItem, key: string): IItem[] | null {
    // A deed, a map, a plan or a bond is a standing, not material. It stays whole, and the shelf can hold it.
    if (item.worldDeedData || item.deedData || item.mapData || item.bondData || item.creatureData || item.tags?.includes('template')) return null;
    // D115: what holds value is kept whole, or it holds nothing.
    if (Anchors.isAnchor(item)) return null;
    const full = `${key}:${item.id}`;
    const composition = item.composition;
    const quality = (item.quality ?? 0) + SALVAGE_BITE;

    if (composition && composition.depth > 0) {
      return mintEach(composition.materials.flatMap(m => {
        const def = defOf(m.defId);
        const kept = m.count * CHAIN_KEEP;
        const count = Math.floor(kept) + (Rng.fromKey(`${full}:keep:${m.defId}`).next() < kept - Math.floor(kept) ? 1 : 0);
        return def && count > 0 ? [{ def, count }] : [];
      }), full, quality);
    }
    if (defOf(item.universalDefinitionId)) return [item];

    const recipe = Object.values(GEAR_RECIPES).find(r => r.outputBase === item.universalDefinitionId);
    if (recipe) {
      return mintEach(recipe.inputs.flatMap(input => {
        const def = defOf(input.itemId);
        return def ? [{ def, count: input.quantity }] : [];
      }), full, quality);
    }

    const worth = (item.value || 0) * ROLLED_SHARE;
    const pool = hardGoods().filter(d => mint(d, `${full}:worth`).value <= worth);
    if (pool.length === 0) return null;
    const def = pool[Rng.fromKey(`${full}:pick`).int(0, pool.length)];
    return mintEach([{ def, count: Math.max(1, Math.floor(worth / mint(def, `${full}:worth`).value)) }], full);
  }
};

/** Everything a bench in this game can make, as a vendor reads it. New content arrives here with no code. */
export function vendorRecipes(): IVendorRecipe[] {
  const plain = Object.values(RECIPE_DEFINITIONS).map(r => ({
    id: r.id, name: r.name, output: r.outputs[0]?.itemId ?? '',
    inputs: r.inputs.filter(i => i.consume).map(i => ({ itemId: i.itemId, quantity: i.quantity }))
  }));
  const gear = Object.values(GEAR_RECIPES).map(r => ({ id: r.id, name: r.name, output: r.outputBase, inputs: r.inputs }));
  return [...plain, ...gear].sort((a, b) => a.id.localeCompare(b.id));
}

const compositionsOf = (consumed: IItem[]) =>
  consumed.map(i => i.composition ?? CompositionSystem.root({ id: i.universalDefinitionId, name: i.name }, 'HARVEST'));

function make(recipe: IVendorRecipe, consumed: IItem[], key: string): IItem[] {
  const plain = RECIPE_DEFINITIONS[recipe.id];
  if (plain) {
    const composition = CompositionSystem.compose(
      { recipeId: plain.id, name: plain.name, laborSeconds: plain.laborTimeSeconds, facility: plain.requiredFacility },
      compositionsOf(consumed), plain.outputs.reduce((n, o) => n + o.quantity, 0)
    );
    return plain.outputs.flatMap((out, oi) => {
      const def = CRAFTED_DEFINITIONS[out.itemId];
      const rng = Rng.fromKey(`${key}:out:${oi}`);
      if (!def || rng.next() > out.probability) return [];
      return Array.from({ length: out.quantity }, () => ({
        ...ItemFactory.createResourceItem(def, rng), composition, value: CompositionSystem.priceOf(composition)
      }));
    });
  }
  const gear = GEAR_RECIPES[recipe.id];
  if (!gear) return [];
  const composition = CompositionSystem.compose(
    { recipeId: gear.id, name: gear.name, laborSeconds: gear.laborTimeSeconds, facility: gear.requiredFacility },
    compositionsOf(consumed), 1
  );
  const item = ItemFactory.createComposedItem(gear.outputBase, composition, Rng.fromKey(`${key}:gear`));
  return item ? [item] : [];
}

export const workTools = (): IWorkTools => ({ recipes: vendorRecipes(), salvage: SalvageSystem.components, make });

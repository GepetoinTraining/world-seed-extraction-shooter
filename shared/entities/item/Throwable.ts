/**
 * A STONE TO THROW (Pedro, 2026-11-10: "we should add the ability to pick up pebbles and equip
 * them"). A blade never closes on something that holds off and backs away, so the ground itself
 * gives a hand something to reach it with.
 *
 * What can be thrown is whatever a world wrote in the pebble form: no table of stones here, and
 * a world with other loose stones has other things to throw. It is picked up by hand, taken in
 * either hand, and spent by the throw. It lands by how hard the stone is. A guess until Wave 12,
 * like every number in a fight.
 */

import { IItem, ItemType } from '../../types';
import { MaterialPropertyType } from '../economy/types';
import { RESOURCE_DEFINITIONS } from './data/resourceDefinitions';

/** The form a world writes a loose stone in (`MATERIAL_FORMS`). The compiled definition keeps it as its shape. */
const LOOSE_STONE = 'pebble';
/** What a bare hand lands for, and how much of a stone's hardness a throw adds to it. */
const BARE_THROW = 5;
const HARDNESS_SHARE = 0.5;

type Shaped = { visuals?: { modelId?: string }; materialProps?: Partial<Record<MaterialPropertyType, number>> };
const definitionOf = (item: IItem | undefined): Shaped | undefined =>
  (item ? RESOURCE_DEFINITIONS[item.universalDefinitionId] as Shaped | undefined : undefined);

/** Is this kind of thing a loose stone, lying where a hand can take it? */
export const isLooseStone = (definition: Shaped | undefined): boolean => definition?.visuals?.modelId === LOOSE_STONE;

/** Can a hand throw this? A stone that has not been read is not known to be one. */
export function isThrowable(item: IItem | undefined): boolean {
  return !!item && item.type === ItemType.RESOURCE && item.isIdentified !== false && isLooseStone(definitionOf(item));
}

/** What one throw lands for, before who throws it and what they wear are counted. */
export function thrownDamage(item: IItem): number {
  const hardness = definitionOf(item)?.materialProps?.[MaterialPropertyType.HARDNESS] ?? 0;
  return BARE_THROW + Math.round(hardness * HARDNESS_SHARE);
}

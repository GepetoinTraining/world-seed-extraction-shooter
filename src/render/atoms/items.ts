/**
 * One rule for what an item looks like (Wave 9.4): its real art at its real
 * footprint, from the same numbers that decide its physics. Resources draw
 * from their material properties; gear proposes a profile from its tags.
 * Wave 10B: a template's art is its composed plan — real atoms, never an icon.
 */

import { IItem, ItemType } from '../../../types';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { Sprite, gearMaterial, hashBytes, itemArt, materialFromProps } from './atoms';
import { templateThumb } from './room';

const encoder = new TextEncoder();

export function itemArtFor(item: IItem): Sprite {
  // Wave 10B: a building plan shows the plan itself, through the composer.
  const templateData = (item as any).templateData;
  if (item.type === ItemType.TEMPLATE && templateData) {
    return templateThumb(templateData, item.dimensions ?? { width: 2, height: 2 });
  }
  const def = RESOURCE_DEFINITIONS[item.universalDefinitionId] as any;
  const material = def?.materialProps ? materialFromProps(def.materialProps) : gearMaterial(item.tags || []);
  return itemArt({
    wCells: item.dimensions?.width || 1,
    hCells: item.dimensions?.height || 1,
    tags: item.tags || [],
    material,
    rarity: String(item.rarity),
    rank: String(item.rank),
    quality: (item as any).quality,
    durability: item.stats?.durability,
    maxDurability: item.stats?.maxDurability,
    identified: item.isIdentified,
    seed: hashBytes(encoder.encode(item.id))
  });
}

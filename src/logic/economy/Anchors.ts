/**
 * ANCHORS (D115): gems, works of art and valuables found in worlds. Pedro: "we need to find
 * gems/works of art/valuable in the worlds that act as money anchors".
 *
 * An anchor's worth is set when its theme is written, and nothing in the game reads coin to
 * change it. It is not taken apart, so it stays what it is. A person can ask for one in place
 * of coin, so it can be coin without anyone in the code deciding that it is (a lot's shelf,
 * in the hub's store). Pure and keyed. No person is told to prefer one.
 */

import { IItem, UniversalRank } from '../../../shared/types';
import { RANK_ORDER } from '../../../shared/entities/player/systems/ProgressionSystem';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../../../shared/entities/item/ItemFactory';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { ANCHOR_CHANCE } from '../../../shared/logic/theme/ThemeFormula';

const rankAt = (rank: string | undefined) => RANK_ORDER.indexOf(rank as UniversalRank);

export const Anchors = {
  isAnchor(item: Pick<IItem, 'universalDefinitionId'>): boolean {
    return !!RESOURCE_DEFINITIONS[item.universalDefinitionId]?.anchor;
  },

  /**
   * What a chest in this world, on this ground, could hold. Only the world's own theme, so a
   * later printing never reaches a pinned world, and nothing above the chest's own rank, so
   * an anchor is no way around the Hall's trial.
   */
  foundIn(themeId: string | undefined, biome: string | undefined, chestRank: UniversalRank | string): string[] {
    if (!themeId || !biome) return [];
    return Object.values(RESOURCE_DEFINITIONS)
      .filter(d => d.anchor && d.themeId === themeId && d.foundIn?.includes(biome) && rankAt(d.rank) <= rankAt(chestRank))
      .map(d => d.id)
      .sort();
  },

  /** Its own stream off the chest's key, so nothing else in the chest moves. */
  fromChest(ids: string[], rollKey: string): IItem | null {
    if (ids.length === 0) return null;
    const rng = Rng.fromKey(`${rollKey}:anchor`);
    if (rng.next() >= ANCHOR_CHANCE) return null;
    return ItemFactory.createResourceItem(RESOURCE_DEFINITIONS[ids[rng.int(0, ids.length)]], rng);
  },

  /** Every kind a person might ask for, by name. */
  kinds(): { defId: string; name: string }[] {
    return Object.values(RESOURCE_DEFINITIONS)
      .filter(d => d.anchor)
      .map(d => ({ defId: d.id, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.defId.localeCompare(b.defId));
  }
};

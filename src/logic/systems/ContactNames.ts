/**
 * WHAT A THING IN THE FIELD IS CALLED, by someone who knows this much of it. One law, so the
 * card in the field and the list a scan gives name a thing the same way, and neither ever
 * shows an id.
 *
 * A creature gives only the name it has earned (D60). A thing to gather reads by its name once
 * the reader knows it at all, and as an unknown substance until then. A person gives their name
 * where the world has dealt them one.
 */

import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';

export const UNKNOWN_CONTACT = 'Unknown Contact';
export const UNKNOWN_SUBSTANCE = 'Unknown Substance';
export const UNKNOWN_FIGURE = 'Unknown Figure';

/** One of a kind, then more than one. A kind nobody has named here reads in lower case, as it is. */
const KIND_WORDS: Record<string, [string, string]> = {
  [EntityType.MOB]: ['creature', 'creatures'],
  [EntityType.NPC]: ['person', 'people'],
  [EntityType.RESOURCE]: ['thing to gather', 'things to gather'],
  [EntityType.STRUCTURE]: ['structure', 'structures'],
  [EntityType.CONTAINER]: ['chest', 'chests'],
  [EntityType.EXTRACTION]: ['exit', 'exits'],
  [EntityType.CART]: ['cart', 'carts']
};

export const ContactNames = {
  /** `level` answers how well the reader knows a definition: 0 is not at all. */
  of(e: IWorldEntity, level: (definitionId: string) => number): string {
    switch (e.type) {
      case EntityType.MOB:
        return e.displayName || UNKNOWN_CONTACT;
      case EntityType.RESOURCE:
        return level(e.definitionId) <= 0 ? UNKNOWN_SUBSTANCE : RESOURCE_DEFINITIONS[e.definitionId]?.name ?? UNKNOWN_SUBSTANCE;
      case EntityType.NPC:
        return e.npc?.name || UNKNOWN_FIGURE;
      case EntityType.CONTAINER:
        return e.definitionId === 'ground_cache' ? 'Ground Cache' : e.definitionId === 'struct_store' ? 'Store' : 'Chest';
      case EntityType.EXTRACTION:
        return 'Exit';
      case EntityType.STRUCTURE:
        if (!e.structure) return 'Ruin';
        return e.structure.built ? `${e.structure.fn[0].toUpperCase()}${e.structure.fn.slice(1)}` : 'Scaffolding';
      case EntityType.CART:
        return e.cart ? `${e.cart.ownerName}'s Cart` : 'Cart';
      default:
        return 'Unknown';
    }
  },

  /**
   * What a scan from above can call it. The same as the card's name, except for a person: a card is
   * read standing in front of them, and a drone has met nobody, so a person reads as an unknown
   * figure until they have been talked to. (It also keeps fifty strangers from being fifty lines.)
   */
  fromAbove(e: IWorldEntity, level: (definitionId: string) => number): string {
    if (e.type === EntityType.NPC && !((e.npc?.attempts ?? 0) > 0)) return UNKNOWN_FIGURE;
    return this.of(e, level);
  },

  /** A count of one kind of thing, in plain words: "1197 creatures", "1 person". */
  counted(type: string, count: number): string {
    const words = KIND_WORDS[type];
    return `${count} ${words ? words[count === 1 ? 0 : 1] : type.toLowerCase().replace(/_/g, ' ')}`;
  }
};

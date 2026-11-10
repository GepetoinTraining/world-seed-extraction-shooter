/**
 * WHAT A THING IN THE FIELD IS CALLED, by someone who knows this much of it. One law, so the
 * card in the field, the talk's prompt and the list a scan gives name a thing the same way, and
 * none of them ever shows an id.
 *
 * A creature gives only the name it has earned (D60). A thing to gather reads by its name once
 * the reader knows it at all, and as an unknown substance until then.
 *
 * A person has no name until it is asked (Pedro, 2026-11-10: "if you never ask someone's name,
 * they don't have one, they're just a random person doing something. a player only knows WHAT
 * they study or interact with"). So a person is an unknown figure to a character who has not
 * been told their name, and the name is told in a talk, or when they agree to come along.
 */

import { IPlayer } from '../../../shared/types';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';

export const UNKNOWN_CONTACT = 'Unknown Contact';
export const UNKNOWN_SUBSTANCE = 'Unknown Substance';
export const UNKNOWN_FIGURE = 'Unknown Figure';

/** Whoever is reading: all that is asked of them is which names they have been told. */
type NameReader = Pick<IPlayer, 'namesKnown'>;

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

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const ContactNames = {
  /**
   * `level` answers how well the reader knows a definition: 0 is not at all. `reader` is whose
   * knowledge of names counts; with nobody reading, nobody is named.
   */
  of(e: IWorldEntity, level: (definitionId: string) => number, reader?: NameReader): string {
    switch (e.type) {
      case EntityType.MOB:
        return e.displayName || UNKNOWN_CONTACT;
      case EntityType.RESOURCE:
        return level(e.definitionId) <= 0 ? UNKNOWN_SUBSTANCE : RESOURCE_DEFINITIONS[e.definitionId]?.name ?? UNKNOWN_SUBSTANCE;
      case EntityType.NPC:
        return this.personName(e, reader);
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
   * Who a person is to whoever knows them: their body in a world, and the name that world dealt
   * them. Two worlds can deal the same body id, and they will not deal it the same name.
   */
  personKey(e: Pick<IWorldEntity, 'id' | 'npc'>): string {
    return `${e.id}:${e.npc?.name ?? ''}`;
  },

  knowsName(reader: NameReader | undefined, e: Pick<IWorldEntity, 'id' | 'npc'>): boolean {
    return !!e.npc?.name && !!reader?.namesKnown?.[this.personKey(e)];
  },

  /** A person's name as this reader may say it. */
  personName(e: Pick<IWorldEntity, 'id' | 'npc'>, reader?: NameReader): string {
    return this.knowsName(reader, e) ? e.npc!.name : UNKNOWN_FIGURE;
  },

  /** The character has been told this person's name. Nothing changes for one who already knew it. */
  learnName<T extends NameReader>(reader: T, e: Pick<IWorldEntity, 'id' | 'npc'>): T {
    if (!e.npc?.name || this.knowsName(reader, e)) return reader;
    return { ...reader, namesKnown: { ...reader.namesKnown, [this.personKey(e)]: true } };
  },

  /**
   * Did they say their own name just now? Their whole name, or the first of it, as a word of its
   * own and written as a name is. A word that only holds the name inside it does not count.
   */
  saidTheirName(reply: string, name: string | undefined): boolean {
    const whole = name?.trim();
    if (!whole || !reply) return false;
    const first = whole.split(/\s+/)[0];
    return [whole, first].some(n => new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(n)}($|[^\\p{L}\\p{N}])`, 'u').test(reply));
  },

  /** A count of one kind of thing, in plain words: "1197 creatures", "1 person". */
  counted(type: string, count: number): string {
    const words = KIND_WORDS[type];
    return `${count} ${words ? words[count === 1 ? 0 : 1] : type.toLowerCase().replace(/_/g, ' ')}`;
  }
};

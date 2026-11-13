/**
 * A PERSON'S NAME, FROM THEIR WORLD'S OWN SOUNDS (CP8, family 1 of the content port).
 *
 * Every world named its people from the same eight first names and seven surnames, whatever it was about.
 * A written world already makes its own name pieces: the ground pass writes its prefixes and suffixes, and
 * every name in it is one of each joined (`NameWell` in `WorldWriter.ts`). They are kept on its sealed pack
 * (`IThemeBody.names`), carried in its context (`IGenerationContext.names`), and from `NAMED_FROM_GROUND` a
 * person the land lays is named from them, on a stream keyed by who they are.
 *
 * A person has two names, a given name and a family name, each one prefix with one suffix grown onto it into
 * one word: "Graymoth Stilldrift". A place stands a capitalised suffix apart ("Orcho Glint"); a person never
 * does, so a name is two words and never four (C21: stacked pieces read as gibberish).
 *
 * The floor: a pack with no pieces (the first theme, pinned by its bytes) and a world laid before
 * `NAMED_FROM_GROUND` name their people from `FLOOR`, drawn exactly as they always were.
 */

import type { SeededRNG } from '../../logic/rng/DeterministicRNG';
import { fnv1a } from '../../logic/rng/DeterministicRNG';

/** The ground from which a person is named from their world's pieces. Below it, the floor, as laid before. */
export const NAMED_FROM_GROUND = 8;

/** The pieces a world's names are made of: the ground pass's prefixes and suffixes, and any the names pass added. */
export interface IWorldNamePieces { prefixes: string[]; suffixes: string[] }

/** The names every world used before its own were kept, and still the names of a world with none. */
const FLOOR = {
  first: ['Kael', 'Vector', 'Sera', 'Io', 'Null', 'Cassin', 'Orrin', 'Vesta'],
  last: ['Steelweave', 'Basalt', 'Error', 'Null', 'Gantry', 'Mireforge', 'Siltvane']
} as const;

/**
 * A piece as a person's name reads it. A piece may hold a space inside it, as the ground pass keeps it ("Ael ith",
 * `NamePiece`); in a person's name it is closed up ("Aelith"), so a name is two words and never more (CP29).
 */
const solid = (piece: string) => piece.replace(/\s+/g, '');
const capital = (piece: string) => piece.charAt(0).toUpperCase() + piece.slice(1);

/** Every word one prefix and one suffix grow into, in the lists' own order, each once (two pieces may close up alike). */
const wordsOf = (pieces: IWorldNamePieces): string[] =>
  [...new Set(pieces.prefixes.flatMap(p => pieces.suffixes.map(s => `${capital(solid(p))}${solid(s).toLowerCase()}`)))];

export const PeopleNames = {
  FLOOR,

  /** Whether a world laid at this ground, with these pieces, names its people from them. */
  ownNames(groundVersion: number | undefined, pieces: IWorldNamePieces | undefined): pieces is IWorldNamePieces {
    return (groundVersion ?? 1) >= NAMED_FROM_GROUND && !!pieces && pieces.prefixes.length > 0 && pieces.suffixes.length > 0;
  },

  /**
   * A person's name from a world's pieces, keyed by who they are: a given name and a different family name.
   * A world whose pieces make one word only names its people with that word.
   */
  draw(key: string, pieces: IWorldNamePieces): string {
    const words = wordsOf(pieces);
    const given = fnv1a(`${key}:given`) % words.length;
    if (words.length === 1) return words[0];
    // The family name is any word but the given one
    const family = (given + 1 + (fnv1a(`${key}:family`) % (words.length - 1))) % words.length;
    return `${words[given]} ${words[family]}`;
  },

  /** The floor's name, on the stream it was always drawn from: two picks, so nothing drawn after it moves. */
  floor(rng: SeededRNG): string {
    return `${rng.pick([...FLOOR.first])} ${rng.pick([...FLOOR.last])}`;
  }
};

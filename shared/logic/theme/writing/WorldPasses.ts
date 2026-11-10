/**
 * THE PASSES (Q1): a world is written in the order a world comes to be (Pedro, 2026-11-04:
 * "geography, water and mountains, where fauna and flora are, it's multiple passes, don't
 * choke a model"). Each pass is one small ask, given what the earlier passes made. Fauna
 * is one field, animals and monsters together ("fauna connects animal and monster"): the
 * fauna pass places it all, and code rolls which of it is aggressive.
 *
 * Every schema here is small enough to compile on its own: every field required, no
 * unions, a handful of enums. Nothing in one is a number, a stat or what a thing does.
 * The model answers in ids from the pull and in words; code rolls every band, and the
 * names come from the world's own prefix and suffix lists.
 */

import { BIOMES, GEAR_KINDS } from '../ThemeTypes';
import { FLORA_FORMS, MINERAL_FORMS, PoolList } from './WorldPool';

/** C15: what grows and what lives are two passes, the second given what the first made, so neither ask runs past its room. */
export const WORLD_PASSES = ['ground', 'terrain', 'flora', 'fauna', 'people', 'holds', 'made', 'known'] as const;
/**
 * Every ask a world is written in: its passes in order, what it still lacks once the pool is read (C16), and more
 * name pieces when every name its lists make is taken (C21).
 */
export const WORLD_ASKS = [...WORLD_PASSES, 'lack', 'names'] as const;
export type WorldPassId = typeof WORLD_ASKS[number];

/** What each pass pulls from the pool, in the order it asks. */
export const PASS_PULLS: Record<WorldPassId, PoolList[]> = {
  ground: [],
  terrain: ['terrain'],
  flora: ['flora'],
  fauna: ['fauna'],
  people: ['professions'],
  holds: ['minerals', 'junk', 'anchors'],
  made: ['gear', 'goods', 'stations', 'consumables'],
  known: ['abilities', 'affixes'],
  lack: [],
  names: []
};

/** What a person reads while a pass is out. */
export const PASS_SAID: Record<WorldPassId, string> = {
  ground: 'THE LAY OF THE LAND',
  terrain: 'WATER AND HEIGHTS',
  flora: 'WHAT GROWS THERE, AND WHERE',
  fauna: 'WHAT LIVES THERE, AND WHERE',
  people: 'WHO WORKS THERE',
  holds: 'WHAT LIES IN THE GROUND',
  made: 'WHAT IS MADE AND WORN',
  known: 'WHAT IT KNOWS, AND ITS LORE',
  lack: 'WHAT IT STILL LACKS',
  names: 'MORE NAMES'
};

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const bool = { type: 'boolean' };
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const manyOf = (values: readonly string[]) => ({ type: 'array', items: oneOf(values) });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (properties: Record<string, unknown>) => ({ type: 'array', items: obj(properties) });

/** A new word for the registry: one meaning, one spelling, under the tag law. */
export const WORD_KINDS = ['tool', 'family', 'material', 'trade', 'action', 'descriptive', 'element', 'verb'] as const;
const WORDS = list({ tag: str, kind: oneOf(WORD_KINDS), meaning: str });
const REGIONS = manyOf(BIOMES);
const PICKED_WITH_REGIONS = list({ id: str, regions: REGIONS });
const DRESSING = obj({ pick: str, ground: str, blurb: str, crossing: str });

export const PASS_SCHEMAS: Record<WorldPassId, Record<string, unknown>> = {
  // C17: the model names nothing, the world included. Its name and every ground's are drawn from its own lists
  ground: obj({
    premise: str,
    regions: list({ biome: oneOf(BIOMES), blurb: str }),
    without: strs, prefixes: strs, suffixes: strs, words: WORDS
  }),
  terrain: obj({ impassable: DRESSING, skilled: DRESSING, words: WORDS }),
  flora: obj({
    picked: PICKED_WITH_REGIONS,
    flora: list({ is: str, form: oneOf(FLORA_FORMS), tags: strs, regions: REGIONS }),
    words: WORDS
  }),
  fauna: obj({
    picked: PICKED_WITH_REGIONS,
    fauna: list({ is: str, tags: strs, social: bool, builds: bool, regions: REGIONS }),
    words: WORDS
  }),
  people: obj({
    picked: strs,
    professions: list({ is: str, concept: str, workshop: str, tool: strs, material: strs }),
    words: WORDS
  }),
  holds: obj({
    picked: PICKED_WITH_REGIONS,
    minerals: list({ is: str, form: oneOf(MINERAL_FORMS), tags: strs, regions: REGIONS }),
    junk: list({ is: str, tags: strs, from: strs }),
    anchors: list({ is: str, tags: strs, regions: REGIONS }),
    words: WORDS
  }),
  // What is made is selected only: the tech web adds what a world's people make (D129, the chain)
  made: obj({ picked: strs }),
  known: obj({ picked: strs, lore: strs }),
  // C16: what the law asks of any world and the pool cannot give, the model adds. One need an ask, the need says which list
  lack: obj({
    fauna: list({ is: str, tags: strs, social: bool, builds: bool, regions: REGIONS }),
    materials: list({ is: str, form: oneOf([...FLORA_FORMS, ...MINERAL_FORMS]), tags: strs, regions: REGIONS }),
    anchors: list({ is: str, tags: strs, regions: REGIONS }),
    gear: list({ is: str, kind: oneOf(GEAR_KINDS) }),
    words: WORDS
  }),
  // C21: a name is one prefix and one suffix; when every one the lists make is taken, the world writes more pieces
  names: obj({ prefixes: strs, suffixes: strs })
};

/** What a world still lacks once the pool is read, and which list of the lack ask fills it (C16). */
export type LackList = 'fauna' | 'materials' | 'anchors' | 'gear';
export interface ILack {
  /** What it is for, in words: "raise a wall". */
  need: string;
  list: LackList;
  /** What code makes of what is added, so it meets the need: never the model's to say. */
  role?: 'monster' | 'animal' | 'start' | 'lead' | 'building' | 'loose';
  /** For gear: the kinds that answer the need. */
  kinds?: string[];
  /** The kinds of ground it must reach, when the need is a place. */
  regions?: string[];
}

// -------------------------------------------------------------------------
// Tightened to one ask (C1, leg 2)
// -------------------------------------------------------------------------

/** Who leads, and who is one of a kind, is code's to decide: no creature is written with these. */
const LEADER_WORDS = ['elite', 'boss', 'titan', 'god'];
/** TagLaw's spelling: lower_snake_case, one spelling. */
const SPELLED = { type: 'string', pattern: '^[a-z][a-z0-9]*(_[a-z0-9]+)*$' };
const said = { type: 'string', minLength: 1 };
/** C17: what a person reads of a thing is plain words, never a code word: no underscore, no digit. */
const PLAIN = { type: 'string', pattern: "^[A-Za-z][A-Za-z ,.'-]*$" };
/** A piece a name is made of: a sound of this world. */
const NAME_PIECE = { type: 'string', pattern: '^[A-Za-z]+$' };
/** A name begins with its prefix, so a prefix begins with a capital. */
const NAME_START = { type: 'string', pattern: '^[A-Z][A-Za-z]*$' };
/** C17: the one word a skill must carry to cross the skilled ground, registered with it when it is new. */
const CROSSING = obj({ tag: SPELLED, kind: oneOf(WORD_KINDS), meaning: said });
const someOf = (item: Record<string, unknown>, minItems = 0) => ({ type: 'array', items: item, ...(minItems > 0 ? { minItems } : {}) });

/** The pieces a world's names are made of (C21). */
export interface INamePieces { prefixes: string[]; suffixes: string[] }

export interface ITightAsk { offered?: Record<string, { id: string }[]>; words?: string[]; lack?: ILack }

/**
 * A pass's schema, tightened to this one ask. A model held to every word of its schema (a local one: its grammar
 * is the schema) then writes only what the writer's fold can take: every kind of ground named, once and in order;
 * every tag a word already registered, on the books or by this world in an earlier pass; every pick an id it was
 * offered; no creature tagged as a leader. A word registered in a pass is for the passes after it. The frozen
 * schema stays what a provider that caches reads, and the fold still judges everything (WorldWriter.ts).
 */
export function tightPass(pass: WorldPassId, ask: ITightAsk, registry: readonly string[]): Record<string, unknown> {
  const known = [...new Set([...registry, ...(ask.words ?? [])])].sort();
  const word = known.length > 0 ? oneOf(known) : str;
  const unled = known.filter(w => !LEADER_WORDS.includes(w));
  const creatureWord = unled.length > 0 ? oneOf(unled) : str;
  const words = list({ tag: SPELLED, kind: oneOf(WORD_KINDS), meaning: said });
  const regions = someOf(oneOf(BIOMES), 1);
  const idsOf = (lists: readonly string[], end = '') => lists.flatMap(l => ask.offered?.[l] ?? []).map(o => o.id).filter(id => id.endsWith(end));
  const ids = (lists: readonly string[]) => {
    const offered = idsOf(lists);
    return offered.length > 0 ? someOf(oneOf(offered)) : { type: 'array', items: str, maxItems: 0 };
  };
  const pickedAt = (lists: readonly string[]) => {
    const offered = idsOf(lists);
    return offered.length > 0 ? list({ id: oneOf(offered), regions }) : { type: 'array', items: obj({ id: str, regions }), maxItems: 0 };
  };
  // C17: a crossing held to the registered words had no "climb" in it, and a grammar that let "cl" begin could only
  // end it as "cloth". The skilled crossing is the word itself, registered with its meaning when it is new
  const dressing = (role: 'impassable' | 'skilled') => obj({
    pick: oneOf(['', ...idsOf(['terrain'], `.terrain.${role}`)]),
    ground: PLAIN, blurb: str,
    crossing: role === 'skilled' ? CROSSING : oneOf([''])
  });

  switch (pass) {
    case 'ground': return obj({
      premise: said,
      regions: { type: 'array', prefixItems: BIOMES.map(b => obj({ biome: oneOf([b]), blurb: said })), minItems: BIOMES.length, maxItems: BIOMES.length },
      without: strs, prefixes: someOf(NAME_START, 1), suffixes: someOf(NAME_PIECE, 1), words
    });
    case 'terrain': return obj({ impassable: dressing('impassable'), skilled: dressing('skilled'), words });
    case 'flora': return obj({
      picked: pickedAt(PASS_PULLS.flora),
      flora: list({ is: PLAIN, form: oneOf(FLORA_FORMS), tags: someOf(word), regions }),
      words
    });
    case 'fauna': return obj({
      picked: pickedAt(PASS_PULLS.fauna),
      fauna: list({ is: PLAIN, tags: someOf(creatureWord, 1), social: bool, builds: bool, regions }),
      words
    });
    case 'people': return obj({
      picked: ids(PASS_PULLS.people),
      professions: list({ is: PLAIN, concept: SPELLED, workshop: PLAIN, tool: someOf(word, 1), material: someOf(word, 1) }),
      words
    });
    case 'holds': return obj({
      picked: pickedAt(PASS_PULLS.holds),
      minerals: list({ is: PLAIN, form: oneOf(MINERAL_FORMS), tags: someOf(word), regions }),
      junk: list({ is: PLAIN, tags: someOf(word), from: someOf(word, 1) }),
      anchors: list({ is: PLAIN, tags: someOf(word), regions }),
      words
    });
    case 'made': return obj({ picked: ids(PASS_PULLS.made) });
    case 'known': return obj({ picked: ids(PASS_PULLS.known), lore: strs });
    case 'lack': {
      // The one list the need asks for holds at least one thing; the others hold none
      const lack = ask.lack;
      const of = (l: LackList, item: Record<string, unknown>) => (lack?.list === l ? someOf(obj(item), 1) : { type: 'array', items: obj(item), maxItems: 0 });
      return obj({
        fauna: of('fauna', { is: PLAIN, tags: someOf(creatureWord, 1), social: bool, builds: bool, regions }),
        materials: of('materials', { is: PLAIN, form: oneOf([...FLORA_FORMS, ...MINERAL_FORMS]), tags: someOf(word), regions }),
        anchors: of('anchors', { is: PLAIN, tags: someOf(word), regions }),
        gear: of('gear', { is: PLAIN, kind: oneOf(lack?.kinds?.length ? lack.kinds : GEAR_KINDS) }),
        words
      });
    }
    // At least one new prefix: it makes a new name with every suffix the world has
    case 'names': return obj({ prefixes: someOf(NAME_START, 1), suffixes: someOf(NAME_PIECE) });
  }
}

// -------------------------------------------------------------------------
// What each answer is, as code reads it
// -------------------------------------------------------------------------

export interface IWord { tag: string; kind: typeof WORD_KINDS[number]; meaning: string }
export interface IPickedAt { id: string; regions: string[] }
/** The skilled crossing is a word, or the word with its meaning when the tight schema asked it so (C17). */
export interface IDressingAnswer { pick: string; ground: string; blurb: string; crossing: string | IWord }

export interface IGroundAnswer {
  premise: string;
  regions: { biome: string; blurb: string }[];
  without: string[]; prefixes: string[]; suffixes: string[]; words: IWord[];
}
export interface ITerrainAnswer { impassable: IDressingAnswer; skilled: IDressingAnswer; words: IWord[] }
export interface IFloraAnswer { picked: IPickedAt[]; flora: { is: string; form: string; tags: string[]; regions: string[] }[]; words: IWord[] }
export interface IFaunaAnswer { picked: IPickedAt[]; fauna: { is: string; tags: string[]; social: boolean; builds: boolean; regions: string[] }[]; words: IWord[] }
export interface IPeopleAnswer {
  picked: string[];
  professions: { is: string; concept: string; workshop: string; tool: string[]; material: string[] }[];
  words: IWord[];
}
export interface IHoldsAnswer {
  picked: IPickedAt[];
  minerals: { is: string; form: string; tags: string[]; regions: string[] }[];
  junk: { is: string; tags: string[]; from: string[] }[];
  anchors: { is: string; tags: string[]; regions: string[] }[];
  words: IWord[];
}
export interface IMadeAnswer { picked: string[] }
export interface IKnownAnswer { picked: string[]; lore: string[] }
export interface ILackAnswer {
  fauna: IFaunaAnswer['fauna']; materials: { is: string; form: string; tags: string[]; regions: string[] }[];
  anchors: IHoldsAnswer['anchors']; gear: { is: string; kind: string }[]; words: IWord[];
}
export type INamesAnswer = INamePieces;

export interface IPassAnswers {
  ground: IGroundAnswer; terrain: ITerrainAnswer; flora: IFloraAnswer; fauna: IFaunaAnswer; people: IPeopleAnswer;
  holds: IHoldsAnswer; made: IMadeAnswer; known: IKnownAnswer; lack: ILackAnswer; names: INamesAnswer;
}

// -------------------------------------------------------------------------
// Will it compile? The API publishes some limits and keeps grammar size to itself
// -------------------------------------------------------------------------

/** Published limits for structured outputs (platform docs, read 2026-11-04). Per request. */
export const SCHEMA_LIMITS = { optionalParameters: 24, unionParameters: 16 } as const;

/** Every parameter left out of `required`, and every union, across a schema. */
export function schemaShape(schema: unknown): { optional: number; unions: number; weight: number } {
  let optional = 0;
  let unions = 0;
  let weight = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    weight++;
    if (Array.isArray(n.enum)) weight += n.enum.length;
    if (Array.isArray(n.anyOf) || Array.isArray(n.type)) unions++;
    if (n.properties && typeof n.properties === 'object') {
      const required = new Set(Array.isArray(n.required) ? n.required as string[] : []);
      for (const [key, child] of Object.entries(n.properties as Record<string, unknown>)) {
        if (!required.has(key)) optional++;
        walk(child);
      }
    }
    if (n.items) walk(n.items);
    for (const branch of (n.anyOf as unknown[] | undefined) ?? []) walk(branch);
  };
  walk(schema);
  return { optional, unions, weight };
}

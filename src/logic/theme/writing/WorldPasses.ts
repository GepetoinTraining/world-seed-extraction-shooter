/**
 * THE PASSES (Q1): a world is written in the order a world comes to be (Pedro, 2026-11-04:
 * "geography, water and mountains, where fauna and flora are, it's multiple passes, don't
 * choke a model"). Each pass is one small ask, given what the earlier passes made. Fauna
 * is one field, animals and monsters together ("fauna connects animal and monster"): the
 * life pass places it all, and code rolls which of it is aggressive.
 *
 * Every schema here is small enough to compile on its own: every field required, no
 * unions, a handful of enums. Nothing in one is a number, a stat or what a thing does.
 * The model answers in ids from the pull and in words; code rolls every band, and the
 * names come from the world's own prefix and suffix lists.
 */

import { BIOMES } from '../ThemeTypes';
import { FLORA_FORMS, MINERAL_FORMS, PoolList } from './WorldPool';

export const WORLD_PASSES = ['ground', 'terrain', 'life', 'people', 'holds', 'made', 'known'] as const;
export type WorldPassId = typeof WORLD_PASSES[number];

/** What each pass pulls from the pool, in the order it asks. */
export const PASS_PULLS: Record<WorldPassId, PoolList[]> = {
  ground: [],
  terrain: ['terrain'],
  life: ['flora', 'fauna'],
  people: ['professions'],
  holds: ['minerals', 'junk', 'anchors'],
  made: ['gear', 'goods', 'stations', 'consumables'],
  known: ['abilities', 'affixes']
};

/** What a person reads while a pass is out. */
export const PASS_SAID: Record<WorldPassId, string> = {
  ground: 'THE LAY OF THE LAND',
  terrain: 'WATER AND HEIGHTS',
  life: 'WHAT GROWS AND WHAT LIVES THERE, AND WHERE',
  people: 'WHO WORKS THERE',
  holds: 'WHAT LIES IN THE GROUND',
  made: 'WHAT IS MADE AND WORN',
  known: 'WHAT IT KNOWS, AND ITS LORE'
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
  ground: obj({
    name: str, premise: str,
    regions: list({ biome: oneOf(BIOMES), name: str, blurb: str }),
    without: strs, prefixes: strs, suffixes: strs, words: WORDS
  }),
  terrain: obj({ impassable: DRESSING, skilled: DRESSING, words: WORDS }),
  life: obj({
    picked: PICKED_WITH_REGIONS,
    flora: list({ is: str, form: oneOf(FLORA_FORMS), tags: strs, regions: REGIONS }),
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
  known: obj({ picked: strs, lore: strs })
};

// -------------------------------------------------------------------------
// What each answer is, as code reads it
// -------------------------------------------------------------------------

export interface IWord { tag: string; kind: typeof WORD_KINDS[number]; meaning: string }
export interface IPickedAt { id: string; regions: string[] }
export interface IDressingAnswer { pick: string; ground: string; blurb: string; crossing: string }

export interface IGroundAnswer {
  name: string; premise: string;
  regions: { biome: string; name: string; blurb: string }[];
  without: string[]; prefixes: string[]; suffixes: string[]; words: IWord[];
}
export interface ITerrainAnswer { impassable: IDressingAnswer; skilled: IDressingAnswer; words: IWord[] }
export interface ILifeAnswer {
  picked: IPickedAt[];
  flora: { is: string; form: string; tags: string[]; regions: string[] }[];
  fauna: { is: string; tags: string[]; social: boolean; builds: boolean; regions: string[] }[];
  words: IWord[];
}
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

export interface IPassAnswers {
  ground: IGroundAnswer; terrain: ITerrainAnswer; life: ILifeAnswer; people: IPeopleAnswer;
  holds: IHoldsAnswer; made: IMadeAnswer; known: IKnownAnswer;
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

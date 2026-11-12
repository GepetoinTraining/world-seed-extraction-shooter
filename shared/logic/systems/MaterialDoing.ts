/**
 * WHAT A MATERIAL DOES (ML21, part 4). Pedro, 2026-11-12: "lazily we add what each material does, and that's the whole
 * loop", and "once something exists it's determined, and the skill always gives the same thing".
 *
 * What a material does is words: one thing a piece can carry (a word of `PASSIVE_STATS`, said as a player reads it),
 * how strongly (a band of `STAT_BANDS`), and one plain line a person reads on its card. It is written the first time
 * anyone needs it, judged here, and never written again (`MaterialDoingWriter`). A model writes the words; nothing it
 * writes is a number. What the words come to on a made piece is the slot work still to build.
 *
 * With no key, a variant is its base's doing, and a base with nothing above it reads its own from what it is made of
 * (the plan of 6570f17: "properties determine reality", hardness for turning blows, density for a body): a thing hard
 * enough to want a tool lends protection, one a hand takes lends a body's health, more strongly the rarer it is.
 * Pure: no store, no door.
 */

import type { ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { PASSIVE_STATS, STAT_BANDS } from '../theme/ThemeTypes';
import type { IThemePack } from '../theme/ThemeTypes';
import { statWord } from './StatWords';

export type DoingBand = typeof STAT_BANDS[number];

export interface IMaterialDoing {
  material: string;
  /** What a piece made of it carries, by the key the game reads. */
  stat: typeof PASSIVE_STATS[number];
  band: DoingBand;
  /** What a person reads on its card. */
  line: string;
  /** Written by a model, taken from its base, or read from what it is made of. */
  by: 'model' | 'base' | 'own';
  /** The base it was taken from. */
  from?: string;
  writtenAt: number;
}

/** What the door is asked to answer: three words, nothing more. */
export const DOING_SCHEMA = {
  type: 'object',
  properties: {
    stat: { type: 'string' },
    band: { type: 'string', enum: [...STAT_BANDS] },
    line: { type: 'string' }
  },
  required: ['stat', 'band', 'line'],
  additionalProperties: false
} as const;

/** How many times one material is asked before it falls back: the first ask, and once more told why. */
export const DOING_ASK_TRIES = 2;
const LINE_LONGEST = 160;
/** A line that explains how a number is made, or names the machinery, is not the game's voice (GV). */
const NOT_SAID = /\d|_|formula|\blaw\b|factor|multipl|rating|\btags?\b|\bnodes?\b|\bstats?\b|\bbands?\b|\bcurve\b|\bpercent/i;

const WORTH_OF: Record<string, string> = { COMMON: 'common', UNCOMMON: 'fine', MAGICAL: 'fine', RARE: 'rare', EPIC: 'rare', LEGENDARY: 'rare', ARTIFACT: 'rare' };
const BAND_OF: Record<string, DoingBand> = { common: 'minor', fine: 'moderate', rare: 'major' };

/** A base's own doing, by what it is made of. */
const OWN_LINES: Record<'defense' | 'max_health', string> = {
  defense: 'What is made of it turns a blow aside.',
  max_health: 'What is made of it keeps a body on its feet longer.'
};

export interface IDoingAsk {
  world: { name: string; premise: string };
  material: { name: string; blurb: string; form: string; rank: string; worth: string; tags: string[] };
  stats: string[];
  bands: string[];
  refused?: string;
}

export const MaterialDoing = {
  /** The ask: the material as its world's words say it, and the words a doing may use. */
  askOf(def: ResourceDef, pack: Pick<IThemePack, 'name' | 'premise'> | undefined, refused?: string): IDoingAsk {
    return {
      world: { name: pack?.name ?? '', premise: pack?.premise ?? '' },
      material: {
        name: def.name, blurb: String(def.description ?? ''), form: String(def.visuals?.modelId ?? ''), rank: String(def.rank ?? 'F'),
        worth: WORTH_OF[String(def.rarity ?? 'COMMON')] ?? 'common', tags: [...(def.tags ?? [])]
      },
      stats: PASSIVE_STATS.map(statWord),
      bands: [...STAT_BANDS],
      ...(refused ? { refused } : {})
    };
  },

  /** The law: a stat a piece can carry, a band of the words, and one plain line that names no material and no number. */
  judge(answer: unknown, def: ResourceDef, now = Date.now()): { doing: IMaterialDoing } | { reason: string } {
    const a = (answer ?? {}) as { stat?: unknown; band?: unknown; line?: unknown };
    const stat = PASSIVE_STATS.find(k => statWord(k) === a.stat || k === a.stat);
    if (!stat) return { reason: `"${String(a.stat)}" is not something a piece can carry. Use one of the words given.` };
    if (!(STAT_BANDS as readonly unknown[]).includes(a.band)) return { reason: `"${String(a.band)}" is not one of the bands given.` };
    const line = typeof a.line === 'string' ? a.line.replace(/\s+/g, ' ').trim() : '';
    if (line.length < 8 || line.length > LINE_LONGEST) return { reason: `The line must be one plain sentence of at most ${LINE_LONGEST} letters.` };
    if (NOT_SAID.test(line)) return { reason: 'The line must hold no number and no word about how the world is made: only what a person would notice.' };
    if (line.toLowerCase().includes(def.name.toLowerCase())) return { reason: 'The line must not name the material: it is read on the material\'s own card.' };
    return { doing: { material: def.id, stat, band: a.band as DoingBand, line, by: 'model', writtenAt: now } };
  },

  /** A base with no key and nothing above it: what it is made of says what it does. */
  fromOwn(def: ResourceDef, now = Date.now()): IMaterialDoing {
    const wantsTool = (def.harvestConfig?.requiredToolTags ?? []).length > 0;
    const stat = wantsTool ? 'defense' : 'max_health';
    return { material: def.id, stat, band: BAND_OF[WORTH_OF[String(def.rarity ?? 'COMMON')] ?? 'common'], line: OWN_LINES[stat], by: 'own', writtenAt: now };
  },

  /** A variant with no key: its base's doing, as its own from then on. */
  fromBase(def: ResourceDef, base: IMaterialDoing, now = Date.now()): IMaterialDoing {
    return { material: def.id, stat: base.stat, band: base.band, line: base.line, by: 'base', from: base.material, writtenAt: now };
  }
};

let book = new Map<string, IMaterialDoing>();

/** What has been written, as the cards read it. Filled as doings are written and when a world opens. */
export const DoingBook = {
  of(materialId: string): IMaterialDoing | null {
    return book.get(materialId) ?? null;
  },
  /** Written once: a doing already held is never replaced. */
  hold(doing: IMaterialDoing): IMaterialDoing {
    const held = book.get(doing.material);
    if (held) return held;
    book.set(doing.material, doing);
    return doing;
  },
  forget(): void {
    book = new Map();
  }
};

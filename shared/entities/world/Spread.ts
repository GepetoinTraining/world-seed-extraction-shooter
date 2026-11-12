/**
 * THE SPREAD OF MATERIALS (ML). Pedro, 2026-11-12: "we need to add the spread of materials inside every world,
 * basically you change ever so slightly the sprite, and the right click studies or inspects or tries to use the tool".
 *
 * A world holds its materials spread over its land: its pack's and what its minting added. Every material has a form
 * (a tree, a vein, a grain, and the rest of the formula's forms), and a form is a base place. Where a land lays a form,
 * any material of that form the land holds may stand, rolled from the world's seed and the place, weighed by the
 * formula (`spreadWeight`), so a hub can check it by this file and the seed alone. How many kinds a land holds has no
 * ceiling: whatever the world holds of a form is in the roll.
 *
 * Of each form a world holds, the plainest (the lowest rank, then the least worth, then its pack's own before what was
 * added, then by id) is the base, and is drawn as it always was. Every other is a variant: drawn as the base's own
 * picture with marks cut into or added to its outline, made from the material's own words by one rule (`marksOf`), so
 * two of one form are told apart by shape and never by hue. The marks are plain to see at any knowledge; what the
 * material is called is not, until it is studied or held.
 *
 * Pinned by its ground (`SPREAD_FROM_GROUND`): a world laid before keeps its land exactly. A place that comes back
 * (`GroundReturn`) is rolled by its role and then by this, keyed by the turn it came back in.
 */

import { UniversalRank } from '../../types';
import { ResourceDef, RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { MATERIAL_FORMS } from '../../logic/theme/ThemeTypes';
import { rankStep, spreadWeight } from '../../logic/theme/ThemeFormula';
import { Rng } from '../../logic/rng/DeterministicRNG';

/** From this ground a world lays its spread. A world laid before keeps what it laid. */
export const SPREAD_FROM_GROUND = 7;

export type MaterialForm = typeof MATERIAL_FORMS[number];

/** One mark on a variant's outline: a bite cut out, a knob added, or a spur drawn out; where, by sixteenths of a turn from the top; and how large. */
export interface IMark { kind: 'notch' | 'knob' | 'spur'; at: number; size: number }

const MARK_KINDS: IMark['kind'][] = ['notch', 'knob', 'spur'];
export const MARK_DIRECTIONS = 16;
const WORTH_LADDER = ['COMMON', 'UNCOMMON', 'MAGICAL', 'RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT'];
const worthOf = (def: Pick<ResourceDef, 'rarity'>) => Math.max(0, WORTH_LADDER.indexOf(String(def.rarity ?? 'COMMON')));
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What form a material is, from what it is: the formula's own form where it was written, its tags otherwise. */
export const formOf = (def: Partial<ResourceDef> | undefined): MaterialForm | null => {
  if (!def) return null;
  const model = def.visuals?.modelId;
  if (model && (MATERIAL_FORMS as readonly string[]).includes(model)) return model as MaterialForm;
  const tags: string[] = def.tags ?? [];
  if (tags.includes('flora') && tags.includes('wood') && !tags.includes('seed')) return 'tree';
  if (tags.includes('ore')) return 'vein';
  if (tags.includes('sand')) return 'sand';
  if (tags.includes('stone')) return 'rock';
  if (tags.includes('grain')) return 'grain';
  if (tags.includes('berry')) return 'shrub';
  if (tags.includes('fruit')) return 'fruit';
  return null;
};

/** What stands on the ground and can be a base or a variant: a material with a form and a land. */
const isGroundMaterial = (def: ResourceDef) => !!formOf(def) && !def.junk && !def.anchor;

const DIRECTION_WORDS = ['top', 'upper right', 'right', 'lower right', 'bottom', 'lower left', 'left', 'upper left'];
const SIZE_WORDS = ['', 'large ', 'great '];

export const Spread = {
  spreads(groundVersion?: number): boolean {
    return (groundVersion ?? 1) >= SPREAD_FROM_GROUND;
  },

  /** The kinds of one form a land holds, sorted so every machine weighs them alike. */
  kindsOf(form: MaterialForm, land: ResourceDef[]): ResourceDef[] {
    return land.filter(d => !d.rareFind && formOf(d) === form).sort(byId);
  },

  /**
   * What stands at a place the land laid as `laid`: any of its form the land holds, weighed by the formula against the
   * ground's rank, keyed by the seed and the place (and the turn, for a place that came back). The kind laid names only
   * the form, so the roll is the place's.
   */
  pick(seed: string, placeId: string, laid: ResourceDef, land: ResourceDef[], landRank: UniversalRank | string, turn?: number): ResourceDef {
    const form = formOf(laid);
    if (!form) return laid;
    const kinds = this.kindsOf(form, land);
    if (kinds.length < 2) return kinds[0] ?? laid;
    const weights = kinds.map(d => spreadWeight(d.rank, d.rarity, landRank));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Rng.fromKey(`${seed}:spread:v1:${placeId}${turn === undefined ? '' : `:${turn}`}`).next() * total;
    for (let i = 0; i < kinds.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return kinds[i];
    }
    return kinds[kinds.length - 1];
  },

  /** The plainest of a form among these: the lowest rank, the least worth, its pack's own, then by id. */
  baseOf(form: MaterialForm, defs: ResourceDef[], ownTheme?: string): ResourceDef | undefined {
    const added = (d: ResourceDef) => (ownTheme && d.themeId !== ownTheme ? 1 : 0);
    return defs.filter(d => isGroundMaterial(d) && formOf(d) === form).sort((a, b) =>
      rankStep((a.rank ?? 'F') as UniversalRank) - rankStep((b.rank ?? 'F') as UniversalRank)
      || worthOf(a) - worthOf(b) || added(a) - added(b) || byId(a, b))[0];
  },

  /**
   * THE RULE: a variant's marks, made from its own words. One mark, and one more for every two steps of worth above
   * common; larger for every three ranks; which kind of mark and where come from its name, rank and worth, spaced
   * evenly round the outline. The same words give the same marks on any machine.
   */
  marksOf(def: Pick<ResourceDef, 'name' | 'rank' | 'rarity'>): IMark[] {
    const count = 1 + Math.floor((worthOf(def) + 1) / 2);
    const size = 1 + Math.floor(Math.max(0, rankStep((def.rank ?? 'F') as UniversalRank)) / 3);
    const rng = Rng.fromKey(`mark:v1:${def.name}:${def.rank ?? 'F'}:${def.rarity ?? 'COMMON'}`);
    const first = rng.int(0, MARK_DIRECTIONS);
    return Array.from({ length: count }, (_, i) => ({
      kind: MARK_KINDS[rng.int(0, MARK_KINDS.length)],
      at: (first + Math.round((i * MARK_DIRECTIONS) / count)) % MARK_DIRECTIONS,
      size
    }));
  },

  /** The marks in words, for whoever cannot or would rather not tell them by eye: "a notch at its top and a knob at its left". */
  said(marks: IMark[]): string {
    const one = (m: IMark) => {
      const where = DIRECTION_WORDS[Math.round((m.at * DIRECTION_WORDS.length) / MARK_DIRECTIONS) % DIRECTION_WORDS.length];
      return `a ${SIZE_WORDS[Math.min(SIZE_WORDS.length - 1, m.size - 1)]}${m.kind} at its ${where}`;
    };
    const parts = marks.map(one);
    return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }
};

const signature = (marks: IMark[]) => marks.map(m => `${m.kind}${m.at}:${m.size}`).sort().join('|');

/** Turns a variant's marks round by a sixteenth until no other variant of its base in the world wears the same. */
function apart(marks: IMark[], taken: Set<string>): IMark[] {
  let out = marks;
  for (let turn = 0; turn < MARK_DIRECTIONS && taken.has(signature(out)); turn++) {
    out = marks.map(m => ({ ...m, at: (m.at + turn + 1) % MARK_DIRECTIONS }));
  }
  return out;
}

export interface ISpreadEntry { base?: ResourceDef; marks: IMark[] }

/** Each world's own: which material is the base of its form, and what marks each variant wears in it. */
function bookOf(defs: ResourceDef[], ownTheme?: string): Map<string, ISpreadEntry> {
  const book = new Map<string, ISpreadEntry>();
  const ground = defs.filter(isGroundMaterial).slice().sort(byId);
  for (const form of MATERIAL_FORMS) {
    const base = Spread.baseOf(form, ground, ownTheme);
    if (!base) continue;
    book.set(base.id, { marks: [] });
    const taken = new Set<string>();
    for (const def of ground.filter(d => d.id !== base.id && formOf(d) === form)) {
      const marks = apart(Spread.marksOf(def), taken);
      taken.add(signature(marks));
      book.set(def.id, { base, marks });
    }
  }
  return book;
}

let entered = new Map<string, ISpreadEntry>();
const byTheme = new Map<string, Map<string, ISpreadEntry>>();

export const SpreadBook = {
  /** The world opening: its own materials, its pack's and what its minting added, in any order. */
  enter(defs: ResourceDef[], ownTheme?: string): void {
    entered = bookOf(defs, ownTheme);
  },

  /** What this material is in the world open now; outside one, among its own theme's. A material of no form is plain. */
  of(defId: string): ISpreadEntry {
    const known = entered.get(defId);
    if (known) return known;
    const def = RESOURCE_DEFINITIONS[defId];
    if (!def || !formOf(def)) return { marks: [] };
    const theme = def.themeId ?? '';
    let book = byTheme.get(theme);
    if (!book) {
      book = bookOf(Object.values(RESOURCE_DEFINITIONS).filter(d => d.themeId === def.themeId), theme);
      byTheme.set(theme, book);
    }
    return book.get(defId) ?? { marks: [] };
  },

  /** What the drawing needs: the marks, and the base whose picture a variant wears. */
  drawOf(defId: string): { marks: IMark[]; base?: ResourceDef } {
    const entry = this.of(defId);
    return entry.base ? { marks: entry.marks, base: entry.base } : { marks: entry.marks };
  },

  /** For the bars: forget the books kept outside a world. */
  forget(): void {
    entered = new Map();
    byTheme.clear();
  }
};

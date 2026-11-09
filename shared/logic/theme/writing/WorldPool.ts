/**
 * THE POOL (Q1): everything worlds already hold, sorted by what it is, for a new world
 * to pick from before anything is written. "First ML and then LLM": the pull is by
 * meaning, near the theme's description; the model then selects by id, and only then
 * adds what is missing. An oak is an oak: a thing two worlds hold, word for word, is
 * one entry here, so picking it never makes a second oak.
 *
 * The pull counts (Pedro, 2026-11-04: no embedding model, "or none at all"; `Counting`).
 * Every pack is a field. An entry is near a theme by PPMI over the pool's own words, and
 * ranks higher where it is distinctive to the fields the theme resembles (log-odds z,
 * concentration residual). What is offered is what scores above its list's own mean: no
 * fixed count. The pull goes through `IPull`, so a fake can stand in for it in a test.
 *
 * Fauna is one field (Pedro, 2026-11-04: "fauna connects animal and monster"): animals and
 * monsters are one list, and what makes one a monster is its aggression, which code rolls.
 */

import { cosineSimilarity } from '../../../entities/data/similarity';
import { IEmbedder } from '../../../services/EmbeddingService';
import { concentrationResiduals, CountedEmbedder, fieldAffinity, fieldCounts, zScores } from './Counting';
import { canonical } from '../ThemeCompiler';
import type { IThemeBody, IThemePack, IThemeTerrain } from '../ThemeTypes';

/** The lists a world is written from, in the order a world comes to be. */
export const POOL_LISTS = [
  'terrain', 'flora', 'fauna', 'professions', 'minerals', 'junk', 'anchors',
  'gear', 'goods', 'stations', 'consumables', 'abilities', 'affixes'
] as const;
export type PoolList = typeof POOL_LISTS[number];

/** A material's form says whether it grows or lies (`MATERIAL_FORMS`). */
export const FLORA_FORMS = ['grain', 'shrub', 'fruit', 'tree'] as const;
export const MINERAL_FORMS = ['vein', 'sand', 'rock', 'pebble'] as const;

/** Where an entry sits in a pack, by list. Terrain is a dressing, keyed by its role and words. */
export type PackList = 'creatures' | 'materials' | 'professions' | 'junk' | 'anchors' | 'gear' | 'goods' | 'stations' | 'consumables' | 'abilities' | 'affixes' | 'terrain';

export interface IPoolEntry {
  /** What the model answers with. Stable for the same entry in the same pack. */
  id: string;
  list: PoolList;
  /** The pack it was first read from, and its key there. */
  themeId: string;
  packList: PackList;
  key: string;
  /** What the pull ranks by: its own words. */
  text: string;
  /** Every pack that holds it word for word: the fields it has been written into. */
  fields: string[];
  entry: Record<string, unknown>;
}

const wordsOf = (...parts: unknown[]) => parts.flat().filter(p => typeof p === 'string' && p).join(' ');

/** What an entry says of itself, as the pull reads it. */
export function textOf(packList: PackList, x: Record<string, any>): string {
  switch (packList) {
    case 'creatures': return wordsOf(x.name, x.blurb, x.tags);
    case 'materials': return wordsOf(x.name, x.blurb, x.form, x.tags);
    case 'professions': return wordsOf(x.name, x.blurb, x.knows, x.workshop);
    case 'gear': return wordsOf(x.name, x.blurb, x.kind, x.tags);
    case 'stations': return wordsOf(x.name, x.blurb, x.tool, x.material);
    case 'consumables': return wordsOf(x.name, x.blurb, x.kind, x.tags);
    case 'abilities': return wordsOf(x.name, x.blurb, x.elements, x.effect);
    case 'affixes': return wordsOf(x.name, x.allowedTags);
    case 'terrain': return wordsOf(x.role, x.ground, x.blurb, x.crossing);
    default: return wordsOf(x.name, x.blurb, x.tags);
  }
}

/** Which list a pack's entry belongs to. */
function listsOf(pack: IThemeBody): { list: PoolList; packList: PackList; key: string; text: string; entry: Record<string, unknown> }[] {
  const out: ReturnType<typeof listsOf> = [];
  const put = (list: PoolList, packList: PackList, key: string, entry: object) =>
    out.push({ list, packList, key, text: textOf(packList, entry as Record<string, unknown>), entry: entry as Record<string, unknown> });
  for (const c of pack.creatures) put('fauna', 'creatures', c.key, c);
  for (const m of pack.materials) put((FLORA_FORMS as readonly string[]).includes(m.form) ? 'flora' : 'minerals', 'materials', m.key, m);
  for (const p of pack.professions ?? []) put('professions', 'professions', p.key, p);
  for (const j of pack.junk ?? []) put('junk', 'junk', j.key, j);
  for (const a of pack.anchors ?? []) put('anchors', 'anchors', a.key, a);
  for (const g of pack.gear) put('gear', 'gear', g.key, g);
  for (const g of pack.goods) put('goods', 'goods', g.key, g);
  for (const s of pack.stations) put('stations', 'stations', s.key, s);
  for (const c of pack.consumables) put('consumables', 'consumables', c.key, c);
  for (const a of pack.abilities) put('abilities', 'abilities', a.key, a);
  for (const a of pack.affixes) put('affixes', 'affixes', a.key, a);
  for (const t of pack.terrain ?? []) put('terrain', 'terrain', `${t.role}`, t);
  return out;
}

/** The pool of every pack given, oldest first; a thing held word for word by two packs is one entry. */
export function poolOf(packs: IThemePack[]): IPoolEntry[] {
  const seen = new Map<string, IPoolEntry>();
  const pool: IPoolEntry[] = [];
  const ordered = [...packs].sort((a, b) => a.writtenAt - b.writtenAt || (a.themeId < b.themeId ? -1 : 1));
  for (const pack of ordered) {
    for (const e of listsOf(pack)) {
      const bytes = `${e.list}:${canonical(e.entry)}`;
      const held = seen.get(bytes);
      if (held) {
        if (!held.fields.includes(pack.themeId)) held.fields.push(pack.themeId);
        continue;
      }
      const entry: IPoolEntry = { ...e, id: `${pack.themeId.slice('theme_'.length, 'theme_'.length + 8)}.${e.list}.${e.key}`, themeId: pack.themeId, fields: [pack.themeId] };
      seen.set(bytes, entry);
      pool.push(entry);
    }
  }
  return pool;
}

/** A word and the same word with an "s" read as one, so "trees" rules out a tree. */
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

/** What a word means, where the registry or the world itself gave it one. */
export type MeaningOf = (word: string) => string | undefined;

/** The words of a text as the registry spells them: a tag keeps its underscores, so it can be looked up. */
const spelled = (text: string) => text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);

/** A phrase stands in these words when its own words come side by side, in its order. */
const says = (words: string[], phrase: string[]) => words.some((_, i) => phrase.every((p, j) => words[i + j] === p));

/**
 * A clause that denies what it names says it is absent: "to shape timber, without a mill" is no
 * mill. Clauses break at punctuation. The words that deny are grammar, the same in every world.
 */
const DENIALS = new Set(['no', 'not', 'without', 'never', 'nor', 'none']);
const affirms = (meaning: string, phrase: string[]) => meaning.split(/[.,;:!?()]+/).some(clause => {
  const words = tokens(clause);
  return words.some((_, i) => phrase.every((p, j) => words[i + j] === p) && !words.slice(0, i).some(w => DENIALS.has(w)));
});

/**
 * The theme rules things out (Pedro: an airless moon gets no trees). A thing whose own words,
 * tags or form say what the world is without is never offered, and never added.
 *
 * C18: an exclusion is the whole phrase it is, never its words one by one: a world without
 * "moving water" keeps its water-bloom. What a thing is called may not say the phrase, so it
 * is read by meaning too, one step: a word the thing says whose registered meaning says the
 * phrase (a river, "a wide band of moving water") is ruled out with it.
 */
export function ruledOut(entry: Pick<IPoolEntry, 'text'>, without: string[], meaningOf?: MeaningOf): boolean {
  const phrases = without.map(tokens).filter(p => p.length > 0);
  if (phrases.length === 0) return false;
  if (phrases.some(p => says(tokens(entry.text), p))) return true;
  if (!meaningOf) return false;
  for (const w of new Set(spelled(entry.text))) {
    const meaning = meaningOf(w) ?? meaningOf(stem(w));
    if (meaning && phrases.some(p => affirms(meaning, p))) return true;
  }
  return false;
}

/**
 * What a pack's entry stands on, in its own pack: a creature's innate abilities and the kind it
 * leads, what a piece or a good is made from, its station, what it carries or casts. Picking it
 * brings these too, word for word.
 */
export function standsOn(pack: IThemeBody, packList: string, key: string): { packList: PackList; key: string }[] {
  const find = <T extends { key: string }>(xs: T[] | undefined) => (xs ?? []).find(x => x.key === key);
  const madeOf = (k: string) => ({ packList: (pack.materials.some(m => m.key === k) ? 'materials' : 'goods') as PackList, key: k });
  switch (packList) {
    case 'creatures': { const c = find(pack.creatures); return c ? [...c.innate.map(k => ({ packList: 'abilities' as PackList, key: k })), ...(c.leads ? [{ packList: 'creatures' as PackList, key: c.leads }] : [])] : []; }
    case 'gear': { const g = find(pack.gear); return g ? [...g.from.map(f => madeOf(f.key)), ...(g.carries ? [{ packList: 'abilities' as PackList, key: g.carries }] : [])] : []; }
    case 'goods': { const g = find(pack.goods); return g ? [...g.from.map(f => madeOf(f.key)), ...(g.station ? [{ packList: 'stations' as PackList, key: g.station }] : [])] : []; }
    case 'consumables': { const c = find(pack.consumables); return c?.casts ? [{ packList: 'abilities' as PackList, key: c.casts }] : []; }
    default: return [];
  }
}

/** The first thing this entry stands on, at any depth, that the world is without; or null. */
export function standsOnRuledOut(pack: IThemeBody, packList: string, key: string, without: string[], meaningOf?: MeaningOf): string | null {
  if (without.length === 0) return null;
  const seen = new Set<string>();
  const walk = (list: string, k: string): string | null => {
    const id = `${list}|${k}`;
    if (seen.has(id)) return null;
    seen.add(id);
    const entry = ((pack as unknown as Record<string, { key: string }[] | undefined>)[list] ?? []).find(x => x.key === k);
    if (entry && ruledOut({ text: textOf(list as PackList, entry as unknown as Record<string, unknown>) }, without, meaningOf)) return String((entry as { name?: string }).name ?? k);
    for (const dep of standsOn(pack, list, k)) {
      const found = walk(dep.packList, dep.key);
      if (found) return found;
    }
    return null;
  };
  for (const dep of standsOn(pack, packList, key)) {
    const found = walk(dep.packList, dep.key);
    if (found) return found;
  }
  return null;
}

/**
 * What is offered of a list: what scores above the list's own mean (z > 0). No fixed count: the
 * pool's own spread decides, and the add step and the floors reach whatever is not offered.
 */
export const PULL_Z = 0;

/** What ranks the pool for a theme. */
export interface IPull {
  /** Every entry of the list the world can hold, nearest first. */
  near(list: PoolList, query: string, without?: string[]): Promise<IPoolEntry[]>;
  /** What one ask offers: the entries that score above their list's mean. */
  offer(list: PoolList, query: string, without?: string[]): Promise<IPoolEntry[]>;
  /** Is this new thing already in the pool? The entry it is: by its plain name, its name said first, or nearness to its words or to what it is. */
  same(list: PoolList, text: string): Promise<IPoolEntry | null>;
}

/**
 * How near, by cosine, counts as the same thing, per embedder: each places meaning on its own
 * scale. Read by the id's family, so every counted space shares one reading.
 */
export const SAME_THING_AT: Record<string, number> = { 'hashed-words': 0.9, 'counted-ppmi': 0.9, 'fake-meaning': 0.99 };
const SAME_THING_DEFAULT = 0.92;
const family = (id: string) => id.split(':')[0];

/** The pull over a pool held in memory: every installed pack, as the database gave them (`ThemeStore.loadBanked`). */
export class CountedPull implements IPull {
  private vectors: Promise<number[][]> | null = null;
  private blurbs: Promise<number[][]> | null = null;
  private readonly embedder: IEmbedder;
  /** How distinctive each entry is to the fields it lives in, beyond its count: the residual, never raw. */
  private readonly residual: number[];
  private readonly fields;

  constructor(private readonly pool: IPoolEntry[], embedder?: IEmbedder) {
    this.embedder = embedder ?? CountedEmbedder.of(pool.map(e => e.text));
    const fieldIds = [...new Set(pool.flatMap(e => e.fields))].sort();
    this.residual = concentrationResiduals(pool.map(e => fieldIds.map(f => (e.fields.includes(f) ? 1 : 0))));
    this.fields = fieldCounts(fieldIds.map(f => ({ field: f, texts: pool.filter(e => e.fields.includes(f)).map(e => e.text) })));
  }

  private all(): Promise<number[][]> {
    this.vectors ??= this.embedder.embed(this.pool.map(e => e.text));
    return this.vectors;
  }

  private async ranked(list: PoolList, query: string, without: string[]): Promise<{ e: IPoolEntry; score: number }[]> {
    const [q] = await this.embedder.embed([query]);
    const vectors = await this.all();
    const affinity = fieldAffinity(query, this.fields);
    return this.pool
      .map((e, i) => {
        const near = cosineSimilarity(q ?? [], vectors[i] ?? []);
        // Distinctive to the fields this theme resembles: their share, times how locked to them it is
        const fit = e.fields.reduce((s, f) => s + (affinity.get(f) ?? 0), 0) / e.fields.length * Math.max(0, this.residual[i]);
        return { e, score: near + fit };
      })
      .filter(x => x.e.list === list && !ruledOut(x.e, without))
      // Nearest first; the pool's own order breaks a tie, so every machine offers the same
      .sort((a, b) => b.score - a.score);
  }

  async near(list: PoolList, query: string, without: string[] = []): Promise<IPoolEntry[]> {
    return (await this.ranked(list, query, without)).map(x => x.e);
  }

  async offer(list: PoolList, query: string, without: string[] = []): Promise<IPoolEntry[]> {
    const ranked = await this.ranked(list, query, without);
    const z = zScores(ranked.map(x => x.score));
    const above = ranked.filter((_, i) => z[i] > PULL_Z);
    // A list whose scores do not spread at all says nothing apart: all of it is offered
    return (above.length ? above : ranked).map(x => x.e);
  }

  private whats(): Promise<number[][]> {
    this.blurbs ??= this.embedder.embed(this.pool.map(e => String(e.entry.blurb ?? '')));
    return this.blurbs;
  }

  async same(list: PoolList, text: string): Promise<IPoolEntry | null> {
    // The plain name of a thing the pool holds is that thing: "an oak" is the oak
    const plain = text.trim().toLowerCase().replace(/^(an?|the)\s+/, '');
    const named = this.pool.find(e => e.list === list && String(e.entry.name ?? '').toLowerCase() === plain);
    if (named) return named;
    // C19: a thing said with a pooled thing's name first, then what it is, is that thing ("Lead Dun, that knows every debtor")
    const first = this.pool.find(e => {
      const name = String(e.entry.name ?? '').toLowerCase();
      return e.list === list && name.length > 0 && plain.startsWith(name) && /^\s*[,:;(–—]/.test(plain.slice(name.length));
    });
    if (first) return first;
    // Near to its whole entry, or to what it is alone: a pooled thing's own words, copied, are that thing (C19)
    const [q] = await this.embedder.embed([text]);
    const [all, whats] = await Promise.all([this.all(), this.whats()]);
    let best: { e: IPoolEntry; near: number } | null = null;
    this.pool.forEach((e, i) => {
      if (e.list !== list) return;
      const near = Math.max(cosineSimilarity(q ?? [], all[i] ?? []), cosineSimilarity(q ?? [], whats[i] ?? []));
      if (!best || near > best.near) best = { e, near };
    });
    const at = SAME_THING_AT[family(this.embedder.id)] ?? SAME_THING_DEFAULT;
    const found = best as { e: IPoolEntry; near: number } | null;
    return found && found.near >= at ? found.e : null;
  }
}

export type { IThemeTerrain };

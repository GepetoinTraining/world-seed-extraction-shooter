/**
 * THE POOL (Q1): everything worlds already hold, sorted by what it is, for a new world
 * to pick from before anything is written. "First ML and then LLM": the pull is by
 * meaning, near the theme's description; the model then selects by id, and only then
 * adds what is missing. An oak is an oak: a thing two worlds hold, word for word, is
 * one entry here, so picking it never makes a second oak.
 *
 * The pull goes through `IPull`, so what ranks by meaning is a seam: today's hashed
 * embedder, a real one when it is chosen, or a fake in a test.
 */

import { cosineSimilarity } from '../../../entities/data/similarity';
import { EmbeddingService, IEmbedder } from '../../../services/EmbeddingService';
import { canonical } from '../ThemeCompiler';
import type { IThemeBody, IThemePack, IThemeTerrain } from '../ThemeTypes';

/** The lists a world is written from, in the order a world comes to be. */
export const POOL_LISTS = [
  'terrain', 'flora', 'fauna', 'monsters', 'professions', 'minerals', 'junk', 'anchors',
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
  for (const c of pack.creatures) put(c.tree === 'animal' ? 'fauna' : 'monsters', 'creatures', c.key, c);
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
  const seen = new Set<string>();
  const pool: IPoolEntry[] = [];
  const ordered = [...packs].sort((a, b) => a.writtenAt - b.writtenAt || (a.themeId < b.themeId ? -1 : 1));
  for (const pack of ordered) {
    for (const e of listsOf(pack)) {
      const bytes = `${e.list}:${canonical(e.entry)}`;
      if (seen.has(bytes)) continue;
      seen.add(bytes);
      pool.push({ ...e, id: `${pack.themeId.slice('theme_'.length, 'theme_'.length + 8)}.${e.list}.${e.key}`, themeId: pack.themeId });
    }
  }
  return pool;
}

/** A word and the same word with an "s" read as one, so "trees" rules out a tree. */
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

/**
 * The theme rules things out (Pedro: an airless moon gets no trees). A pooled thing whose
 * own words, tags or form carry a word the world is without is never offered.
 */
export function ruledOut(entry: Pick<IPoolEntry, 'text'>, without: string[]): boolean {
  if (without.length === 0) return false;
  const banned = new Set(without.flatMap(tokens));
  return tokens(entry.text).some(t => banned.has(t));
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
export function standsOnRuledOut(pack: IThemeBody, packList: string, key: string, without: string[]): string | null {
  if (without.length === 0) return null;
  const seen = new Set<string>();
  const walk = (list: string, k: string): string | null => {
    const id = `${list}|${k}`;
    if (seen.has(id)) return null;
    seen.add(id);
    const entry = ((pack as unknown as Record<string, { key: string }[] | undefined>)[list] ?? []).find(x => x.key === k);
    if (entry && ruledOut({ text: textOf(list as PackList, entry as unknown as Record<string, unknown>) }, without)) return String((entry as { name?: string }).name ?? k);
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

/** What ranks the pool by meaning. */
export interface IPull {
  near(list: PoolList, query: string, size: number, without?: string[]): Promise<IPoolEntry[]>;
  /** Is this new thing already in the pool? The nearest entry, when the meaning is the same thing. */
  same(list: PoolList, text: string): Promise<IPoolEntry | null>;
}

/**
 * How near, by cosine, counts as the same thing, per embedder: each places meaning on its
 * own scale. The hashed embedder counts shared words, so only near-identical words are
 * the same thing there. A real embedder brings its own reading when it is chosen.
 */
export const SAME_THING_AT: Record<string, number> = { 'hashed-words:v1': 0.9 };
const SAME_THING_DEFAULT = 0.92;

/** The pull over a pool held in memory: every installed pack, as the database gave them (`ThemeStore.loadBanked`). */
export class MeaningPull implements IPull {
  private vectors: Promise<number[][]> | null = null;

  constructor(private readonly pool: IPoolEntry[], private readonly embedder: IEmbedder = EmbeddingService.current()) {}

  private all(): Promise<number[][]> {
    this.vectors ??= this.embedder.embed(this.pool.map(e => e.text));
    return this.vectors;
  }

  private async ranked(list: PoolList, query: string): Promise<{ e: IPoolEntry; score: number }[]> {
    const [q] = await this.embedder.embed([query]);
    const vectors = await this.all();
    return this.pool
      .map((e, i) => ({ e, score: cosineSimilarity(q ?? [], vectors[i] ?? []) }))
      .filter(x => x.e.list === list)
      // Nearest first; the pool's own order breaks a tie, so every machine offers the same
      .sort((a, b) => b.score - a.score);
  }

  async near(list: PoolList, query: string, size: number, without: string[] = []): Promise<IPoolEntry[]> {
    return (await this.ranked(list, query)).filter(x => !ruledOut(x.e, without)).slice(0, size).map(x => x.e);
  }

  async same(list: PoolList, text: string): Promise<IPoolEntry | null> {
    // The plain name of a thing the pool holds is that thing: "an oak" is the oak
    const plain = text.trim().toLowerCase().replace(/^(an?|the)\s+/, '');
    const named = this.pool.find(e => e.list === list && String(e.entry.name ?? '').toLowerCase() === plain);
    if (named) return named;
    const top = (await this.ranked(list, text))[0];
    const at = SAME_THING_AT[this.embedder.id] ?? SAME_THING_DEFAULT;
    return top && top.score >= at ? top.e : null;
  }
}

export type { IThemeTerrain };

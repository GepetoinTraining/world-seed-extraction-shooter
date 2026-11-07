/**
 * LOOT AS DATA (Pedro, 2026-11-04: items and loot "should be deterministic and only updated by
 * LLM, checked"). A loot table is an atom of its own, beside a theme: a model writes it in bands
 * (what drops, how often, how many, at what rank), code turns the bands into numbers from the
 * formula, and this law judges it. Nothing else writes one: a table changes only when a model
 * writes it again, and the new words are a new table with a new id, judged again.
 *
 *   correct   the law: refuses what cannot stand, and puts wrong numbers right, as a list of
 *             changes the hub sends back as a diff (never the whole table)
 *   roll      a drop, from a table, a source and a key: the same three give the same drop on any
 *             machine, because every step is a whole number or one plain divide (D134)
 *
 * Pure: no store, no registry, no clock. The browser and the hub run the same file.
 */

import { fnv1a, Rng } from '../rng/DeterministicRNG';
import { canonical, shortIdOf } from './ThemeCompiler';
import { LOOT_COUNT_SPAN, LOOT_FORMULA_VERSION, LOOT_ODDS_PARTS, LOOT_PARTS, lootNumbers, GEAR_SHAPES, rankStep } from './ThemeFormula';
import { BIOMES, IThemeBody, RANKS, ThemeRank } from './ThemeTypes';

export const LOOT_SOURCES = ['creature', 'chest'] as const;
export const LOOT_WHAT = ['gear', 'material', 'good', 'consumable', 'junk'] as const;
export const LOOT_ODDS = Object.keys(LOOT_ODDS_PARTS) as (keyof typeof LOOT_ODDS_PARTS)[];
export const LOOT_COUNTS = Object.keys(LOOT_COUNT_SPAN) as (keyof typeof LOOT_COUNT_SPAN)[];
/** The rank a line drops at, from its source's: the same, or one step under. */
export const LOOT_RANKS = ['same', 'below'] as const;

export type LootSource = typeof LOOT_SOURCES[number];
export type LootWhat = typeof LOOT_WHAT[number];

/** A line as a model writes it: bands only. */
export interface ILootLineWords {
  what: LootWhat;
  /** A key of that kind in the theme, or empty for any of that kind at the line's rank. */
  item: string;
  odds: keyof typeof LOOT_ODDS_PARTS;
  count: keyof typeof LOOT_COUNT_SPAN;
  rank: typeof LOOT_RANKS[number];
}

/** A table as a model writes it. */
export interface ILootWords {
  name: string;
  source: LootSource;
  /** What a source must carry for this table to be its: a creature's tags, or a chest's biome. Empty fits every one. */
  fits: string[];
  lines: ILootLineWords[];
}

/** A line with its numbers. */
export interface ILootLine extends ILootLineWords { chance: number; low: number; high: number }

export interface ILootTable extends Omit<ILootWords, 'lines'> {
  id: string;
  themeId: string;
  formula: number;
  lines: ILootLine[];
}

/** What a table can name, from its theme, each with its rank. */
export type ILootItems = Record<LootWhat, { key: string; rank: ThemeRank; id: string }[]>;

/** One thing a roll dropped. `id` is the compiled definition it mints from. */
export interface IDropLine { line: number; what: LootWhat; key: string; id: string; rank: ThemeRank; count: number }

export interface ILootChange { line: number; field: 'chance' | 'low' | 'high'; value: number }

const has = (values: readonly string[], v: unknown): boolean => typeof v === 'string' && values.includes(v);

/** The words alone, in one order: what a table's id is computed from. */
export const wordsOf = (t: ILootWords): ILootWords => ({
  name: t.name, source: t.source, fits: [...t.fits],
  lines: t.lines.map(l => ({ what: l.what, item: l.item, odds: l.odds, count: l.count, rank: l.rank }))
});

/** From its words and its theme, and nothing else. Two hashes, as a theme's id is. */
export function lootIdOf(themeId: string, words: ILootWords): string {
  const bytes = `${themeId}|${canonical(wordsOf(words))}`;
  const a = fnv1a(`loot:a:${bytes}`).toString(16).padStart(8, '0');
  const b = fnv1a(`loot:b:${bytes}`).toString(16).padStart(8, '0');
  return `loot_${a}${b}`;
}

/** A table from a model's words: numbers from the formula, id from the words. */
export function sealLoot(themeId: string, words: ILootWords): ILootTable {
  const w = wordsOf(words);
  return { ...w, id: lootIdOf(themeId, w), themeId, formula: LOOT_FORMULA_VERSION, lines: w.lines.map(l => ({ ...l, ...lootNumbers(l) })) };
}

/** What a theme's tables can name. Sorted by key, so a pick is the same pick everywhere. */
export function lootItemsOf(pack: Pick<IThemeBody, 'gear' | 'materials' | 'goods' | 'consumables' | 'junk'> & { themeId: string }): ILootItems {
  const sid = shortIdOf(pack.themeId);
  const idOf = (prefix: string, key: string) => `${prefix}_${sid}_${key}`;
  const gearPrefix = (kind: keyof typeof GEAR_SHAPES) => {
    const bucket = GEAR_SHAPES[kind].bucket;
    return bucket === 'weapon_bases' ? 'wpn' : bucket === 'tool_bases' ? 'tool' : 'arm';
  };
  const byKey = <T extends { key: string }>(list: T[]) => [...list].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    // Only what is found: gear that is made comes from its chain, never from a drop
    gear: byKey(pack.gear.filter(g => g.craftAt === 'none')).map(g => ({ key: g.key, rank: g.rank, id: idOf(gearPrefix(g.kind), g.key) })),
    material: byKey(pack.materials).map(m => ({ key: m.key, rank: m.rank, id: idOf('res', m.key) })),
    good: byKey(pack.goods).map(g => ({ key: g.key, rank: g.rank, id: idOf('crf', g.key) })),
    consumable: byKey(pack.consumables).map(c => ({ key: c.key, rank: c.rank, id: idOf('con', c.key) })),
    junk: byKey(pack.junk).map(j => ({ key: j.key, rank: j.rank, id: idOf('jnk', j.key) }))
  };
}

export type ILootVerdict =
  | { ok: true; reason?: undefined; table: ILootTable; changes: ILootChange[] }
  | { ok: false; reason: string; table?: undefined; changes?: undefined };

const no = (reason: string): ILootVerdict => ({ ok: false, reason });

export const LootLaw = {
  /**
   * The law. Refused whole when a word is not one this game knows, a line names a thing its theme
   * does not hold, or the table could never be anyone's. Numbers that are not the formula's are
   * put right, and each one put right is listed.
   */
  correct(table: unknown, pack: IThemeBody & { themeId: string }): ILootVerdict {
    const t = table as ILootTable;
    if (!t || typeof t !== 'object') return no('That is not a loot table.');
    if (t.themeId !== pack.themeId) return no('Its theme is not the theme it was checked against.');
    if (typeof t.name !== 'string' || !t.name.trim()) return no('A table has a name.');
    if (!has(LOOT_SOURCES, t.source)) return no(`A table drops from ${LOOT_SOURCES.join(' or ')}.`);
    if (!Array.isArray(t.fits) || t.fits.some(f => typeof f !== 'string')) return no('What a table fits is a list of words.');
    if (!Array.isArray(t.lines) || t.lines.length === 0) return no('A table drops something: it has at least one line.');
    if (t.formula !== LOOT_FORMULA_VERSION) return no(`This hub checks loot under formula ${LOOT_FORMULA_VERSION}.`);

    if (t.source === 'chest') {
      const odd = t.fits.find(f => !has(BIOMES, f));
      if (odd) return no(`A chest's table fits a land, and "${odd}" is not one.`);
    } else if (t.fits.length > 0) {
      const tags = new Set(pack.creatures.flatMap(c => c.tags));
      if (!t.fits.some(f => tags.has(f))) return no('No creature in its theme carries what it fits, so it would never drop.');
    }

    const items = lootItemsOf(pack);
    for (let i = 0; i < t.lines.length; i++) {
      const l = t.lines[i];
      if (!l || typeof l !== 'object') return no(`Line ${i + 1} is not a line.`);
      if (!has(LOOT_WHAT, l.what)) return no(`Line ${i + 1} drops ${String(l.what)}, which is not one of ${LOOT_WHAT.join(', ')}.`);
      if (!has(LOOT_ODDS, l.odds)) return no(`Line ${i + 1}: odds are one of ${LOOT_ODDS.join(', ')}.`);
      if (!has(LOOT_COUNTS, l.count)) return no(`Line ${i + 1}: a count is one of ${LOOT_COUNTS.join(', ')}.`);
      if (!has(LOOT_RANKS, l.rank)) return no(`Line ${i + 1}: a rank is ${LOOT_RANKS.join(' or ')}.`);
      if (typeof l.item !== 'string') return no(`Line ${i + 1}: an item is a key, or empty.`);
      if (l.item && !items[l.what].some(x => x.key === l.item)) return no(`Line ${i + 1} names ${l.item}, which its theme does not hold as ${l.what}.`);
      if (!l.item && items[l.what].length === 0) return no(`Line ${i + 1} drops any ${l.what}, and its theme holds none that is found.`);
    }

    // The id is the words': a table written again is a new table
    if (t.id !== lootIdOf(t.themeId, t)) return no('Its id does not match its words.');

    const changes: ILootChange[] = [];
    const lines = t.lines.map((l, i) => {
      const n = lootNumbers(l);
      for (const field of ['chance', 'low', 'high'] as const) if (l[field] !== n[field]) changes.push({ line: i, field, value: n[field] });
      return { ...wordsOf({ ...t, lines: [l] }).lines[0], ...n };
    });
    return { ok: true, table: { ...wordsOf(t), id: t.id, themeId: t.themeId, formula: t.formula, lines }, changes };
  },

  /** Does this table belong to this source? How many of its words the source carries; 0 is no. */
  fit(table: Pick<ILootTable, 'source' | 'fits'>, source: { kind: LootSource; tags: string[] }): number {
    if (table.source !== source.kind) return 0;
    if (table.fits.length === 0) return 1;
    const matched = table.fits.filter(f => source.tags.includes(f)).length;
    return matched === 0 ? 0 : 1 + matched;
  },

  /** The table a source rolls on: the one that fits it most, then the lowest id. None is the old code's. */
  pick<T extends Pick<ILootTable, 'id' | 'source' | 'fits'>>(tables: T[], source: { kind: LootSource; tags: string[] }): T | undefined {
    let best: T | undefined;
    let bestFit = 0;
    for (const t of [...tables].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const f = LootLaw.fit(t, source);
      if (f > bestFit) { best = t; bestFit = f; }
    }
    return best;
  },

  /**
   * A drop. Every line draws the same three numbers whether it drops or not, so one line never
   * moves another. Whole numbers and one plain divide (the stream's own), nothing else: the hub
   * reruns this and must land where the player did.
   */
  roll(table: ILootTable, rank: ThemeRank | string, key: string, items: ILootItems): IDropLine[] {
    const rng = Rng.fromKey(`${key}:loot:${table.id}`);
    const at = Math.max(0, RANKS.indexOf(rank as ThemeRank));
    const out: IDropLine[] = [];
    table.lines.forEach((l, i) => {
      const hit = rng.int(0, LOOT_PARTS) < l.chance;
      const count = l.low + rng.int(0, l.high - l.low + 1);
      const draw = rng.int(0, LOOT_PARTS);
      if (!hit) return;
      const target = l.rank === 'below' ? Math.max(0, at - 1) : at;
      const thing = l.item ? items[l.what].find(x => x.key === l.item) : nearest(items[l.what], target, draw);
      if (thing) out.push({ line: i, what: l.what, key: thing.key, id: thing.id, rank: thing.rank, count });
    });
    return out;
  }
};

/** Of a kind, those at the rank asked for; if none, the nearest under it; if none, the nearest over. */
function nearest(list: ILootItems[LootWhat], target: number, draw: number) {
  if (list.length === 0) return undefined;
  const step = (r: ThemeRank) => rankStep(r);
  const under = list.filter(x => step(x.rank) <= target);
  const pool = under.length > 0 ? under : list;
  const best = under.length > 0 ? Math.max(...pool.map(x => step(x.rank))) : Math.min(...pool.map(x => step(x.rank)));
  const at = pool.filter(x => step(x.rank) === best);
  return at[draw % at.length];
}

// -------------------------------------------------------------------------
// What the model is asked, and the shape its answer takes
// -------------------------------------------------------------------------

const str = { type: 'string' };
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

export const LOOT_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['tables'],
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'source', 'fits', 'lines'],
        properties: {
          name: str,
          source: oneOf(LOOT_SOURCES),
          fits: { type: 'array', items: str },
          lines: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['what', 'item', 'odds', 'count', 'rank'],
              properties: { what: oneOf(LOOT_WHAT), item: str, odds: oneOf(LOOT_ODDS), count: oneOf(LOOT_COUNTS), rank: oneOf(LOOT_RANKS) }
            }
          }
        }
      }
    }
  }
};

/** What a theme offers a table, in words: its creatures with their tags, and what can be found. */
export function lootAskOf(pack: IThemeBody & { themeId: string }, refused?: string) {
  const items = lootItemsOf(pack);
  return {
    themeId: pack.themeId,
    name: pack.name,
    creatures: pack.creatures.map(c => ({ key: c.key, name: c.name, rank: c.rank, tags: c.tags })),
    lands: [...BIOMES],
    found: Object.fromEntries(Object.entries(items).map(([what, list]) => [what, list.map(x => `${x.key} (${x.rank})`)])),
    ...(refused ? { refused } : {})
  };
}

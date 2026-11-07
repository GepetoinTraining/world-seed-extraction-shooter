/**
 * COUNTING, NOT A MODEL (Pedro, 2026-11-04: "or none at all"): where a world's pull needs
 * nearness, it is counted from what worlds already hold, as data v2 places its words by
 * their own cycles (`lettersacrosssubstrate`: DATA-V2.md, rig/export-data-v2.py,
 * EMBEDDER-DERIVATION.md). Nothing is installed, downloaded or rented, and the same pool
 * counts the same on every machine.
 *
 * - Nearness: positive pointwise mutual information over the entries' own words and tags,
 *   with context smoothing (0.75) and frequent words weighed down, so a word every entry
 *   shares is no hub. A text is its words' rows added up.
 * - Distinctive to a field: the log-odds of a word in one field against all the others, with
 *   an informative Dirichlet prior, as a z score (Monroe et al. 2008, the export's own formula).
 * - Fits anywhere: field concentration, 1 - H(field | thing) / log F, read as its residual
 *   against what its own count would give, never raw: a thing seen once is concentrated by
 *   rarity alone, and says nothing.
 */

import { fnv1a } from '../../rng/DeterministicRNG';
import { EmbeddingService, HASHED_EMBEDDER, IEmbedder } from '../../../services/EmbeddingService';

/** Context smoothing: the counted contexts' distribution raised to this, so rare contexts do not inflate PMI. */
export const CONTEXT_SMOOTHING = 0.75;
/** Frequent words weigh sqrt(t / f) of themselves, where f is their share of all words. Mikolov's t, for small corpora. */
export const SUBSAMPLE_T = 1e-3;
/** The Dirichlet prior's strength, as a share of each word's count over every field (the export's a0). */
export const PRIOR_A0 = 0.01;

/** Words as they are counted: lowercase runs of letters and digits, a word and its plural as one. */
export function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1).map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

const normalize = (v: number[]) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map(x => x / n);
};

/**
 * The counted embedder: a vector in two channels of equal weight. The surface channel is the
 * words themselves (today's hashed bag, stable), so a shared word is always near; the counted
 * channel is PPMI over the pool, so words that keep the same company are near too. Their
 * cosine is the mean of the two channels' cosines. Its id carries the corpus it was counted
 * from: a pool that grows is a new space, and vectors across two spaces are never compared.
 */
export class CountedEmbedder implements IEmbedder {
  readonly id: string;
  readonly dims: number;
  private index = new Map<string, number>();
  private rows: Map<number, number>[] = [];
  private weight: number[] = [];

  private constructor(corpus: string[]) {
    const docs = corpus.map(t => [...new Set(words(t))]);
    const count = new Map<string, number>();
    for (const d of docs) for (const w of d) count.set(w, (count.get(w) ?? 0) + 1);
    // Sorted, so the same pool gives the same axes on every machine
    const vocab = [...count.keys()].sort();
    vocab.forEach((w, i) => this.index.set(w, i));
    const total = vocab.reduce((s, w) => s + count.get(w)!, 0) || 1;
    this.weight = vocab.map(w => Math.min(1, Math.sqrt(SUBSAMPLE_T / (count.get(w)! / total))));

    // Co-occurrence: two words in one entry keep each other's company, weighed down when frequent
    const pair = vocab.map(() => new Map<number, number>());
    for (const d of docs) {
      const ids = d.map(w => this.index.get(w)!);
      for (const a of ids) for (const b of ids) {
        if (a === b) continue;
        pair[a].set(b, (pair[a].get(b) ?? 0) + this.weight[a] * this.weight[b]);
      }
    }
    const rowSum = pair.map(r => [...r.values()].reduce((s, x) => s + x, 0));
    const ctx = vocab.map((_, c) => Math.pow(pair[c] ? [...pair[c].values()].reduce((s, x) => s + x, 0) : 0, CONTEXT_SMOOTHING));
    const all = rowSum.reduce((s, x) => s + x, 0) || 1;
    const ctxAll = ctx.reduce((s, x) => s + x, 0) || 1;
    this.rows = pair.map((r, w) => {
      const out = new Map<number, number>();
      for (const [c, n] of r) {
        const pmi = Math.log((n / all) / ((rowSum[w] / all) * (ctx[c] / ctxAll)));
        if (pmi > 0) out.set(c, pmi);
      }
      return out;
    });
    this.dims = HASHED_EMBEDDER.dims + vocab.length;
    this.id = `counted-ppmi:v1:${fnv1a(vocab.join(' ') + '|' + corpus.length).toString(16)}:${fnv1a(corpus.join('\n')).toString(16)}`;
  }

  static of(corpus: string[]): CountedEmbedder {
    return new CountedEmbedder(corpus);
  }

  /** A text's counted channel: the PPMI rows of its words, added up, each word weighed as it was counted. */
  private counted(text: string): number[] {
    const v = new Array(this.dims - HASHED_EMBEDDER.dims).fill(0);
    for (const w of new Set(words(text))) {
      const i = this.index.get(w);
      if (i === undefined) continue;
      v[i] += this.weight[i];
      for (const [c, x] of this.rows[i]) v[c] += x * this.weight[i];
    }
    return normalize(v);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const surface = await HASHED_EMBEDDER.embed(texts);
    const half = Math.SQRT1_2;
    return texts.map((t, i) => [...surface[i].map(x => x * half), ...this.counted(t).map(x => x * half)]);
  }
}

/**
 * Log-odds with an informative Dirichlet prior, z-scored (rig/export-data-v2.py). How much more
 * a word belongs to field `f` than to every other field together. Positive is distinctive.
 */
export function logOddsZ(y1: number, n1: number, y2: number, n2: number, globalCount: number, globalTotal: number): number {
  const aw = PRIOR_A0 * globalCount;
  const A = PRIOR_A0 * globalTotal;
  if (y1 + aw <= 0 || y2 + aw <= 0) return 0;
  const delta = Math.log((y1 + aw) / (n1 + A - y1 - aw)) - Math.log((y2 + aw) / (n2 + A - y2 - aw));
  return delta / Math.sqrt(1 / (y1 + aw) + 1 / (y2 + aw));
}

/** A field's words, counted. */
export interface IFieldCounts { field: string; counts: Map<string, number>; total: number }

export function fieldCounts(fields: { field: string; texts: string[] }[]): IFieldCounts[] {
  return fields.map(f => {
    const counts = new Map<string, number>();
    for (const t of f.texts) for (const w of words(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
    return { field: f.field, counts, total: [...counts.values()].reduce((s, x) => s + x, 0) };
  });
}

/**
 * How much a text belongs to each field: the sum of its words' positive log-odds z in that field,
 * as shares. With one field, or none of its words distinctive anywhere, every field weighs alike.
 */
export function fieldAffinity(text: string, fields: IFieldCounts[]): Map<string, number> {
  const global = new Map<string, number>();
  for (const f of fields) for (const [w, n] of f.counts) global.set(w, (global.get(w) ?? 0) + n);
  const gTotal = fields.reduce((s, f) => s + f.total, 0);
  const said = [...new Set(words(text))];
  const score = new Map<string, number>();
  for (const f of fields) {
    let s = 0;
    if (fields.length > 1) {
      for (const w of said) {
        const y1 = f.counts.get(w) ?? 0;
        const g = global.get(w) ?? 0;
        if (y1 === 0) continue;
        const z = logOddsZ(y1, f.total, g - y1, gTotal - f.total, g, gTotal);
        if (z > 0) s += z;
      }
    }
    score.set(f.field, s);
  }
  const sum = [...score.values()].reduce((a, b) => a + b, 0);
  for (const f of fields) score.set(f.field, sum > 0 ? score.get(f.field)! / sum : 1 / Math.max(1, fields.length));
  return score;
}

/** 1 - H(field | thing) / log F, from how often a thing appears in each field. Zero with fewer than two fields. */
export function concentration(presence: number[]): number {
  const F = presence.length;
  const n = presence.reduce((s, x) => s + x, 0);
  if (F < 2 || n === 0) return 0;
  let h = 0;
  for (const x of presence) if (x > 0) h -= (x / n) * Math.log(x / n);
  return 1 - h / Math.log(F);
}

/**
 * Concentration less what a thing's own count would give: the mean concentration of things seen
 * as often (the chord work's noise-floor correction, binned by count). A thing seen once is
 * concentrated by rarity and nothing else, so its residual is zero.
 */
export function concentrationResiduals(presences: number[][]): number[] {
  const raw = presences.map(concentration);
  const seen = presences.map(p => p.reduce((s, x) => s + x, 0));
  const byCount = new Map<number, number[]>();
  raw.forEach((c, i) => byCount.set(seen[i], [...(byCount.get(seen[i]) ?? []), c]));
  const floor = new Map([...byCount].map(([n, cs]) => [n, cs.reduce((s, x) => s + x, 0) / cs.length]));
  return raw.map((c, i) => c - floor.get(seen[i])!);
}

/** Scores as z against their own list: how far above the list's own mean. */
export function zScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length);
  return scores.map(x => (sd === 0 ? 0 : (x - mean) / sd));
}

export { EmbeddingService };

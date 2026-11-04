/**
 * EMBEDDING SERVICE
 *
 * Text becomes a vector here, through one seam (`IEmbedder`). Each embedder names itself
 * and its version, so vectors from two embedders are never compared: a different id is a
 * different space.
 *
 * No model fills it (Pedro, 2026-11-04: "or none at all"). Where nearness is needed, a
 * world's pull, it is counted from the pool (`CountedEmbedder`, theme/writing/Counting): PPMI
 * over the entries' own words, with this hashed bag as its surface channel. What the store
 * saves stays on the hashed bag alone (D46): a counted space moves with every world banked,
 * and a stored vector has no column yet to say which space it was counted in.
 */

import { cosineSimilarity } from '../entities/data/similarity';

/** What turns text into vectors. Same text and same id, same vector. */
export interface IEmbedder {
  /** Which embedder and which version: vectors with different ids live in different spaces. */
  readonly id: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

const LOCAL_EMBED_DIMS = 256;

/**
 * Deterministic local embedding: each token is hashed into one of LOCAL_EMBED_DIMS buckets,
 * counted, then L2-normalized. Not as smart as a real model, but stable and offline.
 */
function hashedEmbed(text: string): number[] {
  const vec = new Array(LOCAL_EMBED_DIMS).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);

  for (const token of tokens) {
    // FNV-1a hash
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    vec[(hash >>> 0) % LOCAL_EMBED_DIMS] += 1;
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map(v => parseFloat((v / norm).toFixed(6)));
}

/** D46: today's embedder. Shared words read as similar, and nothing else does. */
export const HASHED_EMBEDDER: IEmbedder = {
  id: 'hashed-words:v1',
  dims: LOCAL_EMBED_DIMS,
  embed: async (texts: string[]) => texts.map(hashedEmbed)
};

let current: IEmbedder = HASHED_EMBEDDER;

const clean = (text: string) => text.replace(/\n/g, ' ').trim();

export class EmbeddingService {

  /** The embedder every vector comes from from now on. */
  static use(embedder: IEmbedder): void {
    current = embedder;
  }

  static current(): IEmbedder {
    return current;
  }

  /**
   * Get vector embedding for a single text string.
   */
  static async embed(text: string): Promise<number[]> {
    if (!text || !text.trim()) return [];
    return (await current.embed([clean(text)]))[0] ?? [];
  }

  /** Many at once: a real embedder answers a batch in one call. An empty text has no vector. */
  static async embedMany(texts: string[]): Promise<number[][]> {
    const live = texts.map((t, i) => ({ t: t ? clean(t) : '', i })).filter(x => x.t);
    const out: number[][] = texts.map(() => []);
    if (live.length === 0) return out;
    const vectors = await current.embed(live.map(x => x.t));
    live.forEach((x, n) => { out[x.i] = vectors[n] ?? []; });
    return out;
  }

  /** Today's hashed embedding, by name: what D46's goldens pin. */
  static localEmbed(text: string): number[] {
    return hashedEmbed(text);
  }

  /**
   * Calculate Cosine Similarity between two vectors
   */
  static cosineSimilarity(vecA: number[] | readonly number[], vecB: number[] | readonly number[]): number {
    return cosineSimilarity(vecA, vecB);
  }
}

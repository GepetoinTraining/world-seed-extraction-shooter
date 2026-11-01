/**
 * EMBEDDING SERVICE
 * A deterministic local hashed bag-of-words embedding: same text, same vector, and
 * shared words read as similar. Nothing in play needs better today (D46).
 */

import { cosineSimilarity } from '../entities/data/similarity';

const LOCAL_EMBED_DIMS = 256;

export class EmbeddingService {

  /**
   * Get vector embedding for a single text string.
   */
  static async embed(text: string): Promise<number[]> {
    if (!text || !text.trim()) return [];

    // Clean text to save tokens
    const cleanText = text.replace(/\n/g, " ").trim();

    return this.localEmbed(cleanText);
  }

  /**
   * Deterministic local embedding: each token is hashed into one of
   * LOCAL_EMBED_DIMS buckets, counted, then L2-normalized.
   * Not as smart as a real model, but gives stable cosine similarity offline.
   */
  static localEmbed(text: string): number[] {
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

  /**
   * Calculate Cosine Similarity between two vectors
   */
  static cosineSimilarity(vecA: number[] | readonly number[], vecB: number[] | readonly number[]): number {
    return cosineSimilarity(vecA, vecB);
  }
}
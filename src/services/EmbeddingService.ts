/**
 * EMBEDDING SERVICE
 * Converts text into 768-dimensional vectors using Gemini.
 */

// Safe environment variable access for Vite/React
const API_KEY = (globalThis as any).process?.env?.GEMINI_API_KEY || import.meta.env?.VITE_GEMINI_API_KEY;

import { cosineSimilarity } from '../entities/data/similarity';

const LOCAL_EMBED_DIMS = 256;
let warnedLocalMode = false;

export class EmbeddingService {

  /**
   * Get vector embedding for a single text string.
   * Uses Gemini when VITE_GEMINI_API_KEY is set; otherwise falls back to a
   * deterministic local hashed bag-of-words embedding so the Vector DB
   * works fully offline (same text -> same vector, shared words -> similar vectors).
   */
  static async embed(text: string): Promise<number[]> {
    if (!text || !text.trim()) return [];

    // Clean text to save tokens
    const cleanText = text.replace(/\n/g, " ").trim();

    if (!API_KEY) {
      if (!warnedLocalMode) {
        console.warn('[EMBED] No VITE_GEMINI_API_KEY set. Using local hash embeddings (offline mode).');
        warnedLocalMode = true;
      }
      return this.localEmbed(cleanText);
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${API_KEY}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text: cleanText }] }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini Embedding Error: ${response.status}`);
      }

      const data = await response.json();
      return data.embedding.values; // Returns [0.123, -0.456, ...]

    } catch (e) {
      console.error("[EMBED] Gemini failed, falling back to local embedding:", e);
      return this.localEmbed(cleanText);
    }
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
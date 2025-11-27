/**
 * EMBEDDING SERVICE
 * Converts text into 768-dimensional vectors using Gemini.
 */

// Safe environment variable access for Vite/React
const API_KEY = (window as any).process?.env?.GEMINI_API_KEY || import.meta.env?.VITE_GEMINI_API_KEY;

export class EmbeddingService {
  
  /**
   * Get vector embedding for a single text string
   */
  static async embed(text: string): Promise<number[]> {
    if (!text || !text.trim()) return [];

    // Clean text to save tokens
    const cleanText = text.replace(/\n/g, " ").trim();

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
      console.error("[EMBED] Failed to generate vector:", e);
      return []; // Fail gracefully
    }
  }

  /**
   * Calculate Cosine Similarity between two vectors
   * Updated to accept 'readonly' arrays to work with RxDB
   */
  static cosineSimilarity(vecA: number[] | readonly number[], vecB: number[] | readonly number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
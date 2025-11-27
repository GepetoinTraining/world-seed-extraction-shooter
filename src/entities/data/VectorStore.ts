import { IItem } from '../../../types';
import { getDatabase, VectorDocType } from './RxDBClient';
import { EmbeddingService } from '../../services/EmbeddingService';

// ============================================================================
// TYPES
// ============================================================================

export enum VectorNamespace {
  CHARACTERS = 'characters',
  ITEMS = 'items',
  WORLDS = 'worlds',
  TRANSACTIONS = 'transactions',
  CONTENT = 'content',
  TERRITORIES = 'territories'
}

export interface IVectorDocument<T = any> {
  id: string;
  namespace: VectorNamespace;
  data: T;
  embedding?: number[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    ownerCertUid?: string;
    signature?: string;
    version: number;
  };
}

export interface IQueryOptions {
  namespace: VectorNamespace;
  filter?: Record<string, any>;
  limit?: number;
}

export interface ISemanticSearchOptions extends IQueryOptions {
  query: string;
  similarityThreshold?: number; // 0-1, default 0.7
}

// ============================================================================
// RXDB BACKEND IMPLEMENTATION
// ============================================================================

export class VectorStore {
  
  // --- CRUD OPERATIONS ---

  static async put<T>(doc: IVectorDocument<T>, shouldEmbed: boolean = false): Promise<boolean> {
    try {
      const db = await getDatabase();
      
      // OPTIONAL: Generate Embedding on Save
      // Useful for Items/Lore descriptions
      let embedding = doc.embedding;
      if (shouldEmbed && !embedding && typeof doc.data === 'object') {
        // Create a string representation for embedding
        const textToEmbed = JSON.stringify((doc.data as any).description || (doc.data as any).name || doc.data);
        embedding = await EmbeddingService.embed(textToEmbed);
      }

      await db.vectors.upsert({
        ...doc,
        embedding: embedding || []
      });
      
      return true;
    } catch (e) {
      console.error('[VECTOR] Put failed:', e);
      return false;
    }
  }

  static async get<T>(namespace: VectorNamespace, id: string): Promise<IVectorDocument<T> | null> {
    try {
      const db = await getDatabase();
      const doc = await db.vectors.findOne(id).exec();
      return doc ? (doc.toJSON() as IVectorDocument<T>) : null;
    } catch (e) {
      console.error('[VECTOR] Get failed:', e);
      return null;
    }
  }

  // --- SEARCH OPERATIONS ---

  /**
   * Standard Metadata Query (Fast, Exact)
   */
  static async query<T>(options: IQueryOptions): Promise<IVectorDocument<T>[]> {
    try {
      const db = await getDatabase();
      // Basic RxDB/Mongo query style
      const queryObj: any = {
        selector: {
          namespace: options.namespace,
          ...options.filter // e.g. { 'metadata.ownerCertUid': 'abc' }
        }
      };
      
      if (options.limit) queryObj.limit = options.limit;

      const docs = await db.vectors.find(queryObj).exec();
      return docs.map(d => d.toJSON() as IVectorDocument<T>);
    } catch (e) {
      console.error('[VECTOR] Query failed:', e);
      return [];
    }
  }

  /**
   * Semantic Vector Search (The "Magic")
   * Performs Client-Side Cosine Similarity
   */
  static async semanticSearch<T>(options: ISemanticSearchOptions): Promise<IVectorDocument<T>[]> {
    try {
      const db = await getDatabase();
      
      // 1. Get Query Vector
      const queryVector = await EmbeddingService.embed(options.query);
      if (queryVector.length === 0) return [];

      // 2. Fetch Candidates (Filter by Namespace first to reduce load)
      const candidates = await db.vectors.find({
        selector: {
          namespace: options.namespace
        }
      }).exec();

      // 3. Rank by Similarity
      const results = candidates
        .map(doc => {
          const docData = doc.toJSON();
          // FIX: Use .slice() to create a mutable copy of the array if needed, 
          // though EmbeddingService now accepts readonly arrays too.
          // The '|| []' handles potential nulls.
          const docVector = docData.embedding ? docData.embedding : [];
          
          const similarity = EmbeddingService.cosineSimilarity(queryVector, docVector);
          
          return { doc: docData as IVectorDocument<T>, score: similarity };
        })
        .filter(item => item.score >= (options.similarityThreshold || 0.6)) // Filter low relevance
        .sort((a, b) => b.score - a.score) // Sort desc
        .slice(0, options.limit || 10); // Top N

      return results.map(r => r.doc);

    } catch (e) {
      console.error('[VECTOR] Semantic search failed:', e);
      return [];
    }
  }

  // --- SPECIFIC HELPERS ---

  static async saveItem(item: IItem, ownerCertUid: string): Promise<boolean> {
    return this.put({
      id: item.id,
      namespace: VectorNamespace.ITEMS,
      data: item,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid,
        version: 1,
        signature: ''
      }
    }, true); 
  }

  static async saveContent<T>(id: string, contentType: string, content: T, genre?: string): Promise<boolean> {
    return this.put({
      id,
      namespace: VectorNamespace.CONTENT,
      data: { type: contentType, genre, content },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: 'SYSTEM',
        version: 1,
        signature: ''
      }
    }, true); 
  }
  
  static async searchContent<T>(contentType: string, genre?: string, semanticQuery?: string): Promise<T[]> {
    if (semanticQuery) {
        const results = await this.semanticSearch<{ type: string; genre?: string; content: T }>({
            namespace: VectorNamespace.CONTENT,
            query: semanticQuery,
            similarityThreshold: 0.65
        });
        return results
            .filter(r => r.data.type === contentType)
            .map(r => r.data.content);
    }

    const filter: any = { 'data.type': contentType };
    if (genre) filter['data.genre'] = genre;
    
    const results = await this.query<{ type: string; genre?: string; content: T }>({
        namespace: VectorNamespace.CONTENT,
        filter
    });
    return results.map(r => r.data.content);
  }
}
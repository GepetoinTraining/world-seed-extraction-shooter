import { IItem } from '../../types';
import { StoreClient } from './StoreClient';
import { StoreUnit } from './StoreUnit';
import { IWireDoc } from './wire';
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
  /** A literal prefix of the id. Lets the database skip the rest of a namespace. */
  idPrefix?: string;
  limit?: number;
}

export interface IPutOptions {
  /** Join this unit: the write waits for unit.commit(), and lands with the unit's other writes or not at all. */
  unit?: StoreUnit;
  /** A treasury credit: the database adds this to what it holds, whatever this client last read. */
  increment?: number;
  /** Insert, or leave alone what is already there. */
  ifAbsent?: boolean;
}

export interface ISemanticSearchOptions extends IQueryOptions {
  query: string;
  similarityThreshold?: number; // 0-1, default 0.7
}

// ============================================================================
// THE SQL BACKEND (D31): the database server, reached over HTTP
// ============================================================================

function toWire(doc: IVectorDocument<any>, embedding?: number[]): IWireDoc {
  return {
    id: doc.id,
    namespace: doc.namespace,
    // Once, here. Signatures cover this exact text, so it is never parsed and rewritten on the way.
    dataText: JSON.stringify(doc.data),
    ...(embedding && embedding.length > 0 ? { embedding } : {}),
    metadata: doc.metadata
  };
}

function fromWire<T>(doc: IWireDoc): IVectorDocument<T> {
  return {
    id: doc.id,
    namespace: doc.namespace as VectorNamespace,
    data: JSON.parse(doc.dataText) as T,
    ...(doc.embedding ? { embedding: doc.embedding } : {}),
    metadata: doc.metadata
  };
}

/**
 * The same interface it always was, on a real database. What changed underneath:
 * a read that cannot reach the server waits (see StoreClient) rather than saying
 * "nothing there", and only the server's own refusal comes back as a failure.
 */
export class VectorStore {

  // --- CRUD OPERATIONS ---

  static async put<T>(doc: IVectorDocument<T>, shouldEmbed: boolean = false, options: IPutOptions = {}): Promise<boolean> {
    // OPTIONAL: Generate Embedding on Save
    // Useful for Items/Lore descriptions
    let embedding = doc.embedding;
    if (shouldEmbed && !embedding && typeof doc.data === 'object') {
      // Create a string representation for embedding
      const textToEmbed = JSON.stringify((doc.data as any).description || (doc.data as any).name || doc.data);
      embedding = await EmbeddingService.embed(textToEmbed);
    }

    const unit = options.unit ?? new StoreUnit();
    if (options.increment !== undefined) {
      unit.add({ kind: 'add', namespace: doc.namespace, id: doc.id, amount: options.increment, at: doc.metadata.updatedAt });
    } else {
      unit.add({ kind: options.ifAbsent ? 'putIfAbsent' : 'put', doc: toWire(doc, embedding) });
    }
    if (options.unit) return true;

    const result = await unit.commit();
    if (!result.ok) console.error(`[VECTOR] The store refused ${doc.id}:`, result.reason);
    return result.ok;
  }

  static async get<T>(_namespace: VectorNamespace, id: string): Promise<IVectorDocument<T> | null> {
    const doc = await StoreClient.get(id);
    return doc ? fromWire<T>(doc) : null;
  }

  // --- SEARCH OPERATIONS ---

  /**
   * Standard Metadata Query (Fast, Exact)
   */
  static async query<T>(options: IQueryOptions): Promise<IVectorDocument<T>[]> {
    const docs = await StoreClient.query({
      namespace: options.namespace,
      ...(options.filter ? { filter: options.filter } : {}), // e.g. { 'metadata.ownerCertUid': 'abc' }
      ...(options.idPrefix ? { idPrefix: options.idPrefix } : {}),
      ...(options.limit ? { limit: options.limit } : {})
    });
    return docs.map(d => fromWire<T>(d));
  }

  /**
   * Semantic Vector Search (The "Magic")
   * The server ranks by cosine similarity. At deploy this is where pgvector
   * goes, behind this same call (see shared/schema.pg.ts).
   */
  static async semanticSearch<T>(options: ISemanticSearchOptions): Promise<IVectorDocument<T>[]> {
    // 1. Get Query Vector
    const queryVector = await EmbeddingService.embed(options.query);
    if (queryVector.length === 0) return [];

    // 2. Rank by Similarity, in the namespace, above the threshold
    const docs = await StoreClient.search({
      namespace: options.namespace,
      vector: queryVector,
      threshold: options.similarityThreshold || 0.6,
      limit: options.limit || 10
    });
    return docs.map(d => fromWire<T>(d));
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
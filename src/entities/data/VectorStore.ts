/**
 * VECTOR STORE
 * Universal data layer for World Seed
 * 
 * Design:
 * - ALL game data flows through here
 * - Every object has a vector embedding for semantic search
 * - Certificate UIDs are the primary keys
 * - Supports multiple backends (local, Pinecone, Weaviate, etc.)
 * 
 * This is an abstraction layer - actual vector DB calls would go to your backend
 */

import { IItem, UniversalRank } from '../../../types';
import { IPlayerCertificate, ISignedPayload } from '../identity/CertificateSystem';

// ============================================================================
// TYPES
// ============================================================================

export enum VectorNamespace {
  CHARACTERS = 'characters',    // Player state vectors
  ITEMS = 'items',              // Item definition vectors
  WORLDS = 'worlds',            // World seed vectors
  TRANSACTIONS = 'transactions', // Audit trail
  CONTENT = 'content',          // Generated content (mobs, affixes, etc.)
  TERRITORIES = 'territories'   // Owned chunks
}

export interface IVectorDocument<T = any> {
  id: string;                   // Primary key (usually UID)
  namespace: VectorNamespace;
  data: T;                      // The actual payload
  embedding?: number[];         // Vector embedding (optional, computed server-side)
  metadata: {
    createdAt: number;
    updatedAt: number;
    ownerCertUid?: string;      // Who owns this document
    signature?: string;         // Signature from owner
    version: number;
  };
}

export interface ICharacterState {
  certUid: string;
  displayName: string;
  
  // Universal stats (normalized across all worlds)
  stats: {
    level: number;
    experience: number;
    totalPlayTime: number;      // Seconds
    deathCount: number;
    extractionCount: number;
  };
  
  // Inventory (items reference by UID)
  inventoryItemIds: string[];
  bankItemIds: string[];
  
  // Currency
  gold: number;
  
  // Lore/Knowledge
  lore: Record<string, { topic: string; xp: number; level: number }>;
  
  // Territory ownership
  ownedTerritoryIds: string[];
  
  // Last known position (for hub persistence)
  lastPosition?: {
    worldSeed: string;
    chunkX: number;
    chunkY: number;
    x: number;
    y: number;
  };
}

export interface IQueryOptions {
  namespace: VectorNamespace;
  filter?: Record<string, any>;
  limit?: number;
  includeEmbedding?: boolean;
}

export interface ISemanticSearchOptions extends IQueryOptions {
  query: string;               // Natural language query
  similarityThreshold?: number; // 0-1, default 0.7
}

// ============================================================================
// VECTOR STORE INTERFACE
// ============================================================================

export interface IVectorStoreBackend {
  // CRUD
  put<T>(doc: IVectorDocument<T>): Promise<boolean>;
  get<T>(namespace: VectorNamespace, id: string): Promise<IVectorDocument<T> | null>;
  delete(namespace: VectorNamespace, id: string): Promise<boolean>;
  
  // Query
  query<T>(options: IQueryOptions): Promise<IVectorDocument<T>[]>;
  semanticSearch<T>(options: ISemanticSearchOptions): Promise<IVectorDocument<T>[]>;
  
  // Batch operations
  putMany<T>(docs: IVectorDocument<T>[]): Promise<number>;
  getMany<T>(namespace: VectorNamespace, ids: string[]): Promise<IVectorDocument<T>[]>;
}

// ============================================================================
// LOCAL STORAGE BACKEND (For Development)
// Uses localStorage + in-memory for embeddings
// In production, replace with Pinecone/Weaviate/Qdrant
// ============================================================================

class LocalVectorBackend implements IVectorStoreBackend {
  private prefix = 'ws_vector_';

  private getKey(namespace: VectorNamespace, id: string): string {
    return `${this.prefix}${namespace}_${id}`;
  }

  async put<T>(doc: IVectorDocument<T>): Promise<boolean> {
    try {
      const key = this.getKey(doc.namespace, doc.id);
      localStorage.setItem(key, JSON.stringify(doc));
      
      // Also maintain an index
      const indexKey = `${this.prefix}index_${doc.namespace}`;
      const index = JSON.parse(localStorage.getItem(indexKey) || '[]');
      if (!index.includes(doc.id)) {
        index.push(doc.id);
        localStorage.setItem(indexKey, JSON.stringify(index));
      }
      
      return true;
    } catch (e) {
      console.error('[VECTOR] Put failed:', e);
      return false;
    }
  }

  async get<T>(namespace: VectorNamespace, id: string): Promise<IVectorDocument<T> | null> {
    try {
      const key = this.getKey(namespace, id);
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('[VECTOR] Get failed:', e);
      return null;
    }
  }

  async delete(namespace: VectorNamespace, id: string): Promise<boolean> {
    try {
      const key = this.getKey(namespace, id);
      localStorage.removeItem(key);
      
      // Update index
      const indexKey = `${this.prefix}index_${namespace}`;
      const index = JSON.parse(localStorage.getItem(indexKey) || '[]');
      const newIndex = index.filter((i: string) => i !== id);
      localStorage.setItem(indexKey, JSON.stringify(newIndex));
      
      return true;
    } catch (e) {
      console.error('[VECTOR] Delete failed:', e);
      return false;
    }
  }

  async query<T>(options: IQueryOptions): Promise<IVectorDocument<T>[]> {
    try {
      const indexKey = `${this.prefix}index_${options.namespace}`;
      const index: string[] = JSON.parse(localStorage.getItem(indexKey) || '[]');
      
      const results: IVectorDocument<T>[] = [];
      
      for (const id of index) {
        const doc = await this.get<T>(options.namespace, id);
        if (!doc) continue;
        
        // Apply filters
        if (options.filter) {
          let match = true;
          for (const [key, value] of Object.entries(options.filter)) {
            if ((doc.data as any)[key] !== value && doc.metadata[key as keyof typeof doc.metadata] !== value) {
              match = false;
              break;
            }
          }
          if (!match) continue;
        }
        
        results.push(doc);
        
        if (options.limit && results.length >= options.limit) break;
      }
      
      return results;
    } catch (e) {
      console.error('[VECTOR] Query failed:', e);
      return [];
    }
  }

  async semanticSearch<T>(options: ISemanticSearchOptions): Promise<IVectorDocument<T>[]> {
    // Local backend doesn't support real semantic search
    // In production, this would call your embedding API + vector similarity
    console.warn('[VECTOR] Semantic search not supported in local backend, falling back to query');
    return this.query<T>(options);
  }

  async putMany<T>(docs: IVectorDocument<T>[]): Promise<number> {
    let count = 0;
    for (const doc of docs) {
      if (await this.put(doc)) count++;
    }
    return count;
  }

  async getMany<T>(namespace: VectorNamespace, ids: string[]): Promise<IVectorDocument<T>[]> {
    const results: IVectorDocument<T>[] = [];
    for (const id of ids) {
      const doc = await this.get<T>(namespace, id);
      if (doc) results.push(doc);
    }
    return results;
  }
}

// ============================================================================
// VECTOR STORE SERVICE
// High-level API for game operations
// ============================================================================

export class VectorStore {
  private static backend: IVectorStoreBackend = new LocalVectorBackend();

  /**
   * Switch backend (for production)
   */
  static setBackend(backend: IVectorStoreBackend) {
    this.backend = backend;
  }

  // ============================================================================
  // CHARACTER OPERATIONS
  // ============================================================================

  /**
   * Save character state (signed by player certificate)
   */
  static async saveCharacterState(
    certUid: string,
    state: ICharacterState,
    signature: string
  ): Promise<boolean> {
    const doc: IVectorDocument<ICharacterState> = {
      id: certUid,
      namespace: VectorNamespace.CHARACTERS,
      data: state,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: certUid,
        signature,
        version: 1
      }
    };

    // Check if exists, increment version
    const existing = await this.backend.get<ICharacterState>(VectorNamespace.CHARACTERS, certUid);
    if (existing) {
      doc.metadata.createdAt = existing.metadata.createdAt;
      doc.metadata.version = existing.metadata.version + 1;
    }

    return this.backend.put(doc);
  }

  /**
   * Load character state
   */
  static async loadCharacterState(certUid: string): Promise<ICharacterState | null> {
    const doc = await this.backend.get<ICharacterState>(VectorNamespace.CHARACTERS, certUid);
    return doc?.data || null;
  }

  /**
   * Create initial character state
   */
  static createInitialCharacterState(certUid: string, displayName: string): ICharacterState {
    return {
      certUid,
      displayName,
      stats: {
        level: 1,
        experience: 0,
        totalPlayTime: 0,
        deathCount: 0,
        extractionCount: 0
      },
      inventoryItemIds: [],
      bankItemIds: [],
      gold: 100, // Starting gold
      lore: {},
      ownedTerritoryIds: []
    };
  }

  // ============================================================================
  // ITEM OPERATIONS
  // ============================================================================

  /**
   * Save an item to the universe
   */
  static async saveItem(item: IItem, ownerCertUid: string): Promise<boolean> {
    const doc: IVectorDocument<IItem> = {
      id: item.id,
      namespace: VectorNamespace.ITEMS,
      data: item,
      metadata: {
        createdAt: item.history.dropDate,
        updatedAt: Date.now(),
        ownerCertUid,
        version: 1
      }
    };

    return this.backend.put(doc);
  }

  /**
   * Load an item by ID
   */
  static async loadItem(itemId: string): Promise<IItem | null> {
    const doc = await this.backend.get<IItem>(VectorNamespace.ITEMS, itemId);
    return doc?.data || null;
  }

  /**
   * Transfer item ownership
   */
  static async transferItem(
    itemId: string, 
    fromCertUid: string, 
    toCertUid: string,
    signature: string
  ): Promise<boolean> {
    const itemDoc = await this.backend.get<IItem>(VectorNamespace.ITEMS, itemId);
    if (!itemDoc) return false;

    // Verify current owner
    if (itemDoc.metadata.ownerCertUid !== fromCertUid) {
      console.error('[VECTOR] Transfer failed: not owner');
      return false;
    }

    // Update ownership
    itemDoc.metadata.ownerCertUid = toCertUid;
    itemDoc.metadata.updatedAt = Date.now();
    itemDoc.metadata.version++;

    // Log transaction
    await this.logTransaction({
      type: 'ITEM_TRANSFER',
      fromCertUid,
      toCertUid,
      itemId,
      signature,
      timestamp: Date.now()
    });

    return this.backend.put(itemDoc);
  }

  /**
   * Find items by owner
   */
  static async getItemsByOwner(certUid: string): Promise<IItem[]> {
    const docs = await this.backend.query<IItem>({
      namespace: VectorNamespace.ITEMS,
      filter: { ownerCertUid: certUid }
    });
    return docs.map(d => d.data);
  }

  /**
   * Search items semantically (e.g., "fire damage sword")
   */
  static async searchItems(query: string, limit: number = 10): Promise<IItem[]> {
    const docs = await this.backend.semanticSearch<IItem>({
      namespace: VectorNamespace.ITEMS,
      query,
      limit
    });
    return docs.map(d => d.data);
  }

  // ============================================================================
  // TRANSACTION LOG
  // ============================================================================

  private static async logTransaction(tx: {
    type: string;
    fromCertUid?: string;
    toCertUid?: string;
    itemId?: string;
    gold?: number;
    signature: string;
    timestamp: number;
  }): Promise<void> {
    const txId = `tx_${tx.timestamp}_${Math.random().toString(36).slice(2, 10)}`;
    
    const doc: IVectorDocument<typeof tx> = {
      id: txId,
      namespace: VectorNamespace.TRANSACTIONS,
      data: tx,
      metadata: {
        createdAt: tx.timestamp,
        updatedAt: tx.timestamp,
        version: 1
      }
    };

    await this.backend.put(doc);
  }

  // ============================================================================
  // CONTENT OPERATIONS (Generated mobs, affixes, etc.)
  // ============================================================================

  /**
   * Store generated content
   */
  static async saveContent<T>(
    id: string,
    contentType: string, // 'mob', 'affix', 'spell', etc.
    content: T,
    genre?: string
  ): Promise<boolean> {
    const doc: IVectorDocument<{ type: string; genre?: string; content: T }> = {
      id,
      namespace: VectorNamespace.CONTENT,
      data: { type: contentType, genre, content },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1
      }
    };

    return this.backend.put(doc);
  }

  /**
   * Search content by genre and type
   */
  static async searchContent<T>(
    contentType: string,
    genre?: string,
    semanticQuery?: string
  ): Promise<T[]> {
    if (semanticQuery) {
      const docs = await this.backend.semanticSearch<{ type: string; genre?: string; content: T }>({
        namespace: VectorNamespace.CONTENT,
        query: `${contentType} ${genre || ''} ${semanticQuery}`,
        filter: { type: contentType }
      });
      return docs.map(d => d.data.content);
    }

    const filter: Record<string, any> = { type: contentType };
    if (genre) filter.genre = genre;

    const docs = await this.backend.query<{ type: string; genre?: string; content: T }>({
      namespace: VectorNamespace.CONTENT,
      filter
    });
    return docs.map(d => d.data.content);
  }
}
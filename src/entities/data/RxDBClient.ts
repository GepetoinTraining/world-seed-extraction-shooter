import { createRxDatabase, RxDatabase, RxCollection } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

// --- SCHEMA DEFINITION ---
const vectorDocumentSchema = {
  title: 'vector_document',
  version: 0,
  description: 'A generic document with vector embedding',
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 100 },
    namespace: { type: 'string' },
    data: { type: 'object' },
    embedding: { 
      type: 'array',
      items: { type: 'number' }
    },
    metadata: {
      type: 'object',
      properties: {
        createdAt: { type: 'number' },
        updatedAt: { type: 'number' },
        ownerCertUid: { type: 'string' },
        version: { type: 'number' }
      }
    }
  },
  required: ['id', 'namespace', 'data', 'metadata']
};

// --- TYPES ---
export type VectorDocType = {
  id: string;
  namespace: string;
  data: any;
  embedding?: number[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    ownerCertUid?: string;
    version: number;
  };
};

type VectorCollection = RxCollection<VectorDocType>;
type MyDatabaseCollections = {
  vectors: VectorCollection;
};
type MyDatabase = RxDatabase<MyDatabaseCollections>;

// --- SINGLETON INSTANCE ---
let dbPromise: Promise<MyDatabase> | null = null;

export const getDatabase = async (): Promise<MyDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = createRxDatabase<MyDatabaseCollections>({
    name: 'worldseed_db',
    storage: getRxStorageDexie(), // FIXED: Switched to Dexie
    ignoreDuplicate: true
  }).then(async (db) => {
    await db.addCollections({
      vectors: {
        schema: vectorDocumentSchema
      }
    });
    console.log('[RxDB] Database initialized with Dexie');
    return db;
  });

  return dbPromise;
};
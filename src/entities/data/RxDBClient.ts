import { addRxPlugin, createRxDatabase, RxDatabase, RxCollection, RxStorage } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';

if (import.meta.env.DEV) {
  addRxPlugin(RxDBDevModePlugin);
}

// --- SCHEMA (Unchanged) ---
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
    embedding: { type: 'array', items: { type: 'number' } },
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

export type VectorDocType = {
  id: string;
  namespace: string;
  data: any;
  embedding?: number[];
  metadata: { createdAt: number; updatedAt: number; ownerCertUid?: string; version: number; };
};

type MyDatabaseCollections = { vectors: RxCollection<VectorDocType> };
type MyDatabase = RxDatabase<MyDatabaseCollections>;

// --- FIX START: GLOBAL SINGLETON ---
// Store the promise on the window so HMR doesn't kill it
const global = window as any;
let dbPromise: Promise<MyDatabase> | null = global.__wd_dbPromise || null;

export const getDatabase = async (): Promise<MyDatabase> => {
  if (dbPromise) return dbPromise;

  let storage: RxStorage<any, any> = getRxStorageDexie();
  if (import.meta.env.DEV) {
    storage = wrappedValidateAjvStorage({ storage });
  }

  dbPromise = createRxDatabase<MyDatabaseCollections>({
    name: 'worldseed_db',
    storage,
    ignoreDuplicate: true 
  }).then(async (db) => {
    // Check if collection exists in this instance
    if (!db.collections.vectors) {
      try {
        await db.addCollections({
          vectors: { schema: vectorDocumentSchema }
        });
        console.log('[RxDB] Collection "vectors" initialized.');
      } catch (err: any) {
        // Ignore "Already Exists" errors from underlying storage
        if (err?.code === 'DB9' || err?.message?.includes('already exists')) {
             console.log('[RxDB] Collection attached (Resumed).');
        } else {
             console.error('[RxDB] Critical Init Error:', err);
        }
      }
    }
    return db;
  });

  // Save to window for next Hot Reload
  global.__wd_dbPromise = dbPromise;
  
  return dbPromise;
};
// --- FIX END ---
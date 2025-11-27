import { VectorStore, VectorNamespace } from '../../data/VectorStore';
import { WorldGenerator } from '../WorldGenerator';
import { IMap } from '../types';

export interface IWorldInstance {
  id: string;
  seed: string;
  mapData: IMap;
  config: {
    size: number;
    startTime: number;
    endTime: number;
    isExpired: boolean;
  };
}

export class WorldGenerationService {

  /**
   * Generates or loads a persistent world instance.
   */
  static async activateWorld(seed: string, size: number): Promise<IWorldInstance> {
    const instanceId = `inst_${seed}_${size}`;
    
    // 1. CHECK FOR EXISTING LIVE WORLD
    const existing = await VectorStore.get<IWorldInstance>(
      VectorNamespace.WORLDS, 
      instanceId
    );

    if (existing && existing.data) {
      const now = Date.now();
      const timeLeft = existing.data.config.endTime - now;
      
      if (timeLeft > 0) {
        console.log(`[GEN_SERVICE] Resuming world. Time remaining: ${(timeLeft/60000).toFixed(1)}m`);
        return existing.data;
      } else {
        console.log(`[GEN_SERVICE] World Expired. Re-rolling timeline...`);
        // In the future: This is where "The Crunch" happens (saving history)
      }
    }

    // 2. FETCH "DNA" FROM VECTOR DB
    console.log('[GEN_SERVICE] Fetching universal definitions...');
    
    // We need to tell TypeScript what the document structure is: <{ content: any }>
    const mobDocs = await VectorStore.query<{ content: any }>({ 
      namespace: VectorNamespace.CONTENT, 
      filter: { 'data.type': 'MOB_DEFINITION' } 
    });
    
    const resDocs = await VectorStore.query<{ content: any }>({ 
      namespace: VectorNamespace.CONTENT, 
      filter: { 'data.type': 'RESOURCE_DEFINITION' }
    });

    const context = {
      mobDefinitions: mobDocs.map(d => d.data.content),
      resourceDefinitions: resDocs.map(d => d.data.content)
    };

    console.log(`[GEN_SERVICE] Context Loaded: ${context.mobDefinitions.length} Mobs, ${context.resourceDefinitions.length} Resources`);

    // 3. GENERATE MAP (The "Big Bang")
    const map = WorldGenerator.generate(seed, size, context);

    // 4. APPLY TIME RULES
    const now = Date.now();
    let durationMs = 1000 * 60 * 60; // Default 1 hour

    if (size === 16) durationMs = 1000 * 60 * 60 * 1; // 1h (Skirmish)
    if (size === 32) durationMs = 1000 * 60 * 60 * 4; // 4h (Standard)
    if (size === 64) {
        // Daily Worlds expire at next Midnight UTC
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0); 
        durationMs = tomorrow.getTime() - now; 
    }

    const newInstance: IWorldInstance = {
      id: instanceId,
      seed,
      mapData: map,
      config: {
        size,
        startTime: now,
        endTime: now + durationMs,
        isExpired: false
      }
    };

    // 5. PERSIST TO LEDGER
    await VectorStore.put({
      id: instanceId,
      namespace: VectorNamespace.WORLDS,
      data: newInstance,
      metadata: {
        createdAt: now,
        updatedAt: now,
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    });

    return newInstance;
  }
}
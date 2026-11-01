import { VectorStore, VectorNamespace } from '../../data/VectorStore';
import { IGenerationContext, WorldGenerator } from '../WorldGenerator';
import { IMap } from '../types';
import { GRID_VERSION } from '../grid';
import { ContentRegistry } from '../../../logic/theme/ContentRegistry';

export interface IWorldInstance {
  id: string;
  seed: string;
  mapData: IMap;
  context: IGenerationContext;
  config: {
    size: number;
    startTime: number;
    endTime: number;
    isExpired: boolean;
  };
}

export class WorldGenerationService {

  /** A world builds from its own theme and nothing else (D53). */
  private static loadContext(themeId: string | undefined, difficulty?: string): IGenerationContext {
    return ContentRegistry.contextFor(themeId ?? ContentRegistry.defaultThemeId(), difficulty);
  }

  /**
   * Opens a world, resuming its timer if it is still live. Only its record is
   * stored: its land comes from the seed, and chunks are built as they are reached.
   */
  static async activateWorld(seed: string, size: number, themeId?: string, difficulty?: string): Promise<IWorldInstance> {
    const instanceId = `inst_g${GRID_VERSION}_${seed}_${size}`;
    const context = this.loadContext(themeId, difficulty);
    const now = Date.now();

    const existing = await VectorStore.get<IWorldInstance>(VectorNamespace.WORLDS, instanceId);
    if (existing && existing.data) {
      const timeLeft = existing.data.config.endTime - now;
      if (timeLeft > 0) {
        console.log(`[GEN_SERVICE] Resuming world. Time remaining: ${(timeLeft / 60000).toFixed(1)}m`);
        return { ...existing.data, context, mapData: WorldGenerator.generate(seed, size, context) };
      }
      console.log('[GEN_SERVICE] World Expired. Re-rolling timeline...');
    }

    let durationMs = 1000 * 60 * 60; // Default 1 hour
    if (size === 16) durationMs = 1000 * 60 * 60 * 1; // 1h (Skirmish)
    if (size === 32) durationMs = 1000 * 60 * 60 * 4; // 4h (Standard)
    if (size === 64) {
      // Daily Worlds expire at next Midnight UTC
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      durationMs = tomorrow.getTime() - now;
    }

    const config = { size, startTime: now, endTime: now + durationMs, isExpired: false };

    await VectorStore.put({
      id: instanceId,
      namespace: VectorNamespace.WORLDS,
      data: { id: instanceId, seed, config } as IWorldInstance,
      metadata: {
        createdAt: now,
        updatedAt: now,
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    });

    return { id: instanceId, seed, context, mapData: WorldGenerator.generate(seed, size, context), config };
  }
}

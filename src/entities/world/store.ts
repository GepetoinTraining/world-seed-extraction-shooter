import { create } from 'zustand';
import { IMap, ScanLevel, IChunk } from './types';
import { WorldGenerator } from './WorldGenerator';

export interface IWorldCard {
  id: string;
  seed: string;
  size: number;
  createdAt: number;
  collapseTime: number; 
  playerCount: number; 
  isDebug?: boolean; 
}

interface WorldState {
  availableWorlds: IWorldCard[];
  activeWorldId: string | null; 
  currentMap: IMap | null;
  reconMode: boolean;
  selectedDropZone: { x: number, y: number } | null;
  
  refreshWorlds: () => void;
  selectWorld: (worldId: string) => void;
  initiateRecon: (seed: string) => void; 
  fetchChunkData: (x: number, y: number) => void;
  scanChunk: (x: number, y: number, efficiency: number) => void;
  selectChunk: (x: number, y: number) => void;
  confirmDrop: () => void;
  exitWorld: () => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  availableWorlds: [],
  activeWorldId: null,
  currentMap: null,
  reconMode: true,
  selectedDropZone: null,

  refreshWorlds: () => {
      const now = Date.now();
      const worlds: IWorldCard[] = [
          { id: 'w-16', seed: 'alpha-16', size: 16, createdAt: now, collapseTime: now + 1000 * 60 * 5, playerCount: 12 },
          { id: 'w-32', seed: 'beta-32', size: 32, createdAt: now, collapseTime: now + 1000 * 60 * 15, playerCount: 45 },
          { 
              id: 'dev-01', 
              seed: 'dev-sandbox', 
              size: 16, 
              createdAt: now - 1000 * 60 * 60, 
              collapseTime: now + 1000 * 60 * 60 * 24, 
              playerCount: 1, 
              isDebug: true 
          }
      ];
      set({ availableWorlds: worlds });
  },

  selectWorld: (worldId: string) => {
      const worldCard = get().availableWorlds.find(w => w.id === worldId);
      if (!worldCard) return;

      const map = WorldGenerator.generate(worldCard.seed, worldCard.size);
      const blankChunks: Record<string, IChunk> = {};
      
      Object.keys(map.chunks).forEach(key => {
          blankChunks[key] = { ...map.chunks[key], scanLevel: ScanLevel.UNKNOWN, entities: [] };
      });

      // --- FIX: Instant Entry for Dev Worlds ---
      const isDev = !!worldCard.isDebug;
      
      set({ 
          activeWorldId: worldId, 
          currentMap: { ...map, chunks: blankChunks },
          reconMode: !isDev, // Skip Recon if Dev
          selectedDropZone: isDev ? { x: 15, y: 15 } : null // Auto-select drop zone (Matches Player Start 1500,1500)
      });
  },

  initiateRecon: (seed: string) => {
    const fullServerMap = WorldGenerator.generate(seed, 32);
    const blankChunks: Record<string, IChunk> = {};
    Object.keys(fullServerMap.chunks).forEach(key => {
        blankChunks[key] = { ...fullServerMap.chunks[key], scanLevel: ScanLevel.UNKNOWN, entities: [] };
    });

    set({ 
        activeWorldId: seed, 
        currentMap: { ...fullServerMap, chunks: blankChunks }, 
        reconMode: true, 
        selectedDropZone: null 
    });
  },

  fetchChunkData: (x: number, y: number) => {
    const { currentMap } = get();
    if (!currentMap) return;

    const chunkKey = `${x},${y}`;
    const serverData = WorldGenerator.generate(currentMap.seed, currentMap.width).chunks[chunkKey];
    
    const updatedChunks = {
        ...currentMap.chunks,
        [chunkKey]: { ...serverData, scanLevel: ScanLevel.DETAILED } 
    };

    set({ currentMap: { ...currentMap, chunks: updatedChunks } });
  },

  scanChunk: (x: number, y: number, efficiency: number) => {
    const { currentMap } = get();
    if (!currentMap) return;

    const chunkKey = `${x},${y}`;
    const chunk = currentMap.chunks[chunkKey];
    if (!chunk) return;

    const trueMap = WorldGenerator.generate(currentMap.seed, currentMap.width);
    const trueChunk = trueMap.chunks[chunkKey];

    let nextLevel = chunk.scanLevel + 1;
    
    const isDev = currentMap.seed.startsWith('dev');
    if (isDev) {
        nextLevel = ScanLevel.COMPLETE;
    } else {
        if (nextLevel === ScanLevel.DETAILED && efficiency < 2.0) return; 
        if (nextLevel === ScanLevel.COMPLETE && efficiency < 3.0) return; 
    }
    
    if (nextLevel > ScanLevel.COMPLETE) nextLevel = ScanLevel.COMPLETE;

    const updatedChunks = {
        ...currentMap.chunks,
        [chunkKey]: { ...trueChunk, scanLevel: nextLevel }
    };

    set({ currentMap: { ...currentMap, chunks: updatedChunks } });
  },

  selectChunk: (x: number, y: number) => {
      set({ selectedDropZone: { x, y } });
  },

  confirmDrop: () => {
      set({ reconMode: false });
  },

  exitWorld: () => {
      set({ activeWorldId: null, currentMap: null });
  }
}));
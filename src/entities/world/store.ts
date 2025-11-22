import { create } from 'zustand';
import { IMap, ScanLevel, IChunk } from './types';
import { WorldGenerator } from './WorldGenerator';

interface WorldState {
  currentMap: IMap | null;
  reconMode: boolean;
  selectedDropZone: { x: number, y: number } | null;
  
  generateWorld: (seed: string) => void;
  scanChunk: (x: number, y: number, efficiency: number) => void;
  selectChunk: (x: number, y: number) => void; // NEW
  confirmDrop: () => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  currentMap: null,
  reconMode: true,
  selectedDropZone: null,

  generateWorld: (seed: string) => {
    const map = WorldGenerator.generate(seed, 32);
    set({ currentMap: map, reconMode: true, selectedDropZone: null });
  },

  scanChunk: (x: number, y: number, efficiency: number) => {
    const { currentMap } = get();
    if (!currentMap) return;

    const chunkKey = `${x},${y}`;
    const chunk = currentMap.chunks[chunkKey];
    if (!chunk) return;

    let newLevel = ScanLevel.BASIC;
    if (efficiency >= 2.0) newLevel = ScanLevel.DETAILED;
    if (efficiency >= 3.0) newLevel = ScanLevel.COMPLETE;

    const updatedChunks = {
        ...currentMap.chunks,
        [chunkKey]: { ...chunk, scanLevel: Math.max(chunk.scanLevel, newLevel) }
    };

    set({ currentMap: { ...currentMap, chunks: updatedChunks } });
  },

  selectChunk: (x: number, y: number) => {
      set({ selectedDropZone: { x, y } });
  },

  confirmDrop: () => {
      const { selectedDropZone } = get();
      if (selectedDropZone) {
          // Logic to spawn player at this chunk would go here
          set({ reconMode: false });
      }
  }
}));
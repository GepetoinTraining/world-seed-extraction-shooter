import { create } from 'zustand';
import { IMap, ScanLevel, IChunk } from './types';
// In real life, this import wouldn't exist here. The Generator runs on the server.
// We keep it for the mock, but wrapped in a "Server Simulation" timeout.
import { WorldGenerator } from './WorldGenerator'; 

interface WorldState {
  currentMap: IMap | null; // The local JSON cache
  reconMode: boolean;
  selectedDropZone: { x: number, y: number } | null;
  
  // ACTIONS
  initiateRecon: (seed: string) => void; // Starts the 25min timer (Simulated)
  fetchChunkData: (x: number, y: number) => void; // The "DB Query"
  selectChunk: (x: number, y: number) => void;
  confirmDrop: () => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  currentMap: null,
  reconMode: true,
  selectedDropZone: null,

  initiateRecon: (seed: string) => {
    // 1. SIMULATE SERVER GENERATION
    // The server generates the full JSON blob in the background.
    const fullServerMap = WorldGenerator.generate(seed, 32);
    
    // 2. CLIENT RECEIVES "BLANK" MANIFEST
    // The client only knows the grid dimensions, nothing else.
    const blankChunks: Record<string, IChunk> = {};
    Object.keys(fullServerMap.chunks).forEach(key => {
        blankChunks[key] = { 
            ...fullServerMap.chunks[key], 
            biome: 'UNKNOWN' as any, // Client doesn't know yet
            scanLevel: ScanLevel.UNKNOWN,
            entities: [] // No entity data transmitted yet
        };
    });

    const clientMap = { ...fullServerMap, chunks: blankChunks };
    set({ currentMap: clientMap, reconMode: true, selectedDropZone: null });
  },

  fetchChunkData: (x: number, y: number) => {
    const { currentMap } = get();
    if (!currentMap) return;

    // SIMULATE NETWORK/DB LATENCY
    // We are requesting "detailed_scan.json" for this chunk
    const chunkKey = `${x},${y}`;
    
    // In a real app, we would await fetch(`/api/world/chunk/${x}/${y}`)
    // Here, we "cheat" and peek at the Server State (re-generating for the mock)
    const serverData = WorldGenerator.generate(currentMap.seed, 32).chunks[chunkKey];
    
    set((state) => {
        if (!state.currentMap) return state;
        return {
            currentMap: {
                ...state.currentMap,
                chunks: {
                    ...state.currentMap.chunks,
                    [chunkKey]: {
                        ...serverData,
                        scanLevel: ScanLevel.DETAILED // We now have the JSON
                    }
                }
            }
        };
    });
  },

  selectChunk: (x: number, y: number) => {
      set({ selectedDropZone: { x, y } });
  },

  confirmDrop: () => {
      set({ reconMode: false });
  }
}));
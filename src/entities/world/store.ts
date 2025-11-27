import { create } from 'zustand';
import { IMap, ScanLevel, IChunk } from './types';
import { WorldGenerator } from './WorldGenerator';
import { WorldCertificateSystem, IWorldCertificate } from './WorldCertificate';

export interface IWorldCard {
  id: string;
  seed: string;
  size: number;
  createdAt: number;
  collapseTime: number; 
  playerCount: number; 
  isDebug?: boolean; 
  name: string; // Added from Cert
  difficulty: string; // Added from Cert
  creator: string; // Added from Cert
}

interface WorldState {
  availableWorlds: IWorldCard[];
  activeWorldId: string | null; 
  currentMap: IMap | null;
  reconMode: boolean;
  selectedDropZone: { x: number, y: number } | null;
  
  refreshWorlds: () => Promise<void>;
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

  // --- LEDGER INTEGRATION: FETCH WORLDS ---
  refreshWorlds: async () => {
      // 1. Get real worlds from the Ledger (VectorStore)
      const certs = await WorldCertificateSystem.getPublicWorlds();
      
      const now = Date.now();
      
      // 2. Map Certificates to Game Cards
      const realWorlds: IWorldCard[] = certs.map(cert => ({
          id: cert.data.worldUid,
          seed: cert.data.seedHash,
          size: cert.data.size,
          createdAt: cert.data.createdAt,
          collapseTime: now + (1000 * 60 * (cert.data.rules.sessionDurationMinutes || 60)),
          playerCount: cert.data.stats.totalVisitors,
          name: cert.data.worldName,
          difficulty: cert.data.rules.difficulty,
          creator: cert.data.creatorCertUid.substring(0, 8),
          isDebug: false
      }));

      // 3. Add a Dev World for testing (Optional but good for stability)
      const devWorld: IWorldCard = { 
          id: 'dev-01', 
          seed: 'dev-sandbox', 
          size: 16, 
          createdAt: now, 
          collapseTime: now + 1000 * 60 * 60 * 24, 
          playerCount: 1, 
          isDebug: true,
          name: "SIMULATION_DEBUG",
          difficulty: "F",
          creator: "SYSTEM"
      };

      set({ availableWorlds: [devWorld, ...realWorlds] });
  },

  selectWorld: (worldId: string) => {
      const worldCard = get().availableWorlds.find(w => w.id === worldId);
      if (!worldCard) return;

      console.log(`[WORLD] Generating Reality: ${worldCard.seed}`);

      // 1. GENERATE THE JSON from the Seed
      const map = WorldGenerator.generate(worldCard.seed, worldCard.size);
      
      // 2. Initialize Fog of War
      const blankChunks: Record<string, IChunk> = {};
      Object.keys(map.chunks).forEach(key => {
          blankChunks[key] = { ...map.chunks[key], scanLevel: ScanLevel.UNKNOWN, entities: [] };
      });

      const isDev = !!worldCard.isDebug;
      
      set({ 
          activeWorldId: worldId, 
          currentMap: { ...map, chunks: blankChunks },
          reconMode: !isDev, 
          selectedDropZone: isDev ? { x: 8, y: 8 } : null 
      });
  },

  initiateRecon: (seed: string) => {
    // Legacy fallback, mostly replaced by selectWorld
    const map = WorldGenerator.generate(seed, 32);
    // ... same logic
  },

  fetchChunkData: (x: number, y: number) => {
    const { currentMap } = get();
    if (!currentMap) return;

    const chunkKey = `${x},${y}`;
    // Re-generate true data to simulate server fetch
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

    // "Server" Fetch
    const trueChunk = WorldGenerator.generate(currentMap.seed, currentMap.width).chunks[chunkKey];

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

  selectChunk: (x: number, y: number) => set({ selectedDropZone: { x, y } }),
  confirmDrop: () => set({ reconMode: false }),
  exitWorld: () => set({ activeWorldId: null, currentMap: null })
}));
import { create } from 'zustand';
import { IMap, ScanLevel, IChunk } from './types';
import { WorldCertificateSystem } from './WorldCertificate';
import { WorldGenerationService } from './services/WorldGenerationService';

export interface IWorldCard {
  id: string;
  seed: string;
  size: number;
  createdAt: number;
  collapseTime: number; 
  playerCount: number; 
  isDebug?: boolean; 
  name: string; 
  difficulty: string; 
  creator: string; 
}

interface WorldState {
  availableWorlds: IWorldCard[];
  activeWorldId: string | null; 
  currentMap: IMap | null;
  reconMode: boolean;
  selectedDropZone: { x: number, y: number } | null;
  isGenerating: boolean;
  
  refreshWorlds: () => Promise<void>;
  selectWorld: (worldId: string) => Promise<void>;
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
  isGenerating: false,

  refreshWorlds: async () => {
      const certs = await WorldCertificateSystem.getPublicWorlds();
      const now = Date.now();
      
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

      // Dev World - Using the Service!
      const devWorld: IWorldCard = { 
          id: 'dev-01', 
          seed: 'dev-sandbox-v2', 
          size: 32, 
          createdAt: now, 
          collapseTime: now + 1000 * 60 * 60 * 4, // 4 Hours
          playerCount: 1, 
          isDebug: true,
          name: "SIMULATION_DEBUG",
          difficulty: "D",
          creator: "SYSTEM"
      };

      set({ availableWorlds: [devWorld, ...realWorlds] });
  },

  selectWorld: async (worldId: string) => {
      const worldCard = get().availableWorlds.find(w => w.id === worldId);
      if (!worldCard) return;

      console.log(`[WORLD] Selecting ${worldCard.name}...`);
      set({ isGenerating: true });

      try {
        // --- HOOKED UP: CALL SERVICE ---
        const instance = await WorldGenerationService.activateWorld(worldCard.seed, worldCard.size);
        
        // Hide details for Fog of War
        const map = instance.mapData;
        const blankChunks: Record<string, IChunk> = {};
        
        Object.keys(map.chunks).forEach(key => {
            blankChunks[key] = { 
                ...map.chunks[key], 
                scanLevel: ScanLevel.UNKNOWN, 
                entities: [] 
            };
        });

        const isDev = !!worldCard.isDebug;
        
        set({ 
            activeWorldId: worldId, 
            currentMap: { ...map, chunks: blankChunks },
            reconMode: !isDev, 
            selectedDropZone: isDev ? { x: Math.floor(worldCard.size/2), y: Math.floor(worldCard.size/2) } : null 
        });

      } catch (e) {
        console.error("Failed to load world:", e);
      } finally {
        set({ isGenerating: false });
      }
  },

  // Legacy stubs
  initiateRecon: (seed: string) => {},
  fetchChunkData: (x, y) => {},
  scanChunk: (x, y, eff) => {},
  selectChunk: (x, y) => set({ selectedDropZone: { x, y } }),
  confirmDrop: () => set({ reconMode: false }),
  exitWorld: () => set({ activeWorldId: null, currentMap: null })
}));
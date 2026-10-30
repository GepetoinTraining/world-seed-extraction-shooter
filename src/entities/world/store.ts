import { create } from 'zustand';
import { IMap, ScanLevel, IChunk } from './types';
import { UniversalRank } from '../../../types';
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
  extractionTaxRate: number; // Wave 2.5: the hub's cut, from the world cert
  // Wave 4.4: enforced world rules
  deathPenalty: 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH';
  ipCap?: UniversalRank;
  ipFloor?: UniversalRank;
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

  // Wave 2: world mutation (harvest depletion, chest looting, NPC state)
  updateEntity: (entityId: string, patch: Partial<import('./types').IWorldEntity>) => void;
  removeEntity: (entityId: string) => void;
  // Wave 3.3: ground caches (dropped/overflow items become world entities)
  addEntity: (entity: import('./types').IWorldEntity) => void;
}

// The "server-side" truth: full chunk data (entities included) for the active world.
// The store's currentMap only holds what the client has scanned (Fog of War).
let truthMap: IMap | null = null;

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
          isDebug: false,
          extractionTaxRate: cert.data.rules.extractionTaxRate ?? 0.05,
          deathPenalty: cert.data.rules.deathPenalty ?? 'INVENTORY_LOSS',
          ipCap: cert.data.rules.ipCap,
          ipFloor: cert.data.rules.ipFloor
      }));

      // Dev World - Using the Service!
      const devWorld: IWorldCard = { 
          id: 'dev-01', 
          seed: 'dev-sandbox-v4',
          size: 32, 
          createdAt: now, 
          collapseTime: now + 1000 * 60 * 60 * 4, // 4 Hours
          playerCount: 1, 
          isDebug: true,
          name: "SIMULATION_DEBUG",
          difficulty: "D",
          creator: "SYSTEM",
          extractionTaxRate: 0.05,
          deathPenalty: 'INVENTORY_LOSS' // even the simulation charges for dying
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
        truthMap = map; // Keep the full truth for scan reveals
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
            // Dev worlds skip recon, so they get the full truth immediately
            currentMap: { ...map, chunks: isDev ? map.chunks : blankChunks },
            reconMode: !isDev,
            selectedDropZone: isDev ? { x: Math.floor(worldCard.size/2), y: Math.floor(worldCard.size/2) } : null
        });

      } catch (e) {
        console.error("Failed to load world:", e);
      } finally {
        set({ isGenerating: false });
      }
  },

  initiateRecon: (seed: string) => {
    // Recon is already initiated by selectWorld(); kept for API compatibility.
  },

  fetchChunkData: (x, y) => {
    // Full intel fetch = scan straight to COMPLETE
    get().scanChunk(x, y, 3);
  },

  /**
   * Drone Scan: reveals intel about a chunk from the truth map.
   * Each scan deepens knowledge one level (BASIC -> DETAILED -> COMPLETE).
   * Efficiency >= 2 reveals two levels at once, >= 3 reveals everything.
   */
  scanChunk: (x, y, efficiency = 1) => {
    const { currentMap } = get();
    if (!currentMap || !truthMap) return;

    const key = `${x},${y}`;
    const clientChunk = currentMap.chunks[key];
    const truthChunk = truthMap.chunks[key];
    if (!clientChunk || !truthChunk) return;

    const levelGain = Math.max(1, Math.floor(efficiency));
    const newLevel = Math.min(ScanLevel.COMPLETE, clientChunk.scanLevel + levelGain) as ScanLevel;

    const revealed: IChunk = {
      ...truthChunk,
      scanLevel: newLevel,
      // Entities only become visible intel at DETAILED+
      entities: newLevel >= ScanLevel.DETAILED ? truthChunk.entities : []
    };

    set({
      currentMap: {
        ...currentMap,
        chunks: { ...currentMap.chunks, [key]: revealed }
      }
    });
  },

  selectChunk: (x, y) => set({ selectedDropZone: { x, y } }),

  /**
   * Confirms the drop: materializes the full world (the truth) and exits recon.
   * Unscanned chunks keep their fog status visually, but entities become real.
   */
  confirmDrop: () => {
    const { currentMap, selectedDropZone } = get();
    if (!currentMap || !truthMap || !selectedDropZone) return;

    const liveChunks: Record<string, IChunk> = {};
    Object.keys(truthMap.chunks).forEach(key => {
      const prevLevel = currentMap.chunks[key]?.scanLevel ?? ScanLevel.UNKNOWN;
      liveChunks[key] = {
        ...truthMap.chunks[key],
        scanLevel: Math.max(prevLevel, ScanLevel.BASIC) as ScanLevel
      };
    });

    set({
      currentMap: { ...currentMap, chunks: liveChunks },
      reconMode: false
    });
  },

  exitWorld: () => {
    truthMap = null;
    set({ activeWorldId: null, currentMap: null, reconMode: true, selectedDropZone: null });
  },

  updateEntity: (entityId, patch) => {
    const { currentMap } = get();
    if (!currentMap) return;
    for (const [key, chunk] of Object.entries(currentMap.chunks)) {
      const idx = chunk.entities.findIndex(e => e.id === entityId);
      if (idx === -1) continue;
      const entities = [...chunk.entities];
      entities[idx] = { ...entities[idx], ...patch };
      set({
        currentMap: {
          ...currentMap,
          chunks: { ...currentMap.chunks, [key]: { ...chunk, entities } }
        }
      });
      return;
    }
  },

  addEntity: (entity) => {
    const { currentMap } = get();
    if (!currentMap) return;
    const key = `${Math.floor(entity.position.x / 100)},${Math.floor(entity.position.y / 100)}`;
    const chunk = currentMap.chunks[key];
    if (!chunk) return;
    set({
      currentMap: {
        ...currentMap,
        chunks: { ...currentMap.chunks, [key]: { ...chunk, entities: [...chunk.entities, entity] } }
      }
    });
  },

  removeEntity: (entityId) => {
    const { currentMap } = get();
    if (!currentMap) return;
    for (const [key, chunk] of Object.entries(currentMap.chunks)) {
      if (!chunk.entities.some(e => e.id === entityId)) continue;
      set({
        currentMap: {
          ...currentMap,
          chunks: {
            ...currentMap.chunks,
            [key]: { ...chunk, entities: chunk.entities.filter(e => e.id !== entityId) }
          }
        }
      });
      return;
    }
  }
}));
import { create } from 'zustand';
import { IMap, ScanLevel, ISector } from './types';
import { UniversalRank } from '../../../types';
import { WorldCertificateSystem } from './WorldCertificate';
import { WorldGenerationService } from './services/WorldGenerationService';
import { IGenerationContext, WorldGenerator } from './WorldGenerator';
import { GRID_VERSION, chunkOf } from './grid';
import { DreamingSystem } from './Dreaming';
import { AffixBank } from '../../logic/content/AffixBank';

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
  // Built on an older grid: its record stands, but it cannot be walked any more
  retired?: boolean;
  // Wave 10E (D20): the content-pack version pinned at mint. Absent = minted
  // before the banks; the world keeps the purged legacy pool, forever.
  packVersion?: number;
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
  scanSector: (x: number, y: number, efficiency: number) => void;
  selectSector: (x: number, y: number) => void;
  loadAround: (px: number, py: number, radius: number) => void;
  confirmDrop: () => void;
  exitWorld: () => void;

  // Wave 2: world mutation (harvest depletion, chest looting, NPC state)
  updateEntity: (entityId: string, patch: Partial<import('./types').IWorldEntity>) => void;
  removeEntity: (entityId: string) => void;
  // Wave 3.3: ground caches (dropped/overflow items become world entities)
  addEntity: (entity: import('./types').IWorldEntity) => void;
  // Wave 10C (D16): towed carts move for real, across chunk lines
  moveEntity: (entityId: string, x: number, y: number) => void;
}

// What chunks are built from, kept for as long as the world is open.
let generationContext: IGenerationContext | null = null;

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

      // Wave 9.7: hubs are homes, not extraction zones — they never get a DEPLOY card
      const realWorlds: IWorldCard[] = certs.filter(cert => cert.data.worldType !== 'HUB').map(cert => ({
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
          ipFloor: cert.data.rules.ipFloor,
          retired: (cert.data.gridVersion ?? 1) < GRID_VERSION,
          packVersion: cert.data.rules.contentPackVersion
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

        generationContext = instance.context;
        const map = instance.mapData;

        // Wave 10E (the Dreaming): the world dreams from the bank it was pinned
        // to at mint — or from nothing new, if it predates the banks.
        DreamingSystem.activate(worldCard.seed,
          worldCard.packVersion ? AffixBank.packAt(worldCard.packVersion) : null);

        const isDev = !!worldCard.isDebug;

        set({
            activeWorldId: worldId,
            currentMap: map,
            reconMode: !isDev,
            // Dev worlds skip recon and start at the center
            selectedDropZone: isDev ? { x: Math.floor(worldCard.size / 2), y: Math.floor(worldCard.size / 2) } : null
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

  /**
   * Drone Scan: each scan deepens what is known of a sector one level.
   * A deep scan works out everything in it, which is also what makes it worth waiting for.
   */
  scanSector: (x, y, efficiency = 1) => {
    const { currentMap } = get();
    if (!currentMap || !generationContext) return;

    const key = `${x},${y}`;
    const sector = currentMap.sectors[key];
    if (!sector) return;

    const levelGain = Math.max(1, Math.floor(efficiency));
    const newLevel = Math.min(ScanLevel.COMPLETE, sector.scanLevel + levelGain) as ScanLevel;
    const revealed: ISector = {
      ...sector,
      scanLevel: newLevel,
      entities: newLevel >= ScanLevel.DETAILED && sector.entities.length === 0
        ? WorldGenerator.sectorContents(currentMap, x, y, generationContext)
        : sector.entities
    };

    set({ currentMap: { ...currentMap, sectors: { ...currentMap.sectors, [key]: revealed } } });
  },

  selectSector: (x, y) => set({ selectedDropZone: { x, y } }),

  loadAround: (px, py, radius) => {
    const { currentMap } = get();
    if (!currentMap || !generationContext) return;
    WorldGenerator.loadAround(currentMap, px, py, radius, generationContext);
  },

  /** Confirms the drop and leaves recon. Chunks are built as they come into reach. */
  confirmDrop: () => {
    const { currentMap, selectedDropZone } = get();
    if (!currentMap || !selectedDropZone) return;
    set({ reconMode: false });
  },

  exitWorld: () => {
    generationContext = null;
    DreamingSystem.deactivate();
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
    const key = `${chunkOf(entity.position.x)},${chunkOf(entity.position.y)}`;
    const chunk = currentMap.chunks[key];
    if (!chunk) return;
    set({
      currentMap: {
        ...currentMap,
        chunks: { ...currentMap.chunks, [key]: { ...chunk, entities: [...chunk.entities, entity] } }
      }
    });
  },

  // Wave 10C (D16): a towed cart crosses chunk lines for real — remove and
  // re-add so it always lives in the chunk under its wheels.
  moveEntity: (entityId, x, y) => {
    const { currentMap } = get();
    if (!currentMap) return;
    for (const [key, chunk] of Object.entries(currentMap.chunks)) {
      const idx = chunk.entities.findIndex(e => e.id === entityId);
      if (idx === -1) continue;
      const entity = { ...chunk.entities[idx], position: { x, y } };
      const targetKey = `${chunkOf(x)},${chunkOf(y)}`;
      if (targetKey === key) {
        const entities = [...chunk.entities];
        entities[idx] = entity;
        set({ currentMap: { ...currentMap, chunks: { ...currentMap.chunks, [key]: { ...chunk, entities } } } });
        return;
      }
      const target = currentMap.chunks[targetKey];
      if (!target) {
        // the destination chunk is not built yet: stay put this tick
        return;
      }
      set({
        currentMap: {
          ...currentMap,
          chunks: {
            ...currentMap.chunks,
            [key]: { ...chunk, entities: chunk.entities.filter(e => e.id !== entityId) },
            [targetKey]: { ...target, entities: [...target.entities, entity] }
          }
        }
      });
      return;
    }
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
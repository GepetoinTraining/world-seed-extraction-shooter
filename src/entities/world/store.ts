import { create } from 'zustand';
import { IMap, ScanLevel, ISector } from './types';
import { UniversalRank } from '../../../types';
import { WorldCertificateSystem } from './WorldCertificate';
import { WorldGenerationService } from './services/WorldGenerationService';
import { IGenerationContext, WorldGenerator } from './WorldGenerator';
import { GRID_VERSION, chunkOf } from './grid';
import { DreamingSystem } from './Dreaming';
import { AffixBank } from '../../logic/content/AffixBank';
import { ContentRegistry } from '../../logic/theme/ContentRegistry';
import { Director, IDirectorRecord } from './Director';
import { DirectorStore } from './DirectorStore';
import { ChestStore, ChestSystem, IChestRecord, emptyChestRecord } from './ChestSystem';
import { ICadence, IClockedWorld, SkyKind, WorldClock } from './WorldClock';
import { SurveySystem, ISurveyEntry } from '../../logic/systems/SurveySystem';

export interface IWorldCard extends IClockedWorld {
  id: string;
  seed: string;
  size: number;
  createdAt: number;
  cadence?: ICadence;
  sky?: SkyKind;
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
  // D27: the web this world's people are read through. Absent = the first version.
  webVersion?: number;
  /** D53: the theme it is made of. No theme, while themes exist, means it stood on the old tables: retired. */
  themeId?: string;
  magicUnlocked?: boolean;
}

interface WorldState {
  /** D48: how this world's monsters have come along, fed by this session's fights. */
  directorRecord: IDirectorRecord | null;
  reportToDirector: (kind: 'FELLED_A_PERSON' | 'FELL', definitionId: string) => void;
  /** What has been taken from the open world, kept beside it. Null where a world has no cycles to refill on. */
  chestRecord: IChestRecord | null;
  reportChestLooted: (chestId: string) => void;
  reportFell: (entityId: string) => void;
  availableWorlds: IWorldCard[];
  activeWorldId: string | null; 
  currentMap: IMap | null;
  /** D67: the regeneration the open world stands at. */
  generation: number;
  /** D68: what this character already knows of the open world, decayed to now. */
  applySurvey: (survey: Record<string, ISurveyEntry> | undefined) => void;
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
  directorRecord: null,
  chestRecord: null,
  reportChestLooted: (chestId) => {
    const { chestRecord, activeWorldId, generation } = get();
    if (!chestRecord || !activeWorldId || !ChestSystem.isChest(chestId)) return;
    const next = ChestSystem.looted(chestRecord, chestId, generation);
    set({ chestRecord: next });
    void ChestStore.save(activeWorldId, next);
  },
  reportFell: (entityId) => {
    const { chestRecord, activeWorldId, generation } = get();
    if (!chestRecord || !activeWorldId || !ChestSystem.chestOfGuard(entityId)) return;
    const next = ChestSystem.fell(chestRecord, entityId, generation);
    set({ chestRecord: next });
    void ChestStore.save(activeWorldId, next);
  },
  reportToDirector: (kind, definitionId) => {
    const record = get().directorRecord;
    if (record) set({ directorRecord: Director.report(record, kind, definitionId) });
  },
  availableWorlds: [],
  activeWorldId: null,
  currentMap: null,
  generation: 0,
  applySurvey: (survey) => {
    const { currentMap, generation } = get();
    if (!currentMap || !generationContext || !survey) return;
    const sectors = { ...currentMap.sectors };
    for (const [key, entry] of Object.entries(survey)) {
      const sector = sectors[key];
      if (!sector) continue;
      const scanLevel = SurveySystem.levelNow(entry, generation) as ScanLevel;
      sectors[key] = {
        ...sector, scanLevel,
        entities: scanLevel >= ScanLevel.DETAILED ? WorldGenerator.sectorContents(currentMap, sector.x, sector.y, generationContext) : sector.entities
      };
    }
    set({ currentMap: { ...currentMap, sectors } });
  },
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
          cadence: cert.data.rules.cadence,
          sky: cert.data.rules.sky,
          playerCount: cert.data.stats.totalVisitors,
          name: cert.data.worldName,
          difficulty: cert.data.rules.difficulty,
          creator: cert.data.creatorCertUid.substring(0, 8),
          isDebug: false,
          extractionTaxRate: cert.data.rules.extractionTaxRate ?? 0.05,
          deathPenalty: cert.data.rules.deathPenalty ?? 'INVENTORY_LOSS',
          ipCap: cert.data.rules.ipCap,
          ipFloor: cert.data.rules.ipFloor,
          // D54: a world on the retired tables keeps its record and can no longer be walked
          retired: (cert.data.gridVersion ?? 1) < GRID_VERSION
            || (ContentRegistry.list().length > 0 && !ContentRegistry.get(cert.data.rules.themeId)),
          packVersion: cert.data.rules.contentPackVersion,
          webVersion: cert.data.rules.webVersion,
          themeId: cert.data.rules.themeId,
          magicUnlocked: cert.data.rules.magicUnlocked
      }));

      // Dev World - Using the Service!
      const devWorld: IWorldCard = { 
          themeId: ContentRegistry.defaultThemeId(),
          id: 'dev-01', 
          seed: 'dev-sandbox-v4',
          size: 32, 
          createdAt: now,
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
        const moment = WorldClock.momentAt(worldCard, Date.now());
        const director = await DirectorStore.catchUp(worldCard.id, moment.generation, { seed: worldCard.seed, themeId: worldCard.themeId });
        set({ directorRecord: director, generation: moment.generation });
        const instance = await WorldGenerationService.activateWorld(worldCard.seed, worldCard.size, worldCard.themeId, worldCard.difficulty, director, worldCard.magicUnlocked);

        // A world outside the clock has no cycle to refill on, so it keeps no record
        const chestRecord = worldCard.isDebug ? null : await ChestStore.load(worldCard.id).catch(() => emptyChestRecord());
        set({ chestRecord });
        generationContext = {
          ...instance.context,
          lay: chunk => {
            const held = get().chestRecord;
            if (held) ChestSystem.layOver(worldCard.seed, chunk, held, moment.generation);
          }
        };
        const map = instance.mapData;

        // Wave 10E (the Dreaming): the world dreams from the bank it was pinned
        // to at mint — or from nothing new, if it predates the banks.
        DreamingSystem.activate(worldCard.seed,
          worldCard.themeId
            // D49: only once magic was unlocked does a world dream at all
            ? (worldCard.magicUnlocked ? ContentRegistry.dreamPack(worldCard.themeId) : null)
            : worldCard.packVersion ? AffixBank.packAt(worldCard.packVersion) : null);

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
    // What this session's fights said about the world's monsters, for the next rest
    const record = get().directorRecord;
    const worldId = get().activeWorldId;
    if (record && worldId) void DirectorStore.save(worldId, record);
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
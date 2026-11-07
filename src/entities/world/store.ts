import { create } from 'zustand';
import { IMap, ScanLevel, ISector } from '../../../shared/entities/world/types';
import { UniversalRank } from '../../../shared/types';
import { WorldCertificateSystem } from './WorldCertificate';
import { useIdentityStore } from '../identity/store';
import { WorldGenerationService } from './services/WorldGenerationService';
import { IGenerationContext, WorldGenerator } from '../../../shared/entities/world/WorldGenerator';
import { chunkOf } from '../../../shared/entities/world/grid';
import { DreamingSystem } from '../../../shared/entities/world/Dreaming';
import { LootBook } from '../../logic/theme/LootBook';
import { LiveClient } from '../../logic/live/LiveClient';
import { HostedLink } from '../../logic/live/HostedLink';
import { LootWriter } from '../../logic/theme/LootWriter';
import { IntelligenceClient } from '../../logic/intelligence/IntelligenceClient';
import { SharedWork } from '../../logic/hub/SharedWork';
import { AffixBank } from '../../../shared/logic/content/AffixBank';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { Director, IDirectorRecord } from '../../../shared/entities/world/Director';
import { DirectorStore } from './DirectorStore';
import { IPopulationRecord, Population, PopulationStore, emptyPopulationRecord } from '../../../shared/entities/world/Population';
import { IKoseki } from '../../../shared/entities/world/Koseki';
import { Leaders } from '../../../shared/entities/world/Leaders';
import { Territory } from '../../../shared/entities/world/Territory';
import { Wards } from '../../../shared/entities/world/Wards';
import { ChestStore, ChestSystem, IChestRecord, emptyChestRecord } from '../../../shared/entities/world/ChestSystem';
import { ICadence, IClockedWorld, SkyKind, WorldClock } from './WorldClock';
import { SurveySystem, ISurveyEntry } from '../../logic/systems/SurveySystem';
import { StoreUnit } from '../../../shared/entities/data/StoreUnit';
import { ScanPass } from '../../logic/systems/ScanPass';
import { scanRoom } from '../../logic/systems/ScanRoom';
import { Tutorial } from '../../logic/systems/Tutorial';

import type { IWorldCard, IWorldPort, IWorldView, WorldChange } from './worldView';
export type { IWorldCard } from './worldView';

interface WorldState extends IWorldView {
  /** The one door a system's changes come through, applied in order (worldView.ts). */
  apply: (...changes: WorldChange[]) => void;
  /** D48: how this world's monsters have come along, fed by this session's fights. */
  directorRecord: IDirectorRecord | null;
  reportToDirector: (kind: 'FELLED_A_PERSON' | 'FELL', definitionId: string, body?: { id: string; rank?: UniversalRank }) => void;
  /** D64: who stands on the land after alpha. Null where a world has no cycles for it to move on. */
  populationRecord: IPopulationRecord | null;
  /** D93: leaders someone has seen, in the field or by a scan. */
  reportSeen: (entityIds: string[]) => void;
  /** D69: words saved to this world's record while it stands open. A later scan reads them. */
  adoptRecord: (worldId: string, record: IDirectorRecord) => void;
  /** Resolves when what closing a world wrote has landed. */
  settled: () => Promise<void>;
  /** What has been taken from the open world, kept beside it. Null where a world has no cycles to refill on. */
  chestRecord: IChestRecord | null;
  reportChestLooted: (chestId: string) => void;
  reportFell: (entityId: string, definitionId?: string) => void;
  /** D65: a body taken alive: off its count, and onto this register. It hands the register back. */
  reportCaptured: (entityId: string, definitionId: string, to: IKoseki) => IKoseki;
  /** D65: a body let go on this ground. It stands now, and is a count once the cycle closes. */
  reportReleased: (ground: string, definitionId: string) => void;
  /** D93: something a leader raised went down. Its ward's clock runs in `Wards`, and what stays down is written on closing. */
  reportBroke: (structureId: string) => void;
  /** D93: what a person carried out of a leader's store. */
  reportStoreTaken: (structureId: string, count: number) => void;
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
  updateEntity: (entityId: string, patch: Partial<import('../../../shared/entities/world/types').IWorldEntity>) => void;
  removeEntity: (entityId: string) => void;
  // Wave 3.3: ground caches (dropped/overflow items become world entities)
  addEntity: (entity: import('../../../shared/entities/world/types').IWorldEntity) => void;
  // Wave 10C (D16): towed carts move for real, across chunk lines
  moveEntity: (entityId: string, x: number, y: number) => void;
}

// What chunks are built from, kept for as long as the world is open.
let generationContext: IGenerationContext | null = null;

/**
 * What this session's fights said, and nothing else about the record. The database's
 * copy may have moved while the world was open (D69), so closing adds these to it and
 * never writes the copy held here over it.
 */
let reports: { kind: 'FELLED_A_PERSON' | 'FELL'; definitionId: string; body?: { id: string; rank?: UniversalRank } }[] = [];
let landing: Promise<unknown> = Promise.resolve();

function landReports(worldId: string): void {
  const told = reports;
  reports = [];
  if (told.length === 0) return;
  landing = StoreUnit.enqueue(async () => {
    const saved = await DirectorStore.load(worldId);
    await DirectorStore.save(worldId, told.reduce((at, r) => Director.report(at, r.kind, r.definitionId, r.body), saved));
  }).catch(e => console.error('[WORLD] What this session reported did not land:', e));
}

/**
 * Another player's change to the world this person is in, live (LiveClient): a chest they emptied
 * is emptied here too. Chests and guards merge by the later cycle, so the order changes arrive in
 * does not matter, and the next save here carries both.
 */
LiveClient.on(event => {
  const { activeWorldId, chestRecord } = useWorldStore.getState();
  if (!activeWorldId || !chestRecord) return;
  const doc = event.docs.find(d => d.id === `world_chests_${activeWorldId}`);
  if (!doc) return;
  let remote: IChestRecord;
  try { remote = JSON.parse(doc.dataText) as IChestRecord; } catch { return; }
  const merged = ChestSystem.merge(chestRecord, remote);
  useWorldStore.setState({ chestRecord: merged });
  for (const id of Object.keys(remote.chests ?? {})) {
    if (chestRecord.chests[id]) continue;
    const chunk = Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).find(c => c.entities.some(e => e.id === id));
    const entity = chunk?.entities.find(e => e.id === id);
    if (entity?.container) useWorldStore.getState().updateEntity(id, { container: { ...entity.container, looted: true } });
  }
});

export const useWorldStore = create<WorldState>((set, get) => ({
  apply: (...changes) => {
    for (const change of changes) {
      const world = get();
      switch (change.kind) {
        case 'ADD_BODY': world.addEntity(change.entity); break;
        case 'UPDATE_BODY': world.updateEntity(change.entityId, change.patch); break;
        case 'REMOVE_BODY': world.removeEntity(change.entityId); break;
        case 'CAPTURED': world.reportCaptured(change.entityId, change.definitionId, change.to); break;
        case 'RELEASED': world.reportReleased(change.ground, change.definitionId); break;
        case 'ADOPT_RECORD': world.adoptRecord(change.worldId, change.record); break;
        case 'APPLY_SURVEY': world.applySurvey(change.survey); break;
        case 'CHEST_RECORD': set({ chestRecord: change.record }); break;
        case 'DROP_COUNTED':
          set(s => ({ availableWorlds: s.availableWorlds.map(w => (w.id === change.worldId ? { ...w, playerCount: w.playerCount + 1 } : w)) }));
          break;
      }
    }
  },
  directorRecord: null,
  populationRecord: null,
  reportSeen: (entityIds) => {
    const { populationRecord, activeWorldId, generation } = get();
    if (!populationRecord || !activeWorldId) return;
    const next = Population.saw(populationRecord, entityIds, generation);
    if (next === populationRecord) return;
    set({ populationRecord: next });
    void PopulationStore.save(activeWorldId, next);
  },
  chestRecord: null,
  reportChestLooted: (chestId) => {
    const { chestRecord, activeWorldId, generation } = get();
    if (!chestRecord || !activeWorldId || !ChestSystem.isChest(chestId)) return;
    const next = ChestSystem.looted(chestRecord, chestId, generation);
    set({ chestRecord: next });
    // Played live, the claim made before the chest opened was the write: the room's, after (LiveClient.chests)
    if (LiveClient.isLive(activeWorldId)) return;
    void ChestStore.save(activeWorldId, next);
  },
  reportBroke: (structureId) => {
    Wards.broke(Wards.live(), structureId, Date.now());
  },
  reportStoreTaken: (structureId, count) => {
    const { populationRecord, activeWorldId, generation } = get();
    if (!populationRecord || !activeWorldId || !Territory.isStructure(structureId)) return;
    const next = Population.robbed(populationRecord, structureId, count, generation);
    set({ populationRecord: next });
    void PopulationStore.save(activeWorldId, next);
  },
  reportFell: (entityId, definitionId) => {
    const { chestRecord, populationRecord, activeWorldId, generation } = get();
    if (!activeWorldId) return;
    Wards.broke(Wards.live(), entityId, Date.now());
    if (chestRecord && ChestSystem.chestOfGuard(entityId)) {
      const next = ChestSystem.fell(chestRecord, entityId, generation);
      set({ chestRecord: next });
      // Played live, the fall goes in the room's queue, and the record comes back as it stands
      if (LiveClient.isLive(activeWorldId)) {
        void LiveClient.chests({ op: 'fell', guardId: entityId, cycle: generation }).then(out => {
          if (out?.record && get().activeWorldId === activeWorldId) set({ chestRecord: ChestSystem.merge(get().chestRecord ?? out.record, out.record) });
        });
        return;
      }
      void ChestStore.save(activeWorldId, next);
    } else if (populationRecord && definitionId) {
      const next = Population.fell(populationRecord, entityId, definitionId, generation);
      if (next === populationRecord) return;
      set({ populationRecord: next });
      void PopulationStore.save(activeWorldId, next);
    }
  },
  reportCaptured: (entityId, definitionId, to) => {
    const { populationRecord, activeWorldId, generation } = get();
    // A body with no count to come off, in a world with no cycles, still moves onto the register
    const res = Population.captured(populationRecord ?? emptyPopulationRecord(), entityId, definitionId, generation, to);
    if (populationRecord && activeWorldId) {
      set({ populationRecord: res.record });
      void PopulationStore.save(activeWorldId, res.record);
    }
    return res.to;
  },
  reportReleased: (ground, definitionId) => {
    const { populationRecord, activeWorldId, generation } = get();
    if (!populationRecord || !activeWorldId) return;
    const next = Population.release(populationRecord, ground, definitionId, generation);
    set({ populationRecord: next });
    void PopulationStore.save(activeWorldId, next);
  },
  reportToDirector: (kind, definitionId, body) => {
    const record = get().directorRecord;
    if (!record) return;
    // A kind stays a kind: the ledger names a body only where the record holds one (D93)
    const named = body && Leaders.isLeader(body.id) ? body : undefined;
    reports.push({ kind, definitionId, body: named });
    set({ directorRecord: Director.report(record, kind, definitionId, named) });
  },
  adoptRecord: (worldId, record) => {
    if (get().activeWorldId !== worldId) return;
    const told = reports.reduce((at, r) => Director.report(at, r.kind, r.definitionId, r.body), record);
    set({ directorRecord: told });
    const card = get().availableWorlds.find(w => w.id === worldId);
    if (generationContext && card) {
      generationContext = { ...ContentRegistry.contextFor(card.themeId, card.difficulty, told, card.magicUnlocked), webVersion: generationContext.webVersion, cycleMs: generationContext.cycleMs, lay: generationContext.lay };
    }
  },
  settled: async () => { await landing; },
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
      const meta = useIdentityStore.getState().certificate?.metadata;
      const me = meta ? { uid: meta.uid, name: meta.displayName } : undefined;

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
          creator: WorldCertificateSystem.makerName(cert.data, me),
          creatorUid: cert.data.creatorCertUid,
          mintedWithDeed: cert.data.rules.mintedWithDeed,
          isDebug: false,
          extractionTaxRate: cert.data.rules.extractionTaxRate ?? 0.05,
          deathPenalty: cert.data.rules.deathPenalty ?? 'INVENTORY_LOSS',
          ipCap: cert.data.rules.ipCap,
          ipFloor: cert.data.rules.ipFloor,
          packVersion: cert.data.rules.contentPackVersion,
          webVersion: cert.data.rules.webVersion,
          // Q43: a world never retires. An older grid is walked on this one, and a theme it cannot read here gives way to the hub's own.
          themeId: ContentRegistry.standing(cert.data.rules.themeId),
          magicUnlocked: cert.data.rules.magicUnlocked
      }));

      // Q14: the debug world became the tutorial, a newcomer's first order. It stands first.
      set({ availableWorlds: [Tutorial.card(now), ...realWorlds] });
  },

  selectWorld: async (worldId: string) => {
      const worldCard = get().availableWorlds.find(w => w.id === worldId);
      if (!worldCard) return;

      console.log(`[WORLD] Selecting ${worldCard.name}...`);
      set({ isGenerating: true });

      try {
        // Whatever the last world had to say lands first, so what is read next includes it
        const leaving = get().activeWorldId;
        if (leaving) landReports(leaving);
        await landing;
        // Online play: our hosted world's shared documents are read and written in its room, before anything is read
        const playing = useIdentityStore.getState().certificate?.metadata.uid;
        if (HostedLink.is(worldCard.id) && playing) LiveClient.join({ worldUid: worldCard.id, uid: playing });
        else LiveClient.leave();
        // --- HOOKED UP: CALL SERVICE ---
        const moment = WorldClock.momentAt(worldCard, Date.now());
        const lineWorld = { seed: worldCard.seed, themeId: worldCard.themeId };
        const before = await DirectorStore.load(worldCard.id);
        const caught = await DirectorStore.catchUp(worldCard.id, moment.generation, lineWorld);
        const director = await ScanPass.compute(scanRoom, worldCard.id, before, caught, lineWorld);
        set({ directorRecord: director, generation: moment.generation });
        const instance = await WorldGenerationService.activateWorld(worldCard.seed, worldCard.size, worldCard.themeId, worldCard.difficulty, director, worldCard.magicUnlocked);

        // A world outside the clock has no cycle to refill on, so it keeps no record
        const chestRecord = worldCard.isDebug ? null : await ChestStore.load(worldCard.id).catch(() => emptyChestRecord());
        const populationRecord = worldCard.isDebug ? null : await PopulationStore.load(worldCard.id).catch(() => emptyPopulationRecord());
        set({ chestRecord, populationRecord });
        const cadence = worldCard.cadence ?? WorldClock.cadenceFor(worldCard.size);
        const context: IGenerationContext = { ...instance.context, webVersion: worldCard.webVersion, cycleMs: cadence.upMs + cadence.offMs + cadence.scanMs };
        generationContext = {
          ...context,
          lay: chunk => {
            // Who stands first, then what a chest's guards and contents say
            const living = get().populationRecord;
            if (living) Population.layOver(worldCard.seed, chunk, living, moment.generation, generationContext ?? context);
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
            ? (worldCard.magicUnlocked ? ContentRegistry.dreamPack(worldCard.themeId, director) : null)
            : worldCard.packVersion ? AffixBank.packAt(worldCard.packVersion) : null);
        // A chest in this world rolls on its theme's tables, when the theme has any (LootLaw.ts)
        LootBook.enter(worldCard.themeId);
        // A theme with no tables yet has them written, by the pool or this player's door; until then it drops as it always did
        void LootWriter.ensure(worldCard.themeId, ask => SharedWork.ask('loot', '/loot', { ask }, () => IntelligenceClient.writeLoot<unknown>(ask)));

        // Q14: every world opens on recon, the tutorial too: its first lesson is the scan
        set({
            activeWorldId: worldId,
            currentMap: map,
            reconMode: true,
            selectedDropZone: null
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
    // D93: what a scan reads has been seen, and its goal is decided by what happens now
    if (newLevel >= ScanLevel.DETAILED) get().reportSeen(revealed.entities.filter(e => Leaders.isLeader(e.id)).map(e => e.id));
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
    // Online play: the others here stop drawing this player
    LiveClient.unsay();
    // What this session's fights said about the world's monsters, for its next regeneration
    const worldId = get().activeWorldId;
    if (worldId) landReports(worldId);
    // What was folded is kept, so the next opening starts from it
    let living = get().populationRecord;
    // D93: what was broken in this opening and has not relit stays down
    if (living) for (const id of Object.keys(Wards.live().downAt)) if (Territory.isStructure(id)) living = Population.broke(living, id, get().generation);
    if (living && worldId) void PopulationStore.save(worldId, living);
    Wards.reset();
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

/** The world as a system takes it (worldView.ts): a fresh view on each read, and the store's one door. */
export const worldPort: IWorldPort = {
  view: () => useWorldStore.getState(),
  apply: (...changes) => useWorldStore.getState().apply(...changes),
  open: (worldId) => useWorldStore.getState().selectWorld(worldId)
};

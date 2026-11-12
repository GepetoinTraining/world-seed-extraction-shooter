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
import { TutorialStart } from './TutorialStart';
import { SHELF_STATE } from '../../../shared/logic/theme/shelf';
import { IPopulationRecord, Population, PopulationStore, emptyPopulationRecord } from '../../../shared/entities/world/Population';
import { IKoseki } from '../../../shared/entities/world/Koseki';
import { Leaders } from '../../../shared/entities/world/Leaders';
import { Territory } from '../../../shared/entities/world/Territory';
import { Wards } from '../../../shared/entities/world/Wards';
import { ChestStore, ChestSystem, IChestRecord, emptyChestRecord } from '../../../shared/entities/world/ChestSystem';
import { GroundReturn, GroundStore, IGroundRecord, emptyGroundRecord } from '../../../shared/entities/world/GroundReturn';
import { IWorldEntity } from '../../../shared/entities/world/types';
import { GameClock } from '../../logic/time/GameClock';
import { MintAdditionsWriter } from '../../logic/theme/writing/MintAdditionsWriter';
import { SpreadBook } from '../../../shared/entities/world/Spread';
import { MaterialDoingWriter } from '../../logic/theme/writing/MaterialDoingWriter';
import type { ResourceDef } from '../../../shared/entities/item/data/resourceDefinitions';
import { ICadence, IClockedWorld, SkyKind, WorldClock } from './WorldClock';
import { SurveySystem, ISurveyEntry } from '../../logic/systems/SurveySystem';
import { StoreUnit } from '../../../shared/entities/data/StoreUnit';
import { ScanPass } from '../../logic/systems/ScanPass';
import { scanRoom } from '../../logic/systems/ScanRoom';
import { Tutorial } from '../../logic/systems/Tutorial';

import type { IWorldCard, IWorldPort, IWorldView, WorldChange } from './worldView';
import { offerPort } from '../storePorts';
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
  /** RG: what has been taken from the open world's ground, kept beside it. Null where a world has no turns to give back on. */
  groundRecord: IGroundRecord | null;
  /** RG: a place the land laid was taken from, and this much is left. The place stands as the record says. */
  reportGroundTaken: (entityId: string, left: number) => void;
  /** RG: every loaded place whose turn has come by the game's clock stands again, rolled anew. Nothing else runs. */
  sweepGround: (now?: number) => void;
  reportFell: (entityId: string, definitionId?: string) => void;
  /** D65: a body taken alive: off its count, and onto this register. It hands the register back. */
  reportCaptured: (entityId: string, definitionId: string, to: IKoseki) => IKoseki;
  /** D65: a body let go on this ground. It stands now, and is a count once the cycle closes. */
  reportReleased: (ground: string, definitionId: string) => void;
  /** A person walked or was carried out. They do not stand in this world again. */
  reportLeft: (entityId: string) => void;
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

/** RG: the open world's card, what its chunks are built from, and the turn the game's clock says it is. */
const openCard = (): IWorldCard | undefined => {
  const { availableWorlds, activeWorldId } = useWorldStore.getState();
  return availableWorlds.find(w => w.id === activeWorldId);
};
const contextOf = (card: IWorldCard): IGenerationContext =>
  generationContext ?? ContentRegistry.contextFor(ContentRegistry.standing(card.themeId), card.difficulty);
const turnOf = (card: IWorldCard, now = GameClock.now()): number => WorldClock.momentAt(card, now).generation;

/** RG: lays the ground record over loaded places. `due` alone: only those whose turn has come; else the ones named. */
function layGround(now: number, only?: string[]): void {
  const { groundRecord, currentMap } = useWorldStore.getState();
  const card = openCard();
  if (!groundRecord || !currentMap || !card) return;
  const turn = turnOf(card, now);
  const context = contextOf(card);
  let chunks = currentMap.chunks;
  for (const id of only ?? Object.keys(groundRecord.taken)) {
    const key = GroundReturn.chunkKeyOf(id);
    const chunk = key ? chunks[key] : undefined;
    const at = chunk ? chunk.entities.findIndex(e => e.id === id) : -1;
    if (!chunk || at < 0) continue;
    const place = chunk.entities[at];
    // Unnamed, only what is waiting and whose turn has come: nothing else changes, so nothing else is drawn again
    if (!only && !(place.returning && turn >= place.returning.turn)) continue;
    const standing: IWorldEntity = GroundReturn.standing(currentMap.seed, place, chunk.biome, groundRecord, turn, context, t => WorldClock.turnStartsAt(card, t), chunk.difficulty);
    const entities = [...chunk.entities];
    entities[at] = standing;
    chunks = { ...chunks, [key!]: { ...chunk, entities } };
  }
  if (chunks !== currentMap.chunks) useWorldStore.setState({ currentMap: { ...currentMap, chunks } });
}

/** RG: another player's taking, live, in the world this person is in: merged by the later taking, and laid. */
LiveClient.on(event => {
  const { activeWorldId, groundRecord } = useWorldStore.getState();
  if (!activeWorldId || !groundRecord) return;
  const doc = event.docs.find(d => d.id === GroundStore.docId(activeWorldId));
  if (!doc) return;
  let remote: IGroundRecord;
  try { remote = JSON.parse(doc.dataText) as IGroundRecord; } catch { return; }
  if (!remote?.taken) return;
  useWorldStore.setState({ groundRecord: GroundReturn.merge(groundRecord, remote) });
  layGround(GameClock.now(), Object.keys(remote.taken));
});

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
        case 'GROUND_TAKEN': world.reportGroundTaken(change.entityId, change.left); break;
        case 'STORE_TAKEN': world.reportStoreTaken(change.structureId, change.count); break;
        case 'CHEST_LOOTED': world.reportChestLooted(change.chestId); break;
        case 'LEFT': world.reportLeft(change.entityId); break;
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
  groundRecord: null,
  reportGroundTaken: (entityId, left) => {
    const { groundRecord, activeWorldId, currentMap } = get();
    const card = openCard();
    if (!groundRecord || !activeWorldId || !currentMap || !card) return;
    const key = GroundReturn.chunkKeyOf(entityId);
    const place = key ? currentMap.chunks[key]?.entities.find(e => e.id === entityId) : undefined;
    if (!place) return;
    const next = GroundReturn.took(groundRecord, place, left, turnOf(card));
    if (next === groundRecord) return;
    set({ groundRecord: next });
    layGround(GameClock.now(), [entityId]);
    void GroundStore.save(activeWorldId, next).catch(e => console.error('[WORLD] What was taken from the ground did not land:', e));
  },
  sweepGround: (now = GameClock.now()) => layGround(now),
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
  reportLeft: (entityId) => {
    const { populationRecord, activeWorldId, generation } = get();
    if (!populationRecord || !activeWorldId) return;
    const next = Population.left(populationRecord, entityId, generation);
    if (next === populationRecord) return;
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
      generationContext = { ...ContentRegistry.contextFor(card.themeId, card.difficulty, told, Tutorial.dreams(card, SHELF_STATE.magicUnlocked)), webVersion: generationContext.webVersion, groundVersion: generationContext.groundVersion, cycleMs: generationContext.cycleMs, lay: generationContext.lay };
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
          groundVersion: cert.data.rules.groundVersion,
          // Q43: a world never retires. An older grid is walked on this one, and a theme it cannot read here gives way to the hub's own.
          themeId: ContentRegistry.standing(cert.data.rules.themeId),
          magicUnlocked: cert.data.rules.magicUnlocked
      }));

      // Q14: the debug world became the tutorial, a newcomer's first order. It stands first.
      // Its gate never closes, and it turns all the same, from the day this hub first held it.
      const turnsFrom = await TutorialStart.at(now).catch(() => undefined);
      set({ availableWorlds: [Tutorial.card(now, turnsFrom), ...realWorlds] });
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
        // The server's clock is the clock (D135): a world's turn is read off the game's, never the device's
        const moment = WorldClock.momentAt(worldCard, GameClock.now());
        const lineWorld = { seed: worldCard.seed, themeId: worldCard.themeId };
        const before = await DirectorStore.load(worldCard.id);
        const caught = await DirectorStore.catchUp(worldCard.id, moment.generation, lineWorld);
        const director = await ScanPass.compute(scanRoom, worldCard.id, before, caught, lineWorld);
        set({ directorRecord: director, generation: moment.generation });
        // D49: a minted world dreams as it was pinned; the tutorial, never minted, as its hub stands now
        const dreams = Tutorial.dreams(worldCard, SHELF_STATE.magicUnlocked);
        const instance = await WorldGenerationService.activateWorld(worldCard.seed, worldCard.size, worldCard.themeId, worldCard.difficulty, director, dreams, worldCard.groundVersion, worldCard.deathPenalty);

        // A world that never turns has no cycle to refill on, so it keeps no record. The tutorial turns (Pedro's own
        // run, 2026-11-10: "the chests always respawn", "the NPC are extracted and respawn"), so it keeps one like any other
        const keeps = WorldClock.turns(worldCard);
        const chestRecord = keeps ? await ChestStore.load(worldCard.id).catch(() => emptyChestRecord()) : null;
        const populationRecord = keeps ? await PopulationStore.load(worldCard.id).catch(() => emptyPopulationRecord()) : null;
        // RG: what was taken from the ground comes back on the world's turns, the tutorial's too
        const groundRecord = keeps ? await GroundStore.load(worldCard.id).catch(() => emptyGroundRecord()) : null;
        set({ chestRecord, populationRecord, groundRecord });
        const cadence = worldCard.cadence ?? WorldClock.cadenceFor(worldCard.size);
        // C24: the land is laid by the ground the world pinned, as its people are read through the web it pinned
        // IB: what its minting added, from the ground it was laid on: found pieces take their nouns from its own bases,
        // and its land holds its own materials beside its pack's. A world laid before adds nothing
        const minted = await MintAdditionsWriter.enter(worldCard).catch(() => []);
        const context: IGenerationContext = {
          ...instance.context, webVersion: worldCard.webVersion, groundVersion: worldCard.groundVersion, cycleMs: cadence.upMs + cadence.offMs + cadence.scanMs,
          ...(minted.length > 0 ? { resourceDefinitions: [...instance.context.resourceDefinitions, ...minted] } : {})
        };
        // ML: which of its materials is the base of its form, and what marks each variant wears, in this world
        SpreadBook.enter(context.resourceDefinitions as ResourceDef[], ContentRegistry.standing(worldCard.themeId));
        // ML21: what the materials already do, as written the first time each was needed, for the cards to read
        void MaterialDoingWriter.enter().catch(() => undefined);
        generationContext = {
          ...context,
          lay: chunk => {
            // Who stands first, then what a chest's guards and contents say
            const living = get().populationRecord;
            if (living) Population.layOver(worldCard.seed, chunk, living, moment.generation, generationContext ?? context);
            const held = get().chestRecord;
            if (held) ChestSystem.layOver(worldCard.seed, chunk, held, moment.generation);
            // RG: then what was taken from the ground, read at the turn it is now, since a chunk may be built long after the opening
            const ground = get().groundRecord;
            if (ground) GroundReturn.layOver(worldCard.seed, chunk, ground, WorldClock.momentAt(worldCard, GameClock.now()).generation, generationContext ?? context, t => WorldClock.turnStartsAt(worldCard, t));
          }
        };
        const map = instance.mapData;

        // Wave 10E (the Dreaming): the world dreams from the bank it was pinned
        // to at mint — or from nothing new, if it predates the banks.
        DreamingSystem.activate(worldCard.seed,
          worldCard.themeId
            // D49: only once magic was unlocked does a world dream at all
            ? (dreams ? ContentRegistry.dreamPack(worldCard.themeId, director) : null)
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
    set({ activeWorldId: null, currentMap: null, reconMode: true, selectedDropZone: null, groundRecord: null });
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

offerPort('world', worldPort);

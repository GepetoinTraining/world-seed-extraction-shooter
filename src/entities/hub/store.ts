/**
 * Hub Store - Manages persistent hub state
 * REFACTORED: Removes mock data, loads from Vector/DB State
 */

import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { create } from 'zustand';
import { IItem, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { HubGenerator } from './HubGenerator';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { usePlayerStore } from '../player/store';
import { Ledger } from '../../logic/ledger/Ledger';
import { Treasury } from '../../logic/economy/Treasury';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, STRUCTURE_COSTS, PLAYER_SHOP_TAX } from '../economy/data/recipeDefinitions';
import { TransformationEngine } from '../economy/TransformationEngine';
import { PlayerPersistence } from '../../logic/persistence/PlayerPersistence';
import { CertificateSystem } from '../identity/certificateSystem';
import { useIdentityStore } from '../identity/store';
import {
  IRoomState, RoomPieceKind, RoomVerdict, emptyRoom, canBuildPiece, canPlaceItem, pickBill,
  PIECE_BILLS, PIECE_BUILD_SECONDS, SHELL_BILLS, SHELL_BUILD_SECONDS, SHELL_STATION
} from './room';

export const HUB_ENDOWMENT_GOLD = 100_000;

// =============================================================================
// TYPES
// =============================================================================

export interface IPlayerLot {
  id: string;
  lotIndex: number;
  ownerId: string | null;
  ownerName: string | null;
  purchaseDate: number | null;
  structureType: 'EMPTY' | 'VENDOR' | 'WORKSHOP' | 'HOUSE';
  inventory: IItem[];
  price: number;
  // Wave 5.3: a VENDOR lot's storefront
  shopListings?: { item: IItem; price: number }[];
  // Wave 5.4: upkeep is charged per world-day; unpaid lots revert to market
  upkeepPaidThroughDay?: number;
  // Sale money held on the lot until its owner collects it
  proceeds?: number;
}

// Wave 5.2: a queued transformation. Accumulate/resolve — the job is just
// timestamps; outputs mint when someone looks (resolveCrafts).
export interface ICraftJob {
  id: string;
  lotId: string;
  recipeId: string;
  ownerCertUid: string;
  queuedAt: number;
  finishesAt: number;
  collected: boolean;
}

/** Logical world-day (observed time, never stored clocks). */
export const worldDay = () => Math.floor(Date.now() / 86_400_000);

// Wave 10 (D8): a queued construction step. Materials leave the stash when the
// job is queued — exactly once — and the piece applies when the clock says so.
export interface IBuildJob {
  id: string;
  lotId: string;
  kind: 'SHELL' | 'PIECE';
  structureType?: 'HOUSE' | 'WORKSHOP' | 'VENDOR';
  piece?: { kind: RoomPieceKind; x: number; y: number; materialDefId: string };
  ownerCertUid: string;
  queuedAt: number;
  finishesAt: number;
  applied: boolean;
  consumedIds: string[];
  consumedDefIds: string[];
  /** The owner's signature over the queued record: every completed step is signed. */
  signature?: string;
}

const dominantDefId = (defIds: string[]): string => {
  const counts = new Map<string, number>();
  for (const id of defIds) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'crf_plank';
};

/** The owner signs the record. No certificate, no signature — the record still stands, unsigned. */
async function signRecord(payload: Record<string, any>): Promise<string | undefined> {
  const cert = useIdentityStore.getState().certificate;
  if (!cert) return undefined;
  try {
    const signed = await CertificateSystem.signPayload(cert.metadata.uid, payload);
    return signed.signature;
  } catch {
    return undefined;
  }
}

const removeFromStash = (ids: string[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
    idx === 0 ? { ...tab, items: tab.items.filter(i => !ids.includes(i.id)) } : tab
  ) } }
}));

const addToStash = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
    idx === 0 ? { ...tab, items: [...tab.items, ...items] } : tab
  ) } }
}));

export interface IShopListing {
  id: string;
  item: IItem;
  price: number;
  vendorId: string;
  stock: number;
}

export interface IAuctionListing {
  id: string;
  item: IItem;
  sellerId: string;
  sellerName: string;
  startPrice: number;
  currentBid: number;
  currentBidderId: string | null;
  endTime: number;
  buyoutPrice?: number;
}

// =============================================================================
// STORE
// =============================================================================

interface HubState {
  activeHubId: string | null;
  lots: IPlayerLot[];
  craftingJobs: ICraftJob[];
  // Wave 10: the rooms behind the doors, and the construction queue
  rooms: Record<string, IRoomState>;
  buildJobs: IBuildJob[];
  weaponShop: IShopListing[];
  armorShop: IShopListing[];
  consumableShop: IShopListing[];
  auctionListings: IAuctionListing[];
  isLoading: boolean;

  // Actions
  loadHub: (hubWorldUid: string) => Promise<void>;
  saveHubState: () => Promise<void>;

  purchaseLot: (lotId: string, playerId: string, playerName: string) => Promise<boolean>;
  setLotStructure: (lotId: string, structureType: IPlayerLot['structureType']) => Promise<void>;
  purchaseFromShop: (listingId: string, shop: 'weapon' | 'armor' | 'consumable') => IItem | null;

  // Wave 5: society
  buyLot: (lotId: string) => Promise<boolean>;
  buildStructure: (lotId: string, type: 'HOUSE' | 'WORKSHOP' | 'VENDOR') => Promise<boolean>;
  // Wave 10: construction and placement
  resolveBuilds: () => Promise<number>;
  queuePiece: (lotId: string, kind: RoomPieceKind, x: number, y: number, materialItemId: string) => Promise<RoomVerdict>;
  demolishPiece: (lotId: string, pieceId: string) => Promise<boolean>;
  placeItem: (lotId: string, itemId: string, x: number, y: number, rotated: boolean) => Promise<RoomVerdict>;
  reclaimItem: (lotId: string, placementId: string) => Promise<boolean>;
  queueCraft: (lotId: string, recipeId: string) => Promise<boolean>;
  resolveCrafts: () => Promise<number>;
  sellToVendor: (itemId: string) => Promise<number | null>;
  listItemForSale: (lotId: string, itemId: string, price: number) => Promise<boolean>;
  buyFromLot: (lotId: string, itemId: string) => Promise<boolean>;
  collectProceeds: (lotId: string) => Promise<number>;
  resolveUpkeep: (simDay?: number) => Promise<void>;

  // Admin / Generator
  generateDailyStock: () => void;
}

export const useHubStore = create<HubState>((set, get) => ({
  activeHubId: null,
  lots: [],
  craftingJobs: [],
  rooms: {},
  buildJobs: [],
  weaponShop: [],
  armorShop: [],
  consumableShop: [],
  auctionListings: [],
  isLoading: false,
  
  loadHub: async (hubWorldUid: string) => {
    set({ isLoading: true, activeHubId: hubWorldUid });

    try {
      // 1. Try to fetch existing Hub State from DB
      const hubStateDoc = await VectorStore.get<{ lots: IPlayerLot[]; craftingJobs?: ICraftJob[]; rooms?: Record<string, IRoomState>; buildJobs?: IBuildJob[] }>(
        VectorNamespace.TERRITORIES,
        `hub_state_${hubWorldUid}`
      );

      if (hubStateDoc) {
        // LOAD EXISTING
        console.log('[HUB] State loaded from persistence.');
        set({
          lots: hubStateDoc.data.lots,
          craftingJobs: hubStateDoc.data.craftingJobs || [],
          rooms: hubStateDoc.data.rooms || {},
          buildJobs: hubStateDoc.data.buildJobs || []
        });
      } else {
        // GENERATE FRESH (First time this Hub is visited)
        console.log('[HUB] No state found. Generating fresh layout...');
        
        // Use the HubGenerator to find lot positions
        const layout = HubGenerator.generate();
        const lotPOIs = layout.zones.flatMap(z => z.pois).filter(p => p.type === 'PLAYER_LOT');
        
        const freshLots: IPlayerLot[] = lotPOIs.map((poi, idx) => ({
          id: poi.id,
          lotIndex: idx,
          ownerId: null,
          ownerName: null,
          purchaseDate: null,
          structureType: 'EMPTY',
          inventory: [],
          price: 5000 // Base price from POI metadata
        }));

        set({ lots: freshLots });
        // Save immediately
        await get().saveHubState();
      }

      // 2. Generate/Load Shop Stock (Simulated Daily Refresh)
      // In a real app, this would be server-side. Here we simulate it.
      get().generateDailyStock();

      await Treasury.endow(hubWorldUid, HUB_ENDOWMENT_GOLD);

      // 3. Wave 5 / Wave 10: resolve what time finished while nobody watched
      await get().resolveCrafts();
      await get().resolveBuilds();
      await get().resolveUpkeep();

    } catch (e) {
      console.error('[HUB] Failed to load hub:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  saveHubState: async () => {
    const { activeHubId, lots, craftingJobs, rooms, buildJobs } = get();
    if (!activeHubId) return;

    // Hub changes usually move gold or items, so the bank is saved with them
    void PlayerPersistence.flush('hub');

    await VectorStore.put({
      id: `hub_state_${activeHubId}`,
      namespace: VectorNamespace.TERRITORIES,
      data: { lots, craftingJobs, rooms, buildJobs },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    });
  },
  
  purchaseLot: async (lotId, playerId, playerName) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    
    if (!lot || lot.ownerId) return false;
    
    const updatedLots = lots.map(l => 
      l.id === lotId 
        ? { 
            ...l, 
            ownerId: playerId, 
            ownerName: playerName, 
            purchaseDate: Date.now(),
            upkeepPaidThroughDay: worldDay()
          }
        : l
    );
    
    set({ lots: updatedLots });
    await saveHubState(); // Persist changes
    return true;
  },

  setLotStructure: async (lotId, structureType) => {
    const { lots, saveHubState } = get();
    const updatedLots = lots.map(l =>
      l.id === lotId ? { ...l, structureType } : l
    );
    set({ lots: updatedLots });
    await saveHubState();
  },

  // ==========================================================================
  // WAVE 5: SOCIETY
  // ==========================================================================

  /** Buy an unowned lot with gold. The price goes to the hub treasury. */
  buyLot: async (lotId) => {
    const { lots, activeHubId } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || lot.ownerId || !activeHubId) return false;
    if (p.bank.gold < lot.price) {
      console.log(`[LOT] Cannot afford lot ${lot.lotIndex} (${lot.price}G).`);
      return false;
    }

    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - lot.price } } }));
    await Treasury.credit(activeHubId, lot.price);
    await Ledger.append('GOLD_DELTA', { reason: 'LOT_PURCHASE', lotId, amount: -lot.price, treasuryId: activeHubId, treasuryDelta: lot.price });

    const ok = await get().purchaseLot(lotId, p.id, p.username);
    if (ok) console.log(`[LOT] Lot ${lot.lotIndex} purchased for ${lot.price}G.`);
    return ok;
  },

  /**
   * Wave 10 (D8): raise a shell on a lot you own. The permit is gold (to the
   * treasury); the walls are materials, consumed from the stash exactly once,
   * at queue time; the building finishes on the clock (resolveBuilds).
   */
  buildStructure: async (lotId, type) => {
    const { lots, activeHubId, buildJobs, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || !activeHubId) return false;
    if (lot.ownerId !== p.id) {
      console.log('[BUILD] You do not own this lot.');
      return false;
    }
    if (buildJobs.some(j => j.lotId === lotId && j.kind === 'SHELL' && !j.applied)) {
      console.log('[BUILD] Construction is already underway on this lot.');
      return false;
    }
    const room = get().rooms[lotId];
    if (lot.structureType !== 'EMPTY' && room && (room.pieces.length > 0 || room.placements.length > 0)) {
      console.log('[BUILD] The building is not empty. Reclaim what stands inside first.');
      return false;
    }
    const cost = STRUCTURE_COSTS[type].build;
    if (p.bank.gold < cost) {
      console.log(`[BUILD] ${type} permit costs ${cost}G; you have ${p.bank.gold}G.`);
      return false;
    }
    const stash = p.bank.stashTabs[0]?.items || [];
    const bill = pickBill(SHELL_BILLS[type], stash);
    if (!bill.ok) {
      console.log(`[BUILD] The bill is short: ${bill.missing}. Bring the materials.`);
      return false;
    }

    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
    removeFromStash(bill.items.map(i => i.id));
    await Treasury.credit(activeHubId, cost);

    const job: IBuildJob = {
      id: `bld_${Date.now().toString(36)}_${lot.lotIndex}`,
      lotId,
      kind: 'SHELL',
      structureType: type,
      ownerCertUid: p.id,
      queuedAt: Date.now(),
      finishesAt: Date.now() + SHELL_BUILD_SECONDS[type] * 1000,
      applied: false,
      consumedIds: bill.items.map(i => i.id),
      consumedDefIds: bill.items.map(i => i.universalDefinitionId)
    };
    job.signature = await signRecord({ kind: 'SHELL', lotId, structureType: type, consumedIds: job.consumedIds, at: job.queuedAt });

    set({ buildJobs: [...get().buildJobs, job] });
    await Ledger.append('GOLD_DELTA', { reason: 'BUILD_PERMIT', lotId, structure: type, amount: -cost, treasuryId: activeHubId, treasuryDelta: cost });
    await Ledger.append('BUILD', { kind: 'SHELL_QUEUED', jobId: job.id, lotId, structure: type, consumedIds: job.consumedIds });
    await saveHubState();
    console.log(`[BUILD] ${type} under construction on lot ${lot.lotIndex} (${SHELL_BUILD_SECONDS[type]}s).`);
    return true;
  },

  /** Apply every finished construction job: shells stand up, pieces join the room. */
  resolveBuilds: async () => {
    const now = Date.now();
    const due = get().buildJobs.filter(j => !j.applied && j.finishesAt <= now);
    if (due.length === 0) return 0;

    const layout = HubGenerator.generate();
    let applied = 0;
    for (const job of due) {
      if (job.kind === 'SHELL' && job.structureType) {
        const poi = HubGenerator.findPOI(layout, job.lotId);
        const footprint = poi ? { width: poi.size.width, height: poi.size.height } : { width: 4, height: 4 };
        const shellMaterial = dominantDefId(job.consumedDefIds);
        set({
          lots: get().lots.map(l => l.id === job.lotId ? { ...l, structureType: job.structureType!, upkeepPaidThroughDay: worldDay() } : l),
          rooms: { ...get().rooms, [job.lotId]: emptyRoom(job.lotId, footprint, shellMaterial) }
        });
        // The structure brings its station: an item like any other, into the stash.
        const stationDefId = SHELL_STATION[job.structureType];
        if (stationDefId) {
          const station = ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[stationDefId] as any, Rng.fromKey(`${job.id}:station`));
          addToStash([station]);
          const { Provenance } = await import('../../logic/sovereignty/Provenance');
          await Provenance.record(station, 'MINT', { origin: 'CONSTRUCTION', jobId: job.id, lotId: job.lotId, structure: job.structureType });
        }
        await Ledger.append('BUILD', { kind: 'SHELL_DONE', jobId: job.id, lotId: job.lotId, structure: job.structureType });
      } else if (job.kind === 'PIECE' && job.piece) {
        const room = get().rooms[job.lotId];
        if (room) {
          set({
            rooms: {
              ...get().rooms,
              [job.lotId]: {
                ...room,
                pieces: [...room.pieces, {
                  id: `pc_${job.id}`,
                  kind: job.piece.kind,
                  x: job.piece.x,
                  y: job.piece.y,
                  materialDefId: job.piece.materialDefId,
                  builtBy: job.ownerCertUid,
                  at: job.finishesAt,
                  signature: job.signature
                }]
              }
            }
          });
          await Ledger.append('BUILD', { kind: 'PIECE_DONE', jobId: job.id, lotId: job.lotId, piece: job.piece });
        }
      }
      applied++;
    }
    set({ buildJobs: get().buildJobs.map(j => due.some(d => d.id === j.id) ? { ...j, applied: true } : j) });
    await get().saveHubState();
    return applied;
  },

  /** Queue one structural piece in your own room. The material is the look. */
  queuePiece: async (lotId, kind, x, y, materialItemId) => {
    const { lots, rooms, buildJobs, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const room = rooms[lotId];
    const p = usePlayerStore.getState().player;
    if (!lot || !room) return { ok: false, reason: 'There is no room here yet.' };
    if (lot.ownerId !== p.id) return { ok: false, reason: 'You do not own this room.' };

    // Validate against the room as it WILL be, pending pieces included.
    const pending = buildJobs.filter(j => !j.applied && j.lotId === lotId && j.kind === 'PIECE' && j.piece);
    const preview: IRoomState = {
      ...room,
      pieces: [...room.pieces, ...pending.map(j => ({ id: j.id, ...j.piece!, builtBy: j.ownerCertUid, at: j.queuedAt }))]
    };
    const verdict = canBuildPiece(preview, kind, x, y);
    if (!verdict.ok) return verdict;

    const stash = p.bank.stashTabs[0]?.items || [];
    const material = stash.find(i => i.id === materialItemId);
    const bill = PIECE_BILLS[kind];
    if (!material) return { ok: false, reason: 'That material is not in your stash.' };
    if (!(material.tags || []).includes(bill.tag)) {
      return { ok: false, reason: `A ${kind.toLowerCase()} asks for something ${bill.tag}; ${material.name} is not.` };
    }
    const picked = pickBill([bill], [material, ...stash.filter(i => i.id !== material.id && i.universalDefinitionId === material.universalDefinitionId)]);
    if (!picked.ok) return { ok: false, reason: `A ${kind.toLowerCase()} takes ${bill.count}x ${bill.tag}; you hold less.` };

    removeFromStash(picked.items.map(i => i.id));
    const job: IBuildJob = {
      id: `bld_${Date.now().toString(36)}_${x}_${y}`,
      lotId,
      kind: 'PIECE',
      piece: { kind, x, y, materialDefId: material.universalDefinitionId },
      ownerCertUid: p.id,
      queuedAt: Date.now(),
      finishesAt: Date.now() + PIECE_BUILD_SECONDS[kind] * 1000,
      applied: false,
      consumedIds: picked.items.map(i => i.id),
      consumedDefIds: picked.items.map(i => i.universalDefinitionId)
    };
    job.signature = await signRecord({ kind: 'PIECE', lotId, piece: job.piece, consumedIds: job.consumedIds, at: job.queuedAt });
    set({ buildJobs: [...get().buildJobs, job] });
    await Ledger.append('BUILD', { kind: 'PIECE_QUEUED', jobId: job.id, lotId, piece: job.piece, consumedIds: job.consumedIds });
    await saveHubState();
    return { ok: true };
  },

  /** Take a piece down. The materials do not come back; the ledger remembers. */
  demolishPiece: async (lotId, pieceId) => {
    const { lots, rooms, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const room = rooms[lotId];
    const p = usePlayerStore.getState().player;
    if (!lot || !room || lot.ownerId !== p.id) return false;
    const piece = room.pieces.find(pc => pc.id === pieceId);
    if (!piece) return false;
    set({ rooms: { ...get().rooms, [lotId]: { ...room, pieces: room.pieces.filter(pc => pc.id !== pieceId) } } });
    await Ledger.append('BUILD', { kind: 'DEMOLISHED', lotId, pieceId, piece: { kind: piece.kind, x: piece.x, y: piece.y } });
    await saveHubState();
    return true;
  },

  /** Stand a stash item in your room. The item moves; the record is signed. */
  placeItem: async (lotId, itemId, x, y, rotated) => {
    const { lots, rooms, buildJobs, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const room = rooms[lotId];
    const p = usePlayerStore.getState().player;
    if (!lot || !room) return { ok: false, reason: 'There is no room here yet.' };
    if (lot.ownerId !== p.id) return { ok: false, reason: 'You do not own this room.' };
    const stash = p.bank.stashTabs[0]?.items || [];
    const item = stash.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'That is not in your stash.' };

    const pending = buildJobs.filter(j => !j.applied && j.lotId === lotId && j.kind === 'PIECE' && j.piece);
    const preview: IRoomState = {
      ...room,
      pieces: [...room.pieces, ...pending.map(j => ({ id: j.id, ...j.piece!, builtBy: j.ownerCertUid, at: j.queuedAt }))]
    };
    const verdict = canPlaceItem(preview, item, x, y, rotated);
    if (!verdict.ok) return verdict;

    const at = Date.now();
    const placementId = `plc_${at.toString(36)}_${x}_${y}`;
    const signature = await signRecord({ kind: 'PLACE', lotId, itemId: item.id, defId: item.universalDefinitionId, x, y, rotated, at });

    removeFromStash([item.id]);
    set({
      rooms: {
        ...get().rooms,
        [lotId]: { ...room, placements: [...room.placements, { id: placementId, item, x, y, rotated, placedBy: p.id, at, signature }] }
      }
    });
    await Ledger.append('BUILD', { kind: 'PLACED', lotId, placementId, itemId: item.id, defId: item.universalDefinitionId, x, y });
    const { Provenance } = await import('../../logic/sovereignty/Provenance');
    await Provenance.record(item, 'TRANSFER', { via: 'PLACED', lotId, x, y });
    await saveHubState();
    return { ok: true };
  },

  /** Take a placed item back into the stash. Once: it exists in one place only. */
  reclaimItem: async (lotId, placementId) => {
    const { lots, rooms, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const room = rooms[lotId];
    const p = usePlayerStore.getState().player;
    if (!lot || !room || lot.ownerId !== p.id) return false;
    const placement = room.placements.find(pl => pl.id === placementId);
    if (!placement) return false;

    set({ rooms: { ...get().rooms, [lotId]: { ...room, placements: room.placements.filter(pl => pl.id !== placementId) } } });
    addToStash([placement.item]);
    await Ledger.append('BUILD', { kind: 'RECLAIMED', lotId, placementId, itemId: placement.item.id });
    const { Provenance } = await import('../../logic/sovereignty/Provenance');
    await Provenance.record(placement.item, 'TRANSFER', { via: 'RECLAIMED', lotId });
    await saveHubState();
    return true;
  },

  /** Queue a transformation at a WORKSHOP you own. Inputs leave the stash now. */
  queueCraft: async (lotId, recipeId) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const recipe = RECIPE_DEFINITIONS[recipeId];
    const p = usePlayerStore.getState().player;
    if (!lot || !recipe) return false;
    if (lot.ownerId !== p.id || lot.structureType !== recipe.requiredFacility) {
      console.log(`[CRAFT] ${recipe.name} needs your own ${recipe.requiredFacility}.`);
      return false;
    }

    // Inputs come from the main stash
    const stash = p.bank.stashTabs[0]?.items || [];
    if (!TransformationEngine.canProcess({ } as any, recipe, stash)) {
      console.log(`[CRAFT] Missing inputs for ${recipe.name}.`);
      return false;
    }
    const jobId = `job_${Date.now().toString(36)}_${lot.lotIndex}`;
    const { consumedIds } = TransformationEngine.processCycle(recipe, stash, Rng.fromKey(`${jobId}:consume`));

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.filter(i => !consumedIds.includes(i.id)) } : tab
      ) } }
    }));

    const job: ICraftJob = {
      id: jobId,
      lotId,
      recipeId,
      ownerCertUid: p.id,
      queuedAt: Date.now(),
      finishesAt: Date.now() + recipe.laborTimeSeconds * 1000,
      collected: false
    };
    set({ craftingJobs: [...get().craftingJobs, job] });
    await Ledger.append('CRAFT', { kind: 'QUEUED', jobId, recipeId, lotId, consumedIds });
    await saveHubState();
    console.log(`[CRAFT] ${recipe.name} queued (${recipe.laborTimeSeconds}s).`);
    return true;
  },

  /** Collect every finished job: outputs mint from the job's key into the stash. */
  resolveCrafts: async () => {
    const now = Date.now();
    const { craftingJobs, saveHubState } = get();
    const due = craftingJobs.filter(j => !j.collected && j.finishesAt <= now);
    if (due.length === 0) return 0;

    let minted = 0;
    for (const job of due) {
      const recipe = RECIPE_DEFINITIONS[job.recipeId];
      if (!recipe) continue;
      const outputs: IItem[] = [];
      recipe.outputs.forEach((out, oi) => {
        const def = CRAFTED_DEFINITIONS[out.itemId];
        if (!def) return;
        const rng = Rng.fromKey(`${job.id}:out:${oi}`);
        if (rng.next() <= out.probability) {
          for (let q = 0; q < out.quantity; q++) outputs.push(ItemFactory.createResourceItem(def, rng));
        }
      });
      usePlayerStore.setState(s => ({
        player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: [...tab.items, ...outputs] } : tab
        ) } }
      }));
      minted += outputs.length;
      await Ledger.append('CRAFT', { kind: 'COLLECTED', jobId: job.id, outputIds: outputs.map(o => o.id) });
      // Wave 6.2: crafted goods carry their maker's signature from birth
      const { Provenance } = await import('../../logic/sovereignty/Provenance');
      await Provenance.recordMany(outputs, 'MINT', { origin: 'CRAFT', jobId: job.id, recipeId: job.recipeId, lotId: job.lotId });
      console.log(`[CRAFT] Collected ${outputs.length}x from ${recipe.name}.`);
    }

    set({ craftingJobs: get().craftingJobs.map(j => due.some(d => d.id === j.id) ? { ...j, collected: true } : j) });
    await saveHubState();
    return minted;
  },

  /**
   * Sell a stash item to the system vendor at 60% of its value. The gold comes
   * from the hub treasury, so a hub with no funds cannot buy.
   */
  sellToVendor: async (itemId) => {
    const { activeHubId } = get();
    const p = usePlayerStore.getState().player;
    if (!activeHubId) return null;
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!item) return null;

    const offer = Math.max(1, Math.floor((item.value || 1) * 0.6));
    const treasuryGold = await Treasury.balance(activeHubId);
    if (treasuryGold < offer) {
      console.log(`[VENDOR] The hub treasury cannot cover ${offer}G. Nothing moves.`);
      return null;
    }

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: {
        ...s.player.bank,
        gold: s.player.bank.gold + offer,
        stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab
        )
      } }
    }));
    await Treasury.credit(activeHubId, -offer);
    await Ledger.append('GOLD_DELTA', { reason: 'VENDOR_BUYBACK', itemId, defId: item.universalDefinitionId, amount: offer, treasuryId: activeHubId, treasuryDelta: -offer });
    void PlayerPersistence.flush('vendor');
    console.log(`[VENDOR] Sold ${item.name} for ${offer}G (treasury-funded).`);
    return offer;
  },

  /** Put a stash item on your VENDOR lot's shelf. */
  listItemForSale: async (lotId, itemId, price) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || lot.ownerId !== p.id || lot.structureType !== 'VENDOR') {
      console.log('[SHOP] You need your own VENDOR lot to sell.');
      return false;
    }
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!item || price <= 0) return false;

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab
      ) } }
    }));
    set({ lots: get().lots.map(l => l.id === lotId
      ? { ...l, shopListings: [...(l.shopListings || []), { item, price }] }
      : l) });
    await Ledger.append('TRADE', { kind: 'LISTED', lotId, itemId, price, playerDelta: 0, treasuryDelta: 0 });
    await saveHubState();
    console.log(`[SHOP] Listed ${item.name} for ${price}G.`);
    return true;
  },

  /** Buy from a player's VENDOR lot. Seller gets price minus the hub's cut. */
  buyFromLot: async (lotId, itemId) => {
    const { lots, activeHubId, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const listing = lot?.shopListings?.find(li => li.item.id === itemId);
    const p = usePlayerStore.getState().player;
    if (!lot || !listing || !activeHubId) return false;
    if (p.bank.gold < listing.price) {
      console.log('[SHOP] Cannot afford that.');
      return false;
    }

    const fee = Math.max(1, Math.round(listing.price * PLAYER_SHOP_TAX));
    const net = listing.price - fee;
    const buyerIsOwner = lot.ownerId === p.id;
    // Local identity's total delta: buyer pays price; the owner (possibly the
    // same identity) receives the net. Either way the hub keeps its fee.
    const playerDelta = -listing.price + (buyerIsOwner ? net : 0);

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: {
        ...s.player.bank,
        gold: s.player.bank.gold + playerDelta,
        stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: [...tab.items, listing.item] } : tab
        )
      } }
    }));
    await Treasury.credit(activeHubId, fee);
    await Ledger.append('TRADE', { kind: 'SHOP_SALE', lotId, itemId, price: listing.price, fee, playerDelta, treasuryDelta: fee });
    // Wave 6.2: ownership change goes on the item's record
    const { Provenance } = await import('../../logic/sovereignty/Provenance');
    await Provenance.record(listing.item, 'TRANSFER', { via: 'PLAYER_SHOP', lotId, price: listing.price, fee });

    set({ lots: get().lots.map(l => l.id === lotId
      ? {
          ...l,
          shopListings: (l.shopListings || []).filter(li => li.item.id !== itemId),
          proceeds: (l.proceeds || 0) + (buyerIsOwner ? 0 : net)
        }
      : l) });
    await saveHubState();
    console.log(`[SHOP] Bought ${listing.item.name} for ${listing.price}G (hub kept ${fee}G).`);
    return true;
  },

  /** Move a lot's held sale money to its owner's bank. */
  collectProceeds: async (lotId) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    const amount = lot?.proceeds || 0;
    if (!lot || lot.ownerId !== p.id || amount <= 0) return 0;

    set({ lots: get().lots.map(l => l.id === lotId ? { ...l, proceeds: 0 } : l) });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + amount } } }));
    await Ledger.append('GOLD_DELTA', { reason: 'SHOP_PROCEEDS', lotId, amount });
    await saveHubState();
    return amount;
  },

  /** Charge upkeep per world-day on owned lots; unpaid lots revert to market. */
  resolveUpkeep: async (simDay) => {
    const day = simDay ?? worldDay();
    const { lots, activeHubId, saveHubState } = get();
    const p = usePlayerStore.getState().player;
    if (!activeHubId) return;
    let changed = false;

    for (const lot of lots) {
      if (!lot.ownerId) continue;
      const paidThrough = lot.upkeepPaidThroughDay ?? day;
      const owed = day - paidThrough;
      if (owed <= 0) continue;
      if (lot.ownerId === p.id) await get().collectProceeds(lot.id);
      changed = true;

      const rate = lot.structureType === 'EMPTY' ? 5 : STRUCTURE_COSTS[lot.structureType].upkeepPerDay;
      const cost = rate * owed;
      const isLocal = lot.ownerId === p.id;
      const canPay = isLocal && usePlayerStore.getState().player.bank.gold >= cost;

      if (canPay) {
        usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
        await Treasury.credit(activeHubId, cost);
        await Ledger.append('UPKEEP', { lotId: lot.id, days: owed, amount: cost, treasuryId: activeHubId });
        set({ lots: get().lots.map(l => l.id === lot.id ? { ...l, upkeepPaidThroughDay: day } : l) });
        console.log(`[UPKEEP] Lot ${lot.lotIndex}: paid ${cost}G for ${owed} day(s).`);
      } else {
        // Reverted: listings, lot inventory and everything placed in the room
        // return to the (local) owner. A placed item is never lost (Wave 10).
        const room = get().rooms[lot.id];
        if (isLocal) {
          const refund = [
            ...(lot.shopListings || []).map(li => li.item),
            ...lot.inventory,
            ...(room?.placements.map(pl => pl.item) ?? [])
          ];
          if (refund.length > 0) addToStash(refund);
        }
        await Ledger.append('TRADE', { kind: 'LOT_REVERTED', lotId: lot.id, daysUnpaid: owed, playerDelta: 0, treasuryDelta: 0 });
        const { [lot.id]: _gone, ...keptRooms } = get().rooms;
        set({
          lots: get().lots.map(l => l.id === lot.id
            ? { ...l, ownerId: null, ownerName: null, purchaseDate: null, structureType: 'EMPTY', shopListings: [], inventory: [], upkeepPaidThroughDay: undefined }
            : l),
          rooms: keptRooms,
          buildJobs: get().buildJobs.filter(j => j.lotId !== lot.id)
        });
        console.warn(`[UPKEEP] Lot ${lot.lotIndex} REVERTED to market (${owed} day(s) unpaid).`);
      }
    }
    if (changed) await saveHubState();
  },


  generateDailyStock: () => {
    // Procedural Shop Generation — keyed by hub + UTC day, so stock is the
    // same for every client of this hub today, and rolls over at midnight.
    const hubId = get().activeHubId || 'hub_unknown';
    const dayIndex = Math.floor(Date.now() / 86_400_000);

    const generateStock = (rank: UniversalRank, count: number, type: 'weapon' | 'armor' | 'tool', pinned: string[] = []) => {
      return Array.from({ length: count }, (_, i) => {
        const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:${type}:${rank}:${i}`);
        const item = ItemFactory.createItem(rank, true, rng, type, pinned[i]);
        return {
          id: `listing_${type}_${rank}_${i}`,
          item,
          price: item.value * 1.5, // 50% Markup
          vendorId: 'vendor_sys',
          stock: rng.int(1, 6)
        };
      });
    };

    set({
      weaponShop: [
        ...generateStock(UniversalRank.F, 5, 'weapon'),
        ...generateStock(UniversalRank.E, 2, 'weapon'),
        // Field tools ride in the weapon shop until lots get their own vendors (Wave 5)
        // The harvesting tools are always on the shelf, or a resource could be out of reach for a day
        ...generateStock(UniversalRank.F, 3, 'tool', ['tool_axe_field_t1', 'tool_pick_rusty_t1']),
        ...generateStock(UniversalRank.D, 1, 'tool', ['tool_pick_tempered_t3'])
      ],
      armorShop: [
        ...generateStock(UniversalRank.F, 5, 'armor'),
        ...generateStock(UniversalRank.E, 2, 'armor')
      ],
      consumableShop: ['res_berry_bush', 'res_fruit_amber'].map((defId, i) => {
        const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:consumable:${i}`);
        const item = ItemFactory.createResourceItem(RESOURCE_DEFINITIONS[defId], rng);
        return {
          id: `listing_consumable_${defId}`,
          item,
          price: Math.max(5, item.value * 3),
          vendorId: 'vendor_sys',
          stock: rng.int(3, 10)
        };
      })
    });
  },

  purchaseFromShop: (listingId, shop) => {
    const state = get();
    const shopKey = `${shop}Shop` as 'weaponShop' | 'armorShop' | 'consumableShop';
    const listings = state[shopKey];

    const listing = listings.find(l => l.id === listingId);
    if (!listing || listing.stock <= 0) return null;

    // Wave 2 (Wave 5 plumbing, early): gold actually moves, item actually lands
    const playerStore = usePlayerStore.getState();
    const price = Math.ceil(listing.price);
    if (playerStore.player.bank.gold < price) return null;

    const purchasedItem = { ...listing.item, id: crypto.randomUUID() };

    usePlayerStore.setState(s => ({
      player: {
        ...s.player,
        bank: {
          ...s.player.bank,
          gold: s.player.bank.gold - price,
          stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
            idx === 0 ? { ...tab, items: [...tab.items, purchasedItem] } : tab
          )
        }
      }
    }));
    // Wave 5.1: conservation — the system vendor's take belongs to the hub
    const hubId = get().activeHubId || 'hub_unknown';
    void Treasury.credit(hubId, price);
    void PlayerPersistence.flush('shop');
    void Ledger.append('GOLD_DELTA', { reason: 'SHOP_PURCHASE', itemId: purchasedItem.id, defId: purchasedItem.universalDefinitionId, amount: -price, treasuryId: hubId, treasuryDelta: price });

    const updatedListings = listings.map(l =>
      l.id === listingId ? { ...l, stock: l.stock - 1 } : l
    );

    set({ [shopKey]: updatedListings });
    return purchasedItem;
  }
}));
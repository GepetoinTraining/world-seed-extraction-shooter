/**
 * Hub Store - Manages persistent hub state
 * REFACTORED: Removes mock data, loads from Vector/DB State
 */

import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { create } from 'zustand';
import { IAffix, IComposition, IItem, ItemType, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { CRAFTED_GEAR_BASES } from '../item/data/itemDefinitions';
import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { HubGenerator } from './HubGenerator';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { usePlayerStore } from '../player/store';
import { Ledger } from '../../logic/ledger/Ledger';
import { Treasury } from '../../logic/economy/Treasury';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, GEAR_RECIPES, STRUCTURE_COSTS, PLAYER_SHOP_TAX } from '../economy/data/recipeDefinitions';
import { TransformationEngine } from '../economy/TransformationEngine';
import { PlayerPersistence } from '../../logic/persistence/PlayerPersistence';
import { CertificateSystem } from '../identity/certificateSystem';
import { useIdentityStore } from '../identity/store';
import {
  IRoomState, RoomPieceKind, RoomVerdict, emptyRoom, canBuildPiece, canPlaceItem, pickBill, salvageFor, answersTag,
  ownerHasBench, roomProcessBonus, shellBillFor,
  PIECE_BILLS, PIECE_BUILD_SECONDS, SHELL_BUILD_SECONDS, SHELL_STATION, TAG_DEFAULT_MATERIAL
} from './room';
import { ITemplate, ITemplateSheet, monoMaterialOf, setBonusFor, sizeNeedsVerdict, templateBill } from './template';
import { CompositionSystem } from '../../logic/economy/CompositionSystem';
import { MintRegistry } from '../../logic/economy/MintRegistry';
import { LoadoutSystem } from '../player/systems/LoadoutSystem';
import { genreForWorld } from '../../render/atoms/world';
import { InsuranceSystem } from '../../logic/systems/InsuranceSystem'; // Wave 10E (D21)
import { DreamingSystem } from '../world/Dreaming'; // Wave 10E: the shelf on the latest law
import { AffixBank } from '../../logic/content/AffixBank'; // Wave 10E (D20)
import { PROCESS_FAMILIES, ProcessSystem } from '../../logic/systems/ProcessSystem'; // The raw materials leg (D26)

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
  /** Wave 10D (additive): what the job consumed, composition and all, so the
   * outputs can carry the whole chain when they mint (resolveCrafts).
   * Wave 10E (additive): and the components' AFFIXES — they ride onto the
   * item they make (D6's crafting half). */
  consumed?: { defId: string; name: string; composition?: IComposition; affixes?: IAffix[] }[];
  /** Wave 10E (D6): the maker's own name — honored only at rank S and above. */
  customName?: string;
  /** The raw materials leg (D26): the bank this job was queued under. It draws
   * what the step adds from THAT pack, so a later batch cannot change what it
   * mints. A job queued before this law has none, and mints as it always would. */
  processPack?: number;
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
  piece?: { kind: RoomPieceKind; x: number; y: number; materialDefId: string; materialQuality?: number; inherited?: IAffix[] };
  ownerCertUid: string;
  queuedAt: number;
  finishesAt: number;
  applied: boolean;
  consumedIds: string[];
  consumedDefIds: string[];
  /** The raw materials leg (D26): what the shell's bill carried. The shell records
   * it and the station it mints inherits it. */
  inherited?: IAffix[];
  /** The owner's signature over the queued record: every completed step is signed. */
  signature?: string;
  /** Wave 10B: jobs raised together from one template share its item id. */
  batch?: string;
  /** Wave 10B: a template shell carries the plan, the sheet and the architect. */
  template?: {
    itemId: string;
    data: ITemplate;
    sheet: ITemplateSheet;
    /** D26: what each floor zone's material carried, by zone name. */
    zonesInherited?: Record<string, IAffix[]>;
  };
}

const dominantDefId = (defIds: string[]): string => {
  const counts = new Map<string, number>();
  for (const id of defIds) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'crf_plank';
};

/** What these consumed goods carried, each addition once. Nothing at all stays absent from the record. */
const inheritedOf = (items: IItem[]): IAffix[] | undefined => {
  const carried = ProcessSystem.inherit(items.flatMap(i => i.affixes ?? []));
  return carried.length > 0 ? carried : undefined;
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

// Wave 10D (D18): the bank's mint registry persists write-behind. Claims are
// never released; a debounced save keeps the doc close behind the memory.
let registrySaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRegistrySave(): void {
  if (registrySaveTimer) clearTimeout(registrySaveTimer);
  registrySaveTimer = setTimeout(() => {
    registrySaveTimer = null;
    void VectorStore.put({
      id: 'mint_registry_v1',
      namespace: VectorNamespace.ITEMS,
      data: { rows: MintRegistry.snapshot() },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
  }, 800);
}

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
  /** `material` is the builder's choice (D13): that material pays first. */
  buildStructure: (lotId: string, type: 'HOUSE' | 'WORKSHOP' | 'VENDOR', material?: string) => Promise<boolean>;
  /** D25: what this shell asks of this owner, right now. A first WORKSHOP asks no metal. */
  shellBillNow: (type: 'HOUSE' | 'WORKSHOP' | 'VENDOR') => { tag: string; count: number }[];
  // Wave 10: construction and placement
  resolveBuilds: () => Promise<number>;
  // Wave 10B: raise a house from a template, materials chosen per element class
  applyTemplate: (lotId: string, templateItemId: string, sheet: ITemplateSheet) => Promise<RoomVerdict>;
  queuePiece: (lotId: string, kind: RoomPieceKind, x: number, y: number, materialItemId: string) => Promise<RoomVerdict>;
  demolishPiece: (lotId: string, pieceId: string) => Promise<boolean>;
  placeItem: (lotId: string, itemId: string, x: number, y: number, rotated: boolean) => Promise<RoomVerdict>;
  reclaimItem: (lotId: string, placementId: string) => Promise<boolean>;
  queueCraft: (lotId: string, recipeId: string, customName?: string) => Promise<boolean>;
  /** Wave 10E (D6): may this making carry the maker's own name? Rank S+ only. */
  canNameCraft: (recipeId: string) => { ok: boolean; reason?: string };
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

      // Wave 10D (D18): wake the bank's registry before anything mints today.
      const regDoc = await VectorStore.get<{ rows: [string, string][] }>(VectorNamespace.ITEMS, 'mint_registry_v1');
      if (regDoc?.data?.rows) MintRegistry.hydrate(regDoc.data.rows);
      MintRegistry.onClaim = () => scheduleRegistrySave();

      // Wave 10E (D20): the current content pack is validated, signed and
      // banked into the CONTENT namespace. A broken batch would refuse whole here.
      const signer = useIdentityStore.getState().certificate?.metadata.uid ?? 'SYSTEM';
      void AffixBank.bankAndSign(signer);

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
  shellBillNow: (type) => {
    const { lots, rooms, buildJobs } = get();
    const p = usePlayerStore.getState().player;
    return shellBillFor(type, ownerHasBench(p.id, { lots, rooms, jobs: buildJobs, stash: p.bank.stashTabs[0]?.items || [] }));
  },

  buildStructure: async (lotId, type, material) => {
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
    const bill = pickBill(get().shellBillNow(type), stash, material);
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
      consumedDefIds: bill.items.map(i => i.universalDefinitionId),
      inherited: inheritedOf(bill.items)
    };
    job.signature = await signRecord({ kind: 'SHELL', lotId, structureType: type, consumedIds: job.consumedIds, at: job.queuedAt });

    set({ buildJobs: [...get().buildJobs, job] });
    await Ledger.append('GOLD_DELTA', { reason: 'BUILD_PERMIT', lotId, structure: type, amount: -cost, treasuryId: activeHubId, treasuryDelta: cost });
    await Ledger.append('BUILD', { kind: 'SHELL_QUEUED', jobId: job.id, lotId, structure: type, consumedIds: job.consumedIds });
    await saveHubState();
    console.log(`[BUILD] ${type} under construction on lot ${lot.lotIndex} (${SHELL_BUILD_SECONDS[type]}s).`);
    return true;
  },

  /**
   * Wave 10B.4: APPLY — raise a house from a template on a lot you own. Size
   * needs refuse with the numbers (line 43); the material sheet is one choice
   * per element class (D13), billed by tag and consumed exactly once; the lot
   * goes UNDER CONSTRUCTION, shell first, then the pieces in order on the
   * clock. The drawing itself is never consumed (D14).
   */
  applyTemplate: async (lotId, templateItemId, sheet) => {
    const { lots, activeHubId, buildJobs, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || !activeHubId) return { ok: false, reason: 'There is no lot here.' };
    if (lot.ownerId !== p.id) return { ok: false, reason: 'You do not own this lot.' };
    if (lot.structureType !== 'EMPTY') return { ok: false, reason: 'The lot already carries a building. Plans are raised on empty ground.' };
    if (buildJobs.some(j => j.lotId === lotId && !j.applied)) {
      return { ok: false, reason: 'Construction is already underway on this lot.' };
    }

    const stash = p.bank.stashTabs[0]?.items || [];
    const tplItem = stash.find(i => i.id === templateItemId) as (IItem & { templateData?: ITemplate }) | undefined;
    const tpl = tplItem?.templateData;
    if (!tpl) return { ok: false, reason: 'That plan is not in your stash.' };

    // Line 43: the size needs, with the numbers.
    const layout = HubGenerator.generate();
    const poi = HubGenerator.findPOI(layout, lotId);
    const lotFootprint = poi ? { width: poi.size.width, height: poi.size.height } : { width: 4, height: 4 };
    const sized = sizeNeedsVerdict(tpl, lotFootprint);
    if (!sized.ok) return sized;

    // D13: one material per element class, each carrying the class's tag.
    const firstBench = tpl.structureType === 'WORKSHOP' &&
      !ownerHasBench(p.id, { lots, rooms: get().rooms, jobs: buildJobs, stash });
    const bill = templateBill(tpl, sheet, firstBench);
    const defName = (defId: string) => (CRAFTED_DEFINITIONS[defId] ?? RESOURCE_DEFINITIONS[defId])?.name ?? defId;
    const picked: IItem[] = [];
    const taken = new Set<string>();
    // D26: each class remembers its own items, so each thing built inherits what paid for it
    const byClass: Record<string, IItem[]> = {};
    for (const line of bill.choices) {
      const candidates = stash.filter(i => i.universalDefinitionId === line.defId && !taken.has(i.id) && i.id !== templateItemId);
      if (candidates[0] && !answersTag(candidates[0], line.tag)) {
        return { ok: false, reason: `${line.cls} ask for something ${line.tag}; ${defName(line.defId)} is not.` };
      }
      if (candidates.length < line.count) {
        return { ok: false, reason: `The bill is short: ${line.count - candidates.length} more ${defName(line.defId)} for ${line.cls}.` };
      }
      byClass[line.cls] = candidates.slice(0, line.count);
      for (let i = 0; i < line.count; i++) { picked.push(candidates[i]); taken.add(candidates[i].id); }
    }
    for (const line of bill.tagLines) {
      const rest = stash.filter(i => !taken.has(i.id) && i.id !== templateItemId);
      const got = pickBill([line], rest);
      if (!got.ok) return { ok: false, reason: `The bill is short: ${got.missing}.` };
      for (const item of got.items) { picked.push(item); taken.add(item.id); }
    }

    const cost = STRUCTURE_COSTS[tpl.structureType].build;
    if (p.bank.gold < cost) {
      return { ok: false, reason: `The ${tpl.structureType} permit costs ${cost}G; you have ${p.bank.gold}G.` };
    }

    // Everything checked: pay once, consume once, queue the whole batch.
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
    removeFromStash(picked.map(i => i.id));
    await Treasury.credit(activeHubId, cost);

    const now = Date.now();
    const jobs: IBuildJob[] = [];
    const shellIds = picked.filter(i => i.universalDefinitionId === sheet.WALL || bill.tagLines.some(l => answersTag(i, l.tag))).map(i => i.id);
    // The walls' bill pays the shell first, then each inner wall in the plan's order.
    const shellWalls = bill.choices.find(c => c.cls === 'WALLS')!.count - tpl.pieces.filter(pc => pc.kind === 'WALL').length;
    const wallItems = [...(byClass['WALLS'] ?? [])];
    const shellItems = wallItems.splice(0, shellWalls);
    const doorItems = [...(byClass['DOORS'] ?? [])];
    const windowItems = [...(byClass['WINDOWS'] ?? [])];
    const zonesInherited: Record<string, IAffix[]> = {};
    for (const zone of tpl.zones) {
      const carried = inheritedOf(byClass[`FLOOR: ${zone.name}`] ?? []);
      if (carried) zonesInherited[zone.name] = carried;
    }
    const shellFinish = now + SHELL_BUILD_SECONDS[tpl.structureType] * 1000;
    const shellJob: IBuildJob = {
      id: `bld_${now.toString(36)}_tpl_${lot.lotIndex}`,
      lotId,
      kind: 'SHELL',
      structureType: tpl.structureType,
      ownerCertUid: p.id,
      queuedAt: now,
      finishesAt: shellFinish,
      applied: false,
      consumedIds: shellIds,
      consumedDefIds: [sheet.WALL],
      batch: templateItemId,
      inherited: inheritedOf(shellItems),
      template: { itemId: templateItemId, data: tpl, sheet, ...(Object.keys(zonesInherited).length > 0 ? { zonesInherited } : {}) }
    };
    shellJob.signature = await signRecord({ kind: 'TEMPLATE_SHELL', lotId, template: tpl.name, authorUid: tpl.authorUid, sheet, consumedIds: shellIds, at: now });
    jobs.push(shellJob);

    // The pieces rise in the plan's own order, each on its own clock after the last.
    let finish = shellFinish;
    tpl.pieces.forEach((piece, i) => {
      finish += PIECE_BUILD_SECONDS[piece.kind] * 1000;
      const materialDefId = piece.kind === 'WINDOW' ? sheet.WINDOW : piece.kind === 'DOOR' ? sheet.DOOR : sheet.WALL;
      const paid = (piece.kind === 'WINDOW' ? windowItems : piece.kind === 'DOOR' ? doorItems : wallItems).shift();
      const inherited = paid ? inheritedOf([paid]) : undefined;
      jobs.push({
        id: `bld_${now.toString(36)}_tpl_${lot.lotIndex}_${i}`,
        lotId,
        kind: 'PIECE',
        piece: { kind: piece.kind, x: piece.x, y: piece.y, materialDefId, ...(inherited ? { inherited } : {}) },
        ownerCertUid: p.id,
        queuedAt: now,
        finishesAt: finish,
        applied: false,
        consumedIds: [],
        consumedDefIds: [materialDefId],
        batch: templateItemId
      });
    });
    for (const job of jobs.slice(1)) {
      job.signature = await signRecord({ kind: 'TEMPLATE_PIECE', lotId, piece: job.piece, at: now });
    }

    set({ buildJobs: [...get().buildJobs, ...jobs] });
    await Ledger.append('GOLD_DELTA', { reason: 'BUILD_PERMIT', lotId, structure: tpl.structureType, template: tpl.name, amount: -cost, treasuryId: activeHubId, treasuryDelta: cost });
    await Ledger.append('BUILD', {
      kind: 'TEMPLATE_APPLIED', lotId, templateItemId, template: tpl.name, authorUid: tpl.authorUid,
      sheet, consumedIds: picked.map(i => i.id), jobs: jobs.length
    });
    await saveHubState();
    console.log(`[BUILD] ${tpl.name} rising on lot ${lot.lotIndex}: ${jobs.length} steps on the clock.`);
    return { ok: true };
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
        let room: IRoomState;
        if (job.template) {
          // Wave 10B: the shell stands at the PLAN's footprint, in the sheet's
          // wall material, with its floor zones laid and its architect on record.
          const tpl = job.template.data;
          room = emptyRoom(job.lotId, tpl.footprint, job.template.sheet.WALL);
          if (tpl.zones.length > 0) {
            room.floorZones = tpl.zones.map(z => ({
              name: z.name,
              tiles: z.tiles.map(t => ({ ...t })),
              materialDefId: job.template!.sheet.zones[z.name] ?? TAG_DEFAULT_MATERIAL.building,
              ...(job.template!.zonesInherited?.[z.name] ? { inherited: job.template!.zonesInherited[z.name] } : {})
            }));
          }
          room.template = { itemId: job.template.itemId, name: tpl.name, authorUid: tpl.authorUid, authorName: tpl.authorName };
        } else {
          const poi = HubGenerator.findPOI(layout, job.lotId);
          const footprint = poi ? { width: poi.size.width, height: poi.size.height } : { width: 4, height: 4 };
          room = emptyRoom(job.lotId, footprint, dominantDefId(job.consumedDefIds));
        }
        if (job.inherited?.length) room.shellInherited = job.inherited;
        set({
          lots: get().lots.map(l => l.id === job.lotId ? { ...l, structureType: job.structureType!, upkeepPaidThroughDay: worldDay() } : l),
          rooms: { ...get().rooms, [job.lotId]: room }
        });
        // The structure brings its station: an item like any other, into the stash.
        const stationDefId = SHELL_STATION[job.structureType];
        if (stationDefId) {
          // D26: a station inherits its shell. Raw walls hand on nothing: nothing was worked.
          const station = ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[stationDefId] as any, Rng.fromKey(`${job.id}:station`), { origin: 'CONSTRUCTION', affixes: ProcessSystem.inherit(job.inherited ?? []) });
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
                  materialQuality: job.piece.materialQuality,
                  ...(job.piece.inherited?.length ? { inherited: job.piece.inherited } : {}),
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
    if (!answersTag(material, bill.tag)) {
      return { ok: false, reason: `A ${kind.toLowerCase()} asks for something ${bill.tag}; ${material.name} is not.` };
    }
    const picked = pickBill([bill], [material, ...stash.filter(i => i.id !== material.id && i.universalDefinitionId === material.universalDefinitionId)]);
    if (!picked.ok) return { ok: false, reason: `A ${kind.toLowerCase()} takes ${bill.count}x ${bill.tag}; you hold less.` };

    removeFromStash(picked.items.map(i => i.id));
    const inherited = inheritedOf(picked.items);
    const job: IBuildJob = {
      id: `bld_${Date.now().toString(36)}_${x}_${y}`,
      lotId,
      kind: 'PIECE',
      piece: {
        kind, x, y, materialDefId: material.universalDefinitionId,
        // Wave 10D: the material's quality rides the piece, so salvage knows
        // how far the bite has already gone.
        materialQuality: Math.abs(material.quality) <= 1 ? material.quality : 0,
        // The raw materials leg (D26): what the material carried stays in the wall.
        ...(inherited ? { inherited } : {})
      },
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

  /** Take a piece down. Wave 10D.5 — THE SALVAGE LAW, decided and enacted: the
   * whole bill comes back as real items of the material that paid it, but every
   * demolition bites the quality by 0.10, floored at −0.20. Build-and-tear
   * grinds the material toward Crude; the permit and the shell never return. */
  demolishPiece: async (lotId, pieceId) => {
    const { lots, rooms, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const room = rooms[lotId];
    const p = usePlayerStore.getState().player;
    if (!lot || !room || lot.ownerId !== p.id) return false;
    const piece = room.pieces.find(pc => pc.id === pieceId);
    if (!piece) return false;
    set({ rooms: { ...get().rooms, [lotId]: { ...room, pieces: room.pieces.filter(pc => pc.id !== pieceId) } } });

    const salvage = salvageFor(piece);
    const def = (CRAFTED_DEFINITIONS[salvage.defId] ?? RESOURCE_DEFINITIONS[salvage.defId]) as any;
    const salvaged: IItem[] = def
      ? Array.from({ length: salvage.count }, (_, i) =>
          ItemFactory.createResourceItem(def, Rng.fromKey(`${lotId}:${pieceId}:salvage:${i}`), { origin: 'SALVAGE', quality: salvage.quality, affixes: ProcessSystem.inherit(piece.inherited ?? []) }))
      : [];
    if (salvaged.length > 0) {
      addToStash(salvaged);
      const { Provenance } = await import('../../logic/sovereignty/Provenance');
      await Provenance.recordMany(salvaged, 'MINT', { origin: 'SALVAGE', lotId, pieceId, quality: salvage.quality });
    }
    await Ledger.append('BUILD', {
      kind: 'SALVAGED', lotId, pieceId, piece: { kind: piece.kind, x: piece.x, y: piece.y },
      defId: salvage.defId, count: salvaged.length, quality: salvage.quality
    });
    await saveHubState();
    console.log(`[BUILD] Took down the ${piece.kind.toLowerCase()}; ${salvaged.length}x ${def?.name ?? salvage.defId} salvaged at ${Math.round(salvage.quality * 100)}%.`);
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

  /** Queue a transformation at a WORKSHOP you own. Inputs leave the stash now.
   * Wave 10D: gear recipes (GEAR_RECIPES) queue the same way; the job keeps the
   * consumed items' compositions so the outputs carry the whole chain; and a
   * mono-material workshop runs faster by its set bonus (D13's numbers). */
  // Wave 10E (D6): the bank lends its pen only to a rank S+ making.
  canNameCraft: (recipeId) => {
    const gearRecipe = GEAR_RECIPES[recipeId];
    if (!gearRecipe) return { ok: false, reason: 'Only gear carries a name. This making mints goods.' };
    const base = CRAFTED_GEAR_BASES.find(b => b.id === gearRecipe.outputBase);
    if (!base) return { ok: false, reason: 'The pattern names no base.' };
    if (!ItemFactory.canCarryMakersName(base.rank)) {
      return { ok: false, reason: `The bank lends its pen at rank S. ${base.universal_name} is a ${base.rank}-rank making.` };
    }
    return { ok: true };
  },

  queueCraft: async (lotId, recipeId, customName) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const recipe = RECIPE_DEFINITIONS[recipeId];
    const gearRecipe = GEAR_RECIPES[recipeId];
    const p = usePlayerStore.getState().player;
    if (!lot || (!recipe && !gearRecipe)) return false;
    // Wave 10E (D6): a name below rank S refuses the whole queue, in voice
    if (customName?.trim()) {
      const mayName = get().canNameCraft(recipeId);
      if (!mayName.ok) {
        console.log(`[CRAFT] ${mayName.reason}`);
        return false;
      }
    }
    const facility = recipe?.requiredFacility ?? gearRecipe!.requiredFacility;
    const name = recipe?.name ?? gearRecipe!.name;
    const laborSeconds = recipe?.laborTimeSeconds ?? gearRecipe!.laborTimeSeconds;
    if (lot.ownerId !== p.id || lot.structureType !== facility) {
      console.log(`[CRAFT] ${name} needs your own ${facility}.`);
      return false;
    }

    // Inputs come from the main stash
    const stash = p.bank.stashTabs[0]?.items || [];
    // Wave 10D fix (found by the bars): two crafts queued in the same
    // millisecond on one lot used to share a job id — and their outputs then
    // minted with IDENTICAL item ids. The queue's length breaks the tie.
    const jobId = `job_${Date.now().toString(36)}_${lot.lotIndex}_${get().craftingJobs.length}`;
    let consumedIds: string[];
    if (recipe) {
      if (!TransformationEngine.canProcess({ } as any, recipe, stash)) {
        console.log(`[CRAFT] Missing inputs for ${recipe.name}.`);
        return false;
      }
      consumedIds = TransformationEngine.processCycle(recipe, stash, Rng.fromKey(`${jobId}:consume`)).consumedIds;
    } else {
      const picked: IItem[] = [];
      const taken = new Set<string>();
      for (const req of gearRecipe!.inputs) {
        let need = req.quantity;
        for (const item of stash) {
          if (need <= 0) break;
          if (item.universalDefinitionId === req.itemId && !taken.has(item.id)) { picked.push(item); taken.add(item.id); need--; }
        }
        if (need > 0) {
          console.log(`[CRAFT] Missing inputs for ${gearRecipe!.name}.`);
          return false;
        }
      }
      consumedIds = picked.map(i => i.id);
    }

    // Wave 10D: the chain rides the job — what was consumed, composition and all.
    // Wave 10E: and the components' affixes, which ride onto what they make (D6).
    const consumed = stash.filter(i => consumedIds.includes(i.id))
      .map(i => ({ defId: i.universalDefinitionId, name: i.name, composition: i.composition, affixes: i.affixes?.length ? i.affixes.map(a => ({ ...a, stats: { ...a.stats } })) : undefined }));

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.filter(i => !consumedIds.includes(i.id)) } : tab
      ) } }
    }));

    // D13's numbers: a mono-material workshop runs faster. The composition still
    // records the recipe's own labor — the bench is a convenience, not a chain fact.
    const room = get().rooms[lotId];
    const mono = room ? monoMaterialOf(room) : null;
    // D26: and what is worked into the room and its furniture acts here, studied or not.
    const speedPct = ((mono ? setBonusFor(mono)?.craftSpeedPct : 0) || 0) + (room ? roomProcessBonus(room).craftSpeedPct : 0);
    const effectiveSeconds = Math.max(1, Math.round(laborSeconds * (1 - speedPct / 100)));

    const job: ICraftJob = {
      id: jobId,
      lotId,
      recipeId,
      ownerCertUid: p.id,
      queuedAt: Date.now(),
      finishesAt: Date.now() + effectiveSeconds * 1000,
      collected: false,
      consumed,
      processPack: AffixBank.version(),
      ...(customName?.trim() ? { customName: customName.trim() } : {})
    };
    set({ craftingJobs: [...get().craftingJobs, job] });
    await Ledger.append('CRAFT', { kind: 'QUEUED', jobId, recipeId, lotId, consumedIds });
    await saveHubState();
    console.log(`[CRAFT] ${name} queued (${effectiveSeconds}s${speedPct ? `, ${speedPct}% faster: one material` : ''}).`);
    return true;
  },

  /** Collect every finished job: outputs mint from the job's key into the stash.
   * Wave 10D: every output carries its composition — the inputs' chains folded
   * in plus this step — and its value derives from that chain (10D.4). Gear
   * recipes mint through createComposedItem: the chain is the power budget. */
  resolveCrafts: async () => {
    const now = Date.now();
    const { craftingJobs, saveHubState } = get();
    const due = craftingJobs.filter(j => !j.collected && j.finishesAt <= now);
    if (due.length === 0) return 0;

    let minted = 0;
    for (const job of due) {
      const recipe = RECIPE_DEFINITIONS[job.recipeId];
      const gearRecipe = GEAR_RECIPES[job.recipeId];
      if (!recipe && !gearRecipe) continue;

      // The chain: what the job consumed (older jobs without the snapshot fall
      // back to the recipe's nominal inputs as raw roots — honest and replayable).
      const nominalInputs = recipe
        ? recipe.inputs.flatMap(req => Array.from({ length: req.quantity }, () => req.itemId))
        : gearRecipe!.inputs.flatMap(req => Array.from({ length: req.quantity }, () => req.itemId));
      const inputComps: IComposition[] = job.consumed
        ? job.consumed.map(c => c.composition ?? CompositionSystem.root({ id: c.defId, name: c.name }, 'HARVEST'))
        : nominalInputs.map(defId => CompositionSystem.root(
            { id: defId, name: (CRAFTED_DEFINITIONS[defId] ?? RESOURCE_DEFINITIONS[defId])?.name ?? defId }, 'HARVEST'));

      // The raw materials leg (D26): what this step adds. A job from before the law
      // draws nothing, and an improvised making never reaches this door.
      const family = ProcessSystem.familyOfRecipe(job.recipeId);
      const pack = job.processPack ? AffixBank.packAt(job.processPack) : null;
      const consumedAffixes = (job.consumed ?? []).flatMap(c => c.affixes ?? []);
      const consumedGoods = (job.consumed ?? []).map(c => CRAFTED_DEFINITIONS[c.defId] ?? RESOURCE_DEFINITIONS[c.defId] ?? {});
      const stepAffixes = (outDef: { rank?: UniversalRank; rarity?: any }, key: string): IAffix[] =>
        family && pack
          ? ProcessSystem.stepAffixes(pack, family, ProcessSystem.openTierOf([outDef, ...consumedGoods]), consumedAffixes, Rng.fromKey(`${job.id}:process:${key}`))
          : [];

      const outputs: IItem[] = [];
      if (recipe) {
        const nominalYield = recipe.outputs.reduce((n, o) => n + o.quantity, 0);
        const composition = CompositionSystem.compose(
          { recipeId: recipe.id, name: recipe.name, laborSeconds: recipe.laborTimeSeconds, facility: recipe.requiredFacility },
          inputComps, nominalYield);
        recipe.outputs.forEach((out, oi) => {
          const def = CRAFTED_DEFINITIONS[out.itemId];
          if (!def) return;
          const rng = Rng.fromKey(`${job.id}:out:${oi}`);
          if (rng.next() <= out.probability) {
            for (let q = 0; q < out.quantity; q++) {
              const item = ItemFactory.createResourceItem(def, rng, { affixes: stepAffixes(def, `${oi}:${q}`) });
              item.composition = composition;
              item.value = CompositionSystem.priceOf(composition);
              outputs.push(item);
            }
          }
        });
      } else {
        const composition = CompositionSystem.compose(
          { recipeId: gearRecipe!.id, name: gearRecipe!.name, laborSeconds: gearRecipe!.laborTimeSeconds, facility: gearRecipe!.requiredFacility },
          inputComps, 1);
        // Wave 10E (D6): the components' affixes ride onto the item they make,
        // and a rank S+ making takes the maker's own name.
        const base = CRAFTED_GEAR_BASES.find(b => b.id === gearRecipe!.outputBase);
        const drawn = stepAffixes({ rank: base?.rank }, 'gear');
        const item = ItemFactory.createComposedItem(gearRecipe!.outputBase, composition, Rng.fromKey(`${job.id}:gear`), {
          inheritedAffixes: drawn.length > 0 ? drawn : consumedAffixes,
          customName: job.customName
        });
        if (item) outputs.push(item);
      }

      usePlayerStore.setState(s => ({
        player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: [...tab.items, ...outputs] } : tab
        ) } }
      }));
      minted += outputs.length;
      // D6, D26: the doing teaches. Practice grows the trade's own skill, and hands
      // that have done the work come to know what it leaves.
      if (family && outputs.length > 0) usePlayerStore.getState().practiceTrade(family);
      await Ledger.append('CRAFT', { kind: 'COLLECTED', jobId: job.id, outputIds: outputs.map(o => o.id) });
      // Wave 6.2: crafted goods carry their maker's signature from birth —
      // Wave 10D: and the signed record carries the composition's own hash.
      const { Provenance } = await import('../../logic/sovereignty/Provenance');
      await Provenance.recordMany(outputs, 'MINT', {
        origin: 'CRAFT', jobId: job.id, recipeId: job.recipeId, lotId: job.lotId,
        compositionHash: outputs[0]?.composition ? CompositionSystem.compositionHash(outputs[0].composition) : undefined
      });
      console.log(`[CRAFT] Collected ${outputs.length}x from ${(recipe ?? gearRecipe)!.name}.`);
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

      let rate = lot.structureType === 'EMPTY' ? 5 : STRUCTURE_COSTS[lot.structureType].upkeepPerDay;
      // Wave 10D (D13's numbers): a mono-material house stands cheaper.
      const lotRoom = get().rooms[lot.id];
      const mono = lotRoom ? monoMaterialOf(lotRoom) : null;
      // D26: and what is worked into the walls and the furniture acts here, studied or not.
      const discount = ((mono ? setBonusFor(mono)?.upkeepDiscountPct : 0) || 0) + (lotRoom ? roomProcessBonus(lotRoom).upkeepDiscountPct : 0);
      if (discount !== 0) rate = Math.max(1, Math.round(rate * (1 - discount / 100)));
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

    // Wave 10C fix: `batch` keeps listing ids unique when the same type+rank
    // appears twice on one shelf (two rows sharing an id bought the wrong one)
    // Wave 10E: the hub's shelf stands on the bank's LATEST law — the purged
    // legacy pool plus the current pack's GLOBAL and CART entries. Worlds stay
    // pinned; the shelf grows with the bank, day by day.
    const shelfPool = DreamingSystem.hubShelfPool();
    const generateStock = (rank: UniversalRank, count: number, type: 'weapon' | 'armor' | 'tool', pinned: string[] = [], batch = '') => {
      return Array.from({ length: count }, (_, i) => {
        const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:${type}:${rank}:${batch}:${i}`);
        const item = ItemFactory.createItem(rank, true, rng, type, pinned[i], shelfPool);
        return {
          id: `listing_${type}_${rank}${batch ? `_${batch}` : ''}_${i}`,
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
        ...generateStock(UniversalRank.D, 1, 'tool', ['tool_pick_tempered_t3']),
        // Wave 10C (D16/D17): the carrier's shelf — the cart and the pouches
        ...generateStock(UniversalRank.F, 3, 'tool', ['cart_field_t1', 'pouch_vial_t1', 'pouch_scroll_t1'], 'carrier')
      ],
      armorShop: [
        ...generateStock(UniversalRank.F, 5, 'armor'),
        ...generateStock(UniversalRank.E, 2, 'armor'),
        // Wave 10C: the slot tree gets its wardrobe — one of each new branch,
        // always on the shelf, and the SHOULDER piece themed to this hub's genre
        ...generateStock(UniversalRank.F, 9, 'armor', [
          'arm_legs_padded_t1', 'arm_shoulder_t1', 'eye_glasses_t1', 'acc_necklace_t1',
          'acc_earring_t1', 'acc_ring_signet_t1', 'quiver_hide_t1', 'bag_satchel_t1', 'belt_canvas_t1'
        ], 'tree').map(l => l.item.universalDefinitionId === 'arm_shoulder_t1'
          ? { ...l, item: { ...l.item, name: l.item.name.replace('Mantle', LoadoutSystem.themedShoulderName(genreForWorld(hubId).name)) } }
          : l)
      ],
      // Wave 10B: the gallpod joins the shelf — the alchemist sells the ink's bitter half.
      consumableShop: [
        ...['res_berry_bush', 'res_fruit_amber', 'res_fruit_gallpod'].map((defId, i) => {
          const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:consumable:${i}`);
          const item = ItemFactory.createResourceItem(RESOURCE_DEFINITIONS[defId], rng);
          return {
            id: `listing_consumable_${defId}`,
            item,
            price: Math.max(5, item.value * 3),
            vendorId: 'vendor_sys',
            stock: rng.int(3, 10)
          };
        }),
        // The raw materials leg (D26): lore reveals. Two trades' notes on the shelf,
        // which two keyed by the day, so a note is worth coming back for.
        ...[...PROCESS_FAMILIES]
          .sort((a, b) => Rng.fromKey(`${hubId}:shop:${dayIndex}:note_order:${a}`).next() - Rng.fromKey(`${hubId}:shop:${dayIndex}:note_order:${b}`).next())
          .slice(0, 2)
          .map(family => {
            const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:trade_note:${family}`);
            const item = ProcessSystem.tradeNote(family, rng);
            return {
              id: `listing_note_${family}`,
              item,
              price: item.value,
              vendorId: 'vendor_sys',
              stock: rng.int(1, 3)
            };
          }),
        // Wave 10E (D21): insurance on the shelf — the charms; scrolls are also
        // WRITTEN at any scribe's table for paper and ink (D14's hook, kept).
        ...['chm_clasp', 'chm_knot'].map((defId, i) => {
          const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:charm:${i}`);
          const item = InsuranceSystem.mintCharm(defId, rng);
          return {
            id: `listing_charm_${defId}`,
            item,
            price: item.value,
            vendorId: 'vendor_sys',
            stock: rng.int(1, 4)
          };
        }),
        (() => {
          const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:scroll:0`);
          const item = InsuranceSystem.mintScrollItem('scr_keeping', rng);
          return {
            id: 'listing_scroll_scr_keeping',
            item,
            price: item.value,
            vendorId: 'vendor_sys',
            stock: rng.int(1, 3)
          };
        })()
      ]
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

    // Wave 10D: each unit sold is its OWN mint, deterministically keyed by the
    // listing and its remaining stock (the old crypto.randomUUID was a
    // determinism leak), with PURCHASE on its record. Rolled gear goes through
    // the bank's registry (D18): the shelf shows the pattern; every unit stands
    // on its own rung, the display item keeping the first claim.
    const unitRng = Rng.fromKey(`purchase:${get().activeHubId || 'hub_unknown'}:${listingId}:unit:${listing.stock}`);
    const unit: IItem = {
      ...listing.item,
      id: `itm_${unitRng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${unitRng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      composition: CompositionSystem.root({ id: listing.item.universalDefinitionId, name: listing.item.name }, 'PURCHASE')
    };
    const purchasedItem = unit.type === ItemType.GEAR ? MintRegistry.claim(unit) : unit;

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
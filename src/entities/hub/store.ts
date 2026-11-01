/**
 * Hub Store - Manages persistent hub state
 * REFACTORED: Removes mock data, loads from Vector/DB State
 */

import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { create } from 'zustand';
import { IAffix, IComposition, IHubWeb, IItem, ISkillState, IWebRecipe, IWebStation, ItemType, Rarity, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { CRAFTED_GEAR_BASES } from '../item/data/itemDefinitions';
import { VectorStore, VectorNamespace, IVectorDocument } from '../data/VectorStore';
import { HubGenerator, HUB_NPCS, IHubLayout, IPOI } from './HubGenerator';
import { HubSide, IDismemberment, IRaisedChunk, chunkBillFor, dismemberPlan, firstPlan, raiseChunk } from './hubManifest';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { usePlayerStore } from '../player/store';
import { Ledger } from '../../logic/ledger/Ledger';
import { Treasury } from '../../logic/economy/Treasury';
import { GoldCommit } from '../../logic/economy/GoldCommit';
import { StoreUnit } from '../data/StoreUnit';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, GEAR_RECIPES, STRUCTURE_COSTS, PLAYER_SHOP_TAX } from '../economy/data/recipeDefinitions';
import { TransformationEngine } from '../economy/TransformationEngine';
import { PlayerPersistence } from '../../logic/persistence/PlayerPersistence';
import { CertificateSystem } from '../identity/certificateSystem';
import { useIdentityStore } from '../identity/store';
import {
  IRoomState, RoomPieceKind, RoomVerdict, emptyRoom, canBuildPiece, canPlaceItem, pickBill, salvageFor, answersTag,
  ownerHasBench, roomProcessBonus, shellBillFor,
  PIECE_BILLS, PIECE_BUILD_SECONDS, SHELL_BUILD_SECONDS, SHELL_STATION, tagDefaultMaterial
} from './room';
import { ITemplate, ITemplateSheet, defaultSheet, monoMaterialOf, setBonusFor, sizeNeedsVerdict, templateBill } from './template';
import { CompositionSystem } from '../../logic/economy/CompositionSystem';
import { MintRegistry } from '../../logic/economy/MintRegistry';
import { LoadoutSystem } from '../player/systems/LoadoutSystem';
import { SHELF } from '../../logic/theme/shelf';
import { RestDoor } from '../../logic/systems/RestDoor';
import { HubUnlock } from '../../logic/systems/HubUnlock';
import { InsuranceSystem } from '../../logic/systems/InsuranceSystem'; // Wave 10E (D21)
import { DreamingSystem } from '../world/Dreaming'; // Wave 10E: the shelf on the latest law
import { AffixBank } from '../../logic/content/AffixBank'; // Wave 10E (D20)
import { PROCESS_FAMILIES, PROCESS_SKILL_XP_PER_JOB, ProcessSystem } from '../../logic/systems/ProcessSystem'; // The raw materials leg (D26)
import { WebBank } from '../../logic/content/WebBank'; // D27
import { WebSystem, rankIndexOf } from '../../logic/systems/WebSystem'; // D27: the technology web
import { StatSystem } from '../../logic/systems/StatSystem';
import { useFeed, useRankMoment } from '../../components/ui/stores';
import { NpcSheet } from '../../logic/systems/NpcSheet';
import { ProgressionSystem } from '../player/systems/ProgressionSystem';
import {
  GUILD_OWNER_ID, IGuildState, IResident, benchFactor, bondItemOf, emptyGuild, guildFrom, guildHouseCost, houseBill, houseTemplateFor, houseTemplateNamed,
  questPay, readSheet, residentIdOf, residentUpkeepPerDay, trialFor, trialTakes, wantFor, wantMayTake
} from './guild';
import { EMPTY_LOT_PER_DAY, IRunningBook, PRINT_DAYS, foldDays, npcRank, printAmount, printsNeeded, runningBook, runningPerDay, walletBrought } from './money';
import { Wallets } from '../../logic/economy/Wallets';
import { Anchors } from '../../logic/economy/Anchors';

import { IVendorRecord, IWorkEvent, VendorSystem } from '../../logic/systems/VendorSystem';
import { ApprenticeRoad, ICraftsman, generalKeepers } from '../../logic/systems/ApprenticeRoad';
import { workTools } from '../../logic/systems/SalvageSystem';
import { NpcAgenda } from '../../logic/systems/NpcAgenda';

const provenance = async () => (await import('../../logic/sovereignty/Provenance')).Provenance;

/** Whose shelf each shop window is, and whose counter buys. */
const SHOP_VENDOR = { weapon: 'npc_weapon_vendor', armor: 'npc_armor_vendor', consumable: 'npc_alchemist' } as const;
const COUNTER_NPC = SHOP_VENDOR.weapon;
/** What taking someone on and seeing them through give a vendor. Guesses until Wave 12. */
const VENDOR_BELONGING_PER_TAKEN = 10;
const VENDOR_ESTEEM_PER_RAISED = 20;

/** What the running cost reads: the city as it stands, and its web. */
const cityOf = (s: Pick<HubState, 'chunks' | 'dismembered' | 'lots' | 'web'>) =>
  ({ layout: HubGenerator.generate({ chunks: s.chunks, dismembered: s.dismembered }), lots: s.lots, web: s.web });

/** D115: one signed row per print, each of them 14 days of what the hub runs on. */
const printRows = (hubId: string, perDay: number, prints: number, why: string): { type: 'PRINT'; data: Record<string, any> }[] =>
  Array.from({ length: prints }, () => ({ type: 'PRINT' as const, data: { hubId, amount: printAmount(perDay), perDay, days: PRINT_DAYS, why } }));

const printedPlus = (guild: IGuildState, prints: number, made: number): IGuildState['printed'] =>
  ({ count: guild.printed.count + prints, total: guild.printed.total + made });

/** Every general vendor, standing and folded up to today. Pure: a person's day is not moved here. */
const vendorsToday = (vendors: Record<string, IVendorRecord>, craftsmen: ICraftsman[], today: number): Record<string, IVendorRecord> => {
  const out: Record<string, IVendorRecord> = {};
  for (const [id, record] of Object.entries(vendors)) out[id] = VendorSystem.fold(VendorSystem.normal(record), today);
  for (const npc of Object.values(HUB_NPCS)) {
    if (!npc.teaches) continue;
    const raising = craftsmen.filter(c => c.masterId === npc.id).length;
    out[npc.id] = VendorSystem.fold(VendorSystem.normal(vendors[npc.id] ?? VendorSystem.fresh(npc.id, 'GENERAL', today)), today, raising);
  }
  return out;
};

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
  shopListings?: { item: IItem; price: number; ask?: { defId: string; name: string } }[];
  // D115: anchors a shelf took in place of coin, held until its owner collects them
  heldInTrade?: IItem[];
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

/** What a bench job is called, whichever bank its recipe came from. */
export const craftName = (recipeId: string): string =>
  (RECIPE_DEFINITIONS[recipeId] ?? GEAR_RECIPES[recipeId] ?? WebBank.recipe(recipeId))?.name ?? recipeId;

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
  /** D27: the station a further bench was fitted as, opened by a connection. */
  stationId?: string;
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

/** A lot nobody holds yet, at the price the manifest asks. */
const freshLot = (poi: IPOI): IPlayerLot => ({
  id: poi.id,
  lotIndex: poi.metadata.lotIndex,
  ownerId: null,
  ownerName: null,
  purchaseDate: null,
  structureType: 'EMPTY',
  inventory: [],
  price: poi.metadata.price
});

/**
 * A hub's lots against its layout. Whatever someone holds is handed back as it is,
 * what they paid included. A lot nobody holds asks what its place asks today.
 */
const lotsFor = (stored: IPlayerLot[], layout: IHubLayout): IPlayerLot[] =>
  HubGenerator.lotRecords(stored, layout, freshLot).map(lot => {
    if (lot.ownerId) return lot;
    const asks = HubGenerator.findPOI(layout, lot.id)?.metadata.price;
    return asks === undefined || asks === lot.price ? lot : { ...lot, price: asks };
  });

const dominantDefId = (defIds: string[]): string => {
  const counts = new Map<string, number>();
  for (const id of defIds) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tagDefaultMaterial('building');
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
  /** One of the vendor's own pieces, bought in, not a line of the day's shelf. */
  held?: boolean;
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
  /** D74: what has risen, in order. The first is the middle one. */
  chunks: IRaisedChunk[];
  /** Lots split up, in order. With `chunks`, this is the plan the city is built from. */
  dismembered: IDismemberment[];
  /** D73: materials held toward the next chunk, by the tag they were given for. */
  planDeposit: Record<string, number>;
  lots: IPlayerLot[];
  /** Each vendor's own container and goal. Saved with the hub; the day's lines are not. */
  vendors: Record<string, IVendorRecord>;
  /** The people on the apprentice road. */
  craftsmen: ICraftsman[];
  craftingJobs: ICraftJob[];
  // Wave 10: the rooms behind the doors, and the construction queue
  rooms: Record<string, IRoomState>;
  buildJobs: IBuildJob[];
  /** D27: the web is the hub's. The exp stays on each person. */
  web: IHubWeb;
  /** D73, D75: the Hall of Banners: the people it houses, what they want, what it holds. */
  guild: IGuildState;
  weaponShop: IShopListing[];
  armorShop: IShopListing[];
  consumableShop: IShopListing[];
  auctionListings: IAuctionListing[];
  isLoading: boolean;

  // Actions
  loadHub: (hubWorldUid: string) => Promise<void>;
  saveHubState: () => Promise<void>;
  /** The vendors and the people at their benches, up to today. Time away counts. */
  resolveVendors: () => Promise<void>;
  /** A general vendor takes on someone lodged at the tavern (D75's door), who has no ground yet. */
  takeApprentice: (npcId: string, residentId: string) => Promise<RoomVerdict>;
  /** A master's own shelf, as this person sees it. */
  traderShelf: (traderId: string) => IShopListing[];
  buyFromTrader: (traderId: string, listingId: string) => Promise<IItem | null>;
  /** D74: one chunk more, on the given side of one standing (the first, unless named). It decides nothing about who pays. */
  raiseChunk: (side: HubSide, beside?: { cx: number; cy: number }) => Promise<RoomVerdict>;
  /** D73: give what you hold toward the next chunk, at the Land Office. Items are gone once given. */
  depositToPlan: (tag: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** D73: spend the deposit and raise the next chunk, where the plan chose. */
  planRaise: (side: HubSide, beside?: { cx: number; cy: number }) => Promise<RoomVerdict>;
  /**
   * Split an empty lot: a servidão to its centre, smaller lots around it, at a cost. Your
   * own stays yours in pieces. A free one goes on the market in pieces, for anyone to buy
   * one: it is how someone who cannot afford a big lot gets a small one.
   */
  dismemberLot: (lotId: string) => Promise<RoomVerdict>;
  /** D75: a bond brings a person out, and they lodge at the tavern. One bond, one person. */
  redeemBond: (itemId: string) => Promise<RoomVerdict>;
  /** D75: the guild buys ground for someone at the tavern, on the hub treasury's word. */
  guildBuyLot: (residentId: string, lotId: string) => Promise<RoomVerdict>;
  /** D115: everyone's own coin in this hub, by person. The documents are the record; this is what the windows read. */
  wallets: Record<string, number>;
  /** Everyone here who has not yet brought their wallet brings it. */
  settleWallets: () => Promise<void>;
  /** D115: the days the hub has not yet paid for, paid into its people's wallets. It prints when it must. */
  resolveRunning: (simDay?: number) => Promise<void>;
  runningNow: () => number;
  /** Each building's upkeep, and the web per tile it comes from. */
  runningBook: () => IRunningBook;
  /** D8: give what you hold toward someone's house. When the bill is met, the clock starts. */
  poolToHouse: (residentId: string, tag: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** A house finished: the person is home, and their skills join the hub's web. */
  settleHomes: () => Promise<void>;
  /** D73: what the people at home want today goes on the board. */
  resolveWants: (simDay?: number) => Promise<void>;
  /** A want met: the things go to their house, and the hub's treasury pays. */
  fulfilQuest: (questId: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** D83: the hard quest. The one door a rank comes through. */
  passTrial: (itemIds: string[]) => Promise<RoomVerdict>;
  /** D93: a map handed to the guild. It is kept whole, and what it would post can be read. */
  handMapToGuild: (itemId: string) => Promise<RoomVerdict>;
  /** The hub as a document, for a commit that changes it along with gold. */
  hubDoc: () => IVectorDocument | null;

  purchaseLot: (lotId: string, playerId: string, playerName: string) => Promise<boolean>;
  setLotStructure: (lotId: string, structureType: IPlayerLot['structureType']) => Promise<void>;
  purchaseFromShop: (listingId: string, shop: 'weapon' | 'armor' | 'consumable') => IItem | null;

  // Wave 5: society
  buyLot: (lotId: string) => Promise<boolean>;
  /** `material` is the builder's choice (D13): that material pays first. */
  buildStructure: (lotId: string, type: 'HOUSE' | 'WORKSHOP' | 'VENDOR', material?: string, stationId?: string) => Promise<boolean>;
  /** D25: what this shell asks of this owner, right now. A first WORKSHOP asks no metal. */
  shellBillNow: (type: 'HOUSE' | 'WORKSHOP' | 'VENDOR', stationId?: string) => { tag: string; count: number }[];
  /** D27: the further stations this hub's web and these hands have opened. */
  openStationsNow: () => IWebStation[];
  /** D27: the recipes of whatever further stations stand in this room. */
  stationRecipesOn: (lotId: string) => IWebRecipe[];
  /** D27: why this recipe will not run here, or null when it will. */
  craftRefusal: (lotId: string, recipeId: string) => string | null;
  /** D27: how long this job would really take, winging it or knowing it. */
  craftSecondsNow: (lotId: string, recipeId: string) => number;
  /** D30: the rest. What was worked at may settle, and the first to reach it is credited. */
  restAndCredit: (kind: 'SEALED' | 'DIED' | 'WITHDREW') => Promise<ISkillState[]>;
  /** D27: bring what this person holds into the hub's web. Idempotent. */
  creditHeld: () => Promise<void>;
  creditMastery: (skillId: string) => Promise<void>;
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
  /** `npcId` is whose counter. Left out, the first keeper's. */
  sellToVendor: (itemId: string, npcId?: string) => Promise<number | null>;
  /** `askDefId`: ask for one anchor of this kind in place of coin (D115). */
  listItemForSale: (lotId: string, itemId: string, price: number, askDefId?: string) => Promise<boolean>;
  collectHeld: (lotId: string) => Promise<number>;
  buyFromLot: (lotId: string, itemId: string) => Promise<boolean>;
  collectProceeds: (lotId: string) => Promise<number>;
  resolveUpkeep: (simDay?: number) => Promise<void>;

  // Admin / Generator
  generateDailyStock: () => void;
}

export const useHubStore = create<HubState>((set, get) => ({
  activeHubId: null,
  chunks: firstPlan().chunks,
  dismembered: [],
  planDeposit: {},
  lots: [],
  vendors: {},
  craftsmen: [],
  craftingJobs: [],
  rooms: {},
  buildJobs: [],
  web: { nodes: {} },
  guild: emptyGuild(),
  wallets: {},
  weaponShop: [],
  armorShop: [],
  consumableShop: [],
  auctionListings: [],
  isLoading: false,
  
  loadHub: async (hubWorldUid: string) => {
    void HubUnlock.isUnlocked(hubWorldUid);
    set({ isLoading: true, activeHubId: hubWorldUid });

    try {
      // 1. Try to fetch existing Hub State from DB
      const hubStateDoc = await VectorStore.get<{ vendors?: Record<string, IVendorRecord>; craftsmen?: ICraftsman[]; chunks?: IRaisedChunk[]; dismembered?: IDismemberment[]; planDeposit?: Record<string, number>; lots: IPlayerLot[]; craftingJobs?: ICraftJob[]; rooms?: Record<string, IRoomState>; buildJobs?: IBuildJob[]; web?: IHubWeb; guild?: IGuildState }>(
        VectorNamespace.TERRITORIES,
        `hub_state_${hubWorldUid}`
      );

      if (hubStateDoc) {
        // LOAD EXISTING
        console.log('[HUB] State loaded from persistence.');
        // A save from before the manifest has no chunks, and it stands on the first.
        const chunks = hubStateDoc.data.chunks ?? firstPlan().chunks;
        const dismembered = hubStateDoc.data.dismembered ?? [];
        set({
          chunks,
          dismembered,
          planDeposit: hubStateDoc.data.planDeposit ?? {},
          lots: lotsFor(hubStateDoc.data.lots, HubGenerator.generate({ chunks, dismembered })),
          vendors: hubStateDoc.data.vendors ?? {},
          craftsmen: (hubStateDoc.data.craftsmen ?? []).map(ApprenticeRoad.normal),
          craftingJobs: hubStateDoc.data.craftingJobs || [],
          rooms: hubStateDoc.data.rooms || {},
          buildJobs: hubStateDoc.data.buildJobs || [],
          web: hubStateDoc.data.web || { nodes: {} },
          guild: guildFrom(hubStateDoc.data.guild)
        });
      } else {
        // GENERATE FRESH (First time this Hub is visited)
        console.log('[HUB] No state found. Generating fresh layout...');
        
        // The manifest says where the lots stand
        const chunks = firstPlan().chunks;
        set({ chunks, dismembered: [], planDeposit: {}, lots: lotsFor([], HubGenerator.generate({ chunks })), web: { nodes: {} }, guild: emptyGuild(), vendors: {}, craftsmen: [] });
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
      void WebBank.bankAndSign(signer);

      // 2. Generate/Load Shop Stock (Simulated Daily Refresh)
      // In a real app, this would be server-side. Here we simulate it.
      get().generateDailyStock();

      // D115: 14 days of what it runs on. A hub already endowed keeps what it holds.
      await Treasury.endow(hubWorldUid, printAmount(runningPerDay(cityOf(get()))));
      await get().settleWallets();
      await get().resolveRunning();

      // 3. Wave 5 / Wave 10: resolve what time finished while nobody watched
      await get().resolveVendors();
      await get().resolveCrafts();
      await get().resolveBuilds();
      await get().resolveUpkeep();
      // D27: whatever this person already holds enters this hub's web when the hub looks.
      await get().creditHeld();
      await get().resolveWants();

    } catch (e) {
      console.error('[HUB] Failed to load hub:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  saveHubState: async () => {
    const hubDoc = get().hubDoc();
    if (!hubDoc) return;

    // Hub changes usually move gold or items, so the bank is saved with them, as
    // one write: an item is never in the stash and on the lot, or on neither.
    const bank = PlayerPersistence.snapshot();
    await StoreUnit.enqueue(async () => {
      const unit = new StoreUnit();
      if (bank) await PlayerPersistence.signInto(unit, bank);
      await VectorStore.put(hubDoc, false, { unit });
      const result = await unit.commit();
      if (!result.ok) console.error('[HUB] ⛔ The store refused the hub state:', result.reason);
    });
  },

  // ==========================================================================
  // THE HUB'S MONEY (D108, D115). The law is in money.ts.
  // ==========================================================================

  runningNow: () => runningPerDay(cityOf(get())),

  runningBook: () => runningBook(cityOf(get())),

  settleWallets: async () => {
    const { activeHubId, guild, craftsmen } = get();
    if (!activeHubId) return;
    const people = new Map<string, { name: string; amount: number }>();
    for (const npc of Object.values(HUB_NPCS)) people.set(npc.id, { name: npc.name, amount: walletBrought(`${activeHubId}:${npc.id}`, npcRank(npc.id)) });
    // Whoever they are on the books today, the wallet is the person's: a bond names them for life
    for (const { bond, name } of [...guild.residents, ...craftsmen]) {
      const id = residentIdOf(bond);
      people.set(id, { name, amount: walletBrought(id, bond.rank) });
    }
    const held = await Wallets.allOf(activeHubId);
    for (const [id, { name, amount }] of people) {
      if (held[id] === undefined) await Wallets.bring(activeHubId, id, amount, name);
    }
    set({ wallets: await Wallets.allOf(activeHubId) });
  },

  resolveRunning: async (simDay) => {
    const day = simDay ?? worldDay();
    const { activeHubId, guild } = get();
    if (!activeHubId) return;
    // A hub from before this was kept owes nothing for those days
    if (guild.runningDay === undefined) {
      set({ guild: { ...guild, runningDay: day } });
      await get().saveHubState();
      return;
    }
    const days = day - guild.runningDay;
    if (days <= 0) return;

    const { lines, perDay } = runningBook(cityOf(get()));
    const { prints, paid } = foldDays(await Treasury.balance(activeHubId), perDay, days);
    const deltas: Record<string, number> = {};
    for (const line of lines) deltas[line.who] = (deltas[line.who] ?? 0) + line.amount * days;

    // The treasury's read was the only wait. From here to the commit there is none.
    const made = prints * printAmount(perDay);
    set({ guild: { ...get().guild, runningDay: day, printed: printedPlus(get().guild, prints, made) } });
    await GoldCommit.commit({
      rows: [
        ...printRows(activeHubId, perDay, prints, 'THE_DAYS'),
        { type: 'GOLD_DELTA', data: { reason: 'HUB_RUNNING', amount: 0, days, perDay, treasuryId: activeHubId, treasuryDelta: -paid, wallets: deltas } }
      ],
      treasury: { worldUid: activeHubId, delta: made - paid },
      wallets: { hubId: activeHubId, deltas },
      hubDoc: get().hubDoc() ?? undefined
    });
    set({ wallets: await Wallets.allOf(activeHubId) });
    if (prints > 0) useFeed.getState().push(`The Hall has printed ${made.toLocaleString()} G.`, 'signal');
  },

  resolveVendors: async () => {
    await get().settleWallets();
    const { activeHubId, craftsmen, web, guild } = get();
    if (!activeHubId) return;
    const today = Math.floor(Date.now() / 86_400_000);
    const vendors = vendorsToday(get().vendors, craftsmen, today);
    const keepers = generalKeepers();
    const out: ICraftsman[] = [];
    let residents = guild.residents;
    let nextWeb = web;
    let changed = false;
    const hoursAt = (masterId: string) => vendors[masterId] ? VendorSystem.teachingHours(vendors[masterId]) : 1;
    for (const person of craftsmen) {
      const walked = ApprenticeRoad.resolve(person, today, hoursAt, keepers);
      out.push(walked.craftsman);
      for (const event of walked.events) {
        changed = true;
        if (event.movedTo) {
          useFeed.getState().push(`${event.name} has finished at one bench and gone on to ${HUB_NPCS[event.movedTo]?.name ?? 'the next'}.`, 'signal');
          continue;
        }
        // Crafting is theirs now, and the hub's web can stand on them
        nextWeb = WebSystem.admit(nextWeb, { uid: person.id, name: person.name }, { [walked.craftsman.skill.id]: walked.craftsman.skill }, Date.now()).web;
        const teacher = walked.craftsman.masterId;
        if (vendors[teacher]) vendors[teacher] = { ...vendors[teacher], agenda: NpcAgenda.fill(vendors[teacher].agenda, { esteem: VENDOR_ESTEEM_PER_RAISED }) };
        useFeed.getState().push(`${event.name} is a ${event.to.toLowerCase()} now.`, 'proof');
        await Ledger.append('TECH', { kind: 'ROAD', craftsmanId: person.id, name: person.name, to: event.to, masterId: teacher });
      }
    }

    // A new master needs a shop of their own: back through the tavern, and the Hall takes it from there
    for (const person of out) {
      if (person.rank !== 'MASTER' || vendors[person.id] || residents.some(r => r.craftsmanId === person.id)) continue;
      changed = true;
      residents = [...residents, {
        id: residentIdOf(person.bond), bondItemId: person.bondItemId, bond: person.bond,
        worldSeed: person.bond.worldSeed, entityId: person.bond.entityId, name: person.name,
        sponsorId: person.sponsorId, sponsorName: person.sponsorName, arrivedAt: Date.now(),
        lotId: null, wantsMet: 0, craftsmanId: person.id
      }];
      useFeed.getState().push(`${person.name} needs a shop now. The Hall of Banners has them on its books.`, 'signal');
    }

    // The day's work: what came in is looked over, taken apart, and made into something
    const tools = workTools();
    const noted = async (npcId: string, events: IWorkEvent[]) => {
      if (events.length > 0) changed = true;
      for (const event of events) {
        if (event.kind === 'DISCOVERED') {
          useFeed.getState().push(`${HUB_NPCS[npcId]?.name ?? out.find(c => c.id === npcId)?.name ?? 'Someone'} has worked out how to make ${event.name}.`, 'proof');
          await Ledger.append('TECH', { kind: 'RECIPE', recipeId: event.recipeId, name: event.name, by: npcId, hubId: activeHubId });
        } else if (event.kind === 'SALVAGED') {
          await Ledger.append('CRAFT', { kind: 'VENDOR_SALVAGED', npcId, itemId: event.itemId, defId: event.defId, parts: event.parts, consumedIds: [event.itemId] });
        } else if (event.kind === 'CRAFTED') {
          await Ledger.append('CRAFT', { kind: 'VENDOR_CRAFTED', npcId, recipeId: event.recipeId, consumedIds: event.consumed, made: event.made });
        }
      }
    };
    for (const npcId of keepers) {
      const worked = VendorSystem.work(vendors[npcId], today, ApprenticeRoad.labor(out, npcId), tools);
      vendors[npcId] = worked.record;
      await noted(npcId, worked.events);
    }
    // A master works from whichever keeper has the most lying about, and pays them for it
    const partsDeltas: Record<string, number> = {};
    for (const person of out) {
      const shop = vendors[person.id];
      if (!shop || shop.worked >= today) continue;
      const source = [...keepers].sort((a, b) => vendors[b].parts.length - vendors[a].parts.length || a.localeCompare(b))[0];
      const purse = residentIdOf(person.bond);
      const shared = VendorSystem.share(vendors[source], shop, (get().wallets[purse] ?? 0) + (partsDeltas[purse] ?? 0));
      if (shared.paid > 0) {
        changed = true;
        partsDeltas[purse] = (partsDeltas[purse] ?? 0) - shared.paid;
        partsDeltas[source] = (partsDeltas[source] ?? 0) + shared.paid;
      }
      vendors[source] = shared.from;
      const worked = VendorSystem.work(shared.to, today, 0, tools);
      vendors[person.id] = worked.record;
      await noted(person.id, worked.events);
    }

    set({ vendors, craftsmen: out, web: nextWeb, guild: { ...get().guild, residents } });
    get().generateDailyStock();
    if (Object.keys(partsDeltas).length > 0) {
      await GoldCommit.commit({
        rows: [{ type: 'TRADE', data: { kind: 'MASTER_BOUGHT_PARTS', playerDelta: 0, treasuryDelta: 0, wallets: partsDeltas } }],
        wallets: { hubId: activeHubId, deltas: partsDeltas },
        hubDoc: get().hubDoc() ?? undefined
      });
      set({ wallets: await Wallets.allOf(activeHubId) });
    } else if (changed) await get().saveHubState();
  },

  takeApprentice: async (npcId, residentId) => {
    const { activeHubId, craftsmen, vendors, guild } = get();
    const teaches = HUB_NPCS[npcId]?.teaches;
    if (!activeHubId || !teaches) return { ok: false, reason: 'Nobody here trains anyone.' };
    const resident = guild.residents.find(r => r.id === residentId);
    if (!resident) return { ok: false, reason: 'Nobody by that name is lodged at the tavern.' };
    if (resident.lotId) return { ok: false, reason: `${resident.name} has ground of their own to look to.` };
    const today = Math.floor(Date.now() / 86_400_000);
    const keeper = NpcSheet.read(activeHubId, { id: npcId, rank: teaches.rank }, undefined);
    const begun = ApprenticeRoad.begin(bondItemOf(resident), {
      id: npcId, room: ApprenticeRoad.roomFor(keeper.stats!),
      taken: craftsmen.filter(c => c.masterId === npcId && c.rank === 'APPRENTICE').length
    }, resident.sponsorId, resident.sponsorName, today, WebBank.current());
    if (!begun.ok || !begun.craftsman) return { ok: false, reason: begun.reason };
    if (craftsmen.some(c => c.id === begun.craftsman!.id)) return { ok: false, reason: `${begun.craftsman.name} is on the road already.` };

    const all = vendorsToday(vendors, craftsmen, today);
    set({
      guild: { ...guild, residents: guild.residents.filter(r => r.id !== residentId) },
      craftsmen: [...craftsmen, begun.craftsman],
      vendors: { ...all, [npcId]: { ...all[npcId], agenda: NpcAgenda.fill(all[npcId].agenda, { belonging: VENDOR_BELONGING_PER_TAKEN }) } }
    });
    await Ledger.append('GUILD', { kind: 'PERSON_APPRENTICED', residentId, craftsmanId: begun.craftsman.id, name: begun.craftsman.name, masterId: npcId });
    await get().saveHubState();
    return { ok: true };
  },

  traderShelf: (traderId) => {
    const record = get().vendors[traderId];
    if (!record) return [];
    return VendorSystem.shelf(VendorSystem.normal(record), [], Math.floor(Date.now() / 86_400_000), 0, usePlayerStore.getState().player.id);
  },

  buyFromTrader: async (traderId, listingId) => {
    const { activeHubId, vendors } = get();
    const row = get().traderShelf(traderId).find(l => l.id === listingId);
    if (!activeHubId || !row || !vendors[traderId]) return null;
    const player = usePlayerStore.getState().player;
    const price = Math.ceil(StatSystem.shopPrice(row.price, player.attributes));
    if (player.bank.gold < price) return null;
    const today = Math.floor(Date.now() / 86_400_000);
    const taken = VendorSystem.takeOwn(VendorSystem.normal(vendors[traderId]), row.item.id);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - price, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
      idx === 0 ? { ...tab, items: [...tab.items, row.item] } : tab
    ) } } }));
    // A master has a purse of their own (D115): what they take is theirs
    const master = get().craftsmen.find(c => c.id === traderId);
    const purse = master ? residentIdOf(master.bond) : traderId;
    const deltas = { [purse]: price };
    set({ wallets: { ...get().wallets, [purse]: (get().wallets[purse] ?? 0) + price } });
    void GoldCommit.commit({
      rows: [{ type: 'GOLD_DELTA', data: { reason: 'SHOP_PURCHASE', itemId: row.item.id, defId: row.item.universalDefinitionId, amount: -price, traderId, wallets: deltas } }],
      wallets: { hubId: activeHubId, deltas }
    });
    set({ vendors: { ...vendors, [traderId]: VendorSystem.recordSale(taken, listingId, today, 1, row.item.universalDefinitionId) } });
    await get().saveHubState();
    return row.item;
  },

  raiseChunk: async (side, beside) => {
    const raised = raiseChunk({ chunks: get().chunks, dismembered: get().dismembered }, side, { beside });
    if (!raised.ok) return raised;
    const { chunks } = raised.plan;
    const added = chunks[chunks.length - 1];
    set({ chunks, lots: lotsFor(get().lots, HubGenerator.generate(raised.plan)) });
    await Ledger.append('BUILD', { kind: 'CHUNK_RAISED', cx: added.cx, cy: added.cy, chunk: added.kind, side });
    await get().saveHubState();
    return { ok: true };
  },

  depositToPlan: async (tag, itemIds) => {
    const { chunks, planDeposit, activeHubId } = get();
    if (!activeHubId) return { ok: false, reason: 'There is no office open.' };
    const line = chunkBillFor(chunks.length).find(l => l.tag === tag);
    if (!line) return { ok: false, reason: `The next chunk does not ask for anything ${tag}.` };
    const short = line.count - (planDeposit[tag] ?? 0);
    if (short <= 0) return { ok: false, reason: 'The plan holds all it asks for.' };
    const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
    const items = itemIds.map(id => stash.find(i => i.id === id));
    if (items.some(i => !i)) return { ok: false, reason: 'That is not in your stash.' };
    const wrong = items.find(i => !answersTag(i!, tag));
    if (wrong) return { ok: false, reason: `${wrong.name} is not ${tag}. The plan will not take it.` };
    const given = items.slice(0, short) as IItem[];
    if (given.length === 0) return { ok: false, reason: 'Nothing was given.' };

    removeFromStash(given.map(i => i.id));
    set({ planDeposit: { ...planDeposit, [tag]: (planDeposit[tag] ?? 0) + given.length } });
    await Ledger.append('BUILD', { kind: 'PLAN_DEPOSIT', tag, consumedIds: given.map(i => i.id), consumedDefIds: given.map(i => i.universalDefinitionId) });
    await get().saveHubState();
    return { ok: true };
  },

  planRaise: async (side, beside) => {
    const { chunks, dismembered, planDeposit } = get();
    const bill = chunkBillFor(chunks.length);
    const short = bill.find(line => (planDeposit[line.tag] ?? 0) < line.count);
    if (short) return { ok: false, reason: `The next chunk asks ${short.count} ${short.tag}; the plan holds ${planDeposit[short.tag] ?? 0}.` };
    const can = raiseChunk({ chunks, dismembered }, side, { beside });
    if (!can.ok) return can;
    const spent = { ...planDeposit };
    bill.forEach(line => { spent[line.tag] -= line.count; });
    set({ planDeposit: spent });
    return get().raiseChunk(side, beside);
  },

  dismemberLot: async (lotId) => {
    const { chunks, dismembered, lots, rooms, buildJobs, activeHubId } = get();
    const p = usePlayerStore.getState().player;
    const lot = lots.find(l => l.id === lotId);
    if (!lot || !activeHubId) return { ok: false, reason: 'There is no such lot.' };
    if (lot.ownerId && lot.ownerId !== p.id) return { ok: false, reason: 'It is someone else\'s to split.' };
    if (lot.structureType !== 'EMPTY' || rooms[lotId]) return { ok: false, reason: 'Something stands on it. A lot is split while it is empty ground.' };
    if (buildJobs.some(j => j.lotId === lotId && !j.applied)) return { ok: false, reason: 'Something is being raised on it. A lot is split while it is empty ground.' };

    const plan = { chunks, dismembered };
    const verdict = HubGenerator.dismemberVerdict(HubGenerator.generate(plan), lotId);
    if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'It cannot be split.' };
    const cost = verdict.cost!;
    if (p.bank.gold < cost) return { ok: false, reason: `Splitting it costs ${cost} G; you hold ${p.bank.gold} G.` };

    const next = dismemberPlan(plan, lotId);
    const layout = HubGenerator.generate(next);
    const pieces = layout.zones.flatMap(z => z.pois)
      .filter(poi => poi.metadata.dismemberedFrom === lotId)
      .sort((a, b) => a.metadata.lotIndex - b.metadata.lotIndex)
      .map(poi => lot.ownerId
        ? { ...freshLot(poi), ownerId: lot.ownerId, ownerName: lot.ownerName, purchaseDate: lot.purchaseDate, upkeepPaidThroughDay: lot.upkeepPaidThroughDay }
        : freshLot(poi));

    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
    set({ dismembered: next.dismembered ?? [], lots: lotsFor([...lots.filter(l => l.id !== lotId), ...pieces], layout) });
    await GoldCommit.commit({
      rows: [{ type: 'GOLD_DELTA', data: { reason: 'LOT_DISMEMBERED', lotId, pieces: pieces.map(l => l.id), amount: -cost, treasuryId: activeHubId, treasuryDelta: cost } }],
      treasury: { worldUid: activeHubId, delta: cost },
      hubDoc: get().hubDoc() ?? undefined
    });
    return { ok: true };
  },

  // ==========================================================================
  // THE GUILD AND THE TAVERN (D73, D75, D83, D93). The law is in guild.ts.
  // ==========================================================================

  redeemBond: async (itemId) => {
    const p = usePlayerStore.getState().player;
    const { activeHubId, guild } = get();
    if (!activeHubId) return { ok: false, reason: 'There is no tavern open.' };
    const bond = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!bond) return { ok: false, reason: 'That is not in your stash.' };
    const sheet = NpcSheet.fromBond(bond);
    if (!sheet || !bond.bondData) return { ok: false, reason: 'That paper names nobody Mags can find.' };
    const id = residentIdOf(bond.bondData);
    const onTheRoad = get().craftsmen.some(c => c.bond.worldSeed === bond.bondData!.worldSeed && c.bond.entityId === bond.bondData!.entityId);
    if (onTheRoad || guild.residents.some(r => r.id === id || r.bondItemId === bond.id)) return { ok: false, reason: `${sheet.name} is already in this city. Nobody comes through twice.` };

    // From the check to the bond leaving there is no await: one press, one person.
    const resident: IResident = {
      id, bondItemId: bond.id, bond: bond.bondData, worldSeed: bond.bondData.worldSeed, entityId: bond.bondData.entityId,
      name: sheet.name, sponsorId: p.id, sponsorName: p.username, arrivedAt: Date.now(), lotId: null, wantsMet: 0
    };
    removeFromStash([bond.id]);
    set({ guild: { ...guild, residents: [...guild.residents, resident] } });
    await get().saveHubState();
    await Ledger.append('GUILD', { kind: 'PERSON_LODGED', residentId: id, name: sheet.name, bondItemId: bond.id, consumedIds: [bond.id] });
    await (await provenance()).record(bond, 'TRANSFER', { via: 'REDEEMED', residentId: id });
    await get().settleWallets();
    return { ok: true };
  },

  guildBuyLot: async (residentId, lotId) => {
    const { activeHubId, chunks, dismembered, guild, lots } = get();
    if (!activeHubId) return { ok: false, reason: 'The Hall is shut.' };
    const resident = guild.residents.find(r => r.id === residentId);
    if (!resident) return { ok: false, reason: 'The Hall has nobody by that name.' };
    if (resident.lotId) return { ok: false, reason: `${resident.name} has ground already.` };
    const lot = lots.find(l => l.id === lotId);
    if (!lot || lot.ownerId) return { ok: false, reason: 'That ground is not for sale.' };

    const poi = HubGenerator.findPOI(HubGenerator.generate({ chunks, dismembered }), lotId);
    const tpl = poi ? houseTemplateFor({ width: poi.size.width, height: poi.size.height }) : null;
    if (!tpl) return { ok: false, reason: 'No house the Hall knows how to raise fits on that ground.' };
    const asked = guildHouseCost(lot.price);

    // From the checks to the commit there is no wait: the deed and its row land as one.
    set({
      lots: lots.map(l => l.id === lotId
        ? { ...l, ownerId: GUILD_OWNER_ID, ownerName: resident.name, purchaseDate: Date.now(), upkeepPaidThroughDay: worldDay() }
        : l),
      guild: {
        ...guild,
        residents: guild.residents.map(r => r.id === residentId ? { ...r, lotId, house: { pool: {}, templateName: tpl.name } } : r)
      }
    });
    // The seller is the treasury that backs the buyer, so no gold moves. The row says so.
    await GoldCommit.commit({
      rows: [{ type: 'TRADE', data: { kind: 'GUILD_BOUGHT_LOT', lotId, residentId, price: lot.price, permit: asked - lot.price, playerDelta: 0, treasuryDelta: 0 } }],
      hubDoc: get().hubDoc() ?? undefined
    });
    return { ok: true };
  },

  poolToHouse: async (residentId, tag, itemIds) => {
    const { guild, lots } = get();
    const resident = guild.residents.find(r => r.id === residentId);
    if (!resident?.lotId || !resident.house) return { ok: false, reason: 'They have no ground to build on yet.' };
    if (resident.house.raised) return { ok: false, reason: 'The house is already rising. It asks nothing more.' };
    const tpl = houseTemplateNamed(resident.house.templateName);
    if (!tpl) return { ok: false, reason: 'The Hall has lost the plan.' };
    const bill = houseBill(tpl);
    const line = bill.find(l => l.tag === tag);
    if (!line) return { ok: false, reason: `The house does not ask for anything ${tag}.` };
    const short = line.count - (resident.house.pool[tag]?.count ?? 0);
    if (short <= 0) return { ok: false, reason: `The house holds all the ${tag} it asks for.` };

    const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
    const items = itemIds.map(id => stash.find(i => i.id === id));
    if (items.some(i => !i)) return { ok: false, reason: 'That is not in your stash.' };
    const wrong = items.find(i => !answersTag(i!, tag));
    if (wrong) return { ok: false, reason: `${LoadoutSystem.shownName(wrong)} is not ${tag}. The house will not take it.` };
    const given = (items as IItem[]).slice(0, short);
    if (given.length === 0) return { ok: false, reason: 'Nothing was given.' };

    const prior = resident.house.pool[tag];
    const pool = {
      ...resident.house.pool,
      [tag]: {
        count: (prior?.count ?? 0) + given.length,
        consumedIds: [...(prior?.consumedIds ?? []), ...given.map(i => i.id)],
        defIds: [...(prior?.defIds ?? []), ...given.map(i => i.universalDefinitionId)],
        ...(inheritedOf(given) || prior?.inherited ? { inherited: [...(prior?.inherited ?? []), ...(inheritedOf(given) ?? [])] } : {})
      }
    };
    const met = bill.every(l => (pool[l.tag]?.count ?? 0) >= l.count);
    const base = defaultSheet(tpl);
    const sheet: ITemplateSheet | undefined = met
      ? {
          WALL: pool.building ? dominantDefId(pool.building.defIds) : base.WALL,
          DOOR: pool.wood ? dominantDefId(pool.wood.defIds) : base.DOOR,
          WINDOW: pool.glass ? dominantDefId(pool.glass.defIds) : base.WINDOW,
          zones: base.zones
        }
      : undefined;

    removeFromStash(given.map(i => i.id));
    set({
      guild: {
        ...guild,
        residents: guild.residents.map(r => r.id === residentId
          ? { ...r, house: { ...resident.house!, pool, ...(met ? { raised: true, sheet } : {}) } }
          : r)
      }
    });
    await Ledger.append('BUILD', { kind: 'HOUSE_POOLED', lotId: resident.lotId, residentId, tag, consumedIds: given.map(i => i.id), consumedDefIds: given.map(i => i.universalDefinitionId) });

    if (met && sheet) {
      // The same jobs a plan raises, on the same clock: shell first, then the pieces in order.
      const lot = lots.find(l => l.id === resident.lotId)!;
      const now = Date.now();
      const batch = `house_${resident.id}`;
      const shellFinish = now + SHELL_BUILD_SECONDS[tpl.structureType] * 1000;
      const owner = usePlayerStore.getState().player.id;
      const jobs: IBuildJob[] = [{
        id: `bld_${now.toString(36)}_res_${lot.lotIndex}`,
        lotId: lot.id, kind: 'SHELL', structureType: tpl.structureType, ownerCertUid: owner,
        queuedAt: now, finishesAt: shellFinish, applied: false,
        consumedIds: pool.building?.consumedIds ?? [], consumedDefIds: [sheet.WALL], batch,
        inherited: pool.building?.inherited,
        template: { itemId: batch, data: tpl, sheet }
      }];
      let finish = shellFinish;
      tpl.pieces.forEach((piece, i) => {
        finish += PIECE_BUILD_SECONDS[piece.kind] * 1000;
        const materialDefId = piece.kind === 'WINDOW' ? sheet.WINDOW : piece.kind === 'DOOR' ? sheet.DOOR : sheet.WALL;
        jobs.push({
          id: `bld_${now.toString(36)}_res_${lot.lotIndex}_${i}`,
          lotId: lot.id, kind: 'PIECE', piece: { kind: piece.kind, x: piece.x, y: piece.y, materialDefId },
          ownerCertUid: owner, queuedAt: now, finishesAt: finish, applied: false,
          consumedIds: [], consumedDefIds: [materialDefId], batch
        });
      });
      for (const job of jobs) job.signature = await signRecord({ kind: 'RESIDENT_HOUSE', lotId: lot.id, residentId, template: tpl.name, piece: job.piece, at: now });
      set({ buildJobs: [...get().buildJobs, ...jobs] });
      await Ledger.append('BUILD', { kind: 'HOUSE_RISING', lotId: lot.id, residentId, template: tpl.name, sheet, jobs: jobs.length });
      useFeed.getState().push(`The bill is met. ${resident.name}'s house is rising.`, 'proof');
    }
    await get().saveHubState();
    return { ok: true };
  },

  settleHomes: async () => {
    const { guild, buildJobs } = get();
    const due = guild.residents.filter(r => r.lotId && r.house?.raised && !r.homeAt && !buildJobs.some(j => j.lotId === r.lotId && !j.applied));
    if (due.length === 0) return;
    const hubId = get().activeHubId;
    const now = Date.now();
    set({ guild: { ...guild, residents: guild.residents.map(r => due.some(d => d.id === r.id) ? { ...r, homeAt: now, nextWantDay: worldDay() } : r) } });
    // A master's house is the shop they came back for, and whoever saw it through is remembered there
    for (const resident of due) {
      if (!resident.craftsmanId || get().vendors[resident.craftsmanId]) continue;
      const opened = VendorSystem.fresh(resident.craftsmanId, 'TRADER', Math.floor(now / 86_400_000));
      set({ vendors: { ...get().vendors, [resident.craftsmanId]: { ...opened, patrons: [usePlayerStore.getState().player.id] } } });
      await Ledger.append('GUILD', { kind: 'SHOP_OPENED', residentId: resident.id, craftsmanId: resident.craftsmanId, name: resident.name, lotId: resident.lotId });
      useFeed.getState().push(`${resident.name} has opened a shop of their own, and you will pay less in it.`, 'proof');
    }
    for (const resident of due) {
      // Their skills extend the hub's web, by the same door a player's emergence uses. The exp stays theirs.
      const { web, firsts, records } = WebSystem.admit(get().web, { uid: resident.id, name: resident.name }, readSheet(resident).skills ?? {}, now);
      set({ web });
      await Ledger.append('GUILD', { kind: 'PERSON_HOME', residentId: resident.id, name: resident.name, lotId: resident.lotId });
      for (const skillId of firsts) await Ledger.append('TECH', { kind: 'FIRST', skillId, name: WebSystem.nameOf(skillId), hubId, rung: 0, by: resident.name });
      for (const { id, rung } of records) await Ledger.append('TECH', { kind: 'RUNG', skillId: id, name: WebSystem.nameOf(id), hubId, rung, by: resident.name });
      useFeed.getState().push(`${resident.name} has left the tavern. There is a door with their name on it now.`, 'proof');
    }
    await get().resolveWants();
  },

  resolveWants: async (simDay) => {
    const day = simDay ?? worldDay();
    const { activeHubId, lots } = get();
    if (!activeHubId) return;
    const posted = get().guild.residents.filter(r => {
      if (!r.homeAt || (r.nextWantDay ?? day) > day) return false;
      if (get().guild.quests.some(q => q.residentId === r.id && q.state === 'OPEN')) return false;
      // Their house's upkeep is behind: they have bigger worries, until it is paid.
      return (lots.find(l => l.id === r.lotId)?.upkeepPaidThroughDay ?? day) >= day;
    });
    if (posted.length === 0) return;
    const quests = posted.map(r => ({
      id: `q_${r.id}_${r.wantsMet}`, residentId: r.id, n: r.wantsMet, state: 'OPEN' as const, postedDay: day,
      ...wantFor(r, readSheet(r), activeHubId, r.wantsMet)
    }));
    set({ guild: { ...get().guild, quests: [...get().guild.quests, ...quests] } });
    for (const q of quests) useFeed.getState().push(`On the board at the Hall: ${q.text}`, 'signal');
    await get().saveHubState();
  },

  fulfilQuest: async (questId, itemIds) => {
    const { activeHubId } = get();
    if (!activeHubId) return { ok: false, reason: 'The Hall is shut.' };
    const check = () => {
      const quest = get().guild.quests.find(q => q.id === questId);
      if (!quest || quest.state !== 'OPEN') return { reason: 'That want is not on the board.' };
      const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
      const items = itemIds.map(id => stash.find(i => i.id === id));
      if (items.some(i => !i)) return { reason: 'That is not in your stash.' };
      if ((items as IItem[]).some(i => i.isIdentified === false)) return { reason: 'Read it first. Nobody takes a thing nobody has read.' };
      const wrong = (items as IItem[]).find(i => !answersTag(i, quest.tag) || !wantMayTake(i));
      if (wrong) return { reason: `${LoadoutSystem.shownName(wrong)} is not what was asked for.` };
      if (items.length < quest.count) return { reason: `The want is for ${quest.count}. That is ${items.length}.` };
      return { quest, given: (items as IItem[]).slice(0, quest.count) };
    };
    const first = check();
    if (!first.quest) return { ok: false, reason: first.reason! };
    const pay = questPay(first.given, first.quest.payShare);
    const perDay = runningPerDay(cityOf(get()));
    const prints = printsNeeded(await Treasury.balance(activeHubId), pay, perDay);
    const made = prints * printAmount(perDay);

    // The treasury's read was the only wait. From here to the commit there is none.
    const { quest, given, reason } = check();
    if (!quest) return { ok: false, reason: reason! };
    const { guild, lots } = get();
    const resident = guild.residents.find(r => r.id === quest.residentId)!;
    const ids = given.map(i => i.id);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + pay } } }));
    removeFromStash(ids);
    set({
      lots: lots.map(l => l.id === resident.lotId ? { ...l, inventory: [...l.inventory, ...given] } : l),
      guild: {
        ...guild,
        printed: printedPlus(guild, prints, made),
        quests: guild.quests.map(q => q.id === questId ? { ...q, state: 'DONE' as const } : q),
        residents: guild.residents.map(r => r.id === resident.id ? { ...r, wantsMet: r.wantsMet + 1, nextWantDay: worldDay() + 1 } : r)
      }
    });
    await GoldCommit.commit({
      rows: [
        ...printRows(activeHubId, perDay, prints, 'QUEST_PAID'),
        { type: 'GOLD_DELTA', data: { reason: 'QUEST_PAID', questId, residentId: resident.id, consumedIds: ids, amount: pay, treasuryId: activeHubId, treasuryDelta: -pay } }
      ],
      treasury: { worldUid: activeHubId, delta: made - pay },
      hubDoc: get().hubDoc() ?? undefined
    });
    if (prints > 0) useFeed.getState().push(`The Hall has printed ${made.toLocaleString()} G.`, 'signal');
    await (await provenance()).recordMany(given, 'TRANSFER', { via: 'QUEST', questId, lotId: resident.lotId });
    useFeed.getState().push(`${resident.name} has what they wanted. The hub pays ${pay.toLocaleString()} G.`, 'proof');
    return { ok: true };
  },

  passTrial: async (itemIds) => {
    const p = usePlayerStore.getState().player;
    const rank = ProgressionSystem.rankOf(p);
    const trial = trialFor(rank);
    if (!trial) return { ok: false, reason: 'There is no rank above yours for the Hall to give.' };
    const inStash = () => {
      const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
      return itemIds.map(id => stash.find(i => i.id === id));
    };
    const items = inStash();
    if (items.some(i => !i)) return { ok: false, reason: 'That is not in your stash.' };
    if ((items as IItem[]).some(i => i.isIdentified === false)) return { ok: false, reason: 'Read it first. The Hall does not take a thing nobody has read.' };
    const taken = (items as IItem[]).filter(i => trialTakes(i, rank));
    if (taken.length < trial.count) return { ok: false, reason: `The trial asks for ${trial.count} things from above where you stand. That is ${taken.length}.` };
    const given = taken.slice(0, trial.count);
    const carried = await Promise.all(given.map(async i => (await provenance()).cameThroughGate(i.id, p.id)));
    const notYours = given.find((_, i) => !carried[i]);
    if (notYours) return { ok: false, reason: `${LoadoutSystem.shownName(notYours)} did not come through a gate in your own hands. The record says so.` };
    if (inStash().some(i => !i)) return { ok: false, reason: 'That is not in your stash.' };

    const ids = given.map(i => i.id);
    removeFromStash(ids);
    set({ guild: { ...get().guild, trophies: [...get().guild.trophies, ...given] } });
    const { from, to } = usePlayerStore.getState().grantRank(trial.to);
    useRankMoment.getState().show({ from, to, at: Date.now() });
    await get().saveHubState();
    await Ledger.append('GUILD', { kind: 'RANK_GRANTED', from, to, consumedIds: ids });
    await (await provenance()).recordMany(given, 'TRANSFER', { via: 'TRIAL', to });
    return { ok: true };
  },

  handMapToGuild: async (itemId) => {
    const p = usePlayerStore.getState().player;
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'That is not in your stash.' };
    if (item.type !== ItemType.MAP || !item.mapData) return { ok: false, reason: 'The Hall takes maps here. That is not one.' };
    // No await from the check to the map leaving: it goes once.
    removeFromStash([item.id]);
    const guild = get().guild;
    set({ guild: { ...guild, maps: [...guild.maps, { item, handedBy: p.id, handedByName: p.username, at: Date.now() }] } });
    await get().saveHubState();
    await Ledger.append('GUILD', { kind: 'MAP_HANDED_IN', itemId: item.id, worldId: item.mapData.worldId, consumedIds: [item.id] });
    await (await provenance()).record(item, 'TRANSFER', { via: 'HANDED_TO_GUILD' });
    return { ok: true };
  },

  hubDoc: () => {
    const { activeHubId, chunks, dismembered, planDeposit, lots, craftingJobs, rooms, buildJobs, web, guild, vendors, craftsmen } = get();
    if (!activeHubId) return null;
    return {
      id: `hub_state_${activeHubId}`,
      namespace: VectorNamespace.TERRITORIES,
      data: JSON.parse(JSON.stringify({ chunks, dismembered, planDeposit, lots, craftingJobs, rooms, buildJobs, web, guild, vendors, craftsmen })),
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    };
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
    // The money, its row and the deed to the lot land as one.
    set({ lots: lots.map(l => l.id === lotId
      ? { ...l, ownerId: p.id, ownerName: p.username, purchaseDate: Date.now(), upkeepPaidThroughDay: worldDay() }
      : l) });
    await GoldCommit.commit({
      rows: [{ type: 'GOLD_DELTA', data: { reason: 'LOT_PURCHASE', lotId, amount: -lot.price, treasuryId: activeHubId, treasuryDelta: lot.price } }],
      treasury: { worldUid: activeHubId, delta: lot.price },
      hubDoc: get().hubDoc() ?? undefined
    });

    console.log(`[LOT] Lot ${lot.lotIndex} purchased for ${lot.price}G.`);
    return true;
  },

  /**
   * Wave 10 (D8): raise a shell on a lot you own. The permit is gold (to the
   * treasury); the walls are materials, consumed from the stash exactly once,
   * at queue time; the building finishes on the clock (resolveBuilds).
   */
  shellBillNow: (type, stationId) => {
    const { lots, rooms, buildJobs } = get();
    const p = usePlayerStore.getState().player;
    const fitting = stationId ? WebBank.current().stations.find(s => s.id === stationId) : undefined;
    return shellBillFor(type, ownerHasBench(p.id, { lots, rooms, jobs: buildJobs, stash: p.bank.stashTabs[0]?.items || [] }), fitting);
  },

  openStationsNow: () => WebSystem.openStationsOf(get().web, usePlayerStore.getState().player.bank.universalSkills),

  stationRecipesOn: (lotId) => {
    const placed = new Set((get().rooms[lotId]?.placements ?? []).map(p => p.item.universalDefinitionId));
    return WebBank.current().recipes.filter(r => placed.has(r.requiredStation));
  },

  craftRefusal: (lotId, recipeId) => {
    const web = WebBank.recipe(recipeId);
    if (!web) return null;
    const station = WebBank.current().stations.find(s => s.id === web.requiredStation)!;
    const placed = (get().rooms[lotId]?.placements ?? []).some(p => p.item.universalDefinitionId === web.requiredStation);
    if (!placed) return `${web.name} wants a ${station.name} standing in this room.`;
    const skills = usePlayerStore.getState().player.bank.universalSkills;
    if (web.requiresVerb && !WebSystem.hasVerb(skills, web.requiresVerb)) {
      return `${web.name} wants hands that can ${web.requiresVerb.replace(/_/g, ' ')}. Yours can't, yet.`;
    }
    return null;
  },

  craftSecondsNow: (lotId, recipeId) => {
    const recipe = RECIPE_DEFINITIONS[recipeId] ?? WebBank.recipe(recipeId);
    const gear = GEAR_RECIPES[recipeId];
    const labor = recipe?.laborTimeSeconds ?? gear?.laborTimeSeconds ?? 0;
    const inputs = (recipe?.inputs ?? gear?.inputs ?? []).map(i => i.itemId);
    const room = get().rooms[lotId];
    const mono = room ? monoMaterialOf(room) : null;
    const speedPct = ((mono ? setBonusFor(mono)?.craftSpeedPct : 0) || 0) + (room ? roomProcessBonus(room).craftSpeedPct : 0);
    const held = usePlayerStore.getState().player;
    const pair = WebSystem.pairOfJob(recipeId, inputs, held.bank.universalSkills);
    // Line 35: and someone home in this hub who works this material lends the bench their hands.
    const factor = WebSystem.clockFactor(held, pair) * benchFactor(get().guild.residents, pair);
    return Math.max(1, Math.round(labor * (1 - speedPct / 100) * factor * StatSystem.craftClockFactor(held.attributes)));
  },

  restAndCredit: async (kind) => {
    const { emerged: settled } = RestDoor.settle();
    const emerged = settled as ISkillState[];
    void RestDoor.collect();
    for (const skill of emerged) {
      useFeed.getState().push(`It settled: ${WebSystem.nameOf(skill.id)}. The hands know it now.`, 'proof');
    }
    if (kind === 'DIED' && emerged.length > 0) useFeed.getState().push('Dying taught you that much, at least.', 'plain');
    await get().creditHeld();
    return emerged;
  },

  creditHeld: async () => {
    const p = usePlayerStore.getState().player;
    if (!p.id || p.id === 'temp_id') return;
    const { web, firsts, records } = WebSystem.admit(get().web, { uid: p.id, name: p.username }, p.bank.universalSkills, Date.now());
    if (firsts.length === 0 && records.length === 0) return;
    set({ web });
    const hubId = get().activeHubId;
    const lore = { ...usePlayerStore.getState().player.bank.lore };
    for (const skillId of firsts) {
      const name = WebSystem.nameOf(skillId);
      await Ledger.append('TECH', { kind: 'FIRST', skillId, name, hubId, rung: 0 });
      const topic = `First in this hub: ${name}`;
      lore[topic] = lore[topic] ?? { topic, xp: 0, level: 1, dateDiscovered: Date.now() };
      useFeed.getState().push(`First in this hub to reach ${name}. The bank has it signed.`, 'proof');
    }
    for (const { id, rung } of records) {
      await Ledger.append('TECH', { kind: 'RUNG', skillId: id, name: WebSystem.nameOf(id), hubId, rung });
    }
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, lore } } }));
    await get().saveHubState();
  },

  creditMastery: async () => {
    await get().creditHeld();
  },

  buildStructure: async (lotId, type, material, stationId) => {
    const { lots, activeHubId, buildJobs } = get();
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
    // D27: a further bench can be fitted as a station, once a connection has opened it.
    if (stationId) {
      if (type !== 'WORKSHOP') return false;
      const open = get().openStationsNow().some(s => s.id === stationId);
      if (!open) {
        console.log('[BUILD] No hand in this hub has connected that tool and that material yet.');
        return false;
      }
      if (!ownerHasBench(p.id, { lots, rooms: get().rooms, jobs: buildJobs, stash })) {
        console.log('[BUILD] Your first bench comes first. It is raised from what you carried in.');
        return false;
      }
    }
    const bill = pickBill(get().shellBillNow(type, stationId), stash, material);
    if (!bill.ok) {
      console.log(`[BUILD] The bill is short: ${bill.missing}. Bring the materials.`);
      return false;
    }

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
      inherited: inheritedOf(bill.items),
      ...(stationId ? { stationId } : {})
    };
    job.signature = await signRecord({ kind: 'SHELL', lotId, structureType: type, consumedIds: job.consumedIds, at: job.queuedAt, ...(stationId ? { stationId } : {}) });

    // Signed first: from the gold change to its commit there is no await.
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
    removeFromStash(bill.items.map(i => i.id));
    set({ buildJobs: [...get().buildJobs, job] });
    await GoldCommit.commit({
      rows: [
        { type: 'GOLD_DELTA', data: { reason: 'BUILD_PERMIT', lotId, structure: type, amount: -cost, treasuryId: activeHubId, treasuryDelta: cost } },
        { type: 'BUILD', data: { kind: 'SHELL_QUEUED', jobId: job.id, lotId, structure: type, consumedIds: job.consumedIds } }
      ],
      treasury: { worldUid: activeHubId, delta: cost },
      hubDoc: get().hubDoc() ?? undefined
    });
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
    const { lots, activeHubId, buildJobs } = get();
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
    const layout = HubGenerator.generate({ chunks: get().chunks, dismembered: get().dismembered });
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

    // Everything checked: sign the whole batch, then pay once and consume once.
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

    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
    removeFromStash(picked.map(i => i.id));
    set({ buildJobs: [...get().buildJobs, ...jobs] });
    await GoldCommit.commit({
      rows: [
        { type: 'GOLD_DELTA', data: { reason: 'BUILD_PERMIT', lotId, structure: tpl.structureType, template: tpl.name, amount: -cost, treasuryId: activeHubId, treasuryDelta: cost } },
        { type: 'BUILD', data: {
          kind: 'TEMPLATE_APPLIED', lotId, templateItemId, template: tpl.name, authorUid: tpl.authorUid,
          sheet, consumedIds: picked.map(i => i.id), jobs: jobs.length
        } }
      ],
      treasury: { worldUid: activeHubId, delta: cost },
      hubDoc: get().hubDoc() ?? undefined
    });
    console.log(`[BUILD] ${tpl.name} rising on lot ${lot.lotIndex}: ${jobs.length} steps on the clock.`);
    return { ok: true };
  },

  /** Apply every finished construction job: shells stand up, pieces join the room. */
  resolveBuilds: async () => {
    const now = Date.now();
    const due = get().buildJobs.filter(j => !j.applied && j.finishesAt <= now);
    if (due.length === 0) return 0;

    const layout = HubGenerator.generate({ chunks: get().chunks, dismembered: get().dismembered });
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
              materialDefId: job.template!.sheet.zones[z.name] ?? tagDefaultMaterial('building'),
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
        const stationDefId = job.stationId ?? SHELL_STATION[job.structureType];
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
    await get().settleHomes();
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
    const recipe = RECIPE_DEFINITIONS[recipeId] ?? WebBank.recipe(recipeId);
    const gearRecipe = GEAR_RECIPES[recipeId];
    const p = usePlayerStore.getState().player;
    if (!lot || (!recipe && !gearRecipe)) return false;
    // D27: a further station's recipe wants the station standing, and the verb in hand.
    const refusal = get().craftRefusal(lotId, recipeId);
    if (refusal) {
      console.log(`[CRAFT] ${refusal}`);
      useFeed.getState().push(refusal, 'loss');
      return false;
    }
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
      if (!TransformationEngine.canProcess({ } as any, recipe as any, stash)) {
        console.log(`[CRAFT] Missing inputs for ${recipe.name}.`);
        return false;
      }
      consumedIds = TransformationEngine.processCycle(recipe as any, stash, Rng.fromKey(`${jobId}:consume`)).consumedIds;
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
    // D27: and working without the skill takes longer, while knowing it takes less.
    const pair = WebSystem.pairOfJob(recipeId, consumed.map(c => c.defId), p.bank.universalSkills);
    const effectiveSeconds = Math.max(1, Math.round(laborSeconds * (1 - speedPct / 100) * WebSystem.clockFactor(p, pair) * benchFactor(get().guild.residents, pair)));

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
      const recipe = RECIPE_DEFINITIONS[job.recipeId] ?? WebBank.recipe(job.recipeId);
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
      // D27: and the pair itself: the trade and what it worked. It settles at a rest.
      const pair = WebSystem.pairOfJob(job.recipeId, (job.consumed ?? []).map(c => c.defId), usePlayerStore.getState().player.bank.universalSkills);
      if (pair && outputs.length > 0) {
        const worked = Math.max(0, ...outputs.map(o => rankIndexOf(o.rank)));
        usePlayerStore.getState().workOn(pair, worked, PROCESS_SKILL_XP_PER_JOB);
      }
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
   * from the hub treasury, and a hub with no funds prints (D115).
   */
  sellToVendor: async (itemId, npcId = COUNTER_NPC) => {
    const { activeHubId } = get();
    const p = usePlayerStore.getState().player;
    if (!activeHubId) return null;
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!item) return null;

    const offer = StatSystem.vendorOffer(item.value, p.attributes);
    const perDay = runningPerDay(cityOf(get()));
    const prints = printsNeeded(await Treasury.balance(activeHubId), offer, perDay);
    const made = prints * printAmount(perDay);
    if (!(usePlayerStore.getState().player.bank.stashTabs[0]?.items || []).some(i => i.id === itemId)) return null;

    set({ guild: { ...get().guild, printed: printedPlus(get().guild, prints, made) } });
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: {
        ...s.player.bank,
        gold: s.player.bank.gold + offer,
        stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab
        )
      } }
    }));
    await GoldCommit.commit({
      rows: [
        ...printRows(activeHubId, perDay, prints, 'VENDOR_BUYBACK'),
        { type: 'GOLD_DELTA', data: { reason: 'VENDOR_BUYBACK', itemId, defId: item.universalDefinitionId, amount: offer, treasuryId: activeHubId, treasuryDelta: -offer } }
      ],
      treasury: { worldUid: activeHubId, delta: made - offer }
    });
    if (prints > 0) useFeed.getState().push(`The Hall has printed ${made.toLocaleString()} G.`, 'signal');
    // What the counter bought is in its container now. Whether it ever goes on sale is the vendor's call.
    const today = Math.floor(Date.now() / 86_400_000);
    const all = vendorsToday(get().vendors, get().craftsmen, today);
    set({ vendors: { ...all, [npcId]: VendorSystem.receive(all[npcId], item, today) } });
    await get().saveHubState();
    console.log(`[VENDOR] Sold ${item.name} for ${offer}G (treasury-funded).`);
    return offer;
  },

  /** Put a stash item on your VENDOR lot's shelf. */
  listItemForSale: async (lotId, itemId, price, askDefId) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || lot.ownerId !== p.id || lot.structureType !== 'VENDOR') {
      console.log('[SHOP] You need your own VENDOR lot to sell.');
      return false;
    }
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    // D115: a shelf asks for coin or for an anchor. Anything else is only a swap, and that is another door.
    const asked = askDefId ? Anchors.kinds().find(k => k.defId === askDefId) : undefined;
    if (!item || (askDefId ? !asked : price <= 0)) return false;

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab
      ) } }
    }));
    set({ lots: get().lots.map(l => l.id === lotId
      ? { ...l, shopListings: [...(l.shopListings || []), { item, price: asked ? 0 : price, ...(asked ? { ask: asked } : {}) }] }
      : l) });
    await Ledger.append('TRADE', { kind: 'LISTED', lotId, itemId, price: asked ? 0 : price, ...(asked ? { asks: asked.defId } : {}), playerDelta: 0, treasuryDelta: 0 });
    await saveHubState();
    console.log(`[SHOP] Listed ${item.name} for ${price}G.`);
    return true;
  },

  /** Buy from a player's VENDOR lot. Seller gets price minus the hub's cut. */
  buyFromLot: async (lotId, itemId) => {
    const { lots, activeHubId } = get();
    const lot = lots.find(l => l.id === lotId);
    const listing = lot?.shopListings?.find(li => li.item.id === itemId);
    const p = usePlayerStore.getState().player;
    if (!lot || !listing || !activeHubId) return false;

    // D115: priced in an anchor. No coin moves, and so the hub's cut has nothing to be cut from.
    if (listing.ask) {
      const stash = p.bank.stashTabs[0]?.items || [];
      const paidWith = stash.find(i => i.universalDefinitionId === listing.ask!.defId && i.isIdentified !== false);
      if (!paidWith) return false;
      usePlayerStore.setState(s => ({
        player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: [...tab.items.filter(i => i.id !== paidWith.id), listing.item] } : tab
        ) } }
      }));
      set({ lots: get().lots.map(l => l.id === lotId
        ? { ...l, shopListings: (l.shopListings || []).filter(li => li.item.id !== itemId), heldInTrade: [...(l.heldInTrade ?? []), paidWith] }
        : l) });
      await GoldCommit.commit({
        rows: [{ type: 'TRADE', data: { kind: 'SHOP_SALE_FOR_ANCHOR', lotId, itemId, paidWith: paidWith.id, paidWithDef: paidWith.universalDefinitionId, playerDelta: 0, treasuryDelta: 0 } }],
        hubDoc: get().hubDoc() ?? undefined
      });
      const { Provenance } = await import('../../logic/sovereignty/Provenance');
      await Provenance.record(listing.item, 'TRANSFER', { via: 'PLAYER_SHOP', lotId, paidWith: paidWith.id });
      await Provenance.record(paidWith, 'TRANSFER', { via: 'PLAYER_SHOP_ANCHOR', lotId, itemId });
      return true;
    }

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
    set({ lots: get().lots.map(l => l.id === lotId
      ? {
          ...l,
          shopListings: (l.shopListings || []).filter(li => li.item.id !== itemId),
          proceeds: (l.proceeds || 0) + (buyerIsOwner ? 0 : net)
        }
      : l) });
    await GoldCommit.commit({
      rows: [{ type: 'TRADE', data: { kind: 'SHOP_SALE', lotId, itemId, price: listing.price, fee, playerDelta, treasuryDelta: fee } }],
      treasury: { worldUid: activeHubId, delta: fee },
      hubDoc: get().hubDoc() ?? undefined
    });
    // Wave 6.2: ownership change goes on the item's record
    const { Provenance } = await import('../../logic/sovereignty/Provenance');
    await Provenance.record(listing.item, 'TRANSFER', { via: 'PLAYER_SHOP', lotId, price: listing.price, fee });
    console.log(`[SHOP] Bought ${listing.item.name} for ${listing.price}G (hub kept ${fee}G).`);
    return true;
  },

  /** D115: what a shelf took in place of coin, to its owner's stash. */
  collectHeld: async (lotId) => {
    const lot = get().lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    const items = lot?.heldInTrade ?? [];
    if (!lot || lot.ownerId !== p.id || items.length === 0) return 0;
    set({ lots: get().lots.map(l => l.id === lotId ? { ...l, heldInTrade: [] } : l) });
    addToStash(items);
    await get().saveHubState();
    await Ledger.append('TRADE', { kind: 'ANCHORS_COLLECTED', lotId, itemIds: items.map(i => i.id), playerDelta: 0, treasuryDelta: 0 });
    return items.length;
  },

  /** Move a lot's held sale money to its owner's bank. */
  collectProceeds: async (lotId) => {
    const { lots } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    const amount = lot?.proceeds || 0;
    if (!lot || lot.ownerId !== p.id || amount <= 0) return 0;

    set({ lots: get().lots.map(l => l.id === lotId ? { ...l, proceeds: 0 } : l) });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + amount } } }));
    await GoldCommit.commit({
      rows: [{ type: 'GOLD_DELTA', data: { reason: 'SHOP_PROCEEDS', lotId, amount } }],
      hubDoc: get().hubDoc() ?? undefined
    });
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
      // D10: a resident costs gold through higher upkeep, paid by whoever brought them out, to the
      // same treasury by the same row. The Hall holds the deed, so an unpaid one waits and never reverts.
      if (lot.ownerId === GUILD_OWNER_ID) {
        const resident = get().guild.residents.find(r => r.lotId === lot.id);
        if (!resident || resident.sponsorId !== p.id) continue;
        const base = lot.structureType === 'EMPTY' ? EMPTY_LOT_PER_DAY : residentUpkeepPerDay(resident.bond.rank);
        const bonus = StatSystem.upkeepDiscountPct(p.attributes);
        const rate = bonus !== 0 ? Math.max(1, Math.round(base * (1 - bonus / 100))) : base;
        const cost = rate * owed;
        if (usePlayerStore.getState().player.bank.gold < cost) continue;
        usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
        set({ lots: get().lots.map(l => l.id === lot.id ? { ...l, upkeepPaidThroughDay: day } : l) });
        await GoldCommit.commit({
          rows: [{ type: 'UPKEEP', data: { lotId: lot.id, residentId: resident.id, days: owed, amount: cost, treasuryId: activeHubId } }],
          treasury: { worldUid: activeHubId, delta: cost },
          hubDoc: get().hubDoc() ?? undefined
        });
        continue;
      }
      if (lot.ownerId === p.id) await get().collectProceeds(lot.id);
      changed = true;

      let rate = lot.structureType === 'EMPTY' ? EMPTY_LOT_PER_DAY : STRUCTURE_COSTS[lot.structureType].upkeepPerDay;
      // Wave 10D (D13's numbers): a mono-material house stands cheaper.
      const lotRoom = get().rooms[lot.id];
      const mono = lotRoom ? monoMaterialOf(lotRoom) : null;
      // D26: and what is worked into the walls and the furniture acts here, studied or not.
      const discount = ((mono ? setBonusFor(mono)?.upkeepDiscountPct : 0) || 0) + (lotRoom ? roomProcessBonus(lotRoom).upkeepDiscountPct : 0)
        + (lot.ownerId === p.id ? StatSystem.upkeepDiscountPct(p.attributes) : 0);
      if (discount !== 0) rate = Math.max(1, Math.round(rate * (1 - discount / 100)));
      const cost = rate * owed;
      const isLocal = lot.ownerId === p.id;
      const canPay = isLocal && usePlayerStore.getState().player.bank.gold >= cost;

      if (canPay) {
        usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
        set({ lots: get().lots.map(l => l.id === lot.id ? { ...l, upkeepPaidThroughDay: day } : l) });
        await GoldCommit.commit({
          rows: [{ type: 'UPKEEP', data: { lotId: lot.id, days: owed, amount: cost, treasuryId: activeHubId } }],
          treasury: { worldUid: activeHubId, delta: cost },
          hubDoc: get().hubDoc() ?? undefined
        });
        console.log(`[UPKEEP] Lot ${lot.lotIndex}: paid ${cost}G for ${owed} day(s).`);
      } else {
        // Reverted: listings, lot inventory and everything placed in the room
        // return to the (local) owner. A placed item is never lost (Wave 10).
        const room = get().rooms[lot.id];
        if (isLocal) {
          const refund = [
            ...(lot.shopListings || []).map(li => li.item),
            ...lot.inventory,
            ...(lot.heldInTrade ?? []),
            ...(room?.placements.map(pl => pl.item) ?? [])
          ];
          if (refund.length > 0) addToStash(refund);
        }
        await Ledger.append('TRADE', { kind: 'LOT_REVERTED', lotId: lot.id, daysUnpaid: owed, playerDelta: 0, treasuryDelta: 0 });
        const { [lot.id]: _gone, ...keptRooms } = get().rooms;
        set({
          lots: get().lots.map(l => l.id === lot.id
            ? { ...l, ownerId: null, ownerName: null, purchaseDate: null, structureType: 'EMPTY', shopListings: [], inventory: [], heldInTrade: [], upkeepPaidThroughDay: undefined }
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
    const vendors = vendorsToday(get().vendors, get().craftsmen, dayIndex);
    const shelfOf = (npcId: string, rolled: IShopListing[]) =>
      VendorSystem.shelf(vendors[npcId], rolled, dayIndex, ApprenticeRoad.labor(get().craftsmen, npcId));
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
      vendors,
      weaponShop: shelfOf(SHOP_VENDOR.weapon, [
        ...generateStock(UniversalRank.F, 5, 'weapon'),
        ...generateStock(UniversalRank.E, 2, 'weapon'),
        // Field tools ride in the weapon shop until lots get their own vendors (Wave 5)
        // The harvesting tools are always on the shelf, or a resource could be out of reach for a day
        ...generateStock(UniversalRank.F, 3, 'tool', SHELF.tools),
        // Wave 10C (D16/D17): the carrier's shelf — the cart and the pouches
        ...generateStock(UniversalRank.F, 3, 'tool', SHELF.carrier, 'carrier'),
        // D27: every tool a web batch added is on the shelf, by its own keyed stream, so no older roll moves
        ...WebBank.current().tools.filter(t => !t.existing).map(tool => {
          const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:web_tool:${tool.id}`);
          const item = WebBank.mintTool(WebBank.current(), tool.id, rng);
          return { id: `listing_web_${tool.id}`, item, price: item.value * 1.5, vendorId: 'vendor_sys', stock: rng.int(1, 4) };
        })
      ]),
      armorShop: shelfOf(SHOP_VENDOR.armor, [
        ...generateStock(UniversalRank.F, 5, 'armor'),
        ...generateStock(UniversalRank.E, 2, 'armor'),
        // Wave 10C: the slot tree gets its wardrobe — one of each new branch,
        // always on the shelf, and the SHOULDER piece themed to this hub's genre
        ...generateStock(UniversalRank.F, SHELF.wardrobe.length, 'armor', SHELF.wardrobe, 'tree')
      ]),
      // Wave 10B: the gallpod joins the shelf — the alchemist sells the ink's bitter half.
      consumableShop: shelfOf(SHOP_VENDOR.consumable, [
        // D27: a raw material a web batch added reaches play through this shelf, with no code
        ...WebBank.current().materials.filter(m => m.shelfPrice).map(material => {
          const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:web_material:${material.id}`);
          const item = ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[material.id] as any, rng, { origin: 'PURCHASE' });
          return { id: `listing_web_${material.id}`, item, price: material.shelfPrice!, vendorId: 'vendor_sys', stock: rng.int(3, 10) };
        }),
        ...SHELF.consumables.map((defId, i) => {
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
      ])
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
    const price = Math.ceil(StatSystem.shopPrice(listing.price, playerStore.player.attributes));
    if (playerStore.player.bank.gold < price) return null;

    // Wave 10D: each unit sold is its OWN mint, deterministically keyed by the
    // listing and its remaining stock (the old crypto.randomUUID was a
    // determinism leak), with PURCHASE on its record. Rolled gear goes through
    // the bank's registry (D18): the shelf shows the pattern; every unit stands
    // on its own rung, the display item keeping the first claim.
    const npcId = SHOP_VENDOR[shop];
    const today = Math.floor(Date.now() / 86_400_000);
    const seller = vendorsToday(state.vendors, state.craftsmen, today)[npcId];
    const soldToday = seller.sold.lines[listingId] ?? 0;
    // Keyed by the day and what has gone from this line, so no two units ever share an id
    const unitRng = Rng.fromKey(`purchase:${get().activeHubId || 'hub_unknown'}:${listingId}:${today}:unit:${soldToday}`);
    const unit: IItem = {
      ...listing.item,
      id: `itm_${unitRng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${unitRng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      composition: CompositionSystem.root({ id: listing.item.universalDefinitionId, name: listing.item.name }, 'PURCHASE')
    };
    // What the vendor bought in is the same piece going out: it keeps its id and its story
    const purchasedItem = listing.held ? listing.item : unit.type === ItemType.GEAR ? MintRegistry.claim(unit) : unit;

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
    void GoldCommit.commit({
      rows: [{ type: 'GOLD_DELTA', data: { reason: 'SHOP_PURCHASE', itemId: purchasedItem.id, defId: purchasedItem.universalDefinitionId, amount: -price, treasuryId: hubId, treasuryDelta: price } }],
      treasury: { worldUid: hubId, delta: price }
    });

    const updatedListings = listings
      .map(l => l.id === listingId ? { ...l, stock: l.stock - 1 } : l)
      .filter(l => !(l.held && l.stock <= 0));
    const total = listings.reduce((sum, l) => sum + l.stock, 0);
    const left = updatedListings.reduce((sum, l) => sum + l.stock, 0);
    const sold = listing.held ? VendorSystem.takeOwn(seller, purchasedItem.id) : seller;

    set({
      [shopKey]: updatedListings,
      vendors: { ...vendorsToday(state.vendors, state.craftsmen, today), [npcId]: VendorSystem.recordSale(sold, listingId, today, total > 0 ? left / total : 0, purchasedItem.universalDefinitionId) }
    });
    // The next of this kind takes that row's place
    if (listing.held) get().generateDailyStock();
    void get().saveHubState();
    return purchasedItem;
  }
}));
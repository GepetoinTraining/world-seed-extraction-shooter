/**
 * Hub Store - Manages persistent hub state
 * REFACTORED: Removes mock data, loads from Vector/DB State
 */

import { GameClock } from '../../logic/time/GameClock';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { create } from 'zustand';
import { IAffix, IComposition, IHubWeb, IItem, ISkillState, IWebRecipe, IWebStation, ItemType, Rarity, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { CRAFTED_GEAR_BASES } from '../item/data/itemDefinitions';
import { VectorStore, VectorNamespace, IVectorDocument } from '../data/VectorStore';
import { HubGenerator, HUB_NPCS, IHubLayout, IPOI } from './HubGenerator';
import { HubSide, IDismemberment, IRaisedChunk, chunkBillFor, dismemberPlan, firstPlan, raiseChunk } from './hubManifest';
import { Farm, IFarmland, emptyFarmland } from './farm';
import { Herd } from './herd';
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
import { bankAndSignAffixes, bankAndSignWeb } from '../../logic/content/BankSigning';
import { WebSystem, rankIndexOf } from '../../logic/systems/WebSystem'; // D27: the technology web
import { StatSystem } from '../../logic/systems/StatSystem';
import { useFeed, useRankMoment } from '../../components/ui/stores';
import { NpcSheet } from '../../logic/systems/NpcSheet';
import { ProgressionSystem } from '../player/systems/ProgressionSystem';
import {
  GUILD_OWNER_ID, IBuildingAsk, IGuildState, IResident, IResidentQuest, PAY_SHARE, benchFactor, bondItemOf, emptyGuild, guildFrom, guildHouseCost, houseBill, houseTemplateFor, houseTemplateNamed,
  mayHaveGround, questPay, readSheet, residentIdOf, residentUpkeepPerDay, trialFor, trialTakes, wantFor, wantMayTake,
  FED, agendaOf, livingPerDay, residentRung, residentWagePerDay, residentWorks
} from './guild';
import { EMPTY_LOT_PER_DAY, IRunningBook, ITaxLine, PRINT_DAYS, foldDays, keeperBrought, npcRank, printAmount, printsNeeded, residentFacts, runningBook, runningPerDay, taxBook, walletBrought } from './money';
import { DEAL_DAYS, IShopWeekLine, ShopWeek } from '../../logic/economy/ShopWeek';
import { Wallets } from '../../logic/economy/Wallets';
import { Anchors } from '../../logic/economy/Anchors';

import { IBinPiece, IVendorRecord, IWorkEvent, VendorSystem } from '../../logic/systems/VendorSystem';
import { ApprenticeRoad, ICraftsman, generalKeepers } from '../../logic/systems/ApprenticeRoad';
import { SalvageSystem, workTools } from '../../logic/systems/SalvageSystem';
import { INeedFill, NpcAgenda } from '../../logic/systems/NpcAgenda';
import { Deeds } from '../../logic/memory/Deeds';
import { LadderWeight } from '../../logic/memory/MemoryLaw';
import { bothRemember, IMemoryWrite, MemoryStore } from '../interaction/memoryStore';
import type { IMeeting } from '../../logic/systems/MeetDoor';
import { PersonLedger } from '../../logic/people/PersonLedger';
import type { IPersonAct } from '../../logic/people/PersonChain';

/** What people did, onto their own chains (PersonChain.ts). Nobody signed in, nothing written. */
type IAct = { npcId: string; act: Exclude<IPersonAct, { kind: 'MINTED' }> };
const chainActs = (hubId: string, acts: IAct[]) => PersonLedger.actMany(hubId, acts);

/**
 * Meetings nobody watched go to the queue, to be talked through in a batch (MeetDoor). It reads this
 * store, so it is loaded when it is first needed rather than at the top.
 */
const queueMeetings = async (hubId: string, meetings: IMeeting[]): Promise<void> => {
  if (meetings.length === 0) return;
  const { MeetDoor } = await import('../../logic/systems/MeetDoor');
  await MeetDoor.queue(hubId, meetings);
};
import { TalkLaw } from '../../logic/systems/TalkLaw';
import { IQuestWords } from '../../logic/systems/TalkTypes';
import { IHubTech, emptyTech, hubStations, normalTech, openedChainStations } from './hubTech';
import { ITechDoors, settleSilently, techDoors } from './techDoors';

const provenance = async () => (await import('../../logic/sovereignty/Provenance')).Provenance;

/** Whose shelf each shop window is, and whose counter buys. */
const SHOP_VENDOR = { weapon: 'npc_weapon_vendor', armor: 'npc_armor_vendor', consumable: 'npc_alchemist' } as const;
/** Q20: who feeds a person. At the tavern its keeper does; home, the keeper whose shelf sells what is eaten. */
const TAVERN_KEEPER = 'npc_bartender';
const feederOf = (resident: Pick<IResident, 'homeAt'>): string => resident.homeAt ? SHOP_VENDOR.consumable : TAVERN_KEEPER;
const COUNTER_NPC = SHOP_VENDOR.weapon;
/** What taking someone on and seeing them through give a vendor. Guesses until Wave 12. */
const VENDOR_BELONGING_PER_TAKEN = 10;
const VENDOR_ESTEEM_PER_RAISED = 20;

/** Every piece the city holds, and whoever stands in it: what the market cap is taken over. Only the person here is known to a client. */
const marketItems = (s: Pick<HubState, 'lots' | 'rooms' | 'vendors' | 'guild'>): IItem[] => {
  const bank = usePlayerStore.getState().player.bank;
  return [
    ...s.lots.flatMap(l => [...l.inventory, ...(l.shopListings ?? []).map(li => li.item), ...(l.heldInTrade ?? [])]),
    ...Object.values(s.rooms).flatMap(r => r.placements.map(p => p.item)),
    // Parts and the bargain bin are salvage's, and it and the web's value are disconnected systems
    ...Object.values(s.vendors).flatMap(v => [...(v.held ?? []), ...(v.listed ?? [])]),
    ...s.guild.trophies,
    ...s.guild.residents.flatMap(r => r.belongings ?? []),
    ...bank.stashTabs.flatMap(t => t.items),
    ...(usePlayerStore.getState().player.equipment?.items ?? [])
  ];
};

/** D115: each unit left on a line, on a timed deal. What it would come apart into sets how low the deal may go. */
const binLine = (line: IShopListing, npcId: string, week: number | string, until: number): IBinPiece[] => {
  const pieces: IBinPiece[] = [];
  for (let i = 0; i < line.stock; i++) {
    const item = { ...line.item, id: `${line.item.id}_${week}_${i}` };
    const came = SalvageSystem.components(item, `${npcId}:salvage:${item.id}`);
    if (!came) continue;
    const worth = came.reduce((sum, part) => sum + (part.value || 0), 0);
    const price = ShopWeek.binPrice(item.value, worth);
    // Worth more apart than a deal could ask: no bargain, and this line's unit is simply not carried over
    if (price < line.price) pieces.push({ item, ask: line.price, worth, price, until });
  }
  return pieces;
};

const binLoss = (pieces: IBinPiece[]) => pieces.reduce((sum, piece) => sum + ShopWeek.lossOf(piece.ask, piece.worth), 0);

/** A shelf is rolled afresh only when its week or its stock moves, so reading the same one twice costs nothing. */
const shelfLossSeen = new WeakMap<IShopListing[], number>();
const shelfLoss = (lines: IShopListing[]): number => {
  const seen = shelfLossSeen.get(lines);
  if (seen !== undefined) return seen;
  const loss = lines.filter(l => !l.held).reduce((sum, line) => sum + binLoss(binLine(line, 'expected', 'expected', 0)), 0);
  shelfLossSeen.set(lines, loss);
  return loss;
};

const SHELF_OF = { [SHOP_VENDOR.weapon]: 'weaponShop', [SHOP_VENDOR.armor]: 'armorShop', [SHOP_VENDOR.consumable]: 'consumableShop' } as const;

/** Who is paid at this keeper's bench, and what. A master has a shop of their own. */
const benchPay = (craftsmen: ICraftsman[], npcId: string): { deltas: Record<string, number>; total: number } => {
  const deltas: Record<string, number> = {};
  for (const person of craftsmen) {
    if (person.masterId === npcId && person.rank !== 'MASTER') deltas[residentIdOf(person.bond)] = ShopWeek.apprenticePay(person.bond.rank);
  }
  return { deltas, total: Object.values(deltas).reduce((sum, n) => sum + n, 0) };
};

/** What the shops' week comes to as they stand, if nobody comes: the shelves coming apart, and their people. */
const weekCostOf = (s: Pick<HubState, 'weaponShop' | 'armorShop' | 'consumableShop' | 'craftsmen' | 'vendors'>): number =>
  Object.entries(SHELF_OF).reduce((sum, [npcId, shelf]) => sum + shelfLoss(s[shelf]) + binLoss(s.vendors[npcId]?.bin ?? []) + benchPay(s.craftsmen, npcId).total, 0);

/** What a listing costs: a shelf's price by the buyer's attributes, a deal's as it stands, so no discount takes it under its components. */
export const priceOfListing = (listing: Pick<IShopListing, 'price' | 'deal'>, attributes: Parameters<typeof StatSystem.shopPrice>[1]): number =>
  listing.deal ? listing.price : Math.ceil(StatSystem.shopPrice(listing.price, attributes));

/** What the running cost reads: the city as it stands, its web, what is in it, and its shops. */
const cityOf = (s: Pick<HubState, 'chunks' | 'dismembered' | 'lots' | 'web' | 'rooms' | 'vendors' | 'guild' | 'weaponShop' | 'armorShop' | 'consumableShop' | 'craftsmen'>) =>
  ({
    layout: HubGenerator.generate({ chunks: s.chunks, dismembered: s.dismembered }), lots: s.lots, web: s.web, items: marketItems(s), weekCost: weekCostOf(s),
    workers: s.guild.residents.filter(residentWorks).map(r => ({ who: r.id, name: `${r.name}'s work`, perDay: residentWagePerDay(r.bond.rank) }))
  });

/** D115: one signed row per print, each of them 14 days of what the hub runs on. */
const printRows = (hubId: string, perDay: number, prints: number, why: string): { type: 'PRINT'; data: Record<string, any> }[] =>
  Array.from({ length: prints }, () => ({ type: 'PRINT' as const, data: { hubId, amount: printAmount(perDay), perDay, days: PRINT_DAYS, why } }));

const printedPlus = (guild: IGuildState, prints: number, made: number): IGuildState['printed'] =>
  ({ count: guild.printed.count + prints, total: guild.printed.total + made });

/**
 * Days and weeks fold one at a time. Found by playing: the city opened twice at once (a dev
 * render runs the hub's door twice) and paid the same week's close twice. A second fold waits
 * on the first and then finds nothing left to fold.
 */
let folding: Promise<void> = Promise.resolve();
const foldInTurn = (fold: () => Promise<void>): Promise<void> => (folding = folding.then(fold, fold));

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
  structureType: 'EMPTY' | 'VENDOR' | 'WORKSHOP' | 'HOUSE' | 'FARM';
  inventory: IItem[];
  price: number;
  // Wave 5.3: a VENDOR lot's storefront
  shopListings?: { item: IItem; price: number; ask?: { defId: string; name: string } }[];
  // D115: anchors a shelf took in place of coin, held until its owner collects them
  heldInTrade?: IItem[];
  // D115: the week its general tax is paid through. Unset: it owes from the week now open.
  taxPaidWeek?: number;
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
/** The game's day (D135): the Unix day, read from the game's clock and not the browser's. */
export const worldDay = () => GameClock.day();

/** The one thing anyone can ask to have raised that is not a station on the web. */
const BUILDING_HOUSE = 'house';

/** What an ask's word reads as to a person: a station's own name, never its id. */
export const buildingLabel = (word: string): string =>
  hubStations(useHubStore.getState().tech).find(s => s.id === word)?.name ?? word.replace(/_/g, ' ');

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
  /** D91: raised for a person, so nothing is minted into whoever paid for it. */
  workshopId?: string;
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
  structureType: poi.metadata.farmland ? 'FARM' : 'EMPTY',
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
  /** In the bargain bin: its price is the deal's, and this is the day it ends. */
  deal?: { until: number };
  /** Q32: a line kept over a close, and the day it went on the shelf. */
  stocked?: number;
  /** What the line asks before the keeper's factor. */
  ask?: number;
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

interface HubState extends ITechDoors {
  activeHubId: string | null;
  /** D74: what has risen, in order. The first is the middle one. */
  chunks: IRaisedChunk[];
  /** D65, D11: what the hub's farmland holds: plots at work, herds at home, and their registers. The law is farm.ts and herd.ts. */
  farmland: IFarmland;
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
  /** D116: a person's quest, in their words, on the Hall's board. One open at a time. */
  postTalkQuest: (askerId: string, askerName: string, rank: UniversalRank, want: string, words: IQuestWords) => Promise<void>;
  /** D116: what a person can ask to have built. C5 widens this as the hub's tech does. */
  buildingWords: () => string[];
  openBuildingAsks: () => IBuildingAsk[];
  askForBuilding: (askerId: string, askerName: string, building: string, goal: string, need: string) => Promise<void>;
  /** C5's door: an ask has been answered. */
  meetBuildingAsk: (askId: string, metBy: string) => Promise<void>;
  /**
   * Pedro: "those NPC are the tech web, they can use the full aggregate you built and not make you
   * walk around". Everything the city center can reach, whoever in the hub built it. A counter that
   * sells this as a service reads it here, and that charge is where the city taxes.
   */
  centerReach: () => { skills: string[]; stations: IWebStation[] };
  /** The vendors and the people at their benches, up to today. Time away counts. */
  resolveVendors: (simDay?: number) => Promise<void>;
  /** A general vendor takes on someone lodged at the tavern (D75's door), who has no ground yet. */
  takeApprentice: (npcId: string, residentId: string) => Promise<RoomVerdict>;
  /** A master's own shelf, as this person sees it. */
  traderShelf: (traderId: string) => IShopListing[];
  buyFromTrader: (traderId: string, listingId: string) => Promise<IItem | null>;
  /** D74: one chunk more, on the given side of one standing (the first, unless named). It decides nothing about who pays. */
  raiseChunk: (side: HubSide, beside?: { cx: number; cy: number }, kind?: string) => Promise<RoomVerdict>;
  /** D73: give what you hold toward the next chunk, at the Land Office. Items are gone once given. */
  depositToPlan: (tag: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** D73: spend the deposit and raise the next chunk, where the plan chose. */
  planRaise: (side: HubSide, beside?: { cx: number; cy: number }, kind?: string) => Promise<RoomVerdict>;
  /** A hub's lot records against what its plan now lays out. */
  settleLots: () => void;
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
  /** Each building's upkeep, the shops' week, and the web per tile. */
  runningBook: () => IRunningBook;
  /** D115: who holds what outside the centre, and what they pay a week. */
  taxBook: () => { techPerTile: number; lots: ITaxLine[] };
  /** D115: the weeks gone by: each shop's book settled with the guild, wages paid, the general tax collected. */
  closeWeeks: (day: number) => Promise<void>;
  /** Q39: midnight while the person stays in the city. Each fold finds what is left to do, so a second call does nothing. */
  turnTheDay: () => Promise<void>;
  /** What this counter pays for this piece: more for a kind it has seen selling. */
  offerFor: (item: IItem, npcId?: string) => number;
  /** D8: give what you hold toward someone's house. When the bill is met, the clock starts. */
  poolToHouse: (residentId: string, tag: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** A house finished: the person is home, and their skills join the hub's web. */
  settleHomes: () => Promise<void>;
  /** D73: what the people at home want today goes on the board. Q19: it answers the rung they stand on. */
  resolveWants: (simDay?: number) => Promise<void>;
  /** Q20: each day a person lives here, their own wallet pays for it, to whoever feeds them. What it cannot pay, they go without. */
  resolveLiving: (simDay?: number) => Promise<void>;
  /** Q19: the goal a talk set, kept on the person, for the board and the city to read. */
  noteResidentGoal: (residentId: string, goal: { need: string; text: string; setAt: number }) => Promise<void>;
  /** What meetings did to people's needs (MeetLaw): a talk that sat well fills belonging, one that sat badly takes it. */
  fillAgendas: (fills: Record<string, INeedFill>) => Promise<void>;
  /** A want met: the things go to their house, and the hub's treasury pays. */
  fulfilQuest: (questId: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** D83: the hard quest. The one door a rank comes through. */
  passTrial: (itemIds: string[]) => Promise<RoomVerdict>;
  /** D93: a map handed to the guild. It is kept whole, and what it would post can be read. */
  handMapToGuild: (itemId: string) => Promise<RoomVerdict>;
  /** The hub as a document, for a commit that changes it along with gold. */
  hubDoc: () => IVectorDocument | null;
  /** D91, D119: the buildings people want and what the web has reached. The law is in hubTech.ts. */
  tech: IHubTech;

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
  farmland: emptyFarmland(),
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
  tech: emptyTech(),
  ...techDoors(set as never, get as never, { removeFromStash, dominantDefId, signRecord }),
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
      const hubStateDoc = await VectorStore.get<{ vendors?: Record<string, IVendorRecord>; craftsmen?: ICraftsman[]; farmland?: IFarmland; chunks?: IRaisedChunk[]; dismembered?: IDismemberment[]; planDeposit?: Record<string, number>; lots: IPlayerLot[]; craftingJobs?: ICraftJob[]; rooms?: Record<string, IRoomState>; buildJobs?: IBuildJob[]; web?: IHubWeb; guild?: IGuildState; tech?: Partial<IHubTech> }>(
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
          guild: guildFrom(hubStateDoc.data.guild),
          farmland: { ...emptyFarmland(), ...hubStateDoc.data.farmland },
          tech: normalTech(hubStateDoc.data.tech)
        });
      } else {
        // GENERATE FRESH (First time this Hub is visited)
        console.log('[HUB] No state found. Generating fresh layout...');
        
        // The manifest says where the lots stand
        const chunks = firstPlan().chunks;
        set({ chunks, dismembered: [], planDeposit: {}, lots: lotsFor([], HubGenerator.generate({ chunks })), web: { nodes: {} }, guild: emptyGuild(), tech: emptyTech(), vendors: {}, craftsmen: [], farmland: emptyFarmland() });
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
      void bankAndSignAffixes(signer);
      void bankAndSignWeb(signer);

      // 2. Generate/Load Shop Stock (Simulated Daily Refresh)
      // In a real app, this would be server-side. Here we simulate it.
      get().generateDailyStock();

      // D115: 14 days of what it runs on. A hub already endowed keeps what it holds.
      await Treasury.endow(hubWorldUid, printAmount(runningPerDay(cityOf(get()))));
      await get().settleWallets();
      await get().resolveRunning();
      await get().resolveLiving();

      // 3. Wave 5 / Wave 10: resolve what time finished while nobody watched
      await get().resolveVendors();
      await get().resolveCrafts();
      await get().resolveBuilds();
      await get().resolveUpkeep();
      // D27: whatever this person already holds enters this hub's web when the hub looks.
      await get().creditHeld();
      await get().resolveWants();
      // What was already reached is known again, and a station raised while away counts.
      await get().settleWorkshops();
      void get().resolveChains();

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

  taxBook: () => taxBook(cityOf(get())),

  offerFor: (item, npcId = COUNTER_NPC) => {
    const offer = StatSystem.vendorOffer(item.value, usePlayerStore.getState().player.attributes);
    const asked = Math.ceil(offer * VendorSystem.choiceFactor(get().vendors[npcId], item.universalDefinitionId, worldDay()));
    // Bought from a bargain bin: the counter pays no more than the deal did, or a bin and a counter would print coin for anyone standing between them
    return item.binPrice !== undefined ? Math.min(asked, item.binPrice) : asked;
  },

  closeWeeks: async (day) => {
    const target = ShopWeek.weekOf(day);
    for (;;) {
      const { activeHubId, guild } = get();
      if (!activeHubId) return;
      if (guild.week === undefined) {
        // Q33: the opening shelf counts its stock days from the day the hub opened
        set({ guild: { ...guild, week: target, weekFrom: day } });
        await get().saveHubState();
        return;
      }
      if (guild.week >= target) return;
      const week = guild.week;
      // The week's last day: what ran out on a deal has come apart, and is on its keeper's book.
      const closeDay = (week + 1) * ShopWeek.WEEK_DAYS;
      await get().resolveVendors(closeDay);
      const balance = await Treasury.balance(activeHubId);

      // The treasury's read was the only wait. From here to the commit there is none.
      const state = get();
      const vendors = vendorsToday(state.vendors, state.craftsmen, closeDay);
      // Q32: a line goes on a deal only once it has sat its stock days, by its rank and rarity, from the day it went up
      const stockedFrom = state.guild.weekFrom ?? week * ShopWeek.WEEK_DAYS;
      const due = (line: IShopListing) => closeDay - (line.stocked ?? stockedFrom) >= ShopWeek.stockDays(line.item.rank, line.item.rarity);
      const deltas: Record<string, number> = {};
      const add = (who: string, amount: number) => { deltas[who] = (deltas[who] ?? 0) + amount; };
      const shops: IShopWeekLine[] = [];
      for (const [npcId, shelf] of Object.entries(SHELF_OF)) {
        const record = vendors[npcId];
        const left = state[shelf].filter(l => !l.held && l.stock > 0);
        const unsold = left.filter(due).flatMap(line => binLine(line, npcId, week, closeDay + DEAL_DAYS));
        const kept: IShopListing[] = left.filter(l => !due(l)).map(l => ({
          id: l.id.startsWith('listing_kept_') ? l.id : `listing_kept_w${week}_${l.id}`,
          item: l.item, price: l.ask ?? l.price, vendorId: npcId, stock: l.stock, stocked: l.stocked ?? stockedFrom
        }));
        const book = record.book;
        const pay = benchPay(state.craftsmen, npcId);
        const settled = ShopWeek.settle(book, pay.total);
        for (const [who, amount] of Object.entries(pay.deltas)) add(who, amount);
        if (settled.toKeeper > 0) add(npcId, settled.toKeeper);
        shops.push({ npcId, ...book, pay: pay.total, ...settled });
        vendors[npcId] = VendorSystem.closeWeek(record, closeDay, unsold, kept);
      }
      const paidOut = shops.reduce((sum, s) => sum + s.pay + s.toKeeper, 0);

      // The general tax: everyone but the centre. Whoever cannot pay it in full owes it still, and keeps their ground.
      const taxRows: { type: 'GOLD_DELTA' | 'TRADE'; data: Record<string, any> }[] = [];
      const me = usePlayerStore.getState().player;
      let gold = me.bank.gold;
      let taxIn = 0;
      let lots = state.lots;
      for (const line of taxBook(cityOf(state)).lots) {
        const lot = lots.find(l => l.id === line.lotId)!;
        const owed = line.perWeek * (week - (lot.taxPaidWeek ?? week - 1));
        const resident = lot.ownerId === GUILD_OWNER_ID ? state.guild.residents.find(r => r.lotId === lot.id) : undefined;
        const held = lot.ownerId === me.id ? gold : resident ? (state.wallets[resident.id] ?? 0) + (deltas[resident.id] ?? 0) : -1;
        if (held < owed) {
          lots = lots.map(l => l.id === lot.id ? { ...l, taxPaidWeek: lot.taxPaidWeek ?? week - 1 } : l);
          continue;
        }
        if (owed > 0) {
          taxIn += owed;
          if (resident) {
            add(resident.id, -owed);
            taxRows.push({ type: 'TRADE', data: { kind: 'CITY_TAX', week, lotId: lot.id, residentId: resident.id, playerDelta: 0, treasuryDelta: owed, wallets: { [resident.id]: -owed } } });
          } else {
            gold -= owed;
            taxRows.push({ type: 'GOLD_DELTA', data: { reason: 'CITY_TAX', week, lotId: lot.id, tiles: line.tiles, amount: -owed, treasuryId: activeHubId, treasuryDelta: owed } });
          }
        }
        lots = lots.map(l => l.id === lot.id ? { ...l, taxPaidWeek: week } : l);
      }

      const shopDeltas = Object.fromEntries(shops.flatMap(s => [
        ...(s.toKeeper > 0 ? [[s.npcId, s.toKeeper]] : []),
        ...Object.entries(benchPay(state.craftsmen, s.npcId).deltas)
      ]));
      if (gold !== me.bank.gold) usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold } } }));
      set({ vendors, lots, guild: { ...state.guild, week: week + 1, weekFrom: closeDay, lastWeek: { week, shops, tax: taxIn } } });
      // Q31: a print covers the week ahead, so it reads the shelf just stocked
      get().generateDailyStock();
      const { perDay } = runningBook(cityOf(get()));
      const prints = printsNeeded(balance + taxIn, paidOut, perDay);
      const made = prints * printAmount(perDay);
      set({ guild: { ...get().guild, printed: printedPlus(get().guild, prints, made) } });
      await GoldCommit.commit({
        rows: [
          ...taxRows,
          ...printRows(activeHubId, perDay, prints, 'SHOP_WEEK'),
          { type: 'GOLD_DELTA', data: {
            reason: 'SHOP_WEEK', week, amount: 0, loss: shops.reduce((sum, s) => sum + s.loss, 0), shops,
            treasuryId: activeHubId, treasuryDelta: -paidOut, wallets: shopDeltas
          } }
        ],
        treasury: { worldUid: activeHubId, delta: taxIn + made - paidOut },
        wallets: { hubId: activeHubId, deltas },
        hubDoc: get().hubDoc() ?? undefined
      });
      set({ wallets: await Wallets.allOf(activeHubId) });
      if (prints > 0) useFeed.getState().push(`The Hall has printed ${made.toLocaleString()} G.`, 'signal');
    }
  },

  turnTheDay: async () => {
    if (!get().activeHubId) return;
    await get().resolveRunning();
    await get().resolveVendors();
    await get().resolveUpkeep();
    await get().resolveWants();
    get().generateDailyStock();
  },

  settleWallets: async () => {
    const { activeHubId, guild, craftsmen } = get();
    if (!activeHubId) return;
    const people = new Map<string, { name: string; amount: number }>();
    for (const npc of Object.values(HUB_NPCS)) people.set(npc.id, { name: npc.name, amount: keeperBrought(`${activeHubId}:${npc.id}`, npcRank(npc.id)) });
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
    // Pedro: every person of the city is minted as an entity of the hub, on a chain of their own
    await PersonLedger.mintMany(activeHubId, [
      ...Object.values(HUB_NPCS).map(npc => ({ npcId: npc.id, as: 'keeper' as const, name: npc.name, origin: `keeper:${npc.id}` })),
      ...guild.residents.map(r => ({ npcId: residentIdOf(r.bond), as: 'resident' as const, name: r.name, origin: `bond:${r.bond.worldSeed}:${r.bond.entityId}` })),
      ...craftsmen.map(c => ({ npcId: residentIdOf(c.bond), as: 'craftsman' as const, name: c.name, origin: `bond:${c.bond.worldSeed}:${c.bond.entityId}` }))
    ]);
  },

  resolveRunning: (simDay) => foldInTurn(async () => {
    const day = simDay ?? worldDay();
    const { activeHubId, guild } = get();
    if (!activeHubId) return;
    // A hub from before this was kept owes nothing for those days
    if (guild.runningDay === undefined) {
      set({ guild: { ...guild, runningDay: day } });
      await get().saveHubState();
      await get().closeWeeks(day);
      return;
    }
    const days = day - guild.runningDay;
    if (days <= 0) {
      await get().closeWeeks(day);
      return;
    }

    const { lines, floorPerDay, perDay } = runningBook(cityOf(get()));
    const { prints, paid } = foldDays(await Treasury.balance(activeHubId), floorPerDay, days, perDay);
    const deltas: Record<string, number> = {};
    for (const line of lines) deltas[line.who] = (deltas[line.who] ?? 0) + line.amount * days;

    // The treasury's read was the only wait. From here to the commit there is none.
    const made = prints * printAmount(perDay);
    set({ guild: { ...get().guild, runningDay: day, printed: printedPlus(get().guild, prints, made) } });
    await GoldCommit.commit({
      rows: [
        ...printRows(activeHubId, perDay, prints, 'THE_DAYS'),
        { type: 'GOLD_DELTA', data: { reason: 'HUB_RUNNING', amount: 0, days, perDay: floorPerDay, treasuryId: activeHubId, treasuryDelta: -paid, wallets: deltas } }
      ],
      treasury: { worldUid: activeHubId, delta: made - paid },
      wallets: { hubId: activeHubId, deltas },
      hubDoc: get().hubDoc() ?? undefined
    });
    set({ wallets: await Wallets.allOf(activeHubId) });
    if (prints > 0) useFeed.getState().push(`The Hall has printed ${made.toLocaleString()} G.`, 'signal');
    await get().closeWeeks(day);
  }),

  resolveVendors: async (simDay) => {
    await get().settleWallets();
    const { activeHubId, craftsmen, web, guild } = get();
    if (!activeHubId) return;
    const today = simDay ?? worldDay();
    const vendors = vendorsToday(get().vendors, craftsmen, today);
    const keepers = generalKeepers();
    const out: ICraftsman[] = [];
    let residents = guild.residents;
    let nextWeb = web;
    let changed = false;
    // A person on the road is the same body they were at the tavern: their memory keeps that id
    const met: IMemoryWrite[] = [];
    const acts: IAct[] = [];
    const hoursAt = (masterId: string) => vendors[masterId] ? VendorSystem.teachingHours(vendors[masterId]) : 1;
    for (const person of craftsmen) {
      const walked = ApprenticeRoad.resolve(person, today, hoursAt, keepers);
      out.push(walked.craftsman);
      for (const event of walked.events) {
        changed = true;
        if (event.movedTo) {
          if (person.masterId) {
            met.push(...bothRemember(residentIdOf(person.bond), person.masterId, Deeds.movedOn({ day: today, from: person.masterId, craftsman: residentIdOf(person.bond) })));
            acts.push({ npcId: residentIdOf(person.bond), act: { kind: 'MOVED_ON', from: person.masterId } });
          }
          useFeed.getState().push(`${event.name} has finished at one bench and gone on to ${HUB_NPCS[event.movedTo]?.name ?? 'the next'}.`, 'signal');
          continue;
        }
        // Crafting is theirs now, and the hub's web can stand on them
        nextWeb = WebSystem.admit(nextWeb, { uid: person.id, name: person.name }, { [walked.craftsman.skill.id]: walked.craftsman.skill }, Date.now()).web;
        const teacher = walked.craftsman.masterId;
        met.push(...bothRemember(residentIdOf(person.bond), teacher, Deeds.rose({ day: today, master: teacher, craftsman: residentIdOf(person.bond), to: event.to })));
        acts.push({ npcId: residentIdOf(person.bond), act: { kind: 'ROSE', master: teacher, to: event.to } });
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
        met.push(...bothRemember(purse, source, Deeds.boughtParts({ day: today, buyer: purse, seller: source })));
        acts.push({ npcId: purse, act: { kind: 'BOUGHT_PARTS', from: source } });
        partsDeltas[purse] = (partsDeltas[purse] ?? 0) - shared.paid;
        partsDeltas[source] = (partsDeltas[source] ?? 0) + shared.paid;
      }
      vendors[source] = shared.from;
      const worked = VendorSystem.work(shared.to, today, 0, tools);
      vendors[person.id] = worked.record;
      await noted(person.id, worked.events);
    }

    set({ vendors, craftsmen: out, web: nextWeb, guild: { ...get().guild, residents } });
    await MemoryStore.write({ hubId: activeHubId }, met);
    await chainActs(activeHubId, acts);
    // Each of those was two people at one bench, who talked
    await queueMeetings(activeHubId, met.filter((_, i) => i % 2 === 0).map(w => ({
      a: w.owner, b: met[met.indexOf(w) + 1].owner, day: today, where: 'at the bench', why: String(w.what.slots.did ?? 'work at the bench')
    })));
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
    const today = worldDay();
    const keeper = NpcSheet.read(activeHubId, { id: npcId, rank: teaches.rank }, undefined);
    const begun = ApprenticeRoad.begin(bondItemOf(resident), {
      id: npcId, room: ApprenticeRoad.roomFor(keeper.stats!),
      taken: craftsmen.filter(c => c.masterId === npcId && c.rank === 'APPRENTICE').length
    }, resident.sponsorId, resident.sponsorName, today, WebBank.current());
    if (!begun.ok || !begun.craftsman) return { ok: false, reason: begun.reason };
    if (craftsmen.some(c => c.id === begun.craftsman!.id)) return { ok: false, reason: `${begun.craftsman.name} is on the road already.` };

    const all = vendorsToday(vendors, craftsmen, today);
    set({
      guild: {
        ...guild,
        residents: guild.residents.filter(r => r.id !== residentId),
        // At a bench now: what they wanted comes off the board, and what they were brought stays on their record
        quests: guild.quests.filter(q => q.residentId !== residentId || q.state !== 'OPEN')
      },
      craftsmen: [...craftsmen, begun.craftsman],
      vendors: { ...all, [npcId]: { ...all[npcId], agenda: NpcAgenda.fill(all[npcId].agenda, { belonging: VENDOR_BELONGING_PER_TAKEN }) } }
    });
    await Ledger.append('GUILD', { kind: 'PERSON_APPRENTICED', residentId, craftsmanId: begun.craftsman.id, name: begun.craftsman.name, masterId: npcId });
    await MemoryStore.write({ hubId: activeHubId }, bothRemember(npcId, residentId, Deeds.apprenticed({ day: today, master: npcId, apprentice: residentId })));
    await chainActs(activeHubId, [{ npcId: residentId, act: { kind: 'APPRENTICED', master: npcId } }]);
    await queueMeetings(activeHubId, [{ a: npcId, b: residentId, day: today, where: 'at the bench', why: 'being taken on as an apprentice' }]);
    await get().saveHubState();
    return { ok: true };
  },

  traderShelf: (traderId) => {
    const record = get().vendors[traderId];
    if (!record) return [];
    return VendorSystem.shelf(VendorSystem.normal(record), [], worldDay(), 0, usePlayerStore.getState().player.id);
  },

  buyFromTrader: async (traderId, listingId) => {
    const { activeHubId, vendors } = get();
    const row = get().traderShelf(traderId).find(l => l.id === listingId);
    if (!activeHubId || !row || !vendors[traderId]) return null;
    const player = usePlayerStore.getState().player;
    const price = priceOfListing(row, player.attributes);
    if (player.bank.gold < price) return null;
    const today = worldDay();
    const taken = VendorSystem.takeOwn(VendorSystem.normal(vendors[traderId]), row.item.id);
    const boughtItem = row.deal ? { ...row.item, binPrice: price } : row.item;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - price, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
      idx === 0 ? { ...tab, items: [...tab.items, boughtItem] } : tab
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
    set({ vendors: { ...vendors, [traderId]: VendorSystem.recordSale(taken, listingId, today, 1, row.item.universalDefinitionId, price) } });
    await get().saveHubState();
    return boughtItem;
  },

  raiseChunk: async (side, beside, kind) => {
    const raised = raiseChunk({ chunks: get().chunks, dismembered: get().dismembered }, side, { beside, kind });
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

  settleLots: () => {
    set({ lots: lotsFor(get().lots, HubGenerator.generate({ chunks: get().chunks, dismembered: get().dismembered })) });
  },

  planRaise: async (side, beside, kind) => {
    const { chunks, dismembered, planDeposit } = get();
    const bill = chunkBillFor(chunks.length);
    const short = bill.find(line => (planDeposit[line.tag] ?? 0) < line.count);
    if (short) return { ok: false, reason: `The next chunk asks ${short.count} ${short.tag}; the plan holds ${planDeposit[short.tag] ?? 0}.` };
    const can = raiseChunk({ chunks, dismembered }, side, { beside, kind });
    if (!can.ok) return can;
    const spent = { ...planDeposit };
    bill.forEach(line => { spent[line.tag] -= line.count; });
    set({ planDeposit: spent });
    return get().raiseChunk(side, beside, kind);
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
      name: sheet.name, sponsorId: p.id, sponsorName: p.username, arrivedAt: Date.now(), lotId: null, wantsMet: 0,
      agenda: NpcAgenda.fresh(worldDay()), livedDay: worldDay()
    };
    removeFromStash([bond.id]);
    set({ guild: { ...guild, residents: [...guild.residents, resident] } });
    await get().saveHubState();
    await Ledger.append('GUILD', { kind: 'PERSON_LODGED', residentId: id, name: sheet.name, bondItemId: bond.id, consumedIds: [bond.id] });
    await (await provenance()).record(bond, 'TRANSFER', { via: 'REDEEMED', residentId: id });
    await get().settleWallets();
    // They arrive needing things, and that is the way to their ground
    await get().resolveWants();
    return { ok: true };
  },

  guildBuyLot: async (residentId, lotId) => {
    const { activeHubId, chunks, dismembered, guild, lots } = get();
    if (!activeHubId) return { ok: false, reason: 'The Hall is shut.' };
    const resident = guild.residents.find(r => r.id === residentId);
    if (!resident) return { ok: false, reason: 'The Hall has nobody by that name.' };
    if (resident.lotId) return { ok: false, reason: `${resident.name} has ground already.` };
    if (!mayHaveGround(resident)) return { ok: false, reason: `${resident.name} has to be seen to first. What they want is on the board.` };
    const lot = lots.find(l => l.id === lotId);
    if (!lot || lot.ownerId) return { ok: false, reason: 'That ground is not for sale.' };
    if (lot.structureType === 'FARM') return { ok: false, reason: 'That is farmland. A house does not go on it.' };

    const poi = HubGenerator.findPOI(HubGenerator.generate({ chunks, dismembered }), lotId);
    const tpl = poi ? houseTemplateFor({ width: poi.size.width, height: poi.size.height }) : null;
    if (!tpl) return { ok: false, reason: 'No house the Hall knows how to raise fits on that ground.' };
    const asked = guildHouseCost(lot.price);

    // From the checks to the commit there is no wait: the deed and its row land as one.
    set({
      lots: lots.map(l => l.id === lotId
        ? { ...l, ownerId: GUILD_OWNER_ID, ownerName: resident.name, purchaseDate: Date.now(), upkeepPaidThroughDay: worldDay(), inventory: [...l.inventory, ...(resident.belongings ?? [])] }
        : l),
      guild: {
        ...guild,
        residents: guild.residents.map(r => r.id === residentId ? { ...r, lotId, belongings: [], house: { pool: {}, templateName: tpl.name } } : r)
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
    const now = Date.now();
    // Home, they want things again, but no sooner than the day apart a want already met set.
    set({ guild: { ...guild, residents: guild.residents.map(r => due.some(d => d.id === r.id) ? { ...r, homeAt: now, nextWantDay: Math.max(r.nextWantDay ?? worldDay(), worldDay()) } : r) } });
    // A master's house is the shop they came back for, and whoever saw it through is remembered there
    for (const resident of due) {
      if (!resident.craftsmanId || get().vendors[resident.craftsmanId]) continue;
      const opened = VendorSystem.fresh(resident.craftsmanId, 'TRADER', Math.floor(now / 86_400_000));
      set({ vendors: { ...get().vendors, [resident.craftsmanId]: { ...opened, patrons: [usePlayerStore.getState().player.id] } } });
      await Ledger.append('GUILD', { kind: 'SHOP_OPENED', residentId: resident.id, craftsmanId: resident.craftsmanId, name: resident.name, lotId: resident.lotId });
      useFeed.getState().push(`${resident.name} has opened a shop of their own, and you will pay less in it.`, 'proof');
    }
    for (const resident of due) {
      // D119: what they know goes into the web silently, and it opens nothing until the web reaches it.
      set(settleSilently(get().web, get().tech, resident, now));
      await Ledger.append('GUILD', { kind: 'PERSON_HOME', residentId: resident.id, name: resident.name, lotId: resident.lotId });
      useFeed.getState().push(`${resident.name} has left the tavern. There is a door with their name on it now.`, 'proof');
    }
    await get().resolveWants();
    void get().resolveChains();
  },

  resolveWants: async (simDay) => {
    const day = simDay ?? worldDay();
    const { activeHubId, lots } = get();
    if (!activeHubId) return;
    const posted = get().guild.residents.filter(r => {
      // A person wants things from the day they arrive. A master back for a shop wants the shop first.
      if ((r.craftsmanId && !r.homeAt) || (r.nextWantDay ?? day) > day) return false;
      if (get().guild.quests.some(q => q.residentId === r.id && q.state === 'OPEN')) return false;
      // Their house's upkeep is behind: they have bigger worries, until it is paid.
      return (lots.find(l => l.id === r.lotId)?.upkeepPaidThroughDay ?? day) >= day;
    });
    if (posted.length === 0) return;
    // Q19: one want. It answers the rung they stand on, which is the rung their talk's goal answers.
    const quests = posted.map(r => ({
      id: `q_${r.id}_${r.wantsMet}`, residentId: r.id, n: r.wantsMet, state: 'OPEN' as const, postedDay: day,
      ...wantFor(r, readSheet(r), activeHubId, r.wantsMet, residentRung(r, residentFacts(r, get().wallets[r.id] ?? 0), day).need)
    }));
    set({ guild: { ...get().guild, quests: [...get().guild.quests, ...quests] } });
    for (const q of quests) useFeed.getState().push(`On the board at the Hall: ${q.text}`, 'signal');
    // A want put up is a promise to pay for it: the ledger keeps it open until it is brought
    await MemoryStore.write({ hubId: activeHubId }, quests.map(q => ({ owner: q.residentId, what: Deeds.promise({ day, owner: q.residentId, what: q.text, questId: q.id }) })));
    await chainActs(activeHubId, quests.map(q => ({ npcId: q.residentId, act: { kind: 'PROMISED' as const, key: q.id } })));
    await get().saveHubState();
  },

  postTalkQuest: async (askerId, askerName, rank, want, words) => {
    const { guild } = get();
    if (guild.quests.some(q => q.residentId === askerId && q.state === 'OPEN')) return;
    const n = guild.quests.filter(q => q.residentId === askerId).length;
    const quest: IResidentQuest = {
      id: `q_talk_${askerId}_${n}`, residentId: askerId, askerName, n, tag: words.tag, count: TalkLaw.questCount(words.size, rank),
      payShare: PAY_SHARE[want as keyof typeof PAY_SHARE] ?? 1, text: words.text, state: 'OPEN', postedDay: worldDay()
    };
    set({ guild: { ...guild, quests: [...guild.quests, quest] } });
    useFeed.getState().push(`On the board at the Hall: ${quest.text}`, 'signal');
    const hubId = get().activeHubId;
    if (hubId) {
      await MemoryStore.write({ hubId }, [{ owner: askerId, what: Deeds.promise({ day: quest.postedDay, owner: askerId, what: quest.text, questId: quest.id }) }]);
      await chainActs(hubId, [{ npcId: askerId, act: { kind: 'PROMISED', key: quest.id } }]);
    }
    await get().saveHubState();
  },

  resolveLiving: (simDay) => foldInTurn(async () => {
    const day = simDay ?? worldDay();
    const { activeHubId } = get();
    if (!activeHubId) return;
    await get().settleWallets();
    const held = { ...get().wallets };
    const deltas: Record<string, number> = {};
    const paid: { residentId: string; to: string; days: number; amount: number; without: number }[] = [];
    // D109: they walk to whoever feeds them, so both remember it. What it cost weighs on the buyer.
    const met: IMemoryWrite[] = [];
    const talks: IMeeting[] = [];
    const acts: IAct[] = [];
    let changed = false;
    const residents = get().guild.residents.map(r => {
      // A person from before this was kept owes nothing for those days, and stands fed.
      if (r.livedDay === undefined) { changed = true; return { ...r, livedDay: day, agenda: r.agenda ?? NpcAgenda.fresh(day) }; }
      if (r.livedDay >= day) return r;
      changed = true;
      const cost = livingPerDay(r.bond.rank);
      const to = feederOf(r);
      let agenda = r.agenda ?? NpcAgenda.fresh(r.livedDay);
      let days = 0, without = 0;
      for (let d = r.livedDay; d < day; d++) {
        // Pedro: "that's the LITERAL MECHANISM OF MASLOW". What their coin cannot pay for, they go without.
        if ((held[r.id] ?? 0) >= cost) {
          held[r.id] -= cost;
          held[to] = (held[to] ?? 0) + cost;
          deltas[r.id] = (deltas[r.id] ?? 0) - cost;
          deltas[to] = (deltas[to] ?? 0) + cost;
          agenda = NpcAgenda.fold(agenda, d + 1, FED);
          days++;
          met.push(...bothRemember(r.id, to, Deeds.fed({ day: d, buyer: r.id, seller: to, paid: true }), {
            a: LadderWeight.of({ loss: true, after: { agenda, facts: residentFacts(r, held[r.id] ?? 0) } })
          }));
          talks.push({ a: r.id, b: to, day: d, where: 'at the counter', why: 'buying a day of food' });
          acts.push({ npcId: r.id, act: { kind: 'FED', from: to, paid: true, day: d } });
        } else {
          agenda = NpcAgenda.fold(agenda, d + 1);
          without++;
          met.push(...bothRemember(r.id, to, Deeds.fed({ day: d, buyer: r.id, seller: to, paid: false }), {
            a: LadderWeight.of({ loss: true, after: { agenda, facts: residentFacts(r, held[r.id] ?? 0) } })
          }));
          talks.push({ a: r.id, b: to, day: d, where: 'at the counter', why: 'asking for food without the coin to pay' });
          acts.push({ npcId: r.id, act: { kind: 'FED', from: to, paid: false, day: d } });
        }
      }
      paid.push({ residentId: r.id, to, days, amount: days * cost, without });
      return { ...r, agenda, livedDay: day };
    });
    if (!changed) return;
    set({ guild: { ...get().guild, residents } });
    await MemoryStore.write({ hubId: activeHubId }, met);
    await chainActs(activeHubId, acts);
    await queueMeetings(activeHubId, talks);
    if (Object.keys(deltas).length === 0) { await get().saveHubState(); return; }
    await GoldCommit.commit({
      rows: [{ type: 'TRADE', data: { kind: 'RESIDENT_LIVING', day, paid, playerDelta: 0, treasuryDelta: 0, wallets: deltas } }],
      wallets: { hubId: activeHubId, deltas },
      hubDoc: get().hubDoc() ?? undefined
    });
    set({ wallets: await Wallets.allOf(activeHubId) });
  }),

  fillAgendas: async (fills) => {
    const ids = Object.keys(fills);
    if (ids.length === 0) return;
    const { guild, vendors } = get();
    // Filled where they stand, never folded: the day's own fold (resolveLiving) still owes them their meals
    const residents = guild.residents.map(r => fills[r.id] ? { ...r, agenda: NpcAgenda.fill(r.agenda ?? NpcAgenda.fresh(r.livedDay ?? worldDay()), fills[r.id]) } : r);
    const nextVendors = { ...vendors };
    for (const id of ids) if (nextVendors[id]) nextVendors[id] = { ...nextVendors[id], agenda: NpcAgenda.fill(nextVendors[id].agenda, fills[id]) };
    set({ guild: { ...guild, residents }, vendors: nextVendors });
    await get().saveHubState();
  },

  noteResidentGoal: async (residentId, goal) => {
    const { guild } = get();
    if (!guild.residents.some(r => r.id === residentId)) return;
    set({ guild: { ...guild, residents: guild.residents.map(r => r.id === residentId ? { ...r, goal } : r) } });
    await get().saveHubState();
  },

  centerReach: () => ({ skills: Object.keys(get().web.nodes), stations: WebSystem.openStationsOf(get().web, {}) }),

  buildingWords: () => [BUILDING_HOUSE, ...hubStations(get().tech).map(s => s.id)],

  openBuildingAsks: () => (get().guild.asks ?? []).filter(a => a.state === 'OPEN'),

  askForBuilding: async (askerId, askerName, building, goal, need) => {
    const { guild } = get();
    const asks = guild.asks ?? [];
    if (asks.some(a => a.askerId === askerId && a.state === 'OPEN')) return;
    const ask: IBuildingAsk = { id: `ask_${askerId}_${asks.length}`, askerId, askerName, building, goal, need, day: worldDay(), state: 'OPEN' };
    set({ guild: { ...guild, asks: [...asks, ask] } });
    useFeed.getState().push(`${askerName} is asking for a ${buildingLabel(building)}.`, 'signal');
    // Someone who lives here, asking for a station: that is the workshop they now say they want.
    if (building !== BUILDING_HOUSE && guild.residents.some(r => r.id === askerId)) await get().askWorkshop(askerId, building, goal);
    await get().saveHubState();
  },

  meetBuildingAsk: async (askId, metBy) => {
    const { guild } = get();
    set({ guild: { ...guild, asks: (guild.asks ?? []).map(a => a.id === askId ? { ...a, state: 'MET' as const, metBy } : a) } });
    await get().saveHubState();
  },

  fulfilQuest: async (questId, itemIds) => {
    const { activeHubId } = get();
    if (!activeHubId) return { ok: false, reason: 'The Hall is shut.' };
    const quest = get().guild.quests.find(q => q.id === questId);
    if (!quest || quest.state !== 'OPEN') return { ok: false, reason: 'That want is not on the board.' };
    const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
    const items = itemIds.map(id => stash.find(i => i.id === id));
    if (items.some(i => !i)) return { ok: false, reason: 'That is not in your stash.' };
    if ((items as IItem[]).some(i => i.isIdentified === false)) return { ok: false, reason: 'Read it first. Nobody takes a thing nobody has read.' };
    const wrong = (items as IItem[]).find(i => !answersTag(i, quest.tag) || !wantMayTake(i));
    if (wrong) return { ok: false, reason: `${LoadoutSystem.shownName(wrong)} is not what was asked for.` };
    if (items.length < quest.count) return { ok: false, reason: `The want is for ${quest.count}. That is ${items.length}.` };
    const given = (items as IItem[]).slice(0, quest.count);
    const { guild, lots } = get();
    // Someone who posted from a talk may be a keeper, with no resident behind them, and a wallet all the same.
    const resident = guild.residents.find(r => r.id === quest.residentId);
    const askerName = resident?.name ?? quest.askerName ?? 'Someone';

    // Pedro: "that's the LITERAL MECHANISM OF MASLOW". It is their own coin, and nobody covers it.
    // What they cannot afford they go without, and it waits until they have earned it.
    const pay = questPay(given, quest.payShare);
    const purse = quest.residentId;
    const held = get().wallets[purse] ?? 0;
    if (pay > held) return { ok: false, reason: `That comes to ${pay.toLocaleString()} G, and ${askerName} holds ${held.toLocaleString()} G. They cannot pay it. It waits.` };

    // From here to the commit there is no wait.
    const ids = given.map(i => i.id);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + pay } } }));
    removeFromStash(ids);
    const deltas = { [purse]: -pay };
    set({
      wallets: { ...get().wallets, [purse]: held - pay },
      lots: lots.map(l => resident && l.id === resident.lotId ? { ...l, inventory: [...l.inventory, ...given] } : l),
      guild: {
        ...guild,
        quests: guild.quests.map(q => q.id === questId ? { ...q, state: 'DONE' as const } : q),
        residents: guild.residents.map(r => r.id === resident?.id
          ? { ...r, wantsMet: r.wantsMet + 1, nextWantDay: worldDay() + 1, ...(r.lotId ? {} : { belongings: [...(r.belongings ?? []), ...given] }) }
          : r)
      }
    });
    await GoldCommit.commit({
      rows: [{ type: 'GOLD_DELTA', data: { reason: 'QUEST_PAID', questId, residentId: quest.residentId, consumedIds: ids, amount: pay, treasuryDelta: 0, wallets: deltas } }],
      wallets: { hubId: activeHubId, deltas },
      hubDoc: get().hubDoc() ?? undefined
    });
    await (await provenance()).recordMany(given, 'TRANSFER', { via: 'QUEST', questId, lotId: resident?.lotId });
    // The promise is kept: it closes and starts to fade, and who brought it is remembered with what it cost them
    {
      const day = worldDay();
      const agenda = resident ? agendaOf(resident, day) : get().vendors[quest.residentId]?.agenda;
      const fall = agenda ? LadderWeight.of({ loss: pay > 0, after: { agenda, facts: resident ? residentFacts(resident, held - pay) : { house: true } } }) : 0;
      await MemoryStore.settle({ hubId: activeHubId }, quest.residentId, questId, day);
      await chainActs(activeHubId, [{ npcId: quest.residentId, act: { kind: 'SETTLED', key: questId } }]);
      await MemoryStore.write({ hubId: activeHubId }, [{ owner: quest.residentId, what: Deeds.brought({ day, by: usePlayerStore.getState().player.id, owner: quest.residentId, what: quest.text, fall }) }]);
    }
    // A keeper's goods go on their own shelves to be looked over, the way anything they take in does.
    const keeper = !resident && get().vendors[quest.residentId];
    if (keeper) set({ vendors: { ...get().vendors, [quest.residentId]: given.reduce((record, item) => VendorSystem.receive(record, item, worldDay()), keeper) } });
    useFeed.getState().push(`${askerName} has what they wanted, and pays ${pay.toLocaleString()} G.`, 'proof');
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
    const { activeHubId, chunks, dismembered, planDeposit, lots, craftingJobs, rooms, buildJobs, web, guild, tech, vendors, craftsmen, farmland } = get();
    if (!activeHubId) return null;
    return {
      id: `hub_state_${activeHubId}`,
      namespace: VectorNamespace.TERRITORIES,
      data: JSON.parse(JSON.stringify({ chunks, dismembered, planDeposit, lots, craftingJobs, rooms, buildJobs, web, guild, tech, vendors, craftsmen, farmland })),
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
    const fitting = stationId ? get().openStationsNow().find(s => s.id === stationId) ?? WebBank.current().stations.find(s => s.id === stationId) : undefined;
    return shellBillFor(type, ownerHasBench(p.id, { lots, rooms, jobs: buildJobs, stash: p.bank.stashTabs[0]?.items || [] }), fitting);
  },

  openStationsNow: () => [...WebSystem.openStationsOf(get().web, usePlayerStore.getState().player.bank.universalSkills), ...openedChainStations(get().tech)],

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
    // Q9: creation's words are signed (D35), so the first to reach a skill names it for the hub
    const { web, firsts, records } = WebSystem.admit(get().web, { uid: p.id, name: p.username }, p.bank.universalSkills, Date.now(), p.skillWords);
    if (firsts.length === 0 && records.length === 0) return;
    set({ web });
    const hubId = get().activeHubId;
    const lore = { ...usePlayerStore.getState().player.bank.lore };
    for (const skillId of firsts) {
      const name = WebSystem.nameIn(skillId, web);
      await Ledger.append('TECH', { kind: 'FIRST', skillId, name, hubId, rung: 0 });
      const topic = `First in this hub: ${name}`;
      lore[topic] = lore[topic] ?? { topic, xp: 0, level: 1, dateDiscovered: Date.now() };
      useFeed.getState().push(`First in this hub to reach ${name}. The bank has it signed.`, 'proof');
    }
    for (const { id, rung } of records) {
      await Ledger.append('TECH', { kind: 'RUNG', skillId: id, name: WebSystem.nameIn(id, web), hubId, rung });
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
        const stationDefId = job.workshopId ? undefined : job.stationId ?? SHELL_STATION[job.structureType];
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
    await get().settleWorkshops();
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
    // A station standing anywhere counts toward what the web reaches, whoever raised it.
    await get().settleWorkshops();
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

    const offer = get().offerFor(item, npcId);
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
    const today = worldDay();
    const all = vendorsToday(get().vendors, get().craftsmen, today);
    set({ vendors: { ...all, [npcId]: VendorSystem.receive(all[npcId], item, today, offer) } });
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
        const cleared = Herd.clearHolder(Farm.clear(get().farmland, lot.id), { type: 'plot', id: lot.id });
        if (isLocal) {
          const refund = [
            ...(lot.shopListings || []).map(li => li.item),
            ...lot.inventory,
            ...(lot.heldInTrade ?? []),
            ...(room?.placements.map(pl => pl.item) ?? []),
            ...cleared.items
          ];
          if (refund.length > 0) addToStash(refund);
        }
        set({ farmland: cleared.farmland });
        await Ledger.append('TRADE', { kind: 'LOT_REVERTED', lotId: lot.id, daysUnpaid: owed, playerDelta: 0, treasuryDelta: 0 });
        const { [lot.id]: _gone, ...keptRooms } = get().rooms;
        set({
          lots: get().lots.map(l => l.id === lot.id
            ? { ...l, ownerId: null, ownerName: null, purchaseDate: null, structureType: l.structureType === 'FARM' ? 'FARM' : 'EMPTY', shopListings: [], inventory: [], heldInTrade: [], upkeepPaidThroughDay: undefined }
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
    // Procedural Shop Generation — keyed by hub + the week it is open on (D115), so stock is
    // the same for every client of this hub, and rolls over when the week closes. What each
    // line then holds is the vendor's: what sold, and a new attempt (VendorSystem.shelf).
    const hubId = get().activeHubId || 'hub_unknown';
    const dayIndex = worldDay();
    const week = get().guild.week ?? ShopWeek.weekOf(dayIndex);

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
        const rng = Rng.fromKey(`${hubId}:shop:${week}:${type}:${rank}:${batch}:${i}`);
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
          const rng = Rng.fromKey(`${hubId}:shop:${week}:web_tool:${tool.id}`);
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
          const rng = Rng.fromKey(`${hubId}:shop:${week}:web_material:${material.id}`);
          const item = ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[material.id] as any, rng, { origin: 'PURCHASE' });
          return { id: `listing_web_${material.id}`, item, price: material.shelfPrice!, vendorId: 'vendor_sys', stock: rng.int(3, 10) };
        }),
        ...SHELF.consumables.map((defId, i) => {
          const rng = Rng.fromKey(`${hubId}:shop:${week}:consumable:${i}`);
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
          .sort((a, b) => Rng.fromKey(`${hubId}:shop:${week}:note_order:${a}`).next() - Rng.fromKey(`${hubId}:shop:${week}:note_order:${b}`).next())
          .slice(0, 2)
          .map(family => {
            const rng = Rng.fromKey(`${hubId}:shop:${week}:trade_note:${family}`);
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
          const rng = Rng.fromKey(`${hubId}:shop:${week}:charm:${i}`);
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
          const rng = Rng.fromKey(`${hubId}:shop:${week}:scroll:0`);
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
    const price = priceOfListing(listing, playerStore.player.attributes);
    if (playerStore.player.bank.gold < price) return null;

    // Wave 10D: each unit sold is its OWN mint, deterministically keyed by the
    // listing and its remaining stock (the old crypto.randomUUID was a
    // determinism leak), with PURCHASE on its record. Rolled gear goes through
    // the bank's registry (D18): the shelf shows the pattern; every unit stands
    // on its own rung, the display item keeping the first claim.
    const npcId = SHOP_VENDOR[shop];
    const today = worldDay();
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
    const purchasedItem = listing.deal
      ? { ...listing.item, binPrice: price, composition: unit.composition }
      : listing.held ? listing.item : unit.type === ItemType.GEAR ? MintRegistry.claim(unit) : unit;

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
      vendors: { ...vendorsToday(state.vendors, state.craftsmen, today), [npcId]: VendorSystem.recordSale(sold, listingId, today, total > 0 ? left / total : 0, purchasedItem.universalDefinitionId, price) }
    });
    // The next of this kind takes that row's place
    if (listing.held) get().generateDailyStock();
    void get().saveHubState();
    return purchasedItem;
  }
}));
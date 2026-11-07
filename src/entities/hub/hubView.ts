/**
 * THE HUB, AS THE SYSTEMS SEE IT. The hub store owns the hub's state and is the one writer of it. A
 * system that reads the hub takes a view of it as an argument; a system that changes it takes a port
 * and hands its changes back as data, which the store applies through its `apply`. No system imports
 * the store. The same shape as the world's and the player's (worldView.ts, playerView.ts), after the
 * TTRPG engine's schema: a container owns its state, and every change goes through one door.
 *
 * The tech web is the hub's own container inside it, with its own view, changes and door
 * (techWebView.ts): everything named roots there (Pedro, 2026-11-07), and a local copy of it is what
 * gets compared with the online one.
 *
 * This file imports types only, so reaching it reaches nothing else of the game.
 */
import type { IItem } from '../../../shared/types';
import type { IRoomState, RoomVerdict } from '../../../shared/entities/hub/room';
import type { IDismemberment, IRaisedChunk, HubSide } from './hubManifest';
import type { IFarmland } from './farm';
import type { IGuildState } from './guild';
import type { ICraftsman } from '../../logic/systems/ApprenticeRoad';
import type { INeedFill } from '../../logic/systems/NpcAgenda';
import type { IVendorRecord } from '../../logic/systems/VendorSystem';
import type { IKoseki } from '../../../shared/entities/world/Koseki';

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

/** Two of the city's people meeting, on a day, somewhere, for a reason (MeetDoor). */
export interface IMeeting { a: string; b: string; day: number; where: string; why: string }

/** What a system may read of the hub: the store's state, without its doors. */
export interface IHubView {
  activeHubId: string | null;
  chunks: IRaisedChunk[];
  dismembered: IDismemberment[];
  farmland: IFarmland;
  lots: IPlayerLot[];
  rooms: Record<string, IRoomState>;
  craftsmen: ICraftsman[];
  guild: IGuildState;
  wallets: Record<string, number>;
  vendors: Record<string, IVendorRecord>;
  /** What is being built, and whether it has stood. */
  buildJobs: { lotId: string; applied: boolean }[];
}

/** Every change a system may hand the hub store. It applies them in order. */
export type HubChange =
  /** The hub's farmland as a law worked it out, and one person's register on it. */
  | { kind: 'FARMLAND'; farmland: IFarmland }
  | { kind: 'REGISTER'; personId: string; register: IKoseki }
  /** A chunk made farmland: the plan's chunks, and the lots that stood on it gone. */
  | { kind: 'LAND'; chunks: IRaisedChunk[]; removedLotIds: string[] }
  /** A lot's store, its shelf, and pieces moving between them. */
  | { kind: 'LOT_STORE_ADD'; lotId: string; items: IItem[] }
  | { kind: 'LOT_STORE_REMOVE'; lotId: string; itemId: string }
  | { kind: 'LOT_LIST'; lotId: string; itemId: string; price: number }
  | { kind: 'LOT_UNLIST'; lotId: string; itemId: string }
  | { kind: 'LOT_SHELF_ADD'; lotId: string; listings: { item: IItem; price: number }[] };

/** The hub store's own calls a system may ask for: they wait, or answer back. The store runs them. */
export interface IHubCalls {
  saveHubState(): Promise<void>;
  settleLots(): void;
  planRaise(side: HubSide, beside?: { cx: number; cy: number }, kind?: string): Promise<RoomVerdict>;
  turnTheDay(): Promise<void>;
  resolveVendors(simDay?: number): Promise<void>;
  generateDailyStock(): void;
  creditHeld(): Promise<void>;
  fillAgendas(fills: Record<string, INeedFill>): Promise<void>;
  purchaseLot(lotId: string, playerId: string, playerName: string): Promise<boolean>;
  setLotStructure(lotId: string, structureType: IPlayerLot['structureType']): Promise<void>;
}

/** The hub as a system takes it: a fresh view on each read, the one door its changes go through, and its calls. */
export interface IHubPort extends IHubCalls {
  view(): IHubView;
  apply(...changes: HubChange[]): void;
}

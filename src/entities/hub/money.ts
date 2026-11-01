/**
 * THE HUB'S MONEY (D108, D115): the law of what a hub runs on and what it prints.
 *
 * Pedro: "start the town off with an amount for 14 days of the cycle going before it needs to
 * print". And when it does: "if it needs to print it does, always a 14 day of the cost".
 *
 * And what the cost is: "each one of the buildings in the city center need to have an upkeep
 * value, that requires you to make a value of the tech web and then make the tech web per
 * tile, people that live in the bay area don't want to live like Amish". The web's value is
 * the market cap of what its skills produce (MarketCap). The tiles are "only the city center,
 * not the full sprawl", so a chunk raised never thins it. Each building's upkeep is its own
 * tiles at that density, and goes to whoever keeps the building.
 *
 * But: "The value is a large number, but the good don't cost anything at all". So the web per
 * tile is not a cost of the centre. It is "a general tax, EVERYONE BUT the city center pays it".
 * A centre building's upkeep is its floor, and the shops' cost is what their week comes to
 * (ShopWeek): what came apart for less than expected, and the people at their benches.
 *
 * A hub pays the floor day by day, into its keepers' wallets, and settles its shops each week.
 * With nobody paying it back, the 14 days run out and it prints 14 more, and so on. A print is never the shortfall, and nothing here
 * refuses or limits one. Nothing reads how much coin is about. What that coin comes to be worth
 * is up to the people holding it.
 *
 * Pure logic over plain data: no store, no clock, no gold moved. The doors are in the hub's store.
 */

import { IHubWeb, IItem, UniversalRank } from '../../../types';
import { MarketCap } from '../../logic/economy/MarketCap';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { HUB_NPCS } from './HubGenerator';
import { residentUpkeepPerDay } from './guild';
import { IHubLayout } from './layoutTypes';
import { WEEK_DAYS } from '../../logic/economy/ShopWeek';

export const PRINT_DAYS = 14;

/** What a lot of bare ground costs a day to keep, whoever keeps it. */
export const EMPTY_LOT_PER_DAY = 5;

/** What one tile of a building costs a day in a city with no tech at all. A guess until Wave 12. */
const BUILDING_PER_TILE = 1;

/** Who keeps the hub's free ground, and is paid for it. */
const GROUND_KEEPER = 'npc_land_manager';

/** "every imigrant comes in with cash": a fortnight of their own living or more, keyed. How much more is a guess until Wave 12. */
const WALLET_DAYS_MIN = PRINT_DAYS;
const WALLET_DAYS_TOP = PRINT_DAYS * 4 + 1;

export interface IRunningLine {
  /** Who is paid it. */
  who: string;
  why: 'BUILDING' | 'GROUND';
  name: string;
  amount: number;
  /** For a building. */
  poiId?: string;
  tiles?: number;
}

export interface ICity {
  layout: Pick<IHubLayout, 'zones'>;
  lots: { ownerId: string | null }[];
  web: IHubWeb;
  /** Everything the city holds, and the person standing in it. */
  items: Pick<IItem, 'universalDefinitionId' | 'value'>[];
  /** What the shops' week is expected to cost as they stand: what is on their shelves coming apart, and their people. */
  weekCost: number;
}

export interface IRunningBook {
  lines: IRunningLine[];
  /** What is paid out each day: the buildings' floor and the free ground. */
  floorPerDay: number;
  /** What the shops' week is expected to cost. */
  weekCost: number;
  /** What the hub runs on, a day: the floor and a day of the week. A print is 14 of these. */
  perDay: number;
  /** What the web is worth: the market cap of what its skills produce. */
  marketCap: number;
  /** The city centre's tiles: its buildings, and none of the sprawl. */
  tiles: number;
  techPerTile: number;
}

const rankOfNpc = (npc: { teaches?: { rank: UniversalRank } }) => npc.teaches?.rank ?? UniversalRank.F;

const poisOf = (layout: ICity['layout']) => layout.zones.flatMap(zone => zone.pois);
const tilesOf = (poi: { size: { width: number; height: number } }) => poi.size.width * poi.size.height;

/** One day of what this city runs on, and the reading it comes from. */
export function runningBook(city: ICity): IRunningBook {
  const buildings = poisOf(city.layout).filter(poi => poi.npcId);
  const tiles = buildings.reduce((sum, poi) => sum + tilesOf(poi), 0);
  const marketCap = MarketCap.ofWeb(city.web, city.items);
  const techPerTile = tiles > 0 ? marketCap / tiles : 0;

  const lines: IRunningLine[] = buildings.map(poi => ({
    who: poi.npcId!, why: 'BUILDING', name: poi.name, poiId: poi.id, tiles: tilesOf(poi),
    amount: tilesOf(poi) * BUILDING_PER_TILE
  }));
  const free = city.lots.filter(lot => !lot.ownerId).length;
  if (free > 0) lines.push({ who: GROUND_KEEPER, why: 'GROUND', name: 'Free ground', amount: free * EMPTY_LOT_PER_DAY });

  const floorPerDay = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, floorPerDay, weekCost: city.weekCost, perDay: floorPerDay + Math.ceil(city.weekCost / WEEK_DAYS), marketCap, tiles, techPerTile };
}

export const runningPerDay = (city: ICity): number => runningBook(city).perDay;

export interface ITaxLine {
  lotId: string;
  ownerId: string;
  tiles: number;
  perWeek: number;
}

/** D115: every lot someone holds pays its tiles at the web per tile, weekly. The centre pays none, and free ground is the hub's. */
export function taxBook(city: ICity): { techPerTile: number; lots: ITaxLine[] } {
  const { techPerTile } = runningBook(city);
  const pois = poisOf(city.layout);
  const lots: ITaxLine[] = [];
  for (const lot of city.lots as { id: string; ownerId: string | null }[]) {
    const poi = pois.find(p => p.id === lot.id);
    if (!lot.ownerId || !poi) continue;
    lots.push({ lotId: lot.id, ownerId: lot.ownerId, tiles: tilesOf(poi), perWeek: Math.ceil(tilesOf(poi) * techPerTile) });
  }
  return { techPerTile, lots };
}

/** What one print comes to, and what a new hub starts with. */
export const printAmount = (perDay: number): number => PRINT_DAYS * perDay;

/** How many prints it takes for this balance to pay this. */
export function printsNeeded(balance: number, pay: number, perDay: number): number {
  return balance >= pay ? 0 : Math.ceil((pay - balance) / printAmount(perDay));
}

/** Days in turn: each is paid, and a day the treasury cannot pay prints first. A print is 14 days of what the hub runs on, whatever a day pays. */
export function foldDays(balance: number, perDay: number, days: number, printPerDay = perDay): { prints: number; paid: number } {
  let held = balance;
  let prints = 0;
  for (let d = 0; d < days; d++) {
    const n = printsNeeded(held, perDay, printPerDay);
    prints += n;
    held += n * printAmount(printPerDay) - perDay;
  }
  return { prints, paid: Math.max(0, days) * perDay };
}

/** What a person comes with: days of their own living, the same on every machine. */
export function walletBrought(personId: string, rank: UniversalRank | string): number {
  return residentUpkeepPerDay(rank) * Rng.fromKey(`wallet:${personId}`).int(WALLET_DAYS_MIN, WALLET_DAYS_TOP);
}

/**
 * D104's "more money than they need": more days of their own living than anyone brings. A guess
 * until Wave 12. It reads their coin as a count, and never what coin is worth.
 */
export const moreThanTheyNeed = (coin: number, rank: UniversalRank | string): boolean =>
  coin >= residentUpkeepPerDay(rank) * WALLET_DAYS_TOP;

/** A keeper's rank, for what they bring. */
export const npcRank = (npcId: string): UniversalRank => rankOfNpc(HUB_NPCS[npcId] ?? {});

/**
 * THE HUB'S MONEY (D108, D115): the law of what a hub runs on and what it prints.
 *
 * Pedro: "start the town off with an amount for 14 days of the cycle going before it needs to
 * print". And when it does: "if it needs to print it does, always a 14 day of the cost".
 *
 * And what the cost is: "each one of the buildings in the city center need to have an upkeep
 * value, that requires you to make a value of the tech web and then make the tech web per
 * tile, people that live in the bay area don't want to live like Amish". So the web has a
 * value, that value is spread over the tiles the city stands on, and each building's upkeep is
 * its own tiles at that density. It goes to whoever keeps the building.
 *
 * A hub pays this day by day, into its keepers' wallets. With nobody paying it back, the 14 days
 * run out and it prints 14 more, and so on. A print is never the shortfall, and nothing here
 * refuses or limits one. Nothing reads how much coin is about. What that coin comes to be worth
 * is up to the people holding it.
 *
 * Pure logic over plain data: no store, no clock, no gold moved. The doors are in the hub's store.
 */

import { IHubWeb, UniversalRank } from '../../../types';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { HUB_NPCS } from './HubGenerator';
import { residentUpkeepPerDay } from './guild';
import { IHubLayout, POIType } from './layoutTypes';

export const PRINT_DAYS = 14;

/** What a lot of bare ground costs a day to keep, whoever keeps it. */
export const EMPTY_LOT_PER_DAY = 5;

/** What one tile of a building costs a day in a city with no tech at all. A guess until Wave 12. */
const BUILDING_PER_TILE = 1;

/** Who keeps the hub's free ground, and is paid for it. */
const GROUND_KEEPER = 'npc_land_manager';

/** A person brings this many days of their own living, keyed. A guess until Wave 12. */
const WALLET_DAYS_MIN = 3;
const WALLET_DAYS_TOP = 15;

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
}

export interface IRunningBook {
  lines: IRunningLine[];
  perDay: number;
  webValue: number;
  /** The tiles the city stands on: its buildings and its lots. */
  tiles: number;
  techPerTile: number;
}

const rankOfNpc = (npc: { teaches?: { rank: UniversalRank } }) => npc.teaches?.rank ?? UniversalRank.F;

/** What a hub's web is worth: every skill in it, by how high it stands and how far it has been taken. A guess until Wave 12. */
export function webValue(web: IHubWeb): number {
  return Object.values(web.nodes).reduce((sum, node) => sum + (node.rank + 1) * (node.rungRecord.rung + 1), 0);
}

const poisOf = (layout: ICity['layout']) => layout.zones.flatMap(zone => zone.pois);
const tilesOf = (poi: { size: { width: number; height: number } }) => poi.size.width * poi.size.height;

/** One day of what this city runs on, and the reading it comes from. */
export function runningBook(city: ICity): IRunningBook {
  const pois = poisOf(city.layout);
  const buildings = pois.filter(poi => poi.npcId);
  const tiles = pois.filter(poi => poi.npcId || poi.type === POIType.PLAYER_LOT).reduce((sum, poi) => sum + tilesOf(poi), 0);
  const value = webValue(city.web);
  const techPerTile = tiles > 0 ? value / tiles : 0;

  const lines: IRunningLine[] = buildings.map(poi => ({
    who: poi.npcId!, why: 'BUILDING', name: poi.name, poiId: poi.id, tiles: tilesOf(poi),
    amount: Math.ceil(tilesOf(poi) * BUILDING_PER_TILE * (1 + techPerTile))
  }));
  const free = city.lots.filter(lot => !lot.ownerId).length;
  if (free > 0) lines.push({ who: GROUND_KEEPER, why: 'GROUND', name: 'Free ground', amount: free * EMPTY_LOT_PER_DAY });

  return { lines, perDay: lines.reduce((sum, line) => sum + line.amount, 0), webValue: value, tiles, techPerTile };
}

export const runningPerDay = (city: ICity): number => runningBook(city).perDay;

/** What one print comes to, and what a new hub starts with. */
export const printAmount = (perDay: number): number => PRINT_DAYS * perDay;

/** How many prints it takes for this balance to pay this. */
export function printsNeeded(balance: number, pay: number, perDay: number): number {
  return balance >= pay ? 0 : Math.ceil((pay - balance) / printAmount(perDay));
}

/** Days in turn: each is paid, and a day the treasury cannot pay prints first. */
export function foldDays(balance: number, perDay: number, days: number): { prints: number; paid: number } {
  let held = balance;
  let prints = 0;
  for (let d = 0; d < days; d++) {
    const n = printsNeeded(held, perDay, perDay);
    prints += n;
    held += n * printAmount(perDay) - perDay;
  }
  return { prints, paid: Math.max(0, days) * perDay };
}

/** What a person comes with: days of their own living, the same on every machine. */
export function walletBrought(personId: string, rank: UniversalRank | string): number {
  return residentUpkeepPerDay(rank) * Rng.fromKey(`wallet:${personId}`).int(WALLET_DAYS_MIN, WALLET_DAYS_TOP);
}

/** A keeper's rank, for what they bring. */
export const npcRank = (npcId: string): UniversalRank => rankOfNpc(HUB_NPCS[npcId] ?? {});

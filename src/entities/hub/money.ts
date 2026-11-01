/**
 * THE HUB'S MONEY (D108, D115): the law of what a hub runs on and what it prints.
 *
 * Pedro: "start the town off with an amount for 14 days of the cycle going before it needs to
 * print". And when it does: "if it needs to print it does, always a 14 day of the cost".
 *
 * A hub runs on its people and its free ground, and it pays for them day by day, into their
 * wallets. With nobody paying it back, the 14 days run out and it prints 14 more, and so on.
 * A print is never the shortfall, and nothing here refuses or limits one. Nothing reads how
 * much coin is about. What that coin comes to be worth is up to the people holding it.
 *
 * Pure logic over plain data: no store, no clock, no gold moved. The doors are in the hub's store.
 */

import { UniversalRank } from '../../../types';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { HUB_NPCS } from './HubGenerator';
import { residentUpkeepPerDay } from './guild';

export const PRINT_DAYS = 14;

/** What a lot of bare ground costs a day to keep, whoever keeps it. */
export const EMPTY_LOT_PER_DAY = 5;

/** Who keeps the hub's free ground, and is paid for it. */
const GROUND_KEEPER = 'npc_land_manager';

/** A person brings this many days of their own living, keyed. A guess until Wave 12. */
const WALLET_DAYS_MIN = 3;
const WALLET_DAYS_TOP = 15;

export interface IRunningLine {
  who: string;
  why: 'LIVING' | 'GROUND';
  amount: number;
}

const rankOfNpc = (npc: { teaches?: { rank: UniversalRank } }) => npc.teaches?.rank ?? UniversalRank.F;

/** One day of what this hub runs on: everyone who works for it, and the ground nobody else holds. */
export function runningLines(lots: { ownerId: string | null }[]): IRunningLine[] {
  const people: IRunningLine[] = Object.values(HUB_NPCS).map(npc => ({ who: npc.id, why: 'LIVING', amount: residentUpkeepPerDay(rankOfNpc(npc)) }));
  const free = lots.filter(l => !l.ownerId).length;
  return free > 0 ? [...people, { who: GROUND_KEEPER, why: 'GROUND', amount: free * EMPTY_LOT_PER_DAY }] : people;
}

export const runningPerDay = (lots: { ownerId: string | null }[]): number =>
  runningLines(lots).reduce((sum, line) => sum + line.amount, 0);

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

/**
 * THE WEEK (D115). Pedro: "The value is a large number, but the good don't cost anything at all,
 * they all cost when they're broken down to be reproduced". What does not sell is salvaged, and
 * what it was expected to fetch less what its components are worth is the week's cost "for the
 * shop keep and the city center ... then the guild balances the shops budget out for the cost."
 * And: "When the shop earns more than it spends that money gets added to the guild, they're all
 * public servants for the good of diving."
 *
 * Pure law over plain numbers. Patterns read, not ported: the donor's weekly market tick and a
 * merchant's weekly book (`engine/market.ts`). The doors are in the hub's store.
 *
 * A sale's coin and a counter's coin already move through the treasury, which is the guild's. So
 * what is left to settle at the close is the loss: the guild pays a shop what its own surplus
 * does not cover, into the keeper's wallet, and a shop's surplus is the guild's already.
 */

import { Rarity, UniversalRank } from '../../../types';
import { residentUpkeepPerDay } from '../../entities/hub/guild';
import { RANK_ORDER } from '../../entities/player/systems/ProgressionSystem';

export const WEEK_DAYS = 7;

/** The order things run in, rarest last, read from the record so nothing is listed twice. */
const RARITY_ORDER = Object.values(Rarity) as string[];

/** What a kind of thing a keeper has seen selling fetches at the counter. A guess until Wave 12, and under the shelf's 1.5. */
export const CHOICE_PREMIUM = 1.25;

export interface IShopBook {
  /** What the shop's shelf took this week. */
  earned: number;
  /** What its counter paid out. */
  counter: number;
  /** What was expected of what came apart, less what it came apart into. */
  loss: number;
}

export const emptyBook = (): IShopBook => ({ earned: 0, counter: 0, loss: 0 });

export interface IShopSettlement {
  /** What the guild pays into the keeper's wallet to balance the book. */
  toKeeper: number;
  /** What the shop earned over everything it spent. */
  toGuild: number;
}

export interface IShopWeekLine extends IShopBook, IShopSettlement {
  npcId: string;
  pay: number;
}

export interface IClosedWeek {
  week: number;
  shops: IShopWeekLine[];
  tax: number;
}

export const ShopWeek = {
  WEEK_DAYS,
  CHOICE_PREMIUM,

  weekOf: (day: number) => Math.floor(day / WEEK_DAYS),

  /** "the rarer and higher rank, the more unique it is". */
  uniqueness(rank: UniversalRank | string | undefined, rarity: Rarity | string | undefined): number {
    return Math.max(0, RANK_ORDER.indexOf(rank as UniversalRank)) + Math.max(0, RARITY_ORDER.indexOf(rarity as string) - RARITY_ORDER.indexOf(Rarity.COMMON));
  },

  /** How long it is kept in stock before anyone gives up on it. A week for each step of uniqueness: a guess until Wave 12. */
  stockDays(rank: UniversalRank | string | undefined, rarity: Rarity | string | undefined): number {
    return WEEK_DAYS * (1 + this.uniqueness(rank, rarity));
  },

  /** In whole coin, rounded up: a shelf's price can be a fraction, and the treasury holds no fractions. */
  lossOf(expected: number, components: number): number {
    return Math.max(0, Math.ceil(expected - components));
  },

  /** A person at the bench is paid their own living, for the week. */
  apprenticePay(rank: UniversalRank | string): number {
    return residentUpkeepPerDay(rank) * WEEK_DAYS;
  },

  /**
   * The close. The counter and the wages have moved already, so they only use up what the shop
   * earned. What is left of that goes against the loss, the guild pays the rest of the loss,
   * and anything still over is the shop's surplus.
   */
  settle(book: IShopBook, pay: number): IShopSettlement {
    const left = book.earned - book.counter - pay;
    return { toKeeper: Math.max(0, book.loss - Math.max(0, left)), toGuild: Math.max(0, left - book.loss) };
  }
};

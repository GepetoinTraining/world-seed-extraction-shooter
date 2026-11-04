/**
 * THE VENDOR: a person with a container and a goal. Pedro, 2026-11-01: "add a stock and
 * goal function to the vendors please, this will be the npc code as well."
 *
 * Each vendor holds its own record. The day's rolled shelf stays a pure function of hub
 * and day, so the record is all that has to be saved, and a reload cannot bring back what
 * was bought. The goal is read from the agenda and never stored, and each one changes
 * something (line 77's rule).
 *
 * "Bought doesn't mean goes to sale": what a vendor takes in is held, and the next day it
 * looks at what has been selling. A kind that sells goes on the shelf. Anything else is
 * salvaged, and the components are sold and worked. A recipe is discovered when the
 * components in it have met in its hands, and its name comes with that.
 *
 * A GENERAL vendor is a keeper of the city: it always restocks and it trains people up
 * (ApprenticeRoad). A TRADER has only what it holds. Everything here is pure, a fold of
 * the days: salvage and making are handed in, so being away reaches the same place.
 */

import { IItem } from '../../../types';
import { INeedFill, INpcAgenda, NeedKind, NpcAgenda } from './NpcAgenda';
import { CHOICE_PREMIUM, DEAL_DAYS, IShopBook, ShopWeek, emptyBook } from '../economy/ShopWeek';

export type VendorKind = 'GENERAL' | 'TRADER';

/** A piece that did not sell, on a timed deal before it comes apart. */
export interface IBinPiece {
  item: IItem;
  /** What it was expected to fetch. */
  ask: number;
  price: number;
  /** What its components come to. */
  worth: number;
  /** The day the deal ends. */
  until: number;
}

export interface IVendorRecord {
  npcId: string;
  kind: VendorKind;
  agenda: INpcAgenda;
  /** How many of each line have gone this week. The week's close starts it over. */
  sold: { day: number; lines: Record<string, number> };
  /** Taken in and not yet judged. Nobody can buy these. */
  held: IItem[];
  /** Judged worth selling whole, or made here. */
  listed: IItem[];
  /** Components: sold, and worked. */
  parts: IItem[];
  /** The bargain bin: what did not sell, marked down for a while. */
  bin: IBinPiece[];
  /** The day a piece reached where it is, by id. */
  since: Record<string, number>;
  /** The last day a kind sold here, by definition. This is what it sees selling. */
  demand: Record<string, number>;
  /** Every definition that has been in its hands as a component. */
  seen: string[];
  /** Recipes it has worked out, by id. */
  known: string[];
  /** The last day it worked. */
  worked: number;
  /** Who saw this shop opened. They pay less here. */
  patrons: string[];
  /** D115: this week's takings, what its counter paid, and what came apart for less than was expected. */
  book: IShopBook;
  /** How many of each line went last week: what next week's stock is built on. */
  soldLast: Record<string, number>;
  /** Weeks closed. A shelf with none behind it opens as it always has. */
  weeks: number;
  /** Q32: shelf lines a close found unsold and still inside their stock days. They stay up at their own stock until their time runs. */
  kept: IVendorListing[];
}

export interface IVendorListing {
  id: string;
  item: IItem;
  price: number;
  vendorId: string;
  stock: number;
  /** The vendor's own pieces, not a line of the day's shelf. Buying takes `item` itself. */
  held?: boolean;
  /** In the bargain bin: its price is the deal's, and this is the day it ends. */
  deal?: { until: number };
  /** A kept line: the day it went on the shelf, which its stock days count from. */
  stocked?: number;
  /** What the line asks before this keeper's mood or a patron's price, so carrying it over a close does not take the factor twice. */
  ask?: number;
}

export interface IVendorRecipe {
  id: string;
  name: string;
  inputs: { itemId: string; quantity: number }[];
  /** The definition it makes, so a vendor can see what it already has plenty of. */
  output: string;
}

export interface IWorkTools {
  recipes: IVendorRecipe[];
  /** What a piece comes apart into. Null if it cannot be. Empty if it was, and nothing was left worth keeping. */
  salvage: (item: IItem, key: string) => IItem[] | null;
  make: (recipe: IVendorRecipe, consumed: IItem[], key: string) => IItem[];
}

export type IWorkEvent =
  | { kind: 'LISTED'; itemId: string; day: number }
  | { kind: 'SALVAGED'; itemId: string; defId: string; parts: string[]; day: number }
  | { kind: 'DISCOVERED'; recipeId: string; name: string; day: number }
  | { kind: 'CRAFTED'; recipeId: string; name: string; consumed: string[]; made: string[]; day: number };

export const VENDOR_GOALS: Record<NeedKind, { goal: string; say: string }> = {
  survival: { goal: 'MAKE_A_LIVING', say: 'Trade has been slow. Everything on the shelf is marked down until it is not.' },
  safety: { goal: 'KEEP_STOCK', say: 'The shelf is running thin. There will be more on it tomorrow.' },
  belonging: { goal: 'TAKE_ON_SOMEONE', say: 'This is a lot of shop for one pair of hands. I would take on someone nobody else wants.' },
  esteem: { goal: 'EARN_A_NAME', say: 'I want this city to know whose work that is. I keep my people at the bench longer for it.' },
  purpose: { goal: 'RAISE_THE_NEXT', say: 'What I know should outlast me. Anyone under me works full days and then some.' }
};

/** Guesses until Wave 12. */
export const OWN_MARKUP = 1.5;
const MARKDOWN = 0.9;
const PATRON_FACTOR = 0.85;
const THIN_SHELF_RESTOCK = 1;
const FILL_PER_SALE: INeedFill = { survival: 10 };
/** A full day at the shelf answers what the day takes from safety. Only a sale moves it. */
const DAILY_SHELF_FILL = 2;
const BELONGING_PER_PERSON = 3;
const HOURS: Partial<Record<NeedKind, number>> = { esteem: 1.25, purpose: 1.5 };
/** A night to look a thing over. */
const SEE_DAYS = 1;
/** How recently a kind must have sold to count as selling. How long a piece may sit is by its rank and rarity (ShopWeek.stockDays). */
const DEMAND_DAYS = 7;
/** Each week stocks what sold, and one new attempt at each line. */
const NEW_ATTEMPTS = 1;
const MAKES_PER_DAY = 1;

const defOf = (item: IItem) => item.universalDefinitionId;
const isRead = (item: IItem) => item.isIdentified !== false;

const FRESH_CONTAINER = { listed: [], parts: [], bin: [], since: {}, demand: {}, seen: [], known: [], patrons: [], book: emptyBook(), soldLast: {}, weeks: 0, kept: [] as IVendorListing[] };

/** Q38: two bin pieces are one row when nothing but their id tells them apart, at one price, on one deal. */
const binKey = (piece: IBinPiece) => `${piece.price}|${piece.until}|${JSON.stringify({ ...piece.item, id: undefined })}`;

export const VendorSystem = {
  fresh(npcId: string, kind: VendorKind, day: number): IVendorRecord {
    return { npcId, kind, agenda: NpcAgenda.fresh(day), sold: { day, lines: {} }, held: [], worked: day, ...FRESH_CONTAINER };
  },

  /** A record saved before the container grew. */
  normal(record: IVendorRecord): IVendorRecord {
    return { ...FRESH_CONTAINER, worked: record.sold.day, ...record };
  },

  /** Up to today. `raising` is how many people stand with this vendor. */
  fold(record: IVendorRecord, today: number, raising = 0): IVendorRecord {
    const agenda = NpcAgenda.fold(record.agenda, today, { safety: DAILY_SHELF_FILL, belonging: raising * BELONGING_PER_PERSON });
    return { ...record, agenda };
  },

  goalOf(record: IVendorRecord): string {
    return VENDOR_GOALS[NpcAgenda.pressing(record.agenda)].goal;
  },

  say(record: IVendorRecord): string {
    return VENDOR_GOALS[NpcAgenda.pressing(record.agenda)].say;
  },

  /** How long a day at this vendor's bench runs, the donor's hours. */
  teachingHours(record: IVendorRecord): number {
    return HOURS[NpcAgenda.pressing(record.agenda)] ?? 1;
  },

  /**
   * The container, as a shelf. `rolled` is the day's lines, `labor` what the people it
   * raised add to each. Its own pieces share a row by kind. A piece nobody has read is
   * never shown: a shelf says its name aloud.
   */
  shelf(record: IVendorRecord, rolled: IVendorListing[], today: number, labor: number, customer?: string): IVendorListing[] {
    const need = NpcAgenda.pressing(record.agenda);
    const factor = (need === 'survival' ? MARKDOWN : 1) * (customer && record.patrons.includes(customer) ? PATRON_FACTOR : 1);
    const restock = (need === 'safety' ? THIN_SHELF_RESTOCK : 0) + labor;
    const lines = record.sold.lines;
    const kinds = new Map<string, IItem[]>();
    for (const item of [...record.listed, ...record.parts].filter(isRead)) kinds.set(defOf(item), [...(kinds.get(defOf(item)) ?? []), item]);
    const bins = new Map<string, IBinPiece[]>();
    for (const piece of record.bin.filter(p => isRead(p.item) && p.until >= today)) bins.set(binKey(piece), [...(bins.get(binKey(piece)) ?? []), piece]);
    return [
      ...rolled.map(line => ({
        ...line, vendorId: record.npcId, ask: line.price, price: line.price * factor,
        stock: Math.max(0, (record.weeks > 0 ? (record.soldLast[line.id] ?? 0) + NEW_ATTEMPTS : line.stock) + restock - (lines[line.id] ?? 0))
      })),
      ...(record.kept ?? []).map(line => ({
        ...line, vendorId: record.npcId, ask: line.price, price: line.price * factor,
        stock: Math.max(0, line.stock - (lines[line.id] ?? 0))
      })).filter(line => line.stock > 0),
      ...[...kinds.entries()].map(([def, items]) => ({
        id: `listing_own_${def}`, item: items[0], price: Math.max(1, items[0].value * OWN_MARKUP * factor),
        vendorId: record.npcId, stock: items.length, held: true
      })),
      ...[...bins.values()].map(([piece, ...rest]) => ({
        id: `listing_bin_${piece.item.id}`, item: piece.item, price: piece.price, vendorId: record.npcId, stock: 1 + rest.length, held: true, deal: { until: piece.until }
      }))
    ];
  },

  /** `cover` is the share of the shelf left, which is what safety reads. */
  recordSale(record: IVendorRecord, lineId: string, today: number, cover: number, defId?: string, price = 0): IVendorRecord {
    const lines = record.sold.lines;
    const agenda = NpcAgenda.fill(record.agenda, FILL_PER_SALE);
    return {
      ...record,
      agenda: { ...agenda, needs: { ...agenda.needs, safety: Math.round(cover * 100) } },
      sold: { day: today, lines: { ...lines, [lineId]: (lines[lineId] ?? 0) + 1 } },
      demand: defId ? { ...record.demand, [defId]: today } : record.demand,
      book: { ...record.book, earned: record.book.earned + price }
    };
  },

  /** Taken in over the counter. Not for sale until it has been looked over. */
  receive(record: IVendorRecord, item: IItem, today: number, paid = 0): IVendorRecord {
    return { ...record, held: [...record.held, item], since: { ...record.since, [item.id]: today }, book: { ...record.book, counter: record.book.counter + paid } };
  },

  /** What the counter makes of this kind: a kind it has seen selling lately is worth more to it. */
  choiceFactor(record: IVendorRecord | undefined, defId: string, today: number): number {
    const last = record?.demand?.[defId];
    return last !== undefined && today - last <= DEMAND_DAYS ? CHOICE_PREMIUM : 1;
  },

  /** The week is over: last week's sales are what next week stocks, and its book is closed. What is still inside its stock days stays up (Q32). */
  closeWeek(record: IVendorRecord, today: number, unsold: IBinPiece[] = [], kept: IVendorListing[] = []): IVendorRecord {
    return { ...record, bin: [...record.bin, ...unsold], kept, book: emptyBook(), soldLast: record.sold.lines, sold: { day: today, lines: {} }, weeks: record.weeks + 1 };
  },

  /** One of its own pieces, gone to a buyer. */
  takeOwn(record: IVendorRecord, itemId: string): IVendorRecord {
    return { ...record, listed: record.listed.filter(i => i.id !== itemId), parts: record.parts.filter(i => i.id !== itemId), bin: record.bin.filter(p => p.item.id !== itemId) };
  },

  /**
   * A trader buys up to half of what its old keeper has lying about, the way a master buys
   * from a teacher, and only as far as its own money goes (D115). `paid` is what it came to.
   */
  share(from: IVendorRecord, to: IVendorRecord, money: number): { from: IVendorRecord; to: IVendorRecord; paid: number } {
    const given: IItem[] = [];
    let paid = 0;
    for (const part of from.parts.slice(0, Math.floor(from.parts.length / 2))) {
      const worth = Math.max(0, part.value || 0);
      if (paid + worth > money) break;
      paid += worth;
      given.push(part);
    }
    return {
      from: { ...from, parts: from.parts.slice(given.length) },
      to: { ...to, parts: [...to.parts, ...given] },
      paid
    };
  },

  /** Every day since it last worked, in turn. `labor` is the hands beyond its own. */
  work(record: IVendorRecord, today: number, labor: number, tools: IWorkTools): { record: IVendorRecord; events: IWorkEvent[] } {
    const events: IWorkEvent[] = [];
    let current = record;
    for (let day = record.worked + 1; day <= today; day++) {
      const stepped = this.workDay(current, day, labor, tools);
      current = stepped.record;
      events.push(...stepped.events);
    }
    return { record: current, events };
  },

  workDay(start: IVendorRecord, day: number, labor: number, tools: IWorkTools): { record: IVendorRecord; events: IWorkEvent[] } {
    const events: IWorkEvent[] = [];
    let loss = 0;
    const held: IItem[] = [];
    const listed: IItem[] = [];
    const since = { ...start.since };
    let parts = [...start.parts];
    const sells = (item: IItem) => day - (start.demand[defOf(item)] ?? -Infinity) <= DEMAND_DAYS;
    const list = (item: IItem) => {
      listed.push(item);
      since[item.id] = day;
    };
    const bin: IBinPiece[] = [];
    const takeApart = (item: IItem, expected = (item.value || 0) * OWN_MARKUP): boolean => {
      const came = tools.salvage(item, `${start.npcId}:salvage:${item.id}`);
      if (came === null) return false;
      parts = [...parts, ...came];
      loss += ShopWeek.lossOf(expected, came.reduce((sum, part) => sum + (part.value || 0), 0));
      events.push({ kind: 'SALVAGED', itemId: item.id, defId: defOf(item), parts: came.map(p => p.id), day });
      return true;
    };

    // What was on a deal and is still here when the deal ends comes apart.
    for (const piece of start.bin) {
      if (day < piece.until) bin.push(piece);
      else if (!takeApart(piece.item, piece.ask)) list(piece.item);
    }
    // What it took in: does this kind sell here?
    for (const item of start.held) {
      if (day - (since[item.id] ?? start.worked) < SEE_DAYS) {
        held.push(item);
      } else if (isRead(item) && sells(item)) {
        list(item);
        events.push({ kind: 'LISTED', itemId: item.id, day });
      } else if (!takeApart(item)) {
        if (isRead(item)) list(item);
        else held.push(item);
      }
    }
    // What has been sitting on the shelf.
    for (const item of start.listed) {
      if (day - (since[item.id] ?? start.worked) < ShopWeek.stockDays(item.rank, item.rarity) || sells(item)) listed.push(item);
      else {
        // It did not sell: a timed deal, unless it cannot be taken apart, and then it gets another stretch on the shelf
        const came = tools.salvage(item, `${start.npcId}:salvage:${item.id}`);
        if (came === null) { list(item); continue; }
        const worth = came.reduce((sum, part) => sum + (part.value || 0), 0);
        const ask = (item.value || 0) * OWN_MARKUP;
        const price = ShopWeek.binPrice(item.value, worth);
        // Worth more apart than a deal could ask: there is no bargain in it
        if (price >= ask) takeApart(item, ask);
        else bin.push({ item, ask, worth, price, until: day + DEAL_DAYS });
      }
    }

    // What has met in its hands.
    const seen = [...new Set([...start.seen, ...parts.map(defOf)])];
    const known = [...start.known];
    for (const recipe of tools.recipes) {
      if (known.includes(recipe.id) || !recipe.inputs.every(input => seen.includes(input.itemId))) continue;
      known.push(recipe.id);
      events.push({ kind: 'DISCOVERED', recipeId: recipe.id, name: recipe.name, day });
    }

    // What it can make, the thing the shelf has least of first.
    for (let n = 0; n < MAKES_PER_DAY + labor; n++) {
      const count = (def: string) => listed.filter(i => defOf(i) === def).length;
      const able = tools.recipes
        .filter(r => known.includes(r.id) && r.inputs.every(input => parts.filter(p => defOf(p) === input.itemId).length >= input.quantity))
        .sort((a, b) => count(a.output) - count(b.output) || a.id.localeCompare(b.id));
      const recipe = able[0];
      if (!recipe) break;
      const consumed = recipe.inputs.flatMap(input => parts.filter(p => defOf(p) === input.itemId).slice(0, input.quantity));
      const made = tools.make(recipe, consumed, `${start.npcId}:craft:${day}:${n}:${consumed.map(c => c.id).join(',')}`);
      if (made.length === 0) break;
      const gone = new Set(consumed.map(c => c.id));
      parts = parts.filter(p => !gone.has(p.id));
      made.forEach(list);
      events.push({ kind: 'CRAFTED', recipeId: recipe.id, name: recipe.name, consumed: consumed.map(c => c.id), made: made.map(m => m.id), day });
    }

    return { record: { ...start, held, listed, parts, bin, since, seen, known, worked: day, book: { ...start.book, loss: start.book.loss + loss } }, events };
  }
};

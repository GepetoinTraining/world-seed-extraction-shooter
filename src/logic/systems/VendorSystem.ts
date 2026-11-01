/**
 * THE VENDOR: a person with a container and a goal. Pedro, 2026-11-01: "add a stock and
 * goal function to the vendors please, this will be the npc code as well."
 *
 * Each vendor holds its own record: what it sold today, and what it bought and may sell
 * on. The day's rolled shelf stays a pure function of hub and day, so the record is all
 * that has to be saved, and a reload cannot bring back what was bought.
 *
 * A GENERAL vendor is a keeper of the city. It always restocks, and it trains people up
 * (ApprenticeRoad). A TRADER has only what it was given. The goal is read from the
 * agenda and never stored, and each one changes something (line 77's rule).
 */

import { IItem } from '../../../types';
import { INeedFill, INpcAgenda, NeedKind, NpcAgenda } from './NpcAgenda';

export type VendorKind = 'GENERAL' | 'TRADER';

export interface IVendorRecord {
  npcId: string;
  kind: VendorKind;
  /** What it teaches, as a word of kind trade on the web. */
  trade?: string;
  agenda: INpcAgenda;
  /** How many of each line went today. A new day starts it over. */
  sold: { day: number; lines: Record<string, number> };
  /** What it has bought. It is held here until someone buys it. */
  held: IItem[];
}

export interface IVendorListing {
  id: string;
  item: IItem;
  price: number;
  vendorId: string;
  stock: number;
  /** One of the vendor's own pieces, not a line of the day's shelf. */
  held?: boolean;
}

export const VENDOR_GOALS: Record<NeedKind, { goal: string; say: string }> = {
  survival: { goal: 'MAKE_A_LIVING', say: 'Trade has been slow. Everything on the shelf is marked down until it is not.' },
  safety: { goal: 'KEEP_STOCK', say: 'The shelf is running thin. There will be more on it tomorrow.' },
  belonging: { goal: 'TAKE_ON_SOMEONE', say: 'This is a lot of shop for one pair of hands. I would take on someone nobody else wants.' },
  esteem: { goal: 'EARN_A_NAME', say: 'I want this city to know whose work that is. I keep my people at the bench longer for it.' },
  purpose: { goal: 'RAISE_THE_NEXT', say: 'What I know should outlast me. Anyone under me works full days and then some.' }
};

/** What a person buying on sees, against what the vendor paid to take it in. Guesses until Wave 12. */
const HELD_MARKUP = 1.5;
const MARKDOWN = 0.9;
const THIN_SHELF_RESTOCK = 1;
const FILL_PER_SALE: INeedFill = { survival: 10 };
/** A full day at the shelf answers what the day takes from safety. Only a sale moves it. */
const DAILY_SHELF_FILL = 2;
const BELONGING_PER_PERSON = 3;
const HOURS: Partial<Record<NeedKind, number>> = { esteem: 1.25, purpose: 1.5 };

export const VendorSystem = {
  fresh(npcId: string, kind: VendorKind, day: number, trade?: string): IVendorRecord {
    return { npcId, kind, ...(trade ? { trade } : {}), agenda: NpcAgenda.fresh(day), sold: { day, lines: {} }, held: [] };
  },

  /** Up to today. `raising` is how many people stand with this vendor. */
  fold(record: IVendorRecord, today: number, raising = 0): IVendorRecord {
    const agenda = NpcAgenda.fold(record.agenda, today, { safety: DAILY_SHELF_FILL, belonging: raising * BELONGING_PER_PERSON });
    return { ...record, agenda, sold: record.sold.day === today ? record.sold : { day: today, lines: {} } };
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
   * raised add to each. A piece nobody has read stays held: a shelf says its name aloud.
   */
  shelf(record: IVendorRecord, rolled: IVendorListing[], today: number, labor: number): IVendorListing[] {
    const need = NpcAgenda.pressing(record.agenda);
    const factor = need === 'survival' ? MARKDOWN : 1;
    const restock = (need === 'safety' ? THIN_SHELF_RESTOCK : 0) + labor;
    const lines = record.sold.day === today ? record.sold.lines : {};
    return [
      ...rolled.map(line => ({
        ...line, vendorId: record.npcId, price: line.price * factor,
        stock: Math.max(0, line.stock + restock - (lines[line.id] ?? 0))
      })),
      ...record.held.filter(item => item.isIdentified !== false).map(item => ({
        id: `listing_held_${item.id}`, item, price: Math.max(1, item.value * HELD_MARKUP * factor),
        vendorId: record.npcId, stock: 1, held: true
      }))
    ];
  },

  /** `cover` is the share of the shelf left, which is what safety reads. */
  recordSale(record: IVendorRecord, lineId: string, today: number, cover: number): IVendorRecord {
    const lines = record.sold.day === today ? record.sold.lines : {};
    const agenda = NpcAgenda.fill(record.agenda, FILL_PER_SALE);
    return {
      ...record,
      agenda: { ...agenda, needs: { ...agenda.needs, safety: Math.round(cover * 100) } },
      sold: { day: today, lines: { ...lines, [lineId]: (lines[lineId] ?? 0) + 1 } }
    };
  },

  receive(record: IVendorRecord, item: IItem): IVendorRecord {
    return { ...record, held: [...record.held, item] };
  },

  takeHeld(record: IVendorRecord, itemId: string): IVendorRecord {
    return { ...record, held: record.held.filter(item => item.id !== itemId) };
  }
};

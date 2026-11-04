/**
 * WHAT A HAUL IS WORTH, AND TO WHOM (Q12, Q17; 2026-11-04).
 *
 * Q17, Pedro: "no claude". A person brought out is not a haul, so the levy does not count them.
 * Q12, decided: a receipt does not show the worth of what nobody has read. The levy is still
 * charged on that worth, unseen, and the receipt says only that a levy was taken.
 */

import { IItem } from '../../../types';
import { Escort } from '../systems/Escort';

export interface IHaulReading {
  /** What the levy is a share of: every piece, read or not. No person. */
  leviable: number;
  /** What the receipt may say it is worth: the pieces someone has read. */
  shownWorth: number;
  /** How many pieces nobody has read yet. */
  unread: number;
  /** Who came out with you, by name. */
  persons: string[];
}

export const HaulReading = {
  read(haul: IItem[]): IHaulReading {
    let leviable = 0, shownWorth = 0, unread = 0;
    const persons: string[] = [];
    for (const item of haul) {
      if (Escort.isPerson(item)) {
        persons.push(item.bondData?.sheet.name ?? item.name);
        continue;
      }
      leviable += item.value || 0;
      if (item.isIdentified === false) unread++;
      else shownWorth += item.value || 0;
    }
    return { leviable, shownWorth, unread, persons };
  }
};

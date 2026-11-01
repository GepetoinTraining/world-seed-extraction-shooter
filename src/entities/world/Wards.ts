/**
 * THE WARD (D93): why a boss takes a party. Never health: reaching it and leaving are the raid.
 *
 * The seat is warded while its anchors stand. A broken anchor relights after a window, unless all
 * of them are down at one moment. The formula sets that window shorter than the walk between them,
 * from the real distance, so the requirement holds at any strength and needs no cap.
 *
 * The pace is the fastest this person has moved since the world opened, never the pace they have now.
 * Otherwise they could run, take their speed off just before the second break, and stretch the
 * window behind them. A shot's reach is already taken off the distance (`relightWindowMs`).
 *
 * An anchor is a post, which relights for as long as it stands on the record, or a body, which
 * relights from whoever stands behind it. So one person who brings down every body of a pride, one
 * at a time, can still open its ward. Posts are the case that holds forever. Said on the record.
 *
 * What was broken is this opening's, kept here beside the fight. The record hears a post only when
 * it stays down, which is what `Population.broke` is for.
 */

import { relightWindowMs } from '../../logic/theme/ThemeFormula';

export interface IWardSlot {
  id: string;
  kind: 'post' | 'body';
  /** Who holds this anchor, in the order they would take it up. */
  bodies: string[];
  x: number;
  y: number;
}

export interface IWard {
  boss: string;
  slots: IWardSlot[];
}

export interface IWardLive {
  downAt: Record<string, number>;
  /** The fastest walk seen, in tiles a second. */
  fastest: number;
  /** Bosses whose anchors were all down at one moment. Nothing relights for these. */
  open: Record<string, true>;
}

export interface IWardReading {
  warded: boolean;
  /** Which anchors stand, in the ward's own order. */
  lit: string[];
  /** Posts that have just come back. The field restores them. */
  relit: string[];
}

const nearest = (ward: IWard, slot: IWardSlot) =>
  ward.slots.filter(s => s.id !== slot.id).reduce((best, s) => Math.min(best, Math.hypot(s.x - slot.x, s.y - slot.y)), Infinity);

export class Wards {

  /** One opening's fights. */
  private static current: IWardLive = this.fresh();

  static fresh(): IWardLive {
    return { downAt: {}, fastest: 0, open: {} };
  }

  static live(): IWardLive {
    return this.current;
  }

  static reset(): void {
    this.current = this.fresh();
  }

  static broke(live: IWardLive, bodyId: string, now: number): void {
    live.downAt[bodyId] = now;
  }

  static paced(live: IWardLive, walkTilesPerSecond: number): void {
    if (walkTilesPerSecond > live.fastest) live.fastest = walkTilesPerSecond;
  }

  /** The relight window for one anchor, from the nearest other. */
  static windowFor(ward: IWard, slot: IWardSlot, live: IWardLive): number {
    const away = nearest(ward, slot);
    return Number.isFinite(away) ? relightWindowMs(away, live.fastest) : 0;
  }

  /** Where this ward stands now. Once every anchor is down at one moment it stays open for this opening. */
  static read(ward: IWard, live: IWardLive, now: number): IWardReading {
    if (ward.slots.length === 0 || live.open[ward.boss]) return { warded: false, lit: [], relit: [] };
    const lit: string[] = [], relit: string[] = [];
    for (const slot of ward.slots) {
      const falls = slot.bodies.map(b => live.downAt[b]).filter((at): at is number => at !== undefined);
      if (falls.length === 0) { lit.push(slot.id); continue; }
      const lastFall = Math.max(...falls);
      const back = now - lastFall >= this.windowFor(ward, slot, live);
      if (slot.kind === 'post') {
        if (back) { lit.push(slot.id); relit.push(slot.bodies[0]); }
      } else if (back && slot.bodies.some(b => live.downAt[b] === undefined)) {
        lit.push(slot.id);
      }
    }
    if (lit.length === 0) {
      live.open[ward.boss] = true;
      return { warded: false, lit: [], relit: [] };
    }
    return { warded: true, lit, relit };
  }

  /** A post that came back stands whole, and may be broken again. */
  static restored(live: IWardLive, bodyId: string): void {
    delete live.downAt[bodyId];
  }
}

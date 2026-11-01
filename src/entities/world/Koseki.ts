/**
 * THE KOSEKI (戸籍): a line's register, filed at a place, never at a body.
 *
 * From `D:\-ttrpg-engine\engine\social.ts`, as a shape. One body is the head (筆頭者). A
 * birth adds an entry, an exit marks one and never deletes it, and an adoption moves a body
 * from one register to another. When a head goes, the next in the register takes its place,
 * and with nobody left the register is extinct, and stands.
 *
 * It holds only bodies the record holds by name (D64): a leader, and whoever comes after it.
 * A birth in a herd changes a count and never reaches a register. A register is written when
 * something happens to the line it records, so a world that nothing has touched stores none.
 *
 * Pure and keyed, as the population is: every function hands back a new register, an id is
 * the place and the founder, and time is a cycle. Nothing here reads a clock.
 */

/** How a body came to be written here. A word with a reader: succession reads each. */
export type EntryWord = 'head' | 'child' | 'adopted';
/** Why a body left. `adopted_out` is a move: it stands on another register. */
export type ExitWord = 'fell' | 'adopted_out';

export interface IKosekiEntry {
  body: string;
  /** The kind it stands as. A line's own kinds keep theirs (`CreatureLines`). */
  kind: string;
  word: EntryWord;
  enteredAt: number;
  /** Absent while it stands. Cycle 0 is a cycle, so this is never read as true or false. */
  exitedAt?: number;
  exit?: ExitWord;
  /** Who it came from. Two lines, two parents (D65). */
  parents: string[];
  /** For an adoption: the register it left. */
  from?: string;
}

export interface IKoseki {
  id: string;
  /** The place it is filed at: a sector, or a hub. The body walks; the register stays. */
  filedAt: string;
  head: string | null;
  entries: IKosekiEntry[];
  foundedAt: number;
  status: 'active' | 'extinct';
}

const stands = (e: IKosekiEntry) => e.exitedAt === undefined;
const HEIR_WORDS: EntryWord[] = ['child', 'adopted'];

export class Koseki {

  static found(filedAt: string, founder: string, kind: string, at: number): IKoseki {
    return {
      id: `reg_${filedAt.replace(',', '_')}_${founder}`, filedAt, head: founder, foundedAt: at, status: 'active',
      entries: [{ body: founder, kind, word: 'head', enteredAt: at, parents: [] }]
    };
  }

  /** Who stands on this register now. */
  static standing(register: IKoseki): IKosekiEntry[] {
    return register.entries.filter(stands);
  }

  /** A birth: only of a body the record will hold by name. A herd's births are counts. */
  static bear(register: IKoseki, body: string, kind: string, parents: string[], at: number): IKoseki {
    return { ...register, entries: [...register.entries, { body, kind, word: 'child', enteredAt: at, parents }] };
  }

  /** The next to head this register: its eldest child or adopted, by the cycle they entered, then by id. */
  static nextHead(register: IKoseki): IKosekiEntry | undefined {
    return this.standing(register)
      .filter(e => HEIR_WORDS.includes(e.word))
      .sort((a, b) => a.enteredAt - b.enteredAt || (a.body < b.body ? -1 : a.body > b.body ? 1 : 0))[0];
  }

  /** A body leaves. Its entry stays, marked. A head that goes is followed, and with nobody to follow the line is extinct. */
  static exit(register: IKoseki, body: string, why: ExitWord, at: number): IKoseki {
    const entries = register.entries.map(e => (e.body === body && stands(e) ? { ...e, exitedAt: at, exit: why } : e));
    const after: IKoseki = { ...register, entries };
    if (register.head !== body) return after;
    const next = this.nextHead(after);
    if (!next) return { ...after, head: null, status: 'extinct' };
    return { ...after, head: next.body, entries: entries.map(e => (e.body === next.body && stands(e) ? { ...e, word: 'head' as const } : e)) };
  }

  /** A body moves to another register (D65's capture is one of these). It is out of one and into the other, in one step. */
  static adopt(from: IKoseki, to: IKoseki, body: string, parent: string, at: number): { from: IKoseki; to: IKoseki } {
    const entry = from.entries.find(e => e.body === body && stands(e));
    if (!entry) return { from, to };
    return {
      from: this.exit(from, body, 'adopted_out', at),
      to: { ...to, entries: [...to.entries, { body, kind: entry.kind, word: 'adopted', enteredAt: at, parents: [parent], from: from.id }] }
    };
  }

  /** Everyone a body came from on this register, nearest first. As far back as the line goes. */
  static lineage(register: IKoseki, body: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([body]);
    let frontier = [body];
    while (frontier.length > 0) {
      const parents = frontier.flatMap(b => register.entries.filter(e => e.body === b).flatMap(e => e.parents)).filter(p => !seen.has(p));
      parents.forEach(p => { seen.add(p); out.push(p); });
      frontier = parents;
    }
    return out;
  }
}

/**
 * THE USUAL (Pedro, 2026-11-06): "most cvonversations will be taken overby auto function very soon,
 * we can even code for it, \"hey glenda! want the usual?\" \"yes bob!\"". Then: "Build it now".
 *
 * Two people who meet the same way often enough stop needing a model to say how it went: it goes
 * the way it went last time. Every meeting writes a routine memory for both, who met whom, where and
 * over what, and the φ law rehearses it like anything else that recurs. Once both hold it at the
 * mark, the meeting replays what the last meeting the model wrote left behind: the mood, the words
 * each kept, and the lines, for anyone watching.
 *
 * It goes back to a model the moment something is new between them: something open between the
 * pair (a debt, a promise, a threat, a secret), either of them on a lower rung of the ladder than
 * when that meeting was written, a new goal, or the habit faded under the mark because they stopped
 * meeting. The bartender notices when Bob looks rough.
 *
 * Pure. Every number is a guess until Wave 12.
 */

import { AtomBook, IAtomBook } from '../memory/AtomBook';
import { IMind, IMemory, MemoryLaw, PHI_CAP, Role } from '../memory/MemoryLaw';
import { NpcContext } from '../memory/NpcContext';
import { IMeetSideWords } from '../../../shared/logic/systems/TalkTypes';
import { IMeetOutcome } from './MeetLaw';

/**
 * How firmly a routine must be held to be the usual: strength × (1 + gravity) at φ². At full
 * strength that is gravity at φ, the ledger bar, since φ² = φ + 1: a routine rehearsed into what the
 * donor law would make permanent. A routine left alone fades under it, the faster the newer it was.
 */
export const USUAL_MARK = PHI_CAP;

/** The slots that say which routine it is: who met whom, over what, where. The day is not one of them. */
const ROUTINE_ROLES: readonly Role[] = ['who', 'did', 'what', 'toWhom', 'where'];
const MET = 'met';

/** A meeting the model wrote, kept by the pair so the usual can say it again. Kept by id, so either can be a or b. */
export interface IUsual {
  sides: Record<string, IMeetSideWords>;
  lines: { by: string; text: string }[];
  /** Where each stood on the ladder, by index, and the goal each held, when it was written. */
  rung: Record<string, number>;
  goal: Record<string, string>;
  day: number;
}

/** Where someone stands now, as the usual compares it. */
export interface IStanding { rung: number; goal?: string }

export type HabitBreak = 'unwritten' | 'faded' | 'open' | 'fell' | 'goal';

export const HabitLaw = {
  /** The routine memory a meeting writes for one side: the other met them, here, over this. */
  routine(o: { day: number; owner: string; other: string; where: string; why: string }) {
    return {
      day: o.day,
      slots: { who: { person: o.other }, did: MET, what: o.why, toWhom: { person: o.owner }, when: `day ${o.day}`, where: o.where }
    };
  },

  /** Which pair and which routine: the same two, the same place, the same reason, whichever way round. */
  key(a: string, b: string, where: string, why: string): string {
    const [x, y] = a < b ? [a, b] : [b, a];
    return `habit|${x}|${y}|${AtomBook.runId(AtomBook.words(where))}|${AtomBook.runId(AtomBook.words(why))}`;
  },

  /** How firmly this person holds the routine with the other: the weakest of its slots, by strength × (1 + gravity). 0 if not held. */
  held(mind: IMind, other: string, where: string, why: string, today: number): number {
    const atoms: Partial<Record<Role, string>> = {
      who: AtomBook.personId(other), did: AtomBook.runId(AtomBook.words(MET)), what: AtomBook.runId(AtomBook.words(why)),
      toWhom: AtomBook.personId(mind.owner), where: AtomBook.runId(AtomBook.words(where))
    };
    const folded = MemoryLaw.fold(mind, today);
    const memory: IMemory | undefined = folded.memories.find(m => !m.ledger && ROUTINE_ROLES.every(r => m.slots[r]?.atom === atoms[r]));
    if (!memory) return 0;
    return Math.min(...ROUTINE_ROLES.map(r => { const s = memory.slots[r]; return s ? s.strength * (1 + s.gravity) : 0; }));
  },

  /**
   * Is this meeting the usual? Both must hold the routine at the mark, a meeting must have been
   * written to replay, nothing may be open between them, neither may stand lower than they did then,
   * and neither may have a new goal. The first thing that fails says why it goes to a model.
   */
  decide(o: {
    a: string; b: string; where: string; why: string; today: number;
    minds: Record<string, IMind>; book: IAtomBook;
    now: Record<string, IStanding>; last?: IUsual;
  }): { usual: true } | { usual: false; because: HabitBreak } {
    if (!o.last) return { usual: false, because: 'unwritten' };
    for (const [me, other] of [[o.a, o.b], [o.b, o.a]]) {
      if (this.held(o.minds[me], other, o.where, o.why, o.today) < USUAL_MARK) return { usual: false, because: 'faded' };
    }
    for (const [me, other] of [[o.a, o.b], [o.b, o.a]]) {
      if (NpcContext.toward(o.minds[me], o.book, other, o.today).open.length > 0) return { usual: false, because: 'open' };
    }
    for (const id of [o.a, o.b]) {
      const then = o.last.rung[id];
      if (then !== undefined && o.now[id] && o.now[id].rung < then) return { usual: false, because: 'fell' };
    }
    for (const id of [o.a, o.b]) {
      if ((o.now[id]?.goal ?? '') !== (o.last.goal[id] ?? '')) return { usual: false, because: 'goal' };
    }
    return { usual: true };
  },

  /** What the model wrote, kept to say again. A batch writes no lines, so the last lines anyone heard stand. */
  keep(outcome: IMeetOutcome, a: string, b: string, now: Record<string, IStanding>, day: number, before?: IUsual): IUsual {
    const lines = outcome.lines.length > 0 ? outcome.lines.map(l => ({ by: l.by === 'a' ? a : b, text: l.text })) : before?.lines ?? [];
    return {
      sides: { [a]: outcome.a, [b]: outcome.b }, lines,
      rung: { [a]: now[a]?.rung ?? 0, [b]: now[b]?.rung ?? 0 },
      goal: { [a]: now[a]?.goal ?? '', [b]: now[b]?.goal ?? '' },
      day
    };
  },

  /** The usual, said again, as an outcome for this meeting's a and b. */
  replay(usual: IUsual, id: string, a: string, b: string): IMeetOutcome {
    return {
      id, a: usual.sides[a], b: usual.sides[b],
      lines: usual.lines.filter(l => l.by === a || l.by === b).map(l => ({ by: l.by === a ? 'a' as const : 'b' as const, text: l.text }))
    };
  }
};

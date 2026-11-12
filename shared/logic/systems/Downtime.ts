/**
 * DOWNTIME: THE STACK (the design pass, part 5). Pedro, 2026-11-11: "This would open the possibility of downtime actions
 * for the clock in server idea, go to sleep and stack the actions the character will take." The server's clock is the
 * clock, and study is "always available for energy".
 *
 * A stack is laid where a character rests, at home, and never in the field or a dive. It holds what can be done at home
 * by hand with no live roll in front of the player: a sitting with a thing held or known, writing a held skill out, a
 * rest. How many acts it holds is a rule of the character: focus, the mind's attribute for holding to a plan, as how many
 * tonics a rest allows comes from endurance. It begins where the rest being taken ends.
 *
 * On return, the time between where the walk has reached and the clock's reading now is walked through the stack in
 * order. Each act asks what it asks by hand and takes its own time; an act is done only when the whole of its time fits,
 * and it pays and gives then, exactly as by hand. An act that cannot pay stops the walk there and says why, and it and
 * everything after it stay stacked; what does not fit yet stays too. The walk keeps only the moment its last act ended,
 * so returning twice within an hour does exactly what returning once after the hour does. Nothing here prices or gives
 * anything: the acts are handed in (`IDowntimeRules`), and they are the same functions a hand uses. Pure.
 */

import { IAttributes, IPlayer, IStudyTarget } from '../../types';

/** Where a stack is laid: the inn, or a bed of one's own. */
export type DowntimePlace = 'INN' | 'BED';

export type IDowntimeAct =
  | { kind: 'STUDY'; target: IStudyTarget }
  | { kind: 'WRITE'; skillId: string }
  | { kind: 'REST' };

export interface IDowntimeStack {
  place: DowntimePlace;
  /** The clock's moment it was laid. */
  laidAt: number;
  /** Where the walk has reached: where it begins, then the end of the last act done. */
  walkedTo: number;
  /** What is still to be done, in order. */
  acts: IDowntimeAct[];
}

/** What the acts are, handed in by whoever has the stores: the same functions a hand uses. */
export interface IDowntimeRules {
  /** What the act would ask if begun at `at`: its time, or why it cannot be begun. */
  ask(player: IPlayer, act: IDowntimeAct, at: number): { ok: true; ms: number } | { ok: false; reason: string };
  /** The act done, begun at `start` and ended at `end`: what it costs by hand paid, what it gives given, said in words. */
  take(player: IPlayer, act: IDowntimeAct, start: number, end: number): { player: IPlayer; said: string };
}

export interface IDowntimeAccount {
  done: { act: IDowntimeAct; at: number; said: string }[];
  stopped?: { act: IDowntimeAct; reason: string };
}

/** A stack holds this many acts at the floor of focus, and one more for every FOCUS_PER_ACT points of focus above 1. */
export const STACK_BASE = 3;
export const FOCUS_PER_ACT = 3;

/** What a sitting may be on, in a stack: a thing held (an item) or a thing known (a material by name). */
const STUDIED_AT_HOME: IStudyTarget['kind'][] = ['item', 'thing'];

type Verdict = { ok: boolean; reason?: string };

export const Downtime = {
  capacity(attributes?: IAttributes): number {
    return STACK_BASE + Math.floor(Math.max(0, (attributes?.focus ?? 1) - 1) / FOCUS_PER_ACT);
  },

  mayEnter(act: IDowntimeAct): Verdict {
    switch (act?.kind) {
      case 'STUDY':
        return STUDIED_AT_HOME.includes(act.target?.kind)
          ? { ok: true }
          : { ok: false, reason: `${act.target?.name ?? 'That'} is not in front of you at home. Only what you hold or know can wait in a stack.` };
      case 'WRITE':
      case 'REST':
        return { ok: true };
      default:
        return { ok: false, reason: 'Only a sitting, a writing out or a rest can wait in a stack.' };
    }
  },

  /** Laid at a resting place, at home. It begins where the rest being taken ends, or at once. */
  lay(player: IPlayer, place: DowntimePlace, acts: IDowntimeAct[], at: number): { ok: boolean; reason?: string; stack?: IDowntimeStack } {
    if (player.currentSession) return { ok: false, reason: 'Nothing is stacked out here. It is laid where you rest, at home.' };
    const holds = this.capacity(player.attributes);
    if (acts.length > holds) return { ok: false, reason: `Your focus holds ${holds} things to do while you are away. That is ${acts.length}.` };
    for (const act of acts) {
      const verdict = this.mayEnter(act);
      if (!verdict.ok) return { ok: false, reason: verdict.reason };
    }
    const begins = Math.max(at, player.rest?.until ?? 0);
    return { ok: true, stack: { place, laidAt: at, walkedTo: begins, acts: [...acts] } };
  },

  /** The time from where the walk reached to the reading `now`, walked through the stack in order. */
  walk(player: IPlayer, stack: IDowntimeStack, now: number, rules: IDowntimeRules): { player: IPlayer; stack: IDowntimeStack; account: IDowntimeAccount } {
    let current = player;
    let t = stack.walkedTo;
    const left = [...stack.acts];
    const account: IDowntimeAccount = { done: [] };
    while (left.length > 0 && t < now) {
      const act = left[0];
      const asked = rules.ask(current, act, t);
      if ('reason' in asked) {
        account.stopped = { act, reason: asked.reason };
        break;
      }
      const end = t + Math.max(0, asked.ms);
      if (end > now) break;
      const taken = rules.take(current, act, t, end);
      current = taken.player;
      account.done.push({ act, at: end, said: taken.said });
      left.shift();
      t = end;
    }
    return { player: current, stack: { ...stack, walkedTo: t, acts: left }, account };
  }
};

/**
 * DOWNTIME: THE STACK (the design pass, part 5a). Registered before the build.
 *
 * Pedro, 2026-11-11: "This would open the possibility of downtime actions for the clock in server idea, go to sleep and
 * stack the actions the character will take." The server's clock is the clock, and study is "always available for energy".
 *
 * The rule, pure and in `shared/` (ledger DP5): a stack is laid where a character rests, at home, never in the field; it
 * holds what can be done at home by hand with no live roll in front of the player (a sitting with a thing held or known,
 * writing a held skill out, a rest); how many acts it holds is a rule of the character, from focus, the way how many tonics
 * a rest allows comes from endurance; on return, the time between the clock's two readings is walked through it in order,
 * each act taking its own time and costing and giving what it does by hand (the acts themselves are handed in, so this
 * module never prices anything); an act that cannot pay stops the walk there and says why; what does not fit stays.
 * Returning twice within an hour does exactly what returning once after the hour does.
 */

import { describe, it, expect } from 'vitest';
import { IPlayer, IStudyTarget } from '../shared/types';
import { Downtime, IDowntimeAct, IDowntimeRules, STACK_BASE, FOCUS_PER_ACT } from '../shared/logic/systems/Downtime';

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;
const home = (energy = 50, focus = 1, over: Partial<IPlayer> = {}): IPlayer => ({
  id: 'p_away', attributes: { focus } as IPlayer['attributes'], currentSession: undefined, energyToday: energy,
  bank: { universalSkills: {}, stashTabs: [], loreHeld: 0, gold: 100 }, ...over
} as unknown as IPlayer);

const thing = (id: string): IStudyTarget => ({ kind: 'thing', ref: id, name: id, tags: [] });
const study = (id: string): IDowntimeAct => ({ kind: 'STUDY', target: thing(id) });

/** A stand-in for the acts: a sitting asks 10 energy and 20 minutes, a rest gives it all back over 30 minutes, and every act is logged. */
const rules: IDowntimeRules = {
  ask(player, act) {
    if (act.kind === 'REST') return { ok: true, ms: 30 * 60_000 };
    const left = player.energyToday ?? 0;
    return left < 10 ? { ok: false, reason: `Refused: needs 10 energy, you hold ${left}. Rest first.` } : { ok: true, ms: 20 * 60_000 };
  },
  take(player, act, start, end) {
    const log = [...((player as unknown as { log?: string[] }).log ?? []), `${act.kind}@${start}-${end}`];
    if (act.kind === 'REST') return { player: { ...player, energyToday: 50, log } as unknown as IPlayer, said: 'You rested.' };
    return { player: { ...player, energyToday: (player.energyToday ?? 0) - 10, log } as unknown as IPlayer, said: `You sat with ${act.kind === 'STUDY' ? act.target.name : 'it'}.` };
  }
};

describe('how many acts a stack holds is a rule of the character: focus, as endurance is for tonics', () => {
  it(`${STACK_BASE} at the floor, and one more for every ${FOCUS_PER_ACT} points of focus above 1`, () => {
    expect(Downtime.capacity(undefined)).toBe(STACK_BASE);
    expect(Downtime.capacity({ focus: 1 } as IPlayer['attributes'])).toBe(STACK_BASE);
    expect(Downtime.capacity({ focus: 1 + FOCUS_PER_ACT } as IPlayer['attributes'])).toBe(STACK_BASE + 1);
    expect(Downtime.capacity({ focus: 1 + 2 * FOCUS_PER_ACT } as IPlayer['attributes'])).toBe(STACK_BASE + 2);
  });
});

describe('what may enter a stack: what is done at home by hand with no live roll', () => {
  it('a sitting with a thing held or known, writing a held skill out, and a rest', () => {
    expect(Downtime.mayEnter(study('log')).ok).toBe(true);
    expect(Downtime.mayEnter({ kind: 'STUDY', target: { kind: 'item', ref: 'itm_1', name: 'A piece', tags: [] } }).ok).toBe(true);
    expect(Downtime.mayEnter({ kind: 'WRITE', skillId: 'skill_axe+wood' }).ok).toBe(true);
    expect(Downtime.mayEnter({ kind: 'REST' }).ok).toBe(true);
  });

  it('nothing of the field or a dive, and no one: a creature, a place, a person', () => {
    for (const kind of ['creature', 'place', 'person', 'building'] as const) {
      expect(Downtime.mayEnter({ kind: 'STUDY', target: { kind, ref: 'x', name: 'x', tags: [] } }).ok).toBe(false);
    }
    expect(Downtime.mayEnter({ kind: 'DIVE' } as unknown as IDowntimeAct).ok).toBe(false);
  });
});

describe('a stack is laid where the character rests, at home', () => {
  it('never in the field', () => {
    const out = home(50, 1, { currentSession: { inventory: [], energy: 50 } } as unknown as Partial<IPlayer>);
    expect(Downtime.lay(out, 'INN', [study('log')], T0)).toMatchObject({ ok: false });
  });

  it('no more acts than the character holds, and nothing that may not enter', () => {
    expect(Downtime.lay(home(), 'BED', [study('a'), study('b'), study('c'), study('d')], T0)).toMatchObject({ ok: false });
    expect(Downtime.lay(home(), 'BED', [{ kind: 'STUDY', target: { kind: 'creature', ref: 'x', name: 'x', tags: [] } }], T0)).toMatchObject({ ok: false });
  });

  it('laid, it begins where the rest being taken ends, or at once', () => {
    const now = Downtime.lay(home(), 'BED', [study('a')], T0);
    expect(now).toMatchObject({ ok: true, stack: { place: 'BED', laidAt: T0, walkedTo: T0, acts: [study('a')] } });
    const resting = home(50, 1, { rest: { until: T0 + HOUR, place: 'INN', startedAt: T0 } } as Partial<IPlayer>);
    expect(Downtime.lay(resting, 'INN', [study('a')], T0)).toMatchObject({ ok: true, stack: { walkedTo: T0 + HOUR } });
  });
});

describe('the walk through the stack, between two readings of the clock', () => {
  const laid = () => (Downtime.lay(home(25), 'BED', [study('a'), study('b'), { kind: 'REST' }], T0) as { stack: NonNullable<ReturnType<typeof Downtime.lay>['stack']> }).stack;

  it('in order, each act its own time: what fits is done, what does not stays', () => {
    const out = Downtime.walk(home(25), laid(), T0 + 30 * 60_000, rules);
    expect(out.account.done.map(d => d.at)).toEqual([T0 + 20 * 60_000]);
    expect(out.stack.acts).toEqual([study('b'), { kind: 'REST' }]);
    expect(out.stack.walkedTo).toBe(T0 + 20 * 60_000);
    expect(out.player.energyToday).toBe(15);
  });

  it('an act that cannot pay stops the stack there and says why; it and what follows stay, and no time is spent on it', () => {
    const out = Downtime.walk(home(15), Downtime.lay(home(15), 'BED', [study('a'), study('b'), { kind: 'REST' }], T0).stack!, T0 + 5 * HOUR, rules);
    expect(out.account.done.length).toBe(1);
    expect(out.account.stopped).toEqual({ act: study('b'), reason: 'Refused: needs 10 energy, you hold 5. Rest first.' });
    expect(out.stack.acts).toEqual([study('b'), { kind: 'REST' }]);
    expect(out.stack.walkedTo).toBe(T0 + 20 * 60_000);
  });

  it('a rest in the stack gives back what a rest gives, and what follows it can pay again', () => {
    const stack = Downtime.lay(home(10), 'BED', [study('a'), { kind: 'REST' }, study('b')], T0).stack!;
    const out = Downtime.walk(home(10), stack, T0 + 5 * HOUR, rules);
    expect(out.account.done.map(d => d.said)).toEqual(['You sat with a.', 'You rested.', 'You sat with b.']);
    expect(out.stack.acts).toEqual([]);
    expect(out.player.energyToday).toBe(40);
  });

  it('returning twice within an hour does exactly what returning once after the hour does', () => {
    const once = Downtime.walk(home(25), laid(), T0 + HOUR, rules);
    const first = Downtime.walk(home(25), laid(), T0 + 25 * 60_000, rules);
    const second = Downtime.walk(first.player, first.stack, T0 + HOUR, rules);
    expect(second.player).toEqual(once.player);
    expect(second.stack).toEqual(once.stack);
    expect([...first.account.done, ...second.account.done]).toEqual(once.account.done);
  });

  it('before the stack begins nothing happens, and a reading behind the walk moves nothing back', () => {
    const resting = home(25, 1, { rest: { until: T0 + HOUR, place: 'BED', startedAt: T0 } } as Partial<IPlayer>);
    const stack = Downtime.lay(resting, 'BED', [study('a')], T0).stack!;
    const early = Downtime.walk(resting, stack, T0 + 30 * 60_000, rules);
    expect(early.account.done).toEqual([]);
    expect(early.stack).toEqual(stack);
    const after = Downtime.walk(home(25), laid(), T0 + HOUR, rules);
    const behind = Downtime.walk(after.player, after.stack, T0, rules);
    expect(behind.stack).toEqual(after.stack);
    expect(behind.account.done).toEqual([]);
  });
});

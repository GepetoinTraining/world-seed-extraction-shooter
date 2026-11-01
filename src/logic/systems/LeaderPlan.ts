/**
 * A LEADER'S PLAN (D93, D103): a model's words, and the law they stand before.
 *
 * A plan is `{ verb, target, name, why }` a decision. It names and aims actions in a world's voice,
 * and the numbers stay with the formula. A verb with no reader is refused, a verb this species
 * cannot do is refused, and anything else a model adds never reaches the record.
 *
 * THE SEAM: the call itself waits on C2's hook (D116), so `waiting` asks for nothing yet. Pedro's
 * ruling moves it out of the scan window: the weekly call goes out in maintenance (`Maintenance`),
 * so this ask joins `MAINTENANCE_ASKS` and not `ASK_KINDS`. It has the same shape as any other ask,
 * and with no answer the code's own rule picks, so a world with no key still grows.
 */

import { ILeaderState } from '../../entities/world/Population';
import { Territory, VERBS, Verb } from '../../entities/world/Territory';
import { IAskKind } from './ScanPass';

export interface IPlanDecision {
  verb: string;
  target: string;
  name: string;
  why: string;
}

export interface IPlanVerdict {
  decisions: IPlanDecision[];
  refused: { verb: string; reason: string }[];
}

const says = (value: unknown) => (typeof value === 'string' ? value : '');

export class LeaderPlan {

  /** What stands of a plan. Named field by field, so nothing a model adds can ride along. */
  static judge(plan: { decisions?: unknown }, leader: Pick<ILeaderState, 'id'>, kind: { builds?: boolean }): IPlanVerdict {
    const asked = Array.isArray(plan?.decisions) ? (plan.decisions as Record<string, unknown>[]) : [];
    const allowed = Territory.verbsFor(kind);
    const verdict: IPlanVerdict = { decisions: [], refused: [] };
    for (const d of asked) {
      const verb = says(d?.verb);
      if (!(VERBS as readonly string[]).includes(verb)) {
        verdict.refused.push({ verb, reason: `"${verb}" has no reader, so ${leader.id} cannot do it.` });
      } else if (!allowed.includes(verb as Verb)) {
        verdict.refused.push({ verb, reason: `"${verb}" is not something what ${leader.id} is can do.` });
      } else {
        verdict.decisions.push({ verb, target: says(d.target), name: says(d.name), why: says(d.why) });
      }
    }
    return verdict;
  }
}

/** The weekly ask, ready for its door. Nothing waits on it until C2's hook is in. */
export const LEADER_ASK: IAskKind = {
  kind: 'leader',
  perBatch: 4,
  waiting: () => [],
  asks: () => [],
  settle: record => Promise.resolve({ record, installed: [], refused: [] })
};

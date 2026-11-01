/**
 * THE AGENDA: what any person in the city wants today, the code every NPC stands on.
 *
 * Pattern from the donor, engine/npc-agenda.ts: five needs fall with the days, what a
 * person does fills them, and the most pressing one is their goal. Everything here is a
 * pure fold of the days, so a city nobody watched catches up on opening, to the same
 * place it would have reached watched. Nothing is rolled and no model is called.
 *
 * What a goal does is the business of whoever holds the agenda. Every number is a guess
 * until Wave 12.
 */

export const NEEDS = ['survival', 'safety', 'belonging', 'esteem', 'purpose'] as const;
export type NeedKind = typeof NEEDS[number];

export interface INpcAgenda {
  needs: Record<NeedKind, number>;
  /** The last day this was folded to. */
  day: number;
}

export type INeedFill = Partial<Record<NeedKind, number>>;

const START: Record<NeedKind, number> = { survival: 70, safety: 60, belonging: 50, esteem: 40, purpose: 30 };
const DECAY: Record<NeedKind, number> = { survival: 5, safety: 2, belonging: 1, esteem: 1, purpose: 1 };
const PRESSING_BELOW = 50;
const clampNeed = (value: number) => Math.max(0, Math.min(100, value));

export const NpcAgenda = {
  fresh(day: number): INpcAgenda {
    return { needs: { ...START }, day };
  },

  /** What is done now, once. */
  fill(agenda: INpcAgenda, fill: INeedFill): INpcAgenda {
    const needs = { ...agenda.needs };
    for (const need of NEEDS) needs[need] = clampNeed(needs[need] + (fill[need] ?? 0));
    return { ...agenda, needs };
  },

  /** Each day up to today, in turn: what fell, then what the day's work gave back. */
  fold(agenda: INpcAgenda, today: number, daily: INeedFill = {}): INpcAgenda {
    if (today <= agenda.day) return agenda;
    const needs = { ...agenda.needs };
    for (let d = agenda.day; d < today; d++) {
      for (const need of NEEDS) needs[need] = clampNeed(needs[need] - DECAY[need] + (daily[need] ?? 0));
    }
    return { needs, day: today };
  },

  /** The lowest tier under half, or failing that whatever is lowest. */
  pressing(agenda: INpcAgenda): NeedKind {
    const under = NEEDS.find(need => agenda.needs[need] < PRESSING_BELOW);
    return under ?? NEEDS.reduce((low, need) => agenda.needs[need] < agenda.needs[low] ? need : low, NEEDS[0]);
  }
};

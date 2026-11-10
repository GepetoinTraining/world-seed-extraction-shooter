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

/**
 * THE LADDER (D104, D116). Pedro: "the goal only comes into play after they've achieved the 5th
 * scale of maslows. own a house, have more money than need, have a wife or husband and children".
 * People only: elites and bosses keep the goal D93 deals them.
 *
 * It climbs in his order, which is not the order of NEEDS, and `pressing` keeps what the vendors
 * have always read. `fact` names what can be known of a person outright, so a resident with no
 * house has no house whatever a number says.
 */
export const LADDER: readonly { need: NeedKind; says: string; fact?: keyof ILadderFacts }[] = [
  // W6: each rung's words finish "Working toward …" and "They are after …" as a sentence
  { need: 'survival', says: 'being fed' },
  { need: 'safety', says: 'a house of their own', fact: 'house' },
  { need: 'esteem', says: 'more money than they need', fact: 'money' },
  { need: 'belonging', says: 'a spouse and children', fact: 'family' },
  { need: 'purpose', says: 'a goal of their own' }
];

/** What is known of a person outright. Anything left out reads from their needs. */
export interface ILadderFacts { house?: boolean; money?: boolean; family?: boolean }

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
  },

  /** Is this rung met, by what is known, or else by the number? */
  met(agenda: INpcAgenda, rung: typeof LADDER[number], facts: ILadderFacts = {}): boolean {
    const known = rung.fact ? facts[rung.fact] : undefined;
    return known ?? agenda.needs[rung.need] >= PRESSING_BELOW;
  },

  /** The first rung not met. Everyone stands on one, and the top one is their own goal. */
  rung(agenda: INpcAgenda, facts: ILadderFacts = {}): typeof LADDER[number] {
    return LADDER.find(rung => !this.met(agenda, rung, facts)) ?? LADDER[LADDER.length - 1];
  },

  /** What a day takes from a need. Other folds weigh their own fills against it. */
  dailyFall(need: NeedKind): number {
    return DECAY[need];
  },

  /** Q20: a day fed holds survival where it stood. What a day eaten gives back is what a day takes. */
  fed(): INeedFill {
    return { survival: DECAY.survival };
  },

  /** D104: a goal of their own comes only once everything under it stands. */
  mayChase(agenda: INpcAgenda, facts: ILadderFacts = {}): boolean {
    return this.rung(agenda, facts).need === 'purpose';
  }
};

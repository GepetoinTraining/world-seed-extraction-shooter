/**
 * THE LORE RULE (the lore pass, BALANCE_RUN.md 3.8; its calls made on Pedro's word, 2026-11-11: "is there any reason for
 * you to not make the calls? ... so I guess you truly can make the calls").
 *
 * Pedro, the same day: "lore should be slower than exp but fixed... like, a person should be able to target farm lore
 * itself". "It needs to use the d100 idea and scales for what the roll gives you, you never lose lore, but we can add a
 * debuff for a critical failure that you miss read something, it shows up as a high lore amount and decreases over new
 * lore read." And of what a misreading holds back: "in the same category yes, general lore no, and general lore is the
 * overall resource".
 *
 * So: a roll's stretch pays a fixed share of the thing's base. Two thirds go to the thing's category and the rest is
 * general (`bank.loreHeld`, the purse, as it always was). A misreading sits in its category and locks it until new lore
 * of that category wears it down; nothing held is ever taken away. Pure: banks in, banks out.
 */

import { ILoreKind, StudyOutcome } from '../../types';
import {
  LORE_CATEGORY_SHARE, LORE_FAIR_LINE, LORE_MISREAD_TIMES, LORE_PER_SITTING, LORE_RANK_GROWTH, LORE_STRETCHES, LoreStretch
} from './LoreConstants';

export { LORE_STRETCHES };
export type { LoreStretch };

type Purse = { loreHeld?: number; loreKinds?: Record<string, ILoreKind> };
type Category = { key: string; name: string } | null | undefined;

/** How far past a hundred makes each further share of insight. */
const INSIGHT_STEP = 15;
const STRETCH_TIMES: Record<Exclude<LoreStretch, 'insight'>, number> = { misread: 0, little: 0.5, fair: 1, deep: 2 };
const OUTCOME_OF: Record<LoreStretch, StudyOutcome> = { misread: 'major_failure', little: 'failure', fair: 'success', deep: 'major_win', insight: 'major_win' };
const STRETCH_OF_OUTCOME: Record<StudyOutcome, LoreStretch> = { major_failure: 'misread', failure: 'little', success: 'fair', major_win: 'deep' };

export const LoreLaw = {
  /** What a fair reading of a thing of this rank pays. No rank is the top of it. */
  base(rankIndex: number): number {
    return LORE_PER_SITTING * Math.pow(LORE_RANK_GROWTH, Math.max(0, rankIndex));
  },

  /** The stretch a total falls in, read as if the bar stood at the fair line, and the share of the base it pays. */
  stretchOf(total: number): { stretch: LoreStretch; times: number } {
    if (total <= 5) return { stretch: 'misread', times: 0 };
    if (total <= LORE_FAIR_LINE - 1) return { stretch: 'little', times: STRETCH_TIMES.little };
    if (total <= 85) return { stretch: 'fair', times: STRETCH_TIMES.fair };
    if (total <= 100) return { stretch: 'deep', times: STRETCH_TIMES.deep };
    return { stretch: 'insight', times: 3 + Math.floor((total - 101) / INSIGHT_STEP) };
  },

  /** The share a stretch pays at its least. */
  timesOf(stretch: LoreStretch): number {
    return stretch === 'insight' ? 3 : STRETCH_TIMES[stretch];
  },

  /** What happens to the thing studied keeps today's four ways, paired with the stretches. */
  outcomeOf(stretch: LoreStretch): StudyOutcome {
    return OUTCOME_OF[stretch];
  },

  /** A roll given only as an outcome (a sitting logged before this): the stretch it pairs with. */
  stretchOfOutcome(outcome: StudyOutcome): { stretch: LoreStretch; times: number } {
    const stretch = STRETCH_OF_OUTCOME[outcome] ?? 'fair';
    return { stretch, times: this.timesOf(stretch) };
  },

  /** What a sitting pays: a fixed share of its base, times what the thing is (a document, paper). */
  pay(rankIndex: number, times: number, factor = 1): number {
    return Math.round(this.base(rankIndex) * times * factor);
  },

  /** A misreading of a thing of this rank. */
  misreadOf(rankIndex: number): number {
    return Math.round(this.base(rankIndex) * LORE_MISREAD_TIMES);
  },

  /** Two thirds, rounded down, to the category; the rest general. A thing with no category pays all general. */
  split(amount: number, hasCategory: boolean): { category: number; general: number } {
    const category = hasCategory ? Math.floor(amount * LORE_CATEGORY_SHARE) : 0;
    return { category, general: amount - category };
  },

  general(purse: Purse): number {
    return purse.loreHeld ?? 0;
  },

  /** What a category shows: what is held, and any misreading on top of it, which reads as lore. */
  shown(kind: Pick<ILoreKind, 'held' | 'misread'>): number {
    return kind.held + kind.misread;
  },

  /** What can be spent on something of this category: general lore, and the category's own unless a misreading locks it. */
  spendable(purse: Purse, key: string | null | undefined): number {
    const kind = key ? purse.loreKinds?.[key] : undefined;
    return this.general(purse) + (kind && kind.misread <= 0 ? kind.held : 0);
  },

  /** Everything that could be spent on something, each category as if it were what is bought. */
  reach(purse: Purse): number {
    return this.general(purse) + Object.values(purse.loreKinds ?? {}).reduce((sum, k) => sum + (k.misread <= 0 ? k.held : 0), 0);
  },

  /**
   * Lore read. The category's share wears a misreading down by as much and is kept; then any new misreading is set on
   * it. Nothing held goes down. A thing with no category pays all general and has nowhere for a misreading to sit.
   */
  credit<T extends Purse>(purse: T, category: Category, amount: number, misread: number): T {
    const { category: share, general } = this.split(Math.max(0, amount), !!category);
    const out: T = { ...purse, loreHeld: this.general(purse) + general };
    if (!category) return out;
    const prior = purse.loreKinds?.[category.key] ?? { key: category.key, name: category.name, held: 0, misread: 0 };
    const kind: ILoreKind = { ...prior, held: prior.held + share, misread: Math.max(0, prior.misread - share) + Math.max(0, misread) };
    return { ...out, loreKinds: { ...(purse.loreKinds ?? {}), [category.key]: kind } };
  },

  /** A price paid: from its own category first, if nothing locks it, then from general. Null when it cannot be met. */
  spend<T extends Purse>(purse: T, key: string | null | undefined, price: number): T | null {
    if (this.spendable(purse, key) < price) return null;
    const kind = key ? purse.loreKinds?.[key] : undefined;
    const fromKind = kind && kind.misread <= 0 ? Math.min(kind.held, price) : 0;
    const out: T = { ...purse, loreHeld: this.general(purse) - (price - fromKind) };
    return kind && fromKind > 0 ? { ...out, loreKinds: { ...(purse.loreKinds ?? {}), [kind.key]: { ...kind, held: kind.held - fromKind } } } : out;
  }
};

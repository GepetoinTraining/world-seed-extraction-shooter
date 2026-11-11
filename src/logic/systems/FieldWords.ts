/**
 * WHAT THE FEED SAYS about a thing done in the field. Pure, so a bar can read the words, and so
 * a line never promises what the books did not do.
 */

import { StatSystem } from '../../../shared/logic/systems/StatSystem';

export type FeedTone = 'plain' | 'signal' | 'proof' | 'loss';

export const FieldWords = {
  /**
   * N13: a first try at something the hands do not know. Only some roads charge more for it
   * (gathering takes half again the energy), so only those say so.
   */
  winging(skillName: string, costly: boolean): string {
    return costly
      ? `Winging it: ${skillName}. It costs more without the skill, and it counts toward it.`
      : `Winging it: ${skillName}. Your hands do not know it yet, and doing it counts toward it.`;
  },

  /**
   * N14: a thing used says what it did. A scroll restores nothing and is read, so it says read;
   * nothing ever says "+0 health".
   */
  consumed(used: { name: string; restore: number; refill: number; casts: boolean; fromBelt?: boolean }): { text: string; tone: FeedTone } {
    const { name, restore, refill, casts } = used;
    const what = restore > 0 ? `+${restore} health.`
      : restore < 0 ? `${restore} health. It cured something else.`
      : refill > 0 ? `+${refill} energy.`
      : casts ? 'read.'
      : 'used.';
    const tone: FeedTone = restore < 0 ? 'loss' : restore === 0 && refill > 0 ? 'proof' : 'signal';
    return { text: used.fromBelt ? `${name}, straight from the belt: ${what} The pack never opened.` : `${name}: ${what}`, tone };
  },

  /**
   * 2026-11-11: a tonic says what it gave and what it cost, in the rest's plain voice. Pedro: tonics
   * "give debuffs as side effects for using".
   */
  tonic(drunk: { name: string; gave: number; slow: number; fromBelt?: boolean }): { text: string; tone: FeedTone } {
    const gave = drunk.gave > 0 ? `+${drunk.gave} energy.` : 'Your day was already full, so it gave nothing.';
    const cost = `Your legs grow heavy: you walk ${Math.round(drunk.slow * 100)}% slower until you rest.`;
    const where = drunk.fromBelt ? `${drunk.name}, straight from the belt` : drunk.name;
    return { text: `${where}: ${gave} ${cost}`, tone: 'signal' };
  },

  /** The body's limit, said plainly. The tonic is kept. */
  tonicRefused(name: string, allowed: number): string {
    const many = allowed === 1 ? 'one tonic' : `${allowed} tonics`;
    return `You keep the ${name}. Your body takes ${many} between rests, and you have had ${allowed === 1 ? 'it' : 'them'}. Rest first.`;
  },

  /** What the field shows while the side effect stands: a mark and a word. Nothing when none stands. */
  tonicMark(tonics: number): string | null {
    if (tonics <= 0) return null;
    const slow = Math.round(StatSystem.tonicSlow(tonics) * 100);
    return `▼ TONICS ${tonics}: ${slow}% SLOWER UNTIL YOU REST`;
  }
};

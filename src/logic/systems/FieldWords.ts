/**
 * WHAT THE FEED SAYS about a thing done in the field. Pure, so a bar can read the words, and so
 * a line never promises what the books did not do.
 */

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
  }
};

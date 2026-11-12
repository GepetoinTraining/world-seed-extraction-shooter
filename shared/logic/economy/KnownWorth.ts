/**
 * WHAT IS KNOWN OF A THING IS WORTH SOMETHING (PR, part 2). Pedro, 2026-11-12, on seeing what three materials do: "the
 * price of something known should increase as well, right now the economy is static".
 *
 * A price has two parts: what the thing is (the law as it stood: weight and hardness, the chain, a piece's power) and
 * what is known of it. What a material does, once written (`MaterialDoing`), is worth the share its band is of a piece
 * in the piece law: a minor doing a twelfth more, a moderate a sixth, a major a third, the share a property of that band
 * adds to a piece (`BAND_SHARE`). No number of its own: the band is the doing's, the share is the law's.
 *
 * It is read when a thing comes to be and written on it: a raw material's line in its composition carries the band it
 * was taken at, and the price law's own sum reads that line wherever the material goes. So what exists keeps the worth
 * it came to be with (Pedro: "once something exists it's determined"), and a doing written later raises only what is
 * taken, made, found or listed after it. Pure, but for the one book of what has been written.
 */

import { BAND_SHARE } from '../theme/ThemeTypes';
import { DoingBand, DoingBook } from '../systems/MaterialDoing';
import type { IComposition } from '../../types';

export const KnownWorth = {
  /** The band what this material does was written at, if it has been written. */
  bandOf(materialId: string): DoingBand | undefined {
    return DoingBook.of(materialId)?.band;
  },

  /** What being known adds, as a share of what the thing is: its band's share of a piece, or nothing. */
  share(band?: DoingBand | null): number {
    return band ? BAND_SHARE[band] : 0;
  },

  /** A raw thing's worth with what is known of it, in whole coin. Unknown, it is what it always was. */
  of(worth: number, band?: DoingBand | null): number {
    return band ? Math.max(1, Math.round(worth * (1 + this.share(band)))) : worth;
  },

  /** Whether anything it is made of was known when it was taken. */
  inComposition(c?: Pick<IComposition, 'materials'>): boolean {
    return !!c?.materials.some(m => m.known);
  }
};

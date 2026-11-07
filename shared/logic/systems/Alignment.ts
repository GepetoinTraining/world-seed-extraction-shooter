/**
 * ALIGNMENT (D116). Pedro: "use D&D, we'll introduce infamy later", and "every npc is a homo
 * economicus... they simply have alignments that gate certain actions from them, and we're not
 * coding crime".
 *
 * So it is a word on the sheet and it refuses, and that is all it does. Nothing watches, nothing
 * punishes and nothing remembers. There is no table of what each word refuses: an action says
 * what it does to a given word and what it does to somebody else, and each axis reads that.
 */

import { Rng } from '../rng/DeterministicRNG';
import { HARM_BANDS, IMeans, PROMISE_BANDS } from './TalkTypes';

const LAW_AXIS = ['lawful', 'neutral', 'chaotic'] as const;
const GOOD_AXIS = ['good', 'neutral', 'evil'] as const;

const wordOf = (law: string, good: string) => (law === 'neutral' && good === 'neutral' ? 'true neutral' : `${law} ${good}`);

export const ALIGNMENTS: readonly string[] = LAW_AXIS.flatMap(law => GOOD_AXIS.map(good => wordOf(law, good)));

/** How far along a band each place on an axis will go. The first band is always fine. */
const STANDS: Record<string, number> = { lawful: 0, good: 0, neutral: 1, chaotic: 2, evil: 2 };

export const Alignment = {
  /** The deal, under its own stream, so nothing already dealt moves. */
  deal(key: string): string {
    const rng = Rng.fromKey(`${key}:alignment`);
    return wordOf(rng.pick([...LAW_AXIS]), rng.pick([...GOOD_AXIS]));
  },

  axes(word: string): { law: string; good: string } {
    if (word === 'true neutral') return { law: 'neutral', good: 'neutral' };
    const [law, good] = word.split(' ');
    return { law, good };
  },

  /** Null if they would. Otherwise what stops them, in plain words. */
  refuses(word: string, means: IMeans): string | null {
    const { law, good } = this.axes(word);
    if (PROMISE_BANDS.indexOf(means.promise) > STANDS[law]) return `A ${word} person will not go back on their word like that.`;
    if (HARM_BANDS.indexOf(means.harm) > STANDS[good]) return `A ${word} person will not do that to someone for gain.`;
    return null;
  }
};

/**
 * WHAT THE MODEL IS GIVEN OF A PERSON (Pedro, 2026-11-06): "It shouldn't show it to anyone, that's
 * what context provider needs to mount for haiku, he gets the summary of the NPC and their goals,
 * what they want, how they feel about who's talking to them."
 *
 * So memory is never on screen. It reaches a model only through here: what comes to mind (recall),
 * and how they stand with whoever is in front of them, read from what they remember of that person.
 * The summary (the sheet's surface), the goal and the want are the caller's, and pass through.
 *
 * The same mount serves a person talking to them and, later, another NPC talking to them: the
 * speaker is an entity id either way. Pure.
 */

import { IMemoryLine, IToward } from '../systems/TalkTypes';
import { IAtomBook } from './AtomBook';
import { AtomBook } from './AtomBook';
import { IMind, MemoryLaw, PHI_FLOW, ROLES } from './MemoryLaw';

export interface IMounted {
  memory: IMemoryLine[];
  toward: IToward;
}

/** Everyone a mind holds, but its owner. */
function peopleIn(mind: IMind, book: IAtomBook): string[] {
  const out = new Set<string>();
  for (const m of mind.memories) for (const r of ROLES) {
    const slot = m.slots[r];
    if (!slot) continue;
    for (const key of slot.keys) {
      const entity = book.people[key];
      if (entity !== undefined && entity !== mind.owner) out.add(entity);
    }
  }
  return [...out];
}

export const NpcContext = {
  /**
   * How they stand with the speaker. A stranger is someone nothing they remember holds. Someone
   * weighing at least φ⁻¹ of the heaviest person they remember is well known; anyone else is known.
   * Relative to their own life, so a keeper who sees a crowd a day and a hermit who sees nobody both
   * read right. My call; Pedro may overrule.
   */
  toward(mind: IMind, book: IAtomBook, speaker: string, today: number, name?: (id: string) => string | undefined): IToward {
    const folded = MemoryLaw.fold(mind, today);
    const regard = MemoryLaw.regard(folded, speaker, today);
    const atom = AtomBook.personId(speaker);
    const open = folded.memories
      .filter(m => m.ledger?.open && ROLES.some(r => m.slots[r]?.keys.includes(atom)))
      .map(m => MemoryLaw.words(m, book, name));
    if (regard <= 0) return { knows: 'stranger', open };
    const heaviest = Math.max(...peopleIn(folded, book).map(p => MemoryLaw.regard(folded, p, today)));
    return { knows: regard >= PHI_FLOW * heaviest ? 'well known' : 'known', open };
  },

  /** What a model is given of this person's mind, facing this speaker, as this was just said. */
  mount(o: { mind: IMind; book: IAtomBook; today: number; speaker: string; said?: string; name?: (id: string) => string | undefined }): IMounted {
    const memory = MemoryLaw.recall(o.mind, o.book, o.today, { people: [o.speaker], words: o.said ? [o.said] : [] })
      .map(m => MemoryLaw.words(m, o.book, o.name));
    return { memory, toward: this.toward(o.mind, o.book, o.speaker, o.today, o.name) };
  }
};

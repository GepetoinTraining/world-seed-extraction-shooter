/**
 * WHERE MEMORIES ARE KEPT. A city person's mind is a record beside their talk record, in the store
 * the talk already uses (`mind_${hubId}_${npcId}` next to `talk_${hubId}_${npcId}`), and the city's
 * book of words is one record of its own (`book_${hubId}`). A person or monster in the field keeps
 * theirs as long as the world keeps their talk log: this session.
 *
 * The law is MemoryLaw's and the words are AtomBook's. This file only loads, writes in day order,
 * and saves, one write at a time per place, so two folds never race over the same book.
 */

import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { emptyBook, IAtomBook } from '../../logic/memory/AtomBook';
import { freshMind, IMind, IRecalled, IRemembering, MemoryLaw } from '../../logic/memory/MemoryLaw';
import { Deeds } from '../../logic/memory/Deeds';
import { IMounted, NpcContext } from '../../logic/memory/NpcContext';

/** A city is kept; the field lasts the session. */
export type MemoryPlace = { hubId: string } | { seed: string };

export interface IMemoryWrite {
  /** Whose memory: an NPC's id. */
  owner: string;
  what: IRemembering;
}

const fieldBooks = new Map<string, IAtomBook>();
const fieldMinds = new Map<string, IMind>();

const keyOf = (place: MemoryPlace) => ('hubId' in place ? `hub:${place.hubId}` : `field:${place.seed}`);
const bookId = (hubId: string) => `book_${hubId}`;
const mindId = (hubId: string, owner: string) => `mind_${hubId}_${owner}`;

const queues = new Map<string, Promise<unknown>>();
/** One at a time per place: what reads the book waits for what is writing it. */
function inTurn<T>(place: MemoryPlace, work: () => Promise<T>): Promise<T> {
  const key = keyOf(place);
  const next = (queues.get(key) ?? Promise.resolve()).then(work, work);
  queues.set(key, next.catch(() => undefined));
  return next;
}

const stamp = (ownerCertUid: string) => { const now = Date.now(); return { createdAt: now, updatedAt: now, ownerCertUid, version: 1 }; };

async function loadBook(place: MemoryPlace): Promise<IAtomBook> {
  if ('seed' in place) return fieldBooks.get(place.seed) ?? emptyBook();
  return (await VectorStore.get<IAtomBook>(VectorNamespace.TERRITORIES, bookId(place.hubId)))?.data ?? emptyBook();
}

async function loadMind(place: MemoryPlace, owner: string, day: number): Promise<IMind> {
  if ('seed' in place) return fieldMinds.get(`${place.seed}:${owner}`) ?? freshMind(owner, day);
  return (await VectorStore.get<IMind>(VectorNamespace.TERRITORIES, mindId(place.hubId, owner)))?.data ?? freshMind(owner, day);
}

async function save(place: MemoryPlace, book: IAtomBook | null, minds: IMind[]): Promise<void> {
  if ('seed' in place) {
    if (book) fieldBooks.set(place.seed, book);
    for (const mind of minds) fieldMinds.set(`${place.seed}:${mind.owner}`, mind);
    return;
  }
  const meta = stamp(place.hubId);
  if (book) await VectorStore.put({ id: bookId(place.hubId), namespace: VectorNamespace.TERRITORIES, data: book, metadata: meta });
  for (const mind of minds) await VectorStore.put({ id: mindId(place.hubId, mind.owner), namespace: VectorNamespace.TERRITORIES, data: mind, metadata: meta });
}

export const MemoryStore = {
  /** Write what happened, in the order it happened, and keep it. */
  write(place: MemoryPlace, writes: IMemoryWrite[]): Promise<void> {
    if (writes.length === 0) return Promise.resolve();
    return inTurn(place, async () => {
      let book = await loadBook(place);
      const minds = new Map<string, IMind>();
      const ordered = writes.map((w, i) => ({ w, i })).sort((a, b) => a.w.what.day - b.w.what.day || a.i - b.i);
      for (const { w } of ordered) {
        const mind = minds.get(w.owner) ?? await loadMind(place, w.owner, w.what.day);
        const out = MemoryLaw.remember(mind, book, w.what);
        book = out.book;
        minds.set(w.owner, out.mind);
      }
      await save(place, book, [...minds.values()]);
    });
  },

  /** A ledger entry settled: a quest brought, a debt paid. */
  settle(place: MemoryPlace, owner: string, key: string, day: number): Promise<void> {
    return inTurn(place, async () => {
      const mind = await loadMind(place, owner, day);
      if (!mind.memories.some(m => m.ledger?.open && m.ledger.key === key)) return;
      await save(place, null, [MemoryLaw.settle(mind, key, day)]);
    });
  },

  /** What comes to mind for this person now, in words, with what they have forgotten left as "?". */
  recall(place: MemoryPlace, owner: string, today: number, about: { people?: string[]; words?: string[] } = {}, name?: (entityId: string) => string | undefined): Promise<IRecalled[]> {
    return inTurn(place, async () => {
      const book = await loadBook(place);
      const mind = await loadMind(place, owner, today);
      return MemoryLaw.recall(mind, book, today, about).map(m => MemoryLaw.words(m, book, name));
    });
  },

  /**
   * What a model is given of this person facing a speaker: what comes to mind and how they stand
   * with them. Memory reaches a model only through this, and is never shown on screen.
   */
  mount(place: MemoryPlace, owner: string, speaker: string, today: number, said?: string, name?: (entityId: string) => string | undefined): Promise<IMounted> {
    return inTurn(place, async () => NpcContext.mount({ mind: await loadMind(place, owner, today), book: await loadBook(place), today, speaker, said, name }));
  },

  /** How heavily one person's memories weigh on another. For the koseki's people half. */
  regard(place: MemoryPlace, owner: string, other: string, today: number): Promise<number> {
    return inTurn(place, async () => MemoryLaw.regard(await loadMind(place, owner, today), other, today));
  },

  /** The whole mind, for a reader that needs more than recall. */
  mind(place: MemoryPlace, owner: string, today: number): Promise<IMind> {
    return inTurn(place, async () => MemoryLaw.fold(await loadMind(place, owner, today), today));
  }
};

/**
 * Two people met and both remember it: the same slots, each with what it cost them. Everything is
 * walked over (D109), so only a meeting where both stood writes this.
 */
export function bothRemember(a: string, b: string, what: Omit<IRemembering, 'fall'>, falls: { a?: number; b?: number } = {}): IMemoryWrite[] {
  return [
    { owner: a, what: { ...what, ...(falls.a ? { fall: falls.a } : {}) } },
    { owner: b, what: { ...what, ...(falls.b ? { fall: falls.b } : {}) } }
  ];
}

/**
 * Harm taken, or a snare, in the field. The body it happened to keeps an open entry for as long as
 * the field keeps anything (this session), and repeats in one encounter rehearse one entry.
 */
export function rememberThreat(seed: string, owner: string, by: string, day: number, snare?: { held: boolean }): Promise<void> {
  const what = snare ? Deeds.caught({ day, by, owner, held: snare.held }) : Deeds.hit({ day, by, owner });
  return MemoryStore.write({ seed }, [{ owner, what }]);
}

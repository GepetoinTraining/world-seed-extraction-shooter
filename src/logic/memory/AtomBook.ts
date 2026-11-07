/**
 * THE BOOK: every word, run and clause a world's people have remembered, each written once.
 *
 * The dedup is the one in lettersacrosssubstrate's rig (`build-letter-bundles.py`, `symbolize`):
 * a piece is known by its canonical lowercase string, a longer piece is a tuple of its children's
 * ids (a run is word ids), encoding takes the longest known piece first, and whatever fits nothing
 * goes to a side channel and is kept. The roles a piece plays and the forgetting are ours, and live
 * in MemoryLaw.ts: this file only knows pieces.
 *
 * An id is a hash of the piece's canonical string, never a counter, so every browser that writes
 * the same words reaches the same id without asking anyone (the hub computes nothing, D-compute-less;
 * loot ids work the same way). Which runs a book has learned depends on what it has seen, so two
 * books can split one clause into different parts, but they always agree on the clause's id.
 *
 * A run is learned once it recurs: a stretch of two or more words written a second time anywhere in
 * the book. Single words are always known. A person is an atom by their entity id, never by name.
 *
 * Worlds never retire, so a book only grows. Pure: every function hands back a new book.
 */

import { sha256Hex } from '../../../shared/logic/ledger/sha256';

export interface IAtomBook {
  /** Word atoms: id to the word. */
  words: Record<string, string>;
  /** Run and clause atoms: id to the ids of their parts, in order. A clause is stored as a run of its parts. */
  runs: Record<string, string[]>;
  /** Person atoms: id to the entity id. */
  people: Record<string, string>;
  /** How many times each stretch of words has been written, by the id it would have as a run. */
  seen: Record<string, number>;
}

/** A clause as written: its id, its parts (longest known first), and what fit no word. */
export interface IEncoded {
  id: string;
  parts: string[];
  /** The side channel: what was not a word (punctuation, symbols), in order. Never thrown away. */
  rest: string[];
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Sixty-four bits of the hash: enough that a world's book never sees two pieces share an id. */
const idOf = (kind: 'w' | 'r' | 'p', canon: string) => `${kind}${sha256Hex(`${kind}:${canon}`).slice(0, 16)}`;

export const emptyBook = (): IAtomBook => ({ words: {}, runs: {}, people: {}, seen: {} });

export const AtomBook = {
  /** The canonical words of a piece of text: lowercase, in order. */
  words(text: string): string[] {
    return (text.normalize('NFC').toLowerCase().match(WORD) ?? []).map(w => w.replace(/’/g, "'"));
  },

  /** What is left of a text once its words are taken out: the side channel. */
  rest(text: string): string[] {
    return text.normalize('NFC').replace(WORD, ' ').split(/\s+/).filter(Boolean);
  },

  wordId(word: string): string {
    return idOf('w', word);
  },

  /** A run's id, from its words joined by one space: its canonical string. */
  runId(words: string[]): string {
    return words.length === 1 ? idOf('w', words[0]) : idOf('r', words.join(' '));
  },

  /** A person's atom. Their id is kept as it is: ids are not words. */
  personId(entityId: string): string {
    return idOf('p', entityId);
  },

  isPerson(id: string): boolean {
    return id.startsWith('p');
  },

  isRun(id: string): boolean {
    return id.startsWith('r');
  },

  /** A person, written into the book. */
  person(book: IAtomBook, entityId: string): { book: IAtomBook; id: string } {
    const id = this.personId(entityId);
    if (book.people[id] === entityId) return { book, id };
    return { book: { ...book, people: { ...book.people, [id]: entityId } }, id };
  },

  /**
   * Encode a clause with the runs the book already knows, longest first, then write it in: its
   * words, its own id, and every stretch it holds counted, so a stretch seen twice becomes a run.
   */
  write(book: IAtomBook, text: string): { book: IAtomBook; encoded: IEncoded } {
    const words = this.words(text);
    const rest = this.rest(text);
    const id = this.runId(words);
    const parts = this.split(book, words);

    const nextWords = { ...book.words };
    for (const w of words) nextWords[this.wordId(w)] = w;
    const seen = { ...book.seen };
    const runs = { ...book.runs };
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 2; j <= words.length; j++) {
        const stretch = words.slice(i, j);
        const rid = this.runId(stretch);
        seen[rid] = (seen[rid] ?? 0) + 1;
        if (seen[rid] > 1 && !runs[rid]) runs[rid] = stretch.map(w => this.wordId(w));
      }
    }
    // The clause itself is kept as the tuple it was split into, the first time it is written
    if (words.length > 1 && !runs[id]) runs[id] = parts;
    return { book: { ...book, words: nextWords, runs, seen }, encoded: { id, parts, rest } };
  },

  /** Greedy longest match over the runs the book knows: at each word, the longest known run that starts there. */
  split(book: IAtomBook, words: string[]): string[] {
    const parts: string[] = [];
    let i = 0;
    while (i < words.length) {
      let taken = 1;
      let part = this.wordId(words[i]);
      // The whole clause is not a part of itself: a clause seen before splits into what it is made of
      for (let k = words.length - i - (i === 0 ? 1 : 0); k >= 2; k--) {
        const rid = this.runId(words.slice(i, i + k));
        if (book.runs[rid] && book.seen[rid] !== undefined && book.seen[rid] > 1) { taken = k; part = rid; break; }
      }
      parts.push(part);
      i += taken;
    }
    return parts;
  },

  /** An atom read back as words. A person reads as whatever `name` says of them, or their id. */
  read(book: IAtomBook, id: string, name: (entityId: string) => string | undefined = () => undefined): string {
    if (book.people[id] !== undefined) return name(book.people[id]) ?? book.people[id];
    if (book.words[id] !== undefined) return book.words[id];
    const parts = book.runs[id];
    if (parts) return parts.map(p => this.read(book, p, name)).join(' ');
    return '?';
  },

  /** The runs and people inside a clause: what can recur across memories. Single words never do on their own. */
  keysOf(book: IAtomBook, id: string): string[] {
    const keys = new Set<string>([id]);
    for (const part of book.runs[id] ?? []) if (this.isRun(part) || this.isPerson(part)) keys.add(part);
    return [...keys];
  }
};

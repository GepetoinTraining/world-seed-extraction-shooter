/**
 * THE FIGHT'S RECORD (the UX pass, ux-fight): what the fight said, kept for as long as the dive lasts and until the
 * next one begins, opened on purpose (L, or its button), scrolled, and copied as text.
 *
 * Put to Pedro, 2026-11-12: "A number over each blow, given and taken, and a fight log that stays." His answer kept
 * numbers off the field ("might be not fluid enough in our animation style"), so the field draws a blow by its size
 * (`src/render/BlowMarks.ts`) and the figures live here, out of the way. Every figure says whether it is before or
 * after armour, as he ruled for every figure the game shows.
 *
 * What a creature takes is the blow itself: a creature wears no armour (`CombatSystem` takes a landed blow whole), so
 * a blow given says its figure before armour and that all of it landed. What a person takes passes their armour
 * once a frame (`CombatMath.incoming`), so a blow taken says what came at them and what got through.
 */

import { create } from 'zustand';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { ContactNames, UNKNOWN_CONTACT } from './ContactNames';

/** How a blow came: a shot that flew, a swing of the person's, a creature's blow by hand or over an area. */
export type GivenBy = 'shot' | 'swing';
export type TakenBy = 'shot' | 'blow';

export interface ITakenBlow { from: string; by: TakenBy; figure: number }

export type FightEntry =
  /** A blow of the person's (or of someone beside them) that landed on a creature. */
  | { kind: 'given'; at: number; target: string; by: GivenBy; figure: number; glance?: boolean; beside?: boolean }
  /** What is already working on a creature (a poison, a status that bites) took this much, over `bites` bites in a row (one when none is said). */
  | { kind: 'working'; at: number; target: string; figure: number; bites?: number }
  /** A blow that landed on nothing: the ground the creature stands on holds it up (D93). */
  | { kind: 'held'; at: number; target: string; by: GivenBy }
  /** One frame of harm to the person: the blows that came, what got past armour, what worked on them, what a ward took, what they took. */
  | { kind: 'taken'; at: number; blows: ITakenBlow[]; afterArmour: number; dodged: boolean; blocked: boolean; working: number; ward: number; took: number; bites?: number }
  /** A body down, or a post broken. */
  | { kind: 'down'; at: number; target: string };

export interface IFightRecordBook { title: string; beganAt: number; entries: FightEntry[] }

/** The word in the record's second column, so a reader finds given and taken by position and word, never by hue. */
const WORD: Record<FightEntry['kind'], string> = { given: 'GIVEN', working: 'GIVEN', held: 'GIVEN', taken: 'TAKEN', down: 'DOWN' };
const WORD_WIDTH = 6;

const overBites = (bites?: number) => (bites && bites > 1 ? ` over ${bites} bites` : '');
/** Only a bite of what works on the person, with no blow, no ward: such runs fold into one line. */
const lone = (e: FightEntry) => e.kind === 'taken' && e.blows.length === 0 && e.ward === 0;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const whose = (name: string) => (/s$/.test(name) ? `${name}'` : `${name}'s`);

export const FightRecord = {
  /**
   * What the record calls a body: the name its card shows (a creature only the name it has earned, D60). A creature with
   * none is told by the rank the field marks on it, so two unknown contacts of different ranks read apart.
   */
  nameOf(e: IWorldEntity | undefined): string {
    if (!e) return 'something';
    const name = ContactNames.of(e, () => 0);
    if (name === UNKNOWN_CONTACT) return e.rank ? `a rank ${e.rank} unknown contact` : 'an unknown contact';
    return e.type === EntityType.MOB ? name : `the ${name.toLowerCase()}`;
  },

  /** Minutes and seconds since the record began: 0:42, 12:05, 73:09. */
  clock(at: number, beganAt: number): string {
    const s = Math.max(0, Math.floor((at - beganAt) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },

  /** What one entry says, in words, with whether each figure is before or after armour. */
  say(e: FightEntry): string {
    switch (e.kind) {
      case 'given': {
        const who = e.beside ? 'Someone beside you' : 'You';
        const how = e.by === 'shot' ? (e.glance ? 'a shot that glanced' : 'a shot') : (e.glance ? 'a swing that glanced' : 'a swing');
        const half = e.glance ? ' (half the blow)' : '';
        return `${who} hit ${e.target} with ${how}: ${e.figure} before armour${half}, and all ${e.figure} landed, since a creature wears no armour.`;
      }
      case 'working':
        return `What is working on ${e.target} took ${e.figure}${overBites(e.bites)}; no armour stands in its way.`;
      case 'held':
        return `Your ${e.by} on ${e.target} landed on nothing: the ground it stands on holds it up.`;
      case 'down':
        return `${sentence(e.target)} is down.`;
      case 'taken': {
        const parts: string[] = [];
        if (e.blows.length > 0) {
          const before = e.blows.reduce((sum, b) => sum + b.figure, 0);
          const named = e.blows.length === 1
            ? `${sentence(whose(e.blows[0].from))} ${e.blows[0].by}`
            : e.blows.map((b, i) => `${i === 0 ? sentence(whose(b.from)) : whose(b.from)} ${b.by} (${b.figure})`).join(e.blows.length === 2 ? ' and ' : ', ');
          if (e.dodged) parts.push(`${named} came at you: ${before} before armour, dodged, and nothing landed.`);
          else parts.push(`${named} struck you${e.blocked ? ', blocked' : ''}: ${before} before armour, ${e.afterArmour} after armour.`);
        }
        if (e.working > 0) parts.push(`What is working on you took ${e.working}${overBites(e.bites)}; armour does not stop it.`);
        if (e.ward > 0) parts.push(`Your ward took ${e.ward} of it, and ${e.took} reached you.`);
        return parts.join(' ');
      }
    }
  },

  /** Which way it went: GIVEN, TAKEN or DOWN. */
  word(e: FightEntry): string {
    return WORD[e.kind];
  },

  /** One line of the record: when, which way, and what was said. */
  line(e: FightEntry, beganAt: number): string {
    return `${this.clock(e.at, beganAt).padEnd(5)} ${this.word(e).padEnd(WORD_WIDTH)} ${this.say(e)}`;
  },

  /**
   * A line added to the record. A bite of what works on a body, right after another on the same body, joins it: one line
   * with what it took in all and over how many bites, so a poison does not fill the record a line a tick. Nothing is
   * lost in the joining, and nothing else joins.
   */
  fold(entries: FightEntry[], e: FightEntry): FightEntry[] {
    const last = entries[entries.length - 1];
    if (last && lone(last) && lone(e) && last.kind === 'taken' && e.kind === 'taken') {
      return [...entries.slice(0, -1), { ...last, working: last.working + e.working, took: last.took + e.took, bites: (last.bites ?? 1) + 1 }];
    }
    if (last && last.kind === 'working' && e.kind === 'working' && last.target === e.target) {
      return [...entries.slice(0, -1), { ...last, figure: last.figure + e.figure, bites: (last.bites ?? 1) + 1 }];
    }
    return [...entries, e];
  },

  /** The whole record as text, as COPY AS TEXT gives it: a title, what the two armour words mean, then every line in order. */
  text(book: IFightRecordBook): string {
    return [
      `THE FIGHT'S RECORD — ${book.title || 'a dive'}`,
      'Before armour: the blow as it was let go. After armour: what reached the body. A creature wears no armour.',
      '',
      ...book.entries.map(e => this.line(e, book.beganAt))
    ].join('\n');
  }
};

interface FightRecordState extends IFightRecordBook {
  /** Which dive this record is of. A new one empties it; the same one keeps it. */
  key: string | null;
  open: boolean;
  begin: (key: string, title: string, at: number) => void;
  add: (entry: FightEntry) => void;
  /** A frame's lines at once, so the field writes the record once a frame however much happened in it. */
  addAll: (entries: FightEntry[]) => void;
  toggle: () => void;
  close: () => void;
}

/**
 * The record of the dive in hand, kept in memory: it outlasts the dive's end so a fall can be read back, and is begun
 * again by the next dive. Every line is kept; nothing is dropped to keep it short.
 */
export const useFightRecord = create<FightRecordState>((set, get) => ({
  key: null,
  title: '',
  beganAt: 0,
  entries: [],
  open: false,
  begin: (key, title, at) => {
    if (get().key === key) return;
    set({ key, title, beganAt: at, entries: [] });
  },
  add: entry => set(s => ({ entries: FightRecord.fold(s.entries, entry) })),
  addAll: entries => { if (entries.length > 0) set(s => ({ entries: entries.reduce((all, e) => FightRecord.fold(all, e), s.entries) })); },
  toggle: () => set(s => ({ open: !s.open })),
  close: () => set({ open: false })
}));

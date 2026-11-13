/**
 * A PLAYER'S OWN NOTE ON AN UNKNOWN (UXC, part 3). Put to Pedro: a player's own note on anything unknown, shown until study
 * replaces it, as one of the researched games lets a player name an unknown thing and so gives what they worked out a
 * place in the game. His answer: "good, but I think this should be "button + voice" send to whisper or haiku".
 *
 * The player speaks; a transcriber turns it into text (`Transcriber`); the quick model, through the one door, shapes the
 * text into one short note; this law holds the note before it is kept. The law, the coordinator's call:
 * - Short: at most `NOTE_CHARACTERS`, about ten spoken words, one row of a card.
 * - Theirs: every word of four letters or more in the note, and every number, is one they said, read without case or
 *   accents (a word is theirs when its first four letters begin a word they said, so "burns" stands for "burn"). The
 *   model may leave words out, change their order and end on a question mark; it may not add. Shorter joining words
 *   pass unread, so a three-letter word could slip through: written down as an open row.
 * - Blind: the model is given what was heard and what kind of thing it is about, never anything true of the thing,
 *   not even its name (`askOf`).
 * - A guess, never a fact: the card marks it as the player's own words, by position and a word.
 *
 * Kept on the character, keyed by what it is about (`NoteKeys`), so the same unknown met again shows the same note. Pure:
 * no store, no door. The door is `NoteDoor`.
 */

import type { IPlayer, IPlayerNote, NoteKind } from '../../../shared/types';
import type { IWorldEntity } from '../../../shared/entities/world/types';
import { NOTE_CHARACTERS, NOTE_HEARD_CHARACTERS } from '../../../shared/intelligence/prompts';
import { fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { ContactNames } from './ContactNames';

export { NOTE_CHARACTERS, NOTE_HEARD_CHARACTERS };

/** What kind of thing a note is about, said as the model is told it. Nothing more of the thing is ever sent. */
const ABOUT: Record<NoteKind, string> = {
  affix: 'a property worked into a piece of gear',
  piece: 'a piece of gear nobody has read yet',
  material: 'a material',
  creature: 'a creature',
  person: 'a person whose name they do not know'
};

/** What the door is given. */
export interface INoteAsk { heard: string; about: string; refused?: string }
/** What comes back. */
export interface INoteWords { note: string }

/**
 * Where a note is kept: what it is about, never what is true of it. A person's key is their body and dealt name hashed,
 * so nothing kept says a name the player was never told.
 */
export const NoteKeys = {
  affix: (id: string) => `affix:${id}`,
  piece: (itemId: string) => `piece:${itemId}`,
  material: (definitionId: string) => `material:${definitionId}`,
  creature: (definitionId: string) => `creature:${definitionId}`,
  person: (e: Pick<IWorldEntity, 'id' | 'npc'>) => `person:${fnv1a(ContactNames.personKey(e)).toString(36)}`
};

/** A word as the law reads it: no case, no accents. */
const plain = (text: string): string[] =>
  (text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const STEM = 4;

export const PlayerNote = {
  /** What was heard, as it may be sent: something, and no more than a breath's worth. */
  heardOf(text: string): { ok: true; heard: string } | { ok: false; reason: string } {
    const heard = (text ?? '').trim();
    if (!heard) return { ok: false, reason: 'Nothing was heard.' };
    if (heard.length > NOTE_HEARD_CHARACTERS) return { ok: false, reason: 'That was more than a note can hold. Say it in fewer words.' };
    return { ok: true, heard };
  },

  /** What the door is given: what was heard, and what kind of thing it is about. Nothing else. */
  askOf(heard: string, kind: NoteKind, refused?: string): INoteAsk {
    return { heard, about: ABOUT[kind], ...(refused ? { refused } : {}) };
  },

  /** The law over a note. */
  judge(words: INoteWords | undefined, ask: INoteAsk): { ok: true; note: string } | { ok: false; reason: string } {
    const note = typeof words?.note === 'string' ? words.note.trim() : '';
    if (!note) return { ok: false, reason: 'Nothing was said that a note could hold.' };
    if (note.length > NOTE_CHARACTERS) return { ok: false, reason: `The note was ${note.length} characters; it may be ${NOTE_CHARACTERS} at most.` };
    const said = plain(ask.heard);
    const stems = new Set(said.filter(w => w.length >= STEM).map(w => w.slice(0, STEM)));
    const added = [...new Set(plain(note).filter(w => (/\d/.test(w) ? !said.includes(w) : w.length >= STEM && !stems.has(w.slice(0, STEM)))))];
    if (added.length > 0) return { ok: false, reason: `${added.map(w => `"${w}"`).join(', ')} ${added.length === 1 ? 'is not a word' : 'are not words'} they said. Use only their words.` };
    return { ok: true, note };
  },

  /** A judged note lands on the character, under what it is about, replacing any note there. */
  keep(player: IPlayer, key: string, kind: NoteKind, note: string, at: number): IPlayer {
    const kept: IPlayerNote = { kind, note, at };
    return { ...player, notes: { ...(player.notes ?? {}), [key]: kept } };
  },

  /** The note on this unknown, if the player has spoken one. */
  of(player: Pick<IPlayer, 'notes'> | undefined, key: string): string | undefined {
    return player?.notes?.[key]?.note;
  }
};

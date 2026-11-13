/**
 * A SPOKEN NOTE, CARRIED (UXC, part 3; Pedro: "button + voice" send to "whisper or haiku"). The transcriber hears the
 * player once; what it heard goes to the quick model through the one door with what kind of thing it is about, and
 * nothing true of the thing; what comes back stands before `PlayerNote.judge`. A note that does not stand is asked once
 * more with why. Still broken, or no voice at all, and nothing is kept: the player is told why, with what was heard,
 * so their words are not lost to them. A judged note lands at once and the character is saved. Each note is one call
 * to the door, two at most.
 */

import type { NoteKind } from '../../../shared/types';
import type { IPlayerPort } from '../../entities/player/playerView';
import { IntelligenceClient } from '../intelligence/IntelligenceClient';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { INoteWords, PlayerNote } from './PlayerNote';
import { ITranscriber, Transcribers } from './Transcriber';

/** One answer, and once more with why the first did not stand. */
const ASKS = 2;

/** An unknown a note can be spoken on, as a card offers it. `about` is for the player's eyes and is never sent. */
export interface INoteSubject { key: string; kind: NoteKind; about: string; noted?: boolean }

export interface INoteHooks {
  /** The transcriber has heard; the door is asked next. */
  heard?: (text: string) => void;
}

export const NoteDoor = {
  async speak(subject: INoteSubject, pc: Pick<IPlayerPort, 'view' | 'apply'>, transcriber: ITranscriber = Transcribers.current(), hooks: INoteHooks = {}): Promise<{ ok: boolean; reason?: string; note?: string; heard?: string }> {
    const ready = transcriber.ready();
    if ('reason' in ready) return { ok: false, reason: ready.reason };
    const listened = await transcriber.listen();
    if ('reason' in listened) return { ok: false, reason: listened.reason };
    const heard = PlayerNote.heardOf(listened.text);
    if ('reason' in heard) return { ok: false, reason: heard.reason };
    hooks.heard?.(heard.heard);
    const kept = (why: string) => `${why} Nothing was kept. You said: "${heard.heard}"`;
    let refused: string | undefined;
    for (let n = 0; n < ASKS; n++) {
      const out = await IntelligenceClient.shapeNote<INoteWords>(PlayerNote.askOf(heard.heard, subject.kind, refused));
      if (out.status !== 'OK') return { ok: false, reason: kept(out.reason ?? 'No voice answers on this machine now.'), heard: heard.heard };
      const verdict = PlayerNote.judge(out.data, PlayerNote.askOf(heard.heard, subject.kind));
      if ('reason' in verdict) { refused = verdict.reason; continue; }
      pc.apply({ kind: 'SET', player: PlayerNote.keep(pc.view().player, subject.key, subject.kind, verdict.note, Date.now()) });
      void PlayerPersistence.flush('note', pc.view().player);
      return { ok: true, note: verdict.note, heard: heard.heard };
    }
    return { ok: false, reason: kept('The note could not be made of your words alone.'), heard: heard.heard };
  }
};

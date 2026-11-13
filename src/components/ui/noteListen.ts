/**
 * THE NOTE, HEARD IN THE GAME (UXC, part 3; Pedro: "button + voice"). The card's button and its key N ask for a note
 * (`speakNote` in `cardKeys`); this is who answers, set once the game is up (`installNoteSpeaker`, from the hover layer).
 * It runs the one door for notes (`NoteDoor`) on the character, shows how far it has come on the card that asked and in
 * the strip of waits (listening, then writing), and says in the feed what was kept, or why nothing was and what was
 * heard. One note at a time.
 */

import type { ICardUnknown } from '../../render/atoms/inspect';
import type { IPlayerPort } from '../../entities/player/playerView';
import { NoteDoor } from '../../logic/systems/NoteDoor';
import { setNoteSpeaker, useCardKeys } from './cardKeys';
import { useFeed, useWaits } from './stores';

const WAIT_ID = 'note';

/** The player's port is handed in by the screen that sets the speaker: only screens, stores and the boot reach the store. */
export async function speak(unknown: ICardUnknown, pc: Pick<IPlayerPort, 'view' | 'apply'>): Promise<void> {
  const keys = useCardKeys.getState();
  if (keys.note) return;
  keys.setNote({ key: unknown.key, phase: 'listening' });
  useWaits.getState().begin({ id: WAIT_ID, label: `Listening for your note on ${unknown.about}`, startedAt: Date.now() });
  try {
    const out = await NoteDoor.speak(unknown, pc, undefined, {
      heard: () => {
        useCardKeys.getState().setNote({ key: unknown.key, phase: 'writing' });
        useWaits.getState().begin({ id: WAIT_ID, label: 'Writing your note', startedAt: Date.now() });
      }
    });
    if (out.ok) useFeed.getState().push(`Your note on ${unknown.about}: "${out.note}"`, 'proof');
    else useFeed.getState().push(out.reason ?? 'Nothing was kept.', 'loss');
  } finally {
    useCardKeys.getState().setNote(null);
    useWaits.getState().end(WAIT_ID);
  }
}

/** The game is up: the card's button and key now reach the door, on this player. Returns what takes it down. */
export function installNoteSpeaker(pc: Pick<IPlayerPort, 'view' | 'apply'>): () => void {
  setNoteSpeaker(u => { void speak(u, pc); });
  return () => setNoteSpeaker(null);
}

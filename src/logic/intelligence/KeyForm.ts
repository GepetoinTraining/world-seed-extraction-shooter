/**
 * THE KEY FORM'S OWN STATE (Pedro, 2026-11-10: "dry run and test, accept"). Three steps in order, and the
 * order is held here, apart from the screen that draws it:
 *
 *   DRY RUN   reads the pasted text on this machine. Nothing is sent.
 *   TEST      asks the provider once whether it takes the key. Nothing is held, nothing changes.
 *   ACCEPT    holds the key and puts it in use. Open only for the very text the provider said yes to.
 *
 * The text lives in this form while it is being typed and nowhere else: the screen clears it on accept
 * and on close.
 */
import type { IKeyLook } from '../../../shared/intelligence/keyShape';

export interface IKeyForm {
  optionId: string;
  text: string;
  dry: IKeyLook | null;
  /** What the provider answered, and for which text. */
  tested: { text: string; ok: boolean; reason?: string } | null;
}

export const emptyForm = (optionId: string): IKeyForm => ({ optionId, text: '', dry: null, tested: null });

/** A change to the text, or to the provider, makes every earlier answer about another key. */
export const typed = (form: IKeyForm, text: string): IKeyForm => ({ ...form, text, dry: null, tested: null });
export const picked = (form: IKeyForm, optionId: string): IKeyForm => ({ ...form, optionId, dry: null, tested: null });

export const dried = (form: IKeyForm, look: IKeyLook): IKeyForm => ({ ...form, dry: look });
export const tested = (form: IKeyForm, answer: { ok: boolean; reason?: string }): IKeyForm => ({ ...form, tested: { text: form.text, ...answer } });

export const canTest = (form: IKeyForm): boolean => form.text.trim().length > 0;
export const canAccept = (form: IKeyForm): boolean => !!form.tested?.ok && form.tested.text === form.text;

/**
 * What the list of held keys says while nothing was added through this form (Pedro, 2026-11-12, on a
 * run where the server's own key was in use and the list read "No key is held": "the key didn't
 * register as being there"). The list holds only what the form added, so its empty line says what
 * the game is using, and never a sentence that reads as "the game has no key".
 */
export const saidWhenNoneAdded = (voice: { mode?: string; provider?: string; available?: boolean } | null, onPage: boolean): string => {
  if (!voice) return 'No key has been added here, and the voice cannot be reached to say what is in use.';
  if (voice.mode === 'off') return 'No key has been added here. The voice is turned off on this server.';
  if (voice.provider === 'local') {
    return voice.available
      ? "No key has been added here. The game is using this machine's own model."
      : "No key has been added here, and this machine's own model is not answering.";
  }
  if (onPage) return 'No key has been added here.';
  return voice.available
    ? "The server's own key is in use, and it works. No other key has been added here, and none is needed."
    : 'No key has been added here, and the server holds none of its own.';
};

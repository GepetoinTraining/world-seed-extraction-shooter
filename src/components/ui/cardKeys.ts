/**
 * THE CARD'S KEYS (UXC, part 1; Pedro: "yup"). Every card on screen, however it came up (the pointer over a piece, a
 * focused control, Q in the field, a row picked in a list), answers the same two keys, because the card itself listens:
 *
 * - ALT, held: the card's second layer is added beneath its first. Let go, or the window loses focus, and it is gone.
 *   While a card is up the browser's own menu does not take the key.
 * - CTRL+C: the card that came up last is copied as plain text (`cardText`), both layers, in the order it is drawn.
 *   The key stays the page's while text is selected or a field is being typed in, or when no card is up.
 *
 * - N (part 3, Pedro: "button + voice"): the card that came up last hears a note on what it does not know.
 *
 * The listeners stand while at least one card is up (`holdCardKeys`), so a screen with no card hears nothing new.
 */

import { create } from 'zustand';
import { useFeed } from './stores';
import type { ICardUnknown } from '../../render/atoms/inspect';

/** What a card on screen offers the keys: its text to copy, and the unknowns a note may be spoken on (part 3). */
export interface ICardUp { id: number; text: string; unknowns?: ICardUnknown[] }

/** UXC, part 3: a note being spoken, and how far it has come. */
export interface INoteUnderway { key: string; phase: 'listening' | 'writing' }

interface CardKeysState {
  /** ALT is held: every card shows its second layer. */
  deep: boolean;
  /** The cards on screen, the one that came up last at the end. */
  up: ICardUp[];
  /** UXC, part 3: the one note being spoken now, if any. */
  note: INoteUnderway | null;
  /** UXC, part 3: why the last try on this unknown made no note, in its own sentence, until the next try. */
  unheard: { key: string; reason: string } | null;
  setDeep: (deep: boolean) => void;
  /** A card came up, or what it says changed: it is the one that came up last. */
  raise: (card: ICardUp) => void;
  drop: (id: number) => void;
  setNote: (note: INoteUnderway | null) => void;
  setUnheard: (unheard: { key: string; reason: string } | null) => void;
}

export const useCardKeys = create<CardKeysState>((set, get) => ({
  deep: false,
  up: [],
  note: null,
  unheard: null,
  setDeep: deep => { if (get().deep !== deep) set({ deep }); },
  raise: card => set(s => ({ up: [...s.up.filter(c => c.id !== card.id), card] })),
  drop: id => set(s => (s.up.some(c => c.id === id) ? { up: s.up.filter(c => c.id !== id) } : s)),
  setNote: note => set({ note }),
  setUnheard: unheard => set({ unheard })
}));

/** UXC, part 3: N speaks on the first unknown with no note yet, or on the first when every one has one. */
export const NOTE_KEY = 'n';
export const noteTarget = (unknowns: ICardUnknown[] | undefined): ICardUnknown | undefined =>
  unknowns?.find(u => !u.noted) ?? unknowns?.[0];

/**
 * Who speaks a note when the button or the key asks. The card knows no store and no door, so the game sets this once it
 * is up (`installNoteSpeaker` in `noteListen.ts`); until then the card's button says nothing can be heard here.
 */
let speaker: ((unknown: ICardUnknown) => void) | null = null;
export function setNoteSpeaker(speak: ((unknown: ICardUnknown) => void) | null): void { speaker = speak; }
export const canSpeakNotes = () => speaker !== null;
export function speakNote(unknown: ICardUnknown): boolean {
  if (!speaker || useCardKeys.getState().note) return false;
  speaker(unknown);
  return true;
}

let nextCardId = 0;
/** A card's own place among the cards up. */
export const cardId = () => ++nextCardId;

/** The card the keys act on: the one that came up last. */
export const topCard = (): ICardUp | undefined => { const up = useCardKeys.getState().up; return up[up.length - 1]; };

const typingIn = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

const selecting = (): boolean => {
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
};

/** Text onto the clipboard: the browser's clipboard where it has one, the old copy command where it does not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* falls to the old way */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The held key: ALT, or the right ALT that some layouts (a Brazilian one among them) report as AltGr. */
const isAlt = (e: KeyboardEvent) => e.key === 'Alt' || e.key === 'AltGraph';

const onKeyDown = (e: KeyboardEvent) => {
  const anyUp = useCardKeys.getState().up.length > 0;
  if (isAlt(e)) {
    useCardKeys.getState().setDeep(true);
    if (anyUp) e.preventDefault();
    return;
  }
  if (!anyUp) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyC' || e.key.toLowerCase() === 'c')) {
    if (typingIn(e.target) || typingIn(document.activeElement) || selecting()) return;
    const card = topCard();
    if (!card) return;
    e.preventDefault();
    void copyText(card.text).then(ok => useFeed.getState().push(ok ? 'Card copied as text.' : 'This browser would not take the copy.', ok ? 'plain' : 'loss'));
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
  // UXC, part 3: N speaks a note on the card's unknown
  if (e.key.toLowerCase() === NOTE_KEY && !e.shiftKey) {
    const target = noteTarget(topCard()?.unknowns);
    if (target && speakNote(target)) { e.preventDefault(); e.stopPropagation(); }
  }
};

const onKeyUp = (e: KeyboardEvent) => {
  if (!isAlt(e)) return;
  useCardKeys.getState().setDeep(false);
  // A lone ALT let go would hand the focus to the browser's menu
  if (useCardKeys.getState().up.length > 0) e.preventDefault();
};

const letGo = () => useCardKeys.getState().setDeep(false);
const onVisibility = () => { if (document.visibilityState === 'hidden') letGo(); };
/** ALT held before the card came up is read from the pointer's next move. */
const onPointerMove = (e: PointerEvent | MouseEvent) => { useCardKeys.getState().setDeep(e.altKey); };

let holders = 0;

/** The keys listen while a card is up. Call when a card comes up; call what it returns when it goes. */
export function holdCardKeys(): () => void {
  if (holders++ === 0) {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', letGo);
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders === 0) {
      // No card hears the key now, so nothing can hear it let go: the next card starts shallow, and reads the pointer
      letGo();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', letGo);
      window.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

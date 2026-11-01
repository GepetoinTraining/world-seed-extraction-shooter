/**
 * Small UI stores (Wave 9): the screen router, the message feed, and the
 * receipt that must be looked at before the hub takes you back.
 */

import { create } from 'zustand';
import { ISessionReceipt } from '../../logic/journal/SessionJournal';
import { EquipSlotId, IItem } from '../../../types';

// --- WHICH SCREEN (replaces App-local state so dialogue can navigate) ---

export type AppView = 'HUB' | 'MISSIONS' | 'BANK' | 'HOLDINGS' | 'ADMIN';
export type BankTab = 'agent' | 'skills' | 'stash' | 'ledger';

interface ViewState {
  view: AppView;
  bankTab: BankTab;
  setView: (view: AppView, bankTab?: BankTab) => void;
  setBankTab: (tab: BankTab) => void;
}

export const useAppView = create<ViewState>(set => ({
  view: 'HUB',
  bankTab: 'agent',
  setView: (view, bankTab) => set(s => ({ view, bankTab: bankTab ?? s.bankTab })),
  setBankTab: bankTab => set({ bankTab })
}));

// --- THE HOVER (the usability pass): which item the one card is reading ---
// An element keeps the item it answers for, so a sprite inside a hoverable row can
// hand the card back to its row when the pointer leaves the sprite but not the row.

const hoverOwners = new WeakMap<HTMLElement, IItem>();

interface HoverState {
  item: IItem | null;
  el: HTMLElement | null;
  show: (item: IItem, el: HTMLElement) => void;
  hide: (el: HTMLElement) => void;
  clear: () => void;
}

export const useHover = create<HoverState>((set, get) => ({
  item: null,
  el: null,
  show: (item, el) => { hoverOwners.set(el, item); set({ item, el }); },
  hide: el => {
    if (get().el !== el) return;
    for (let up = el.parentElement; up; up = up.parentElement) {
      const owner = hoverOwners.get(up);
      if (owner) { set({ item: owner, el: up }); return; }
    }
    set({ item: null, el: null });
  },
  clear: () => set({ item: null, el: null })
}));

/** Spread on anything that shows an item: the pointer and the keyboard both open the card. */
export const hoverProps = (item: IItem) => ({
  onMouseEnter: (e: { currentTarget: EventTarget }) => useHover.getState().show(item, e.currentTarget as HTMLElement),
  onMouseLeave: (e: { currentTarget: EventTarget }) => useHover.getState().hide(e.currentTarget as HTMLElement),
  onFocus: (e: { currentTarget: EventTarget }) => useHover.getState().show(item, e.currentTarget as HTMLElement),
  onBlur: (e: { currentTarget: EventTarget }) => useHover.getState().hide(e.currentTarget as HTMLElement)
});

// --- THE HOTBAR: what is in the hand right now ---

/** Shorter than this, a cooldown would only flicker on the cell. */
const COOLDOWN_SHOWN_FROM_MS = 250;

export const useHotbar = create<{
  active: EquipSlotId;
  setActive: (slot: EquipSlotId) => void;
  /** How long the hand is busy after its last shot, so a press in that time doesn't read as ignored. */
  cooldown: { slot: EquipSlotId; startedAt: number; ms: number } | null;
  fired: (slot: EquipSlotId, at: number, ms: number) => void;
}>(set => ({
  active: 'RIGHT_HAND',
  setActive: active => set({ active }),
  cooldown: null,
  fired: (slot, startedAt, ms) => { if (ms >= COOLDOWN_SHOWN_FROM_MS) set({ cooldown: { slot, startedAt, ms } }); }
}));

// --- THE WAITS (line 124): what the game is making you wait for right now ---

export interface IWait {
  id: string;
  label: string;
  startedAt: number;
  /** Absent: nobody knows when it ends, and the strip says only how long it has been. */
  until?: number;
  /** Too short to notice draws nothing. */
  quietForMs?: number;
}

export const useWaits = create<{ waits: IWait[]; begin: (wait: IWait) => void; end: (id: string) => void }>(set => ({
  waits: [],
  begin: wait => set(s => ({ waits: [...s.waits.filter(w => w.id !== wait.id), wait] })),
  end: id => set(s => (s.waits.some(w => w.id === id) ? { waits: s.waits.filter(w => w.id !== id) } : s))
}));

/** For work whose end nobody knows: it shows while it runs, and ends even if it fails. */
export async function whileWaiting<T>(id: string, label: string, work: () => Promise<T>, quietForMs = 250): Promise<T> {
  useWaits.getState().begin({ id, label, startedAt: Date.now(), quietForMs });
  try {
    return await work();
  } finally {
    useWaits.getState().end(id);
  }
}

// --- THE CHARACTER SHEET (line 76): open or not, wherever you are ---

export const useSheet = create<{ open: boolean; toggle: () => void; close: () => void }>(set => ({
  open: false,
  toggle: () => set(s => ({ open: !s.open })),
  close: () => set({ open: false })
}));

// --- THE MINT-WORLD DRAFT (line 58): it outlives the window it is written in ---

export const WORLD_DRAFT_DEFAULTS = {
  step: 0,
  worldName: '',
  worldDescription: '',
  worldType: 'EXTRACTION',
  size: 32,
  accessMode: 'PUBLIC',
  entryFee: 0,
  extractionTax: 5,
  creatorShare: 3,
  pvpEnabled: false,
  difficulty: 'D',
  sky: 'TURNING',
  // D56: what was said, what it wrote, or the world already written that was picked
  talk: [] as { role: 'user' | 'assistant'; content: string }[],
  writtenTheme: null as unknown,
  writtenUsage: null as unknown,
  themeId: ''
};
export type WorldDraft = typeof WORLD_DRAFT_DEFAULTS;

export const useWorldDraft = create<{ draft: WorldDraft; set: (patch: Partial<WorldDraft>) => void; reset: () => void }>(set => ({
  draft: { ...WORLD_DRAFT_DEFAULTS },
  set: patch => set(s => ({ draft: { ...s.draft, ...patch } })),
  reset: () => set({ draft: { ...WORLD_DRAFT_DEFAULTS } })
}));

// --- THE FEED: what just happened, said plainly, then gone ---

export type FeedTone = 'plain' | 'signal' | 'proof' | 'loss';
export interface FeedLine { id: number; text: string; tone: FeedTone; at: number }

interface FeedState {
  lines: FeedLine[];
  push: (text: string, tone?: FeedTone) => void;
  sweep: (now: number, maxAgeMs?: number) => void;
}

let feedSeq = 0;
export const FEED_LINE_MS = 5200;

export const useFeed = create<FeedState>(set => ({
  lines: [],
  push: (text, tone = 'plain') => set(s => ({
    lines: [...s.lines.slice(-7), { id: ++feedSeq, text, tone, at: Date.now() }]
  })),
  sweep: (now, maxAgeMs = FEED_LINE_MS) => set(s => {
    const keep = s.lines.filter(l => now - l.at < maxAgeMs);
    return keep.length === s.lines.length ? s : { lines: keep };
  })
}));

// --- THE RECEIPT: the seal, or the loss. Shown before anything else happens. ---

export interface IReceiptView {
  outcome: 'EXTRACTED' | 'DIED';
  signature?: string;        // the seal is computed from this
  haul: IItem[];             // what was banked (EXTRACTED) or lost (DIED)
  haulValue: number;
  tax: number;
  worldName: string;
  durationMs: number;
  actionCount: number;
  receipt?: ISessionReceipt; // the full signed record, for the curious
  // Wave 10C (D21): a death keeps exactly the protected slots — and the
  // receipt says what was kept, and by whose magic
  kept?: { item: IItem; by: string }[];
  // D77: the gate closed on them, which the receipt says plainly
  cause?: 'GATE';
  // D30: what settled at this rest. Names only; the rest is on the Agent tab.
  settled?: string[];
  // Line 124: the record is still being signed, so its numbers are not in yet
  sealing?: boolean;
}

interface ReceiptState {
  receipt: IReceiptView | null;
  show: (r: IReceiptView) => void;
  clear: () => void;
}

export const useReceipt = create<ReceiptState>(set => ({
  receipt: null,
  show: receipt => set({ receipt }),
  clear: () => set({ receipt: null })
}));

// --- THE RANK MOMENT (Wave 9.5): a rank-up is seen, not logged ---

export interface IRankMoment { from: string; to: string; at: number }

interface RankMomentState {
  moment: IRankMoment | null;
  show: (m: IRankMoment) => void;
  clear: () => void;
}

export const useRankMoment = create<RankMomentState>(set => ({
  moment: null,
  show: moment => set({ moment }),
  clear: () => set({ moment: null })
}));

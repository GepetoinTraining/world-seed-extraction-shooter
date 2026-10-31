/**
 * Small UI stores (Wave 9): the screen router, the message feed, and the
 * receipt that must be looked at before the hub takes you back.
 */

import { create } from 'zustand';
import { ISessionReceipt } from '../../logic/journal/SessionJournal';
import { IItem } from '../../../types';

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

export interface IRankMoment { from: string; to: string; points: number; at: number }

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

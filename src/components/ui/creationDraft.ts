/**
 * THE CREATION DRAFT (line 58's lesson, P2): it outlives the screen it is written on, and a
 * reload. A stray click or a closed tab costs nothing. Only a mint or a deliberate start
 * over clears it. It holds choices and no key, so this browser's storage is the right place.
 */

import { create } from 'zustand';

export const CREATION_DRAFT_KEY = 'worldseed_creation_draft';

export const CREATION_DRAFT_DEFAULTS = {
  step: 0,
  originId: '',
  kitId: '',
  silhouette: '',
  hubId: '',
  themeId: '',
  answers: {} as Record<string, string>,
  said: '',
  name: '',
  /** What the Seed granted, kept until a choice makes it stale, so a stray click never asks twice. */
  grant: null as { words: unknown; by: 'DOOR' | 'FLOOR'; usage: unknown } | null
};
export type CreationDraft = typeof CREATION_DRAFT_DEFAULTS;

const read = (): CreationDraft => {
  try {
    const raw = localStorage.getItem(CREATION_DRAFT_KEY);
    return raw ? { ...CREATION_DRAFT_DEFAULTS, ...JSON.parse(raw) } : { ...CREATION_DRAFT_DEFAULTS };
  } catch {
    return { ...CREATION_DRAFT_DEFAULTS };
  }
};

const write = (draft: CreationDraft) => {
  try {
    localStorage.setItem(CREATION_DRAFT_KEY, JSON.stringify(draft));
  } catch { /* the store still holds it for this sitting */ }
};

export const useCreationDraft = create<{
  draft: CreationDraft;
  set: (patch: Partial<CreationDraft>) => void;
  restore: () => void;
  reset: () => void;
}>(set => ({
  draft: read(),
  set: patch => set(s => {
    const draft = { ...s.draft, ...patch };
    write(draft);
    return { draft };
  }),
  restore: () => set({ draft: read() }),
  reset: () => {
    try { localStorage.removeItem(CREATION_DRAFT_KEY); } catch { /* nothing held */ }
    set({ draft: { ...CREATION_DRAFT_DEFAULTS } });
  }
}));

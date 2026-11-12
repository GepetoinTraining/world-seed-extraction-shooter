/**
 * THE FIRST ORDER'S FIVE TASKS (TQ). Pedro, 2026-11-12: "remove the tutorial after the first run, make it staged with
 * quests 1. kill 3 mobs 2. open a chest 3. grab materials 4. bring one npc out 5. extract".
 *
 * Kept on the character (call 1), so a death and a closed window keep every tick (calls 5 and 9). A task done ahead of
 * its turn counts when it is done; the fifth, extracting, counts only with the other four done, so leaving early is
 * allowed and the tutorial is still there to come back to (call 2). The fifth seals the first order: from then the
 * tutorial is no longer this character's to enter (call 6), and every gate that reads `tutorialSealedAt` follows.
 *
 * Pure: no store, no clock. The door that hears the field is `FirstOrderDoor`.
 */

import { FirstTask, IFirstOrderRecord, IPlayer } from '../../../shared/types';

/** Pedro's order. */
export const FIRST_TASKS: FirstTask[] = ['FELL', 'CHEST', 'MATERIAL', 'PERSON', 'OUT'];

/** Pedro's "kill 3 mobs". */
export const CREATURES_TO_FELL = 3;

/** How a row of the list is marked: by a shape and a word, never by hue alone. */
const MARK = { done: '✓', now: '▶', later: '·' } as const;

const TITLES: Record<FirstTask, string> = {
  FELL: 'Fell three creatures',
  CHEST: 'Open a chest',
  MATERIAL: 'Take material from the ground',
  PERSON: 'Bring one person out',
  OUT: 'Walk out by the beacon'
};

/** What to do about the current one, in the game's words. */
const HINTS: Record<FirstTask, string> = {
  FELL: 'SPACE or the mouse fires where you aim; Q reads what is near. Walking away breaks a chase, and harm here costs nothing you carry.',
  CHEST: 'A chest stands further along the way out. Stand at it and press E.',
  MATERIAL: 'Right click a plant, a stone or a vein, and try your hands or your tool on it.',
  PERSON: 'Someone further along wants out. Talk with them, or give them something; once they will come, they walk beside you to the beacon.',
  OUT: 'Follow the arrow to the beacon. Stand at it and press E, and hold still while it channels.'
};

/** What the feed says when one is done. */
const DONE_LINES: Record<FirstTask, string> = {
  FELL: 'First order: three creatures felled.',
  CHEST: 'First order: a chest opened.',
  MATERIAL: 'First order: material taken.',
  PERSON: 'First order: someone brought out.',
  OUT: 'First order done. Every other world keeps what falls with you.'
};

export interface IFirstOrderRow {
  task: FirstTask;
  title: string;
  done: boolean;
  current: boolean;
  /** A shape: done, now, later. */
  mark: string;
  /** A word beside the shape: DONE, NOW, or nothing. */
  word: string;
}

const EMPTY: IFirstOrderRecord = { felled: 0, done: {} };

export const FirstOrder = {
  of(player: Pick<IPlayer, 'firstOrder'>): IFirstOrderRecord {
    return player.firstOrder ?? EMPTY;
  },

  isDone(record: IFirstOrderRecord, task: FirstTask): boolean {
    return record.done[task] !== undefined;
  },

  allDone(record: IFirstOrderRecord): boolean {
    return FIRST_TASKS.every(t => this.isDone(record, t));
  },

  /** The first not yet done, in his order; none once all five are. */
  current(record: IFirstOrderRecord): FirstTask | null {
    return FIRST_TASKS.find(t => !this.isDone(record, t)) ?? null;
  },

  /**
   * A step of one task, at `at`. Felling counts `count` bodies toward the three; the others are done at once. Extracting
   * counts only with the other four done, and seals the first order. Nothing changes once it is sealed, and the same
   * player comes back where nothing changed.
   */
  tick(player: IPlayer, task: FirstTask, at: number, count = 1): { player: IPlayer; ticked: boolean; sealed: boolean } {
    const unchanged = { player, ticked: false, sealed: false };
    if (player.tutorialSealedAt !== undefined) return unchanged;
    const record = this.of(player);
    if (task === 'FELL') {
      if (count <= 0) return unchanged;
      const felled = record.felled + count;
      const done = this.isDone(record, 'FELL') || felled < CREATURES_TO_FELL ? record.done : { ...record.done, FELL: at };
      return { player: { ...player, firstOrder: { ...record, felled, done } }, ticked: true, sealed: false };
    }
    if (this.isDone(record, task)) return unchanged;
    if (task === 'OUT' && !FIRST_TASKS.filter(t => t !== 'OUT').every(t => this.isDone(record, t))) return unchanged;
    const next: IFirstOrderRecord = { ...record, done: { ...record.done, [task]: at } };
    if (task !== 'OUT') return { player: { ...player, firstOrder: next }, ticked: true, sealed: false };
    return { player: { ...player, firstOrder: next, tutorialSealedAt: at }, ticked: true, sealed: true };
  },

  /** The list the field shows, in his order. */
  rows(record: IFirstOrderRecord): IFirstOrderRow[] {
    const current = this.current(record);
    return FIRST_TASKS.map(task => {
      const done = this.isDone(record, task);
      const now = task === current;
      const title = task === 'FELL' ? `${TITLES.FELL}, ${Math.min(record.felled, CREATURES_TO_FELL)} of ${CREATURES_TO_FELL}` : TITLES[task];
      return { task, title, done, current: now, mark: done ? MARK.done : now ? MARK.now : MARK.later, word: done ? 'DONE' : now ? 'NOW' : '' };
    });
  },

  hint(task: FirstTask): string {
    return HINTS[task];
  },

  doneLine(task: FirstTask): string {
    return DONE_LINES[task];
  }
};

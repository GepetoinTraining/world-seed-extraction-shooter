/**
 * THE HUB DOES THE SAME ARITHMETIC (D134). Pedro: "they need to have the same reading done at
 * different times, without each knowing the other, IF the player sends first they write to the DB
 * and the server trusts them... when the server checks the reading needs to be the same", and, the
 * same night, what a mismatch costs: "I banned a certed minted character... their altered readings
 * won't fit". So the rows are held as sent, the hub reruns what it can rerun exactly, and a reading
 * that does not land where the player's did challenges that character's standing on this hub.
 *
 * What is rerun, and why only that:
 *   gold    every row's effect on the character's own gold (goldOfRow), added in seq order: the
 *           hub's reading, signed into its answer, and set beside the reading the player sends
 *   drops   every drop a session rolled on a loot table (LootLaw.roll): whole numbers and one plain
 *           divide, so a rerun on any engine lands exactly; the table checked by the law first, so
 *           a table with numbers of its own reruns to the law's drop, not the player's
 * Rolls on the old code's tables use powers and floats the engines do not agree on (PLAN, D134), so
 * they are counted as not rerun, never challenged.
 *
 * Pure: what it reads is handed in.
 */
import { LootLaw, lootItemsOf, type ILootTable } from '../../shared/logic/theme/LootLaw';
import { canonical } from '../../shared/logic/theme/ThemeCompiler';
import type { IThemePack } from '../../shared/logic/theme/ThemeTypes';

export interface IRerunFinder {
  /** A table the hub holds, or one sent with these receipts that the law passed untouched. */
  table(id: string): ILootTable | undefined;
  pack(themeId: string): IThemePack | undefined;
  /** A creature's definition, by its theme and id: its rank is the hub's, not the player's. */
  mob(themeId: string, defId: string): { rank: string } | undefined;
}

export interface IRolled { rolls: number; unchecked: number; wrong?: { seq: number; why: string } }

interface IAction { seq: number; type: string; data?: Record<string, any> }

/** Every drop in one session's receipt that rolled on a table, rolled again. */
export function rerunDrops(actions: IAction[], find: IRerunFinder): IRolled {
  let rolls = 0;
  let unchecked = 0;
  for (const a of actions) {
    const roll = a?.data?.table as { table?: string; rank?: string; lines?: unknown } | undefined;
    if (!roll) continue;
    const table = typeof roll.table === 'string' ? find.table(roll.table) : undefined;
    const pack = table ? find.pack(table.themeId) : undefined;
    if (!table || !pack || typeof a.data!.rollKey !== 'string') { unchecked++; continue; }

    let rank = String(roll.rank ?? '');
    if (a.type === 'KILL') {
      const def = find.mob(table.themeId, String(a.data!.defId ?? ''));
      if (!def) { unchecked++; continue; }
      if (def.rank !== rank) return { rolls, unchecked, wrong: { seq: a.seq, why: `A ${a.data!.defId} is rank ${def.rank} here, and the drop was rolled at ${rank}.` } };
      rank = def.rank;
    }
    // A chest's rank is its world's, which the hub does not hold: the drop is rerun at the rank it names
    const lines = LootLaw.roll(table, rank, a.data!.rollKey, lootItemsOf(pack));
    if (canonical(lines) !== canonical(roll.lines)) return { rolls, unchecked, wrong: { seq: a.seq, why: `The drop at action ${a.seq} does not land where this hub's rerun of its table lands.` } };
    rolls++;
  }
  return { rolls, unchecked };
}

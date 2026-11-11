/**
 * THE LOOT TABLES THIS GAME HOLDS (LootLaw.ts). Every one came from a model's words, through the
 * law, or from a hub that judged it the same way; nothing here edits a table. Kept in CONTENT
 * like a theme, and judged again as it is read, as anything from a store is.
 *
 * A drop rolls on a table when one fits its source in its theme. None fitting, the old code's
 * drop stands, so a world written before tables drops as it always did.
 */

import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { ILootTable, ILootVerdict, LootLaw, LootSource, sealLoot } from '../../../shared/logic/theme/LootLaw';
import { FIRST_THEME_LOOT } from '../../../shared/entities/generation/packs/firstThemeLoot';
import { FIRST_THEME_PACK } from '../../../shared/logic/theme/boot';

export const LOOT_CONTENT_TYPE = 'loot_table';

const held = new Map<string, ILootTable>();
/** The theme of the world a person is in: what its chests roll on. */
let entered: string | undefined;

export const LootBook = {
  /** Judged against its theme, which must be installed. The table held is the law's. */
  admit(table: unknown): ILootVerdict {
    const themeId = (table as ILootTable)?.themeId;
    const pack = ContentRegistry.get(themeId);
    if (!pack) return { ok: false, reason: 'Its theme is not one this game holds.' };
    const verdict = LootLaw.correct(table, pack);
    if (verdict.ok) held.set(verdict.table.id, verdict.table);
    return verdict;
  },

  forTheme(themeId: string | undefined): ILootTable[] {
    return [...held.values()].filter(t => t.themeId === themeId);
  },

  /**
   * The table a source in a theme rolls on, or none. `keys` are the creatures a body answers to, its
   * own kind first: a creature's own table comes before any that fits its tags.
   */
  tableFor(themeId: string | undefined, kind: LootSource, tags: string[], keys: string[] = []): ILootTable | undefined {
    return LootLaw.pick(LootBook.forTheme(themeId), { kind, tags, keys });
  },

  /**
   * The shipped world's own tables, one to a creature, held from the start: words in a pack, sealed
   * and judged here like any other. How many stood. Its world then asks no model for them.
   */
  admitShipped(): number {
    let count = 0;
    for (const words of FIRST_THEME_LOOT) {
      const verdict = LootBook.admit(sealLoot(FIRST_THEME_PACK.themeId, words));
      if (verdict.ok) count++;
      else console.warn(`[LOOT] Shipped table "${words.name}" refused: ${verdict.reason}`);
    }
    return count;
  },

  all: (): ILootTable[] => [...held.values()],

  /** A world is entered: its theme's tables are what its chests roll on. */
  enter(themeId: string | undefined) { entered = themeId; },
  entered: (): string | undefined => entered,

  /** Admitted, then saved. Refused whole if the law says no. */
  async bank(table: unknown): Promise<ILootVerdict> {
    const verdict = LootBook.admit(table);
    if (verdict.ok) await VectorStore.saveContent(verdict.table.id, LOOT_CONTENT_TYPE, verdict.table, verdict.table.name);
    return verdict;
  },

  /** After the themes: a table is judged against its theme. */
  async loadBanked(): Promise<number> {
    const docs = await VectorStore.query<{ content: ILootTable }>({ namespace: VectorNamespace.CONTENT, filter: { 'data.type': LOOT_CONTENT_TYPE } });
    let count = 0;
    for (const t of docs.map(d => d.data.content).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const verdict = LootBook.admit(t);
      if (verdict.ok) count++;
      else console.warn(`[LOOT] ${t?.name} refused at the door: ${verdict.reason}`);
    }
    return count;
  },

  /** For tests. */
  clear() { held.clear(); entered = undefined; }
};

/**
 * WRITING A THEME'S LOOT (LootLaw.ts). The one way a table comes to be: a model is asked, in bands,
 * for its theme; each table it answers is sealed (numbers from the formula, id from its words) and
 * banked through the law. A table refused is asked once more, told why, like a world's pass. A
 * theme with no table yet drops as the old code did, so nothing waits on this.
 *
 * Once per theme per session: entering a world asks for its theme's tables if it holds none.
 */

import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { LootBook } from './LootBook';
import { ILootWords, LOOT_SCHEMA, lootAskOf, sealLoot } from '../../../shared/logic/theme/LootLaw';
import { schemaProblem } from '../../../shared/logic/content/SchemaFit';

export interface ILootOutcome { status: string; data?: unknown; reason?: string }
export type LootDoor = (ask: unknown) => Promise<ILootOutcome>;

/** A table refused once is asked once more, told why. A guard on the bill, like a pass's. */
export const LOOT_TRIES = 2;

const asked = new Set<string>();

export const LootWriter = {
  /** Ask, seal, bank. How many tables stand after. */
  async write(themeId: string, door: LootDoor): Promise<{ ok: boolean; banked: number; reason?: string }> {
    const pack = ContentRegistry.get(themeId);
    if (!pack) return { ok: false, banked: 0, reason: 'That theme is not one this game holds.' };
    let refused: string | undefined;
    for (let attempt = 0; attempt < LOOT_TRIES; attempt++) {
      const out = await door(lootAskOf(pack, refused));
      if (out.status !== 'OK' || out.data === undefined) return { ok: false, banked: 0, reason: out.reason ?? `The door answered ${out.status}.` };
      const shape = schemaProblem(LOOT_SCHEMA, out.data);
      if (shape) { refused = shape; continue; }
      const words = (out.data as { tables: ILootWords[] }).tables;
      let banked = 0;
      const why: string[] = [];
      for (const w of words) {
        const verdict = await LootBook.bank(sealLoot(themeId, w));
        if (verdict.ok) banked++;
        else why.push(`${w.name}: ${verdict.reason}`);
      }
      if (banked > 0) return { ok: true, banked, ...(why.length ? { reason: `Refused: ${why.join('; ')}` } : {}) };
      refused = why.join('; ') || 'No table came back.';
    }
    return { ok: false, banked: 0, reason: `Refused twice: ${refused}` };
  },

  /** Entering a world: its theme's tables, if it holds none and they were not asked for this session. */
  ensure(themeId: string | undefined, door: LootDoor): Promise<unknown> | undefined {
    if (!themeId || asked.has(themeId) || LootBook.forTheme(themeId).length > 0) return undefined;
    asked.add(themeId);
    return LootWriter.write(themeId, door).then(r => {
      if (!r.ok) console.warn(`[LOOT] No tables for ${themeId} yet: ${r.reason}`);
      return r;
    }, e => console.warn('[LOOT] The door did not answer:', e));
  },

  /** For tests. */
  forget() { asked.clear(); }
};

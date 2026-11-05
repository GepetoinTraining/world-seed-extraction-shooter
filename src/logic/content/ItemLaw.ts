/**
 * AN ITEM, CHECKED (Pedro, 2026-11-04: "the item, or the loot table, or the world manifest gets
 * the diff, never the full load"). An item a world carries is checked against the definition it
 * was minted from: what the definition fixes must be the definition's, and what the formula
 * derives must be the formula's. What is off is put right, field by field, as a list of changes.
 *
 * What is checked, and why only that:
 *   found gear   rank and level from its base; power and worth from base, rank, rarity and
 *                quality, the factory's own arithmetic (ItemFactory.createFromTemplate)
 *   a material   rank and rarity from its definition
 *   a made thing its chain, inferred by the host's tech web (Pedro, 2026-11-04: "if the crafting
 *                was done locally then brought online the chain of the crafting is inferrable by
 *                the host's tech web"): every step one the host knows, at its recipe's labor, every
 *                material one it holds; its worth the chain's price (CompositionSystem.priceOf), a
 *                made piece of gear's power the chain's budget (powerBudget)
 * Its rolled base stats and affixes come from a stream the hub does not hold, so they are not
 * judged here. Where it sat before it came online (a chest in an owner's house) is not asked:
 * what made it is. A minted thing with no definition the host holds is refused.
 *
 * Pure: definitions are handed in.
 */

import { RANK_MULTIPLIERS, RARITY_MULTIPLIERS } from '../../constants';
import { IItem, ItemType, Rarity, UniversalRank } from '../../../types';
import type { ItemDefinition } from '../../entities/item/data/itemDefinitions';
import type { ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { CompositionSystem } from '../economy/CompositionSystem';

/** A gear base's level, by rank: ItemFactory.getLevelForRank's table, read the same way. */
const LEVEL: Record<string, number> = { F: 1, E: 10, D: 20, C: 30, B: 40, A: 50, S: 60, SS: 70, SSS: 80 };

export interface IItemChange { field: 'rank' | 'level' | 'itemPower' | 'value' | 'rarity' | 'quality'; value: unknown }

export type IItemVerdict =
  | { ok: true; checked: true; reason?: undefined; item: IItem; changes: IItemChange[] }
  | { ok: true; checked: false; reason: string; item: IItem; changes: [] }
  | { ok: false; checked?: undefined; reason: string; item?: undefined; changes?: undefined };

export interface IItemDefinitions {
  base(id: string): ItemDefinition | undefined;
  resource(id: string): ResourceDef | undefined;
  /** A step of making the host's tech web knows, with its labor (null: it follows what went in). */
  step(recipeId: string): { laborSeconds: number | null } | undefined;
}

const RARITIES = Object.values(Rarity) as string[];
const QUALITY_LOW = -0.2;
const QUALITY_HIGH = 0.2;

export const ItemLaw = {
  correct(item: unknown, defs: IItemDefinitions): IItemVerdict {
    const it = item as IItem;
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || typeof it.universalDefinitionId !== 'string') return { ok: false, reason: 'That is not an item.' };
    if (!RARITIES.includes(it.rarity)) return { ok: false, reason: `Its rarity ${String(it.rarity)} is not one this game has.` };

    const changes: IItemChange[] = [];
    const out: IItem = { ...it };
    const set = <K extends IItemChange['field']>(field: K, value: IItem[K]) => {
      if (out[field] !== value) { changes.push({ field, value }); (out as any)[field] = value; }
    };

    const base = defs.base(it.universalDefinitionId);
    const worldMade = !it.composition || it.composition.steps.length === 0;

    // Made: the chain is inferred step by step from what the host knows, then its price and budget follow
    if (!worldMade) {
      const c = it.composition!;
      for (const step of c.steps) {
        const known = defs.step(step.recipeId);
        if (!known) return { ok: false, reason: `Its chain has a step this host's tech web cannot infer: ${step.name ?? step.recipeId}.` };
        if (known.laborSeconds !== null && step.laborSeconds !== known.laborSeconds) return { ok: false, reason: `Its step ${step.name ?? step.recipeId} claims ${step.laborSeconds}s of labor; its recipe takes ${known.laborSeconds}s.` };
      }
      const stray = c.materials.find(m => !defs.resource(m.defId) && !defs.base(m.defId));
      if (stray) return { ok: false, reason: `Its chain starts from ${stray.name ?? stray.defId}, which this host does not hold.` };
      if (!(c.depth >= 1)) return { ok: false, reason: 'A made thing\'s chain is at least one step deep.' };
      if (base && it.type === ItemType.GEAR) {
        set('rank', base.rank);
        set('level', LEVEL[base.rank] ?? 1);
        set('itemPower', CompositionSystem.powerBudget(c));
      }
      set('value', CompositionSystem.priceOf(c));
      return { ok: true, checked: true, item: out, changes };
    }
    if (base && it.type === ItemType.GEAR && worldMade) {
      const q = Number(it.quality);
      // Rolled as next() * 0.4 - 0.2, so it is under the top and at least the bottom
      if (!Number.isFinite(q)) return { ok: false, reason: 'Its quality is not a number.' };
      if (q < QUALITY_LOW || q >= QUALITY_HIGH) set('quality', Math.min(Math.max(q, QUALITY_LOW), QUALITY_HIGH - 1e-9));
      set('rank', base.rank);
      set('level', LEVEL[base.rank] ?? 1);
      const power = Math.floor(base.base_ip * RANK_MULTIPLIERS[base.rank as UniversalRank] * RARITY_MULTIPLIERS[out.rarity] * (1 + out.quality));
      set('itemPower', power);
      set('value', Math.max(1, Math.floor(power * 2)));
      return { ok: true, checked: true, item: out, changes };
    }

    const resource = defs.resource(it.universalDefinitionId);
    if (resource && it.type !== ItemType.GEAR) {
      set('rank', resource.rank ?? UniversalRank.F);
      set('rarity', resource.rarity ?? Rarity.COMMON);
      return { ok: true, checked: true, item: out, changes };
    }

    if (!base && !resource) return { ok: false, reason: `It is minted from ${it.universalDefinitionId}, which this world's themes do not hold.` };
    return { ok: true, checked: false, reason: 'A thing of this kind carries nothing the host can infer.', item: it, changes: [] };
  }
};

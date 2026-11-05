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
 * Its rolled base stats and affixes come from a stream the hub does not hold, so they are not
 * judged here; a made thing's worth is its chain's (CompositionSystem), checked where the chain
 * is. Anything else comes back as not checked, said so, never passed as checked.
 *
 * Pure: definitions are handed in.
 */

import { RANK_MULTIPLIERS, RARITY_MULTIPLIERS } from '../../constants';
import { IItem, ItemType, Rarity, UniversalRank } from '../../../types';
import type { ItemDefinition } from '../../entities/item/data/itemDefinitions';
import type { ResourceDef } from '../../entities/item/data/resourceDefinitions';

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
    return { ok: true, checked: false, reason: 'A made thing\'s numbers are its chain\'s, and are checked with the chain.', item: it, changes: [] };
  }
};

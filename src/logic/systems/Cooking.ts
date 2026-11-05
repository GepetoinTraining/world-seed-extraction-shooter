/**
 * COOKING (D63): what comes off a farm becomes a meal at a hearth. The shape is read from the
 * donor's `engine/cooking.ts`, without its tables: a meal is whatever went in, and what it
 * gives reads the ingredients, so a new material needs nothing here.
 *
 * Pure and keyed. The caller moves the items and signs the record. No model is asked: a meal
 * says plainly what is in it. The numbers are guesses until Wave 12.
 */

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../../../types';
import { COOK_WAY } from '../economy/gameWays';
import { answersTag } from '../../entities/hub/room';
import { LoadoutSystem } from '../../entities/player/systems/LoadoutSystem';
import { CompositionSystem } from '../economy/CompositionSystem';
import { Rng, fnv1a } from '../rng/DeterministicRNG';

/** The least that makes a meal, rather than a thing eaten where it stands. */
const LEAST_IN_THE_POT = 2;
/** What a pot takes per thing in it. */
const SECONDS_PER_THING = 60;
const RESTORE_BASE = 5;
/** Each different thing in the pot makes all of it worth this much more. */
const VARIETY = 0.25;
/** What a level of the skill adds. No top. */
const SKILL_SHARE = 0.02;

const RANK_ORDER = Object.values(UniversalRank);

export class Cooking {

  /** What a hearth asks to stand. */
  static readonly HEARTH_BILL = { tag: 'stone', count: 4 };

  static verdict(items: IItem[]): { ok: boolean; reason?: string } {
    if (items.length < LEAST_IN_THE_POT) return { ok: false, reason: `A meal takes at least ${LEAST_IN_THE_POT} things that can be eaten.` };
    const wrong = items.find(i => !answersTag(i, 'food'));
    if (wrong) return { ok: false, reason: `${LoadoutSystem.shownName(wrong)} is not food.` };
    return { ok: true };
  }

  static cookMs(items: IItem[]): number {
    return items.length * SECONDS_PER_THING * 1000;
  }

  /** "Stew of A and B": it says what it is, and no table decides that. */
  private static nameOf(items: IItem[]): string {
    const names = [...new Set(items.map(i => LoadoutSystem.shownName(i)))].sort();
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `Stew of ${list}`;
  }

  static meal(items: IItem[], key: string, skillLevel = 0): IItem {
    const distinct = new Set(items.map(i => i.universalDefinitionId)).size;
    const rng = Rng.fromKey(`cook:${key}`);
    const body = items.reduce((sum, i) => sum + RESTORE_BASE + (i.value ?? 0), 0);
    const restore = Math.round(body * (1 + VARIETY * (distinct - 1)) * (1 + SKILL_SHARE * skillLevel) * (1 + rng.next() * 0.1));
    const composition = CompositionSystem.compose(
      { recipeId: COOK_WAY.id, name: 'Cooked', laborSeconds: this.cookMs(items) / 1000, facility: 'HEARTH' },
      items.map(i => i.composition ?? CompositionSystem.root({ id: i.universalDefinitionId, name: i.name }, 'WORLD')),
      1
    );
    const rank = RANK_ORDER[Math.max(0, ...items.map(i => RANK_ORDER.indexOf(i.rank)))];
    return {
      id: `itm_meal_${fnv1a(`meal:${key}:${items.map(i => i.id).join()}`).toString(16).padStart(8, '0')}`,
      universalDefinitionId: 'itm_meal', name: this.nameOf(items), description: 'Hot, for now.',
      type: ItemType.CONSUMABLE, slot: SlotType.NONE, rank, rarity: Rarity.COMMON, quality: 0, level: 1,
      value: CompositionSystem.priceOf(composition), itemPower: 0, tags: ['food', 'meal', 'consumable'],
      // D6: what its components carried rides what they make
      affixes: items.flatMap(i => i.affixes ?? []),
      dimensions: { width: 1, height: 1 }, weight: Math.round(items.reduce((sum, i) => sum + (i.weight ?? 0), 0) * 5) / 10,
      stats: { health_restore: restore }, visuals: { modelId: 'resource', colorHex: '#9ca3af' }, icon: 'resource_icon',
      history: { dropDate: 0, killCount: 0 }, isIdentified: true, composition
    } as IItem;
  }
}

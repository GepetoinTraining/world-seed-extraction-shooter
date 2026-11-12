/**
 * SPELLCRAFT (Layer 4, D41): practice first, study after.
 *
 * A person picks elements and tests them. The set decides what it does: fixed and
 * visible, keyed by the tags alone, the same for everyone, and the same in any order
 * of picking (the tag law's own rule). What it is CALLED is not known until a rest,
 * and the first to name it names it for everyone, signed. Paid from reserves, per
 * element, filled by what is gathered; the mind's stats widen them, so a mage pays
 * with head gear (D22).
 */

import { IAttributes, IEquipmentState, IPlayer } from '../../../shared/types';
import { fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { COST_BANDS, DELIVERIES, EFFECTS } from '../../../shared/logic/theme/ThemeTypes';
import { abilityNumbers } from '../../../shared/logic/theme/ThemeFormula';
import { IEffectAbility } from '../../../shared/logic/systems/EffectSystem';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';

const WEAVE_PREFIX = 'weave_';
/** What a weave can do in the field. A rest and a forced way out are not chosen by a hash. */
const WEAVE_EFFECTS = EFFECTS.filter(e => e !== 'rest' && e !== 'forced_exit');
const WEAVE_DELIVERIES = DELIVERIES.filter(d => d !== 'aura');

const BASE_RESERVE = 20;
const RESERVE_PER_FOCUS = 5;
/** How many times over one gathering fills a reserve. A guess until Wave 12. */
const AETHER_PER_GATHER = 2;

export class WeaveSystem {

  /** Same set, same id, whatever order they were picked in. */
  static idOf(elements: string[]): string {
    return `${WEAVE_PREFIX}${TagLaw.canonical(elements).join('+')}`;
  }

  /** What a set of elements does. Pure: the elements alone decide it. */
  static weave(elements: string[]): IEffectAbility {
    const set = TagLaw.canonical(elements);
    if (set.length === 0) throw new Error('An empty weave is not a weave.');
    const hash = fnv1a(`weave:v1:${set.join('+')}`);
    return {
      id: this.idOf(set),
      name: this.floorName(set),
      elements: set,
      effect: WEAVE_EFFECTS[hash % WEAVE_EFFECTS.length],
      delivery: WEAVE_DELIVERIES[(hash >>> 8) % WEAVE_DELIVERIES.length],
      // More elements cost more and do more. Nothing limits how many a person may pick.
      cost: COST_BANDS[Math.min(COST_BANDS.length - 1, set.length)]
    };
  }

  /** Until a rest gives it a word: what it plainly is. */
  static floorName(elements: string[]): string {
    return `Unnamed working of ${TagLaw.canonical(elements).join(' and ')}`;
  }

  /** What one casting draws from each element's reserve. */
  static aetherPerElement(ability: IEffectAbility, rank: string): number {
    const { aether } = abilityNumbers(ability.cost, rank as never, false, ability.effect);
    return Math.ceil(aether / Math.max(1, ability.elements.length));
  }

  static capacity(attributes: IAttributes, equipment?: IEquipmentState): number {
    return BASE_RESERVE + ((attributes.focus ?? 0) + StatSystem.total(equipment, 'focus')) * RESERVE_PER_FOCUS;
  }

  static canCast(player: IPlayer, ability: IEffectAbility, rank: string): { ok: boolean; short?: string } {
    const each = this.aetherPerElement(ability, rank);
    const short = ability.elements.find(e => (player.reserves?.[e] ?? 0) < each);
    return short ? { ok: false, short } : { ok: true };
  }

  static spend(player: IPlayer, ability: IEffectAbility, rank: string): IPlayer {
    const each = this.aetherPerElement(ability, rank);
    const reserves = { ...(player.reserves ?? {}) };
    for (const e of ability.elements) reserves[e] = Math.max(0, (reserves[e] ?? 0) - each);
    return { ...player, reserves };
  }

  /** The element a material gives up when gathered: keyed by what it is, from its own world's elements. */
  static elementOf(materialId: string, elements: string[]): string | undefined {
    if (elements.length === 0) return undefined;
    const sorted = [...elements].sort();
    return sorted[fnv1a(`aether:v1:${materialId}`) % sorted.length];
  }

  static gather(player: IPlayer, element: string | undefined, equipment = player.equipment): IPlayer {
    if (!element) return player;
    const cap = this.capacity(player.attributes, equipment);
    const reserves = { ...(player.reserves ?? {}) };
    reserves[element] = Math.min(cap, (reserves[element] ?? 0) + AETHER_PER_GATHER);
    return { ...player, reserves };
  }
}

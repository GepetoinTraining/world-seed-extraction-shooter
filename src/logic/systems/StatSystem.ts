/**
 * THE STATS ACT (Layer 0, line 77)
 *
 * One door for what worn gear adds up to. A stat either has a reader here, named
 * in STAT_READERS, or a bank may not roll it: AffixBank refuses the batch whole.
 * That is what stops a card's numbers from being decoration again.
 *
 * What a piece adds, it adds whether or not anyone has read it (D19). A broken
 * piece adds nothing, and a piece in the pack is not on the body.
 */

import { IAttributes, IEquipmentState, IItem, MENTAL_ATTRIBUTES } from '../../../types';

/** Tiles to pixels, as everywhere in the field. */
const PX = 20;
/** How close a drop must be before the hands take it, bare of any stat. */
const BASE_PICKUP_PX = 30;

/** Every stat a batch may roll, and the code that reads it. */
export const STAT_READERS: Record<string, string> = {
  damage: 'CombatMath.weaponDamage',
  defense: 'CombatMath.mitigationOf',
  physical_reduction: 'CombatMath.mitigationOf',
  max_health: 'StatSystem.maxHealth',
  max_energy: 'StatSystem.maxEnergy',
  attack_speed: 'CombatMath.fireCooldownMs',
  accuracy_rating: 'CombatMath.outgoing',
  crit_chance: 'CombatMath.outgoing',
  crit_multiplier: 'CombatMath.outgoing',
  poison_damage: 'CombatMath.outgoing',
  evasion_rating: 'CombatMath.incoming',
  block_chance: 'CombatMath.incoming',
  light_radius: 'StatSystem.sightPx',
  pickup_radius: 'StatSystem.pickupRadiusPx',
  carry_capacity: 'LoadoutSystem.carryLimit',
  carry_bonus_kg: 'LoadoutSystem.carryLimit',
  noise_reduction: 'MobAI.tick',
  movement_speed: 'LoadoutSystem.walkTilesPerSecond',
  movement_speed_penalty: 'LoadoutSystem.walkTilesPerSecond',
  luck_find_rarity: 'CombatSystem.tick',
  field_analysis_speed: 'StudySystem.studyAsk',
  mining_power: 'InteractionEngine',
  chopping_power: 'InteractionEngine',
  health_restore: 'playerStore.useConsumable',
  durability: 'CombatMath.isUsable',
  maxDurability: 'repairCost',
  upkeep_discount_pct: 'room.roomBonuses',
  craft_speed_pct: 'room.roomBonuses',
  cart_lock: 'CartSystem',
  cart_alarm: 'CartSystem'
};

const MENTAL = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);

export class StatSystem {

  /** Has this stat a reader? A frame's mental line reads through recon and the head budget (D22). */
  static isRead(stat: string): boolean {
    return stat in STAT_READERS || MENTAL.has(stat);
  }

  /** The pieces on the body that are still whole. */
  static worn(equipment?: IEquipmentState): IItem[] {
    if (!equipment) return [];
    const on = new Set(Object.values(equipment.slots));
    return equipment.items.filter(i => {
      if (!on.has(i.id)) return false;
      const s = i.stats ?? {};
      return !(s.maxDurability && s.durability === 0);
    });
  }

  /** What everything worn adds up to, for one stat. */
  static total(equipment: IEquipmentState | undefined, stat: string): number {
    return this.worn(equipment).reduce((sum, i) => sum + ((i.stats as Record<string, number> | undefined)?.[stat] ?? 0), 0);
  }

  static maxHealth(attributes: IAttributes, equipment?: IEquipmentState): number {
    return Math.max(1, 100 + attributes.constitution * 10 + this.total(equipment, 'max_health'));
  }

  /** One day's supply (D51). Worn gear can widen it; nothing refills it but a rest. */
  static maxEnergy(attributes: IAttributes, equipment?: IEquipmentState): number {
    return Math.max(0, 50 + attributes.endurance * 5 + this.total(equipment, 'max_energy'));
  }

  static pickupRadiusPx(equipment?: IEquipmentState): number {
    return Math.max(PX / 2, BASE_PICKUP_PX + this.total(equipment, 'pickup_radius') * PX);
  }

  /** How much further than the window the field is seen, and kept on the minimap. */
  static sightPx(equipment?: IEquipmentState): number {
    return this.total(equipment, 'light_radius') * PX;
  }
}

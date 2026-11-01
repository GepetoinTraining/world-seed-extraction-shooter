/**
 * COMBAT MATH (Wave 4)
 *
 * Every number that decides a fight, in one pure file:
 *   weapon damage   <- itemPower (the universal power scalar)
 *   fire cooldown   <- attack_speed stat
 *   mitigation      <- armor's physical_reduction
 *   mob damage      <- definition baseDamage (+ tag multipliers)
 *
 * Nothing here reads stores or rolls dice; callers supply items and defs.
 * That is what makes "swapping F->E gear changes time-to-kill" assertable
 * in a simulation instead of by feel (PLAN W4 gate).
 */

import { IAttributes, IEquipmentState, IItem } from '../../../types';
import { IMobDefinition } from '../mob/types';
import { StatSystem } from '../../logic/systems/StatSystem';
import { Rng } from '../../logic/rng/DeterministicRNG';

export const UNARMED_DAMAGE = 5;
export const UNARMED_SHOTS_PER_SEC = 1.0;
export const MAX_MITIGATION = 0.6;
/** Layer 0's odds. Guesses until Wave 12. */
const BASE_GLANCE = 0.2;
const GLANCE_FACTOR = 0.5;
const BASE_CRIT_MULTIPLIER = 1.5;
const BLOCK_FACTOR = 0.5;

export interface IOutgoingHit { damage: number; crit: boolean; glance: boolean; poison: number }
export interface IIncomingHit { damage: number; dodged: boolean; blocked: boolean }

/** A rating's pull, approaching but never reaching one, and able to go negative. */
const curve = (rating: number): number => rating / (Math.abs(rating) + 100);

export class CombatMath {

  /** Is this item usable as a weapon right now? (broken = no) */
  static isUsable(item: IItem | undefined): boolean {
    if (!item) return false;
    const dur = item.stats?.durability;
    return dur === undefined || dur > 0;
  }

  /** Damage of one player projectile/swing with this weapon. */
  static weaponDamage(weapon: IItem | undefined, equipment?: IEquipmentState): number {
    const base = this.isUsable(weapon) ? Math.round(6 + (weapon!.itemPower || 0) * 0.08) : UNARMED_DAMAGE;
    return Math.max(1, base + StatSystem.total(equipment, 'damage'));
  }

  /**
   * One swing or shot, keyed: what it does, with what is worn and who holds it. The same
   * key answers the same. skillPower is what the hand's own skill adds (WebSystem.handPower).
   */
  static outgoing(weapon: IItem | undefined, equipment: IEquipmentState | undefined, key: string, attributes?: IAttributes, skillPower: number = 0): IOutgoingHit {
    const rng = Rng.fromKey(key);
    const bare = this.weaponDamage(weapon, equipment);
    const base = Math.round((this.isMelee(weapon) ? bare * StatSystem.meleeScale(attributes) : bare) * (1 + skillPower));
    const poison = StatSystem.total(equipment, 'poison_damage');
    if (rng.next() < StatSystem.critChance(equipment, attributes)) {
      const multiplier = BASE_CRIT_MULTIPLIER + StatSystem.total(equipment, 'crit_multiplier');
      return { damage: Math.round(base * multiplier), crit: true, glance: false, poison };
    }
    const accuracy = Math.max(-99, StatSystem.accuracyRating(equipment, attributes));
    if (rng.next() < BASE_GLANCE * 100 / (100 + accuracy)) {
      return { damage: Math.max(1, Math.round(base * GLANCE_FACTOR)), crit: false, glance: true, poison };
    }
    return { damage: base, crit: false, glance: false, poison };
  }

  /** Milliseconds between shots/swings. */
  static fireCooldownMs(weapon: IItem | undefined, equipment?: IEquipmentState, attributes?: IAttributes): number {
    const own = this.isUsable(weapon) ? weapon!.stats?.attack_speed || 1.0 : UNARMED_SHOTS_PER_SEC;
    // The hand's own rate, and what everything else on the body adds to it
    const onBody = StatSystem.worn(equipment).some(i => i.id === weapon?.id);
    const others = StatSystem.total(equipment, 'attack_speed') - (onBody ? weapon!.stats?.attack_speed ?? 0 : 0);
    return Math.round(1000 / Math.max(0.1, (own + others) * StatSystem.fireRateScale(attributes)));
  }

  /** Melee weapons swing; everything else (and bare hands) fires. */
  static isMelee(weapon: IItem | undefined): boolean {
    return !!weapon && this.isUsable(weapon) && (weapon.tags || []).includes('melee');
  }

  /** Magic foci fire a NOVA pattern and spend energy. */
  static isFocus(weapon: IItem | undefined): boolean {
    return !!weapon && this.isUsable(weapon) && (weapon.tags || []).includes('magic');
  }

  /** Fraction of incoming damage removed by the equipped armor. */
  static mitigation(armor: IItem | undefined): number {
    if (!this.isUsable(armor)) return 0;
    const reduction = armor!.stats?.physical_reduction || (armor!.itemPower || 0) * 0.0004;
    return Math.min(MAX_MITIGATION, reduction);
  }

  /** Apply mitigation; at least 1 damage always lands. */
  static applyMitigation(raw: number, armor: IItem | undefined): number {
    if (raw <= 0) return 0;
    return Math.max(1, Math.round(raw * (1 - this.mitigation(armor))));
  }

  /** What everything worn takes off a blow. Negative defense adds to it. */
  static mitigationOf(equipment: IEquipmentState | undefined): number {
    const worn = StatSystem.worn(equipment);
    const reduction = worn.reduce((sum, i) => sum + (i.stats?.physical_reduction ?? 0), 0);
    const chestId = equipment?.slots.CHEST;
    const chest = worn.find(i => i.id === chestId);
    const fallback = chest && !chest.stats?.physical_reduction ? (chest.itemPower || 0) * 0.0004 : 0;
    return Math.min(MAX_MITIGATION, reduction + fallback + curve(StatSystem.total(equipment, 'defense')));
  }

  /** One blow arriving, keyed: dodged, blocked, or mitigated. Who it lands on counts too. */
  static incoming(raw: number, equipment: IEquipmentState | undefined, key: string, attributes?: IAttributes): IIncomingHit {
    if (raw <= 0) return { damage: 0, dodged: false, blocked: false };
    const rng = Rng.fromKey(key);
    if (rng.next() < Math.max(0, curve(StatSystem.evasionRating(equipment, attributes)))) {
      return { damage: 0, dodged: true, blocked: false };
    }
    const blocked = rng.next() < StatSystem.total(equipment, 'block_chance');
    const landed = (blocked ? raw * BLOCK_FACTOR : raw) * StatSystem.blowFactor(attributes);
    return { damage: Math.max(1, Math.round(landed * (1 - this.mitigationOf(equipment)))), dodged: false, blocked };
  }

  /** A mob attack's damage from its definition. */
  static mobDamage(def: IMobDefinition | undefined): number {
    if (!def) return 8;
    let dmg = def.baseDamage || 8;
    if (def.tags?.includes('boss')) dmg = Math.round(dmg * 1.5);
    return dmg;
  }

  /**
   * Deterministic duel sim: how many shots does this weapon need to drop
   * `mobHealth`? (The gate's TTK assertion in its purest form.)
   */
  static shotsToDefeat(weapon: IItem | undefined, mobHealth: number): number {
    const dmg = this.weaponDamage(weapon);
    return Math.ceil(mobHealth / dmg);
  }

  /** TTK in ms = shots x cooldown (first shot free). */
  static timeToDefeatMs(weapon: IItem | undefined, mobHealth: number): number {
    const shots = this.shotsToDefeat(weapon, mobHealth);
    return (shots - 1) * this.fireCooldownMs(weapon);
  }
}

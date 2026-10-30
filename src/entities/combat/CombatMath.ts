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

import { IItem } from '../../../types';
import { IMobDefinition } from '../mob/types';

export const UNARMED_DAMAGE = 5;
export const UNARMED_SHOTS_PER_SEC = 1.0;
export const MAX_MITIGATION = 0.6;

export class CombatMath {

  /** Is this item usable as a weapon right now? (broken = no) */
  static isUsable(item: IItem | undefined): boolean {
    if (!item) return false;
    const dur = item.stats?.durability;
    return dur === undefined || dur > 0;
  }

  /** Damage of one player projectile/swing with this weapon. */
  static weaponDamage(weapon: IItem | undefined): number {
    if (!this.isUsable(weapon)) return UNARMED_DAMAGE;
    return Math.round(6 + (weapon!.itemPower || 0) * 0.08);
  }

  /** Milliseconds between shots/swings. */
  static fireCooldownMs(weapon: IItem | undefined): number {
    if (!this.isUsable(weapon)) return 1000 / UNARMED_SHOTS_PER_SEC;
    const aps = weapon!.stats?.attack_speed || 1.0;
    return Math.round(1000 / aps);
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

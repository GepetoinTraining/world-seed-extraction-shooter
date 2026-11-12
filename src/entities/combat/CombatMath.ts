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

import { PieceLaw } from '../../../shared/logic/theme/PieceLaw';
import { IAttributes, IEquipmentState, IItem } from '../../../shared/types';
import { IMobDefinition } from '../../../shared/entities/mob/types';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { BASE_CRIT_MULTIPLIER, BASE_GLANCE, BLOCK_FACTOR, GLANCE_FACTOR, RATING_KNEE, UNARMED_SHOTS_PER_SEC } from '../../../shared/logic/systems/FightNumbers';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { isThrowable, thrownDamage } from '../../../shared/entities/item/Throwable';

export const UNARMED_DAMAGE = 5;
export { UNARMED_SHOTS_PER_SEC };
export const MAX_MITIGATION = 0.6;
/** Layer 0's odds. Guesses until Wave 12. */

export interface IOutgoingHit { damage: number; crit: boolean; glance: boolean; poison: number }
export interface IIncomingHit { damage: number; dodged: boolean; blocked: boolean }

/** A rating's pull, approaching but never reaching one, and able to go negative. */
const curve = (rating: number): number => rating / (Math.abs(rating) + RATING_KNEE);

export class CombatMath {

  /** Is this item usable as a weapon right now? (broken = no) */
  static isUsable(item: IItem | undefined): boolean {
    if (!item) return false;
    const dur = item.stats?.durability;
    return dur === undefined || dur > 0;
  }

  /** Damage of one player projectile/swing with this weapon. */
  static weaponDamage(weapon: IItem | undefined, equipment?: IEquipmentState): number {
    // C14: a stone thrown lands by how hard it is, and a bare hand by what a bare hand does
    const base = isThrowable(weapon) ? thrownDamage(weapon!)
      : !this.isUsable(weapon) ? UNARMED_DAMAGE
      // The rarity rescale: a fifth of the piece's power, with no bare constant beside it (1.2). A piece a
      // standing world minted keeps the blow it was stamped with (call 18)
      : weapon!.pieceLaw !== undefined ? Math.round(PieceLaw.blowOf(weapon!.itemPower || 0))
      : Math.round(6 + (weapon!.itemPower || 0) * 0.08);
    return Math.max(1, base + StatSystem.total(equipment, 'damage'));
  }

  /**
   * One swing or shot, keyed: what it does, with what is worn and who holds it. The same
   * key answers the same. skillPower is what the hand's own skill adds (WebSystem.handPower).
   */
  static outgoing(weapon: IItem | undefined, equipment: IEquipmentState | undefined, key: string, attributes?: IAttributes, skillPower: number = 0): IOutgoingHit {
    const rng = Rng.fromKey(key);
    const base = this.baseHit(weapon, equipment, attributes, skillPower);
    const poison = StatSystem.total(equipment, 'poison_damage');
    if (rng.next() < StatSystem.critChance(equipment, attributes)) {
      return { damage: Math.round(base * this.critMultiplier(equipment)), crit: true, glance: false, poison };
    }
    if (rng.next() < this.glanceChance(equipment, attributes)) {
      return { damage: Math.max(1, Math.round(base * GLANCE_FACTOR)), crit: false, glance: true, poison };
    }
    return { damage: base, crit: false, glance: false, poison };
  }

  // The parts of a blow, each named once, so the large sheet shows the very numbers a fight rolls
  // against and never a second sum of its own (the interface pass, 2026-11-11).

  /** A hit before it crits or glances: the hand, what is worn, strength for a swing, and the hand's own skill. */
  static baseHit(weapon: IItem | undefined, equipment: IEquipmentState | undefined, attributes?: IAttributes, skillPower: number = 0): number {
    const bare = this.weaponDamage(weapon, equipment);
    return Math.round((this.isMelee(weapon) ? bare * StatSystem.meleeScale(attributes) : bare) * (1 + skillPower));
  }

  /** What a crit multiplies a hit by: the base, and what is worn. */
  static critMultiplier(equipment: IEquipmentState | undefined): number {
    return BASE_CRIT_MULTIPLIER + StatSystem.total(equipment, 'crit_multiplier');
  }

  /** The chance a hit that does not crit glances: fewer with accuracy, from dexterity and what is worn. */
  static glanceChance(equipment: IEquipmentState | undefined, attributes?: IAttributes): number {
    const accuracy = Math.max(-99, StatSystem.accuracyRating(equipment, attributes));
    return BASE_GLANCE * 100 / (100 + accuracy);
  }

  /** What a glance leaves of a hit. */
  static glanceFactor(): number {
    return GLANCE_FACTOR;
  }

  /** The chance a blow arriving misses entirely: the evasion rating, from agility and what is worn, on its curve. */
  static dodgeChance(equipment: IEquipmentState | undefined, attributes?: IAttributes): number {
    return Math.max(0, curve(StatSystem.evasionRating(equipment, attributes)));
  }

  /** The chance a blow that lands is blocked, and what a block leaves of it. */
  static blockChance(equipment: IEquipmentState | undefined): number {
    return StatSystem.total(equipment, 'block_chance');
  }
  static blockFactor(): number {
    return BLOCK_FACTOR;
  }

  /** Milliseconds between shots/swings. */
  static fireCooldownMs(weapon: IItem | undefined, equipment?: IEquipmentState, attributes?: IAttributes): number {
    const own = this.isUsable(weapon) ? weapon!.stats?.attack_speed || 1.0 : UNARMED_SHOTS_PER_SEC;
    // The hand's own rate, and what everything else on the body adds to it
    const onBody = StatSystem.worn(equipment).some(i => i.id === weapon?.id);
    // An old piece's added rate rides `attack_speed`; the rarity rescale's is `haste`
    const others = StatSystem.total(equipment, 'attack_speed') - (onBody ? weapon!.stats?.attack_speed ?? 0 : 0) + StatSystem.total(equipment, 'haste');
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

  /**
   * What everything worn takes off a blow: one rating on its curve, with no top (the rarity rescale, 1.4: "defense and
   * physical_reduction become one rating and the 60% top goes"). An old piece's straight share is read as the rating
   * that gives the same share alone, so it adds to the rest on the same curve. Negative defense adds to a blow.
   */
  static mitigationOf(equipment: IEquipmentState | undefined): number {
    const worn = StatSystem.worn(equipment);
    const asRating = (share: number) => (share >= 1 ? Number.MAX_SAFE_INTEGER : RATING_KNEE * share / (1 - share));
    const shares = worn.reduce((sum, i) => sum + asRating(i.stats?.physical_reduction ?? 0), 0);
    const chestId = equipment?.slots.CHEST;
    const chest = worn.find(i => i.id === chestId);
    const fallback = chest && chest.pieceLaw === undefined && !chest.stats?.physical_reduction && !chest.stats?.defense ? asRating((chest.itemPower || 0) * 0.0004) : 0;
    return curve(StatSystem.total(equipment, 'defense') + shares + fallback);
  }

  /** One blow arriving, keyed: dodged, blocked, or mitigated. Who it lands on counts too. */
  static incoming(raw: number, equipment: IEquipmentState | undefined, key: string, attributes?: IAttributes): IIncomingHit {
    if (raw <= 0) return { damage: 0, dodged: false, blocked: false };
    const rng = Rng.fromKey(key);
    if (rng.next() < this.dodgeChance(equipment, attributes)) {
      return { damage: 0, dodged: true, blocked: false };
    }
    const blocked = rng.next() < this.blockChance(equipment);
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

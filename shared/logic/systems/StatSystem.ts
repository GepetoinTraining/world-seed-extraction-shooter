/**
 * THE STATS ACT (Layer 0, line 77)
 *
 * One door for what worn gear adds up to. A stat either has a reader here, named
 * in STAT_READERS, or a bank may not roll it: AffixBank refuses the batch whole.
 * That is what stops a card's numbers from being decoration again.
 *
 * What a piece adds, it adds whether or not anyone has read it (D19). A broken
 * piece adds nothing, and a piece in the pack is not on the body.
 *
 * THE ATTRIBUTES (D52): each of the 15 gets real work here, named in
 * ATTRIBUTE_READERS. An attribute of 1 is the floor: a person at the floor plays as
 * the bare numbers, so what is above it is what makes one character unlike another.
 * Nothing has a cap. What must never pass a limit, a price or a chance, runs on a
 * curve that approaches it. Every rate is a guess until Wave 12.
 */

import { IAttributes, IEquipmentState, IItem, IPlayer, ISkillState, MENTAL_ATTRIBUTES } from '../../types';

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
  /** The rarity rescale: what the body adds to a hand's own rate. A weapon's own rate is `attack_speed`, never an affix. */
  haste: 'CombatMath.fireCooldownMs',
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
  luck_find_rarity: 'PieceLaw.oddsOf',
  field_analysis_speed: 'StudySystem.identifyAsk',
  mining_power: 'InteractionEngine',
  chopping_power: 'InteractionEngine',
  health_restore: 'playerStore.useConsumable',
  energy_restore: 'RestSystem.drinkTonic',
  energy_share: 'RestSystem.drinkTonic',
  durability: 'CombatMath.isUsable',
  maxDurability: 'repairCost',
  upkeep_discount_pct: 'room.roomBonuses',
  craft_speed_pct: 'room.roomBonuses',
  cart_lock: 'CartSystem',
  cart_alarm: 'CartSystem'
};

/**
 * Pedro: "ebergy should be 0.2 of endurance + inital value + items. levels shouldn't
 * give you base energy at all." The long day comes from what is worn, and from what
 * refills it: a rest, magic, and very rare potions and plants (RestSystem.refillEnergy).
 */
export const BASE_ENERGY = 50;
export const ENERGY_PER_ENDURANCE = 0.2;

const MELEE_PER_STRENGTH = 0.04;
const PACE_PER_AGILITY = 0.015;
const EVASION_PER_AGILITY = 2;
const RATE_PER_DEXTERITY = 0.02;
const ACCURACY_PER_DEXTERITY = 3;
const LEARNING_PER_INTELLIGENCE = 0.03;
const CAST_POWER_PER_FOCUS = 0.02;
const CRAFT_PER_ENGINEERING = 0.02;
const REPAIR_OFF_AT_MOST = 0.5;
const CHANNEL_OFF_AT_MOST = 0.6;
const EYES_PER_HACKING = 0.05;
const CRIT_PER_PERCEPTION = 0.005;
const SIGHT_TILES_PER_PERCEPTION = 0.5;
const TALK_BASE = 0.5;
const TALK_BASE_RESPECT = 0.35;
const TALK_PER_CHARISMA = 0.05;
const TALK_RESPECT_PER_INTIMIDATION = 0.02;
const BLOW_OFF_AT_MOST = 0.5;
const NOISE_PER_SUBTERFUGE = 2;
const LEVY_DODGE_BASE = 0.05, LEVY_DODGE_AT_MOST = 0.75;
/** The counter's own rates. A sale never reaches what the shelf asks, whatever the bartering. */
const OFFER_BASE = 0.6;
const OFFER_RISE_AT_MOST = 0.4;
const SHELF_OFF_AT_MOST = 0.3;
const RECRUIT_DISPOSITION = 70;
const RECRUIT_PER_LEADERSHIP = 2;
const UPKEEP_OFF_PCT_AT_MOST = 50;
/** How long the beacon takes to open, bare of any attribute. */
export const BASE_CHANNEL_MS = 5000;
/** How fast a point climbs a curve that has a limit. */
const CURVE_PER_POINT = 2;
/**
 * Pedro, 2026-11-11: "energy tonics that are limited usage per rest, and give debuffs as side effects
 * for using." A body takes one tonic a rest, and one more for each this many points of endurance over
 * the floor. The limit is his rule; how it grows with endurance is a call he may strike.
 */
export const ENDURANCE_PER_TONIC = 5;
/** How hard each tonic drunk since the last rest leans on the walk, in points on the house curve. */
export const TONIC_SLOW_POINTS = 5;

/** What each attribute reaches, by the reader that does it. A bar holds that each has a caller. */
export const ATTRIBUTE_READERS: Record<keyof IAttributes, string[]> = {
  strength: ['LoadoutSystem.carryLimit', 'StatSystem.meleeScale'],
  constitution: ['StatSystem.maxHealth'],
  agility: ['StatSystem.paceBonus', 'StatSystem.evasionRating'],
  dexterity: ['StatSystem.fireRateScale', 'StatSystem.accuracyRating'],
  endurance: ['StatSystem.maxEnergyOf', 'StatSystem.tonicsPerRest'],
  intelligence: ['LoadoutSystem.reconEfficiency', 'StatSystem.learnRate'],
  focus: ['LoadoutSystem.reconEfficiency', 'WeaveSystem.capacity', 'StatSystem.castPower'],
  engineering: ['StatSystem.repairFactor', 'StatSystem.craftClockFactor'],
  hacking: ['StatSystem.channelMs', 'StatSystem.signalEyes'],
  perception: ['LoadoutSystem.reconEfficiency', 'StatSystem.sightPx', 'StatSystem.critChance'],
  charisma: ['StatSystem.talkOdds'],
  intimidation: ['StatSystem.blowFactor', 'StatSystem.talkOdds'],
  subterfuge: ['StatSystem.noiseReduction', 'StatSystem.levyDodgeOdds'],
  bartering: ['StatSystem.vendorOffer', 'StatSystem.shopPrice'],
  leadership: ['StatSystem.recruitDisposition', 'StatSystem.upkeepDiscountPct']
};

const MENTAL = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);

/** Points above the floor of 1. Someone who reads no attributes stands at the floor. */
const over = (attributes: IAttributes | undefined, attr: keyof IAttributes): number =>
  Math.max(0, (attributes?.[attr] ?? 1) - 1);

/** A share from 0 toward 1, climbing with points and never arriving. The web's study discount reads it too. */
export const climb = (points: number): number => {
  const rating = points * CURVE_PER_POINT;
  return rating / (rating + 100);
};

const signedPct = (share: number): string => `${share >= 0 ? '+' : ''}${Math.round(share * 100)}%`;

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

  /** What everything worn adds up to for one stat, and what a skill's circles made always true. */
  static total(equipment: IEquipmentState | undefined, stat: string): number {
    return this.worn(equipment).reduce((sum, i) => sum + ((i.stats as Record<string, number> | undefined)?.[stat] ?? 0), equipment?.passives?.[stat] ?? 0);
  }

  static maxHealth(attributes: IAttributes, equipment?: IEquipmentState): number {
    return Math.max(1, 100 + attributes.constitution * 10 + this.total(equipment, 'max_health'));
  }

  /** One day's supply (D51): an initial value, a fifth of endurance, and what is worn. Levels give none. */
  static maxEnergy(attributes: IAttributes, equipment?: IEquipmentState): number {
    return Math.max(0, BASE_ENERGY + attributes.endurance * ENERGY_PER_ENDURANCE + this.total(equipment, 'max_energy'));
  }

  /** A character's own day. */
  static maxEnergyOf(player: IPlayer): number {
    return this.maxEnergy(player.attributes, player.equipment);
  }

  /** Endurance: how many tonics a body takes between two rests. One at the floor, one more each five points over it. */
  static tonicsPerRest(attributes?: IAttributes): number {
    return 1 + Math.floor(over(attributes, 'endurance') / ENDURANCE_PER_TONIC);
  }

  /** What the tonics drunk since the last rest take from the walk, as a share: a little more with each, never all of it. */
  static tonicSlow(tonics = 0): number {
    return climb(Math.max(0, tonics) * TONIC_SLOW_POINTS);
  }

  static pickupRadiusPx(equipment?: IEquipmentState): number {
    return Math.max(PX / 2, BASE_PICKUP_PX + this.total(equipment, 'pickup_radius') * PX);
  }

  /** How much further than the window the field is seen, and kept on the minimap. */
  static sightPx(equipment?: IEquipmentState, attributes?: IAttributes): number {
    return (this.total(equipment, 'light_radius') + over(attributes, 'perception') * SIGHT_TILES_PER_PERCEPTION) * PX;
  }

  // -------------------------------------------------------------------------
  // THE ATTRIBUTES (D52)
  // -------------------------------------------------------------------------

  /** Strength: what a melee swing lands, times. */
  static meleeScale(attributes?: IAttributes): number {
    return 1 + over(attributes, 'strength') * MELEE_PER_STRENGTH;
  }

  /** Agility: what the walk gains, as a share. */
  static paceBonus(attributes?: IAttributes): number {
    return over(attributes, 'agility') * PACE_PER_AGILITY;
  }

  /** Agility and what is worn: the rating a blow has to beat. */
  static evasionRating(equipment?: IEquipmentState, attributes?: IAttributes): number {
    return this.total(equipment, 'evasion_rating') + over(attributes, 'agility') * EVASION_PER_AGILITY;
  }

  /** Dexterity: how fast the hand goes, times. */
  static fireRateScale(attributes?: IAttributes): number {
    return 1 + over(attributes, 'dexterity') * RATE_PER_DEXTERITY;
  }

  /** Dexterity and what is worn: fewer glancing hits. */
  static accuracyRating(equipment?: IEquipmentState, attributes?: IAttributes): number {
    return this.total(equipment, 'accuracy_rating') + over(attributes, 'dexterity') * ACCURACY_PER_DEXTERITY;
  }

  /** Intelligence: how much of the work a skill keeps, times. D84: knowledge is what makes it faster. */
  static learnRate(attributes?: IAttributes): number {
    return 1 + over(attributes, 'intelligence') * LEARNING_PER_INTELLIGENCE;
  }

  /** Focus: what a working gains. */
  static castPower(attributes?: IAttributes): number {
    return (attributes?.focus ?? 0) * CAST_POWER_PER_FOCUS;
  }

  /** Engineering: what a repair still costs, as a share. */
  static repairFactor(attributes?: IAttributes): number {
    return 1 - REPAIR_OFF_AT_MOST * climb(over(attributes, 'engineering'));
  }

  /** Engineering: how long a bench's work takes, as a share. */
  static craftClockFactor(attributes?: IAttributes): number {
    return 1 / (1 + over(attributes, 'engineering') * CRAFT_PER_ENGINEERING);
  }

  /** Hacking: how long the beacon takes to open. It always takes time. */
  static channelMs(baseMs: number, attributes?: IAttributes): number {
    return Math.round(baseMs * (1 - CHANNEL_OFF_AT_MOST * climb(over(attributes, 'hacking'))));
  }

  /** Hacking: what it adds to the eyes that read a signal. */
  static signalEyes(attributes?: IAttributes): number {
    return over(attributes, 'hacking') * EYES_PER_HACKING;
  }

  /** Perception and what is worn: the chance a hit tells. */
  static critChance(equipment?: IEquipmentState, attributes?: IAttributes): number {
    return this.total(equipment, 'crit_chance') + over(attributes, 'perception') * CRIT_PER_PERCEPTION;
  }

  /** Charisma, and with those who want respect, intimidation: the odds a talk lands. */
  static talkOdds(want: string | undefined, attributes?: IAttributes): number {
    const charisma = (attributes?.charisma ?? 1) * TALK_PER_CHARISMA;
    return want === 'RESPECT'
      ? TALK_BASE_RESPECT + charisma + over(attributes, 'intimidation') * TALK_RESPECT_PER_INTIMIDATION
      : TALK_BASE + charisma;
  }

  /** Intimidation: what a blow keeps of its force. What fears you hits softer. */
  static blowFactor(attributes?: IAttributes): number {
    return 1 - BLOW_OFF_AT_MOST * climb(over(attributes, 'intimidation'));
  }

  /** Subterfuge and what is worn: how quiet a person is in the field. */
  static noiseReduction(equipment?: IEquipmentState, attributes?: IAttributes): number {
    return this.total(equipment, 'noise_reduction') + over(attributes, 'subterfuge') * NOISE_PER_SUBTERFUGE;
  }

  /**
   * D100: the odds a dodge of the levy lands. Subterfuge and the skill both raise them, on a
   * curve that never arrives: "it doesn't work 100% of the time".
   */
  static levyDodgeOdds(attributes?: IAttributes, skill?: Pick<ISkillState, 'level'>): number {
    const points = over(attributes, 'subterfuge') + Math.max(0, (skill?.level ?? 1) - 1);
    return LEVY_DODGE_BASE + (LEVY_DODGE_AT_MOST - LEVY_DODGE_BASE) * climb(points);
  }

  /** Bartering: what the counter pays for a thing of this value. */
  static vendorOffer(value: number, attributes?: IAttributes): number {
    return Math.max(1, Math.floor((value || 1) * (OFFER_BASE + OFFER_RISE_AT_MOST * climb(over(attributes, 'bartering')))));
  }

  /** Bartering: what the shelf asks of this person, before it is rounded up. */
  static shopPrice(price: number, attributes?: IAttributes): number {
    return price * (1 - SHELF_OFF_AT_MOST * climb(over(attributes, 'bartering')));
  }

  /** Leadership: the disposition at which a person will follow. */
  static recruitDisposition(attributes?: IAttributes): number {
    return Math.max(0, RECRUIT_DISPOSITION - over(attributes, 'leadership') * RECRUIT_PER_LEADERSHIP);
  }

  /** Leadership: what comes off the upkeep of what a person owns, in percent. */
  static upkeepDiscountPct(attributes?: IAttributes): number {
    return UPKEEP_OFF_PCT_AT_MOST * climb(over(attributes, 'leadership'));
  }

  /** What an attribute does at this value, in plain words: the sheet's reading of it. */
  static attributeWork(attr: keyof IAttributes, attributes: IAttributes): string {
    const points = over(attributes, attr);
    switch (attr) {
      case 'strength': return `Carry +${points * 10} kg. Melee ${signedPct(this.meleeScale(attributes) - 1)}.`;
      case 'constitution': return `Health ${this.maxHealth(attributes)}.`;
      case 'agility': return `Walk ${signedPct(this.paceBonus(attributes))}. Blows missed ${Math.round(100 * this.evasionRating(undefined, attributes) / (this.evasionRating(undefined, attributes) + 100))}%.`;
      case 'dexterity': return `Rate ${signedPct(this.fireRateScale(attributes) - 1)}. Accuracy +${this.accuracyRating(undefined, attributes)}.`;
      case 'endurance': return `Energy +${(attributes.endurance * ENERGY_PER_ENDURANCE).toFixed(1)}.`;
      case 'intelligence': return `Skills learned ${signedPct(this.learnRate(attributes) - 1)}. Deepens recon.`;
      case 'focus': return `Workings ${signedPct(this.castPower(attributes))}. Reserves and recon grow, ${attributes.focus} held.`;
      case 'engineering': return `Repairs ${signedPct(this.repairFactor(attributes) - 1)}. Bench time ${signedPct(this.craftClockFactor(attributes) - 1)}.`;
      case 'hacking': return `Beacon opens in ${(this.channelMs(BASE_CHANNEL_MS, attributes) / 1000).toFixed(1)}s. Signals read ${signedPct(this.signalEyes(attributes))}.`;
      case 'perception': return `Telling hits ${Math.round(this.critChance(undefined, attributes) * 1000) / 10}%. Sight +${this.sightPx(undefined, attributes) / PX} tiles. Deepens recon.`;
      case 'charisma': return `A talk lands ${Math.round(this.talkOdds(undefined, attributes) * 100)}%.`;
      case 'intimidation': return `Blows land ${signedPct(this.blowFactor(attributes) - 1)}. Respect ${Math.round(this.talkOdds('RESPECT', attributes) * 100)}%.`;
      case 'subterfuge': return `Quieter by ${this.noiseReduction(undefined, attributes)}. Dodges the levy ${Math.round(this.levyDodgeOdds(attributes) * 100)}%.`;
      case 'bartering': return `The counter pays ${this.vendorOffer(100, attributes)}%. The shelf ${signedPct(this.shopPrice(1, attributes) - 1)}.`;
      case 'leadership': return `Follows at ${this.recruitDisposition(attributes)}/100. Upkeep -${Math.round(this.upkeepDiscountPct(attributes))}%.`;
    }
  }
}

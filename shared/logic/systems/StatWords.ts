/**
 * A STAT AS A PLAYER READS IT (GV, part 2, 2026-11-12). The code's keys reached the cards as they are, "evasion rating",
 * "luck find rarity". Every stat a card, a gift or a sheet names is said here. GV42: every stat the pack, the gear law
 * and the affixes can put on a card has a word of its own, and one counted in hundredths says its percent sign; any
 * other key still reads as plain words with the code's "rating" left off. Words only.
 */

const STAT_WORDS: Record<string, string> = {
  damage: 'damage', defense: 'defense', max_health: 'health', max_energy: 'energy', accuracy_rating: 'aim',
  evasion_rating: 'dodging', attack_speed: 'attack speed', crit_chance: 'crit chance', crit_multiplier: 'crit damage',
  block_chance: 'block chance', poison_damage: 'poison', light_radius: 'light', pickup_radius: 'reach for pickups',
  carry_capacity: 'carry', carry_bonus_kg: 'carry', noise_reduction: 'quiet', luck_find_rarity: 'luck',
  field_analysis_speed: 'reading speed', physical_reduction: 'protection', movement_speed: 'pace', haste: 'haste',
  // GV42: what reached a card as its key
  attack_speed_global: 'attack speed', movement_speed_penalty: 'slowness', reload_speed: 'reloading',
  chopping_power: 'chopping', mining_power: 'mining', craft_speed_pct: 'making speed', upkeep_discount_pct: 'less upkeep',
  cart_lock: 'locks', cart_alarm: 'alarm', energy_regen: 'energy regained', energy_shield: 'ward', health_restore: 'healing',
  stun_duration_multiplier: 'longer stuns', stun_recovery: 'shaking off stuns',
  // The mind's and the hand's own names, as the sheet says them
  intelligence: 'intelligence', focus: 'focus', engineering: 'engineering', hacking: 'hacking', perception: 'perception',
  charisma: 'charisma', intimidation: 'intimidation', subterfuge: 'subterfuge', bartering: 'bartering', leadership: 'leadership'
};

/** Counted in hundredths: the card says a percent sign after the number. */
const PERCENT_STATS = new Set(['craft_speed_pct', 'upkeep_discount_pct']);

export const statWord = (key: string): string =>
  STAT_WORDS[key] ?? key.replace(/_rating$/, '').replace(/_/g, ' ');

export const hasStatWord = (key: string): boolean => key in STAT_WORDS;

export const statIsPercent = (key: string): boolean => PERCENT_STATS.has(key);

/** A stat's number as the card says it: its percent sign where it is counted in hundredths. */
export const statAmount = (key: string, shown: string): string => (statIsPercent(key) ? `${shown}%` : shown);

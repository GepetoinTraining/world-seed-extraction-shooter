/**
 * A STAT AS A PLAYER READS IT (GV, part 2, 2026-11-12). The code's keys reached the cards as they are, "evasion rating",
 * "luck find rarity". Every stat a card, a gift or a sheet names is said here: a word for each the code keeps, and for
 * any other its key as plain words with the code's "rating" left off. Words only.
 */

const STAT_WORDS: Record<string, string> = {
  damage: 'damage', defense: 'defense', max_health: 'health', max_energy: 'energy', accuracy_rating: 'aim',
  evasion_rating: 'dodging', attack_speed: 'attack speed', crit_chance: 'crit chance', crit_multiplier: 'crit damage',
  block_chance: 'block chance', poison_damage: 'poison', light_radius: 'light', pickup_radius: 'reach for pickups',
  carry_capacity: 'carry', carry_bonus_kg: 'carry', noise_reduction: 'quiet', luck_find_rarity: 'luck',
  field_analysis_speed: 'reading speed', physical_reduction: 'protection', movement_speed: 'pace', haste: 'haste'
};

export const statWord = (key: string): string =>
  STAT_WORDS[key] ?? key.replace(/_rating$/, '').replace(/_/g, ' ');

/**
 * THE FORMULA (D57): every number a theme's bands turn into, in one versioned file.
 *
 * Version 2. All of it is a guess until Wave 12, which tunes this file and nothing
 * else. A pinned world reads the version it was minted under, so a later version
 * never moves a standing world. Nothing here is a ceiling on content.
 */

import { SlotType, UniversalRank } from '../../../types';
import { GearKind, ThemeRank, RANKS } from './ThemeTypes';

/** A rank's place on the ladder, F = 0. Everything scales from this. */
export const rankStep = (rank: ThemeRank | UniversalRank): number => RANKS.indexOf(rank as ThemeRank);

const geometric = (base: number, ratio: number, step: number) => base * Math.pow(ratio, step);

const BUILD = { frail: 0.6, sturdy: 1, massive: 1.8 };
const THREAT = { meek: 0.6, sharp: 1, deadly: 1.5 };
/**
 * Tiles per second. R4's fourth fault: the fastest thing stays under a bare walk's
 * 4 tiles a second, so a person can always leave. Boots make that margin larger.
 */
const PACE = { slow: 2, steady: 3, swift: 3.7 };
const VIEW_TILES = { TINY: 8, MEDIUM: 10, LARGE: 12, GIGANTIC: 16, COLOSSAL: 20 };

export const creatureNumbers = (c: {
  rank: ThemeRank; build: keyof typeof BUILD; threat: keyof typeof THREAT; pace: keyof typeof PACE; size: keyof typeof VIEW_TILES;
}) => ({
  baseHealth: Math.round(geometric(20, 2.5, rankStep(c.rank)) * BUILD[c.build]),
  baseDamage: Math.max(1, Math.round(geometric(5, 1.7, rankStep(c.rank)) * THREAT[c.threat])),
  speed: PACE[c.pace],
  viewRange: VIEW_TILES[c.size]
});

/** How much more a body holds and hits for each step down its line. */
const PER_LINE_STEP = 0.25;

/**
 * A kind that has changed (D61): its bands, plus how deep in its line it stands. The
 * first generation reads exactly `creatureNumbers`. Speed stays with the pace band,
 * so however deep a line goes, a person can still leave.
 */
export const descendantNumbers = (c: Parameters<typeof creatureNumbers>[0], generation: number) => {
  const n = creatureNumbers(c);
  const grown = 1 + PER_LINE_STEP * (generation - 1);
  return { ...n, baseHealth: Math.round(n.baseHealth * grown), baseDamage: Math.max(1, Math.round(n.baseDamage * grown)) };
};

const WEIGHT_KG = { light: 0.5, medium: 2, heavy: 5 };
const FOOTPRINT = { light: { width: 1, height: 1 }, medium: { width: 1, height: 2 }, heavy: { width: 1, height: 3 } };
/** Density is what the weight law reads; hardness grows with rank and form. */
const FORM_HARDNESS: Record<string, number> = { grain: 2, shrub: 2, fruit: 1, tree: 15, vein: 40, sand: 5, rock: 25, pebble: 12 };
const FORM_USES: Record<string, number> = { grain: 3, shrub: 2, fruit: 2, tree: 3, vein: 4, sand: 2, rock: 2, pebble: 1 };
const FORM_REGROW_MS: Record<string, number | undefined> = { grain: 90_000, shrub: 120_000, fruit: 180_000, tree: 600_000 };
const WORTH = { common: 1, fine: 3, rare: 9 };

export const materialNumbers = (m: { rank: ThemeRank; form: string; weight: keyof typeof WEIGHT_KG; worth: keyof typeof WORTH }) => ({
  weight: WEIGHT_KG[m.weight],
  dimensions: FOOTPRINT[m.weight],
  density: WEIGHT_KG[m.weight] * 2,
  hardness: Math.round((FORM_HARDNESS[m.form] ?? 5) * (1 + rankStep(m.rank) * 0.5)),
  uses: FORM_USES[m.form] ?? 1,
  regrowMs: FORM_REGROW_MS[m.form],
  yieldPerUse: [1, m.form === 'pebble' ? 1 : 2] as [number, number],
  value: Math.max(1, Math.round(geometric(2, 2.2, rankStep(m.rank)) * WORTH[m.worth]))
});

/** What the ground asks of the hands: energy and seconds for one taking, and the tool's power. */
export const harvestNumbers = (verb: string, rank: ThemeRank) => ({
  energyCost: verb === 'hands' ? 2 : 6 + rankStep(rank) * 2,
  baseTimeSeconds: verb === 'hands' ? 1 : 2.5 + rankStep(rank) * 0.5,
  minToolPower: verb === 'hands' ? 0 : 5 + rankStep(rank) * 8
});

export const goodNumbers = (g: { rank: ThemeRank; weight: keyof typeof WEIGHT_KG }) => ({
  weight: WEIGHT_KG[g.weight],
  dimensions: FOOTPRINT[g.weight],
  laborTimeSeconds: 10 + rankStep(g.rank) * 15
});

const STATION_AREA = (billCount: number) => 6 + billCount * 2;
export const stationNumbers = (billCount: number) => ({ minArea: STATION_AREA(billCount), weight: 40, width: 2, height: 2 });

export const consumableNumbers = (kind: string, rank: ThemeRank) => {
  const power = geometric(10, 1.8, rankStep(rank));
  if (kind === 'heal') return { health_restore: Math.round(power * 3) };
  if (kind === 'energy') return { energy_restore: Math.round(power) };
  return {};
};

export const shelfPrice = (rank: ThemeRank, worth = 1) => Math.max(5, Math.round(geometric(6, 2.2, rankStep(rank)) * worth));

interface IGearShape {
  bucket: 'weapon_bases' | 'armor_bases' | 'tool_bases';
  slot: SlotType;
  tags: string[];
  /** Rolled ranges at rank F, scaled by rank. A single number is fixed. */
  implicits: (step: number) => { stat: string; min?: number; max?: number; value?: number }[];
  pouch?: { accepts: string[]; capacity: number };
  belt?: { pouchSlots: number };
  cart?: { gridW: number; gridH: number };
}

const range = (stat: string, low: number, high: number, step: number, ratio = 1.6) => ({
  stat, min: Math.round(low * Math.pow(ratio, step) * 100) / 100, max: Math.round(high * Math.pow(ratio, step) * 100) / 100
});

/** The grammar of gear: what a kind IS, so a body slot always takes it (R5's rule, as law). */
export const GEAR_SHAPES: Record<GearKind, IGearShape> = {
  blade: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['melee', 'one_hand', 'physical', 'blade'],
    implicits: s => [range('accuracy_rating', 10, 20, s), { stat: 'attack_speed', value: 1.2 }] },
  bludgeon: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['melee', 'two_hand', 'physical', 'blunt', 'heavy'],
    implicits: s => [range('crit_multiplier', 0.1, 0.2, s, 1.2), { stat: 'attack_speed', value: 0.85 }] },
  bow: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['ranged', 'two_hand', 'physical', 'projectile'],
    implicits: s => [range('accuracy_rating', 15, 30, s), { stat: 'attack_speed', value: 1.0 }] },
  focus: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['magic', 'one_hand', 'caster'],
    implicits: s => [range('max_energy', 5, 10, s), { stat: 'attack_speed', value: 0.9 }] },
  head: { bucket: 'armor_bases', slot: SlotType.HEAD, tags: ['armor', 'head', 'light'], implicits: s => [range('physical_reduction', 0.01, 0.02, s, 1.3)] },
  chest: { bucket: 'armor_bases', slot: SlotType.CHEST, tags: ['armor', 'chest', 'heavy'], implicits: s => [range('physical_reduction', 0.04, 0.07, s, 1.25)] },
  legs: { bucket: 'armor_bases', slot: SlotType.LEGS, tags: ['armor', 'light'], implicits: s => [range('physical_reduction', 0.02, 0.03, s, 1.25)] },
  feet: { bucket: 'armor_bases', slot: SlotType.FEET, tags: ['armor', 'boots', 'light'], implicits: s => [range('movement_speed', 0.03, 0.06, s, 1.2)] },
  shoulder: { bucket: 'armor_bases', slot: SlotType.SHOULDER, tags: ['armor', 'shoulder', 'light'], implicits: s => [range('defense', 2, 4, s)] },
  eyes: { bucket: 'armor_bases', slot: SlotType.EYES, tags: ['jewelry', 'accessory'], implicits: s => [range('field_analysis_speed', 0.1, 0.2, s, 1.2)] },
  necklace: { bucket: 'armor_bases', slot: SlotType.NECKLACE, tags: ['amulet', 'jewelry'], implicits: s => [range('max_health', 5, 10, s)] },
  earring: { bucket: 'armor_bases', slot: SlotType.EARRING, tags: ['jewelry', 'accessory'], implicits: s => [range('noise_reduction', 1, 2, s, 1.3)] },
  ring: { bucket: 'armor_bases', slot: SlotType.RING, tags: ['ring', 'jewelry'], implicits: s => [range('luck_find_rarity', 0.02, 0.05, s, 1.3)] },
  quiver: { bucket: 'armor_bases', slot: SlotType.QUIVER, tags: ['quiver'], implicits: s => [range('attack_speed', 0.02, 0.05, s, 1.2)] },
  bag: { bucket: 'armor_bases', slot: SlotType.BAG, tags: ['bag'], implicits: s => [{ stat: 'carry_bonus_kg', value: 10 + s * 5 }] },
  belt: { bucket: 'armor_bases', slot: SlotType.BELT, tags: ['belt'], implicits: () => [], belt: { pouchSlots: 2 } },
  pouch: { bucket: 'armor_bases', slot: SlotType.POUCH, tags: ['pouch'], implicits: () => [], pouch: { accepts: ['consumable'], capacity: 3 } },
  cart: { bucket: 'armor_bases', slot: SlotType.NONE, tags: ['cart', 'heavy'], implicits: () => [], cart: { gridW: 10, gridH: 8 } },
  chop_tool: { bucket: 'tool_bases', slot: SlotType.TOOL, tags: ['tool', 'axe', 'chopping'], implicits: s => [range('chopping_power', 12, 18, s)] },
  mine_tool: { bucket: 'tool_bases', slot: SlotType.TOOL, tags: ['tool', 'pickaxe', 'mining'], implicits: s => [range('mining_power', 12, 18, s)] },
  work_tool: { bucket: 'tool_bases', slot: SlotType.TOOL, tags: ['tool'], implicits: () => [] }
};

export const gearBaseIp = (rank: ThemeRank, kind: GearKind) => {
  const base = geometric(50, 2.1, rankStep(rank));
  return Math.round(GEAR_SHAPES[kind].bucket === 'tool_bases' ? base / 3 : base);
};

/** A stat's typical size at tier one: what a band means for this stat. Only stats with a reader. */
export const STAT_SCALE: Record<string, number> = {
  damage: 6, defense: 8, max_health: 15, max_energy: 8,
  accuracy_rating: 15, evasion_rating: 12, attack_speed: 0.08,
  crit_chance: 0.03, crit_multiplier: 0.15, block_chance: 0.04, poison_damage: 3,
  light_radius: 2, pickup_radius: 3, carry_capacity: 3, noise_reduction: 3,
  movement_speed: 0.05, luck_find_rarity: 0.1, field_analysis_speed: 0.1,
  craft_speed_pct: 5, upkeep_discount_pct: 5, cart_lock: 1, cart_alarm: 1,
  // D22: the mind's stats, on frames only
  intelligence: 2, focus: 2, engineering: 2, hacking: 2, perception: 2,
  charisma: 2, intimidation: 2, subterfuge: 2, bartering: 2, leadership: 2
};

const BAND = { minor: [0.5, 1], moderate: [1, 2], major: [2, 3.5] } as const;

export const affixRange = (stat: string, band: keyof typeof BAND, tier: number, downside: boolean): [number, number] => {
  const scale = STAT_SCALE[stat] ?? 1;
  const grow = Math.pow(1.5, Math.max(0, tier - 1));
  const round = (n: number) => (Math.abs(scale) < 1 ? Math.round(n * 100) / 100 : Math.round(n));
  const low = round(BAND[band][0] * scale * grow);
  const high = Math.max(low, round(BAND[band][1] * scale * grow));
  return downside ? [-high, -low] : [low, high];
};

/** The effect door's numbers (Layer 1): rank, cost and the caster's power. */
const COST_POWER = { trivial: 0.5, low: 1, medium: 1.6, high: 2.5, extreme: 4 };
const COST_ENERGY = { trivial: 2, low: 5, medium: 10, high: 18, extreme: 30 };
const COST_COOLDOWN_MS = { trivial: 1500, low: 3000, medium: 6000, high: 10000, extreme: 18000 };

export const abilityNumbers = (cost: keyof typeof COST_POWER, rank: ThemeRank) => ({
  magnitude: Math.round(geometric(6, 1.7, rankStep(rank)) * COST_POWER[cost]),
  energy: COST_ENERGY[cost],
  aether: COST_ENERGY[cost],
  cooldownMs: COST_COOLDOWN_MS[cost],
  durationMs: 1500 + COST_POWER[cost] * 1000,
  telegraphMs: 400 + COST_POWER[cost] * 300
});

/** D77: a forced way out always takes the top band, and a scroll of it is written no lower than this rank. */
export const FORCED_EXIT_COST = 'extreme' as const;
export const FORCED_EXIT_FLOOR_RANK: ThemeRank = 'C';
/** What such a scroll is worth: its rank's shelf price, times what the band is worth. The shelf asks three times this. */
export const forcedExitWorth = (rank: ThemeRank) => shelfPrice(rank, COST_POWER[FORCED_EXIT_COST]);

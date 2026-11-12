/**
 * THE FORMULA (D57): every number a theme's bands turn into, in one versioned file.
 *
 * Version 3. All of it is a guess until Wave 12, which tunes this file and nothing
 * else. A pinned world reads the version it was minted under, so a later version
 * never moves a standing world. Nothing here is a ceiling on content.
 *
 * 2026-11-11, energy (Pedro: "gear needs to give energy stat (you get very little energy simply by
 * levelling), and, we need energy tonics that are limited usage per rest"): energy on gear reads no
 * rank, comes mainly as a property, and two kinds carry a little natively ("they shouldn't be hard
 * coded, this should be a possible stat right? as hardcoded, or implicit, I'd leave it to 1-2 at
 * most"), and an energy tonic is a share of the drinker's day. No pack's words
 * change, so the pack law (THEME_FORMULA_VERSION) does not move: a sealed world keeps its words and
 * its law, and its kinds compile to these numbers when it is read.
 */

import { SlotType, UniversalRank } from '../../types';
import { readsRank } from '../../constants';
import { GearKind, IStrikeWords, ThemeRank, RANKS, SIZES, Volley } from './ThemeTypes';
import { TILE_PX } from '../../entities/world/grid';

/**
 * How fast a shot flies and for how long, in pixels and seconds: ten tiles a second, two seconds. The
 * projectile system reads them from here, so the formula owns every number a fight is drawn with.
 */
export const SHOT_SPEED_PX = 200;
export const SHOT_FLIGHT_S = 2.0;
const PROJECTILE_RANGE_PX = SHOT_SPEED_PX * SHOT_FLIGHT_S;

/** The least pace a relight window is worked from, so a person who has not yet walked still has an answer. */
const BASE_PACE = 1;

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

// -------------------------------------------------------------------------
// BODIES (the fight's rebalance, part 3; BALANCE_RUN 1.2, calls 1 to 3). A rank doubles what a body holds and
// what it deals, once, for a person and a creature alike. A plain person holds 100 at F; a plain weapon deals
// 10 a second; two equals fall in ten seconds at every rank. A plain creature alone, middling, sturdy and sharp,
// is a quarter of a person in both, and any body is its mass over four.
// -------------------------------------------------------------------------

/** What one rank is worth to a body: it doubles (call 1). */
const BODY_RATIO = 2;
export const bodyScale = (rank: ThemeRank | UniversalRank | string): number => Math.pow(BODY_RATIO, Math.max(0, rankStep(rank as ThemeRank)));
/** A plain person's health at F, and what a point of constitution over its rank's floor adds of it. */
export const BODY_HEALTH = 100;
const HEALTH_PER_POINT = 0.1;
/** What a plain weapon of rank F deals a second (a fifth of a common piece's power, at rate 1), and a bare hand's blow: half it. */
export const PLAIN_BLOW_PER_S = 10;
export const HAND_BLOW = 5;
/** A creature strikes once in this long at the plain distance: the pause after a blow, and the plain wind-up. */
export const CREATURE_COOLDOWN_MS = 2000;
export const CREATURE_WINDUP_MS = 450;
/** From this ground (`GROUND_VERSION`) a world lays its bodies by this law; a world that stands before it keeps them as written. */
export const BODIES_FROM_GROUND = 5;
/**
 * From this ground (GS, the coordinator's calls after Pedro's "the scaling seems off"): ground above a world's own rank
 * runs on, each further rank as likely as a find going one step deeper (call 15); a body takes the rank of the ground it
 * stands on, as a piece takes the rank of where it came from; and a chest holds one piece of gear, and goods (2.5).
 */
export const RANKED_FROM_GROUND = 6;

/** A person's health: 100 at F, doubled a rank, a tenth more for each point of constitution over its rank's floor, divided under it. */
export const personHealth = (rank: ThemeRank | UniversalRank | string, constitution: number): number => {
  const floorPoints = 1 + Math.max(0, rankStep(rank as ThemeRank));
  const over = constitution - floorPoints;
  const share = over >= 0 ? 1 + HEALTH_PER_POINT * over : 1 / (1 + HEALTH_PER_POINT * -over);
  return Math.round(BODY_HEALTH * bodyScale(rank) * share);
};

/** A body's share of a person by its size: its mass, the same measure as what it eats, over four (call 2). */
export const creatureShare = (size?: string): number => (APPETITE[size as keyof typeof APPETITE] ?? APPETITE.MEDIUM) / 4;

export const creatureNumbers = (c: {
  rank: ThemeRank; build: keyof typeof BUILD; threat: keyof typeof THREAT; pace: keyof typeof PACE; size: keyof typeof VIEW_TILES;
}) => {
  const body = BODY_HEALTH * bodyScale(c.rank) * creatureShare(c.size);
  const perSecond = PLAIN_BLOW_PER_S * bodyScale(c.rank) * creatureShare(c.size);
  return {
    baseHealth: Math.max(1, Math.round(body * BUILD[c.build])),
    baseDamage: Math.max(1, Math.round(perSecond * ((CREATURE_COOLDOWN_MS + CREATURE_WINDUP_MS) / 1000) * THREAT[c.threat])),
    speed: PACE[c.pace],
    viewRange: VIEW_TILES[c.size]
  };
};

/** A creature's numbers as a world standing before the fight's law laid them (formula version 3): kept for those worlds. */
export const standingCreatureNumbers = (c: { rank: ThemeRank; build: keyof typeof BUILD; threat: keyof typeof THREAT }) => ({
  baseHealth: Math.round(geometric(20, 2.5, rankStep(c.rank)) * BUILD[c.build]),
  baseDamage: Math.max(1, Math.round(geometric(5, 1.7, rankStep(c.rank)) * THREAT[c.threat]))
});

/**
 * Call 14: a swift body is faster than a walk only in a burst, twice its own pace for a second, and then it stands
 * for as long as keeps its pace over the whole cycle at its own, under a walk: a person can still leave from outside it.
 */
const BURST_SCALE = 2;
const BURST_MS = 1000;
export const bursts = (speed?: number): boolean => (speed ?? 0) >= PACE.swift;
export const burstNumbers = (pace: number) => ({
  pace: pace * BURST_SCALE, ms: BURST_MS, restMs: BURST_MS * (BURST_SCALE - 1), reachTiles: pace * BURST_SCALE * (BURST_MS / 1000)
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

/** The largest sight a size gives: how far the field must look for something that could notice a person. */
export const WIDEST_VIEW_TILES = Math.max(...Object.values(VIEW_TILES));

// -------------------------------------------------------------------------
// BODIES ON THE LAND (D64). What keeps a count down is the land's food, never a ceiling.
// -------------------------------------------------------------------------

/** What one body eats in a cycle, by how much of it there is. */
const APPETITE = { TINY: 0.5, MEDIUM: 1, LARGE: 2, GIGANTIC: 8, COLOSSAL: 20 };
/** The chance a pair brings a birth in a cycle, fed. Smaller things breed faster. */
const BIRTH_RATE = { TINY: 0.3, MEDIUM: 0.16, LARGE: 0.07, GIGANTIC: 0.03, COLOSSAL: 0.01 };
/** The chance a fed group walks on in a cycle. */
const ROAM = { slow: 0.1, steady: 0.25, swift: 0.4 };

export const bodyNumbers = (c: { size?: string; speed?: number }) => ({
  appetite: APPETITE[c.size as keyof typeof APPETITE] ?? APPETITE.MEDIUM,
  birthRate: BIRTH_RATE[c.size as keyof typeof BIRTH_RATE] ?? BIRTH_RATE.MEDIUM,
  // A definition keeps its speed, not its band: the band is read back from the speed
  roam: (c.speed ?? PACE.steady) <= PACE.slow ? ROAM.slow : (c.speed ?? PACE.steady) >= PACE.swift ? ROAM.swift : ROAM.steady
});

/** Scattered things a chunk holds, on average: `fillQuadrant` draws one to four in each of sixteen quadrants. */
const NODES_PER_CHUNK = 40;
/** What a material feeds, by what it is. Food feeds best, and even bare ground feeds something. */
const NUTRITION = { food: 1, flora: 0.5, other: 0.25 };
const FOOD_SCALE = 0.2;

/** What one kind of material in a biome's table gives a chunk in a cycle, when the table holds this many kinds. */
export const foodFrom = (m: { tags?: string[]; uses?: number; yieldPerUse?: [number, number] }, tableSize: number): number => {
  const tags = m.tags ?? [];
  const nutrition = tags.includes('food') ? NUTRITION.food : tags.includes('flora') ? NUTRITION.flora : NUTRITION.other;
  const yielded = m.yieldPerUse ? (m.yieldPerUse[0] + m.yieldPerUse[1]) / 2 : 1;
  return (NODES_PER_CHUNK / Math.max(1, tableSize)) * (m.uses ?? 1) * yielded * nutrition * FOOD_SCALE;
};

export const LAND_NUMBERS = {
  /** How far a chunk's food strays either way from what its biome gives, by the land's own noise. */
  fertility: 0.3,
  /** What a body of what hunts takes from the prey beside it, as a share of what it eats. */
  huntShare: 0.25,
  /** How many bodies of a kind make it half as easy to find as it can be. Scarce prey is hard to find. */
  preyFound: 8,
  /** What one body of prey feeds what hunts it, as a share of what it would have eaten itself. */
  preyYield: 3,
  /** Of the mouths a ground cannot feed, how many fall in a cycle. The rest of the shortage walks. */
  starve: 0.3,
  /** Of the bodies of a kind that has changed, how many stand as what it became, per cycle. */
  changeShare: 0.15,
  /** The chance a kind the land stood at alpha, gone from that ground, walks back in. A floor under a count, never a ceiling. */
  returns: 0.02,
  /** What gives way to a leader taking its ground, as a share of each rival kind there. */
  takeShare: 0.25
};

// -------------------------------------------------------------------------
// LEADERS (D93). An elite is tougher, and one person can bring it down.
// -------------------------------------------------------------------------

/** What leaders a land holds: the chance per chunk, and how many walk behind one. */
export const ROSTER_NUMBERS = { perChunk: 0.06, packLow: 2, packHigh: 5, solitaryShare: 0.15 };

/**
 * What a sheet makes of a body: what its constitution and strength hold above what its
 * rank starts with (`NpcSheet` deals 0 to 4 above). Half as much again at the least, and
 * never more than two and a half times what it is, so it can always be brought down.
 */
export const leaderNumbers = (c: { baseHealth: number; baseDamage: number; rank: ThemeRank | UniversalRank }, stats: { constitution: number; strength: number }) => {
  const above = (stat: number) => Math.max(0, stat - (1 + rankStep(c.rank)));
  return {
    bonusHealth: Math.max(1, Math.round(c.baseHealth * (0.5 + 0.25 * above(stats.constitution)))),
    bonusDamage: Math.round(c.baseDamage * 0.1 * above(stats.strength))
  };
};

/** What a goal asks on a d20, and which stat on the sheet helps. A goal is a word with a reader. */
export const GOAL_BANDS = {
  grow: { dc: 11, stat: 'leadership' }, hunt: { dc: 10, stat: 'perception' }, take: { dc: 13, stat: 'intimidation' },
  settle: { dc: 14, stat: 'engineering' }, waylay: { dc: 9, stat: 'intimidation' },
  /** A band holds what its boss's orders give it. Nothing rolls for it: its boss's cycle decides. */
  hold: { dc: 0, stat: 'leadership' }
} as const;
/** How far past its band a roll must land to be graded great. */
export const GOAL_GREAT_BY = 6;

// -------------------------------------------------------------------------
// TERRITORY (D62, D93). What ground, posts and a seat cost. All guesses until Wave 12.
// -------------------------------------------------------------------------

export const TERRITORY_NUMBERS = {
  /** How many people falling to one elite make it a boss. */
  bossFalls: 3,
  /** How much ground one body can hold, in chunks. */
  chunksPerBody: 2,
  /** How far apart anchors stand, in chunks. Two is already past what two shots can cover. */
  spreadChunks: 2,
  /** A relight window, as a share of the walk between anchors. Under 1 is the whole of the rule. */
  relightShare: 0.5,
  /** What a body of a base works out of held ground in a cycle, and pays towards a build in a decision. */
  yieldPerBody: 0.25,
  payPerBody: 0.5,
  /** What a verb asks on a d20, and how far under it a decision goes before it opens a challenge. */
  verbDc: 10,
  badBy: 8,
  /** Rolls this close in a challenge split the ground between them. */
  splitBy: 1,
  /** A building's bill before what stands raises it. A seat's comes from the hub's own plans. */
  bills: { anchor: 8, watch: 6, wall: 10, store: 6, works: 12, muster: 12 },
  billRise: 0.25,
  /** How long a person stands in front of a toll before it stops asking. */
  tollGraceMs: 12_000,
  tollReachTiles: 8
};

/** How many anchors a boss's rank asks. Never fewer than two, so every boss asks for more than one person. */
export const anchorsFor = (rank: ThemeRank | UniversalRank): number => 2 + Math.floor(Math.max(0, rankStep(rank)) / 2);

/** What a structure asks, rising with what already stands. The seat's own base is the hub's plan. */
export const structureBill = (fn: keyof typeof TERRITORY_NUMBERS.bills | 'seat', standing: number, seatBase = 0): number =>
  Math.ceil((fn === 'seat' ? seatBase : TERRITORY_NUMBERS.bills[fn]) * (1 + TERRITORY_NUMBERS.billRise * standing));

/** A post's health is ordinary for its rank: reaching it and leaving are the raid. */
export const postHealth = (rank: ThemeRank | UniversalRank): number => Math.round(geometric(60, 1.9, Math.max(0, rankStep(rank))));

/**
 * The relight window (D93), from the real distance and the fastest pace seen. What a person has to
 * cover is the distance less a shot's reach from each end, and the window is a share of that walk.
 * It is below the walk at any pace, so one body cannot be in two places, at any strength.
 */
export const relightWindowMs = (distancePx: number, walkTilesPerSecond: number): number => {
  const covered = Math.max(0, distancePx - PROJECTILE_RANGE_PX * 2);
  return (covered / TILE_PX / Math.max(walkTilesPerSecond, BASE_PACE)) * 1000 * TERRITORY_NUMBERS.relightShare;
};

/** What a toll asks: its rank's rate, and how well its sheet bargains. */
export const tollOwed = (rank: ThemeRank | UniversalRank, bartering: number): number =>
  Math.max(1, Math.round(geometric(8, 2.2, Math.max(0, rankStep(rank))) * (1 + Math.max(0, bartering) * 0.05)));

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

/** D99: what junk is. It sells by the same law as a raw material: what it weighs and how hard it is to replace. */
export const junkNumbers = (j: { rank: ThemeRank; weight: keyof typeof WEIGHT_KG; worth: keyof typeof WORTH }) => {
  const density = WEIGHT_KG[j.weight] * 2;
  const hardness = Math.round(geometric(1, 2.2, rankStep(j.rank)) * WORTH[j.worth]);
  return { weight: WEIGHT_KG[j.weight], dimensions: FOOTPRINT[j.weight], density, hardness, value: Math.max(1, Math.round(WEIGHT_KG[j.weight] * 4 + hardness)) };
};
/** D115: what holds value. A guess until Wave 12, set well above what lies about at its rank. */
const ANCHOR_BASE_VALUE = 25;
export const anchorNumbers = (a: { rank: ThemeRank; weight: keyof typeof WEIGHT_KG; worth: keyof typeof WORTH }) => {
  const density = WEIGHT_KG[a.weight] * 2;
  return {
    weight: WEIGHT_KG[a.weight], dimensions: FOOTPRINT[a.weight], density,
    hardness: Math.round(geometric(1, 2.2, rankStep(a.rank)) * WORTH[a.worth]),
    value: Math.round(geometric(ANCHOR_BASE_VALUE, 2.2, rankStep(a.rank)) * WORTH[a.worth])
  };
};
/** The chance a chest holds one. Its own roll, so no other drop moves. A guess until Wave 12. */
export const ANCHOR_CHANCE = 0.15;

/** The chance a body that falls leaves junk. Its own roll, so no other drop moves. */
export const JUNK_CHANCE = 0.55;

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

/**
 * The share of the drinker's own day an energy tonic gives, at every rank (2026-11-11): three tenths,
 * the share a heal gives of a body. It is read at the drinking against that body's day, so no tonic
 * outgrows the day, and a rank moves nothing in it.
 */
export const TONIC_SHARE = 0.3;

export const consumableNumbers = (kind: string, rank: ThemeRank): Record<string, number> => {
  // A heal follows bodies (part 3): three tenths of a plain body of its rank
  if (kind === 'heal') return { health_restore: Math.round(0.3 * BODY_HEALTH * bodyScale(rank)) };
  if (kind === 'energy') return { energy_share: TONIC_SHARE };
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
  /** A cart: its bed and its stats are what it carries, read from the kind's size word by `cartNumbers`. */
  cart?: true;
}

// -------------------------------------------------------------------------
// CARTS (the interface pass, 2026-11-11). Pedro: "the carts need variable sizes of bed and their stats".
// A cart is a kind like any other: its size word, the creatures' own sizes, becomes a bed the way a
// creature's size becomes its sight, rank grows it as rank grows everything, and quality is what a
// better-made one bears. No list of finished carts, and no top: each size and each rank is one ratio
// more. A theme that names no size reads MEDIUM, which is the first world's 10 by 8.
// -------------------------------------------------------------------------

const CART_SIZES = SIZES;
/** The bed of a MEDIUM cart at rank F, in cells: the first world's 10 by 8. */
const CART_BED_CELLS = 80;
/** How much more each size up holds, and each rank up. */
const CART_SIZE_RATIO = 1.6;
const CART_RANK_RATIO = 1.15;
/** A bed is a little wider than it is long. */
const CART_ASPECT = 5 / 4;
/** What a cart weighs for each cell of bed: the first world's folded cart weighed 15. */
const CART_KG_PER_CELL = 15 / 80;
/** What a cart bears before the tow slows, for each cell of bed, at quality 0. */
const CART_BEARS_PER_CELL = 0.5;

const cartStep = (size?: string): number => {
  const i = CART_SIZES.indexOf((size ?? 'MEDIUM').toUpperCase() as typeof CART_SIZES[number]);
  return i < 0 ? 1 : i;
};

/** A cart kind's bed, weight and the load it bears, from its size word and rank. Quality is read at the mint. */
export const cartNumbers = (c: { size?: string; rank?: ThemeRank | UniversalRank }) => {
  const step = cartStep(c.size);
  const rank = Math.max(0, rankStep((c.rank ?? 'F') as ThemeRank));
  const cells = CART_BED_CELLS * Math.pow(CART_SIZE_RATIO, step - 1) * Math.pow(CART_RANK_RATIO, rank);
  const gridW = Math.max(2, Math.round(Math.sqrt(cells * CART_ASPECT)));
  const gridH = Math.max(2, Math.round(cells / gridW));
  return {
    gridW, gridH, size: CART_SIZES[step] as string,
    weight: Math.round(gridW * gridH * CART_KG_PER_CELL * 10) / 10,
    bears: Math.round(gridW * gridH * CART_BEARS_PER_CELL)
  };
};

/** What a folded cart takes in a pack: two wide, longer by one for each size up. */
export const cartFolded = (size?: string) => ({ width: 2, height: 2 + cartStep(size) });

/** What a piece of this quality bears: a better-made cart bears more, a worse one less. */
export const cartBearsAt = (bears: number, quality: number) => Math.max(0, Math.round(bears * (1 + quality) * 10) / 10);

const range = (stat: string, low: number, high: number, step: number, ratio = 1.6) => ({
  stat, min: Math.round(low * Math.pow(ratio, step) * 100) / 100, max: Math.round(high * Math.pow(ratio, step) * 100) / 100
});

/**
 * A day's energy on a piece, native, and small (2026-11-11). Pedro: "they shouldn't be hard coded, this
 * should be a possible stat right? as hardcoded, or implicit, I'd leave it to 1-2 at most". Energy comes
 * to gear mainly as a property, on any piece its tags allow; natively only the focus and the belt carry
 * it, 1 to 2, the same at every rank, since his day reads no rank.
 */
const dayLine = () => ({ stat: 'max_energy', min: 1, max: 2 });

/** The grammar of gear: what a kind IS, so a body slot always takes it (R5's rule, as law). */
export const GEAR_SHAPES: Record<GearKind, IGearShape> = {
  blade: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['melee', 'one_hand', 'physical', 'blade'],
    implicits: s => [range('accuracy_rating', 10, 20, s), { stat: 'attack_speed', value: 1.2 }] },
  bludgeon: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['melee', 'two_hand', 'physical', 'blunt', 'heavy'],
    implicits: s => [range('crit_multiplier', 0.1, 0.2, s, 1.2), { stat: 'attack_speed', value: 0.85 }] },
  bow: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['ranged', 'two_hand', 'physical', 'projectile'],
    implicits: s => [range('accuracy_rating', 15, 30, s), { stat: 'attack_speed', value: 1.0 }] },
  focus: { bucket: 'weapon_bases', slot: SlotType.MAIN_HAND, tags: ['magic', 'one_hand', 'caster'],
    implicits: () => [dayLine(), { stat: 'attack_speed', value: 0.9 }] },
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
  belt: { bucket: 'armor_bases', slot: SlotType.BELT, tags: ['belt'], implicits: () => [dayLine()], belt: { pouchSlots: 2 } },
  pouch: { bucket: 'armor_bases', slot: SlotType.POUCH, tags: ['pouch'], implicits: () => [], pouch: { accepts: ['consumable'], capacity: 3 } },
  cart: { bucket: 'armor_bases', slot: SlotType.NONE, tags: ['cart', 'heavy'], implicits: () => [], cart: true },
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
  accuracy_rating: 15, evasion_rating: 12, attack_speed: 0.08, haste: 0.08,
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
  // The writer's tier stands for a rank (BALANCE_RUN 1.5), and energy reads none
  const grow = readsRank(stat) ? Math.pow(1.5, Math.max(0, tier - 1)) : 1;
  const round = (n: number) => (Math.abs(scale) < 1 ? Math.round(n * 100) / 100 : Math.round(n));
  const low = round(BAND[band][0] * scale * grow);
  const high = Math.max(low, round(BAND[band][1] * scale * grow));
  return downside ? [-high, -low] : [low, high];
};

/** The effect door's numbers (Layer 1): rank, cost and the caster's power. */
const COST_POWER = { trivial: 0.5, low: 1, medium: 1.6, high: 2.5, extreme: 4 };
const COST_ENERGY = { trivial: 2, low: 5, medium: 10, high: 18, extreme: 30 };
const COST_COOLDOWN_MS = { trivial: 1500, low: 3000, medium: 6000, high: 10000, extreme: 18000 };

/**
 * Call 19: a working is worth twice a bow for each second it is stood for (its telegraph is its draw), a rank doubling
 * it as it doubles a body; an aether buys three of what it deals at F, and reads no rank, as a day's energy reads none.
 * A working that deals nothing keeps its band's price. A world that stands before the fight's law reads its creatures'
 * workings as written (`standing`).
 */
export const abilityNumbers = (cost: keyof typeof COST_POWER, rank: ThemeRank, standing = false, effect?: string) => {
  const telegraphMs = 400 + COST_POWER[cost] * 300;
  const atF = 2 * PLAIN_BLOW_PER_S * (telegraphMs / 1000);
  return {
    magnitude: standing ? Math.round(geometric(6, 1.7, rankStep(rank)) * COST_POWER[cost]) : Math.round(atF * bodyScale(rank)),
    energy: COST_ENERGY[cost],
    // An aether buys three of what a working deals; one that deals nothing (a way out, a ward, a rest) keeps its band's price
    aether: effect === 'damage' && !standing ? Math.round(atF / 3) : COST_ENERGY[cost],
    cooldownMs: COST_COOLDOWN_MS[cost],
    durationMs: 1500 + COST_POWER[cost] * 1000,
    telegraphMs
  };
};

// -------------------------------------------------------------------------
// THE FIGHT'S SHAPES (the fight's rebalance, part 1). Pedro, 2026-11-11: "it should be bullet hellish, and
// meele needs reach, and it needs to have that arc, an axe has reach but doesn't hit close to the character
// usin ..., a spear can atack forward far, and wide arc". A blow is a piece of ground: a ring cut to a wedge,
// as far as its reach, as wide as its sweep, and empty inside its haft. Tiles and radians: no rank moves them
// (BALANCE_RUN 1.2, "no rank at all: seconds, tiles, reach, wind-ups"). All guesses until played.
// -------------------------------------------------------------------------

/** Tiles from the wielder to the far edge. The middling reach is the swing Pedro played: three tiles. */
const STRIKE_REACH_TILES = { short: 2, middling: 3, long: 4.5 };
/** Radians either side of where it is aimed. The arc is the swing Pedro played; a thrust is a line; wide sweeps round in front. */
const STRIKE_HALF_ANGLE = { thrust: 0.15, arc: 0.75, wide: 1.4 };
/** How much of the reach a haft is: what stands inside it is under the head's swing, untouched. */
const HAFT_SHARE = 0.55;

export interface IStrikeShape { reachPx: number; innerPx: number; halfAngle: number }

export const strikeNumbers = (w: IStrikeWords): IStrikeShape => {
  const reachPx = STRIKE_REACH_TILES[w.reach] * TILE_PX;
  return { reachPx, innerPx: w.hollow === 'haft' ? Math.round(reachPx * HAFT_SHARE) : 0, halfAngle: STRIKE_HALF_ANGLE[w.sweep] };
};

/**
 * What a kind's own words say of how it strikes, when its pack named no strike: the pinned pack names none,
 * and its weapons still differ. Each measure is read from words alone, a word of form over a word of grip,
 * and a pack's own strike words always win. These are plain words of what a thing is (a haft, a point, two
 * hands), never the name of any weapon; a word a pack registers that means the same can join its list.
 */
const LONG_WORDS = ['spear', 'pike', 'lance', 'polearm', 'halberd', 'glaive', 'scythe', 'whip', 'axe', 'chopping'];
const SHORT_WORDS = ['improvised', 'knife', 'dagger', 'shiv', 'saw', 'fist', 'claw'];
const THRUST_WORDS = ['spear', 'pike', 'lance', 'rapier', 'piercing', 'pickaxe', 'mining'];
const WIDE_WORDS = ['two_hand', 'scythe', 'flail', 'glaive'];
const HAFT_WORDS = ['axe', 'chopping', 'pickaxe', 'mining', 'polearm', 'halberd', 'glaive', 'scythe'];

const saysAny = (tags: readonly string[], words: readonly string[]) => tags.some(t => words.includes(t));

export const strikeWordsOf = (tags: readonly string[]): IStrikeWords => ({
  reach: saysAny(tags, LONG_WORDS) ? 'long' : saysAny(tags, SHORT_WORDS) ? 'short' : 'middling',
  sweep: saysAny(tags, THRUST_WORDS) ? 'thrust' : saysAny(tags, WIDE_WORDS) ? 'wide' : 'arc',
  hollow: saysAny(tags, HAFT_WORDS) ? 'haft' : 'none'
});

/** What a magic hand casts round itself; anything else shoots one. */
export const volleyWordOf = (tags: readonly string[]): Volley =>
  saysAny(tags, ['magic', 'caster']) ? 'ring' : 'single';

/** A creature's blow, from its own words: a bigger body reaches further, and what besieges sweeps wide. */
const BLOW_REACH = { TINY: 'short', MEDIUM: 'short', LARGE: 'middling', GIGANTIC: 'long', COLOSSAL: 'long' } as const;
export const creatureStrikeWords = (c: { size?: string; behavior?: string }): IStrikeWords => ({
  reach: BLOW_REACH[c.size as keyof typeof BLOW_REACH] ?? 'short',
  sweep: c.behavior === 'SIEGE' ? 'wide' : 'arc',
  hollow: 'none'
});

/** A creature's volley, when its pack named none: what is bolted down turns a spiral, and a bigger body flings more. */
const VOLLEY_BY_SIZE = { TINY: 'single', MEDIUM: 'spread', LARGE: 'ring', GIGANTIC: 'ring', COLOSSAL: 'ring' } as const;
export const creatureVolleyOf = (c: { size?: string; behavior?: string; volley?: string }): Volley =>
  (c.volley as Volley | undefined) ?? (c.behavior === 'TURRET' ? 'spiral' : VOLLEY_BY_SIZE[c.size as keyof typeof VOLLEY_BY_SIZE] ?? 'single');

/** A spread: how many shots and how wide a fan. A spiral: arms, shots down each, how long between them, and how far each turns. A ring: how many. */
const SPREAD = { shots: 3, fan: 0.6 };
const SPIRAL = { arms: 3, shots: 5, gapMs: 80, turn: 0.25 };
const RING_SHOTS = 8;

/** Every shot of a volley: when it leaves after the volley begins, and its angle off where the volley is aimed. */
export const volleyShots = (v: Volley): { delayMs: number; offset: number }[] => {
  switch (v) {
    case 'spread':
      return Array.from({ length: SPREAD.shots }, (_, i) => ({ delayMs: 0, offset: -SPREAD.fan / 2 + (SPREAD.fan * i) / (SPREAD.shots - 1) }));
    case 'spiral':
      return Array.from({ length: SPIRAL.arms * SPIRAL.shots }, (_, n) => {
        const arm = n % SPIRAL.arms, k = Math.floor(n / SPIRAL.arms);
        return { delayMs: k * SPIRAL.gapMs, offset: (arm * 2 * Math.PI) / SPIRAL.arms + k * SPIRAL.turn };
      });
    case 'ring':
      return Array.from({ length: RING_SHOTS }, (_, i) => ({ delayMs: 0, offset: (i * 2 * Math.PI) / RING_SHOTS }));
    default:
      return [{ delayMs: 0, offset: 0 }];
  }
};

// -------------------------------------------------------------------------
// WIND-UPS AND A HIT FELT (the fight's rebalance, part 2; BALANCE_RUN 2.13, call 6). A person's blow winds up:
// a shot is drawn standing, a swing begins at half pace. A hit is felt: a share of it, weight over weight and
// poise, is that share of a tile pushed and that share of pace lost for that share of a second, and it breaks
// a wind-up its target stood for only when its weight is at least the target's poise. Seconds, tiles and
// weights read no rank. All guesses until played.
// -------------------------------------------------------------------------

/** A shot is drawn for this share of its weapon's own cycle, standing. A faster hand shortens what comes after it, never the draw. */
export const DRAW_SHARE = 0.6;
export const drawMs = (ownRate: number): number => Math.round((DRAW_SHARE * 1000) / Math.max(0.1, ownRate));

/** A swing's wind-up: a moment to begin, and a little for every tile its head sweeps through. */
const SWING_BASE_MS = 100;
const SWING_MS_PER_TILE = 45;
const sweptTiles = (s: IStrikeShape) => (2 * s.halfAngle * s.reachPx) / TILE_PX;
export const swingWindupMs = (s: IStrikeShape): number => Math.round(SWING_BASE_MS + SWING_MS_PER_TILE * sweptTiles(s));

/** What a body keeps of its walk while it winds up: a draw stands, a swing keeps half. */
export const DRAW_PACE = 0;
export const SWING_PACE = 0.5;

/** A blow weighs what it takes to swing: the middling arc Pedro played weighs one, a wide sweep more, a stab less. */
export const blowWeight = (s: IStrikeShape): number => swingWindupMs(s) / swingWindupMs(strikeNumbers({ reach: 'middling', sweep: 'arc', hollow: 'none' }));
/** Call 12: the empty hand throws, at eight tiles and under the draw. A stone or a bare hand flies this far, and no further. */
export const THROW_TILES = 8;
/**
 * A shot weighs half the middling blow (which weighs one), whatever flung it (SH1). So it is felt by every body
 * it lands on, and breaks the wind-up only of a body that stands at less than a person: only a blow struck in
 * reach breaks a person's draw, since closing the distance is how speed beats a shooter.
 */
export const SHOT_WEIGHT = 1 / 2;
/** How firmly a body stands: its mass, the same measure as what it eats (a middling body one, a person one). */
export const bodyPoise = (size?: string): number => APPETITE[size as keyof typeof APPETITE] ?? APPETITE.MEDIUM;
/** A creature's blow weighs its shape's weight times the body behind it. */
export const creatureBlowWeight = (c: { size?: string; behavior?: string }): number => blowWeight(strikeNumbers(creatureStrikeWords(c))) * bodyPoise(c.size);

/** What a hit does to the body it lands on: a push, a pause (a status the clock runs), and whether it breaks what that body stood for. */
export const feltHit = (weight: number, poise: number): { share: number; pushPx: number; pause: { kind: 'stagger'; magnitude: number; durationMs: number }; breaks: boolean } => {
  const share = weight / Math.max(1e-9, weight + poise);
  return { share, pushPx: share * TILE_PX, pause: { kind: 'stagger', magnitude: share, durationMs: Math.round(share * 1000) }, breaks: weight >= poise };
};

/** D77: a forced way out always takes the top band, and a scroll of it is written no lower than this rank. */
export const FORCED_EXIT_COST = 'extreme' as const;
export const FORCED_EXIT_FLOOR_RANK: ThemeRank = 'C';
/** What such a scroll is worth: its rank's shelf price, times what the band is worth. The shelf asks three times this. */
export const forcedExitWorth = (rank: ThemeRank) => shelfPrice(rank, COST_POWER[FORCED_EXIT_COST]);

// -------------------------------------------------------------------------
// LOOT (LootLaw.ts). A model writes a table in bands; these turn the bands into numbers.
// Whole numbers only (a chance in parts per million), so a drop rerun on another machine
// lands exactly where it landed here (D134): no power, root or log is taken on the way.
// -------------------------------------------------------------------------

/**
 * The version a loot table is checked under. A table keeps the one it was written under.
 * 2 (2026-11-10): a table can be one creature's own, and such a table holds a spread. Tables written
 * under 1 were a few to a theme, matched by tags, so they are refused and written again.
 */
export const LOOT_FORMULA_VERSION = 2;

/**
 * How many different odds a creature's own table holds at the least (Pedro, of his own run: "the
 * drops from the mobs are too consistent ... make the spread be better"). A floor, never a ceiling.
 */
export const LOOT_OWN_SPREAD = 3;

/** One draw in this many: the chance of a line, as a whole number. */
export const LOOT_PARTS = 1_000_000;

/** How often a line drops, by its band, in parts per LOOT_PARTS. */
export const LOOT_ODDS_PARTS = { always: LOOT_PARTS, often: 600_000, sometimes: 250_000, seldom: 50_000, rarely: 5_000 } as const;

/** How many of a thing a line drops when it drops, lowest and highest. */
export const LOOT_COUNT_SPAN = { one: [1, 1], few: [1, 3], several: [2, 5] } as const;

export const lootNumbers = (l: { odds: keyof typeof LOOT_ODDS_PARTS; count: keyof typeof LOOT_COUNT_SPAN }) => ({
  chance: LOOT_ODDS_PARTS[l.odds],
  low: LOOT_COUNT_SPAN[l.count][0],
  high: LOOT_COUNT_SPAN[l.count][1]
});

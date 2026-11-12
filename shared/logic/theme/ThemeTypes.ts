/**
 * THE THEME (D53, D57): what a world is made of, as a pack a model can write.
 *
 * A theme holds words, tags and bands, and no numbers but small counts. One
 * versioned formula turns the bands into health, damage and prices, so a model
 * cannot write a surprise, and balance lives in one file.
 *
 * The vocabularies below are the grammar of a pack, not its content. Nothing here
 * names a creature, a material or a weapon; they all come from the pack.
 */

import { ITagEntry } from '../../types';

/** Version 2 knows a line's depth (D61). Version 3 knows who leads and what a body leaves (D93, D99). Version 4 knows what holds value (D115). A pack sealed under an older one stands under the law it was written under. */
export const THEME_FORMULA_VERSION = 4;
/** From this version a pack must hold its trees (D63). */
export const TREES_FROM_FORMULA = 2;
/** From this version every creature says social and builds, plain elites lead, and creatures leave junk (D93, D99). */
export const LEADERS_FROM_FORMULA = 3;
/** From this version a world holds things worth keeping for their own sake (D115). */
export const ANCHORS_FROM_FORMULA = 4;

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
export type ThemeRank = typeof RANKS[number];

export const BIOMES = ['WASTELAND', 'OVERGROWTH', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY'] as const;
export type ThemeBiome = typeof BIOMES[number];

export const SIZES = ['TINY', 'MEDIUM', 'LARGE', 'GIGANTIC', 'COLOSSAL'] as const;
export const BEHAVIORS = ['PASSIVE', 'NEUTRAL', 'AGGRESSIVE', 'SWARM', 'SIEGE', 'TURRET'] as const;
export const BUILDS = ['frail', 'sturdy', 'massive'] as const;
export const THREATS = ['meek', 'sharp', 'deadly'] as const;
export const PACES = ['slow', 'steady', 'swift'] as const;

/** How a thing is taken from the ground: the art's shape, and what the hands need. */
export const MATERIAL_FORMS = ['grain', 'shrub', 'fruit', 'tree', 'vein', 'sand', 'rock', 'pebble'] as const;
export const HARVEST_VERBS = ['hands', 'chop', 'mine'] as const;
export const WEIGHTS = ['light', 'medium', 'heavy'] as const;
export const WORTHS = ['common', 'fine', 'rare'] as const;

export const GEAR_KINDS = [
  'blade', 'bludgeon', 'bow', 'focus',
  'head', 'chest', 'legs', 'feet', 'shoulder', 'eyes', 'necklace', 'earring', 'ring', 'quiver',
  'bag', 'belt', 'pouch', 'cart',
  'chop_tool', 'mine_tool', 'work_tool'
] as const;
export type GearKind = typeof GEAR_KINDS[number];

/** Pedro: a potion can refill energy, and the law keeps those off every shelf. */
export const CONSUMABLE_KINDS = ['heal', 'scroll', 'energy'] as const;
/** What a material does for whoever eats it. A plant that refills energy is very, very rare. */
export const MATERIAL_RESTORES = ['none', 'energy'] as const;

export const STAT_BANDS = ['minor', 'moderate', 'major'] as const;

/** The catalog's vocabulary for what an ability is (Layer 1). */
export const DELIVERIES = ['self', 'touch', 'melee', 'ranged', 'area', 'aura'] as const;
/**
 * What can be applied today. Line 77's law reaches effects too: a word with no reader is
 * not here, and the catalog's summon, reveal, transform and move join when something reads them.
 * A new word goes on the end: `forced_exit` (D77) is read by EffectSystem.
 */
export const EFFECTS = ['damage', 'control', 'heal', 'buff', 'debuff', 'ward', 'rest', 'forced_exit'] as const;
/** When a piece fires. Each has a reader in the field; the catalog's others join the same way. */
export const TRIGGERS = ['on_hit', 'on_defeat', 'on_hurt', 'on_low_health'] as const;
/** What a minted skill can let its holder do. Rest is the one with a reader (D58). */
export const SKILL_GRANTS = ['rest'] as const;
export const COST_BANDS = ['trivial', 'low', 'medium', 'high', 'extreme'] as const;
/**
 * What a passive gift from a skill's circles can add: the stats whose readers go through
 * StatSystem.total, so the bonus really acts. A stat with another reader is not here.
 */
export const PASSIVE_STATS = [
  'damage', 'defense', 'max_health', 'max_energy', 'accuracy_rating', 'evasion_rating', 'attack_speed',
  'crit_chance', 'crit_multiplier', 'block_chance', 'poison_damage', 'light_radius', 'pickup_radius',
  'carry_capacity', 'noise_reduction', 'luck_find_rarity', 'field_analysis_speed'
] as const;

/** D63: the trees no pack may lack. A tree is any plain word, and more are welcome. */
export const REQUIRED_TREES = ['animal', 'monster'] as const;
/** What a change of form adds to the body it inherits, as the art draws them: shape and place, never hue. */
export const LINE_FEATURES = ['horns', 'crest', 'spines', 'tail', 'plates', 'fangs', 'mantle', 'barbs', 'brand', 'stilts', 'fins'] as const;
export type LineFeature = typeof LINE_FEATURES[number];
/** What a plain elite adds to the body of what it leads, so a leader is told by shape, never hue. */
export const LEADER_FEATURES: LineFeature[] = ['crest', 'mantle'];

export interface IThemeCreature {
  key: string;
  name: string;
  blurb: string;
  tags: string[];
  rank: ThemeRank;
  size: typeof SIZES[number];
  behavior: typeof BEHAVIORS[number];
  build: typeof BUILDS[number];
  threat: typeof THREATS[number];
  pace: typeof PACES[number];
  habitat: ThemeBiome[];
  /** Keys of abilities in this pack: its magic, which it casts and teaches. */
  innate: string[];
  /** D63: which tree it belongs to, since a behaviour word cannot say. */
  tree: string;
  /** D93: does it live in groups? Only a social species leads, or follows. Left out of a pack written before there was such a thing. */
  social?: boolean;
  /** D93: can its leaders raise a base? No animal does. */
  builds?: boolean;
  /** D93: for a plain elite of a social species, the key of the kind whose pack it heads. Empty otherwise. */
  leads?: string;
}

/** D99: what a creature leaves that is only worth its sale. */
export interface IThemeJunk {
  key: string;
  name: string;
  blurb: string;
  tags: string[];
  rank: ThemeRank;
  weight: typeof WEIGHTS[number];
  worth: typeof WORTHS[number];
  /** Creature tags: a body carrying any of these can leave it. */
  from: string[];
}

/** D115: a gem, a work of art, a valuable. Found, never grown or made, and it holds its worth wherever it goes. */
export interface IThemeAnchor {
  key: string;
  name: string;
  blurb: string;
  tags: string[];
  rank: ThemeRank;
  weight: typeof WEIGHTS[number];
  worth: typeof WORTHS[number];
  /** The kinds of ground whose chests can hold it. */
  foundIn: ThemeBiome[];
}

/** What a model writes when a line changes: only what changed. A line's numbers come from the formula. */
export interface ILineWords {
  name: string;
  blurb: string;
  /** Tags added to what it inherits. */
  tags: string[];
  /** Added to the sprite it inherits. */
  features: LineFeature[];
  /** Keys of abilities in its pack, added to what it was born knowing. */
  innate: string[];
}

/** The bands a change of form moves. Code decides these, from how the kind fared. */
export type ILineBands = Partial<Pick<IThemeCreature, 'build' | 'threat' | 'pace'>>;

/** All a node commits to, beside its parents: the words and the band moves. */
export interface ILineChange extends ILineWords {
  bands: ILineBands;
}

export interface IThemeMaterial {
  key: string;
  name: string;
  blurb: string;
  tags: string[];
  rank: ThemeRank;
  form: typeof MATERIAL_FORMS[number];
  verb: typeof HARVEST_VERBS[number];
  weight: typeof WEIGHTS[number];
  worth: typeof WORTHS[number];
  habitat: ThemeBiome[];
  /** Sold on the hub's shelf as well as found. */
  onShelf: boolean;
  /** Eaten for this. Left out of a pack written before there was such a thing. */
  restores?: typeof MATERIAL_RESTORES[number];
}

export interface IThemeStation {
  key: string;
  name: string;
  blurb: string;
  /** D25: the tool + material connection that opens it. */
  tool: string[];
  material: string[];
  bill: { tag: string; count: number }[];
}

export interface IThemeGood {
  key: string;
  name: string;
  blurb: string;
  tags: string[];
  rank: ThemeRank;
  weight: typeof WEIGHTS[number];
  /** The trade the work grows: a tag of kind trade. */
  trade: string;
  /** A station's key in this pack, or empty for any workshop bench. */
  station: string;
  from: { key: string; count: number }[];
  makes: number;
}

export interface IThemeGear {
  key: string;
  name: string;
  blurb: string;
  kind: GearKind;
  rank: ThemeRank;
  tags: string[];
  /** For a tool: the material tags it answers. Empty otherwise. */
  works: string[];
  /** Key of an ability this piece can carry (Layer 3), or empty. */
  carries: string;
  /** When it fires, from TRIGGERS. Empty with no ability. */
  trigger: string;
  /** What it is made of, if it can be made. */
  from: { key: string; count: number }[];
  /** 'none' is found only; 'hands' is the improvised floor, anywhere; 'bench' needs a workshop. */
  craftAt: 'none' | 'hands' | 'bench';
  /**
   * The interface pass, 2026-11-11: how big it is, in the creatures' size words. A cart's bed, weight and
   * load are read from it by the formula; other kinds ignore it. A pack written before it names none,
   * which reads MEDIUM, the first world's 10 by 8.
   */
  size?: typeof SIZES[number];
}

export interface IThemeConsumable {
  key: string;
  name: string;
  blurb: string;
  kind: typeof CONSUMABLE_KINDS[number];
  rank: ThemeRank;
  tags: string[];
  /** A scroll casts this ability. Empty otherwise. */
  casts: string;
  onShelf: boolean;
}

export interface IThemeAffix {
  key: string;
  name: string;
  type: 'PREFIX' | 'SUFFIX';
  /** What it may land on: gear tags, 'resource', 'mob', 'frame' or 'cart'. */
  allowedTags: string[];
  /** Empty for anywhere, or the biome whose dream it belongs to. */
  biome: string;
  /**
   * Retired by the rarity rescale (1.5, "Yes, rank is tier"): an affix's tier is the rank of the piece it sits on.
   * The writer is no longer asked for it; a pack written before keeps it, and only a standing world's old ranges read it.
   */
  tier?: number;
  gives: { stat: string; band: typeof STAT_BANDS[number]; downside: boolean }[];
}

export interface IThemeAbility {
  key: string;
  name: string;
  blurb: string;
  /** Tags of kind element. Nothing fixes how many elements a world has. */
  elements: string[];
  delivery: typeof DELIVERIES[number];
  effect: typeof EFFECTS[number];
  cost: typeof COST_BANDS[number];
}

/**
 * D119: what a new thing looks like, in three words a model writes. The art composes the sprite
 * from them (`worldForm`). A new word goes on the end, with its hue, ink or measure in the atoms,
 * and a bar holds that every word has one. Shape tells things apart; colour never has to.
 */
export const LOOK_COLORS = ['ash', 'bone', 'ochre', 'rust', 'ember', 'moss', 'verdigris', 'slate', 'indigo', 'plum'] as const;
export const LOOK_SHAPES = ['lump', 'shard', 'rod', 'coil', 'ring', 'plate', 'cluster', 'tuft', 'crystal', 'spike', 'pod', 'heap'] as const;
export const LOOK_SIZES = ['tiny', 'small', 'medium', 'large'] as const;

export interface IThemeLook {
  color: typeof LOOK_COLORS[number];
  shape: typeof LOOK_SHAPES[number];
  size: typeof LOOK_SIZES[number];
}

export interface IThemeRegion {
  biome: ThemeBiome;
  name: string;
  blurb: string;
}

/**
 * D119: a living people's trades, from the shared pool the theme carries. Pedro: "random
 * hallucinated (literally) professions that are economical in the theme they came from,
 * zombie apocalypse has mcgyver engineer". What it knows is a concept, never a means: how
 * that comes about is resolved backwards from wherever the person ends up (`ChainWeb`).
 */
export interface IThemeProfession {
  key: string;
  name: string;
  blurb: string;
  /** Who can hold it: someone of this rank or above. */
  rank: ThemeRank;
  /** What they can bring about, as one lower_snake_case word. */
  concept: string;
  /** The same in plain words, for whoever has to resolve it. */
  knows: string;
  /** What they would call the place they need. */
  workshop: string;
  /** D25: the tool + material connection their hands work. Registry words. */
  tool: string[];
  material: string[];
}

/**
 * Q1: terrain is two roles, each dressed by the world (Pedro, 2026-11-04). One is never
 * crossed ("water"; tunnels on an airless moon), and one is crossed by someone who holds
 * the skill its "crossing" word names ("mountains"; a crater on the dark side). The ground
 * under them is the same noise everywhere (`TerrainSystem`); only what it is called, and
 * what skill crosses it, belongs to a world.
 */
export const TERRAIN_ROLES = ['impassable', 'skilled'] as const;
export type TerrainRole = typeof TERRAIN_ROLES[number];

export interface IThemeTerrain {
  role: TerrainRole;
  /** What it is, in the world's plain words: "water", "tunnels", "a dark-side crater". */
  ground: string;
  blurb: string;
  /** For the skilled role, the registry word a held skill must carry to cross it. Empty for the impassable one. */
  crossing: string;
}

/** What a model writes. Its id is computed from these bytes and nothing else. */
export interface IThemeBody {
  name: string;
  premise: string;
  regions: IThemeRegion[];
  /** New words for the registry, under the tag law. */
  tags: ITagEntry[];
  creatures: IThemeCreature[];
  materials: IThemeMaterial[];
  stations: IThemeStation[];
  goods: IThemeGood[];
  gear: IThemeGear[];
  consumables: IThemeConsumable[];
  affixes: IThemeAffix[];
  abilities: IThemeAbility[];
  lore: string[];
  /** D99. Left out of a pack written before there was such a thing. */
  junk?: IThemeJunk[];
  /** D115. Left out of a pack written before there was such a thing. */
  anchors?: IThemeAnchor[];
  /** D119. Left out of a pack written before there was such a thing. */
  professions?: IThemeProfession[];
  /** Q1: the two terrain roles, dressed. Left out of a pack written before there was such a thing. */
  terrain?: IThemeTerrain[];
}

export interface IThemePack extends IThemeBody {
  themeId: string;
  formula: number;
  /** Who wrote it, on the record, as every batch records. */
  model: string;
  writtenAt: number;
  /** D55: what it cost to write. Metered per call. */
  usage?: { inputTokens: number; outputTokens: number; usd: number };
}

// -------------------------------------------------------------------------
// The structured-output schema: the same vocabulary, so the model cannot drift
// -------------------------------------------------------------------------

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const manyOf = (values: readonly string[]) => ({ type: 'array', items: oneOf(values) });
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties
});
const list = (properties: Record<string, unknown>) => ({ type: 'array', items: obj(properties) });
const count = { type: 'integer' };

/** What comes back for a batch of lines that changed: one entry per order, words only. */
export const LINE_SCHEMA: Record<string, unknown> = obj({
  lines: list({ order: str, name: str, blurb: str, tags: strs, features: manyOf(LINE_FEATURES), innate: strs })
});

export const THEME_SCHEMA: Record<string, unknown> = obj({
  name: str,
  premise: str,
  regions: list({ biome: oneOf(BIOMES), name: str, blurb: str }),
  tags: list({ tag: str, kind: oneOf(['tool', 'family', 'material', 'trade', 'action', 'descriptive', 'element', 'verb']), meaning: str }),
  creatures: list({
    key: str, name: str, blurb: str, tags: strs, rank: oneOf(RANKS), size: oneOf(SIZES), behavior: oneOf(BEHAVIORS),
    build: oneOf(BUILDS), threat: oneOf(THREATS), pace: oneOf(PACES), habitat: manyOf(BIOMES), innate: strs, tree: str,
    social: { type: 'boolean' }, builds: { type: 'boolean' }, leads: str
  }),
  materials: list({
    key: str, name: str, blurb: str, tags: strs, rank: oneOf(RANKS), form: oneOf(MATERIAL_FORMS), verb: oneOf(HARVEST_VERBS),
    weight: oneOf(WEIGHTS), worth: oneOf(WORTHS), habitat: manyOf(BIOMES), onShelf: { type: 'boolean' }, restores: oneOf(MATERIAL_RESTORES)
  }),
  stations: list({ key: str, name: str, blurb: str, tool: strs, material: strs, bill: list({ tag: str, count }) }),
  goods: list({
    key: str, name: str, blurb: str, tags: strs, rank: oneOf(RANKS), weight: oneOf(WEIGHTS), trade: str, station: str,
    from: list({ key: str, count }), makes: count
  }),
  gear: list({
    key: str, name: str, blurb: str, kind: oneOf(GEAR_KINDS), rank: oneOf(RANKS), size: oneOf(SIZES), tags: strs, works: strs, carries: str, trigger: str,
    from: list({ key: str, count }), craftAt: oneOf(['none', 'hands', 'bench'])
  }),
  consumables: list({ key: str, name: str, blurb: str, kind: oneOf(CONSUMABLE_KINDS), rank: oneOf(RANKS), tags: strs, casts: str, onShelf: { type: 'boolean' } }),
  affixes: list({
    key: str, name: str, type: oneOf(['PREFIX', 'SUFFIX']), allowedTags: strs, biome: str,
    gives: list({ stat: str, band: oneOf(STAT_BANDS), downside: { type: 'boolean' } })
  }),
  abilities: list({ key: str, name: str, blurb: str, elements: strs, delivery: oneOf(DELIVERIES), effect: oneOf(EFFECTS), cost: oneOf(COST_BANDS) }),
  lore: strs,
  junk: list({ key: str, name: str, blurb: str, tags: strs, rank: oneOf(RANKS), weight: oneOf(WEIGHTS), worth: oneOf(WORTHS), from: strs }),
  anchors: list({ key: str, name: str, blurb: str, tags: strs, rank: oneOf(RANKS), weight: oneOf(WEIGHTS), worth: oneOf(WORTHS), foundIn: manyOf(BIOMES) }),
  professions: list({ key: str, name: str, blurb: str, rank: oneOf(RANKS), concept: str, knows: str, workshop: str, tool: strs, material: strs })
});

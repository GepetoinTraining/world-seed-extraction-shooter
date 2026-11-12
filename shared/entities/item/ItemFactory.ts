import { IItem, IAffix, IBankedAffix, IComposition, ItemType, SlotType, UniversalRank, Rarity, MaterialOrigin, MENTAL_ATTRIBUTES, ROOM_ACTING_STATS } from '../../types';
import { LoadoutSystem } from '../player/systems/LoadoutSystem';
import { ITEM_DEFINITIONS, CRAFTED_GEAR_BASES, ItemDefinition } from './data/itemDefinitions';
import { AffixDefinition } from './data/affixDefinitions';
import { SHELF_STATE } from '../../logic/theme/shelf';
import type { IAffixWords, Band } from '../../logic/theme/PieceLaw';
import { AffixBank } from '../../logic/content/AffixBank';
import { IAffixPool } from '../world/Dreaming';
import { RANK_MULTIPLIERS, readsRank } from '../../constants';
import { RARITY_MULTIPLIERS } from '../../logic/content/LegacyLaw';
import { PieceLaw } from '../../logic/theme/PieceLaw';
import { SeededRNG, Rng } from '../../logic/rng/DeterministicRNG';
import { ResourceDef } from './data/resourceDefinitions';
import { MaterialPropertyType } from '../economy/types';
import { CompositionSystem } from '../../logic/economy/CompositionSystem';
import { MintRegistry } from '../../logic/economy/MintRegistry';
import { cartBearsAt, cartFolded, cartNumbers, rankStep } from '../../logic/theme/ThemeFormula';

/**
 * How a found piece is drawn under the rarity rescale. `odds` is the body's and the finder's (PieceLaw.oddsOf);
 * `pairsOpen` is whether the hub's magic unlock opened pairs (absent: the hub's own shelf state). `depth`, `band`
 * and `quality` set what is otherwise rolled: a boss's own piece, or the kit the ruler is solved on.
 */
export interface IFoundLaw {
  odds?: number; pairsOpen?: boolean; depth?: number; band?: Band; quality?: number;
  /** A body's own piece (call 17): whose it was, and the traits it carries, each a property at the major band. */
  whose?: { name: string; kind: 'boss' | 'titan' | 'god' }; traits?: string[];
}

/** What an affix may be written for that is not a piece of gear (ThemeLaw's scope words). */
const SCOPE_WORDS = new Set(['resource', 'mob', 'frame', 'cart', 'charm', 'scroll']);
const MIND = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);
type Rollable = AffixDefinition | IBankedAffix;

export class ItemFactory {

  /**
   * Mints a new Item.
   * @param targetRank - Optional force rank (e.g. for boss drops)
   * @param isIdentified - Whether the item stats are visible immediately (default: false)
   * @param rng - Deterministic stream for every roll (Wave 1.3). Callers derive
   *              it from a journaled key; the unkeyed fallback exists only so
   *              nothing crashes while legacy call sites migrate, and it logs.
   * @param pool - Wave 10E: the affix pool this roll draws from. A dreamed
   *               world passes its pinned bank's biome pool; absent, the
   *               purged legacy pool rolls (old worlds keep their dream).
   */
  static createItem(targetRank?: UniversalRank, isIdentified: boolean = false, rng?: SeededRNG, category?: 'weapon' | 'armor' | 'tool', baseId?: string, pool?: IAffixPool, opts?: { groundVersion?: number } & IFoundLaw): IItem {
    if (!rng) {
      console.warn('[FACTORY] Unkeyed item mint — roll is not replayable. Pass an Rng.fromKey stream.');
      rng = Rng.fromKey(`unkeyed:${Date.now()}:${Math.random()}`);
    }

    // 1. Select Base Template (optionally pinned to a category)
    const allBases = category === 'weapon' ? [...ITEM_DEFINITIONS.weapon_bases]
      : category === 'armor' ? [...ITEM_DEFINITIONS.armor_bases]
      : category === 'tool' ? [...ITEM_DEFINITIONS.tool_bases]
      : [
        ...ITEM_DEFINITIONS.weapon_bases,
        ...ITEM_DEFINITIONS.armor_bases,
        ...ITEM_DEFINITIONS.tool_bases
      ];

    const pinned = baseId ? allBases.find(b => b.id === baseId) : undefined;

    // The rarity rescale: a kind is a noun, so any kind is found at the rank of where it came from.
    // A world pinned before the law's ground gives what it gave (GROUND_VERSION); hub mints have no ground.
    if ((opts?.groundVersion ?? PieceLaw.FROM_GROUND) >= PieceLaw.FROM_GROUND) {
      return this.createFromTemplate(pinned ?? rng.pick(allBases), isIdentified, rng, pool, targetRank, opts);
    }

    let template: ItemDefinition;

    if (pinned) {
      template = pinned;
    } else if (targetRank) {
      const candidates = allBases.filter(b => b.rank === targetRank);
      template = candidates.length > 0
        ? rng.pick(candidates)
        : rng.pick(allBases);
    } else {
      template = rng.pick(allBases);
    }

    return this.legacyFromTemplate(template, isIdentified, rng, pool);
  }

  /**
   * D27: the same mint, for a base handed in rather than picked: a tool only a
   * batch has heard of. The base never joins a random pool, so no keyed roll moves.
   *
   * The rarity rescale (BALANCE_RUN 1.4): the piece takes `rank` from where it came from (the kind's own
   * word only when nothing says), a rank doubles it once, quality is the one roll and moves every number
   * on it, and its step is read off what it holds. Nothing numeric is rounded onto it.
   */
  static createFromTemplate(template: ItemDefinition, isIdentified: boolean, rng: SeededRNG, pool?: IAffixPool, rank?: UniversalRank, law: IFoundLaw = {}): IItem {
    const at = rank ?? template.rank ?? UniversalRank.F;
    const step = Math.max(0, rankStep(at));
    const rolledQuality = (rng.next() * 0.4) - 0.2;
    const quality = law.quality ?? rolledQuality;

    const stats: Record<string, number> = {};
    const native = template.kind ? PieceLaw.nativeLines(template.kind, step)
      // A base written by hand, with no noun: its own lines, moved from the rank it was written at by the same law
      : template.implicits.map(l => ({ stat: l.stat, value: (l.value ?? ((l.min ?? 0) + (l.max ?? 0)) / 2) * PieceLaw.rankFactor(l.stat, at) / PieceLaw.rankFactor(l.stat, template.rank ?? at) }));
    for (const l of native) stats[l.stat] = (stats[l.stat] ?? 0) + l.value * (1 + quality);

    const affixes = this.foundAffixes(template, at, quality, rng, pool, law);
    for (const a of affixes) for (const [key, val] of Object.entries(a.stats)) stats[key] = (stats[key] ?? 0) + val;

    // A body's own piece carries that body's traits, each one property of its stat at the major band
    const whose = law.whose ? { ...law.whose, traits: [...(law.traits ?? [])] } : undefined;
    for (const trait of whose?.traits ?? []) {
      for (const [key, val] of Object.entries(PieceLaw.affixStats({ gift: { stat: trait, band: 'major' } }, at, quality))) stats[key] = (stats[key] ?? 0) + val;
    }

    const power = PieceLaw.power(at, quality, template.tags.includes('tool'));
    const rarity = PieceLaw.wordOf({ affixes, whose });
    const cart = template.cart ? { ...template.cart, ...cartNumbers({ size: template.cart.size, rank: at }) } : undefined;
    const dimensions = this.getDimensions(template);

    const item: IItem = {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: template.id,
      name: whose ? `${whose.name}'s ${this.nameOf(template.universal_name, affixes)}` : this.nameOf(template.universal_name, affixes),
      description: this.generateDescription(rarity, quality),
      type: ItemType.GEAR,
      slot: template.slot,
      rank: at,
      rarity,
      quality,
      level: this.getLevelForRank(at),
      value: Math.max(1, Math.floor(power * 2)),
      itemPower: power,
      pieceLaw: PieceLaw.VERSION,
      ...(whose ? { whose } : {}),
      tags: [...template.tags],
      dimensions,
      weight: cart?.weight ?? this.getWeight(template, dimensions),
      affixes,
      stats: { ...stats, durability: 100, maxDurability: 100 },
      visuals: {
        modelId: template.tags.includes('weapon') ? 'weapon_mesh' : 'armor_mesh',
        colorHex: this.getColorForRarity(rarity)
      },
      icon: template.tags.includes('weapon') || template.tags.includes('melee') ? 'weapon_icon'
          : template.tags.includes('tool') ? 'tool_icon'
          : 'armor_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified
    };

    if (template.pouch) item.pouchData = { accepts: [...template.pouch.accepts], capacity: template.pouch.capacity, contents: [] };
    if (template.belt) item.beltData = { pouchSlots: template.belt.pouchSlots };
    // A cart's bed at the piece's own rank; what it bears is read at this piece's quality
    if (cart) item.cartData = { ...cart, ...(cart.bears !== undefined ? { bears: cartBearsAt(cart.bears, quality) } : {}) };
    if (template.carries) item.carries = { ...template.carries };
    // The fight's shapes ride from the kind's words onto the piece; a kind that wrote none leaves its tags to be read
    if (template.strike) item.strike = { ...template.strike };
    if (template.volley) item.volley = template.volley;
    item.requirements = LoadoutSystem.requirementsFor({ ...item, requirements: undefined });
    item.composition = CompositionSystem.root({ id: template.id, name: template.universal_name }, 'WORLD');
    return MintRegistry.claim(item);
  }

  /**
   * What a found piece holds (the affix law, part 2). How deep it goes is drawn with chance q^d, the odds moved by
   * the body it came from and the finder's luck, and stops at one lone property until the hub's magic unlock opens
   * pairs (call 13). Then one on either side, or pairs. Any affix may land on any piece ("Any stat, any piece"),
   * save what is written only for a scope (a creature, a material, a frame; a cart's own only on a cart). Its side
   * is its stat's reader's, never the writer's word; a stat sits once on a piece; and each is sized by the ruler.
   */
  private static foundAffixes(template: ItemDefinition, rank: UniversalRank, quality: number, rng: SeededRNG, pool: IAffixPool | undefined, law: IFoundLaw): IAffix[] {
    const pairsOpen = law.pairsOpen ?? SHELF_STATE.magicUnlocked;
    const rolled = law.depth ?? PieceLaw.rollDepth(rng, law.odds ?? 1, pairsOpen);
    const depth = pairsOpen ? rolled : Math.min(rolled, 1);
    const [prefixes, suffixes] = PieceLaw.ladder(depth, () => rng.next());
    if (prefixes + suffixes === 0) return [];

    const source = pool ?? AffixBank.legacyPool();
    const landsHere = (tags: readonly string[]) => tags.some(t => !SCOPE_WORDS.has(t)) || tags.some(t => t === 'cart' && template.tags.includes('cart'));
    const open = [...source.prefixes, ...source.suffixes]
      .map(def => ({ def, words: PieceLaw.wordsOf(def) }))
      .filter((c): c is { def: Rollable; words: IAffixWords } => !!c.words && landsHere(c.def.allowedTags) && !MIND.has(c.words.gift.stat))
      .sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0));

    const affixes: IAffix[] = [];
    const held = new Set<string>();
    const pick = (side: 'PREFIX' | 'SUFFIX') => {
      const choices = open.filter(c => PieceLaw.sideOf(c.words) === side && !held.has(c.words.gift.stat) && !affixes.some(a => a.id === c.def.id));
      if (choices.length === 0) return;
      const { def, words } = rng.pick(choices);
      held.add(words.gift.stat);
      affixes.push({
        id: def.id,
        name: (def as AffixDefinition).nameTemplate ?? (def as IBankedAffix).name,
        type: side,
        stats: PieceLaw.affixStats(words, rank, quality, law.band),
        ...(def.type !== side ? { nameAt: def.type } : {}),
        // "Yes, rank is tier": an affix's tier is the rank of the piece it sits on, F = 1
        tier: Math.max(0, rankStep(rank)) + 1
      });
    };
    for (let i = 0; i < prefixes; i++) pick('PREFIX');
    for (let i = 0; i < suffixes; i++) pick('SUFFIX');
    if (depth < 2) return affixes;
    // A land whose words cannot fill a step stops at the deepest step they do fill (the coordinator, 2026-11-12)
    const pairs = Math.min(affixes.filter(a => a.type === 'PREFIX').length, affixes.filter(a => a.type === 'SUFFIX').length);
    if (pairs === 0) return affixes.slice(0, 1);
    const kept = { PREFIX: 0, SUFFIX: 0 };
    return affixes.filter(a => kept[a.type]++ < pairs);
  }

  /** The old law, a standing world's: the rank written on its kind, rank entered twice, a power table by rarity. */
  private static legacyFromTemplate(template: ItemDefinition, isIdentified: boolean, rng: SeededRNG, pool?: IAffixPool): IItem {
    // 2. Roll Rarity
    const rarity = this.rollRarity(rng);

    // 3. Roll Quality
    const quality = (rng.next() * 0.4) - 0.2;

    // 4. Base Stats
    const baseStats = this.generateBaseStats(template, quality, rng);

    // 5. Affixes — from the dreamed pool when the world pinned one (10E)
    const affixes = this.generateAffixes(template, rarity, template.rank, rng, pool);
    
    // 6. Merge Stats
    const finalStats = { ...baseStats };
    affixes.forEach(affix => {
      Object.entries(affix.stats).forEach(([statKey, val]) => {
        finalStats[statKey] = (finalStats[statKey] || 0) + val;
      });
    });

    // 7. IP Calculation
    const rankMult = RANK_MULTIPLIERS[template.rank];
    const rarityMult = RARITY_MULTIPLIERS[rarity];
    const finalIP = Math.floor(template.base_ip * rankMult * rarityMult * (1 + quality));

    // 8. Name
    const fullName = this.nameOf(template.universal_name, affixes);

    // 9. Physicality (Inventory Tetris + Weight)
    const dimensions = this.getDimensions(template);
    const weight = this.getWeight(template, dimensions);

    const item: IItem = {
      // Stream-derived id: replaying the same roll key re-mints the same item
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: template.id,
      name: fullName,
      description: this.generateDescription(rarity, quality),
      type: ItemType.GEAR,
      slot: template.slot,
      rank: template.rank,
      rarity: rarity,
      quality: quality,
      level: this.getLevelForRank(template.rank),
      value: Math.max(1, Math.floor(finalIP * 2)),
      itemPower: finalIP,
      tags: [...template.tags],
      dimensions: dimensions,
      weight: weight,
      affixes: affixes,
      stats: {
        ...finalStats,
        durability: 100,
        maxDurability: 100,
        weight: 5
      },
      visuals: {
        modelId: template.tags.includes('weapon') ? 'weapon_mesh' : 'armor_mesh',
        colorHex: this.getColorForRarity(rarity)
      },
      icon: template.tags.includes('weapon') || template.tags.includes('melee') ? 'weapon_icon'
          : template.tags.includes('tool') ? 'tool_icon'
          : 'armor_icon',
      history: {
        dropDate: Date.now(),
        killCount: 0
      },
      isIdentified: isIdentified // <-- FIXED: ADDED PROPERTY
    };

    // Wave 10C: the definition's pouch/belt/cart laws ride onto the item
    if (template.pouch) item.pouchData = { accepts: [...template.pouch.accepts], capacity: template.pouch.capacity, contents: [] };
    if (template.belt) item.beltData = { pouchSlots: template.belt.pouchSlots };
    // The interface pass: a cart's bed and weight are its kind's; what it bears is read at this piece's quality
    if (template.cart) item.cartData = { ...template.cart, ...(template.cart.bears !== undefined ? { bears: cartBearsAt(template.cart.bears, quality) } : {}) };
    // Layer 3: a piece can carry an ability. It acts unstudied, and stays hidden until read.
    if (template.carries) item.carries = { ...template.carries };
    if (template.strike) item.strike = { ...template.strike };
    if (template.volley) item.volley = template.volley;
    // 10C.2: requirements are stamped at mint — deterministic from rank and tags
    item.requirements = LoadoutSystem.requirementsFor({ ...item, requirements: undefined });

    // Wave 10D: a world-rolled thing says so — no chain to lie about — and the
    // bank's registry claims its tuple (D18): the first keeps its claim.
    item.composition = CompositionSystem.root({ id: template.id, name: template.universal_name }, 'WORLD');
    return MintRegistry.claim(item);
  }

  /** D6 (10E): only a rank S+ making may carry its maker's own name. */
  static canCarryMakersName(rank: UniversalRank): boolean {
    return [UniversalRank.S, UniversalRank.SS, UniversalRank.SSS].includes(rank);
  }

  /**
   * Wave 10D.2: mint GEAR from a recipe and the composition of what it
   * consumed. The chain is the power budget; the price derives from the chain;
   * the registry claims the tuple like any rolled mint.
   * Wave 10E (D6's crafting half): components carry their affixes onto the
   * item they make — mental-stat affixes excepted, because the partition holds
   * every door (D22) — and a rank S+ making takes the maker's own name.
   */
  static createComposedItem(
    baseId: string,
    composition: IComposition,
    rng: SeededRNG,
    opts?: { inheritedAffixes?: IAffix[]; customName?: string; quality?: number }
  ): IItem | null {
    const template = CRAFTED_GEAR_BASES.find(b => b.id === baseId)
      ?? [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases].find(b => b.id === baseId);
    if (!template) return null;

    // The roll is always drawn, so a caller that decides the quality itself (PairCraft) moves nothing after it
    const rolledQuality = (rng.next() * 0.4) - 0.2;
    const quality = opts?.quality ?? rolledQuality;
    const baseStats = this.generateBaseStats(template, quality, rng);
    const itemPower = CompositionSystem.powerBudget(composition);
    const dimensions = this.getDimensions(template);

    // The components' affixes ride in, deduplicated, the mind kept out of gear
    const mental = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);
    const affixes: IAffix[] = [];
    for (const affix of opts?.inheritedAffixes ?? []) {
      if (affixes.some(a => a.id === affix.id)) continue;
      if (Object.keys(affix.stats ?? {}).some(k => mental.has(k))) continue; // D22: gear doesn't think
      affixes.push({ ...affix, stats: { ...affix.stats } });
    }
    const finalStats: Record<string, number> = { ...baseStats };
    // D26: an addition's room half stays on its record; a weapon acts on the gear half.
    const roomOnly = new Set<string>(ROOM_ACTING_STATS);
    affixes.forEach(affix => {
      Object.entries(affix.stats).forEach(([key, val]) => {
        if (roomOnly.has(key)) return;
        finalStats[key] = parseFloat(((finalStats[key] || 0) + val).toFixed(2));
      });
    });

    const constructed = this.nameOf(template.universal_name, affixes);
    const makersName = opts?.customName?.trim();
    const name = makersName && this.canCarryMakersName(template.rank) ? makersName : constructed;

    const item: IItem = {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: template.id,
      name,
      description: composition.steps[0]?.facility === null
        ? 'Lashed together where it was needed. The bank signed it anyway.'
        : `Made, not found. ${composition.steps.length} step(s) on its record.`,
      type: ItemType.GEAR,
      slot: template.slot,
      rank: template.rank,
      rarity: Rarity.COMMON,
      quality,
      level: this.getLevelForRank(template.rank),
      value: CompositionSystem.priceOf(composition),
      itemPower,
      tags: [...template.tags],
      dimensions,
      weight: this.getWeight(template, dimensions),
      affixes,
      stats: { ...finalStats, durability: 100, maxDurability: 100 },
      visuals: { modelId: 'weapon_mesh', colorHex: '#9ca3af' },
      icon: 'weapon_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true,
      composition
    };
    item.requirements = LoadoutSystem.requirementsFor({ ...item, requirements: undefined });
    return MintRegistry.claim(item);
  }

  /**
   * Wave 2.2: mint a RESOURCE item from its definition (not random gear).
   * Weight derives from material DENSITY (primordial: properties drive physics);
   * the def's hand-set weight is the fallback.
   * Wave 10D: quality sits on the ONE scale now (0 = no roll; the dead 100 is
   * gone), the value law reads it, and every mint carries its composition —
   * origin HARVEST unless the caller says otherwise (PURCHASE, CONSTRUCTION,
   * SALVAGE...). Commodities stay fungible: the registry does not claim them.
   */
  static createResourceItem(
    def: ResourceDef,
    rng: SeededRNG,
    opts?: { origin?: MaterialOrigin; quality?: number; dreamAffix?: IAffix; affixes?: IAffix[] }
  ): IItem {
    const density = def.materialProps?.[MaterialPropertyType.DENSITY];
    const weight = density !== undefined ? parseFloat((density * 0.5).toFixed(1)) : (def.weight ?? 1.0);
    const quality = opts?.quality ?? 0;
    // Wave 10E (the Dreaming): a harvest in a pinned world may carry a banked
    // affix — the material remembers what the Seed dreamed into it, and D6's
    // crafting half carries it onto whatever the material makes.
    const dreamAffix = opts?.dreamAffix;
    // The raw materials leg (D26): what a step added, and what its components
    // carried, ride the good and name it. A worked good says it was worked.
    const worked = opts?.affixes ?? [];

    const item: IItem = {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: def.id,
      name: worked.length > 0 ? this.nameOf(def.name, worked)
        : dreamAffix && dreamAffix.type === 'PREFIX' ? `${dreamAffix.name} ${def.name}`
        : dreamAffix ? `${def.name} ${dreamAffix.name}` : def.name,
      description: def.description || 'Harvested material. Can be refined.',
      type: def.type ?? ItemType.RESOURCE,
      slot: def.slot ?? ('NONE' as any),
      rank: def.rank ?? UniversalRank.F,
      rarity: def.rarity ?? Rarity.COMMON,
      quality,
      level: 1,
      value: def.worth ?? CompositionSystem.baseMaterialValue(def, quality),
      itemPower: 0,
      tags: [...(def.tags ?? [])],
      affixes: worked.length > 0 ? worked : dreamAffix ? [dreamAffix] : [],
      dimensions: def.dimensions ?? { width: 1, height: 1 },
      weight,
      stats: { ...(def.stats ?? {}) },
      visuals: def.visuals ?? { modelId: 'resource', colorHex: '#9ca3af' },
      icon: def.icon ?? 'resource_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true,
      ...((def as { casts?: string }).casts ? { casts: (def as { casts?: string }).casts } : {}),
      composition: CompositionSystem.root({ id: def.id, name: def.name }, opts?.origin ?? 'HARVEST')
    };
    return item;
  }

  /** Maps rank to a nominal player level requirement */
  static getLevelForRank(rank: UniversalRank): number {
    const levels: Record<string, number> = {
      'F': 1, 'E': 10, 'D': 20, 'C': 30,
      'B': 40, 'A': 50, 'S': 60, 'SS': 70, 'SSS': 80
    };
    return levels[rank] || 1;
  }

  /** Inventory Tetris footprint derived from the item archetype */
  private static getDimensions(template: ItemDefinition): { width: number; height: number } {
    const tags = template.tags;
    if (template.cart) return cartFolded(template.cart.size); // a packed cart is a real burden, longer the bigger it is
    if (template.pouch) return { width: 1, height: 1 };
    if (tags.includes('two_hand')) return { width: 2, height: 4 };
    if (tags.includes('one_hand') || tags.includes('tool')) return { width: 1, height: 3 };
    if (tags.includes('chest') || tags.includes('body')) return { width: 2, height: 3 };
    if (tags.includes('helmet') || tags.includes('head')) return { width: 2, height: 2 };
    if (tags.includes('ring') || tags.includes('amulet') || tags.includes('jewelry')) return { width: 1, height: 1 };
    // Wave 10C: the new branches of the tree
    switch (template.slot) {
      case SlotType.EYES: return { width: 2, height: 1 };
      case SlotType.SHOULDER: return { width: 2, height: 1 };
      case SlotType.BELT: return { width: 2, height: 1 };
      case SlotType.QUIVER: return { width: 1, height: 3 };
      case SlotType.BAG: return { width: 2, height: 2 };
      case SlotType.LEGS: return { width: 2, height: 2 };
    }
    return { width: 2, height: 2 };
  }

  /** Weight in kg: density of the material class x footprint */
  private static getWeight(template: ItemDefinition, dims: { width: number; height: number }): number {
    // A cart weighs what its kind's bed weighs (ThemeFormula.cartNumbers)
    if (template.cart?.weight !== undefined) return template.cart.weight;
    const area = dims.width * dims.height;
    let density = 1.0; // kg per grid cell
    if (template.tags.includes('heavy') || template.tags.includes('plate')) density = 2.5;
    if (template.tags.includes('light') || template.tags.includes('cloth')) density = 0.5;
    if (template.tags.includes('tool')) density = 1.5;
    return parseFloat((area * density).toFixed(1));
  }

  // ... (Keep private helpers: rollRarity, generateBaseStats, generateAffixes, nameOf, generateDescription, getColorForRarity same as before)
  private static rollRarity(rng: SeededRNG): Rarity {
    const rand = rng.next();
    if (rand > 0.99) return Rarity.LEGENDARY;
    if (rand > 0.95) return Rarity.EPIC;
    if (rand > 0.85) return Rarity.RARE;
    if (rand > 0.60) return Rarity.UNCOMMON;
    return Rarity.COMMON;
  }

  private static generateBaseStats(template: ItemDefinition, quality: number, rng: SeededRNG): Record<string, number> {
    const stats: Record<string, number> = {};
    template.implicits.forEach(imp => {
      let val = 0;
      if (imp.value !== undefined) val = imp.value;
      else if (imp.min !== undefined && imp.max !== undefined) val = imp.min + rng.next() * (imp.max - imp.min);

      if (val > 1) stats[imp.stat] = Math.round(val * (1 + quality));
      else stats[imp.stat] = parseFloat((val * (1 + quality)).toFixed(2));
    });
    return stats;
  }

  private static generateAffixes(template: ItemDefinition, rarity: Rarity, itemRank: UniversalRank, rng: SeededRNG, pool?: IAffixPool): IAffix[] {
    // Wave 10E: no pool named means the purged legacy pool — never the raw
    // table, whose Owl-family mental affixes the bank refuses to roll again.
    const source = pool ?? AffixBank.legacyPool();
    const affixes: IAffix[] = [];
    let prefixCount = 0;
    let suffixCount = 0;

    switch (rarity) {
      case Rarity.UNCOMMON: rng.next() > 0.5 ? prefixCount++ : suffixCount++; break;
      case Rarity.RARE: prefixCount = 1; suffixCount = 1; break;
      case Rarity.EPIC: prefixCount = 2; suffixCount = 2; break;
      case Rarity.LEGENDARY: prefixCount = 3; suffixCount = 3; break;
    }

    type Rollable = AffixDefinition | import('../../types').IBankedAffix;
    const pickAffix = (pool: Rollable[], currentAffixes: IAffix[]): IAffix | null => {
      const valid = pool.filter(def => def.allowedTags.some(tag => template.tags.includes(tag)));
      const available = valid.filter(def => !currentAffixes.some(a => a.id === def.id));

      if (available.length === 0) return null;
      const choice = rng.pick(available);

      const rankMult = RANK_MULTIPLIERS[itemRank];
      const rolledStats: Record<string, number> = {};

      // A banked NAME-ONLY entry rolls with no stats: it does nothing until a
      // later batch defines its effect (10E.1) — and it never will, in a world
      // pinned before that batch.
      Object.entries(choice.statModifiers ?? {}).forEach(([key, range]) => {
        const [min, max] = range;
        const baseVal = min + rng.next() * (max - min);
        // Pedro, 2026-11-11: his day reads no rank, so energy is the same on a piece of any rank
        const scaled = readsRank(key) ? baseVal * rankMult : baseVal;
        // Wave 10E: fractional stats (attack_speed) keep two decimals instead
        // of rounding to zero; negative offsets (D19) survive the same way.
        rolledStats[key] = Math.abs(scaled) < 1 ? parseFloat(scaled.toFixed(2)) : Math.round(scaled);
      });

      return {
        id: choice.id,
        name: (choice as AffixDefinition).nameTemplate ?? (choice as import('../../types').IBankedAffix).name,
        type: choice.type,
        stats: rolledStats,
        tier: 1
      };
    };

    for (let i = 0; i < prefixCount; i++) {
      const aff = pickAffix(source.prefixes, affixes);
      if (aff) affixes.push(aff);
    }
    for (let i = 0; i < suffixCount; i++) {
      const aff = pickAffix(source.suffixes, affixes);
      if (aff) affixes.push(aff);
    }

    return affixes;
  }

  /**
   * Q13: one quality scale. The card's five bands say a piece's quality, so the name carries no
   * quality word at all. A prefix on a name that begins "The" goes after it: "The Heavy Repossessor".
   */
  static nameOf(baseName: string, affixes: IAffix[]): string {
    const prefix = affixes.find(a => (a.nameAt ?? a.type) === 'PREFIX')?.name;
    const suffix = affixes.find(a => (a.nameAt ?? a.type) === 'SUFFIX')?.name;
    let name = baseName;
    if (prefix) name = /^The\s/.test(name) ? `The ${prefix} ${name.slice(4)}` : `${prefix} ${name}`;
    if (suffix) name = `${name} ${suffix}`;
    return name;
  }

  private static generateDescription(rarity: Rarity, quality: number): string {
    let desc = "";
    if (quality < -0.10) desc += "This item has seen better days. ";
    else if (quality > 0.10) desc += "The craftsmanship is exceptional. ";
    desc += `A ${rarity.toLowerCase()} artifact.`;
    return desc;
  }

  private static getColorForRarity(rarity: Rarity): string {
    switch(rarity) {
      case Rarity.COMMON: return '#e5e5e5';
      case Rarity.UNCOMMON: return '#22c55e';
      case Rarity.MAGICAL: return '#14b8a6';
      case Rarity.RARE: return '#0ea5e9';
      case Rarity.EPIC: return '#a855f7';
      case Rarity.LEGENDARY: return '#f59e0b';
      default: return '#fff';
    }
  }
}
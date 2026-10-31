import { IItem, IAffix, ItemType, SlotType, UniversalRank, Rarity } from '../../../types';
import { LoadoutSystem } from '../player/systems/LoadoutSystem';
import { ITEM_DEFINITIONS, ItemDefinition } from './data/itemDefinitions';
import { AFFIX_DEFINITIONS, AffixDefinition } from './data/affixDefinitions';
import { RANK_MULTIPLIERS, RARITY_MULTIPLIERS } from '../../constants';
import { SeededRNG, Rng } from '../../logic/rng/DeterministicRNG';
import { ResourceDef } from './data/resourceDefinitions';
import { MaterialPropertyType } from '../economy/types';

export class ItemFactory {

  /**
   * Mints a new Item.
   * @param targetRank - Optional force rank (e.g. for boss drops)
   * @param isIdentified - Whether the item stats are visible immediately (default: false)
   * @param rng - Deterministic stream for every roll (Wave 1.3). Callers derive
   *              it from a journaled key; the unkeyed fallback exists only so
   *              nothing crashes while legacy call sites migrate, and it logs.
   */
  static createItem(targetRank?: UniversalRank, isIdentified: boolean = false, rng?: SeededRNG, category?: 'weapon' | 'armor' | 'tool', baseId?: string): IItem {
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

    // 2. Roll Rarity
    const rarity = this.rollRarity(rng);

    // 3. Roll Quality
    const quality = (rng.next() * 0.4) - 0.2;

    // 4. Base Stats
    const baseStats = this.generateBaseStats(template, quality, rng);

    // 5. Affixes
    const affixes = this.generateAffixes(template, rarity, template.rank, rng);
    
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
    const fullName = this.constructName(template.universal_name, affixes, quality);

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
    if (template.cart) item.cartData = { ...template.cart };
    // 10C.2: requirements are stamped at mint — deterministic from rank and tags
    item.requirements = LoadoutSystem.requirementsFor({ ...item, requirements: undefined });

    return item;
  }

  /**
   * Wave 2.2: mint a RESOURCE item from its definition (not random gear).
   * Weight derives from material DENSITY (primordial: properties drive physics);
   * the def's hand-set weight is the fallback.
   */
  static createResourceItem(def: ResourceDef, rng: SeededRNG): IItem {
    const density = def.materialProps?.[MaterialPropertyType.DENSITY];
    const weight = density !== undefined ? parseFloat((density * 0.5).toFixed(1)) : (def.weight ?? 1.0);

    return {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: def.id,
      name: def.name,
      description: def.description || 'Harvested material. Can be refined.',
      type: def.type ?? ItemType.RESOURCE,
      slot: def.slot ?? ('NONE' as any),
      rank: def.rank ?? UniversalRank.F,
      rarity: def.rarity ?? Rarity.COMMON,
      quality: 100,
      level: 1,
      value: Math.max(1, Math.round(weight * 4 + (def.materialProps?.[MaterialPropertyType.HARDNESS] ?? 0))),
      itemPower: 0,
      tags: [...(def.tags ?? [])],
      affixes: [],
      dimensions: def.dimensions ?? { width: 1, height: 1 },
      weight,
      stats: { ...(def.stats ?? {}) },
      visuals: def.visuals ?? { modelId: 'resource', colorHex: '#9ca3af' },
      icon: def.icon ?? 'resource_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true
    };
  }

  /** Maps rank to a nominal player level requirement */
  private static getLevelForRank(rank: UniversalRank): number {
    const levels: Record<string, number> = {
      'F': 1, 'E': 10, 'D': 20, 'C': 30,
      'B': 40, 'A': 50, 'S': 60, 'SS': 70, 'SSS': 80
    };
    return levels[rank] || 1;
  }

  /** Inventory Tetris footprint derived from the item archetype */
  private static getDimensions(template: ItemDefinition): { width: number; height: number } {
    const tags = template.tags;
    if (template.cart) return { width: 2, height: 3 };       // a packed cart is a real burden
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
    const area = dims.width * dims.height;
    let density = 1.0; // kg per grid cell
    if (template.tags.includes('heavy') || template.tags.includes('plate')) density = 2.5;
    if (template.tags.includes('light') || template.tags.includes('cloth')) density = 0.5;
    if (template.tags.includes('tool')) density = 1.5;
    return parseFloat((area * density).toFixed(1));
  }

  // ... (Keep private helpers: rollRarity, generateBaseStats, generateAffixes, constructName, generateDescription, getColorForRarity same as before)
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

  private static generateAffixes(template: ItemDefinition, rarity: Rarity, itemRank: UniversalRank, rng: SeededRNG): IAffix[] {
    const affixes: IAffix[] = [];
    let prefixCount = 0;
    let suffixCount = 0;

    switch (rarity) {
      case Rarity.UNCOMMON: rng.next() > 0.5 ? prefixCount++ : suffixCount++; break;
      case Rarity.RARE: prefixCount = 1; suffixCount = 1; break;
      case Rarity.EPIC: prefixCount = 2; suffixCount = 2; break;
      case Rarity.LEGENDARY: prefixCount = 3; suffixCount = 3; break;
    }

    const pickAffix = (pool: AffixDefinition[], currentAffixes: IAffix[]): IAffix | null => {
      const valid = pool.filter(def => def.allowedTags.some(tag => template.tags.includes(tag)));
      const available = valid.filter(def => !currentAffixes.some(a => a.id === def.id));

      if (available.length === 0) return null;
      const choice = rng.pick(available);

      const rankMult = RANK_MULTIPLIERS[itemRank];
      const rolledStats: Record<string, number> = {};

      Object.entries(choice.statModifiers).forEach(([key, range]) => {
        const [min, max] = range;
        const baseVal = min + rng.next() * (max - min);
        rolledStats[key] = Math.round(baseVal * rankMult);
      });

      return {
        id: choice.id,
        name: choice.nameTemplate,
        type: choice.type,
        stats: rolledStats,
        tier: 1
      };
    };

    for (let i = 0; i < prefixCount; i++) {
      const aff = pickAffix(AFFIX_DEFINITIONS.prefixes, affixes);
      if (aff) affixes.push(aff);
    }
    for (let i = 0; i < suffixCount; i++) {
      const aff = pickAffix(AFFIX_DEFINITIONS.suffixes, affixes);
      if (aff) affixes.push(aff);
    }

    return affixes;
  }

  private static constructName(baseName: string, affixes: IAffix[], quality: number): string {
    const prefixes = affixes.filter(a => a.type === 'PREFIX').map(a => a.name);
    const suffixes = affixes.filter(a => a.type === 'SUFFIX').map(a => a.name);
    let name = baseName;

    if (quality < -0.15) name = `Broken ${name}`;
    else if (quality > 0.15) name = `Superior ${name}`;

    if (prefixes.length > 0) name = `${prefixes[0]} ${name}`;
    if (suffixes.length > 0) name = `${name} ${suffixes[0]}`;
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
      case Rarity.RARE: return '#0ea5e9';
      case Rarity.EPIC: return '#a855f7';
      case Rarity.LEGENDARY: return '#f59e0b';
      default: return '#fff';
    }
  }
}
import { IItem, IAffix, ItemType, UniversalRank, Rarity } from '../../types';
import { ITEM_DEFINITIONS, ItemDefinition } from '../data/itemDefinitions';
import { AFFIX_DEFINITIONS, AffixDefinition } from '../data/affixDefinitions';
import { RANK_MULTIPLIERS, RARITY_MULTIPLIERS } from '../constants';

export class ItemFactory {
  
  /**
   * Mints a new Item based on a random definition or specific ID.
   */
  static createItem(targetRank?: UniversalRank): IItem {
    // 1. Select Base Template
    const allBases = [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases];
    let template: ItemDefinition;
    
    if (targetRank) {
      const candidates = allBases.filter(b => b.rank === targetRank);
      template = candidates.length > 0 
        ? candidates[Math.floor(Math.random() * candidates.length)] 
        : allBases[Math.floor(Math.random() * allBases.length)];
    } else {
      template = allBases[Math.floor(Math.random() * allBases.length)];
    }

    // 2. Roll Rarity (Weighted)
    const rarity = this.rollRarity();

    // 3. Roll Quality (-0.20 to +0.20)
    // Quality impacts stats and IP
    const quality = (Math.random() * 0.4) - 0.2; // range: -0.2 to 0.2

    // 4. Base Stats Calculation
    // Base stats from template + Quality modifier
    const baseStats = this.generateBaseStats(template, quality);
    
    // 5. Affix Generation
    // Determine slots based on rarity
    const affixes = this.generateAffixes(template, rarity, template.rank);
    
    // 6. Merge Affix Stats into Base Stats
    const finalStats = { ...baseStats };
    affixes.forEach(affix => {
      Object.entries(affix.stats).forEach(([statKey, val]) => {
        finalStats[statKey] = (finalStats[statKey] || 0) + val;
      });
    });

    // 7. Calculate Final Item Power
    // Formula: Base * RankMult * RarityMult * (1 + Quality)
    const rankMult = RANK_MULTIPLIERS[template.rank];
    const rarityMult = RARITY_MULTIPLIERS[rarity];
    const finalIP = Math.floor(template.base_ip * rankMult * rarityMult * (1 + quality));

    // 8. Construct Name
    const fullName = this.constructName(template.universal_name, affixes, quality);

    return {
      id: crypto.randomUUID(),
      universalDefinitionId: template.id,
      name: fullName,
      description: this.generateDescription(rarity, quality),
      type: ItemType.GEAR,
      slot: template.slot,
      rank: template.rank,
      rarity: rarity,
      quality: quality,
      itemPower: finalIP,
      affixes: affixes,
      stats: {
        ...finalStats,
        durability: 100,
        maxDurability: 100,
        weight: 5 // Simplified
      },
      visuals: {
        modelId: template.tags.includes('weapon') ? 'weapon_mesh' : 'armor_mesh',
        colorHex: this.getColorForRarity(rarity)
      },
      history: {
        dropDate: Date.now(),
        killCount: 0
      }
    };
  }

  private static rollRarity(): Rarity {
    const rand = Math.random();
    if (rand > 0.99) return Rarity.LEGENDARY;
    if (rand > 0.95) return Rarity.EPIC;
    if (rand > 0.85) return Rarity.RARE;
    if (rand > 0.60) return Rarity.UNCOMMON;
    return Rarity.COMMON;
  }

  private static generateBaseStats(template: ItemDefinition, quality: number): Record<string, number> {
    const stats: Record<string, number> = {};
    
    template.implicits.forEach(imp => {
      let val = 0;
      if (imp.value !== undefined) {
        val = imp.value;
      } else if (imp.min !== undefined && imp.max !== undefined) {
        val = imp.min + Math.random() * (imp.max - imp.min);
      }
      
      // Apply quality to numerical stats (excluding boolean-like logic or small decimals like attack speed if desired, 
      // but for now applying to everything for simulation depth)
      // We floor/ceil based on positive/negative to keep integers clean where possible, 
      // but keep decimals for things like attack speed.
      if (val > 1) {
        stats[imp.stat] = Math.round(val * (1 + quality));
      } else {
        stats[imp.stat] = parseFloat((val * (1 + quality)).toFixed(2));
      }
    });
    
    return stats;
  }

  private static generateAffixes(template: ItemDefinition, rarity: Rarity, itemRank: UniversalRank): IAffix[] {
    const affixes: IAffix[] = [];
    
    // Define slot counts
    let prefixCount = 0;
    let suffixCount = 0;

    switch (rarity) {
      case Rarity.COMMON: break;
      case Rarity.UNCOMMON: 
        // 1 Prefix OR 1 Suffix (50/50), rare chance for both
        Math.random() > 0.5 ? prefixCount++ : suffixCount++;
        if (Math.random() > 0.8) { prefixCount = 1; suffixCount = 1; }
        break;
      case Rarity.RARE:
        // Min 2, Max 4
        prefixCount = 1 + (Math.random() > 0.5 ? 1 : 0);
        suffixCount = 1 + (Math.random() > 0.5 ? 1 : 0);
        break;
      case Rarity.EPIC:
        prefixCount = 2;
        suffixCount = 2;
        break;
      case Rarity.LEGENDARY:
        prefixCount = 3;
        suffixCount = 3;
        break;
      default: break;
    }

    // Helper to pick random valid affix
    const pickAffix = (pool: AffixDefinition[], currentAffixes: IAffix[]): IAffix | null => {
      // Filter by Tags
      const valid = pool.filter(def => 
        def.allowedTags.some(tag => template.tags.includes(tag))
      );
      // Filter duplicates (cannot have same affix definition twice)
      const available = valid.filter(def => !currentAffixes.some(a => a.id === def.id));
      
      if (available.length === 0) return null;
      const choice = available[Math.floor(Math.random() * available.length)];

      // Calculate Stats based on Rank
      // We use the Rank Multiplier to scale the raw values in the affix definition
      const rankMult = RANK_MULTIPLIERS[itemRank];
      const rolledStats: Record<string, number> = {};
      
      Object.entries(choice.statModifiers).forEach(([key, range]) => {
        const [min, max] = range;
        const baseVal = min + Math.random() * (max - min);
        // Scale by rank
        rolledStats[key] = Math.round(baseVal * rankMult);
      });

      return {
        id: choice.id,
        name: choice.nameTemplate,
        type: choice.type,
        stats: rolledStats,
        tier: 1 // Placeholder, would calculate tier based on roll closeness to max
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

    // Add Quality Prefix if extreme
    if (quality < -0.15) name = `Broken ${name}`;
    else if (quality > 0.15) name = `Superior ${name}`;

    // Add Magic Prefixes (Take the first one found for the name)
    if (prefixes.length > 0) {
      name = `${prefixes[0]} ${name}`;
    }

    // Add Magic Suffixes
    if (suffixes.length > 0) {
      name = `${name} ${suffixes[0]}`;
    }

    return name;
  }

  private static generateDescription(rarity: Rarity, quality: number): string {
    let desc = "";
    if (quality < -0.10) desc += "This item has seen better days. Rust pits the surface. ";
    else if (quality > 0.10) desc += "The craftsmanship is exceptional. It hums with faint energy. ";
    
    desc += `A ${rarity.toLowerCase()} artifact recovered from the simulation layer.`;
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
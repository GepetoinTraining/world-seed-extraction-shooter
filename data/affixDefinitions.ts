export interface AffixDefinition {
  id: string;
  nameTemplate: string; // "Sharp", "Fortified", "of the Bear"
  type: 'PREFIX' | 'SUFFIX';
  /** Tags this affix is compatible with (must match item tags) */
  allowedTags: string[];
  /** 
   * Stat ranges. 
   * Key: Stat ID
   * Value: [BaseMin, BaseMax] - scaled by Rank in Factory
   */
  statModifiers: Record<string, [number, number]>; 
}

export const AFFIX_DEFINITIONS: { prefixes: AffixDefinition[], suffixes: AffixDefinition[] } = {
  prefixes: [
    {
      id: 'pre_phys_dmg',
      nameTemplate: 'Sharp',
      type: 'PREFIX',
      allowedTags: ['blade', 'axe', 'projectile'],
      statModifiers: {
        'damage': [5, 10]
      }
    },
    {
      id: 'pre_spell_dmg',
      nameTemplate: 'Arcane',
      type: 'PREFIX',
      allowedTags: ['magic', 'staff'],
      statModifiers: {
        'damage': [5, 10]
      }
    },
    {
      id: 'pre_attack_speed',
      nameTemplate: 'Rapid',
      type: 'PREFIX',
      allowedTags: ['weapon'],
      statModifiers: {
        'attack_speed': [0.05, 0.10]
      }
    },
    {
      id: 'pre_armor_flat',
      nameTemplate: 'Reinforced',
      type: 'PREFIX',
      allowedTags: ['armor', 'defense'],
      statModifiers: {
        'defense': [10, 20]
      }
    },
    {
      id: 'pre_evasion',
      nameTemplate: 'Elusive',
      type: 'PREFIX',
      allowedTags: ['light', 'evasion'],
      statModifiers: {
        'evasion_rating': [20, 40]
      }
    }
  ],
  suffixes: [
    {
      id: 'suf_str',
      nameTemplate: 'of the Bear',
      type: 'SUFFIX',
      allowedTags: ['melee', 'armor'],
      statModifiers: {
        'strength': [2, 5]
      }
    },
    {
      id: 'suf_dex',
      nameTemplate: 'of the Falcon',
      type: 'SUFFIX',
      allowedTags: ['ranged', 'light', 'blade'],
      statModifiers: {
        'dexterity': [2, 5]
      }
    },
    {
      id: 'suf_int',
      nameTemplate: 'of the Owl',
      type: 'SUFFIX',
      allowedTags: ['magic', 'energy_shield'],
      statModifiers: {
        'intelligence': [2, 5]
      }
    },
    {
      id: 'suf_vit',
      nameTemplate: 'of the Whale',
      type: 'SUFFIX',
      allowedTags: ['armor', 'heavy'],
      statModifiers: {
        'max_health': [10, 30]
      }
    },
    {
      id: 'suf_acc',
      nameTemplate: 'of True Sight',
      type: 'SUFFIX',
      allowedTags: ['weapon', 'gloves'],
      statModifiers: {
        'accuracy_rating': [20, 50]
      }
    }
  ]
};
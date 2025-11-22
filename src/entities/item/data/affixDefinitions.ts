export interface AffixDefinition {
  id: string;
  nameTemplate: string; 
  type: 'PREFIX' | 'SUFFIX';
  allowedTags: string[];
  statModifiers: Record<string, [number, number]>; 
}

export const AFFIX_DEFINITIONS: { prefixes: AffixDefinition[], suffixes: AffixDefinition[] } = {
  prefixes: [
    {
      id: 'pre_phys_dmg',
      nameTemplate: 'Sharp',
      type: 'PREFIX',
      allowedTags: ['blade', 'axe', 'projectile', 'physical'],
      statModifiers: {
        'damage': [5, 10]
      }
    },
    {
      id: 'pre_spell_dmg',
      nameTemplate: 'Arcane',
      type: 'PREFIX',
      allowedTags: ['magic', 'staff', 'energy'],
      statModifiers: {
        'damage': [5, 10]
      }
    },
    {
      id: 'pre_attack_speed',
      nameTemplate: 'Rapid',
      type: 'PREFIX',
      allowedTags: ['weapon', 'offense'],
      statModifiers: {
        'attack_speed': [0.05, 0.10]
      }
    },
    {
      id: 'pre_armor_flat',
      nameTemplate: 'Reinforced',
      type: 'PREFIX',
      allowedTags: ['armor', 'defense', 'heavy'],
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
    },
    // --- NEW: UTILITY PREFIX ---
    {
      id: 'pre_capacity',
      nameTemplate: 'Hauling',
      type: 'PREFIX',
      allowedTags: ['armor', 'bag', 'generic'],
      statModifiers: {
        'carry_capacity': [5, 10]
      }
    },
    // --- NEW: STEALTH (PREFIX) ---
    {
      id: 'pre_stealth',
      nameTemplate: 'Silent',
      type: 'PREFIX',
      allowedTags: ['light', 'armor', 'boots', 'rogue'],
      statModifiers: {
        // Represents meters reduced from enemy aggro range
        'noise_reduction': [2, 5] 
      }
    }
  ],
  suffixes: [
    {
      id: 'suf_str',
      nameTemplate: 'of the Bear',
      type: 'SUFFIX',
      allowedTags: ['melee', 'armor', 'heavy', 'physical'],
      statModifiers: {
        'strength': [2, 5]
      }
    },
    {
      id: 'suf_dex',
      nameTemplate: 'of the Falcon',
      type: 'SUFFIX',
      allowedTags: ['ranged', 'light', 'blade', 'projectile'],
      statModifiers: {
        'dexterity': [2, 5]
      }
    },
    {
      id: 'suf_int',
      nameTemplate: 'of the Owl',
      type: 'SUFFIX',
      allowedTags: ['magic', 'energy_shield', 'energy'],
      statModifiers: {
        'intelligence': [2, 5]
      }
    },
    {
      id: 'suf_vit',
      nameTemplate: 'of the Whale',
      type: 'SUFFIX',
      allowedTags: ['armor', 'heavy', 'defense'],
      statModifiers: {
        'max_health': [10, 30]
      }
    },
    {
      id: 'suf_acc',
      nameTemplate: 'of True Sight',
      type: 'SUFFIX',
      allowedTags: ['weapon', 'gloves', 'ranged'],
      statModifiers: {
        'accuracy_rating': [20, 50]
      }
    },
    // --- NEW: LIGHT RADIUS ---
    {
      id: 'suf_light',
      nameTemplate: 'of Radiance',
      type: 'SUFFIX',
      allowedTags: ['magic', 'energy', 'heavy', 'accessory'], 
      statModifiers: {
        'light_radius': [1, 2] 
      }
    },
    // --- NEW: VACUUM (SUFFIX) ---
    {
      id: 'suf_vacuum',
      nameTemplate: 'of the Vortex',
      type: 'SUFFIX',
      allowedTags: ['magic', 'accessory', 'gloves'],
      statModifiers: {
        // Radius in meters to auto-loot currency
        'pickup_radius': [3, 6] 
      }
    }
  ]
};
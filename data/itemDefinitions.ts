import { UniversalRank, SlotType } from '../types';

export interface BaseStatDefinition {
  stat: string;
  min?: number;
  max?: number;
  value?: number;
}

export interface ItemDefinition {
  id: string;
  universal_name: string;
  rank: UniversalRank;
  base_ip: number;
  slot: SlotType;
  tags: string[];
  implicits: BaseStatDefinition[];
}

export interface ItemDatabase {
  meta: {
    version: string;
    description: string;
    quality_impact_on_ip: [number, number];
  };
  weapon_bases: ItemDefinition[];
  armor_bases: ItemDefinition[];
}

export const ITEM_DEFINITIONS: ItemDatabase = {
  "meta": {
    "version": "1.0.0",
    "description": "Base definitions for Weapons and Armor. These are the 'White' items before affixes are rolled.",
    "quality_impact_on_ip": [-0.20, 0.20]
  },
  "weapon_bases": [
    {
      "id": "wpn_sword_1h_t1",
      "universal_name": "Apprentice Blade",
      "rank": UniversalRank.F,
      "base_ip": 50,
      "slot": SlotType.MAIN_HAND,
      "tags": ["melee", "one_hand", "physical", "blade"],
      "implicits": [
        { "stat": "accuracy_rating", "min": 10, "max": 20 },
        { "stat": "attack_speed", "value": 1.2 }
      ]
    },
    {
      "id": "wpn_sword_1h_t2",
      "universal_name": "Soldier's Gladius",
      "rank": UniversalRank.E,
      "base_ip": 150,
      "slot": SlotType.MAIN_HAND,
      "tags": ["melee", "one_hand", "physical", "blade"],
      "implicits": [
        { "stat": "accuracy_rating", "min": 25, "max": 40 },
        { "stat": "attack_speed", "value": 1.25 }
      ]
    },
    {
      "id": "wpn_axe_2h_t1",
      "universal_name": "Woodsman's Axe",
      "rank": UniversalRank.F,
      "base_ip": 60,
      "slot": SlotType.MAIN_HAND,
      "tags": ["melee", "two_hand", "physical", "heavy"],
      "implicits": [
        { "stat": "stun_duration_multiplier", "min": 0.1, "max": 0.2 },
        { "stat": "attack_speed", "value": 0.9 }
      ]
    },
    {
      "id": "wpn_staff_t1",
      "universal_name": "Knotted Staff",
      "rank": UniversalRank.F,
      "base_ip": 55,
      "slot": SlotType.MAIN_HAND,
      "tags": ["caster", "two_hand", "magic", "energy"],
      "implicits": [
        { "stat": "block_chance", "value": 0.12 },
        { "stat": "energy_regen", "min": 2, "max": 4 }
      ]
    },
    {
      "id": "wpn_bow_t1",
      "universal_name": "Shortbow",
      "rank": UniversalRank.F,
      "base_ip": 50,
      "slot": SlotType.MAIN_HAND,
      "tags": ["ranged", "two_hand", "projectile"],
      "implicits": [
        { "stat": "movement_speed", "value": 0.05 },
        { "stat": "crit_chance", "min": 0.05, "max": 0.06 }
      ]
    },
    {
      "id": "wpn_dagger_t3",
      "universal_name": "Assassin's Kris",
      "rank": UniversalRank.D,
      "base_ip": 350,
      "slot": SlotType.MAIN_HAND,
      "tags": ["melee", "one_hand", "crit", "stealth"],
      "implicits": [
        { "stat": "crit_multiplier", "min": 0.30, "max": 0.40 },
        { "stat": "attack_speed", "value": 1.5 }
      ]
    }
  ],
  "armor_bases": [
    {
      "id": "arm_chest_heavy_t1",
      "universal_name": "Plate Mail",
      "rank": UniversalRank.F,
      "base_ip": 60,
      "slot": SlotType.CHEST,
      "tags": ["armor", "heavy", "defense"],
      "implicits": [
        { "stat": "movement_speed_penalty", "value": -0.05 },
        { "stat": "physical_reduction", "min": 0.05, "max": 0.08 }
      ]
    },
    {
      "id": "arm_chest_light_t1",
      "universal_name": "Leather Tunic",
      "rank": UniversalRank.F,
      "base_ip": 50,
      "slot": SlotType.CHEST,
      "tags": ["armor", "light", "evasion"],
      "implicits": [
        { "stat": "evasion_rating", "min": 20, "max": 35 }
      ]
    },
    {
      "id": "arm_chest_magic_t1",
      "universal_name": "Silk Robe",
      "rank": UniversalRank.F,
      "base_ip": 45,
      "slot": SlotType.CHEST,
      "tags": ["armor", "magic", "energy_shield"],
      "implicits": [
        { "stat": "energy_shield", "min": 10, "max": 15 }
      ]
    },
    {
      "id": "arm_head_heavy_t2",
      "universal_name": "Great Helm",
      "rank": UniversalRank.E,
      "base_ip": 120,
      "slot": SlotType.HEAD,
      "tags": ["armor", "heavy"],
      "implicits": [
        { "stat": "stun_recovery", "min": 0.10, "max": 0.15 }
      ]
    },
    {
      "id": "arm_boots_generic_t1",
      "universal_name": "Worn Boots",
      "rank": UniversalRank.F,
      "base_ip": 30,
      "slot": SlotType.FEET,
      "tags": ["armor", "generic"],
      "implicits": [
        { "stat": "movement_speed", "min": 0.10, "max": 0.10 }
      ]
    },
    {
      "id": "arm_gloves_generic_t3",
      "universal_name": "Gripped Gauntlets",
      "rank": UniversalRank.D,
      "base_ip": 310,
      "slot": SlotType.OFF_HAND,
      "tags": ["armor", "generic", "offense"],
      "implicits": [
        { "stat": "attack_speed_global", "min": 0.05, "max": 0.08 }
      ]
    }
  ]
};
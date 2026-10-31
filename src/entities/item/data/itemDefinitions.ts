import { UniversalRank, SlotType } from '../../../../types';

// --- MISSING INTERFACES RESTORED ---
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
  // Wave 10C (additive): the belt-and-pouch law and the cart
  pouch?: { accepts: string[]; capacity: number };   // D17: what it stacks, and how much
  belt?: { pouchSlots: number };                     // D17: slots the belt opens
  cart?: { gridW: number; gridH: number };           // D16: the bed a packed cart unfolds to
}
// -----------------------------------

export interface ItemDatabase {
  meta: {
    version: string;
    description: string;
    quality_impact_on_ip: [number, number];
  };
  weapon_bases: ItemDefinition[];
  armor_bases: ItemDefinition[];
  tool_bases: ItemDefinition[];
}

/**
 * Wave 10D: gear that can only be MADE, never found on a shelf or in a chest.
 * These bases never join the random mint pools; their item power comes from
 * the chain (CompositionSystem.powerBudget), not from base_ip — base_ip here
 * is only the fallback for an item minted with no composition at all.
 */
export const CRAFTED_GEAR_BASES: ItemDefinition[] = [
  {
    id: 'wpn_improvised_club',
    universal_name: 'Stonebound Club',
    rank: UniversalRank.F,
    base_ip: 10,
    slot: SlotType.MAIN_HAND,
    tags: ['melee', 'one_hand', 'physical', 'improvised'],
    implicits: [
      { stat: 'attack_speed', value: 0.8 }
    ]
  },
  {
    id: 'wpn_iron_maul_t1',
    universal_name: 'Iron-Headed Maul',
    rank: UniversalRank.E,
    base_ip: 60,
    slot: SlotType.MAIN_HAND,
    tags: ['melee', 'two_hand', 'physical', 'heavy'],
    implicits: [
      { stat: 'stun_duration_multiplier', min: 0.10, max: 0.15 },
      { stat: 'attack_speed', value: 0.85 }
    ]
  }
];

export const ITEM_DEFINITIONS: ItemDatabase = {
  "meta": {
    "version": "1.1.0",
    "description": "Includes Field Tools.",
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
    },
    // --- Wave 10C: the slot tree gets something to wear on every branch ---
    {
      "id": "arm_legs_padded_t1",
      "universal_name": "Padded Greaves",
      "rank": UniversalRank.F,
      "base_ip": 35,
      "slot": SlotType.LEGS,
      "tags": ["armor", "light"],
      "implicits": [
        { "stat": "evasion_rating", "min": 5, "max": 12 }
      ]
    },
    {
      "id": "arm_shoulder_t1",
      "universal_name": "Mantle", // themed per genre at the shelf (D17's tree; see themedShoulderName)
      "rank": UniversalRank.F,
      "base_ip": 30,
      "slot": SlotType.SHOULDER,
      "tags": ["armor", "shoulder"],
      "implicits": [
        { "stat": "physical_reduction", "min": 0.01, "max": 0.03 }
      ]
    },
    {
      "id": "eye_glasses_t1",
      "universal_name": "Wire-Rim Glasses",
      "rank": UniversalRank.F,
      "base_ip": 25,
      "slot": SlotType.EYES,
      "tags": ["utility", "glass", "tech"], // D17: the natural home for identify/scan affixes (10E)
      "implicits": [
        { "stat": "field_analysis_speed", "min": 0.05, "max": 0.12 }
      ]
    },
    {
      "id": "acc_necklace_t1",
      "universal_name": "Chain Pendant",
      "rank": UniversalRank.F,
      "base_ip": 20,
      "slot": SlotType.NECKLACE,
      "tags": ["jewelry"],
      "implicits": [
        { "stat": "luck_find_rarity", "min": 0.01, "max": 0.03 }
      ]
    },
    {
      "id": "acc_earring_t1",
      "universal_name": "Iron Stud",
      "rank": UniversalRank.F,
      "base_ip": 20,
      "slot": SlotType.EARRING,
      "tags": ["jewelry"],
      "implicits": [
        { "stat": "evasion_rating", "min": 1, "max": 4 }
      ]
    },
    {
      "id": "acc_ring_signet_t1",
      "universal_name": "Signet Ring",
      "rank": UniversalRank.F,
      "base_ip": 20,
      "slot": SlotType.RING,
      "tags": ["jewelry", "ring"],
      "implicits": [
        { "stat": "crit_chance", "min": 0.01, "max": 0.02 }
      ]
    },
    {
      "id": "quiver_hide_t1",
      "universal_name": "Hide Quiver",
      "rank": UniversalRank.F,
      "base_ip": 25,
      "slot": SlotType.QUIVER,
      "tags": ["quiver", "ranged"],
      "implicits": [
        { "stat": "reload_speed", "min": 0.03, "max": 0.08 }
      ]
    },
    {
      "id": "bag_satchel_t1",
      "universal_name": "Field Satchel",
      "rank": UniversalRank.F,
      "base_ip": 25,
      "slot": SlotType.BAG,
      "tags": ["bag"],
      "implicits": [
        { "stat": "carry_bonus_kg", "value": 10 } // bags extend capacity (10C.3)
      ]
    },
    {
      "id": "belt_canvas_t1",
      "universal_name": "Canvas Belt",
      "rank": UniversalRank.F,
      "base_ip": 20,
      "slot": SlotType.BELT,
      "tags": ["belt"],
      "implicits": [],
      "belt": { "pouchSlots": 2 }
    }
  ],
  "tool_bases": [
    {
      "id": "tool_axe_field_t1",
      "universal_name": "Field Axe",
      "rank": UniversalRank.F,
      "base_ip": 15,
      "slot": SlotType.ACCESSORY,
      "tags": ["tool", "axe", "chopping"],
      "implicits": [
        { "stat": "chopping_power", "min": 12, "max": 18 }
      ]
    },
    {
      "id": "tool_pick_rusty_t1",
      "universal_name": "Rusty Pick",
      "rank": UniversalRank.F,
      "base_ip": 15,
      "slot": SlotType.ACCESSORY,
      "tags": ["tool", "pickaxe", "mining"],
      "implicits": [
        { "stat": "mining_power", "min": 12, "max": 18 }
      ]
    },
    {
      "id": "tool_pick_tempered_t3",
      "universal_name": "Tempered Pick",
      "rank": UniversalRank.D,
      "base_ip": 200,
      "slot": SlotType.ACCESSORY,
      "tags": ["tool", "pickaxe", "mining"],
      "implicits": [
        { "stat": "mining_power", "min": 65, "max": 80 }
      ]
    },
    {
      "id": "tool_scanner_t1",
      "universal_name": "Handheld Scanner",
      "rank": UniversalRank.F,
      "base_ip": 10,
      "slot": SlotType.ACCESSORY, 
      "tags": ["tool", "tech", "utility"],
      "implicits": [
        { "stat": "field_analysis_speed", "min": 0.10, "max": 0.20 } 
      ]
    },
    {
      "id": "tool_lens_t2",
      "universal_name": "Aetheric Lens",
      "rank": UniversalRank.E,
      "base_ip": 100,
      "slot": SlotType.ACCESSORY,
      "tags": ["tool", "magic", "utility"],
      "implicits": [
        { "stat": "field_analysis_speed", "min": 0.30, "max": 0.50 },
        { "stat": "luck_find_rarity", "value": 0.05 }
      ]
    },
    // --- Wave 10C: the belt-and-pouch law (D17) and the cart (D16) ---
    {
      "id": "pouch_vial_t1",
      "universal_name": "Vial Pouch",
      "rank": UniversalRank.F,
      "base_ip": 10,
      "slot": SlotType.POUCH,
      "tags": ["pouch"],
      "implicits": [],
      "pouch": { "accepts": ["consumable"], "capacity": 3 }
    },
    {
      "id": "pouch_scroll_t1",
      "universal_name": "Scroll Tube",
      "rank": UniversalRank.F,
      "base_ip": 10,
      "slot": SlotType.POUCH,
      "tags": ["pouch"],
      "implicits": [],
      "pouch": { "accepts": ["lore", "document", "scroll"], "capacity": 3 }
    },
    {
      "id": "cart_field_t1",
      "universal_name": "Field Cart (Packed)",
      "rank": UniversalRank.F,
      "base_ip": 40,
      "slot": SlotType.NONE,
      "tags": ["cart", "heavy"],
      "implicits": [],
      "cart": { "gridW": 10, "gridH": 8 }
    }
  ]
};
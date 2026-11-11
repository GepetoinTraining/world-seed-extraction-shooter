import { UniversalRank, SlotType } from '../../../types';

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
  /** D16: the bed a packed cart unfolds to; the interface pass: its size word, own weight and the load it bears (ThemeFormula.cartNumbers). */
  cart?: { gridW: number; gridH: number; size?: string; weight?: number; bears?: number };
  /** Layer 3: an ability this base carries, and when it fires. */
  carries?: { ability: string; trigger: string };
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
 * Gear that can only be made, from every installed theme (D53). Empty until a
 * theme is installed: no item base is written in code. See ContentRegistry.
 */
export const CRAFTED_GEAR_BASES: ItemDefinition[] = [];

export const ITEM_DEFINITIONS: ItemDatabase = {
  meta: { version: '2.0.0', description: 'What the installed themes hold.', quality_impact_on_ip: [-0.20, 0.20] },
  weapon_bases: [],
  armor_bases: [],
  tool_bases: []
};

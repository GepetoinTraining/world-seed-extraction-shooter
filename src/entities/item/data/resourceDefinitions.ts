import { UniversalRank, Rarity, ItemType, SlotType, IItem, IHarvestConfig } from '../../../../types';
import { MaterialPropertyType } from '../../economy/types';

/**
 * EXTRACTABLES TAXONOMY (Wave 2.2) — README item 3a, in full.
 *
 * Flora:    grains (grassy seeds), shrubs (berries), fruit (food & poison),
 *           trees (logs + saplings)
 * Minerals: ore veins, sand (glass), rocks, pebbles
 *
 * Material properties drive physics (primordial pattern):
 *   weight per unit = DENSITY * 0.5 kg
 * Harvest gating: empty requiredToolTags = bare hands; otherwise the
 * InteractionEngine demands a tool with the tag and enough power.
 *
 * `uses` is how many times a world node yields before depleting.
 * `regrowMs` set = flora: the node comes back. Unset = mineral: gone forever.
 */

export type ResourceDef = Partial<IItem> & {
  id: string;
  name: string;
  harvestConfig?: IHarvestConfig;
  materialProps?: Partial<Record<MaterialPropertyType, number>>;
  uses?: number;        // node uses before depletion (default 1)
  regrowMs?: number;    // flora regrow time; minerals never regrow
  yieldPerUse?: [number, number]; // min/max items per harvest
  /** D53: which kinds of ground it lies on. */
  habitat?: string[];
  /** D53: the theme it came from. */
  themeId?: string;
  /** D27: a station a web batch added: what it asks of a room, and what it opens. */
  stationMinArea?: number;
  stationFunction?: 'WORKSHOP' | 'VENDOR' | 'SCRIBE';
};

/** Everything the installed themes let a person gather or use (D53). Empty until one is installed. */
export const RESOURCE_DEFINITIONS: Record<string, ResourceDef> = {};

/** What lies on each kind of ground, across the installed themes. A world still reads only its own. */
export const BIOME_RESOURCES: Record<string, string[]> = {};

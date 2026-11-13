/**
 * THE HUB'S FOUR BASE STATIONS (CP14, family 2 of the content port, 2026-11-13).
 *
 * The hub names these four by id: a WORKSHOP shell mints its bench and a VENDOR shell its counter when construction
 * completes (`SHELL_STATION`), a room asks each for its area and opens what it does (`STATION_MIN_AREA`,
 * `STATION_FUNCTION`), the room presets place them, and `ownerHasBench`, the hub's tech and the sourcing audit look
 * for the bench. Until now they were defined only in the bars' fixture, so in the game a finished shell minted its
 * station from a definition nothing wrote. They are the game's own acts' places, as the shell is, and are defined
 * here; a theme's stations are its own (`stn_<theme>_<key>`). Read through `stationDefOf` (room.ts), beside what a
 * theme fills, and never put ahead of a theme's goods in the shared registry.
 *
 * Their names are today's words, the floor: a hub's own words for them ride the hub's ask when CONTENT_PORT's CP2 is
 * built. Moved here word for word from the bars' fixture, which now installs these very definitions.
 */

import { ItemType, Rarity, UniversalRank } from '../../types';
import { MaterialPropertyType } from '../economy/types';
import type { ResourceDef } from '../item/data/resourceDefinitions';

export type BaseStationId = 'stn_bench' | 'stn_counter' | 'stn_table' | 'stn_scribe';

export const BASE_STATIONS: Record<BaseStationId, ResourceDef> = {
  // Wave 10 (D8/D9): stations are items. A WORKSHOP shell mints its bench and a VENDOR shell mints its counter when
  // construction completes; tables are crafted, carried, placed and sold like anything else.
  stn_bench: {
    id: 'stn_bench', name: 'Work Bench', type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 12.0, dimensions: { width: 2, height: 1 }, icon: '🔨',
    visuals: { modelId: 'bench', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 30 },
    tags: ['crafted', 'station', 'wood', 'heavy']
  },
  stn_counter: {
    id: 'stn_counter', name: 'Shop Counter', type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 14.0, dimensions: { width: 3, height: 1 }, icon: '🪙',
    visuals: { modelId: 'counter', colorHex: '#ffd700' },
    materialProps: { [MaterialPropertyType.DENSITY]: 8, [MaterialPropertyType.HARDNESS]: 25 },
    tags: ['crafted', 'station', 'wood', 'heavy']
  },
  stn_table: {
    id: 'stn_table', name: 'Joined Table', type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.COMMON,
    weight: 8.0, dimensions: { width: 2, height: 2 }, icon: '🪑',
    visuals: { modelId: 'table', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 5, [MaterialPropertyType.HARDNESS]: 20 },
    tags: ['crafted', 'station', 'wood']
  },
  // Wave 10B (D12/D14): the scribe's table is the generalist station plans are minted and copied at.
  stn_scribe: {
    id: 'stn_scribe', name: "Scribe's Table", type: ItemType.STRUCTURE,
    rank: UniversalRank.F, rarity: Rarity.UNCOMMON,
    weight: 9.0, dimensions: { width: 2, height: 1 }, icon: 'scribe_icon',
    visuals: { modelId: 'scribe', colorHex: '#a16207' },
    materialProps: { [MaterialPropertyType.DENSITY]: 6, [MaterialPropertyType.HARDNESS]: 22 },
    tags: ['crafted', 'station', 'wood']
  }
};

/**
 * EVERY STAT A CARD CAN SHOW HAS A WORD (GV42). Found by the coordinator's pre-merge run: a stat with no word of its own
 * reached the card as its key in plain words, seen as "+1 craft speed pct". Every stat the pack, the gear law and the
 * affixes can put on a card is said in StatWords, with its percent sign where it is one. Words only.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { STAT_SCALE } from '../shared/logic/theme/ThemeFormula';
import { RATING_STATS, UNIT_STATS } from '../shared/constants';
import { GEAR_KINDS, PASSIVE_STATS } from '../shared/logic/theme/ThemeTypes';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { ITEM_DEFINITIONS } from '../shared/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { hasStatWord, statIsPercent, statWord } from '../shared/logic/systems/StatWords';
import { inspectItem } from '../src/render/atoms/inspect';
import { usePlayerStore } from '../src/entities/player/store';

installShippedThemes();

/** Every stat a card can be asked to say: the gear law's scale and lines, the readings, the passives, the bases and the pack's affixes. */
const cardStats = (): string[] => {
  const keys = new Set<string>([...Object.keys(STAT_SCALE), ...RATING_STATS, ...UNIT_STATS, ...PASSIVE_STATS]);
  for (const k of GEAR_KINDS) for (let s = 0; s < 3; s++) for (const l of PieceLaw.nativeLines(k as never, s)) keys.add(l.stat);
  const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
  for (const b of [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases,
    ...compiled.items.weapon_bases, ...compiled.items.armor_bases, ...compiled.items.tool_bases]) for (const i of (b as { implicits?: { stat: string }[] }).implicits ?? []) keys.add(i.stat);
  for (const r of Object.values(RESOURCE_DEFINITIONS)) for (const k of Object.keys(r.stats ?? {})) keys.add(k);
  for (const a of FIRST_THEME_PACK.affixes ?? []) for (const g of (a as { gives?: { stat: string }[] }).gives ?? []) keys.add(g.stat);
  return [...keys].sort();
};

describe('GV42: every stat a card can show is said in a word of its own', () => {
  it('each has its own word, with no code in it', () => {
    const missing = cardStats().filter(k => !hasStatWord(k));
    expect(missing).toEqual([]);
    for (const k of cardStats()) {
      expect(statWord(k), k).not.toMatch(/_|\bpct\b|multipl|\brating|\bglobal\b|\bregen\b/i);
    }
  });

  it('a stat counted in hundredths says its percent sign on the card', () => {
    expect(statIsPercent('craft_speed_pct')).toBe(true);
    expect(statIsPercent('upkeep_discount_pct')).toBe(true);
    expect(statIsPercent('defense')).toBe(false);
    const piece: IItem = {
      id: 'itm_room', universalDefinitionId: 'none', name: 'Bench Lamp', description: '', type: ItemType.GEAR, slot: SlotType.NONE as never,
      rank: UniversalRank.F, rarity: Rarity.COMMON, level: 1, value: 1, itemPower: 1, weight: 1, dimensions: { width: 1, height: 1 },
      stats: { craft_speed_pct: 1 }, affixes: [], tags: []
    } as never;
    const said = inspectItem(piece, usePlayerStore.getState().player).rows.map(r => r.join(' ')).join(' | ');
    expect(said).toMatch(/1%/);
    expect(said).not.toMatch(/craft speed pct/);
  });
});

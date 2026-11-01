/**
 * A WORLD DEED (D72, D80): what minting a world spends. Pedro: "to mint it'll cost a deed,
 * that's the thing we'll add during character generation, everyone gets one deed for free
 * to mint their pocket world where they farm what they want, the rest are exchanged, or
 * played online, or they need to find a new deed."
 *
 * It is not DeedSystem's Land Deed, which is a paper for a lot in a hub. This one names a
 * size and nothing else: the sky is chosen at the mint, the cadence follows the size, and
 * no holder is written on it, so it changes hands like any other item.
 *
 * Pure: no store here, so the loot table and the player's birth can both read it.
 */

import { IItem, IPlayer, ItemType, Rarity, SlotType, UniversalRank } from '../../../types';
import { CompositionSystem } from '../economy/CompositionSystem';
import { Rng } from '../rng/DeterministicRNG';

/** D80: the free deed is small. */
export const FREE_DEED_SIZE = 16;
/** What can be minted today. The biggest world waits until a hub can be founded in one (D80). */
export const WORLD_DEED_SIZES: readonly number[] = [16, 32, 64];

const RANK_ORDER: readonly UniversalRank[] = [
  UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C,
  UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS
];

/** Worth a small world's share of a birthright. A guess until Wave 12. */
const SMALL_DEED_VALUE = 150;
/** The chance a rank F body carries one, and how fast it climbs with rank. Guesses until Wave 12. */
const FOUND_BASE_CHANCE = 0.0002;
const FOUND_RANK_GROWTH = 1.8;
const FOUND_BOSS_FACTOR = 10;
const FOUND_WORLD_BOSS_FACTOR = 40;

export const isWorldDeed = (item: IItem): boolean => item.type === ItemType.WORLD_DEED && !!item.worldDeedData;

const sizeWord = (size: number): string => {
  const at = WORLD_DEED_SIZES.indexOf(size);
  return ['Small', 'Medium', 'Large'][at] ?? `${size}-sector`;
};

export class WorldDeed {

  static offered(size: number): boolean {
    return WORLD_DEED_SIZES.includes(size);
  }

  static say(size: number): string {
    return `${sizeWord(size)}, ${size}×${size} sectors`;
  }

  static mint({ size, source, key }: { size: number; source: 'FREE' | 'FOUND'; key: string }): IItem {
    const rng = Rng.fromKey(`world_deed:${key}`);
    const value = Math.round(SMALL_DEED_VALUE * (size / FREE_DEED_SIZE) ** 2);
    return {
      id: `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`,
      universalDefinitionId: 'world_deed',
      name: `WORLD DEED: ${sizeWord(size).toUpperCase()}`,
      description: `It mints one world of ${size}×${size} sectors. The bank does not ask who holds it, and it is spent in the signing.`,
      type: ItemType.WORLD_DEED,
      slot: SlotType.NONE,
      rank: UniversalRank.F,
      rarity: size === FREE_DEED_SIZE ? Rarity.UNCOMMON : Rarity.RARE,
      level: 1,
      quality: 0, // the one scale: 0 means no roll was taken
      value,
      itemPower: 0,
      tags: ['document'],
      affixes: [],
      dimensions: { width: 1, height: 2 },
      weight: 0.1,
      stats: {},
      visuals: { modelId: 'world_deed', colorHex: '#e7e5e4' },
      icon: 'world_deed_icon',
      history: { dropDate: 0, killCount: 0 },
      isIdentified: true,
      // Every item knows its atoms (10D). The world rolled this one, as it rolls anything at genesis.
      composition: CompositionSystem.root({ id: 'world_deed', name: 'World Deed' }, 'WORLD'),
      worldDeedData: { size, source }
    };
  }

  /** Everyone gets one, keyed by who it was given to. */
  static free(uid: string): IItem {
    return this.mint({ size: FREE_DEED_SIZE, source: 'FREE', key: `free:${uid}` });
  }

  static held(player: Pick<IPlayer, 'bank'>): IItem[] {
    return (player.bank.stashTabs[0]?.items ?? []).filter(isWorldDeed);
  }

  /** An existing character receives it once, so nobody is locked out. The same reference when there is nothing to do. */
  static migrate(player: IPlayer): IPlayer {
    if (player.freeDeedGiven) return player;
    return {
      ...player,
      freeDeedGiven: true,
      bank: {
        ...player.bank,
        stashTabs: player.bank.stashTabs.length > 0
          ? player.bank.stashTabs.map((tab, i) => (i === 0 ? { ...tab, items: [...tab.items, this.free(player.id)] } : tab))
          : [{ name: 'CACHE_01', items: [this.free(player.id)] }]
      }
    };
  }

  /**
   * A deed can be found. Its own keyed stream, so looking for one moves no other roll in
   * a drop. Rare on small things and likelier on what is hard to bring down, and it never
   * names a size the mint cannot offer.
   */
  static foundOn(mob: { rank: UniversalRank; tags: string[] }, magicFind: number, rollKey: string | undefined): IItem[] {
    if (!rollKey) return []; // an unkeyed roll could never be replayed
    const rng = Rng.fromKey(`${rollKey}:world_deed`);
    const rank = Math.max(0, RANK_ORDER.indexOf(mob.rank));
    const factor = mob.tags.includes('god') || mob.tags.includes('titan') ? FOUND_WORLD_BOSS_FACTOR : mob.tags.includes('boss') ? FOUND_BOSS_FACTOR : 1;
    const chance = FOUND_BASE_CHANCE * FOUND_RANK_GROWTH ** rank * factor * magicFind;
    if (rng.next() >= chance) return [];
    // The harder the body, the likelier a larger deed; a curve, not a table of ranks
    const reach = (rank + 1) / RANK_ORDER.length;
    const at = Math.min(WORLD_DEED_SIZES.length - 1, Math.floor(rng.next() * reach * WORLD_DEED_SIZES.length * 1.5));
    return [this.mint({ size: WORLD_DEED_SIZES[at], source: 'FOUND', key: `found:${rollKey}` })];
  }
}

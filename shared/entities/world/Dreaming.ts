/**
 * THE DREAMING (Wave 10E.3)
 *
 * "Maintenance log, cycle 40,221: the Seed is still dreaming. We have stopped
 * asking what about." — the lore wrote this law first.
 *
 * A world populates from the affix banks during recon: what its chests hold,
 * what its garrisons drop, what its materials carry — themed to each biome,
 * deterministically from (seed, content-pack version). The version is pinned
 * at the world's mint, so no later batch ever changes an existing world. A
 * world with no pinned pack (minted before the banks) dreams nothing new: its
 * rolls keep the purged legacy pool, forever.
 *
 * Positions were already pure functions of the seed (Wave 8); the Dreaming is
 * the CONTENTS layer on top — it never moves an entity, so the golden vectors
 * stand untouched.
 */

import { IAffix, IBankedAffix, IContentPack } from '../../types';
import { AffixDefinition } from '../item/data/affixDefinitions';
import { AffixBank } from '../../logic/content/AffixBank';
import { SHELF_STATE } from '../../logic/theme/shelf';
import { Rng, SeededRNG } from '../../logic/rng/DeterministicRNG';

/** What a roll pool may hold: the legacy table's shape, or a banked entry
 * straight from a pack (statModifiers absent = name-only, acting as nothing). */
export type RollableAffix = AffixDefinition | IBankedAffix;

export interface IAffixPool {
  prefixes: RollableAffix[];
  suffixes: RollableAffix[];
}

/** Share of dreamed harvests that carry a banked material affix. */
const MATERIAL_DREAM_CHANCE = 0.08;
const SECTOR_DREAM_NAMES = 3;

interface ActiveDream {
  seed: string;
  pack: IContentPack;
}

let activeDream: ActiveDream | null = null;

export class DreamingSystem {

  // ---------------------------------------------------------------------
  // THE ACTIVE WORLD: set at deploy, cleared at exit (like generationContext)
  // ---------------------------------------------------------------------

  static activate(seed: string, pack: IContentPack | null): void {
    activeDream = pack ? { seed, pack } : null;
  }

  static deactivate(): void {
    activeDream = null;
  }

  static active(): ActiveDream | null {
    return activeDream;
  }

  // ---------------------------------------------------------------------
  // THE POOLS: a biome dreams its own theme, plus GLOBAL and CART
  // ---------------------------------------------------------------------

  static entriesFor(pack: IContentPack, biome: string): IBankedAffix[] {
    return pack.entries
      .filter(e => e.theme === biome || e.theme === 'GLOBAL' || e.theme === 'CART')
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  static poolFor(pack: IContentPack, biome: string): { prefixes: IBankedAffix[]; suffixes: IBankedAffix[] } {
    const entries = this.entriesFor(pack, biome);
    return {
      prefixes: entries.filter(e => e.type === 'PREFIX'),
      suffixes: entries.filter(e => e.type === 'SUFFIX')
    };
  }

  /** A banked entry in the roll pool's shape. Name-only entries act as nothing. */
  static toAffixDefinition(e: IBankedAffix): AffixDefinition {
    return {
      id: e.id,
      nameTemplate: e.name,
      type: e.type,
      allowedTags: [...e.allowedTags],
      statModifiers: { ...(e.statModifiers ?? {}) },
      tier: e.tier,
      ...(e.gives ? { gives: e.gives.map(g => ({ ...g })) } : {})
    };
  }

  /** The gear roll pool for a biome of the active (or given) dream. */
  static rollPoolFor(pack: IContentPack, biome: string): IAffixPool {
    const { prefixes, suffixes } = this.poolFor(pack, biome);
    return {
      prefixes: prefixes.map(e => this.toAffixDefinition(e)),
      suffixes: suffixes.map(e => this.toAffixDefinition(e))
    };
  }

  /**
   * The hub's shelf stands on the bank's LATEST law: the purged legacy pool
   * plus the current pack's GLOBAL and CART entries. Stock is day-keyed and
   * rolls over at midnight anyway; the one-way door protects WORLDS, and a new
   * batch reaching tomorrow's shelf is exactly how the game grows.
   */
  static hubShelfPool(): IAffixPool {
    const legacy = AffixBank.legacyPool();
    // D49: a theme's prefixes and suffixes reach the shelf only once this hub has unlocked magic
    const extra = AffixBank.current().entries
      .filter(e => e.theme === 'GLOBAL' || e.theme === 'CART')
      .filter(e => !e.themeId || SHELF_STATE.magicUnlocked);
    return {
      prefixes: [...legacy.prefixes, ...extra.filter(e => e.type === 'PREFIX').map(e => this.toAffixDefinition(e))],
      suffixes: [...legacy.suffixes, ...extra.filter(e => e.type === 'SUFFIX').map(e => this.toAffixDefinition(e))]
    };
  }

  // ---------------------------------------------------------------------
  // MATERIALS DREAM TOO: a harvest can carry a banked affix
  // ---------------------------------------------------------------------

  /**
   * The affix a dreamed harvest carries, or null for the common case. Pure in
   * the rng stream: the same keyed stream gives the same answer forever.
   */
  static materialAffixFor(pack: IContentPack, biome: string, _defId: string, rng: SeededRNG): IAffix | null {
    const candidates = this.entriesFor(pack, biome)
      .filter(e => e.theme !== 'CART' && e.allowedTags.includes('resource'));
    if (candidates.length === 0) return null;
    if (rng.next() >= MATERIAL_DREAM_CHANCE) return null;
    const entry = rng.pick(candidates);
    const stats: Record<string, number> = {};
    for (const [stat, [min, max]] of Object.entries(entry.statModifiers ?? {})) {
      const value = min + rng.next() * (max - min);
      stats[stat] = Math.abs(value) < 1 ? parseFloat(value.toFixed(2)) : Math.round(value);
    }
    return { id: entry.id, name: entry.name, type: entry.type, stats, tier: entry.tier };
  }

  // ---------------------------------------------------------------------
  // THE SURVEY SAYS THE DREAM: a sector names its themed signatures
  // ---------------------------------------------------------------------

  /** What the deep scan reads of a sector's dream: a few themed names, fixed by (seed, version, place). */
  static sectorDream(seed: string, pack: IContentPack, biome: string, sx: number, sy: number): string[] {
    const entries = this.entriesFor(pack, biome).filter(e => e.theme !== 'CART');
    if (entries.length === 0) return [];
    const rng = Rng.fromKey(`${seed}:dream:v${pack.version}:sector:${sx},${sy}`);
    const names: string[] = [];
    const pool = [...entries];
    const count = Math.min(SECTOR_DREAM_NAMES, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = rng.int(0, pool.length);
      names.push(pool[idx].name);
      pool.splice(idx, 1);
    }
    return names;
  }
}

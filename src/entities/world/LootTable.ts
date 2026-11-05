/**
 * LOOT TABLE SYSTEM
 * Generates loot based on mob definitions, player magic find, and world state
 * 
 * DESIGN PHILOSOPHY:
 * - High drop rates for UNIDENTIFIED items (keeps inventory decisions interesting)
 * - Low drop rates for DEEDS (jackpot moments)
 * - Bosses always drop SOMETHING good
 */

import { ItemFactory } from '../item/ItemFactory';
import { SeededRNG, Rng } from '../../logic/rng/DeterministicRNG';
import { IItem, UniversalRank, Rarity } from '../../../types';
import { IMobDefinition } from '../mob/types';
import { DeedSystem } from '../../logic/systems/DeedSystem';
import { WorldDeed } from '../../logic/systems/WorldDeed';
import { BiomeType } from './types';
import { DreamingSystem, IAffixPool } from './Dreaming';
import { EntityType, IWorldEntity } from './types';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { JUNK_CHANCE } from '../../logic/theme/ThemeFormula';
import { LootBook } from '../../logic/theme/LootBook';
import { IDropLine, LootLaw, lootItemsOf } from '../../logic/theme/LootLaw';
import { ContentRegistry } from '../../logic/theme/ContentRegistry';

/** A drop rolled on a theme's table (LootLaw.ts): which table, at what rank, what it said. The journal keeps it, so a hub can roll it again (D134). */
export interface ITableRoll { table: string; rank: string; lines: IDropLine[] }

/** Wave 10E: the pool this drop rolls from — the pinned bank's biome pool in a
 * dreamed world, the purged legacy pool everywhere else (old worlds unchanged). */
function dreamPool(biome?: BiomeType): IAffixPool | undefined {
  const dream = DreamingSystem.active();
  return dream && biome ? DreamingSystem.rollPoolFor(dream.pack, biome) : undefined;
}

export interface ILootContext {
  // Where the mob died (for deed generation)
  chunkX: number;
  chunkY: number;
  layerId: string;
  biome: BiomeType;
  
  // Player bonuses
  magicFind: number;      // Multiplier for rarity rolls (1.0 = base)
  quantityBonus: number;  // Multiplier for drop count (1.0 = base)
}

export class LootTable {

  /**
   * The roll on a table, when this source's theme holds one that fits it; none means the old
   * code's drop. Whole numbers only, so the hub lands where this did.
   */
  static rollOnTable(themeId: string | undefined, kind: 'creature' | 'chest', tags: string[], rank: string, rollKey: string | undefined): ITableRoll | null {
    if (!rollKey || !themeId) return null;
    const table = LootBook.tableFor(themeId, kind, tags);
    const pack = table ? ContentRegistry.get(themeId) : undefined;
    if (!table || !pack) return null;
    return { table: table.id, rank, lines: LootLaw.roll(table, rank, rollKey, lootItemsOf(pack)) };
  }

  /** What a table's lines mint, each piece from its own keyed stream, so one never moves another. */
  static mint(roll: ITableRoll, rollKey: string, pool?: IAffixPool): IItem[] {
    const out: IItem[] = [];
    for (const d of roll.lines) {
      for (let n = 0; n < d.count; n++) {
        const own = Rng.fromKey(`${rollKey}:drop:${d.line}:${n}`);
        if (d.what === 'gear') { out.push(ItemFactory.createItem(d.rank as UniversalRank, false, own, undefined, d.id, pool)); continue; }
        const def = RESOURCE_DEFINITIONS[d.id];
        if (def) out.push(ItemFactory.createResourceItem(def, own));
      }
    }
    return out;
  }

  /** The table roll behind a creature's drop, for the journal. */
  static creatureRoll(mobDef: IMobDefinition, rollKey?: string): ITableRoll | null {
    return this.rollOnTable((mobDef as { themeId?: string }).themeId, 'creature', mobDef.tags, mobDef.rank, rollKey);
  }

  /** The table roll behind a chest, in the dreamed world's theme, for the journal. */
  static chestRoll(chestRank: UniversalRank, rollKey?: string, biome?: BiomeType): ITableRoll | null {
    return this.rollOnTable(LootBook.entered(), 'chest', biome ? [biome] : [], chestRank, rollKey);
  }

  
  /**
   * Generate loot from a killed mob
   * @param mobDef The mob's definition
   * @param magicFind Player's magic find stat (default 1.0)
   * @param context Optional context for advanced drops like deeds
   * @param earnedName D60: the body's name, if it has earned one; a drop never reveals more
   */
  static generateLoot(
    mobDef: IMobDefinition, 
    magicFind: number = 1.0,
    context?: ILootContext,
    rollKey?: string,
    earnedName?: string
  ): IItem[] {
    // Wave 1.3: every drop derives from a journaled key. Same key -> same loot.
    const rng = Rng.fromKey(rollKey || `unkeyed:loot:${Date.now()}:${Math.random()}`);
    if (!rollKey) console.warn('[LOOT] Unkeyed loot roll - not replayable.');
    const loot: IItem[] = [];
    const effectiveMF = magicFind * (context?.quantityBonus || 1.0);
    const pool = dreamPool(context?.biome);

    // A theme's own table, when it has one for this creature: the model's words, the law's numbers
    const onTable = this.creatureRoll(mobDef, rollKey);
    if (onTable && rollKey) {
      loot.push(...this.mint(onTable, rollKey, pool));
      loot.push(...this.deedsFor(mobDef, rng, effectiveMF, context, rollKey));
      return loot;
    }

    // ========================================================================
    // 1. GUARANTEED DROPS (By Tag)
    // ========================================================================
    
    // Biological mobs drop scrap/materials
    if (mobDef.tags.includes('biological')) {
      if (rng.next() < 0.6 * effectiveMF) {
        loot.push(ItemFactory.createItem(UniversalRank.F, false, rng, undefined, undefined, pool));
      }
    }

    // Mechanical mobs drop tech components
    if (mobDef.tags.includes('mechanical')) {
      if (rng.next() < 0.5 * effectiveMF) {
        const item = ItemFactory.createItem(UniversalRank.E, false, rng, undefined, undefined, pool);
        item.name = 'Salvaged Component';
        loot.push(item);
      }
    }

    // ========================================================================
    // 2. GEAR DROPS (Scaled by Mob Rank)
    // ========================================================================
    
    let gearChance = this.getGearChance(mobDef);
    gearChance *= effectiveMF;

    if (rng.next() < gearChance) {
      // Gear drops at mob's rank, unidentified
      const item = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool);
      loot.push(item);
    }

    // Elites get a second roll
    if (mobDef.tags.includes('elite') && rng.next() < gearChance * 0.5) {
      const bonusItem = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool);
      loot.push(bonusItem);
    }

    // ========================================================================
    // 3. BOSS DROPS (Always something good)
    // ========================================================================
    
    if (mobDef.tags.includes('boss')) {
      // Guaranteed rank-appropriate gear
      const bossLoot = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool);
      bossLoot.rarity = Rarity.EPIC; // Bosses always drop at least Epic
      loot.push(bossLoot);

      // Chance for Legendary
      if (rng.next() < 0.25 * effectiveMF) {
        const legendary = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool);
        legendary.rarity = Rarity.LEGENDARY;
        if (earnedName) legendary.name = `${earnedName}'s ${legendary.name}`;
        loot.push(legendary);
      }

      // Small chance for Knowledge Tome
      if (rng.next() < 0.10 * effectiveMF) {
        const tome = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool);
        const subject = earnedName ?? 'Something Unnamed';
        tome.name = `Tome of ${subject}`;
        tome.description = `Contains forbidden knowledge about ${subject}. Studying this grants Lore XP.`;
        tome.rarity = Rarity.LEGENDARY;
        loot.push(tome);
      }
    }

    // ========================================================================
    // 4. GOD/TITAN DROPS (Guaranteed jackpot)
    // ========================================================================
    
    if (mobDef.tags.includes('god') || mobDef.tags.includes('titan')) {
      // Multiple high-rank items
      for (let i = 0; i < 3; i++) {
        const godLoot = ItemFactory.createItem(UniversalRank.S, false, rng, undefined, undefined, pool);
        godLoot.rarity = Rarity.LEGENDARY;
        loot.push(godLoot);
      }

      // Artifact-tier item
      const artifact = ItemFactory.createItem(UniversalRank.SSS, false, rng, undefined, undefined, pool);
      artifact.rarity = Rarity.ARTIFACT;
      artifact.name = `Relic of ${earnedName ?? 'Something Unnamed'}`;
      artifact.description = 'An item of impossible origin. Reality bends around it.';
      loot.push(artifact);
    }

    // ========================================================================
    // 5. DEED DROPS (THE JACKPOT)
    // ========================================================================
    
    loot.push(...this.deedsFor(mobDef, rng, effectiveMF, context, rollKey));


    // ========================================================================
    // 6. GOLD (Always)
    // ========================================================================
    
    // Gold is represented as a virtual currency, not an item
    // This would be handled by the combat system adding to session gold
    // For now we could add a "gold shard" item if desired

    // ========================================================================
    // 7. JUNK (D99): on its own roll, so no other drop moves
    // ========================================================================

    const junk = (mobDef as { junk?: string[] }).junk ?? [];
    if (junk.length > 0 && rollKey) {
      const own = Rng.fromKey(`${rollKey}:junk`);
      if (own.next() < JUNK_CHANCE) {
        const def = RESOURCE_DEFINITIONS[junk[own.int(0, junk.length)]];
        if (def) loot.push(ItemFactory.createResourceItem(def, own));
      }
    }

    return loot;
  }

  /** A land deed: the game's own rule, not a table's, on the drop's own stream. */
  private static deedsFor(mobDef: IMobDefinition, rng: { next(): number }, effectiveMF: number, context: ILootContext | undefined, rollKey: string | undefined): IItem[] {
    const loot: IItem[] = [];
    if (context) {
      const deedChance = this.getDeedChance(mobDef);
      
      if (rng.next() < deedChance * effectiveMF) {
        // Deed rank scales with mob rank
        let deedRank = UniversalRank.B;
        if (mobDef.rank === UniversalRank.S || mobDef.rank === UniversalRank.SS) {
          deedRank = UniversalRank.A;
        }
        if (mobDef.rank === UniversalRank.SSS) {
          deedRank = UniversalRank.S;
        }

        const deed = DeedSystem.createDeed(
          context.chunkX,
          context.chunkY,
          context.layerId,
          context.biome,
          deedRank
        );

        loot.push(deed);
        console.log(`[LOOT] DEED DROPPED! ${deed.name}`);
      }
    }

    loot.push(...WorldDeed.foundOn(mobDef, effectiveMF, rollKey)); // D72: a keyed stream of its own, so no roll above moves
    return loot;
  }

  /** D99: what the hands collect on their own, and junk, which waits on the ground for someone who wants it. */
  static sortDrop(items: IItem[]): { collect: IItem[]; leave: IItem[] } {
    const isJunk = (item: IItem) => !!RESOURCE_DEFINITIONS[item.universalDefinitionId]?.junk;
    return { collect: items.filter(i => !isJunk(i)), leave: items.filter(isJunk) };
  }

  /** What junk lies in where a body fell: an ordinary ground cache, taken the way any cache is. */
  static junkCache(items: IItem[], position: { x: number; y: number }, bodyId: string): IWorldEntity {
    return {
      id: `cache_junk_${bodyId}`, type: EntityType.CONTAINER, definitionId: 'ground_cache', position: { ...position },
      rank: items[0].rank, rarity: items[0].rarity, isHostile: false,
      container: { lootRank: items[0].rank, looted: false, hasLore: false, items }
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private static getGearChance(mobDef: IMobDefinition): number {
    // Base chance by rank
    const rankChances: Record<UniversalRank, number> = {
      [UniversalRank.F]: 0.05,
      [UniversalRank.E]: 0.08,
      [UniversalRank.D]: 0.12,
      [UniversalRank.C]: 0.18,
      [UniversalRank.B]: 0.25,
      [UniversalRank.A]: 0.35,
      [UniversalRank.S]: 0.50,
      [UniversalRank.SS]: 0.75,
      [UniversalRank.SSS]: 1.0
    };

    let chance = rankChances[mobDef.rank] || 0.05;

    // Tag modifiers
    if (mobDef.tags.includes('elite')) chance *= 2;
    if (mobDef.tags.includes('boss')) chance = Math.max(chance, 0.8);
    if (mobDef.tags.includes('grunt')) chance *= 0.5;

    return Math.min(chance, 1.0);
  }

  private static getDeedChance(mobDef: IMobDefinition): number {
    // Deeds are RARE
    // Only elite+ mobs can drop them
    if (mobDef.tags.includes('grunt')) return 0;
    
    const baseChance = 0.001; // 0.1% base

    // Rank multipliers
    const rankMult: Record<UniversalRank, number> = {
      [UniversalRank.F]: 0,
      [UniversalRank.E]: 0,
      [UniversalRank.D]: 0.5,
      [UniversalRank.C]: 1,
      [UniversalRank.B]: 2,
      [UniversalRank.A]: 5,
      [UniversalRank.S]: 10,
      [UniversalRank.SS]: 25,
      [UniversalRank.SSS]: 100 // Guaranteed from god-tier
    };

    let chance = baseChance * (rankMult[mobDef.rank] || 0);

    // Bosses have much higher deed chance
    if (mobDef.tags.includes('boss')) chance *= 10;
    if (mobDef.tags.includes('god') || mobDef.tags.includes('titan')) {
      chance = 0.5; // 50% from world bosses
    }

    return chance;
  }

  /**
   * Generate loot for a resource node (not a mob)
   */
  static generateResourceLoot(nodeType: string, playerMiningYield: number = 1.0, rollKey?: string): IItem[] {
    const rng = Rng.fromKey(rollKey || `unkeyed:resource:${Date.now()}:${Math.random()}`);
    const loot: IItem[] = [];

    // Resource nodes always drop something
    const item = ItemFactory.createItem(UniversalRank.F, true, rng); // Resources are pre-identified
    item.name = `Raw ${nodeType}`;
    item.description = `Harvested material. Can be refined.`;
    
    // Quantity based on mining yield
    const quantity = Math.floor(1 + rng.next() * 3 * playerMiningYield);
    for (let i = 0; i < quantity; i++) {
      loot.push({ ...item, id: `${item.id}_${i}` });
    }

    return loot;
  }

  /**
   * Generate loot for a chest/container
   */
  static generateChestLoot(chestRank: UniversalRank, magicFind: number = 1.0, rollKey?: string, biome?: BiomeType): IItem[] {
    const rng = Rng.fromKey(rollKey || `unkeyed:chest:${Date.now()}:${Math.random()}`);
    const loot: IItem[] = [];
    const pool = dreamPool(biome);

    // A theme's own table for a chest in this land, when the dreamed world has one
    const onTable = this.chestRoll(chestRank, rollKey, biome);
    if (onTable && rollKey) return this.mint(onTable, rollKey, pool);

    // Chests always have 2-5 items
    const count = 2 + Math.floor(rng.next() * 4);

    for (let i = 0; i < count; i++) {
      // Each item can be chest rank or one below
      const itemRank = rng.next() < 0.7 ? chestRank : this.rankBelow(chestRank);
      loot.push(ItemFactory.createItem(itemRank, false, rng, undefined, undefined, pool));
    }

    // Chance for bonus rare item
    if (rng.next() < 0.2 * magicFind) {
      const bonus = ItemFactory.createItem(chestRank, false, rng, undefined, undefined, pool);
      bonus.rarity = Rarity.RARE;
      loot.push(bonus);
    }

    return loot;
  }

  private static rankBelow(rank: UniversalRank): UniversalRank {
    const order = [
      UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C,
      UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS
    ];
    const idx = order.indexOf(rank);
    return idx > 0 ? order[idx - 1] : rank;
  }
}
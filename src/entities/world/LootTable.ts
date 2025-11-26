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
import { IItem, UniversalRank, Rarity } from '../../../types';
import { IMobDefinition } from '../mob/types';
import { DeedSystem, IDeed } from '../../logic/systems/DeedSystem';
import { BiomeType } from './types';

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
   * Generate loot from a killed mob
   * @param mobDef The mob's definition
   * @param magicFind Player's magic find stat (default 1.0)
   * @param context Optional context for advanced drops like deeds
   */
  static generateLoot(
    mobDef: IMobDefinition, 
    magicFind: number = 1.0,
    context?: ILootContext
  ): IItem[] {
    const loot: IItem[] = [];
    const effectiveMF = magicFind * (context?.quantityBonus || 1.0);

    // ========================================================================
    // 1. GUARANTEED DROPS (By Tag)
    // ========================================================================
    
    // Biological mobs drop scrap/materials
    if (mobDef.tags.includes('biological')) {
      if (Math.random() < 0.6 * effectiveMF) {
        loot.push(ItemFactory.createItem(UniversalRank.F, false));
      }
    }

    // Mechanical mobs drop tech components
    if (mobDef.tags.includes('mechanical')) {
      if (Math.random() < 0.5 * effectiveMF) {
        const item = ItemFactory.createItem(UniversalRank.E, false);
        item.name = 'Salvaged Component';
        loot.push(item);
      }
    }

    // ========================================================================
    // 2. GEAR DROPS (Scaled by Mob Rank)
    // ========================================================================
    
    let gearChance = this.getGearChance(mobDef);
    gearChance *= effectiveMF;

    if (Math.random() < gearChance) {
      // Gear drops at mob's rank, unidentified
      const item = ItemFactory.createItem(mobDef.rank, false);
      loot.push(item);
    }

    // Elites get a second roll
    if (mobDef.tags.includes('elite') && Math.random() < gearChance * 0.5) {
      const bonusItem = ItemFactory.createItem(mobDef.rank, false);
      loot.push(bonusItem);
    }

    // ========================================================================
    // 3. BOSS DROPS (Always something good)
    // ========================================================================
    
    if (mobDef.tags.includes('boss')) {
      // Guaranteed rank-appropriate gear
      const bossLoot = ItemFactory.createItem(mobDef.rank, false);
      bossLoot.rarity = Rarity.EPIC; // Bosses always drop at least Epic
      loot.push(bossLoot);

      // Chance for Legendary
      if (Math.random() < 0.25 * effectiveMF) {
        const legendary = ItemFactory.createItem(mobDef.rank, false);
        legendary.rarity = Rarity.LEGENDARY;
        legendary.name = `${mobDef.name}'s ${legendary.name}`;
        loot.push(legendary);
      }

      // Small chance for Knowledge Tome
      if (Math.random() < 0.10 * effectiveMF) {
        const tome = ItemFactory.createItem(mobDef.rank, false);
        tome.name = `Tome of ${mobDef.name}`;
        tome.description = `Contains forbidden knowledge about ${mobDef.name}. Studying this grants Lore XP.`;
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
        const godLoot = ItemFactory.createItem(UniversalRank.S, false);
        godLoot.rarity = Rarity.LEGENDARY;
        loot.push(godLoot);
      }

      // Artifact-tier item
      const artifact = ItemFactory.createItem(UniversalRank.SSS, false);
      artifact.rarity = Rarity.ARTIFACT;
      artifact.name = `Relic of ${mobDef.name}`;
      artifact.description = 'An item of impossible origin. Reality bends around it.';
      loot.push(artifact);
    }

    // ========================================================================
    // 5. DEED DROPS (THE JACKPOT)
    // ========================================================================
    
    if (context) {
      const deedChance = this.getDeedChance(mobDef);
      
      if (Math.random() < deedChance * effectiveMF) {
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

    // ========================================================================
    // 6. GOLD (Always)
    // ========================================================================
    
    // Gold is represented as a virtual currency, not an item
    // This would be handled by the combat system adding to session gold
    // For now we could add a "gold shard" item if desired

    return loot;
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
  static generateResourceLoot(nodeType: string, playerMiningYield: number = 1.0): IItem[] {
    const loot: IItem[] = [];

    // Resource nodes always drop something
    const item = ItemFactory.createItem(UniversalRank.F, true); // Resources are pre-identified
    item.name = `Raw ${nodeType}`;
    item.description = `Harvested material. Can be refined.`;
    
    // Quantity based on mining yield
    const quantity = Math.floor(1 + Math.random() * 3 * playerMiningYield);
    for (let i = 0; i < quantity; i++) {
      loot.push({ ...item, id: crypto.randomUUID() });
    }

    return loot;
  }

  /**
   * Generate loot for a chest/container
   */
  static generateChestLoot(chestRank: UniversalRank, magicFind: number = 1.0): IItem[] {
    const loot: IItem[] = [];

    // Chests always have 2-5 items
    const count = 2 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i++) {
      // Each item can be chest rank or one below
      const itemRank = Math.random() < 0.7 ? chestRank : this.rankBelow(chestRank);
      loot.push(ItemFactory.createItem(itemRank, false));
    }

    // Chance for bonus rare item
    if (Math.random() < 0.2 * magicFind) {
      const bonus = ItemFactory.createItem(chestRank, false);
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
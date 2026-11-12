/**
 * LOOT TABLE SYSTEM
 * Generates loot based on mob definitions, player magic find, and world state
 * 
 * DESIGN PHILOSOPHY:
 * - High drop rates for UNIDENTIFIED items (keeps inventory decisions interesting)
 * - Low drop rates for DEEDS (jackpot moments)
 * - Bosses always drop SOMETHING good
 */

import { ItemFactory, IFoundLaw } from '../../../shared/entities/item/ItemFactory';
import { SeededRNG, Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { IItem, ItemType, UniversalRank, Rarity } from '../../../shared/types';
import { LORE_FRAGMENTS } from '../lore/LoreBible';
import { IMobDefinition } from '../../../shared/entities/mob/types';
import { DeedSystem } from '../../logic/systems/DeedSystem';
import { WorldDeed } from '../../logic/systems/WorldDeed';
import { BiomeType } from '../../../shared/entities/world/types';
import { DreamingSystem, IAffixPool } from '../../../shared/entities/world/Dreaming';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../../../shared/entities/item/data/resourceDefinitions';
import { JUNK_CHANCE, RANKED_FROM_GROUND } from '../../../shared/logic/theme/ThemeFormula';
import { LootBook } from '../../logic/theme/LootBook';
import { IDropLine, LootLaw, lootItemsOf } from '../../../shared/logic/theme/LootLaw';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { creatureIdOf } from '../../../shared/logic/theme/ThemeCompiler';
import { PieceLaw } from '../../../shared/logic/theme/PieceLaw';
import { RANKS } from '../../../shared/logic/theme/ThemeTypes';

/** A drop rolled on a theme's table (LootLaw.ts): which table, at what rank, what it said. The journal keeps it, so a hub can roll it again (D134). */
export interface ITableRoll {
  table: string; rank: string; lines: IDropLine[];
  /**
   * The rarity rescale: the rank each line drops at, from its source's (the same, or one under). A found
   * piece takes it, never its kind's. Kept beside the lines, so a hub's rerun of the lines lands as before.
   */
  at?: string[];
}

/** A world with no ground pinned is the first (C24): it gives what it gave. */
const groundOf = (groundVersion?: number) => ({ groundVersion: groundVersion ?? 1 });
const newLaw = (groundVersion?: number) => groundOf(groundVersion).groundVersion >= PieceLaw.FROM_GROUND;

/** Wave 10E: the pool this drop rolls from — the pinned bank's biome pool in a
 * dreamed world, the purged legacy pool everywhere else (old worlds unchanged). */
function dreamPool(biome?: BiomeType): IAffixPool | undefined {
  const dream = DreamingSystem.active();
  return dream && biome ? DreamingSystem.rollPoolFor(dream.pack, biome) : undefined;
}

/**
 * The rarity rescale: what a find may hold, and whether pairs are open. A world that dreams (its hub unlocked
 * magic) rolls its pinned dream with pairs open; one that does not still holds its theme's words, for one lone
 * property at most: an uncommon piece is technological and needs no magic (call 13).
 */
function foundPool(biome: BiomeType | undefined, themeId: string | undefined): { pool?: IAffixPool; pairsOpen: boolean } {
  const dream = DreamingSystem.active();
  if (dream) return { pool: biome ? DreamingSystem.rollPoolFor(dream.pack, biome) : undefined, pairsOpen: true };
  const pack = ContentRegistry.dreamPack(themeId ?? LootBook.entered() ?? ContentRegistry.defaultThemeId());
  return { pool: pack ? DreamingSystem.rollPoolFor(pack, biome ?? 'GLOBAL') : undefined, pairsOpen: false };
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
  static rollOnTable(themeId: string | undefined, kind: 'creature' | 'chest', tags: string[], rank: string, rollKey: string | undefined, keys: string[] = []): ITableRoll | null {
    if (!rollKey || !themeId) return null;
    const table = LootBook.tableFor(themeId, kind, tags, keys);
    const pack = table ? ContentRegistry.get(themeId) : undefined;
    if (!table || !pack) return null;
    const lines = LootLaw.roll(table, rank, rollKey, lootItemsOf(pack));
    const step = Math.max(0, RANKS.indexOf(rank as typeof RANKS[number]));
    const at = lines.map(d => RANKS[table.lines[d.line]?.rank === 'below' ? Math.max(0, step - 1) : step] as string);
    return { table: table.id, rank, lines, at };
  }

  /** What a table's lines mint, each piece from its own keyed stream, so one never moves another. */
  static mint(roll: ITableRoll, rollKey: string, pool?: IAffixPool, groundVersion?: number, found: IFoundLaw = {}, gearAtMost = Infinity): IItem[] {
    const out: IItem[] = [];
    let gear = 0;
    roll.lines.forEach((d, i) => {
      for (let n = 0; n < d.count; n++) {
        const own = Rng.fromKey(`${rollKey}:drop:${d.line}:${n}`);
        // The rarity rescale: a found piece takes the rank of where it came from, never its kind's
        const rank = (newLaw(groundVersion) ? roll.at?.[i] ?? roll.rank : d.rank) as UniversalRank;
        // GS: a chest of a ground that holds one piece mints the first its table names, and the lines stand as rolled
        if (d.what === 'gear') { if (gear++ < gearAtMost) out.push(ItemFactory.createItem(rank, false, own, undefined, d.id, pool, { ...groundOf(groundVersion), ...found })); continue; }
        const def = RESOURCE_DEFINITIONS[d.id];
        if (def) out.push(ItemFactory.createResourceItem(def, own));
      }
    });
    return out;
  }

  /**
   * The table roll behind a creature's drop, for the journal. A body is asked for by what it is: its
   * own kind first, then the kind it leads or grew from, so a creature's own table is found before
   * any that only fits its tags (Pedro, of his own run: "loot table the mobs themselves").
   */
  static creatureRoll(mobDef: IMobDefinition, rollKey?: string): ITableRoll | null {
    const { themeId, line } = mobDef as { themeId?: string; line?: { root?: string } };
    const prefix = themeId ? creatureIdOf(themeId, '') : '';
    const keys = prefix ? [mobDef.id, line?.root].filter((id): id is string => !!id && id.startsWith(prefix)).map(id => id.slice(prefix.length)) : [];
    return this.rollOnTable(themeId, 'creature', mobDef.tags, mobDef.rank, rollKey, keys);
  }

  /** A written fragment (the lore pass, call 6) from its own keyed stream, in its world's words when it has any. */
  static loreFragment(rollKey: string, themeId?: string): IItem {
    const rng = Rng.fromKey(`${rollKey}:lore_fragment:piece`);
    const words = ContentRegistry.lore(themeId, undefined);
    return {
      ...ItemFactory.createResourceItem({ id: 'lore_fragment', name: 'Lore Fragment', icon: '📜', weight: 0.1, dimensions: { width: 1, height: 1 } } as any, rng),
      type: ItemType.LORE,
      description: rng.pick(words.length > 0 ? words : LORE_FRAGMENTS),
      value: 50,
      tags: ['lore', 'document']
    };
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
    earnedName?: string,
    groundVersion?: number,
    luck = 0,
    body?: { bonusHealth?: number; bonusDamage?: number }
  ): IItem[] {
    // Wave 1.3: every drop derives from a journaled key. Same key -> same loot.
    const rng = Rng.fromKey(rollKey || `unkeyed:loot:${Date.now()}:${Math.random()}`);
    if (!rollKey) console.warn('[LOOT] Unkeyed loot roll - not replayable.');
    const loot: IItem[] = [];
    const effectiveMF = magicFind * (context?.quantityBonus || 1.0);
    // The rarity rescale: the body it fell from and the finder's luck move the odds of depth (PieceLaw.oddsOf)
    const found = foundPool(context?.biome, (mobDef as { themeId?: string }).themeId);
    const pool = newLaw(groundVersion) ? found.pool : dreamPool(context?.biome);
    const law: IFoundLaw = newLaw(groundVersion) ? { odds: PieceLaw.oddsOf({ luck, tags: mobDef.tags }), pairsOpen: found.pairsOpen } : {};
    const ground = { ...groundOf(groundVersion), ...law };
    // Under the rescale a step is read off what a piece holds, never written on it by hand
    const legacy = !newLaw(groundVersion);

    // A theme's own table, when it has one for this creature: the model's words, the law's numbers
    const onTable = this.creatureRoll(mobDef, rollKey);
    if (onTable && rollKey) {
      loot.push(...this.mint(onTable, rollKey, pool, groundVersion, law));
      if (!legacy) loot.push(...this.ownPieces(mobDef, rollKey, effectiveMF, earnedName, pool, ground, body));
      loot.push(...this.deedsFor(mobDef, rng, effectiveMF, context, rollKey));
      return loot;
    }

    // ========================================================================
    // 1. GUARANTEED DROPS (By Tag)
    // ========================================================================
    
    // Biological mobs drop scrap/materials
    if (mobDef.tags.includes('biological')) {
      if (rng.next() < 0.6 * effectiveMF) {
        loot.push(ItemFactory.createItem(UniversalRank.F, false, rng, undefined, undefined, pool, ground));
      }
    }

    // Mechanical mobs drop tech components
    if (mobDef.tags.includes('mechanical')) {
      if (rng.next() < 0.5 * effectiveMF) {
        const item = ItemFactory.createItem(UniversalRank.E, false, rng, undefined, undefined, pool, ground);
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
      const item = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool, ground);
      loot.push(item);
    }

    // Elites get a second roll
    if (mobDef.tags.includes('elite') && rng.next() < gearChance * 0.5) {
      const bonusItem = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool, ground);
      loot.push(bonusItem);
    }

    // ========================================================================
    // 3. BOSS DROPS (Always something good)
    // ========================================================================
    
    if (mobDef.tags.includes('boss')) {
      // Guaranteed rank-appropriate gear
      const bossLoot = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool, ground);
      if (legacy) bossLoot.rarity = Rarity.EPIC; // Bosses always drop at least Epic
      loot.push(bossLoot);

      // Chance for Legendary. Under the rarity rescale, a boss's own piece (ownPieces), on a stream of its own
      if (legacy && rng.next() < 0.25 * effectiveMF) {
        const legendary = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool, ground);
        legendary.rarity = Rarity.LEGENDARY;
        if (earnedName) legendary.name = `${earnedName}'s ${legendary.name}`;
        loot.push(legendary);
      }

      // Small chance for Knowledge Tome
      if (rng.next() < 0.10 * effectiveMF) {
        const tome = ItemFactory.createItem(mobDef.rank, false, rng, undefined, undefined, pool, ground);
        const subject = earnedName ?? 'Something Unnamed';
        tome.name = `Tome of ${subject}`;
        tome.description = `Contains forbidden knowledge about ${subject}. Studying this grants Lore XP.`;
        if (legacy) tome.rarity = Rarity.LEGENDARY;
        loot.push(tome);
      }
    }

    // ========================================================================
    // 4. GOD/TITAN DROPS (Guaranteed jackpot)
    // ========================================================================
    
    if (mobDef.tags.includes('god') || mobDef.tags.includes('titan')) {
      // Multiple high-rank items
      for (let i = 0; i < 3; i++) {
        const godLoot = ItemFactory.createItem(legacy ? UniversalRank.S : mobDef.rank, false, rng, undefined, undefined, pool, ground);
        if (legacy) godLoot.rarity = Rarity.LEGENDARY;
        loot.push(godLoot);
      }

      // Artifact-tier item. Under the rarity rescale, the titan's or the god's own piece (ownPieces)
      if (legacy) {
        const artifact = ItemFactory.createItem(UniversalRank.SSS, false, rng, undefined, undefined, pool, ground);
        artifact.rarity = Rarity.ARTIFACT;
        artifact.name = `Relic of ${earnedName ?? 'Something Unnamed'}`;
        artifact.description = 'An item of impossible origin. Reality bends around it.';
        loot.push(artifact);
      }
    }
    if (!legacy && rollKey) loot.push(...this.ownPieces(mobDef, rollKey, effectiveMF, earnedName, pool, ground, body));

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

  /**
   * A body's own piece (the rarity rescale, call 17): legendary and artifact are whose the piece was, never a count.
   * A boss leaves its own one time in four, as the old drop's legendary did; a titan or a god always. It is found at
   * the body's own rank, at the body's odds, carries its name (the one it earned, or its kind's) and each trait the
   * Director made of it (health, damage), on a stream of its own so no other drop moves.
   */
  static ownPieces(mobDef: IMobDefinition, rollKey: string, effectiveMF: number, earnedName: string | undefined, pool: IAffixPool | undefined,
    ground: { groundVersion: number } & IFoundLaw, body?: { bonusHealth?: number; bonusDamage?: number }): IItem[] {
    const kind = mobDef.tags.includes('titan') ? 'titan' : mobDef.tags.includes('god') ? 'god' : mobDef.tags.includes('boss') ? 'boss' : undefined;
    if (!kind) return [];
    const own = Rng.fromKey(`${rollKey}:own`);
    if (kind === 'boss' && own.next() >= 0.25 * effectiveMF) return [];
    const traits = [...((body?.bonusHealth ?? 0) > 0 ? ['max_health'] : []), ...((body?.bonusDamage ?? 0) > 0 ? ['damage'] : [])];
    return [ItemFactory.createItem(mobDef.rank, false, own, undefined, undefined, pool, { ...ground, whose: { name: earnedName ?? mobDef.name, kind }, traits })];
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
  static generateChestLoot(chestRank: UniversalRank, magicFind: number = 1.0, rollKey?: string, biome?: BiomeType, groundVersion?: number, luck = 0): IItem[] {
    const rng = Rng.fromKey(rollKey || `unkeyed:chest:${Date.now()}:${Math.random()}`);
    const loot: IItem[] = [];
    const found = foundPool(biome, undefined);
    const pool = newLaw(groundVersion) ? found.pool : dreamPool(biome);
    const law: IFoundLaw = newLaw(groundVersion) ? { odds: PieceLaw.oddsOf({ luck, tags: [] }), pairsOpen: found.pairsOpen } : {};
    const ground = { ...groundOf(groundVersion), ...law };

    // GS (2.5, the coordinator's call): from its ground on, a chest holds one piece of gear, and goods
    const holdsOne = (groundVersion ?? 1) >= RANKED_FROM_GROUND;

    // A theme's own table for a chest in this land, when the dreamed world has one
    const onTable = this.chestRoll(chestRank, rollKey, biome);
    if (onTable && rollKey) return this.mint(onTable, rollKey, pool, groundVersion, law, holdsOne ? 1 : Infinity);

    // Chests always have 2-5 items
    const count = 2 + Math.floor(rng.next() * 4);

    if (holdsOne) {
      // The one piece, at the chest's rank or one under as before; what else it holds is the land's own materials, at or
      // under its rank. A valuable (coin) and a fragment are its own rolls, beside this, as they always were
      const itemRank = rng.next() < 0.7 ? chestRank : this.rankBelow(chestRank);
      loot.push(ItemFactory.createItem(itemRank, false, rng, undefined, undefined, pool, ground));
      const goods = this.landGoods(chestRank, biome);
      if (goods.length > 0) for (let i = 1; i < count; i++) loot.push(ItemFactory.createResourceItem(goods[rng.int(0, goods.length)], rng));
      return loot;
    }

    for (let i = 0; i < count; i++) {
      // Each item can be chest rank or one below
      const itemRank = rng.next() < 0.7 ? chestRank : this.rankBelow(chestRank);
      loot.push(ItemFactory.createItem(itemRank, false, rng, undefined, undefined, pool, ground));
    }

    // Chance for bonus rare item
    if (rng.next() < 0.2 * magicFind) {
      const bonus = ItemFactory.createItem(chestRank, false, rng, undefined, undefined, pool, ground);
      if (!newLaw(groundVersion)) bonus.rarity = Rarity.RARE;
      loot.push(bonus);
    }

    return loot;
  }

  /**
   * What a chest holds beside its one piece (GS, 2.5's "and goods"): its world's own materials that lie on this land,
   * at or under the chest's rank; any of its materials at that rank where the land holds none. Never junk, a valuable
   * (its own roll) or a very rare find. Sorted by the pack's key, so a pick is the same pick everywhere.
   */
  private static landGoods(chestRank: UniversalRank, biome?: BiomeType): ResourceDef[] {
    const pack = ContentRegistry.get(LootBook.entered() ?? ContentRegistry.defaultThemeId());
    if (!pack) return [];
    const at = RANKS.indexOf(chestRank as typeof RANKS[number]);
    const own = lootItemsOf(pack).material
      .filter(m => RANKS.indexOf(m.rank) <= at)
      .map(m => RESOURCE_DEFINITIONS[m.id])
      .filter(d => !!d && !d.junk && !d.anchor && !d.rareFind);
    const here = biome ? own.filter(d => d.habitat?.includes(biome)) : own;
    return here.length > 0 ? here : own;
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
import { ItemFactory } from '../item/ItemFactory';
import { IItem, UniversalRank, Rarity } from '../../../types';
import { GenreType } from './definitions';

interface DropEntry {
  itemId?: string; // Specific definition ID
  itemType?: 'GEAR' | 'MATERIAL' | 'TOME';
  rank?: UniversalRank;
  chance: number; // 0.0 to 1.0
  minCount: number;
  maxCount: number;
  genre?: GenreType; // For generic gear generation
}

export class LootTable {
  
  static generateLoot(mobDefinition: any, magicFind: number = 1.0): IItem[] {
    const loot: IItem[] = [];
    const rng = Math.random();

    // 1. Generic Materials (Based on Genre)
    if (mobDefinition.tags.includes('biological')) {
        if (rng < 0.5 * magicFind) loot.push(ItemFactory.createItem(UniversalRank.F, false)); // Placeholder for "Meat"
    }
    if (mobDefinition.tags.includes('mechanical')) {
        if (rng < 0.5 * magicFind) loot.push(ItemFactory.createItem(UniversalRank.F, false)); // Placeholder for "Scrap"
    }

    // 2. Gear Drops (Scaled by Rank)
    // Elite mobs drop better stuff
    let gearChance = 0.1;
    if (mobDefinition.tags.includes('elite')) gearChance = 0.5;
    if (mobDefinition.tags.includes('boss')) gearChance = 1.0;

    if (Math.random() < gearChance * magicFind) {
        // Generate gear matching the mob's rank
        const item = ItemFactory.createItem(mobDefinition.rank, false); // Unidentified!
        loot.push(item);
    }

    // 3. THE JACKPOT (Tomes / Artifacts)
    // Very low chance, unaffected by Magic Find (or slightly)
    if (mobDefinition.tags.includes('boss') || mobDefinition.tags.includes('god')) {
        if (Math.random() < 0.05) { // 5% chance from a Boss
             // In a real app, we'd have a Tome Factory
             // For now, we create a "Legendary" item representing the Tome
             const tome = ItemFactory.createItem(UniversalRank.S, false);
             tome.name = `Tome of ${mobDefinition.name}`;
             tome.description = "Contains forbidden knowledge.";
             tome.rarity = Rarity.LEGENDARY;
             loot.push(tome);
        }
    }

    return loot;
  }
}
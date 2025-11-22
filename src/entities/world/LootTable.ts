import { ItemFactory } from '../item/ItemFactory';
import { IItem, UniversalRank, Rarity } from '../../../types';

export class LootTable {
  
  static generateLoot(mobDefinition: any, magicFind: number = 1.0): IItem[] {
    const loot: IItem[] = [];
    const rng = Math.random();

    // 1. Generic Materials
    if (mobDefinition.tags.includes('biological')) {
        // Drops unidentified scrap (Rank F)
        if (rng < 0.5 * magicFind) loot.push(ItemFactory.createItem(UniversalRank.F, false)); 
    }

    // 2. Gear Drops
    let gearChance = 0.1;
    if (mobDefinition.tags.includes('elite')) gearChance = 0.5;
    if (mobDefinition.tags.includes('boss')) gearChance = 1.0;

    if (Math.random() < gearChance * magicFind) {
        // FIXED: Now correctly passes rank and unidentified status
        const item = ItemFactory.createItem(mobDefinition.rank, false); 
        loot.push(item);
    }

    // 3. THE JACKPOT
    if (mobDefinition.tags.includes('boss') || mobDefinition.tags.includes('god')) {
        if (Math.random() < 0.05) { 
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
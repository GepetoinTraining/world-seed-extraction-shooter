import { v4 as uuidv4 } from 'uuid';
import { IItem, UniversalRank, Rarity, ItemType, SlotType } from '../../../types'; 
import { useHubStore } from '../../entities/hub/store'; 

export interface IDeedItem extends IItem {
  itemType: 'DEED';
  deedData: {
    originBiome: string;
    originLayer: string;
    coordinateHash: string;
    rank: UniversalRank;
    allowedStructures: ('HOUSE' | 'WORKSHOP' | 'VENDOR')[]; 
  };
}

export class DeedSystem {

  static createDeed(
    chunkX: number, 
    chunkY: number, 
    layerId: string, 
    biome: string, 
    rank: UniversalRank
  ): IDeedItem {
    
    // 1. Determine Rarity
    let rarity = Rarity.COMMON;
    if (rank === UniversalRank.A) rarity = Rarity.RARE;
    if (rank === UniversalRank.S) rarity = Rarity.LEGENDARY;
    if (rank === UniversalRank.SS || rank === UniversalRank.SSS) rarity = Rarity.ARTIFACT;

    // 2. Determine Allowed Structures
    const allowedStructures: ('HOUSE' | 'WORKSHOP' | 'VENDOR')[] = ['HOUSE'];
    if (['A', 'S', 'SS', 'SSS'].includes(rank)) {
      allowedStructures.push('WORKSHOP');
    }
    if (['S', 'SS', 'SSS'].includes(rank)) {
      allowedStructures.push('VENDOR');
    }

    // 3. Construct the Item
    const deed: IDeedItem = {
      id: uuidv4(),
      universalDefinitionId: `deed_${biome.toLowerCase()}_${rank.toLowerCase()}`,
      name: `Land Deed: ${biome} Sector`,
      description: `A legal document granting ownership of a plot in the Hub. Sourced from the ${biome} regions.`,
      
      type: ItemType.DEED, 
      slot: SlotType.NONE,
      rank: rank,
      rarity: rarity,
      
      level: 1,
      quality: 100, // Deeds are always "Perfect" quality
      value: this.calculateDeedValue(rank), 
      
      // FIXED: Item Power added based on Rank
      itemPower: this.calculateItemPower(rank),

      affixes: [],       
      history: {
        dropDate: Date.now(),
        killCount: 0
      },
      visuals: {
        modelId: 'scroll_mesh',
        colorHex: '#C2B280', 
        iconUrl: '/icons/deed.png'
      },
      // Helper for UI
      icon: 'scroll_icon',
      
      isIdentified: true, 
      stats: {}, 

      // Discriminator
      itemType: 'DEED',
      
      // Data
      deedData: {
        originBiome: biome,
        originLayer: layerId,
        coordinateHash: `X:${chunkX}|Y:${chunkY}`,
        rank: rank,
        allowedStructures
      }
    };

    return deed;
  }

  static redeemDeed(
    deed: IDeedItem, 
    targetLotId: string, 
    player: { id: string; name: string }
  ): { success: boolean; message: string } {
    
    const hubStore = useHubStore.getState();
    const targetLot = hubStore.lots.find(l => l.id === targetLotId);

    if (!targetLot) return { success: false, message: "Lot does not exist." };
    if (targetLot.ownerId) return { success: false, message: "This lot is already owned." };

    const purchaseSuccess = hubStore.purchaseLot(targetLotId, player.id, player.name);

    if (!purchaseSuccess) return { success: false, message: "Failed to process lot transfer." };

    if (deed.deedData.rank === UniversalRank.S || deed.deedData.rank === UniversalRank.SS) {
         hubStore.setLotStructure(targetLotId, 'HOUSE');
    }

    return { 
      success: true, 
      message: `Lot ${targetLot.lotIndex} claimed successfully!` 
    };
  }

  static calculateDeedValue(rank: UniversalRank): number {
    const values: Record<string, number> = {
      'F': 100, 'E': 250, 'D': 500, 'C': 1000, 
      'B': 2500, 'A': 5000, 'S': 10000, 'SS': 25000, 'SSS': 50000
    };
    return values[rank] || 100;
  }

  // Maps Rank to a nominal Item Power so it sorts correctly in inventory
  static calculateItemPower(rank: UniversalRank): number {
    const ipMap: Record<string, number> = {
      'F': 50, 'E': 150, 'D': 350, 'C': 550, 
      'B': 750, 'A': 950, 'S': 1150, 'SS': 1350, 'SSS': 1550
    };
    return ipMap[rank] || 10;
  }
}
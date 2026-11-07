import { v4 as uuidv4 } from 'uuid';
import { IItem, UniversalRank, Rarity, ItemType, SlotType } from '../../../shared/types'; 
import { useHubStore } from '../../entities/hub/store'; 
import type { IPlayerPort } from '../../entities/player/playerView';

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
      quality: 0, // Wave 10D: the one scale — a deed takes no roll
      value: this.calculateDeedValue(rank),

      tags: ['deed', 'document', 'untradeable_on_death'],
      dimensions: { width: 1, height: 2 },
      weight: 0.1,
      
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

  static async redeemDeed(
    deed: IDeedItem,
    targetLotId: string,
    player: { id: string; name: string },
    pc: IPlayerPort
  ): Promise<{ success: boolean; message: string }> {
    
    const hubStore = useHubStore.getState();
    const targetLot = hubStore.lots.find(l => l.id === targetLotId);

    if (!targetLot) return { success: false, message: "Lot does not exist." };
    if (targetLot.ownerId) return { success: false, message: "This lot is already owned." };

    const purchaseSuccess = await hubStore.purchaseLot(targetLotId, player.id, player.name);

    if (!purchaseSuccess) return { success: false, message: "Failed to process lot transfer." };

    // Wave 5: the deed is CONSUMED by redemption, and the transfer is on the record
    pc.apply({ kind: 'STASH_REMOVE', ids: [deed.id] });
    const { Ledger } = await import('../ledger/Ledger');
    await Ledger.append('TRADE', { kind: 'DEED_REDEEMED', deedId: deed.id, lotId: targetLotId, playerDelta: 0, treasuryDelta: 0 });

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
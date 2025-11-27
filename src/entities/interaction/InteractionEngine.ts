import { IPlayer, IItem, InteractionType, IInteractionOption } from '../../../types';
import { EntityType, IWorldEntity } from '../world/types';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';

export class InteractionEngine {

  /**
   * The "Handshake": 
   * 1. Look at Target -> Get HarvestConfig
   * 2. Look at Inventory -> Find Tools with matching Tags & Power
   */
  static getAvailableInteractions(
    player: IPlayer, 
    target: IWorldEntity, 
    dist: number
  ): IInteractionOption[] {
    
    const options: IInteractionOption[] = [];
    const playerInventory = player.currentSession?.inventory || [];

    // 1. RESOLVE DEFINITION (In real app, query DB)
    // We assume target.definitionId maps to the Resource/Item definition
    const resourceDef = RESOURCE_DEFINITIONS[target.definitionId];

    // 2. RESOURCE INTERACTIONS (Dynamic)
    if (target.type === EntityType.RESOURCE && resourceDef?.harvestConfig && dist < 3.0) {
      const config = resourceDef.harvestConfig;
      
      // Find valid tools in inventory
      const validTools = playerInventory.filter(item => {
        // Check Tags (Is it a Pickaxe?)
        const itemTags = item.visuals.modelId === 'pickaxe' ? ['pickaxe'] : item.tags || []; // Fallback for legacy items
        // Note: Real implementation should check item.toolData.toolTags
        const hasTag = config.requiredToolTags.some(tag => 
            // Check both explicit toolData and general tags
            (item.toolData?.toolTags.includes(tag)) || itemTags.includes(tag) || item.name.toLowerCase().includes(tag)
        );

        // Check Power (Is it strong enough?)
        // In ItemFactory, we mapped 'mining_power' implicit to item stats. 
        // We assume item.stats['mining_power'] exists.
        const itemPower = item.stats['mining_power'] || item.stats['chopping_power'] || 0;
        
        return hasTag && itemPower >= config.minToolPower;
      });

      // If we have a valid tool, offer the interaction
      if (validTools.length > 0) {
        // Pick the best tool for the UI preview (highest power)
        const bestTool = validTools.sort((a,b) => (b.stats['mining_power']||0) - (a.stats['mining_power']||0))[0];
        
        options.push({
          id: `int_harvest_${target.id}`,
          label: `Extract ${resourceDef.name}`,
          type: InteractionType.HARVEST,
          icon: bestTool.icon || '🛠️',
          energyCost: config.energyCost,
          timeCostSeconds: config.baseTimeSeconds, // Could reduce based on tool efficiency
          requirements: { 
            toolType: config.requiredToolTags[0], // Display primary tag
            minSkillLevel: config.minToolPower
          },
          consequence: { 
            lootTableId: target.definitionId, 
            xpTags: ['gathering', 'strength'] 
          }
        });
      } else {
        // Option exists but is DISABLED (Feedback: "You need a Pickaxe (Power 10)")
        // We can handle this in UI by returning it with a 'disabled' flag or handling null requirements
      }
    }

    // 2. STUDY (Science)
    // Condition: Target is ANYTHING, Player has Scanner OR High Intel
    if (dist < 10.0) {
      const hasScanner = playerInventory.some(i => i.name.includes('Scanner'));
      const intel = player.attributes?.intelligence || 0;

      if (hasScanner || intel > 3) {
        options.push({
          id: 'int_study',
          label: 'Analyze Structure',
          type: InteractionType.STUDY,
          icon: '🔍',
          energyCost: 2,
          timeCostSeconds: 5.0,
          requirements: { skillId: 'analysis' },
          consequence: { knowledgeId: target.definitionId, xpTags: ['intel', 'science'] }
        });
      }
    }

    // 3. PICKUP (Simple)
    if (target.type === EntityType.CONTAINER || (target.type === EntityType.RESOURCE && target.rank === 'F')) {
       if (dist < 2.0) {
         options.push({
           id: 'int_pickup',
           label: 'Grab',
           type: InteractionType.PICKUP,
           icon: '✋',
           energyCost: 0,
           timeCostSeconds: 0.5,
           requirements: {},
           consequence: {}
         });
       }
    }

    return options;
  }
}
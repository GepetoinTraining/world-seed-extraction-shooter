import { IPlayer, IItem, InteractionType, IInteractionOption } from '../../../types';
import { EntityType, IWorldEntity } from '../world/types';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { WebSystem } from '../../logic/systems/WebSystem';
import { StatSystem } from '../../logic/systems/StatSystem';

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
    // Wave 10C: tools ride their own slots — the harness answers alongside the pack
    const playerInventory = [
      ...(player.currentSession?.inventory || []),
      ...(player.equipment?.items || [])
    ];

    // 1. RESOLVE DEFINITION (In real app, query DB)
    // We assume target.definitionId maps to the Resource/Item definition
    const resourceDef = RESOURCE_DEFINITIONS[target.definitionId];

    // 2. RESOURCE INTERACTIONS (Wave 2.2: bare hands allowed when no tool required)
    if (target.type === EntityType.RESOURCE && resourceDef?.harvestConfig && dist < 3.0) {
      const config = resourceDef.harvestConfig;

      // Depleted nodes offer nothing
      if ((target.usesRemaining ?? 1) <= 0) return options;

      const bareHands = config.requiredToolTags.length === 0;

      // Find valid tools in inventory (tag match + enough power)
      const validTools = playerInventory.filter(item => {
        const itemTags = item.tags || [];
        const hasTag = config.requiredToolTags.some(tag =>
            (item.toolData?.toolTags.includes(tag)) || itemTags.includes(tag) || item.name.toLowerCase().includes(tag)
        );
        const itemPower = item.stats['mining_power'] || item.stats['chopping_power'] || 0;
        return hasTag && itemPower >= config.minToolPower;
      });

      if (bareHands || validTools.length > 0) {
        const bestTool = validTools.sort((a,b) => (b.stats['mining_power']||0) - (a.stats['mining_power']||0))[0];

        options.push({
          id: `int_harvest_${target.id}`,
          label: `Extract ${resourceDef.name}`,
          type: InteractionType.HARVEST,
          icon: bareHands ? '✋' : (bestTool.icon || '🛠️'),
          // D27: the menu says what the store will charge: winging it costs more
          energyCost: WebSystem.energyFor(player, WebSystem.pairOfHarvest(player, resourceDef), config.energyCost).cost,
          timeCostSeconds: config.baseTimeSeconds,
          requirements: {
            toolType: config.requiredToolTags[0],
            minSkillLevel: config.minToolPower
          },
          consequence: {
            lootTableId: target.definitionId,
            xpTags: ['gathering', 'strength']
          }
        });
      }
      // else: wrong/no tool -> no option. The refusal IS the message (test line 7).
    }

    // 2b. CONTAINERS (Wave 2.3: ruin chests)
    if (target.type === EntityType.CONTAINER && target.container && dist < 3.0) {
      if (!target.container.looted) {
        options.push({
          id: `int_open_${target.id}`,
          label: 'Open Container',
          type: InteractionType.OPEN,
          icon: '📦',
          energyCost: 2,
          timeCostSeconds: 1.0,
          requirements: {},
          consequence: { lootTableId: 'chest', xpTags: ['scavenging'] }
        });
      }
    }

    // 2c. NPCs (Wave 2.4: the social extraction loop)
    if (target.type === EntityType.NPC && target.npc && dist < 4.0) {
      const npc = target.npc;

      options.push({
        id: `int_talk_${target.id}`,
        label: `Talk (${npc.name} · ${npc.disposition}/100)`,
        type: InteractionType.COMMUNE,
        icon: '💬',
        energyCost: 5,
        timeCostSeconds: 2.0,
        requirements: { skillId: 'charisma' },
        consequence: { xpTags: ['social', 'charisma'] }
      });

      // Offer a gift if the player carries anything at all
      if (playerInventory.length > 0) {
        options.push({
          id: `int_gift_${target.id}`,
          label: `Give Gift (they want: ${npc.want})`,
          type: InteractionType.COMMUNE,
          icon: '🎁',
          energyCost: 2,
          timeCostSeconds: 1.0,
          requirements: {},
          consequence: { xpTags: ['social', 'trade'] }
        });
      }

      // The payoff: enough disposition and they will follow, and leadership asks less of it
      if (npc.disposition >= StatSystem.recruitDisposition(player.attributes)) {
        options.push({
          id: `int_recruit_${target.id}`,
          label: 'Secure for Extraction',
          type: InteractionType.COMMUNE,
          icon: '🤝',
          energyCost: 5,
          timeCostSeconds: 2.0,
          requirements: {},
          consequence: { xpTags: ['social', 'rescue'] }
        });
      }
    }

    // 2d. THE CART (Wave 10C, D16): tow, release, open — anyone may, and a
    // tow that is not yours becomes a signed fact. The labels say so plainly.
    if (target.type === EntityType.CART && target.cart && dist < 3.0) {
      const cart = target.cart;
      const mine = cart.ownerId === player.id;
      const towingThis = player.currentSession?.towingCartId === target.id;
      if (towingThis) {
        options.push({
          id: `int_cartrelease_${target.id}`,
          label: 'Release the tow bar',
          type: InteractionType.PICKUP,
          icon: '', energyCost: 0, timeCostSeconds: 0,
          requirements: {}, consequence: {}
        });
      } else {
        options.push({
          id: `int_carttow_${target.id}`,
          label: mine ? 'Tow your cart'
            : `Tow it away (${cart.ownerName}'s seal${cart.security?.lockLevel ? ` — ${cart.security.lockLevel} lock${cart.security.lockLevel === 1 ? '' : 's'} to break` : ''} — the theft will be signed)`,
          type: InteractionType.PICKUP,
          icon: '', energyCost: 0, timeCostSeconds: 0,
          requirements: {}, consequence: {}
        });
      }
      options.push({
        id: `int_cartopen_${target.id}`,
        label: `Open the cart bed (${cart.items.length} aboard)`,
        type: InteractionType.OPEN,
        icon: '', energyCost: 0, timeCostSeconds: 0,
        requirements: {}, consequence: {}
      });
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
          consequence: { knowledgeId: target.definitionId, xpTags: ['intel', 'analysis'] }
        });
      }
    }

    return options;
  }
}
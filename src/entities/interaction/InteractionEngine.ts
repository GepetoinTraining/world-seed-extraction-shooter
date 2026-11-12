import { IPlayer, IItem, InteractionType, IInteractionOption } from '../../../shared/types';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { isLooseStone } from '../../../shared/entities/item/Throwable';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { Capture } from '../../../shared/logic/systems/Capture';
import { MonsterMind } from '../../logic/systems/MonsterMind';
import { WorkCost } from '../../../shared/logic/systems/WorkCost';
import { ContactNames } from '../../logic/systems/ContactNames';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { ExtractLaw } from '../../../shared/logic/systems/ExtractLaw';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { StudySystem } from '../../logic/systems/StudySystem';

/** D109: you can't talk across a distance. The same reach for a person and a monster. */
export const TALK_REACH_TILES = 4.0;

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

    // 2. RESOURCE INTERACTIONS. ML (Pedro, 2026-11-12: "the right click studies or inspects or tries to use the tool"):
    // a place offers the try of the tool that fits it, a look at it, and a sitting with it. A loose stone is only picked up.
    if (target.type === EntityType.RESOURCE && resourceDef?.harvestConfig && dist < 3.0 && !isLooseStone(resourceDef)) {
      const knows = WebSystem.knowledgeReader(player);
      const name = ContactNames.of(target, knows, player);
      if ((target.usesRemaining ?? 1) > 0) {
        const hand = ExtractLaw.hand(player, resourceDef);
        if (hand) {
          options.push({
            id: `int_try_${target.id}`,
            label: hand.tool ? `Try the ${LoadoutSystem.shownName(hand.tool)} on ${name}` : `Try your hands on ${name}`,
            type: InteractionType.HARVEST,
            icon: hand.tool ? (hand.tool.icon || '') : '',
            // D27: the menu says what the store will charge: winging it costs more
            energyCost: WebSystem.energyFor(player, hand.pair, resourceDef.harvestConfig.energyCost).cost,
            timeCostSeconds: resourceDef.harvestConfig.baseTimeSeconds,
            requirements: { toolType: ExtractLaw.asks(resourceDef)[0] },
            consequence: { lootTableId: target.definitionId, xpTags: ['gathering', 'strength'] }
          });
        }
      }
      options.push({
        id: `int_inspect_${target.id}`, label: `Inspect ${name}`, type: InteractionType.STUDY, icon: '',
        energyCost: 0, timeCostSeconds: 0, requirements: {}, consequence: {}
      });
      // Study is always there for its energy (D118); what it is told is only what this person can see of it (S1k)
      const shown = knows(target.definitionId) >= 1 ? [...(resourceDef.tags ?? [])] : [];
      // A person with no bank yet (a sheet being drawn up) is asked the whole of it
      const ask = player.bank ? StudySystem.studyAsk(player, StudySystem.targetOfThing({ id: target.id, name, rank: target.rank, tags: shown })) : { cost: 0, seconds: 0 };
      options.push({
        id: `int_studyplace_${target.id}`, label: `Study ${name}`, type: InteractionType.STUDY, icon: '',
        energyCost: ask.cost, timeCostSeconds: ask.seconds,
        requirements: {}, consequence: { knowledgeId: target.definitionId, xpTags: ['intel', 'analysis'] }
      });
      return options;
    }

    // 2. A LOOSE STONE (C14): picked up, as it will be thrown. No roll: a stone off the ground is not worked.
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
          // C14: a loose stone is picked up, as it will be thrown; everything else is still extracted.
          // It is named as its card names it: by its form, until this character has worked it or holds some
          label: `${isLooseStone(resourceDef) ? 'Pick up' : 'Extract'} ${ContactNames.of(target, WebSystem.knowledgeReader(player), player)}`,
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

    // 2a. A BODY, WITH A SNARE IN THE PACK (D65). It offers nothing to anyone without one.
    if (target.type === EntityType.MOB && (target.health ?? 0) > 0 && dist < 3.0 && Capture.canSnare(playerInventory, target.id, MOB_DEFINITIONS[target.definitionId])) {
      options.push({
        id: `int_snare_${target.id}`,
        label: 'Set a Snare',
        type: InteractionType.PICKUP,
        icon: 'snare',
        energyCost: WorkCost.of(player, 'snare'),
        timeCostSeconds: 2.0,
        requirements: {},
        consequence: { xpTags: ['trapping'] }
      });
    }

    // 2b. CONTAINERS (Wave 2.3: ruin chests)
    if (target.type === EntityType.CONTAINER && target.container && dist < 3.0) {
      if (!target.container.looted) {
        options.push({
          id: `int_open_${target.id}`,
          label: 'Open Container',
          type: InteractionType.OPEN,
          icon: '📦',
          energyCost: WorkCost.of(player, 'open'),
          timeCostSeconds: 1.0,
          requirements: {},
          consequence: { lootTableId: 'chest', xpTags: ['scavenging'] }
        });
      }
    }

    // Q16: a person brought out who fell is carried, and that is all. Nothing of theirs comes open.
    if (target.type === EntityType.NPC && target.escort?.fallen && dist < TALK_REACH_TILES) {
      return [{
        id: `int_carry_${target.id}`,
        label: `Carry (${ContactNames.knowsName(player, target) ? target.npc!.name : 'them'})`,
        type: InteractionType.COMMUNE,
        icon: '',
        energyCost: 0,
        timeCostSeconds: 0,
        requirements: {},
        consequence: { xpTags: ['rescue'] }
      }];
    }

    // 2c. NPCs (D113): you talk to a person now. The menu opens the talk, and a gift is offered inside it.
    if (target.type === EntityType.NPC && target.npc && dist < TALK_REACH_TILES) {
      const npc = target.npc;

      options.push({
        id: `int_talk_${target.id}`,
        // A person has no name until it is asked: the prompt says who the character knows them as
        label: `Talk (${ContactNames.personName(target, player)} · ${npc.disposition}/100)`,
        type: InteractionType.COMMUNE,
        icon: '',
        energyCost: WorkCost.of(player, 'round'),
        timeCostSeconds: 0,
        requirements: { skillId: 'charisma' },
        consequence: { xpTags: ['social', 'charisma'] }
      });

      // The payoff: enough disposition and they will follow, and leadership asks less of it
      if (!target.escort && npc.disposition >= StatSystem.recruitDisposition(player.attributes)) {
        options.push({
          id: `int_recruit_${target.id}`,
          label: 'Secure for Extraction',
          type: InteractionType.COMMUNE,
          icon: '🤝',
          energyCost: WorkCost.of(player, 'secure'),
          timeCostSeconds: 2.0,
          requirements: {},
          consequence: { xpTags: ['social', 'rescue'] }
        });
      }
    }

    // 2c-ii. D114: a monster that has reached speech. Only a right click comes here: the interact key walks past monsters.
    if (target.type === EntityType.MOB && dist < TALK_REACH_TILES && MonsterMind.speaks(MOB_DEFINITIONS[target.definitionId])) {
      const stance = target.bargain?.stance;
      options.push({
        id: `int_bargain_${target.id}`,
        label: stance ? `Bargain (${stance.toLowerCase()})` : 'Bargain',
        type: InteractionType.COMMUNE,
        icon: '',
        energyCost: WorkCost.of(player, 'round'),
        timeCostSeconds: 0,
        requirements: { skillId: 'charisma' },
        consequence: { xpTags: ['social', 'charisma'] }
      });
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
    // Condition: Target is ANYTHING, Player has Scanner OR High Intel. A place has its own sitting (ML), above.
    if (dist < 10.0 && target.type !== EntityType.RESOURCE) {
      const hasScanner = playerInventory.some(i => i.name.includes('Scanner'));
      const intel = player.attributes?.intelligence || 0;

      if (hasScanner || intel > 3) {
        options.push({
          id: 'int_study',
          label: 'Analyze Structure',
          type: InteractionType.STUDY,
          icon: '🔍',
          energyCost: WorkCost.of(player, 'analyze'),
          timeCostSeconds: 5.0,
          requirements: { skillId: 'analysis' },
          consequence: { knowledgeId: target.definitionId, xpTags: ['intel', 'analysis'] }
        });
      }
    }

    return options;
  }
}
import { VectorStore } from './VectorStore';
import { ITEM_DEFINITIONS } from '../item/data/itemDefinitions';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { SPELL_DEFINITIONS } from '../magic/data/spellDefinitions';
import { AFFIX_DEFINITIONS } from '../item/data/affixDefinitions';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { COGNITIVE_FRAMES } from '../player/data/cognitiveFrames';
import { GENRE_DEFINITIONS } from '../world/definitions';

export class GenesisInitializer {
  
  static async initialize() {
    console.log('[GENESIS] Initiating Sequence... Wiping & Reseeding Ledger.');
    
    let count = 0;

    // 1. ITEMS
    const allItems = [
        ...ITEM_DEFINITIONS.weapon_bases,
        ...ITEM_DEFINITIONS.armor_bases,
        ...ITEM_DEFINITIONS.tool_bases
    ];

    for (const item of allItems) {
      await VectorStore.saveContent(
        item.id,
        'ITEM_DEFINITION',
        item,
        item.tags.join(' ')
      );
      count++;
    }

    // 2. MOBS
    for (const mob of Object.values(MOB_DEFINITIONS)) {
      await VectorStore.saveContent(
        mob.id,
        'MOB_DEFINITION',
        mob,
        `${mob.genre} ${mob.behavior}`
      );
      count++;
    }

    // 3. SPELLS
    for (const spell of Object.values(SPELL_DEFINITIONS)) {
      await VectorStore.saveContent(
        spell.id,
        'SPELL_DEFINITION',
        spell,
        `${spell.element} ${spell.scale}`
      );
      count++;
    }

    // 4. AFFIXES
    const allAffixes = [...AFFIX_DEFINITIONS.prefixes, ...AFFIX_DEFINITIONS.suffixes];
    for (const affix of allAffixes) {
      await VectorStore.saveContent(
        affix.id,
        'AFFIX_DEFINITION',
        affix,
        `modifier tier_${affix.tier} ${affix.type}`
      );
      count++;
    }

    // 5. RESOURCES
    for (const res of Object.values(RESOURCE_DEFINITIONS)) {
      // FIXED: Access 'res.icon' directly, falling back to empty string if undefined
      await VectorStore.saveContent(
        res.id,
        'RESOURCE_DEFINITION',
        res,
        `material natural harvestable ${res.icon || ''}`
      );
      count++;
    }

    // 6. FRAMES
    for (const frame of Object.values(COGNITIVE_FRAMES)) {
      await VectorStore.saveContent(
        frame.id,
        'COGNITIVE_FRAME',
        frame,
        `mental stance ${frame.type} psychology`
      );
      count++;
    }

    // 7. GENRES
    for (const [key, genre] of Object.entries(GENRE_DEFINITIONS)) {
      await VectorStore.saveContent(
        `genre_${key.toLowerCase()}`,
        'GENRE_DEFINITION',
        { id: key, ...genre },
        'theme aesthetic setting'
      );
      count++;
    }

    console.log(`[GENESIS] Sequence Complete. Seeded ${count} entities into the Vector Ledger.`);
    return count;
  }
}
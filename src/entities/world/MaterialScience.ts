import { IItem, IPlayer, UniversalRank } from '../../../types';
import { MaterialPropertyType } from '../economy/types';

// Definition of a Material Affix (The "Hidden" DNA)
export interface IMaterialAffix {
  id: string;
  name: string;          // e.g. "Dense", "Volatile", "Harmonic"
  tier: number;
  modifiers: Partial<Record<MaterialPropertyType, number>>; // e.g. { DENSITY: 1.5 }
  discoveryThreshold: number; // Knowledge Level required to see this (e.g. 3)
}

// Global Registry of Material Affixes
export const MATERIAL_AFFIXES: Record<string, IMaterialAffix> = {
  'aff_dense': { 
    id: 'aff_dense', name: 'Compressed', tier: 1, 
    modifiers: { [MaterialPropertyType.DENSITY]: 1.5 }, 
    discoveryThreshold: 2 
  },
  'aff_volatile': { 
    id: 'aff_volatile', name: 'Volatile', tier: 2, 
    modifiers: { [MaterialPropertyType.TOXICITY]: 2.0 }, 
    discoveryThreshold: 3 
  },
  'aff_arcane': { 
    id: 'aff_arcane', name: 'Ley-Touched', tier: 3, 
    modifiers: { [MaterialPropertyType.RESONANCE]: 3.0 }, 
    discoveryThreshold: 3 
  }
};

export class MaterialScience {

  /**
   * INSPECT: The Player looks at an Item.
   * Returns only what the player understands.
   */
  static inspectMaterial(item: IItem, player: IPlayer): { 
    name: string; 
    knownProps: Partial<Record<MaterialPropertyType, number>>;
    unknownCount: number;
  } {
    const knowledge = player.materialMastery[item.universalDefinitionId] || { knowledgeLevel: 0, discoveredAffixes: [] };
    
    // Level 0: "Unidentified Matter"
    if (knowledge.knowledgeLevel < 1) {
      return { name: "Unknown Substance", knownProps: {}, unknownCount: 99 };
    }

    let displayName = item.name;
    const knownProps: any = {};
    let unknownCount = 0;

    // Base Properties (Revealed at Level 2)
    if (knowledge.knowledgeLevel >= 2) {
      // Mocking base lookup - in real app, fetch from DB
      if (item.weight > 4) knownProps[MaterialPropertyType.DENSITY] = 10;
    } else {
      unknownCount++;
    }

    // Affixes (Revealed at Level 3+)
    // Note: Items need to store their affix IDs in `item.affixes` or similar
    // For this implementation, we assume `item.affixes` contains IMaterialAffix objects or IDs
    if (item.affixes) {
      item.affixes.forEach((affix: any) => {
        // Find the definition
        const def = MATERIAL_AFFIXES[affix.id]; // Simplified lookup
        if (!def) return;

        if (knowledge.knowledgeLevel >= def.discoveryThreshold) {
          displayName = `${def.name} ${displayName}`;
          // Merge props
          Object.entries(def.modifiers).forEach(([key, val]) => {
            knownProps[key] = (knownProps[key] || 0) + (val as number);
          });
        } else {
          unknownCount++;
        }
      });
    }

    return { name: displayName, knownProps, unknownCount };
  }

  /**
   * STUDY: The Player spends time analyzing a material.
   * Increases Knowledge Level.
   */
  static studyMaterial(resourceId: string, player: IPlayer): IPlayer {
    const knowledge = player.materialMastery[resourceId] || { 
      resourceId, 
      knowledgeLevel: 0, 
      discoveredAffixes: [] 
    };

    // Increment Knowledge
    // In a real game, this would be XP based. Here we just level up.
    if (knowledge.knowledgeLevel < 3) {
      knowledge.knowledgeLevel++;
    }

    return {
      ...player,
      materialMastery: {
        ...player.materialMastery,
        [resourceId]: knowledge
      }
    };
  }
}
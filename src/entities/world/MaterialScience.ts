import { IPlayer } from '../../../shared/types';

/**
 * STUDY (legacy, kept): the field's "Analyze Structure" raises what a player knows of a thing, up to three.
 * CP15, 2026-11-13: the three material affixes this file held and the inspection that read them are gone; nothing in
 * the game gave or read them. What a material is now comes from its world and its
 * spread (ML), and what a step adds to it from the affix bank's processes.
 */
export class MaterialScience {

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

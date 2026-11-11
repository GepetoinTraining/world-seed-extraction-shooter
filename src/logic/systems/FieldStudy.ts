/**
 * What a person can study of a thing beside them in the field (S1k, 2026-11-11). A field thing passes to study the
 * tags it shows, what the person looking at it can already know of it and nothing more, so knowing its tree makes it
 * cheaper and an unknown thing gives nothing away (D32):
 *   - a harvestable thing (a tree, a rock, a vein) shows its own tags once its kind is known (knowledge 1 or more,
 *     which holding one of it also gives), and none before: it is "Unknown Rock" until then;
 *   - a creature shows its kind's tags once its kind is known, by the same reader, and its name stays the masked
 *     name the screen gives it (D60);
 *   - a person shows none: a name not yet asked stays out, and what they are good at is learned by talking (D27),
 *     which a person files nowhere (S2b);
 *   - anything else in the field (a chest, a ruin, an exit) shows none: its card says only its rank.
 */

import { IPlayer, IStudyTarget } from '../../../shared/types';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { inspectEntity } from '../../render/atoms/inspect';
import { StudySystem } from './StudySystem';
import { ContactNames } from './ContactNames';

export const FieldStudy = {
  /** The tags this thing shows this person: its kind's own, once the kind is known; nothing otherwise. */
  shownTags(e: IWorldEntity, player: IPlayer, knows: (defId: string) => number = WebSystem.knowledgeReader(player)): string[] {
    if (e.npc || e.type === EntityType.NPC) return [];
    if (knows(e.definitionId) < 1) return [];
    if (e.type === EntityType.MOB) return [...(MOB_DEFINITIONS[e.definitionId]?.tags ?? [])];
    if (e.type === EntityType.RESOURCE) return [...((RESOURCE_DEFINITIONS[e.definitionId] as { tags?: string[] } | undefined)?.tags ?? [])];
    return [];
  },

  target(e: IWorldEntity, player: IPlayer): IStudyTarget {
    const knows = WebSystem.knowledgeReader(player);
    const tags = this.shownTags(e, player, knows);
    if (e.type === EntityType.MOB) return StudySystem.targetOfCreature({ definitionId: e.definitionId, displayName: e.displayName, rank: e.rank, tags });
    // A person has no name until it is asked, so one never asked is studied as an unknown figure
    if (e.npc) return StudySystem.targetOfPerson({ id: e.id, name: ContactNames.personName(e, player), rank: e.rank });
    // The inspect card's own title, read with what this person knows: what can be seen of it, and nothing more
    return StudySystem.targetOfThing({ id: e.id, name: inspectEntity(e, { player, dist: 0, level: knows }).title, rank: e.rank, tags });
  }
};

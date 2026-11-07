/**
 * Q1: who crosses a world's skilled ground. Its dressing names one registry word
 * ("climb"); a person who holds a skill carrying that word crosses it. A world
 * written before terrain was dressed has no crossing, so its rock stays blocked.
 */

import type { IPlayer } from '../../../shared/types';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import type { IThemeBody, IThemeTerrain, TerrainRole } from '../../../shared/logic/theme/ThemeTypes';

export class TerrainCrossing {

  static dressing(pack: Pick<IThemeBody, 'terrain'> | undefined, role: TerrainRole): IThemeTerrain | undefined {
    return pack?.terrain?.find(t => t.role === role);
  }

  /** The skills this person holds, by their tags: what a rest named them (D58). */
  static heldTags(player: Pick<IPlayer, 'skillWords'>): Set<string> {
    const tags = new Set<string>();
    for (const id of Object.keys(player.skillWords ?? {})) {
      for (const tag of TagLaw.parseSkillId(id) ?? []) tags.add(tag);
    }
    return tags;
  }

  static crossesSkilled(player: Pick<IPlayer, 'skillWords'> | undefined, pack: Pick<IThemeBody, 'terrain'> | undefined): boolean {
    const word = this.dressing(pack, 'skilled')?.crossing;
    return !!(player && word && this.heldTags(player).has(word));
  }
}

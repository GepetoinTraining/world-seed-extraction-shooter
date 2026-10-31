import { TagLaw } from '../../../logic/content/TagLaw';
import { WebBank } from '../../../logic/content/WebBank';

export interface IActionContext {
  tags: string[];
  magnitude: number;
  /** D27: what the action was done to: its tags and its rank. Only what identifies counts. */
  targetTags?: string[];
  targetRank?: string;
}

/**
 * What an action context implies, by the tag law (D28) and nothing else. This used
 * to be a short fixed table over action tags with a fallback that invented a name;
 * now a context's identity is whatever of its tags the registry says identifies.
 * A target adds its family, never its magnitude. A context with nothing that
 * identifies mints nothing at all.
 */
export class SkillDiscovery {
  static identify(context: IActionContext): { id: string; tags: string[] } | null {
    const pack = WebBank.current();
    const own = context.tags.filter(t => WebBank.isIdentityTag(pack, t));
    const target = (context.targetTags ?? []).filter(t => WebBank.isIdentityTag(pack, t));
    const tags = TagLaw.canonical([...own, ...target]);
    return tags.length > 0 ? { id: TagLaw.skillIdOf(tags), tags } : null;
  }

  static discoverSkill(context: IActionContext): string | null {
    return this.identify(context)?.id ?? null;
  }
}

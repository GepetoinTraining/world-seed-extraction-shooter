/**
 * A SKILL AS A PLAYER NAMES IT (GV, part 2, 2026-11-12). Pedro: "literally it called the loadout a harness". A skill
 * nobody has named read as its tag list wherever the game said it ("First in this hub to reach Blunt on mineral, stone.").
 * Every screen and feed line that names a skill asks here: its own name where one was given (by its finder, by a rest, by
 * the bank), and otherwise what it is, said in the tag registry's player words (`ITagEntry.say`): "Hammering rock and
 * stone". Never its tag list (Q47). Words only; the id and the rules never change.
 */

import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { WebBank } from '../../../shared/logic/content/WebBank';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { IHubWeb } from '../../../shared/types';

type Pack = ReturnType<typeof WebBank.current>;

const DOING_KINDS = ['tool', 'trade', 'action'] as const;
const WORKED_KINDS = ['family', 'material', 'element'] as const;

/** A tag as a player says it: the registry's word, or the tag itself as plain words. */
export const sayOf = (pack: Pack, tag: string): string => pack.tags.find(t => t.tag === tag)?.say ?? tag.replace(/_/g, ' ');
export const listed = (words: string[]): string => words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unique = (words: string[]) => [...new Set(words)];

export const SkillNames = {
  /** What a skill is, from its tags: "Shooting beasts and devices", "Sawing plants and wood", "Berries and plants, by hand". */
  whatItIs(tags: string[], pack: Pack = WebBank.current()): string {
    const doing = unique(tags.filter(t => WebBank.hasKind(pack, t, [...DOING_KINDS])).map(t => sayOf(pack, t)));
    const worked = unique(tags.filter(t => WebBank.hasKind(pack, t, [...WORKED_KINDS])).map(t => sayOf(pack, t)));
    if (doing.length === 0) return worked.length ? `${capital(listed(worked))}, by hand` : 'Work by hand';
    return capital([listed(doing), listed(worked)].filter(Boolean).join(' '));
  },

  /** A skill's name as a player reads it: the name given it, unless that is only its tag list; else what it is. */
  nameOf(id: string, given?: string, pack: Pack = WebBank.current()): string {
    const named = given?.trim() ? given : WebSystem.bankNameOf(id, pack);
    if (named && !WebSystem.isTagListName(id, named, pack)) return named;
    const tags = TagLaw.parseSkillId(id);
    return tags && tags.length > 0 ? this.whatItIs(tags, pack) : WebSystem.nameOf(id, pack);
  },

  /** The name a hub knows a skill by: the first one's, where they named it, else as above (Q9). */
  nameIn(id: string, web: IHubWeb | undefined, pack: Pack = WebBank.current()): string {
    return this.nameOf(id, web?.nodes[id]?.name, pack);
  }
};

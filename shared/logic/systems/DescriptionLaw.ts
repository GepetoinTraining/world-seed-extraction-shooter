/**
 * WHEN A DESCRIPTION OPENS (UXS, 2026-11-12). Pedro, on the sheet put to him as "numbers first and each sentence one step
 * behind": "yup, and hover click opens description, description opens only if the skill to describe it is found UAHUAHUA".
 *
 * A line on a sheet (and, later, a card) shows its word and its number to anyone. What it means, its description, opens
 * only for a character who holds the skill that describes it: the skill in the tech web the line roots in. Pedro,
 * 2026-11-07: everything named "needs to be rooted in tech web". A root is read from what the line's number is read from,
 * by rules the web already has, and this file names no skill, no tag and no line:
 *   - a skill's own line roots in that skill; an act's line in the skill the act trains (`WorkCost.pairOf` gives its id);
 *   - a line read from a thing in the hand roots in a skill that answers to the thing, every word of it on the thing, as
 *     the fight reads a weapon (`WebSystem.fits`, which `handPower` uses);
 *   - a line about a bench roots in a skill whose work raises the bench (`WebSystem.benchesOf`);
 *   - a line the web roots nowhere yet is a gap (`GAP`). It opens on the nearest rule that does exist: a schooled eye held,
 *     the web's own skill for reading what is worked into a thing. A gap is listed in the ledger, never paired here.
 *
 * Only skills held count: one forming describes nothing yet, and a track from an old save the web cannot read is off it.
 * Pure: the skills in, a yes or a no out. A card asks it the same way: `DescriptionLaw.opens(skills, DescriptionLaw.on(item.tags))`.
 */

import type { ISkillState, IWebPack } from '../../types';
import { WebBank } from '../content/WebBank';
import { WebSystem } from './WebSystem';

/** A held skill as the law reads it: its id and its words. */
type Held = Pick<ISkillState, 'id' | 'tags'>;

/** What describes a line: a test a held skill passes or fails. `null` is a gap, a line the web roots nowhere yet. */
export type DescriptionRoot = ((skill: Held) => boolean) | null;

/** The schooled eye's words begin so (the identify trades: "The schooled eye for what is worked into ..."). */
const EYE_WORD = 'identify';

export const DescriptionLaw = {
  /** A line the web roots nowhere yet. */
  GAP: null as DescriptionRoot,

  /** A skill's own line, or an act's: that very skill. */
  itself(id: string): DescriptionRoot {
    return skill => skill.id === id;
  },

  /** A line read from a thing in the hand: a skill that answers to it. A thing with nothing on it has nothing to read. */
  on(tags: readonly string[]): DescriptionRoot {
    if (tags.length === 0) return this.GAP;
    return skill => WebSystem.fits(skill, tags);
  },

  /** A line about a bench: a skill whose work raises it. */
  bench(stationId: string, pack: IWebPack = WebBank.current()): DescriptionRoot {
    return skill => WebSystem.benchesOf(skill.tags, pack).includes(stationId);
  },

  /** The schooled eye: a skill that reads what is worked into a kind of thing. */
  isEye(tags: readonly string[]): boolean {
    return tags.some(t => t.startsWith(EYE_WORD));
  },

  /** Whether a line's description opens for someone holding these skills. */
  opens(skills: Record<string, ISkillState> | undefined, root: DescriptionRoot): boolean {
    const held = WebSystem.heldSkills(skills ?? {});
    return root ? held.some(root) : held.some(s => this.isEye(s.tags));
  }
};

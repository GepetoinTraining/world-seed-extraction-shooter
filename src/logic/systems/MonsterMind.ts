/**
 * A MONSTER'S MIND (D114). Pedro: "it's a skill, intelligent means it can develop mental stats and
 * achieve speech. humanoid monsters should possess it by default, speech bubbles over their head
 * on occasion shows that to the player".
 *
 * So it is one skill on the web, `skill_intelligent`, read through the same record as a person's.
 * A kind holds it by being humanoid, or by carrying the word, which a pack can write and a line
 * can bring. Holding it, a body's mental stats are dealt from its seed as far as the skill has
 * come, and at SPEECH_RUNG it can be talked to. Everything else about a monster stays as it was:
 * "monsters are foes, unless you're charismatic as fuck."
 *
 * Nothing here is stored. A body reads the same from (seed, id, its kind's line) on any machine.
 */

import { IAttributes, ISkillState, MENTAL_ATTRIBUTES } from '../../../shared/types';
import { MobBehavior } from '../../../shared/entities/mob/types';
import { INpcSheet, IWorldEntity } from '../../../shared/entities/world/types';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { NpcSheet } from '../../../shared/logic/systems/NpcSheet';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { RUNG_XP, WebSystem } from '../../../shared/logic/systems/WebSystem';

export const MIND_TAGS = ['intelligent'];
const BORN_THINKING = 'humanoid';

/** The rung of the skill at which it can talk. A humanoid is born here. */
export const SPEECH_RUNG = 1;
/** Guesses until Wave 12. What each step of a kind's own line teaches it, and where friendly starts. */
const XP_PER_GENERATION = 50;
const FRIENDLY_OF_WHATS_LEFT = 2 / 3;
const COLD_START = 10;

export type Stance = 'AGGRESSIVE' | 'NEUTRAL' | 'FRIENDLY';

interface IMindKind { tags?: string[]; generation?: number }

const holds = (kind: IMindKind | undefined) =>
  !!kind?.tags?.some(tag => tag === BORN_THINKING || MIND_TAGS.includes(tag));

/** How far the skill has come in this kind: a humanoid starts at speech, and a line teaches. */
function skillOf(kind: IMindKind): ISkillState {
  const pair = WebSystem.mint(MIND_TAGS, []);
  const born = kind.tags?.includes(BORN_THINKING) ? WebSystem.rungXp(SPEECH_RUNG, 0) : 0;
  return WebSystem.withCumulativeXp(WebSystem.freshSkill(pair.id, pair.tags, 0), born + (kind.generation ?? 0) * XP_PER_GENERATION);
}

export const MonsterMind = {
  holds,

  speaks(kind: IMindKind | undefined): boolean {
    return holds(kind) && WebSystem.masteryOf(skillOf(kind!)).rung >= SPEECH_RUNG;
  },

  /** The body's sheet: its mental stats come only as far as the skill has. A beast has none to speak of. */
  read(worldSeed: string, entity: Pick<IWorldEntity, 'id' | 'rank'>, kind: IMindKind, _webVersion?: number): { skill: ISkillState | null; stats: IAttributes } {
    const dealt = NpcSheet.statsOf(worldSeed, entity);
    const skill = holds(kind) ? skillOf(kind) : null;
    const stats = { ...dealt };
    if (!skill) {
      for (const attr of MENTAL_ATTRIBUTES) stats[attr] = 0;
      return { skill, stats };
    }
    // Everyone with a mind has the rank's floor of one. What the skill develops is what is over it.
    const share = (WebSystem.masteryOf(skill).rung + 1) / RUNG_XP.length;
    const floor = 1 + ProgressionSystem.rankIndex(entity.rank);
    for (const attr of MENTAL_ATTRIBUTES) stats[attr] = floor + Math.round((dealt[attr] - floor) * share);
    return { skill, stats };
  },

  /** D114: "to lower from aggressive to neutral would be the same as getting the npc itself". */
  stance(disposition: number, attributes?: IAttributes): Stance {
    const line = StatSystem.recruitDisposition(attributes);
    if (disposition >= line + (100 - line) * FRIENDLY_OF_WHATS_LEFT) return 'FRIENDLY';
    return disposition >= line ? 'NEUTRAL' : 'AGGRESSIVE';
  },

  /** Something that was never coming for you already stands at the line. */
  startingMeter(kind: { behavior?: string }, attributes?: IAttributes): number {
    return kind.behavior === MobBehavior.NEUTRAL || kind.behavior === MobBehavior.PASSIVE ? StatSystem.recruitDisposition(attributes) : COLD_START;
  },

  /** How this body acts. Talked round it leaves you be, and a hit puts everything back. */
  behaviorOf(body: Pick<IWorldEntity, 'bargain'>, base: MobBehavior | string, provoked = false): MobBehavior {
    if (provoked || !body.bargain || body.bargain.stance === 'AGGRESSIVE') return base as MobBehavior;
    return base === MobBehavior.PASSIVE ? MobBehavior.PASSIVE : MobBehavior.NEUTRAL;
  },

  wantOf(body: Pick<IWorldEntity, 'bargain'>): string | null {
    return body.bargain?.wants ?? null;
  },

  /** What it wants with no model to say it: what its sheet was dealt. */
  floorWant(sheet: Pick<INpcSheet, 'want'>): string {
    return sheet.want === 'GOLD' ? 'It wants paying.' : sheet.want === 'GIFT' ? 'It wants something brought to it.' : 'It wants to be taken seriously.';
  }
};

/**
 * THE STUDY LAW (Wave 10E.2 — D19, decided by Pedro)
 *
 * Equipping shows no visible change for what you have not studied — knowledge
 * gain IS the mechanic, and the unstudied affix acts regardless: equip at your
 * own peril. Identify is an acquirable SKILL, scoped by item type: study that
 * type at a workstation, time and again, to earn it; once earned it works
 * INSIDE the extraction, always timed, faster with skill (D6's
 * skills-grow-by-use law carries it).
 *
 * This file ties into the machinery that already exists, never beside it:
 *  - the scoped skill is an ISkillState in bank.universalSkills (D6's track)
 *  - what an affix was banked as, once studied, lands in materialMastery's
 *    discoveredAffixes (the knowledge-level machinery)
 *  - a finished identify sets the item's own isIdentified flag
 * LoadoutSystem.isAffixStudied reads the same record, so the sheet and the
 * card agree by construction.
 */

import { IItem, IPlayer, ItemType, SlotType } from '../../../types';
import { Verdict } from '../../entities/player/systems/LoadoutSystem';

export type IdentifyScope = 'weapon' | 'armor' | 'tool';

/** Workstation study: the time one sitting takes, on the record. */
export const STUDY_SECONDS = 20;
/** Field identify: the base clock at skill level 1. It NEVER reaches zero. */
export const IDENTIFY_BASE_SECONDS = 12;
export const IDENTIFY_FLOOR_SECONDS = 2;

const ok: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

export class StudySystem {

  /** The scope a piece belongs to. Cargo has no scope: nothing to identify. */
  static identifyScopeOf(item: IItem): IdentifyScope | null {
    const tags = item.tags || [];
    if (item.toolData || item.slot === SlotType.TOOL || tags.includes('tool')) return 'tool';
    // a cart kit is a working rig, not a coat: the tool eye reads it (found in play)
    if (item.cartData) return 'tool';
    if (item.type !== ItemType.GEAR) return null;
    if (item.slot === SlotType.MAIN_HAND || item.slot === SlotType.OFF_HAND || tags.includes('weapon')) return 'weapon';
    return 'armor';
  }

  static scopeSkillId(scope: IdentifyScope): string {
    return `skill_identify_${scope}`;
  }

  /** The trained level for this item's scope. 0 = the skill was never earned. */
  static identifyLevel(player: IPlayer, item: IItem): number {
    const scope = this.identifyScopeOf(item);
    if (!scope) return 0;
    return player.bank.universalSkills[this.scopeSkillId(scope)]?.level ?? 0;
  }

  /** ALWAYS timed: the clock falls with skill and stops at the floor, never zero. */
  static identifySeconds(level: number): number {
    const l = Math.max(1, level);
    return Math.max(IDENTIFY_FLOOR_SECONDS, Math.round(IDENTIFY_BASE_SECONDS / (1 + 0.5 * (l - 1))));
  }

  /** The field obeys only an earned, matching scope — the refusal says where to earn it. */
  static canFieldIdentify(player: IPlayer, item: IItem): Verdict {
    const scope = this.identifyScopeOf(item);
    if (!scope) return no(`${item.name} holds no maker's riddle. There is nothing to identify.`);
    const level = this.identifyLevel(player, item);
    if (level < 1) {
      return no(`Your eye is not schooled for ${scope}. Study ${scope} pieces at a workstation, time and again, and the field will obey.`);
    }
    return ok;
  }

  /** The knowledge scope key the mastery machinery files gear study under. */
  static masteryKeyOf(scope: IdentifyScope): string {
    return `gear_${scope}`;
  }

  /**
   * THE REVEAL, pure: everything this item's affixes were banked as becomes
   * known — filed in materialMastery's discoveredAffixes, the one knowledge
   * ledger. Study shows exactly what was banked; it never invents a number.
   */
  static reveal(player: IPlayer, item: IItem): IPlayer {
    const scope = this.identifyScopeOf(item) ?? 'armor';
    const key = this.masteryKeyOf(scope);
    const prior = player.materialMastery[key] ?? { resourceId: key, knowledgeLevel: 0, discoveredAffixes: [] };
    const discovered = new Set(prior.discoveredAffixes);
    for (const affix of item.affixes || []) discovered.add(affix.id);
    return {
      ...player,
      materialMastery: {
        ...player.materialMastery,
        [key]: {
          resourceId: key,
          knowledgeLevel: Math.max(prior.knowledgeLevel, 1),
          discoveredAffixes: [...discovered]
        }
      }
    };
  }
}

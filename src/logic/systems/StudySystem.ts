/**
 * THE STUDY LAW (Wave 10E.2 — D19, decided by Pedro)
 *
 * Equipping shows no visible change for what you have not studied — knowledge
 * gain IS the mechanic, and the unstudied affix acts regardless: equip at your
 * own peril. Identify is an acquirable SKILL, scoped by item type: study that
 * type at a workstation, time and again, to earn it. In the field anyone may try
 * (D32): always timed, faster with skill, paid in energy, on a keyed roll by the
 * eye against rank and rarity. The bench needs no roll.
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
import { LoadoutSystem, Verdict } from '../../entities/player/systems/LoadoutSystem';
import { StatSystem } from './StatSystem';

/** The raw materials leg (D26) adds two: goods that carry a process, and furniture. */
export type IdentifyScope = 'weapon' | 'armor' | 'tool' | 'material' | 'furniture';

/** Workstation study: the time one sitting takes, on the record. */
export const STUDY_SECONDS = 20;
/** Field identify: the base clock at skill level 1. It NEVER reaches zero. */
export const IDENTIFY_BASE_SECONDS = 12;
export const IDENTIFY_FLOOR_SECONDS = 2;
/** D32: what a field attempt costs. A guess until Wave 12. Half again if no eye is schooled at all. */
export const IDENTIFY_ENERGY = 10;
const WINGING_FACTOR = 1.5;
const ok: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

export class StudySystem {

  /** The scope a piece belongs to. Cargo has no scope: nothing to identify. */
  static identifyScopeOf(item: IItem): IdentifyScope | null {
    const tags = item.tags || [];
    if (item.toolData || item.slot === SlotType.TOOL || tags.includes('tool')) return 'tool';
    // a cart kit is a working rig, not a coat: the tool eye reads it (found in play)
    if (item.cartData) return 'tool';
    if (item.type === ItemType.STRUCTURE) return 'furniture';
    // A material with something worked or dreamed into it holds a riddle. Plain cargo does not.
    if (item.type !== ItemType.GEAR) return (item.affixes?.length ?? 0) > 0 ? 'material' : null;
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

  /** D32: anyone may try on anything with a riddle in it. The roll is the refusal. */
  static canFieldIdentify(player: IPlayer, item: IItem): Verdict {
    const scope = this.identifyScopeOf(item);
    if (!scope) return no(`${LoadoutSystem.shownName(item)} holds no maker's riddle. There is nothing to identify.`);
    return ok;
  }

  /** The best eye this person has, in any scope. */
  private static bestEye(player: IPlayer): number {
    const scopes: IdentifyScope[] = ['weapon', 'armor', 'tool', 'material', 'furniture'];
    return Math.max(0, ...scopes.map(s => player.bank.universalSkills[this.scopeSkillId(s)]?.level ?? 0));
  }

  /**
   * D32: what an attempt costs and how long it takes. What has not been read gives
   * away nothing by its price: it is asked of the person's best eye, never of the
   * piece. A piece already read, with something unstudied on it, asks its own scope.
   */
  static identifyAsk(player: IPlayer, item: IItem): { cost: number; seconds: number } {
    const level = item.isIdentified === false ? this.bestEye(player) : this.identifyLevel(player, item);
    // Line 77: glasses shorten the clock. Skill and gear make it quick, never instant.
    const eyes = 1 + Math.max(0, StatSystem.total(player.equipment, 'field_analysis_speed') + StatSystem.signalEyes(player.attributes));
    return {
      cost: level < 1 ? Math.ceil(IDENTIFY_ENERGY * WINGING_FACTOR) : IDENTIFY_ENERGY,
      seconds: Math.max(IDENTIFY_FLOOR_SECONDS, Math.round(this.identifySeconds(level) / eyes))
    };
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
    return this.revealAffixes(player, this.identifyScopeOf(item) ?? 'armor', item.affixes || []);
  }

  /** The same reveal for whatever holds affixes: an item, or the walls of a room (D26). */
  static revealAffixes(player: IPlayer, scope: IdentifyScope, affixes: { id: string }[]): IPlayer {
    const key = this.masteryKeyOf(scope);
    const prior = player.materialMastery[key] ?? { resourceId: key, knowledgeLevel: 0, discoveredAffixes: [] };
    const discovered = new Set(prior.discoveredAffixes);
    for (const affix of affixes) discovered.add(affix.id);
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

/**
 * THE CIRCLES. Pedro: "we're going to white wolf this, and allow players to fill the
 * circles in skills as they gain levels" and "once they apply 3 circles to a skill the
 * LLM receives a call to make active skills or passive bonuses from it. this is the
 * reason to gain exp."
 *
 * Every level climbed, at any rank, is a circle to fill: what is free is levels climbed
 * less what is filled, so nothing can drift out of step and a rank's reset takes none.
 * Each third circle in a skill is owed a gift, but the very first gift a character takes asks one
 * circle, in whichever skill (Pedro, 2026-11-11: "how about first gift is one, first gift new skill
 * is 3, so the first first is one"), and that skill counts on in threes from there. What is owed is read from the skill too,
 * so a batch that fails simply asks again at the next rest. The call goes through the
 * rest door like everything else (D43): never in play, and nothing waits on it.
 */

import { IEquipmentState, IPlayer, ISkillGift, ISkillState } from '../../../shared/types';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { affixRange } from '../../../shared/logic/theme/ThemeFormula';
import { COST_BANDS, DELIVERIES, EFFECTS, PASSIVE_STATS, STAT_BANDS } from '../../../shared/logic/theme/ThemeTypes';
import { EffectSystem, IEffectAbility } from '../../../shared/logic/systems/EffectSystem';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';

/** Pedro, 2026-11-11: "the circles in skills, not at every level, one at every 3 levels". The rule is shared: ProgressionSystem.circlesEarned. */
export { LEVELS_PER_CIRCLE } from '../../../shared/entities/player/systems/ProgressionSystem';
/** Pedro's three. A skill has no top: each further three is owed another. */
export const CIRCLES_FOR_A_GIFT = 3;
/**
 * Asked "A first gift now takes nine levels. Lower what a gift asks from three circles to one?", Pedro
 * answered "Lower to one", then: "how about first gift is one, first gift new skill is 3, so the first
 * first is one". The very first gift a character takes asks this many circles; every other first asks three.
 */
export const CIRCLES_FOR_A_FIRST_GIFT = 1;

/** What a model writes for one skill. Only the fields of its own kind are read. */
export interface IGiftWords {
  skill: string;
  kind: 'active' | 'passive';
  name: string;
  blurb: string;
  elements: string[];
  delivery: string;
  effect: string;
  cost: string;
  stat: string;
  band: string;
}

const has = (list: readonly string[], word: string) => list.includes(word);

export class CircleSystem {

  static circlesOf(skill: Pick<ISkillState, 'circles'>): number {
    return skill.circles ?? 0;
  }

  /** What filling a circle says when it makes a gift owed: one circle, two circles (G2b). */
  static standsLine(skillName: string, circles: number): string {
    return `${skillName} stands at ${circles} circle${circles === 1 ? '' : 's'}. It will answer at a rest, when you hold the lore for it.`;
  }

  static filled(player: IPlayer): number {
    return Object.values(player.bank.universalSkills ?? {}).reduce((sum, s) => sum + this.circlesOf(s), 0);
  }

  static free(player: IPlayer): number {
    return Math.max(0, ProgressionSystem.circlesEarned(player) - this.filled(player));
  }

  /** The door. Only a skill the web can read takes a circle, and only if one is free. */
  static fill(player: IPlayer, skillId: string): { ok: boolean; reason?: string; player: IPlayer; owed: boolean } {
    const refused = (reason: string) => ({ ok: false, reason, player, owed: false });
    const skill = WebSystem.heldSkills(player.bank.universalSkills).find(s => s.id === skillId);
    if (!skill) return refused('That is not a skill you hold.');
    if (this.free(player) <= 0) return refused('No circle is free. Every third level climbed gives one.');
    const circles = this.circlesOf(skill) + 1;
    const next = { ...player, bank: { ...player.bank, universalSkills: { ...player.bank.universalSkills, [skillId]: { ...skill, circles } } } };
    return { ok: true, player: next, owed: this.owedTo(next, { ...skill, circles }) > this.owedTo(player, skill) };
  }

  /** Does this character hold any gift at all? A save from before that does is never made cheaper. */
  static holdsAGift(player: IPlayer): boolean {
    return Object.values(player.skillGifts ?? {}).some(gifts => gifts.length > 0);
  }

  /**
   * While a character holds no gift, the one skill its first gift goes to: the one with the most
   * circles, then the first by its id, so two skills never both take a first gift at one circle.
   */
  private static firstInLine(player: IPlayer): string | undefined {
    if (this.holdsAGift(player)) return undefined;
    return WebSystem.heldSkills(player.bank.universalSkills)
      .filter(s => this.circlesOf(s) >= CIRCLES_FOR_A_FIRST_GIFT)
      .sort((a, b) => this.circlesOf(b) - this.circlesOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]?.id;
  }

  /** How many circles this skill's first gift asks: one for the character's very first, three for any other. */
  static firstAsks(player: IPlayer, skillId: string): number {
    const first = this.giftsOf(player, skillId).some(g => g.first) || this.firstInLine(player) === skillId;
    return first ? CIRCLES_FOR_A_FIRST_GIFT : CIRCLES_FOR_A_GIFT;
  }

  static giftsOf(player: IPlayer, skillId: string): ISkillGift[] {
    return player.skillGifts?.[skillId] ?? [];
  }

  /** A first gift at one counts every later one on in threes from it: one, four, seven; any other skill three, six, nine. */
  private static owedTo(player: IPlayer, skill: ISkillState): number {
    const ahead = CIRCLES_FOR_A_GIFT - this.firstAsks(player, skill.id);
    return Math.max(0, Math.floor((this.circlesOf(skill) + ahead) / CIRCLES_FOR_A_GIFT) - this.giftsOf(player, skill.id).length);
  }

  /** What the rest door asks about. It says what the skill is, and nothing else about the person. */
  static asks(player: IPlayer): { id: string; tags: string[]; rank: string; circles: number; owed: number; has: string[] }[] {
    return WebSystem.heldSkills(player.bank.universalSkills)
      .filter(skill => this.owedTo(player, skill) > 0)
      .map(skill => ({
        id: skill.id,
        tags: skill.tags,
        rank: ProgressionSystem.skillRankOf(skill),
        circles: this.circlesOf(skill),
        owed: this.owedTo(player, skill),
        has: this.giftsOf(player, skill.id).map(g => g.name)
      }));
  }

  /** The law over one gift. A word outside the vocabulary has no reader, so it cannot stand. */
  static judge(gift: IGiftWords, asked: string[], elements?: string[]): { ok: boolean; reason?: string } {
    const no = (reason: string) => ({ ok: false, reason });
    if (!asked.includes(gift.skill)) return no(`Nobody asked about ${gift.skill}.`);
    if (!gift.name?.trim()) return no(`What ${gift.skill} gave came back with no name.`);
    if (gift.kind === 'active') {
      if (!has(DELIVERIES, gift.delivery)) return no(`${gift.name}: "${gift.delivery}" is not a delivery.`);
      if (!has(EFFECTS, gift.effect)) return no(`${gift.name}: "${gift.effect}" is not an effect.`);
      if (!has(COST_BANDS, gift.cost)) return no(`${gift.name}: "${gift.cost}" is not a cost band.`);
      const exit = EffectSystem.exitRefusal(gift);
      if (exit) return no(`${gift.name} ${exit}`);
      if (!Array.isArray(gift.elements) || gift.elements.length === 0) return no(`${gift.name} draws on nothing.`);
      const stray = gift.elements.find(e => !TagLaw.isCanonicalSpelling(e) || (elements && !elements.includes(e)));
      if (stray) return no(`${gift.name} draws on "${stray}", which this world does not hold.`);
      return { ok: true };
    }
    if (gift.kind === 'passive') {
      if (!has(PASSIVE_STATS, gift.stat)) return no(`${gift.name}: nothing reads "${gift.stat}" as a passive.`);
      if (!has(STAT_BANDS, gift.band)) return no(`${gift.name}: "${gift.band}" is not a band.`);
      return { ok: true };
    }
    return no(`${gift.name} is neither active nor passive.`);
  }

  /** Does this answer ask too much? A skill takes what it is owed, and no more. */
  static judgeAll(gifts: IGiftWords[], player: IPlayer, asked: string[], elements?: string[]): { ok: boolean; reason?: string } {
    for (const gift of gifts) {
      const verdict = this.judge(gift, asked, elements);
      if (!verdict.ok) return verdict;
    }
    for (const id of asked) {
      const skill = player.bank.universalSkills[id];
      const count = gifts.filter(g => g.skill === id).length;
      if (skill && count > this.owedTo(player, skill)) return { ok: false, reason: `${id} is owed ${this.owedTo(player, skill)}, and ${count} came back.` };
    }
    return { ok: true };
  }

  /** A judged gift lands. The number is rolled here, keyed, from the skill's rarity; a model writes words. */
  static apply(player: IPlayer, gifts: IGiftWords[]): IPlayer {
    if (gifts.length === 0) return player;
    const firstSkill = this.firstInLine(player);
    const skillGifts = { ...(player.skillGifts ?? {}) };
    for (const g of gifts) {
      const skill = player.bank.universalSkills[g.skill];
      if (!skill) continue;
      const held = skillGifts[g.skill] ?? [];
      const id = `gift_${g.skill.replace(/^skill_/, '')}_${held.length}`;
      const gift: ISkillGift = g.kind === 'active'
        ? { id, kind: 'active', name: g.name, blurb: g.blurb, elements: g.elements, delivery: g.delivery, effect: g.effect, cost: g.cost }
        : { id, kind: 'passive', name: g.name, blurb: g.blurb, stat: g.stat, value: this.passiveValue(player.id, id, g, skill) };
      skillGifts[g.skill] = [...held, g.skill === firstSkill && held.length === 0 ? { ...gift, first: true } : gift];
    }
    return this.withPassives({ ...player, skillGifts });
  }

  private static passiveValue(playerId: string, giftId: string, g: IGiftWords, skill: ISkillState): number {
    const [low, high] = affixRange(g.stat, g.band as 'minor', 1 + ProgressionSystem.skillRarity(skill), false);
    const rolled = low + (high - low) * Rng.fromKey(`${playerId}:${giftId}`).next();
    return Math.abs(high) < 1 ? Math.round(rolled * 100) / 100 : Math.round(rolled);
  }

  /** Every passive a person holds, summed for StatSystem.total to read like anything worn. */
  static passivesOf(player: IPlayer): Record<string, number> {
    const out: Record<string, number> = {};
    for (const gifts of Object.values(player.skillGifts ?? {})) {
      for (const g of gifts) if (g.kind === 'passive' && g.stat) out[g.stat] = (out[g.stat] ?? 0) + (g.value ?? 0);
    }
    return out;
  }

  /** The body carries what the skills gave. Unchanged, same reference, for someone with none. */
  static withPassives(player: IPlayer): IPlayer {
    if (Object.keys(player.skillGifts ?? {}).length === 0) return player;
    const equipment: IEquipmentState = player.equipment ?? { slots: {}, items: [], frames: {}, protected: [] };
    return { ...player, equipment: { ...equipment, passives: this.passivesOf(player) } };
  }

  /** An active gift, as the one door casts it. */
  static abilityOf(player: IPlayer, giftId: string): IEffectAbility | undefined {
    const gift = Object.values(player.skillGifts ?? {}).flat().find(g => g.id === giftId && g.kind === 'active');
    return gift && {
      id: gift.id, name: gift.name, elements: gift.elements ?? [],
      delivery: gift.delivery as IEffectAbility['delivery'],
      effect: gift.effect as IEffectAbility['effect'],
      cost: gift.cost as IEffectAbility['cost']
    };
  }

  /** What the sheet says about a gift. */
  static say(gift: ISkillGift): string {
    if (gift.kind === 'passive') return `${gift.name}: ${gift.stat?.replace(/_/g, ' ')} ${(gift.value ?? 0) >= 0 ? '+' : ''}${gift.value}`;
    return `${gift.name}: ${gift.effect?.replace(/_/g, ' ')}, by ${gift.delivery}`;
  }
}

/**
 * THE CIRCLES. Pedro: "we're going to white wolf this, and allow players to fill the
 * circles in skills as they gain levels" and "once they apply 3 circles to a skill the
 * LLM receives a call to make active skills or passive bonuses from it. this is the
 * reason to gain exp."
 *
 * Every level climbed, at any rank, is a circle to fill: what is free is levels climbed
 * less what is filled, so nothing can drift out of step and a rank's reset takes none.
 * Each third circle in a skill is owed a gift. What is owed is read from the skill too,
 * so a batch that fails simply asks again at the next rest. The call goes through the
 * rest door like everything else (D43): never in play, and nothing waits on it.
 */

import { IEquipmentState, IPlayer, ISkillGift, ISkillState } from '../../../types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { Rng } from '../rng/DeterministicRNG';
import { TagLaw } from '../content/TagLaw';
import { affixRange } from '../theme/ThemeFormula';
import { COST_BANDS, DELIVERIES, EFFECTS, PASSIVE_STATS, STAT_BANDS } from '../theme/ThemeTypes';
import { IEffectAbility } from './EffectSystem';
import { WebSystem } from './WebSystem';

export const CIRCLES_PER_LEVEL = 1;
/** Pedro's three. A skill has no top: each further three is owed another. */
export const CIRCLES_FOR_A_GIFT = 3;

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

  static filled(player: IPlayer): number {
    return Object.values(player.bank.universalSkills ?? {}).reduce((sum, s) => sum + this.circlesOf(s), 0);
  }

  static free(player: IPlayer): number {
    return Math.max(0, ProgressionSystem.levelsEarned(player) * CIRCLES_PER_LEVEL - this.filled(player));
  }

  /** The door. Only a skill the web can read takes a circle, and only if one is free. */
  static fill(player: IPlayer, skillId: string): { ok: boolean; reason?: string; player: IPlayer; owed: boolean } {
    const refused = (reason: string) => ({ ok: false, reason, player, owed: false });
    const skill = WebSystem.heldSkills(player.bank.universalSkills).find(s => s.id === skillId);
    if (!skill) return refused('That is not a skill you hold.');
    if (this.free(player) <= 0) return refused('No circle is free. A level gives one.');
    const circles = this.circlesOf(skill) + 1;
    return {
      ok: true,
      player: { ...player, bank: { ...player.bank, universalSkills: { ...player.bank.universalSkills, [skillId]: { ...skill, circles } } } },
      owed: circles % CIRCLES_FOR_A_GIFT === 0
    };
  }

  static giftsOf(player: IPlayer, skillId: string): ISkillGift[] {
    return player.skillGifts?.[skillId] ?? [];
  }

  private static owedTo(player: IPlayer, skill: ISkillState): number {
    return Math.max(0, Math.floor(this.circlesOf(skill) / CIRCLES_FOR_A_GIFT) - this.giftsOf(player, skill.id).length);
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
    const skillGifts = { ...(player.skillGifts ?? {}) };
    for (const g of gifts) {
      const skill = player.bank.universalSkills[g.skill];
      if (!skill) continue;
      const held = skillGifts[g.skill] ?? [];
      const id = `gift_${g.skill.replace(/^skill_/, '')}_${held.length}`;
      const gift: ISkillGift = g.kind === 'active'
        ? { id, kind: 'active', name: g.name, blurb: g.blurb, elements: g.elements, delivery: g.delivery, effect: g.effect, cost: g.cost }
        : { id, kind: 'passive', name: g.name, blurb: g.blurb, stat: g.stat, value: this.passiveValue(player.id, id, g, skill) };
      skillGifts[g.skill] = [...held, gift];
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
    return `${gift.name}: ${gift.effect}, by ${gift.delivery}`;
  }
}

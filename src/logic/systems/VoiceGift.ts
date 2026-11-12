/**
 * THE VOICE'S GIFT (TQ, call 8). Pedro, 2026-11-12: "once the 5 are done allow the player to place a free point and ask
 * the voice for a gift, they get a tweet, one short tweet, to get themselves a gift".
 *
 * One message of at most 280 characters, sent once the first order is done, and answered once. The quick model reads it
 * as what the person wrote, never as an instruction, and answers in words with one gift of the kind the game already
 * has (`CircleSystem`): something they can now do, or something now always true of them, sitting on a skill they hold.
 * A law holds the answer, as every answer is held: the words choose what it is, what it is called and which skill it sits
 * on; the size is the law's alone, what a first gift is worth at the character's rank, the same for everyone and the
 * same whatever was asked: a passive at the middle of the first band of its stat at that rank, an action at the first
 * band of cost. No dice anywhere and no lore. Once given, it stands and the ask is spent. It stands beside the circles'
 * gifts and is never counted among them (`given: 'voice'`).
 *
 * Pure: no store, no door. The door is `VoiceGiftDoor`.
 */

import { IPlayer, ISkillGift } from '../../../shared/types';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { EffectSystem } from '../../../shared/logic/systems/EffectSystem';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { affixRange } from '../../../shared/logic/theme/ThemeFormula';
import { COST_BANDS, DELIVERIES, EFFECTS, PASSIVE_STATS, STAT_BANDS } from '../../../shared/logic/theme/ThemeTypes';
import { CircleSystem } from './CircleSystem';
import { SkillNames } from './SkillNames';

/** Pedro's "one short tweet". */
export const ASK_CHARACTERS = 280;

/** What a first gift is worth: the first band of each scale, at the character's rank. */
export const VOICE_GIFT_BAND: (typeof STAT_BANDS)[number] = STAT_BANDS[0];
export const VOICE_GIFT_COST: (typeof COST_BANDS)[number] = COST_BANDS[0];

/** A way out is priced by rank (`FORCED_EXIT_FLOOR_RANK`) and no first gift reaches it. */
export const VOICE_GIFT_EFFECTS = EFFECTS.filter(e => e !== 'forced_exit');

/** What the voice writes. It has no word for how big. */
export interface IVoiceGiftWords {
  skill: string;
  kind: 'active' | 'passive';
  name: string;
  blurb: string;
  delivery: string;
  effect: string;
  elements: string[];
  stat: string;
  /** What the voice says back, in one or two short sentences: where it gave the nearest thing, it says so here. */
  line: string;
}

/** What the voice is given. The message is in `said`, as data. */
export interface IVoiceGiftAsk {
  said: string;
  rank: string;
  skills: { id: string; name: string; tags: string[] }[];
  elements: string[];
  /** Why the last answer did not stand, when it is asked again. */
  refused?: string;
}

const has = (list: readonly string[], word: string) => list.includes(word);

export const VoiceGift = {
  /** The five are done, the reward was given, and the ask has not been answered. */
  mayAsk(player: Pick<IPlayer, 'tutorialSealedAt' | 'firstOrder'>): boolean {
    return player.tutorialSealedAt !== undefined && player.firstOrder?.rewardedAt !== undefined && !player.firstOrder.ask;
  },

  /** A message as it may be sent: some words, at most a tweet. */
  message(text: string): { ok: true; said: string } | { ok: false; reason: string } {
    const said = (text ?? '').trim();
    if (!said) return { ok: false, reason: 'Write what you would ask for.' };
    if (said.length > ASK_CHARACTERS) return { ok: false, reason: `One short message: ${ASK_CHARACTERS} characters at most.` };
    return { ok: true, said };
  },

  /** The elements a gift may draw on: the hub's own world's. */
  elementsOf(): string[] {
    const theme = ContentRegistry.get(ContentRegistry.defaultThemeId());
    return [...new Set((theme?.abilities ?? []).flatMap(a => a.elements ?? []))].sort();
  },

  /** What the voice is given: the message, and what the gift may sit on and draw from. Never the person's items. */
  askOf(player: IPlayer, said: string, elements: string[], refused?: string): IVoiceGiftAsk {
    return {
      said,
      rank: ProgressionSystem.rankOf(player),
      skills: WebSystem.heldSkills(player.bank.universalSkills).map(s => ({ id: s.id, name: SkillNames.nameOf(s.id), tags: s.tags })),
      elements,
      ...(refused ? { refused } : {})
    };
  },

  /** The law over an answer. A word outside what the game reads has no reader, so it cannot stand. */
  judge(words: IVoiceGiftWords, ask: IVoiceGiftAsk): { ok: boolean; reason?: string } {
    const no = (reason: string) => ({ ok: false, reason });
    if (!words || typeof words !== 'object') return no('That is not a gift.');
    if (!ask.skills.some(s => s.id === words.skill)) return no(`"${words.skill}" is not a skill they hold.`);
    if (!words.name?.trim()) return no('The gift came back with no name.');
    if (!words.line?.trim()) return no('Nothing was said with it.');
    if (words.kind === 'passive') {
      if (!has(PASSIVE_STATS, words.stat)) return no(`${words.name}: nothing reads "${words.stat}" as always true of someone.`);
      return { ok: true };
    }
    if (words.kind === 'active') {
      if (!has(DELIVERIES, words.delivery)) return no(`${words.name}: "${words.delivery}" is not a way to deliver it.`);
      if (!has(VOICE_GIFT_EFFECTS, words.effect)) return no(`${words.name}: "${words.effect}" is not what a first gift can do.`);
      if (!Array.isArray(words.elements) || words.elements.length === 0) return no(`${words.name} draws on nothing.`);
      const stray = words.elements.find(e => !ask.elements.includes(e));
      if (stray) return no(`${words.name} draws on "${stray}", which this world does not hold.`);
      const exit = EffectSystem.exitRefusal({ effect: words.effect, delivery: words.delivery, cost: VOICE_GIFT_COST });
      if (exit) return no(`${words.name} ${exit}`);
      return { ok: true };
    }
    return no(`${words.name} is neither something to do nor something always true.`);
  },

  /** The size of a passive: the middle of the first band of its stat, at the character's rank. The same for everyone. */
  valueOf(player: IPlayer, stat: string): number {
    const tier = 1 + ProgressionSystem.rankIndex(ProgressionSystem.rankOf(player));
    const [low, high] = affixRange(stat, VOICE_GIFT_BAND, tier, false);
    const middle = (low + high) / 2;
    return Math.abs(high) < 1 ? Math.round(middle * 100) / 100 : Math.round(middle);
  },

  /** A judged answer lands: the gift on its skill, the ask spent with what was said. */
  give(player: IPlayer, words: IVoiceGiftWords, said: string, at: number): IPlayer {
    const id = `gift_${words.skill.replace(/^skill_/, '')}_voice`;
    const gift: ISkillGift = words.kind === 'active'
      ? { id, kind: 'active', name: words.name.trim(), blurb: words.blurb ?? '', elements: words.elements, delivery: words.delivery, effect: words.effect, cost: VOICE_GIFT_COST, given: 'voice' }
      : { id, kind: 'passive', name: words.name.trim(), blurb: words.blurb ?? '', stat: words.stat, value: this.valueOf(player, words.stat), given: 'voice' };
    const skillGifts = { ...(player.skillGifts ?? {}), [words.skill]: [...(player.skillGifts?.[words.skill] ?? []), gift] };
    const record = player.firstOrder ?? { felled: 0, done: {} };
    return CircleSystem.withPassives({
      ...player,
      skillGifts,
      firstOrder: { ...record, ask: { message: said, answeredAt: at, giftId: id, skillId: words.skill, line: words.line.trim() } }
    });
  }
};

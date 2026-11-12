/**
 * LORE (D118): the resource study gives and a dream spends. Pedro: "the study, it's what
 * gives lore, a resource and lore gets spent BY the dream to teac skills and improve
 * passives", and on what levels already pay: "Gifts also cost lore".
 *
 * Two things, on purpose. The PURSE (`bank.loreHeld`) is what can be spent. A TOPIC
 * (`bank.lore`) is what a person knows: spending never lowers it, and only what has been
 * studied can be taught.
 *
 * A model says how deep a sitting went and what it comes to. It never writes a number:
 * each depth's pay and each price are worked out here, it is told them, and the law below
 * adds them up. An answer the purse cannot cover is refused whole, and nothing is lost.
 *
 * Every number here is a guess until Wave 12.
 */

import { ILoreEntry, ILoreKind, IPlayer, ISittingLore, ISkillGift, ISkillState, IStudySitting, StudyOutcome } from '../../../shared/types';
import { LoreLaw } from '../../../shared/logic/systems/LoreLaw';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { WebBank } from '../../../shared/logic/content/WebBank';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { SKILL_GRANTS } from '../../../shared/logic/theme/ThemeTypes';
import { CircleSystem, IGiftWords } from './CircleSystem';
import { LORE_NOTE_PAY, LORE_PER_SITTING, LORE_RANK_GROWTH, LORE_TEACH_PRICE, loreTeachPrice } from '../../../shared/logic/systems/LoreConstants';
import { IHubTree, WebSystem } from '../../../shared/logic/systems/WebSystem';

/** Pedro: "major win doubles the amount gained". What failed damaged the thing and pays nothing. */
const OUTCOME_FACTOR: Record<StudyOutcome, number> = { major_win: 2, success: 1, failure: 0, major_failure: 0 };

export { LORE_PER_SITTING };
export const LORE_GIFT_PRICE = 30;
export { LORE_TEACH_PRICE };
export const LORE_RAISE_PRICE = 20;
/** What one raise adds, of what the passive already is. */
const RAISE_SHARE = 0.25;
/** How many sittings one dream takes. The rest wait for the next: it keeps an answer inside what a batch can carry. */
export const SITTINGS_PER_DREAM = 40;
const TOPICS_TOLD = 40;

/** What a dream says of a sitting. It words it; the roll already said what it pays (the lore pass, call 7). */
export interface ILoreWords { id: string; topics: string[]; line: string }
export interface ITaughtWords { tags: string[]; name: string; flavor: string; grants: string[] }
export interface IRaisedWords { gift: string; line: string }

/** The part of a dream's answer that moves lore. */
export interface ILoreAnswer {
  studied?: ILoreWords[];
  taught?: ITaughtWords[];
  raised?: IRaisedWords[];
  gifts?: IGiftWords[];
}

const growth = (rank: number) => Math.pow(LORE_RANK_GROWTH, Math.max(0, rank));
const sittingsOf = (player: IPlayer): IStudySitting[] => player.restQueue?.sittings ?? [];
const no = (reason: string) => ({ ok: false, reason });

const findGift = (player: IPlayer, giftId: string): { skillId: string; gift: ISkillGift } | undefined => {
  for (const [skillId, gifts] of Object.entries(player.skillGifts ?? {})) {
    const gift = gifts.find(g => g.id === giftId);
    if (gift) return { skillId, gift };
  }
  return undefined;
};

export class LoreSystem {

  static held(player: IPlayer): number {
    return player.bank.loreHeld ?? 0;
  }

  /** What is known, most first. A note read or a first in a hub holds a topic with nothing studied under it. */
  static topicsOf(player: IPlayer): ILoreEntry[] {
    return Object.values(player.bank.lore ?? {}).filter(t => t.xp > 0).sort((a, b) => b.xp - a.xp);
  }

  /** The door other systems read: has this person studied under this word? */
  static knows(player: IPlayer, topic: string): boolean {
    return (player.bank.lore?.[topic]?.xp ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // THE FORMULA
  // -----------------------------------------------------------------------

  /**
   * What a sitting pays, as its roll fixed it (the lore pass). One logged before the rule has no record, and reads its
   * outcome as the stretch it pairs with, filed under its own tags' family.
   */
  static loreOf(sitting: Pick<IStudySitting, 'rankIndex' | 'outcome' | 'target' | 'lore'>): ISittingLore {
    if (sitting.lore) return sitting.lore;
    const { stretch, times } = LoreLaw.stretchOfOutcome(sitting.outcome);
    const found = sitting.target.hidden ? null : WebSystem.categoryOf(sitting.target.tags ?? []);
    return {
      stretch, amount: LoreLaw.pay(sitting.rankIndex, times), misread: stretch === 'misread' ? LoreLaw.misreadOf(sitting.rankIndex) : 0,
      ...(found ? { category: { key: found.key, name: found.word?.replace(/_/g, ' ') ?? sitting.target.name } } : {})
    };
  }

  /** Does this sitting give anything, lore or a misreading, for a dream to land? */
  static gives(sitting: Pick<IStudySitting, 'rankIndex' | 'outcome' | 'target' | 'lore'>): boolean {
    const lore = this.loreOf(sitting);
    return lore.amount > 0 || lore.misread > 0;
  }

  /** What a person is told a sitting gave, by kind. A misreading reads as lore of its category, and high (call 4). */
  static saidOf(name: string, line: string, lore: ISittingLore): string {
    const { category, general } = LoreLaw.split(lore.amount, !!lore.category);
    const parts = [
      ...(lore.category && category + lore.misread > 0 ? [`+${category + lore.misread} lore of ${lore.category.name}`] : []),
      ...(general > 0 ? [`+${general} general`] : [])
    ];
    return `${name}: ${line} ${parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing you could keep.'}`;
  }

  /** Lore of each category this person holds. */
  static kinds(player: IPlayer): ILoreKind[] {
    return Object.values(player.bank.loreKinds ?? {});
  }

  /**
   * Lore of each category as the study panel reads it (S2h), under the word the person may see for it: what it holds
   * with any misreading in it, so a misread category reads high and comes down as new lore pays it off. Pedro: "it shows
   * up as a high lore amount and decreases over new lore read". Highest first, then by name; an empty one is not shown.
   */
  static shownKinds(player: IPlayer): { key: string; name: string; reads: number }[] {
    return this.kinds(player)
      .map(k => ({ key: k.key, name: k.name, reads: Math.round(k.held + k.misread) }))
      .filter(k => k.reads > 0)
      .sort((a, b) => b.reads - a.reads || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** What happened to the thing studied keeps today's ways: only a success or better pays the things that ride on it. */
  static pays(outcome: StudyOutcome): boolean {
    return OUTCOME_FACTOR[outcome] > 0;
  }

  /** A skill's next gift. Rarer costs more, and so does each one after the first. */
  static giftPrice(player: IPlayer, skill: ISkillState, extra = 0): number {
    const held = CircleSystem.giftsOf(player, skill.id).length + extra;
    return Math.round(LORE_GIFT_PRICE * growth(ProgressionSystem.skillRarity(skill)) * (1 + held));
  }

  /** A skill taught, born at this rank. */
  static teachPrice(rank: number): number {
    return loreTeachPrice(rank);
  }

  /** The next raise of a held passive. Each costs more than the last, and none is the last. */
  static raisePrice(player: IPlayer, giftId: string, extra = 0): number {
    const found = findGift(player, giftId);
    if (!found) return Infinity;
    const skill = player.bank.universalSkills[found.skillId];
    const rarity = skill ? ProgressionSystem.skillRarity(skill) : 0;
    return Math.round(LORE_RAISE_PRICE * growth(rarity) * (1 + (found.gift.raises ?? 0) + extra));
  }

  private static raised(player: IPlayer, gift: ISkillGift): ISkillGift {
    const raises = gift.raises ?? 0;
    const value = gift.value ?? 0;
    const small = Math.abs(value) < 1;
    const least = small ? 0.01 : 1;
    const rolled = Math.abs(value) * RAISE_SHARE * (0.8 + 0.4 * Rng.fromKey(`${player.id}:${gift.id}:raise:${raises}`).next());
    const step = Math.max(least, small ? Math.round(rolled * 100) / 100 : Math.round(rolled));
    return { ...gift, value: small ? Math.round((value + step) * 100) / 100 : value + step, raises: raises + 1 };
  }

  // -----------------------------------------------------------------------
  // WHAT THE DREAM IS TOLD
  // -----------------------------------------------------------------------

  /** The oldest sittings first: what this dream takes. */
  static sittingsToAsk(player: IPlayer): IStudySitting[] {
    return sittingsOf(player).slice(0, SITTINGS_PER_DREAM);
  }

  /** The most this dream could have to spend: the purse, and every sitting at its deepest. */
  static reachable(player: IPlayer): number {
    // What is held, and all a queued sitting gives: a gift of its own category could be paid by every part of it
    return LoreLaw.reach(player.bank) + this.sittingsToAsk(player).reduce((sum, s) => sum + this.loreOf(s).amount, 0);
  }

  /** The gifts lore could pay for, one to a skill. The rest stay owed, because owed is read from the skill. */
  static giftsToAsk(player: IPlayer): (ReturnType<typeof CircleSystem.asks>[number] & { price: number })[] {
    let left = this.reachable(player);
    const out: (ReturnType<typeof CircleSystem.asks>[number] & { price: number })[] = [];
    for (const ask of CircleSystem.asks(player)) {
      const price = this.giftPrice(player, player.bank.universalSkills[ask.id]);
      if (price > left) continue;
      left -= price;
      out.push({ ...ask, owed: 1, price });
    }
    return out;
  }

  /** The gifts still owed that lore could not reach, for the person to be told. */
  static giftsWaiting(player: IPlayer): { id: string; price: number }[] {
    const asked = new Set(this.giftsToAsk(player).map(a => a.id));
    return CircleSystem.asks(player)
      .filter(a => !asked.has(a.id))
      .map(a => ({ id: a.id, price: this.giftPrice(player, player.bank.universalSkills[a.id]) }));
  }

  /** The passives lore could raise now. */
  static passivesToAsk(player: IPlayer): { gift: string; skill: string; name: string; stat?: string; value?: number; price: number }[] {
    const reach = this.reachable(player);
    return Object.entries(player.skillGifts ?? {}).flatMap(([skill, gifts]) => gifts
      .filter(g => g.kind === 'passive')
      .map(g => ({ gift: g.id, skill, name: g.name, stat: g.stat, value: g.value, price: this.raisePrice(player, g.id) }))
      .filter(g => g.price <= reach));
  }

  /** What the dream is told about the sittings. Only what the screen showed: no id, and nothing of an unread piece. */
  static studiedAsk(player: IPlayer) {
    return this.sittingsToAsk(player).map(s => ({
      id: s.id,
      kind: s.target.kind,
      name: s.target.name,
      tags: s.target.hidden ? [] : s.target.tags,
      outcome: s.outcome,
      before: s.before,
      peak: s.rankIndex,
      // The roll said what it pays: the model words it. Only the general share is the purse's to spend
      stretch: this.loreOf(s).stretch,
      gives: LoreLaw.split(this.loreOf(s).amount, !!this.loreOf(s).category).general
    }));
  }

  /** What the purse holds and what it could buy. */
  static purseAsk(player: IPlayer) {
    const topics = this.topicsOf(player).slice(0, TOPICS_TOLD).map(t => ({ topic: t.topic, xp: t.xp, peak: t.peak ?? 0 }));
    // A skill can grow from what this same answer files, so its sittings' ranks need a price too
    const peaks = [...new Set([...topics.map(t => t.peak), ...this.sittingsToAsk(player).map(s => s.rankIndex)])].sort((a, b) => a - b);
    return {
      held: this.held(player),
      topics,
      teachPriceByPeak: Object.fromEntries(peaks.map(peak => [peak, this.teachPrice(peak)]))
    };
  }

  /**
   * Is the purse worth a call with nothing else queued? Only for lore it has not been
   * offered yet, and only if that lore could buy something.
   */
  static worthFiling(player: IPlayer): boolean {
    const held = this.held(player);
    if (held <= (player.bank.loreOffered ?? -1)) return false;
    if (this.passivesToAsk(player).length > 0) return true;
    return this.topicsOf(player).some(t => this.teachPrice(t.peak ?? 0) <= held);
  }

  // -----------------------------------------------------------------------
  // THE LAW
  // -----------------------------------------------------------------------

  private static askedSitting(player: IPlayer, id: string): IStudySitting | undefined {
    return sittingsOf(player).find(s => s.id === id);
  }

  /** A word a topic can be: spelled by the law, and either on the registry or carried by the thing itself. */
  private static isTopic(word: string, carried: string[]): boolean {
    if (!TagLaw.isCanonicalSpelling(word)) return false;
    return carried.includes(word) || !!WebBank.tagEntry(WebBank.current(), word);
  }

  /** What a tag set would be born as: the highest rank studied under any of its words. */
  private static peakOf(tags: string[], topics: Record<string, ILoreEntry>): number {
    return Math.max(0, ...tags.map(t => topics[t]?.peak ?? 0));
  }

  /** What the answer leaves the person knowing, before anything is spent: each sitting's lore, by kind (the lore pass). */
  private static credited(player: IPlayer, studied: ILoreWords[]): { purse: { loreHeld: number; loreKinds?: Record<string, ILoreKind> }; topics: Record<string, ILoreEntry> } {
    let purse: { loreHeld: number; loreKinds?: Record<string, ILoreKind> } = { loreHeld: this.held(player), loreKinds: player.bank.loreKinds };
    const topics = { ...(player.bank.lore ?? {}) };
    for (const words of studied) {
      const sitting = this.askedSitting(player, words.id);
      if (!sitting) continue;
      const lore = this.loreOf(sitting);
      const pay = lore.amount;
      purse = LoreLaw.credit(purse, lore.category, lore.amount, lore.misread);
      for (const topic of words.topics ?? []) {
        const prior = topics[topic];
        topics[topic] = {
          topic,
          xp: (prior?.xp ?? 0) + pay,
          level: prior?.level ?? 1,
          dateDiscovered: prior?.dateDiscovered ?? sitting.at,
          peak: Math.max(prior?.peak ?? 0, sitting.rankIndex)
        };
      }
    }
    return { purse, topics };
  }

  /**
   * Refused whole when broken, like everything a rest brings back (D43): a sitting nobody
   * asked about, a word outside the vocabulary, a thing never studied, or more than the
   * purse. The log stays, and the next rest asks again.
   */
  static judge(answer: ILoreAnswer, asked: { sittings?: string[] }, player: IPlayer, hub?: IHubTree): { ok: boolean; reason?: string } {
    const studied = answer.studied ?? [];
    const taught = answer.taught ?? [];
    const raised = answer.raised ?? [];

    for (const words of studied) {
      const sitting = this.askedSitting(player, words.id);
      if (!(asked.sittings ?? []).includes(words.id) || !sitting) return no(`Nobody asked about ${words.id}.`);
      if (!words.line?.trim()) return no(`${words.id} came back with nothing to say.`);
      if (!Array.isArray(words.topics)) return no(`${words.id} came back with no topics.`);
      const stray = words.topics.find(t => !this.isTopic(t, sitting.target.tags));
      if (stray) return no(`${words.id} files under "${stray}", and the registry has no such word.`);
    }

    const { purse, topics } = this.credited(player, studied);

    const teaching = new Set<string>();
    for (const words of taught) {
      if (!Array.isArray(words.tags) || words.tags.length === 0) return no('A skill was taught from nothing.');
      if (!words.name?.trim()) return no('A skill came back with no name.');
      const stray = (words.grants ?? []).find(g => !(SKILL_GRANTS as readonly string[]).includes(g));
      if (stray) return no(`${words.name} grants "${stray}", and the game has no such thing.`);
      const tags = TagLaw.canonical(words.tags);
      const id = TagLaw.skillIdOf(tags);
      if (!WebSystem.isLawfulId(id)) return no(`${words.name}: "${id}" is not a skill anyone can hold.`);
      if (player.bank.universalSkills[id]) return no(`${words.name} is a skill they already hold.`);
      if (teaching.has(id)) return no(`${words.name} was taught twice.`);
      teaching.add(id);
      const unknown = tags.find(t => !(topics[t]?.xp > 0));
      if (unknown) return no(`${words.name} draws on ${unknown}, and that was never studied.`);
    }

    for (const words of raised) {
      const found = findGift(player, words.gift);
      if (!found || found.gift.kind !== 'passive') return no(`${words.gift} is not a passive they hold.`);
    }
    const spent = this.spendAll(player, answer, purse, topics, hub);
    if (!spent.purse) return no(`This answer spends ${spent.cost} lore, and they hold ${LoreLaw.reach(purse)}.`);
    return { ok: true };
  }

  /**
   * Every price an answer asks, paid in order (gifts, skills taught, raises), each from its own skill's category first and
   * then general (the lore pass, b). A null purse when one cannot be met: the answer is refused whole.
   */
  private static spendAll<T extends { loreHeld: number; loreKinds?: Record<string, ILoreKind> }>(player: IPlayer, answer: ILoreAnswer, start: T, topics: Record<string, ILoreEntry>, hub?: IHubTree): { purse: T | null; cost: number } {
    let purse: T | null = start;
    let cost = 0;
    const pay = (tags: string[], price: number) => {
      cost += price;
      if (purse) purse = LoreLaw.spend(purse, WebSystem.categoryOf(tags, hub)?.key, price);
    };
    const counted = new Map<string, number>();
    for (const g of answer.gifts ?? []) {
      const skill = player.bank.universalSkills[g.skill];
      if (!skill) continue;
      const extra = counted.get(g.skill) ?? 0;
      pay(skill.tags, this.giftPrice(player, skill, extra));
      counted.set(g.skill, extra + 1);
    }
    for (const words of answer.taught ?? []) {
      const tags = TagLaw.canonical(words.tags);
      pay(tags, this.teachPrice(this.peakOf(tags, topics)));
    }
    const raising = new Map<string, number>();
    for (const words of answer.raised ?? []) {
      const found = findGift(player, words.gift);
      if (!found) continue;
      const times = raising.get(words.gift) ?? 0;
      pay(player.bank.universalSkills[found.skillId]?.tags ?? [], this.raisePrice(player, words.gift, times));
      raising.set(words.gift, times + 1);
    }
    return { purse, cost };
  }

  // -----------------------------------------------------------------------
  // WHAT A JUDGED ANSWER DOES. Gifts are written by CircleSystem, after this.
  // -----------------------------------------------------------------------

  static apply(player: IPlayer, answer: ILoreAnswer, hub?: IHubTree): IPlayer {
    const studied = answer.studied ?? [];
    const taught = answer.taught ?? [];
    const raised = answer.raised ?? [];
    const { purse, topics } = this.credited(player, studied);
    const paid = this.spendAll(player, answer, purse, topics, hub).purse ?? purse;
    const universalSkills = { ...player.bank.universalSkills };
    const skillProgress = { ...(player.skillProgress ?? {}) };
    const skillWords = { ...(player.skillWords ?? {}) };
    for (const words of taught) {
      const tags = TagLaw.canonical(words.tags);
      const id = TagLaw.skillIdOf(tags);
      const rank = this.peakOf(tags, topics);
      universalSkills[id] = WebSystem.freshSkill(id, tags, rank);
      delete skillProgress[id];
      skillWords[id] = { name: words.name, flavor: words.flavor, grants: words.grants ?? [] };
    }

    let next: IPlayer = { ...player, skillProgress, skillWords, bank: { ...player.bank, universalSkills, lore: topics } };

    for (const words of raised) {
      const found = findGift(next, words.gift);
      if (!found) continue;
      const gift = this.raised(next, found.gift);
      next = {
        ...next,
        skillGifts: { ...next.skillGifts, [found.skillId]: next.skillGifts![found.skillId].map(g => (g.id === gift.id ? gift : g)) }
      };
    }

    const left = Math.max(0, paid.loreHeld);
    const answered = new Set(studied.map(w => w.id));
    const queue = next.restQueue;
    next = {
      ...next,
      bank: { ...next.bank, loreHeld: left, loreOffered: left, ...(paid.loreKinds ? { loreKinds: paid.loreKinds } : {}) },
      restQueue: queue && queue.sittings ? { ...queue, sittings: queue.sittings.filter(s => !answered.has(s.id)) } : queue
    };
    for (const id of Object.keys(universalSkills)) {
      if (!player.bank.universalSkills[id]) next = WebSystem.revealByMastery(next, id);
    }
    return raised.length > 0 ? CircleSystem.withPassives(next) : next;
  }

  // -----------------------------------------------------------------------
  // OLD SAVES, ONCE
  // -----------------------------------------------------------------------

  /**
   * A save from before the purse: each entry the bank already held is paid for, and any
   * gift it was already owed is covered, because it was earned when gifts cost only circles.
   * The purse being there is the mark that this has run.
   */
  static migrate(player: IPlayer): IPlayer {
    if (player.bank.loreHeld !== undefined) return player;
    const lore = player.bank.lore ?? {};
    let owed = 0;
    for (const ask of CircleSystem.asks(player)) {
      for (let i = 0; i < ask.owed; i++) owed += this.giftPrice(player, player.bank.universalSkills[ask.id], i);
    }
    return { ...player, bank: { ...player.bank, lore, loreHeld: Object.keys(lore).length * LORE_NOTE_PAY + owed } };
  }
}

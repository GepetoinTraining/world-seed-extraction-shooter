/**
 * THE PROCESS LAW (the raw materials leg — D23, D26)
 *
 * Base materials can be used as they come. A transformation step adds what the
 * raw thing lacks: a bonus, an affix, a suffix, drawn from the bank's PROCESS
 * entries, deterministically from a keyed stream, with ranges. Higher rank and
 * higher rarity open more pools; both count, and a pool only ever grows.
 *
 * The additions obey the one bank law (AffixBank): run 003 banked their names,
 * run 004 their effects. Their theme is PROCESS, so no dream reads them and a
 * world pinned before them compiles without them.
 *
 * What a step added stays unknown until it is revealed (D19's knowledge law):
 * study (StudySystem.reveal), lore (a trade note, read), or the skill itself
 * (hands that have done the work know what it leaves). All three file into
 * materialMastery, the one knowledge ledger.
 *
 * Improvised work is not a process and takes no draw: the floor stays the floor.
 */

import { IAffix, IBankedAffix, IContentPack, IItem, IPlayer, ItemType, Rarity, UniversalRank } from '../../types';
import { RECIPE_DEFINITIONS, GEAR_RECIPES } from '../../entities/economy/data/recipeDefinitions';
import { ItemFactory } from '../../entities/item/ItemFactory';
import { AffixBank } from '../content/AffixBank';
import { Rng, SeededRNG } from '../rng/DeterministicRNG';
import { WebBank } from '../content/WebBank';

export const PROCESS_THEME = 'PROCESS';

export const PROCESS_FAMILIES = ['carpentry', 'smelting', 'weaving', 'glassblowing', 'alchemy', 'masonry', 'smithing'] as const;
export type ProcessFamily = typeof PROCESS_FAMILIES[number];

/** The first pack version that holds the additions: runs 003 and 004 banked. */
export const FIRST_PROCESS_PACK = 4;

/** One finished job's worth of practice. Flat: the clock is not the teacher, the doing is. */
export const PROCESS_SKILL_XP_PER_JOB = 20;

/** Share of chest fragments that turn out to be a trade note, in a world pinned to the additions. */
const CHEST_NOTE_CHANCE = 0.25;

const MAX_TIER = 4;

const RANK_STEP: Record<string, number> = {
  [UniversalRank.F]: 0, [UniversalRank.E]: 1, [UniversalRank.D]: 1,
  [UniversalRank.C]: 2, [UniversalRank.B]: 2,
  [UniversalRank.A]: 3, [UniversalRank.S]: 3, [UniversalRank.SS]: 3, [UniversalRank.SSS]: 3
};

const RARITY_STEP: Record<string, number> = {
  [Rarity.SCRAP]: 0, [Rarity.COMMON]: 0, [Rarity.UNCOMMON]: 1, [Rarity.RARE]: 2,
  [Rarity.EPIC]: 3, [Rarity.LEGENDARY]: 3, [Rarity.ARTIFACT]: 3
};

/** What a trade's note says: the error code, never the magic. */
const TRADE_NOTES: Record<ProcessFamily, { name: string; text: string }> = {
  carpentry: { name: "A Carpenter's Notes", text: 'Margin note, in a hand that gave up on the page: a plank is a log that has been asked a question. What you hear back depends on the cut.' },
  smelting: { name: "A Smelter's Notes", text: 'Shift log, furnace 3: the ore does not get better. The ingot just stops lying about what it is. Write down what it stopped lying about.' },
  weaving: { name: "A Weaver's Notes", text: 'Pattern card, punched by hand: the warp keeps the count even when nobody else does. A bolt remembers every hand that hurried it.' },
  glassblowing: { name: "A Glassblower's Notes", text: 'Glassworks memo, cycle unknown: sand remembers being a window. It does not always remember the same window.' },
  alchemy: { name: "An Alchemist's Notes", text: 'Reagent ledger, stained: the boil leaves something behind that was in neither pot. Error 12. Do not correct it. Sell it.' },
  masonry: { name: "A Mason's Notes", text: 'Scratched inside a course of the first wall: square the stone and it stops being a rock. Ask what it was keeping out, and it will keep that out for you.' },
  smithing: { name: "A Smith's Notes", text: 'Anvil tally, the last entry unfinished: iron takes the shape of the blow and the temper of the hour. Both are on the record if you can read it.' }
};

const round = (value: number) => (Math.abs(value) < 1 ? parseFloat(value.toFixed(2)) : Math.round(value));

export class ProcessSystem {

  static familyTag(family: ProcessFamily): string {
    return `process_${family}`;
  }

  /** The skill a trade grows, D6's skills-grow-by-use track. */
  static familySkill(family: ProcessFamily): string {
    return `skill_${family}`;
  }

  static familyOfRecipe(recipeId: string): ProcessFamily | null {
    // D27: a web recipe names its trade itself, and the additions are that trade's.
    const web = WebBank.recipe(recipeId);
    if (web) return PROCESS_FAMILIES.includes(web.trade as ProcessFamily) ? web.trade as ProcessFamily : null;
    const skill = RECIPE_DEFINITIONS[recipeId]?.requiredSkill;
    if (skill) {
      const family = skill.replace(/^skill_/, '') as ProcessFamily;
      return PROCESS_FAMILIES.includes(family) ? family : null;
    }
    // A gear recipe at a bench is smithing. An improvised one has no bench and no process.
    return GEAR_RECIPES[recipeId]?.requiredFacility ? 'smithing' : null;
  }

  /** How many pools stand open: 1 for a common F-rank, more with rank AND rarity, 4 at most. */
  static openTier(rank: UniversalRank | string, rarity: Rarity | string): number {
    return Math.min(MAX_TIER, 1 + (RANK_STEP[rank] ?? 0) + (RARITY_STEP[rarity] ?? 0));
  }

  /** The highest tier any of a job's goods open: the output and everything consumed. */
  static openTierOf(goods: { rank?: UniversalRank | string; rarity?: Rarity | string }[]): number {
    return goods.reduce((best, g) => Math.max(best, this.openTier(g.rank ?? UniversalRank.F, g.rarity ?? Rarity.COMMON)), 1);
  }

  private static familyEntries(pack: IContentPack, family: ProcessFamily, tier: number): IBankedAffix[] {
    const tag = this.familyTag(family);
    return pack.entries
      .filter(e => e.theme === PROCESS_THEME && e.statModifiers && e.tier <= tier && e.allowedTags.includes(tag))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** The pool a good of this rank and rarity draws from. A superset as either rises. */
  static poolFor(pack: IContentPack, family: ProcessFamily, rank: UniversalRank | string, rarity: Rarity | string): IBankedAffix[] {
    return this.familyEntries(pack, family, this.openTier(rank, rarity));
  }

  private static roll(entry: IBankedAffix, rng: SeededRNG): IAffix {
    const stats: Record<string, number> = {};
    for (const [stat, [min, max]] of Object.entries(entry.statModifiers ?? {})) {
      stats[stat] = round(min + rng.next() * (max - min));
    }
    return { id: entry.id, name: entry.name, type: entry.type, stats, tier: entry.tier };
  }

  /** One addition, by rank and rarity. Pure in the stream: same key, same record. */
  static draw(pack: IContentPack, family: ProcessFamily, rank: UniversalRank | string, rarity: Rarity | string, rng: SeededRNG): IAffix {
    return this.roll(rng.pick(this.poolFor(pack, family, rank, rarity)), rng);
  }

  /**
   * What one output of one step carries: everything its components carried
   * (each once, the first keeping its claim), plus what this step adds. A step
   * always adds: it draws something the good does not yet hold, and if the
   * whole pool is already on it, the step works the same addition deeper.
   */
  static stepAffixes(pack: IContentPack, family: ProcessFamily, tier: number, inherited: IAffix[], rng: SeededRNG): IAffix[] {
    const carried = this.inherit(inherited);
    const pool = this.familyEntries(pack, family, tier);
    if (pool.length === 0) return carried;
    const fresh = pool.filter(e => !carried.some(a => a.id === e.id));
    const added = this.roll(rng.pick(fresh.length > 0 ? fresh : pool), rng);
    const already = carried.find(a => a.id === added.id);
    if (!already) return [...carried, added];
    for (const [stat, value] of Object.entries(added.stats)) {
      already.stats[stat] = parseFloat(((already.stats[stat] ?? 0) + value).toFixed(2));
    }
    return carried;
  }

  /** Copies, each id once, in order. D6's dedupe law, outside the gear path too. */
  static inherit(affixes: IAffix[]): IAffix[] {
    const kept: IAffix[] = [];
    for (const affix of affixes) {
      if (!kept.some(a => a.id === affix.id)) kept.push({ ...affix, stats: { ...affix.stats } });
    }
    return kept;
  }

  // ---------------------------------------------------------------------
  // THE REVEAL, through the one ledger
  // ---------------------------------------------------------------------

  /** File these entries as known. The ledger is materialMastery, and nothing else. */
  private static file(player: IPlayer, family: ProcessFamily, ids: string[]): IPlayer {
    const key = `process_${family}`;
    const prior = player.materialMastery[key] ?? { resourceId: key, knowledgeLevel: 0, discoveredAffixes: [] };
    return {
      ...player,
      materialMastery: {
        ...player.materialMastery,
        [key]: {
          resourceId: key,
          knowledgeLevel: Math.max(prior.knowledgeLevel, 1),
          discoveredAffixes: [...new Set([...prior.discoveredAffixes, ...ids])]
        }
      }
    };
  }

  /** The tier a trade knows by hand. Level 1 is a first attempt: it knows nothing yet. */
  static tierKnownByHand(level: number): number {
    return Math.max(0, level - 1);
  }

  /**
   * The skill itself reveals: "the actual knowledge is through play". Hands at
   * level 2 know the common tier of their own trade, level 3 the next. Returns
   * the player unchanged, same reference, when nothing new was learned.
   */
  static revealBySkill(player: IPlayer, family: ProcessFamily): IPlayer {
    const level = player.bank.universalSkills[this.familySkill(family)]?.level ?? 0;
    const known = this.tierKnownByHand(level);
    if (known <= 0) return player;
    const prior = player.materialMastery[`process_${family}`]?.discoveredAffixes ?? [];
    const ids = this.familyEntries(AffixBank.current(), family, known).map(e => e.id).filter(id => !prior.includes(id));
    return ids.length > 0 ? this.file(player, family, ids) : player;
  }

  /** D27: mastery reveals. A graded pair opens its trade's first tier, an attuned one the next. */
  static revealTier(player: IPlayer, family: ProcessFamily, tier: number): IPlayer {
    if (!PROCESS_FAMILIES.includes(family)) return player;
    const prior = player.materialMastery[`process_${family}`]?.discoveredAffixes ?? [];
    const ids = this.familyEntries(AffixBank.current(), family, tier).map(e => e.id).filter(id => !prior.includes(id));
    return ids.length > 0 ? this.file(player, family, ids) : player;
  }

  /** Lore reveals: a read note opens its tier of its trade, nothing more. */
  static revealByLore(player: IPlayer, note: IItem): IPlayer {
    const data = note.loreData;
    if (!data) return player;
    const family = data.processFamily as ProcessFamily;
    return this.file(player, family, this.familyEntries(AffixBank.current(), family, data.tier).map(e => e.id));
  }

  // ---------------------------------------------------------------------
  // LORE AS AN ITEM
  // ---------------------------------------------------------------------

  static noteTopic(family: ProcessFamily | string): string {
    return `The trade: ${family}`;
  }

  /** A trade note: a document like any fragment, whose reading opens its trade's first pool. */
  static tradeNote(family: ProcessFamily, rng: SeededRNG): IItem {
    const note = TRADE_NOTES[family];
    return {
      ...ItemFactory.createResourceItem({ id: `lore_trade_${family}`, name: note.name, icon: 'note_icon', weight: 0.1, dimensions: { width: 1, height: 1 } } as any, rng),
      type: ItemType.LORE,
      description: note.text,
      value: 60,
      tags: ['lore', 'document', 'trade_note'],
      loreData: { processFamily: family, tier: 1 }
    };
  }

  /**
   * Which trade a chest's fragment teaches, or null. Only a world pinned to the
   * additions has any, and the choice is its own keyed stream, so the chest's
   * loot, ids and fragment land exactly where they always did.
   */
  static chestNote(pinnedVersion: number | undefined, rollKey: string): ProcessFamily | null {
    if (!pinnedVersion || pinnedVersion < FIRST_PROCESS_PACK) return null;
    const rng = Rng.fromKey(`${rollKey}:trade_note`);
    if (rng.next() >= CHEST_NOTE_CHANCE) return null;
    return rng.pick([...PROCESS_FAMILIES]);
  }

  /** The words of a trade's note, for a chest fragment that turns out to be one. */
  static noteOf(family: ProcessFamily): { name: string; text: string } {
    return TRADE_NOTES[family];
  }
}

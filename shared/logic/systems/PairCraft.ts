/**
 * CRAFTING BY TWO (Pedro, 2026-11-10: "crafting needs to be material + material, one dragged on top
 * of another, and then Unidentified appears. there's a secret crafting roll that's done, and after
 * rest you see what you made").
 *
 * One material is set on another. Both are used, and one unread thing comes of it. What it is was
 * decided at once, by a roll nobody is shown, and it is read at the next rest.
 *
 * What two things make is never written here: it is read from their world's own chain, the goods
 * and gear a theme already says are made from them. A pair is its own bill, so the counts a bench
 * asks are a bench's: two kinds a making joins are that making, whichever is set on which. Two
 * things no making joins are spoiled.
 *
 * The roll comes out four ways, as a sitting does (D118): lost, crude, as it should, and better
 * than it should. A making that asks for a bench can still come out of bare hands, against a
 * harder bar, so a bench is worth having and nothing is simply forbidden.
 *
 * Pure: no store, no clock. The caller moves the pieces and keeps the record. Every number here is
 * a guess until Wave 12.
 */

import { IAffix, IItem, ItemType, StudyOutcome, UniversalRank } from '../../types';
import { CRAFTED_DEFINITIONS, GEAR_RECIPES, RECIPE_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { CRAFTED_GEAR_BASES, ITEM_DEFINITIONS } from '../../entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { ItemFactory } from '../../entities/item/ItemFactory';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { WebBank } from '../content/WebBank';
import { CompositionSystem } from '../economy/CompositionSystem';
import { Rng } from '../rng/DeterministicRNG';

/** What is asked of a making of the maker's own rank. */
export const MAKE_DC_BASE = 8;
/** Each rank the thing made stands above its maker. */
export const MAKE_DC_PER_RANK = 3;
/** What a making that asks for a bench costs a hand with none under it. */
export const MAKE_NO_BENCH = 5;
/** How far from what was asked makes it lost, or better than it should be. */
export const MAKE_MAJOR_MARGIN = 10;
/** The span a thing's quality is rolled in when it is made (the factory's own): crude is its foot, fine its head. */
export const QUALITY_SPAN = 0.2;

const OUTCOME_LADDER: StudyOutcome[] = ['major_failure', 'failure', 'success', 'major_win'];

/** Why a thing was lost: the two make nothing, it wanted a bench, or the hands slipped. */
export type MakeWhy = 'NOTHING' | 'BENCH' | 'HANDS';

const WHY_WORDS: Record<MakeWhy, string> = {
  NOTHING: 'Two things that do not go together, pressed together anyway.',
  BENCH: 'It wanted a bench under it, and had a knee.',
  HANDS: 'The hands slipped. It might have been something.'
};

/** A making, as the pair reads it from the world's chain. */
export interface IPairRecipe {
  id: string;
  name: string;
  kind: 'good' | 'gear';
  bill: { itemId: string; quantity: number }[];
  /** A definition's id for a good, a base's id for gear. */
  output: string;
  /** The trade a good's making works, when it has one. */
  trade?: string;
  /** The bench or station it is made at, or null for hands alone. */
  asks: string | null;
  laborSeconds: number;
}

/** Who is making, and what stands under their hands. */
export interface IMaker {
  rank: UniversalRank;
  dexterity: number;
  skillLevel: (skillId: string) => number;
  hasBench: (asks: string) => boolean;
}

export interface IMade {
  /** What came of it, unread. */
  item: IItem;
  outcome: StudyOutcome;
  recipe: IPairRecipe | null;
  /** Set only when it was lost. */
  why?: MakeWhy;
  roll: { d20: number; total: number; dc: number };
}

type Verdict = { ok: boolean; reason?: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

const nameOf = (item: IItem) => (item.isIdentified === false ? 'that' : item.name);

/** Every making the installed worlds hold, in one shape. Read when asked, since themes install after load. */
function makings(): IPairRecipe[] {
  const goods = [...Object.values(RECIPE_DEFINITIONS), ...WebBank.current().recipes].map((r): IPairRecipe => {
    const loose = r as { trade?: string; requiredSkill?: string; requiredStation?: string; requiredFacility?: string | null };
    const trade = loose.trade ?? (loose.requiredSkill ? loose.requiredSkill.replace(/^skill_/, '') : undefined);
    return {
      id: r.id, name: r.name, kind: 'good',
      bill: r.inputs.map(i => ({ itemId: i.itemId, quantity: i.quantity })),
      output: r.outputs[0]?.itemId ?? '',
      ...(trade ? { trade } : {}),
      asks: loose.requiredStation ?? loose.requiredFacility ?? null,
      laborSeconds: r.laborTimeSeconds
    };
  });
  const gear = Object.values(GEAR_RECIPES).map((r): IPairRecipe => ({
    id: r.id, name: r.name, kind: 'gear', bill: r.inputs.map(i => ({ ...i })), output: r.outputBase, asks: r.requiredFacility, laborSeconds: r.laborTimeSeconds
  }));
  return [...goods, ...gear].filter(r => r.output && r.bill.length > 0);
}

const gearBase = (id: string) => CRAFTED_GEAR_BASES.find(b => b.id === id)
  ?? [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases].find(b => b.id === id);
const goodDef = (id: string) => CRAFTED_DEFINITIONS[id] ?? RESOURCE_DEFINITIONS[id];
const rankOfProduct = (recipe: IPairRecipe): UniversalRank =>
  ((recipe.kind === 'gear' ? gearBase(recipe.output)?.rank : goodDef(recipe.output)?.rank) ?? UniversalRank.F) as UniversalRank;

export const PairCraft = {
  /** Is this a thing that can be worked into another? Raw or made, and never gear, a document or a person. */
  isMaterial(item: IItem): boolean {
    return item.type === ItemType.RESOURCE && !item.bondData && !(item.tags ?? []).includes('npc_contract');
  },

  /** May this be set on that? Two materials, both read, and not one piece on itself. */
  mayCombine(item: IItem, onto: IItem): Verdict {
    if (item.id === onto.id) return no('A thing is not set on itself.');
    for (const piece of [item, onto]) {
      if (piece.isIdentified === false) return no('You do not know what that is yet. Rest first, and then work it.');
      if (!this.isMaterial(piece)) return no(`${nameOf(piece)} is not something to work into another thing.`);
    }
    return { ok: true };
  },

  /**
   * What the chain makes of these two kinds, or null. A making fits when its bill names exactly
   * these kinds. Where several fit, the one whose bill is nearest the pair, then the lowest id.
   */
  recipeFor(defA: string, defB: string): IPairRecipe | null {
    const given = new Map<string, number>();
    for (const id of [defA, defB]) given.set(id, (given.get(id) ?? 0) + 1);
    const far = (r: IPairRecipe) => r.bill.reduce((n, line) => n + Math.abs(line.quantity - (given.get(line.itemId) ?? 0)), 0);
    const fits = makings().filter(r => {
      const kinds = new Set(r.bill.map(line => line.itemId));
      return kinds.size === given.size && [...given.keys()].every(k => kinds.has(k));
    });
    return fits.sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
  },

  /** How it landed. A twenty moves it one better and a one one worse. */
  degree(d20: number, total: number, dc: number): StudyOutcome {
    const margin = total - dc;
    let step = margin >= MAKE_MAJOR_MARGIN ? 3 : margin >= 0 ? 2 : margin > -MAKE_MAJOR_MARGIN ? 1 : 0;
    if (d20 === 20) step = Math.min(3, step + 1);
    if (d20 === 1) step = Math.max(0, step - 1);
    return OUTCOME_LADDER[step];
  },

  /**
   * The whole making, pure. The same two pieces, the same maker and the same key come to the same
   * thing on any machine. The dice are drawn before anything is read off them, and the thing is
   * minted from a stream of its own, so a bench moves the bar and never the dice or the id.
   */
  make(item: IItem, onto: IItem, maker: IMaker, rollKey: string): IMade {
    const d20 = Rng.fromKey(rollKey).int(1, 21);
    const mintRng = Rng.fromKey(`${rollKey}:made`);
    const recipe = this.recipeFor(item.universalDefinitionId, onto.universalDefinitionId);
    const unread = (made: IItem): IItem => ({ ...made, isIdentified: false });

    const spoiled = (why: MakeWhy, roll: IMade['roll']): IMade => ({
      item: unread(ItemFactory.createResourceItem({
        id: 'made_spoiled_work', name: 'Spoiled Work', description: WHY_WORDS[why],
        weight: Math.max(0.1, Math.round(((item.weight + onto.weight) / 2) * 10) / 10),
        dimensions: { width: 1, height: 1 }, tags: [], rank: UniversalRank.F, worth: 1
      } as never, mintRng, { origin: 'IMPROVISATION' })),
      outcome: 'major_failure', recipe, why, roll
    });

    if (!recipe) return spoiled('NOTHING', { d20, total: d20, dc: MAKE_DC_BASE });

    const benchless = !!recipe.asks && !maker.hasBench(recipe.asks);
    const dc = MAKE_DC_BASE
      + (ProgressionSystem.rankIndex(rankOfProduct(recipe)) - ProgressionSystem.rankIndex(maker.rank)) * MAKE_DC_PER_RANK
      + (benchless ? MAKE_NO_BENCH : 0);
    const total = d20 + (recipe.trade ? maker.skillLevel(`skill_${recipe.trade}`) : 0) + Math.max(0, maker.dexterity - 1);
    const roll = { d20, total, dc };
    const outcome = this.degree(d20, total, dc);

    if (outcome === 'major_failure') {
      // With a bench under it this would not have been lost: say so, once it is read
      const withBench = this.degree(d20, total, dc - MAKE_NO_BENCH);
      return spoiled(benchless && withBench !== 'major_failure' ? 'BENCH' : 'HANDS', roll);
    }

    const composition = CompositionSystem.compose(
      { recipeId: recipe.id, name: recipe.name, laborSeconds: recipe.laborSeconds, facility: null },
      [item, onto].map(i => i.composition ?? CompositionSystem.root({ id: i.universalDefinitionId, name: i.name }, 'IMPROVISATION')),
      1
    );
    const rolled = (mintRng.next() * 2 - 1) * QUALITY_SPAN;
    const quality = outcome === 'failure' ? -QUALITY_SPAN : outcome === 'major_win' ? QUALITY_SPAN : rolled;
    // D6's crafting half: what the pieces carried rides onto what they make
    const inherited: IAffix[] = [...(item.affixes ?? []), ...(onto.affixes ?? [])];

    let made: IItem | null;
    if (recipe.kind === 'gear') {
      made = ItemFactory.createComposedItem(recipe.output, composition, mintRng, { inheritedAffixes: inherited, quality });
    } else {
      const def = goodDef(recipe.output);
      made = def ? ItemFactory.createResourceItem(def, mintRng, { origin: 'IMPROVISATION', quality }) : null;
      if (made) {
        made.composition = composition;
        made.value = CompositionSystem.priceOf(composition);
      }
    }
    // A making the chain names and no definition stands behind comes to nothing, and says it was the hands
    if (!made) return spoiled('HANDS', roll);
    return { item: unread(made), outcome, recipe, roll };
  }
};

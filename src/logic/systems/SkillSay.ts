/**
 * WHAT A SKILL IS, AND WHAT IT DOES, IN A PLAYER'S WORDS (GV, 2026-11-12). Pedro, after a long run: "the way the skills
 * come into play don't tell anyone anything, the character sheet itself needs a passover". A forming skill read as a tag
 * string and a row of brackets; a held one as its rung's name. Here every skill held and forming is said as the game
 * says it: what it is, what it does when it comes into play, what makes it grow, and what it still needs.
 *
 * Every number is a rules function's answer (WebSystem, LoreLaw, LoreSystem, CircleSystem), asked the way the rest and
 * the work ask it; nothing here sums a rule of its own. What a skill is comes from the tag registry's player words
 * (`ITagEntry.say`), so a theme's own tag reads as its own word and no table of skills lives in code.
 */

import { IItem, IPlayer, ISkillGift, ISkillState } from '../../../shared/types';
import { IHubTree, MASTERY_RUNGS, WebSystem } from '../../../shared/logic/systems/WebSystem';
import { WebBank } from '../../../shared/logic/content/WebBank';
import { LoreLaw } from '../../../shared/logic/systems/LoreLaw';
import { LEVELS_PER_CIRCLE } from '../../../shared/entities/player/systems/ProgressionSystem';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { DELIVERIES, EFFECTS, PASSIVE_STATS } from '../../../shared/logic/theme/ThemeTypes';
import { CIRCLES_FOR_A_GIFT, CircleSystem } from './CircleSystem';
import { LoreSystem } from './LoreSystem';
import { said } from './SheetWords';

type Pack = ReturnType<typeof WebBank.current>;
type Web = Parameters<typeof WebSystem.earnedSheet>[2];

const DOING_KINDS = ['tool', 'trade', 'action'] as const;
const WORKED_KINDS = ['family', 'material', 'element'] as const;

/** A tag as a player says it: the registry's word, or the tag itself as plain words. */
const sayOf = (pack: Pack, tag: string): string => pack.tags.find(t => t.tag === tag)?.say ?? tag.replace(/_/g, ' ');
const listed = (words: string[]): string => words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unique = (words: string[]) => [...new Set(words)];

/** What a step of learning shows of the things a skill works, said of them. */
const STEP_SHOWS: Record<(typeof MASTERY_RUNGS)[number], (things: string) => string> = {
  named: t => `the names of ${t}`, handled: t => `the plain properties of ${t}`,
  graded: t => `what ${t} can become`, attuned: t => `what can hide in ${t}`
};

/** A gift's stat as a player reads it. Every stat a gift may raise has a word (a new one fails the build until it does). */
const STAT_SAY: Record<(typeof PASSIVE_STATS)[number], string> = {
  damage: 'damage', defense: 'defense', max_health: 'health', max_energy: 'energy', accuracy_rating: 'aim',
  evasion_rating: 'dodging', attack_speed: 'attack speed', crit_chance: 'crit chance', crit_multiplier: 'crit damage',
  block_chance: 'block chance', poison_damage: 'poison', light_radius: 'light', pickup_radius: 'reach for pickups',
  carry_capacity: 'carry', noise_reduction: 'quiet', luck_find_rarity: 'luck', field_analysis_speed: 'reading speed'
};
const EFFECT_SAY: Record<(typeof EFFECTS)[number], string> = {
  damage: 'hurts what it reaches', control: 'slows what it reaches', heal: 'mends you', buff: 'quickens you',
  debuff: 'keeps hurting what it reaches', ward: 'wards off the next blows', rest: 'rests you', forced_exit: 'pulls you out'
};
const DELIVERY_SAY: Record<(typeof DELIVERIES)[number], string> = {
  self: 'on yourself', touch: 'by touch', melee: 'up close', ranged: 'from afar', area: 'all around a spot', aura: 'all around you'
};

export interface HeldSay {
  id: string;
  name: string;
  rank: ReturnType<typeof WebSystem.earnedSheet>['earned'][number]['rank'];
  level: number;
  flavor?: string;
  firstBy?: string;
  /** How far it has been learned: a word, which of how many, and how far into the next. */
  step: { word: string; at: number; of: number; into: number };
  /** What it does when it comes into play. */
  does: string[];
  grows: string;
  circles: { filled: number; first: number; nextGiftAt: number };
  gifts: string[];
  /** A gift owed and what the rest will ask for it. */
  giftWaits?: string;
}

export interface FormingSay {
  said: string;
  fill: number;
  grows: string;
  asks: number;
  holds: number;
}

export const SkillSay = {
  /** What a skill is, from its tags: "Shooting beasts and devices", "Sawing plants and wood", "Berries, by hand". */
  whatItIs(tags: string[], pack: Pack = WebBank.current()): string {
    const doing = unique(tags.filter(t => WebBank.hasKind(pack, t, [...DOING_KINDS])).map(t => sayOf(pack, t)));
    const worked = unique(tags.filter(t => WebBank.hasKind(pack, t, [...WORKED_KINDS])).map(t => sayOf(pack, t)));
    if (doing.length === 0) return worked.length ? `${capital(listed(worked))}, by hand` : 'Work by hand';
    return capital([listed(doing), listed(worked)].filter(Boolean).join(' '));
  },

  /** An identify skill forming names nothing (D32): which eye would say what the unread piece was. */
  isEye(tags: string[]): boolean {
    return tags.some(t => t.startsWith('identify'));
  },

  /** The lore a thing of these tags can draw on: general, and its own kind unless a misreading locks it. */
  loreFor(player: IPlayer, tags: string[], hub?: IHubTree): number {
    return LoreLaw.spendable(player.bank, WebSystem.categoryOf(tags, hub)?.key);
  },

  /** Every skill held, said: what it is, what it does, what grows it, its circles and gifts. */
  held(player: IPlayer, web: Web, hub: IHubTree | undefined, hand: IItem | undefined, pack: Pack = WebBank.current()): HeldSay[] {
    const sheet = WebSystem.earnedSheet(player, pack, web);
    const asks = CircleSystem.asks(player);
    return sheet.earned.map(row => {
      const skill = player.bank.universalSkills[row.id] as ISkillState;
      const tags = skill.tags;
      const what = this.whatItIs(tags, pack);
      const worked = WebSystem.materialIdentity(tags, pack);
      // Only what is gathered asks a skill's price in energy and time (the harvest), and only a material is revealed
      const gathered = WebSystem.materialsOf(tags, pack).length > 0;
      const does: string[] = [];
      if (gathered) {
        // The work's own price, asked of the rules with the skill and without it
        const pair = { id: row.id, tags };
        const untrained = { ...player, bank: { ...player.bank, universalSkills: {} } };
        const energy = 1 - WebSystem.energyFor(player, pair, 100).cost / WebSystem.energyFor(untrained, pair, 100).cost;
        const time = 1 - WebSystem.clockFactor(player, pair) / WebSystem.clockFactor(untrained, pair);
        does.push(`It takes ${Math.round(energy * 100)}% less energy and ${Math.round(time * 100)}% less time than untrained.`);
      }
      // The fight reads a skill only when every word of it is on the weapon (WebSystem.handPower), so a skill that works
      // something reaches no blow; GV5 holds what such a skill does in a fight as an open row
      const power = Math.round(WebSystem.skillPower(skill) * 100);
      const fits = !!hand && tags.length > 0 && tags.every(t => (hand.tags ?? []).includes(t));
      if (fits) does.push(`Your blows with the ${LoadoutSystem.shownName(hand!)}: +${power}%.`);
      else if (worked.length === 0) does.push(`Blows with a weapon it fits: +${power}%${power === 0 ? ', rising with its level' : ''}.`);
      if (row.verbs.length > 0) does.push(`Lets you ${listed(row.verbs)}.`);
      if (row.opens.length > 0) does.push(`Your hub can raise ${listed(row.opens)}.`);
      if (gathered) {
        const things = listed(unique(worked.map(t => sayOf(pack, t))));
        const next = row.rung < MASTERY_RUNGS.length - 1 ? ` Next: ${STEP_SHOWS[MASTERY_RUNGS[row.rung + 1]](things)}.` : '';
        does.push(`You know ${STEP_SHOWS[row.rungName](things)}.${next}`);
        does.push(`Studying ${things} costs you less.`);
      }
      const first = CircleSystem.firstAsks(player, row.id);
      let nextGiftAt = first;
      while (nextGiftAt <= row.circles) nextGiftAt += CIRCLES_FOR_A_GIFT;
      const owed = asks.find(a => a.id === row.id);
      const price = owed ? LoreSystem.giftPrice(player, skill) : 0;
      return {
        id: row.id,
        // Q47: a skill nobody has named reads as what it is, never as its tag list
        name: WebSystem.isTagListName(row.id, row.name, pack) ? what : row.name,
        rank: row.rank,
        level: row.level,
        flavor: row.flavor,
        firstBy: row.firstBy,
        step: { word: capital(row.rungName), at: row.rung + 1, of: MASTERY_RUNGS.length, into: row.into },
        does,
        grows: `Grows with use: ${what.toLowerCase()}.`,
        circles: { filled: row.circles, first, nextGiftAt },
        gifts: CircleSystem.giftsOf(player, row.id).map(g => this.gift(g)),
        ...(owed ? { giftWaits: `A gift waits for your next rest: ${price} lore, you hold ${said(this.loreFor(player, tags, hub))}.` } : {})
      };
    });
  },

  /** Every skill forming, said: what it is, what grows it, the lore it asks and the lore held for it. Eyes fold into one. */
  forming(player: IPlayer, hub: IHubTree | undefined, pack: Pack = WebBank.current()): FormingSay[] {
    const out: FormingSay[] = [];
    for (const progress of Object.values(player.skillProgress ?? {})) {
      const eye = this.isEye(progress.tags);
      const what = eye ? 'A trained eye' : this.whatItIs(progress.tags, pack);
      const row: FormingSay = {
        said: what,
        fill: WebSystem.emergenceFill(progress),
        grows: eye ? 'Forms as you try to read what you have not read.' : `Forms as you keep at it: ${what.toLowerCase()}.`,
        asks: WebSystem.learnPrice(progress.rank),
        holds: this.loreFor(player, progress.tags, hub)
      };
      const same = out.find(r => r.said === row.said);
      if (same) { same.fill = Math.max(same.fill, row.fill); same.asks = Math.min(same.asks, row.asks); }
      else out.push(row);
    }
    return out.sort((a, b) => b.fill - a.fill || (a.said < b.said ? -1 : 1));
  },

  /** A gift in words: what it raises and by how much, or what it does and how it is cast. */
  gift(g: ISkillGift): string {
    if (g.kind === 'passive') {
      const v = g.value ?? 0;
      const amount = Math.abs(v) < 1 ? `${Math.round(v * 100)}%` : said(v);
      return `${g.name}: ${STAT_SAY[g.stat as (typeof PASSIVE_STATS)[number]] ?? (g.stat ?? '').replace(/_/g, ' ')} ${v >= 0 ? '+' : ''}${amount}`;
    }
    const act = EFFECT_SAY[g.effect as (typeof EFFECTS)[number]] ?? (g.effect ?? '').replace(/_/g, ' ');
    const how = DELIVERY_SAY[g.delivery as (typeof DELIVERIES)[number]] ?? (g.delivery ?? '').replace(/_/g, ' ');
    return `${g.name}: ${act}, ${how}`;
  },

  /** What a circle and a gift are, said once where they are spent. */
  circlesLine(player: IPlayer): string {
    const firstGift = CircleSystem.holdsAGift(player) ? '' : ' Your very first gift asks only one.';
    return `A circle comes every ${LEVELS_PER_CIRCLE} levels: put it in a skill with +. Every third circle in a skill brings a gift at a rest, paid in lore.${firstGift}`;
  }
};

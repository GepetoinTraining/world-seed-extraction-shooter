/**
 * THE LEADERS (D93): who stands at the head of a pack, read from the seed.
 *
 * An elite is on a keyed roster by sector, so a world's elites are known without building a
 * chunk. Its sheet and its first goal are dealt at read time through the door people use
 * (`NpcSheet`), so they come back byte for byte and nothing is stored for them. What
 * happens to one afterwards is a single body the population record holds.
 *
 * Only a social species leads. A solitary elite has a sheet and a goal like any other, and no
 * pack. Boss, titan and god stay one of a kind, alone, under R4's rule. A seat, a base and
 * anchors are `Territory`'s. This one reads who a body is; it builds nothing.
 */

import { bodyLawOf, laysByLaw } from '../mob/BodyLaw';
import { BODIES_FROM_GROUND } from '../../logic/theme/ThemeFormula';
import { IAttributes, ISkillState, UniversalRank } from '../../types';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { TagLaw } from '../../logic/content/TagLaw';
import { NpcSheet } from '../../logic/systems/NpcSheet';
import { WebSystem } from '../../logic/systems/WebSystem';
import { GOAL_BANDS, ROSTER_NUMBERS, leaderNumbers } from '../../logic/theme/ThemeFormula';
import { BIOME_RESOURCES } from '../item/data/resourceDefinitions';
import { SECTOR_CHUNKS } from './grid';
import { IGenerationContext, WorldGenerator } from './WorldGenerator';

export const GOALS = Object.keys(GOAL_BANDS) as Goal[];
export type Goal = keyof typeof GOAL_BANDS;

const DRIVES = ['power', 'wealth', 'safety', 'revenge', 'legacy'] as const;
const NATURES = ['cruel', 'patient', 'proud', 'cautious', 'greedy', 'zealous'] as const;
/** The drive says which goal it prefers, not which it may take. */
const PREFERS: Record<typeof DRIVES[number], Goal> = { power: 'take', wealth: 'settle', safety: 'grow', revenge: 'hunt', legacy: 'settle' };

/** What the land deals: where a leader begins, and how many walk behind it. */
export interface ILeaderSeed {
  id: string;
  kind: string;
  cx: number;
  cy: number;
  pack: number;
}

export interface ILeaderSheet {
  stats: IAttributes;
  skills?: Record<string, ISkillState>;
  temperament: string;
  drive: string;
  /** Its first goal, dealt when the world was. */
  goal: Goal;
}

interface ILeaderKind {
  id: string; rank: UniversalRank; tags: string[]; habitat?: string[]; behavior?: string;
  baseHealth: number; baseDamage: number; social?: boolean; builds?: boolean; leads?: string; tree?: string;
}

const ONE_OF_A_KIND = ['boss', 'titan', 'god'];
const LEADER_ID = /^lead_-?\d+_-?\d+_\d+(?:_(?:h|w)\d+)*$/;
const HERD_OF_LEADER = /^(lead_-?\d+_-?\d+_\d+(?:_(?:h|w)\d+)*)(?:_f\d+)?$/;

/**
 * A kind that comes only from the roster: a plain elite that says whether it is social. An
 * elite with no such word is from a pack written earlier, and stands under R4 as it always did.
 */
export const isRosterElite = (m: { tags?: string[]; social?: boolean }) =>
  (m.tags ?? []).includes('elite') && !(m.tags ?? []).some(t => ONE_OF_A_KIND.includes(t)) && m.social !== undefined;

const held = new WeakMap<IGenerationContext, { rosters: Map<string, ILeaderSeed[]>; sheets: Map<string, ILeaderSheet>; elites: ILeaderKind[] }>();
const heldFor = (context: IGenerationContext) => {
  let value = held.get(context);
  if (!value) {
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    value = { rosters: new Map(), sheets: new Map(), elites: (context.mobDefinitions as ILeaderKind[]).filter(isRosterElite).sort(byId) };
    held.set(context, value);
  }
  return value;
};

const kindOfSeed = (leader: ILeaderSeed, context: IGenerationContext) =>
  heldFor(context).elites.find(e => e.id === leader.kind)!;

export class Leaders {

  /** The sector's elites, from the land alone. The same seed and place give the same roster on every machine. */
  static rosterOf(seed: string, sx: number, sy: number, context: IGenerationContext): ILeaderSeed[] {
    const store = heldFor(context);
    const key = `${seed}:${sx},${sy}`;
    const known = store.rosters.get(key);
    if (known) return known;
    const roster: ILeaderSeed[] = [];
    if (store.elites.length > 0) {
      const order = Object.values(UniversalRank);
      for (let y = 0; y < SECTOR_CHUNKS; y++) for (let x = 0; x < SECTOR_CHUNKS; x++) {
        const cx = sx * SECTOR_CHUNKS + x, cy = sy * SECTOR_CHUNKS + y;
        const rng = Rng.fromKey(`${seed}:elite:v1:${cx},${cy}`);
        if (rng.next() >= ROSTER_NUMBERS.perChunk) continue;
        const biome = WorldGenerator.biomeAt(seed, cx, cy);
        const rank = WorldGenerator.rankAt(seed, cx, cy, context.difficulty, context.groundVersion, context.deathPenalty);
        const pool = store.elites.filter(e => (!e.habitat || e.habitat.includes(biome)) && order.indexOf(e.rank) <= order.indexOf(rank));
        if (pool.length === 0) continue;
        // Packs are the rule. What walks alone is the exception, whatever a theme's list holds
        const social = pool.filter(e => e.social), solitary = pool.filter(e => !e.social);
        const lone = solitary.length > 0 && (social.length === 0 || rng.next() < ROSTER_NUMBERS.solitaryShare);
        const kind = WorldGenerator.pickSpawn(rng, lone ? solitary : social, rank);
        roster.push({
          id: `lead_${sx}_${sy}_${roster.length}`, kind: kind.id, cx, cy,
          pack: kind.social ? rng.int(ROSTER_NUMBERS.packLow, ROSTER_NUMBERS.packHigh + 1) : 0
        });
      }
    }
    store.rosters.set(key, roster);
    return roster;
  }

  static isLeader(entityId: string): boolean {
    return LEADER_ID.test(entityId);
  }

  /** The herd a body walks with, read from its id, so nothing new is stored on it. Undefined for a body that walks alone. */
  static herdOf(entityId: string): string | undefined {
    return HERD_OF_LEADER.exec(entityId)?.[1]
      ?? /^(pop_-?\d+_-?\d+_[a-z0-9]+)_\d+$/.exec(entityId)?.[1]
      ?? /^(ent_-?\d+_-?\d+)_m\d+$/.exec(entityId)?.[1];
  }

  /** The people's door for a leader's body: the stats under the same key, then its nature and its goal. */
  static sheetOf(seed: string, leader: ILeaderSeed, context: IGenerationContext): ILeaderSheet {
    const store = heldFor(context);
    const key = `${seed}:${leader.id}:${leader.kind}`;
    const known = store.sheets.get(key);
    if (known) return known;
    const kind = kindOfSeed(leader, context);
    const person = NpcSheet.read(seed, { id: leader.id, rank: kind.rank }, context.webVersion);
    const rng = Rng.fromKey(`${seed}:leader:${leader.id}`);
    const temperament = NATURES[rng.int(0, NATURES.length)];
    const drive = DRIVES[rng.int(0, DRIVES.length)];
    const sheet: ILeaderSheet = { stats: person.stats!, skills: person.skills, temperament, drive, goal: 'waylay' };
    sheet.goal = this.dealGoal(`${seed}:leader:${leader.id}:goal:0`, kind, sheet);
    store.sheets.set(key, sheet);
    return sheet;
  }

  /** What this body may want: what its species can do and what its sheet holds. A goal never asks for what they lack. */
  static allowedGoals(kind: Pick<ILeaderKind, 'social' | 'builds' | 'behavior'>, sheet: Pick<ILeaderSheet, 'skills'>): Goal[] {
    if (!kind.social) return ['waylay'];
    const goals: Goal[] = ['grow', 'hunt'];
    if (kind.behavior !== 'PASSIVE') goals.push('take');
    if (kind.builds && Object.keys(sheet.skills ?? {}).length > 0) goals.push('settle');
    return goals;
  }

  /** A goal, by the sheet's drive, among what it may want. */
  static dealGoal(key: string, kind: Pick<ILeaderKind, 'social' | 'builds' | 'behavior'>, sheet: Pick<ILeaderSheet, 'skills' | 'drive'>): Goal {
    const allowed = this.allowedGoals(kind, sheet);
    const wanted = PREFERS[sheet.drive as typeof DRIVES[number]];
    return allowed.includes(wanted) ? wanted : allowed[Rng.fromKey(key).int(0, allowed.length)];
  }

  /** What its sheet makes of its body, through the formula. */
  static numbers(seed: string, leader: ILeaderSeed, context: IGenerationContext) {
    const kind = kindOfSeed(leader, context);
    // The fight's law (part 3): from the numbers its world lays the kind with
    const laid = { ...kind, ...bodyLawOf(kind as never, laysByLaw(context.groundVersion) ? { law: BODIES_FROM_GROUND } : undefined) };
    return leaderNumbers(laid, NpcSheet.statsOf(seed, { id: leader.id, rank: kind.rank }) as unknown as { constitution: number; strength: number });
  }

  /**
   * D62: what this body's hands work, as material tags: its best-practised skill that answers
   * anything the world grows. A trade belongs to a body and is carried with it, so it needs no base.
   */
  static tradeOf(sheet: Pick<ILeaderSheet, 'skills'>, context: IGenerationContext): string[] {
    const tags = new Set((context.resourceDefinitions as { tags?: string[] }[]).flatMap(r => r.tags ?? []));
    const skills = Object.values(sheet.skills ?? {}).sort((a, b) => WebSystem.cumulativeXp(b) - WebSystem.cumulativeXp(a) || (a.id < b.id ? -1 : 1));
    for (const skill of skills) {
      const worked = (TagLaw.parseSkillId(skill.id) ?? []).filter(t => tags.has(t));
      if (worked.length > 0) return worked;
    }
    return [];
  }

  /** Does this ground hold what this body's skill works (D62)? Read from what the land can yield, by tag. */
  static groundWorks(seed: string, cx: number, cy: number, sheet: Pick<ILeaderSheet, 'skills'>, context: IGenerationContext): boolean {
    const allowed = BIOME_RESOURCES[WorldGenerator.biomeAt(seed, cx, cy)] ?? [];
    const works = new Set(Object.keys(sheet.skills ?? {}).flatMap(id => TagLaw.parseSkillId(id) ?? []));
    return (context.resourceDefinitions as { id: string; tags?: string[] }[]).some(r => allowed.includes(r.id) && (r.tags ?? []).some(t => works.has(t)));
  }
}

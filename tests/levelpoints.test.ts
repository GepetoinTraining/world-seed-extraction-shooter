/**
 * LEVELS, POINTS AND CIRCLES (BALANCE_RUN.md 2.13). Registered before the build.
 *
 * Pedro, 2026-11-11: "the levels! yes, that's something to fix, when I played it I was wishing for more points in leveling
 * up, 4 points per level, one free point and one for each of the buckets. the circles in skills, not at every level, one at
 * every 3 levels. On rank up reset as we planned so that we can have muiltiple runs (like ragnarok when a player is reborn)."
 * On keeping what a character has across a rank, and on levels already gained: "agreed". And of saves: "right now no one
 * has a character, and I always strate fresh to test", so nothing is migrated: an old save only has to load.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { IAttributes, IPlayer, UniversalRank } from '../shared/types';
import {
  ATTRIBUTE_GROUPS, FREE_POINTS_PER_LEVEL, GROUP_POINTS_PER_LEVEL, LEVELS_PER_CIRCLE, POINTS_PER_LEVEL, ProgressionSystem
} from '../shared/entities/player/systems/ProgressionSystem';
import { CircleSystem } from '../src/logic/systems/CircleSystem';

const ALL: (keyof IAttributes)[] = ['strength', 'constitution', 'agility', 'dexterity', 'endurance', 'intelligence', 'focus', 'engineering', 'hacking', 'perception', 'charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership'];
const ones = () => Object.fromEntries(ALL.map(a => [a, 1])) as unknown as IAttributes;
const person = (over: Partial<IPlayer> = {}): IPlayer => ({
  id: 'p', rank: UniversalRank.F, rankXp: 0, levelXp: 0, levelsBanked: 0, attributePoints: 0,
  baseAttributes: ones(), attributes: ones(), bank: { universalSkills: {}, stashTabs: [] }, ...over
} as unknown as IPlayer);

describe('a level gives four points: one free and one for each group', () => {
  it('the groups are the shared rules\' own: the body, the mind and the self, every attribute in one', () => {
    expect(ATTRIBUTE_GROUPS.body).toEqual(['strength', 'constitution', 'agility', 'dexterity', 'endurance']);
    expect(ATTRIBUTE_GROUPS.mind).toEqual(['intelligence', 'focus', 'engineering', 'hacking', 'perception']);
    expect(ATTRIBUTE_GROUPS.self).toEqual(['charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership']);
    expect([...ATTRIBUTE_GROUPS.body, ...ATTRIBUTE_GROUPS.mind, ...ATTRIBUTE_GROUPS.self].sort()).toEqual([...ALL].sort());
    // The views read them from there, and write none of their own
    expect(readFileSync('src/components/PlayerHub.tsx', 'utf8')).not.toMatch(/\['strength', 'constitution'/);
  });

  it('four points a level, of the right kinds', () => {
    expect([FREE_POINTS_PER_LEVEL, GROUP_POINTS_PER_LEVEL, POINTS_PER_LEVEL]).toEqual([1, 1, 4]);
    const one = ProgressionSystem.gainXp(person(), ProgressionSystem.levelCost(UniversalRank.F, 1));
    expect(one.to).toBe(2);
    expect(one.points).toBe(4);
    expect(ProgressionSystem.unspent(one.player)).toEqual({ free: 1, body: 1, mind: 1, self: 1, total: 4 });
    const three = ProgressionSystem.gainXp(person(), [1, 2, 3].reduce((sum, l) => sum + ProgressionSystem.levelCost(UniversalRank.F, l), 0));
    expect(three.to).toBe(4);
    expect(ProgressionSystem.unspent(three.player)).toEqual({ free: 3, body: 3, mind: 3, self: 3, total: 12 });
  });

  it('a group\'s point is spent only inside its group, and the free one takes any attribute', () => {
    const bodyOnly = person({ groupPoints: { body: 1 } });
    expect(ProgressionSystem.spendPoint(bodyOnly, 'intelligence')).toBeNull();
    const raised = ProgressionSystem.spendPoint(bodyOnly, 'strength')!;
    expect(raised.spent).toBe('body');
    expect(raised.player.baseAttributes.strength).toBe(2);
    const freeOnly = person({ attributePoints: 1 });
    for (const attr of ['intelligence', 'charisma', 'agility'] as (keyof IAttributes)[]) {
      expect(ProgressionSystem.spendPoint(freeOnly, attr)!.spent).toBe('free');
    }
    expect(ProgressionSystem.spendPoint(person(), 'strength')).toBeNull();
  });

  it('a group\'s own point goes first, so a free point is never used where a group point would do', () => {
    const both = person({ attributePoints: 1, groupPoints: { mind: 1 } });
    const first = ProgressionSystem.spendPoint(both, 'focus')!;
    expect(first.spent).toBe('mind');
    expect(ProgressionSystem.unspent(first.player)).toMatchObject({ free: 1, mind: 0 });
    expect(ProgressionSystem.pointFor(both, 'focus')).toBe('mind');
    expect(ProgressionSystem.pointFor(both, 'charisma')).toBe('free');
    expect(ProgressionSystem.pointFor(person(), 'charisma')).toBeNull();
  });

  it('an old save loads: its unspent points read as free ones, and nothing else moves', () => {
    const old = person({ attributePoints: 3, groupPoints: undefined });
    expect(ProgressionSystem.unspent(old)).toEqual({ free: 3, body: 0, mind: 0, self: 0, total: 3 });
    expect(ProgressionSystem.spendPoint(old, 'leadership')!.spent).toBe('free');
  });
});

describe('a circle at every third level climbed', () => {
  it('one at the third, sixth and ninth level climbed, and none between', () => {
    expect(LEVELS_PER_CIRCLE).toBe(3);
    const free = (climbed: number) => CircleSystem.free(person({ levelsBanked: climbed }));
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(free)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
  });
});

describe('a rank gained starts the level again, and takes nothing else', () => {
  it('the level goes back to the start; attributes, points spent and unspent, and the levels climbed all stay', () => {
    const climbed = ProgressionSystem.gainXp(person({ attributePoints: 2, groupPoints: { body: 1, self: 2 } }), [1, 2].reduce((s, l) => s + ProgressionSystem.levelCost(UniversalRank.F, l), 0)).player;
    const spent = ProgressionSystem.spendPoint(climbed, 'strength')!.player;
    const { player: risen, granted } = ProgressionSystem.grantRank(spent);
    expect(granted).toBe(true);
    expect(ProgressionSystem.rankOf(risen)).toBe(UniversalRank.E);
    expect(ProgressionSystem.levelOf(risen)).toBe(1);
    expect(risen.baseAttributes).toEqual(spent.baseAttributes);
    expect(ProgressionSystem.unspent(risen)).toEqual(ProgressionSystem.unspent(spent));
    expect(ProgressionSystem.levelsEarned(risen)).toBe(ProgressionSystem.levelsEarned(spent));
  });
});

/**
 * A SITTING COSTS LESS THE MORE ITS STUDENT KNOWS OF THAT TREE. Registered before the build.
 *
 * Pedro, 2026-11-11, shown that nothing turns a material's properties into numbers on what is
 * made of it: "Now you finally discovered what the study loop is for! It's for this, and we need
 * to make study cost less for the more someone knows about a tree of the tech web".
 *
 * Read as built, each for him to overrule (PLAYTEST_LEDGER.md):
 *  - a tree is the worked thing: the family a target is of (flora, mineral, beast...) and the
 *    materials it is made of (wood, fiber, stone...), the web's own two worked kinds. A held
 *    skill is in that tree when it works any of them, and a nearer branch counts for more.
 *  - the cost is a sitting's energy and its time, both.
 *  - what is known is every held skill in the tree, by its level and its rung.
 * The shape is not open: the house curve, falling and never arriving, with no cap and no table.
 */

import { describe, it, expect } from 'vitest';
import { IPlayer, ISkillState, ItemType, Rarity, SlotType, IItem, UniversalRank } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { IDENTIFY_BASE_SECONDS, IDENTIFY_ENERGY, IDENTIFY_FLOOR_SECONDS, StudySystem } from '../src/logic/systems/StudySystem';

/** A skill held, worked up by this much experience. */
const known = (tool: string[] | null, worked: string[], xp = 0): ISkillState => {
  const pair = WebSystem.mint(tool, worked);
  return WebSystem.withCumulativeXp(WebSystem.freshSkill(pair.id, pair.tags, 0), xp);
};
/** The same skill, at a level no real character reaches. */
const atLevel = (skill: ISkillState, level: number): ISkillState => ({ ...skill, level, currentXp: 0 });

/** Someone at the attribute floor with nothing worn, holding these skills and nothing else. */
const student = (...skills: ISkillState[]): IPlayer => ({
  id: 'student', attributes: undefined, equipment: undefined, currentSession: undefined,
  bank: { universalSkills: Object.fromEntries(skills.map(s => [s.id, s])), stashTabs: [] }
} as unknown as IPlayer);

const eye = (level: number): ISkillState => ({ ...WebSystem.freshSkill(StudySystem.scopeSkillId('weapon'), ['identify_weapon'], 0), level });

const ask = (who: IPlayer, target = log) => StudySystem.studyAsk(who, target);
const knowledge = (who: IPlayer, target = log) => WebSystem.treeKnowledge(who.bank.universalSkills, target.tags);

const log = StudySystem.targetOfThing({ id: 'log', name: 'A log', tags: ['flora', 'wood'] });
const reed = StudySystem.targetOfThing({ id: 'reed', name: 'A reed', tags: ['flora', 'fiber'] });
const rock = StudySystem.targetOfThing({ id: 'rock', name: 'A rock', tags: ['mineral', 'stone'] });

const newcomer = student();
const woodsman = student(known(['axe'], ['flora', 'wood'], 4000), known(['saw'], ['flora', 'wood'], 4000));

describe('a sitting costs less the more its student knows of that tree (Pedro, 2026-11-11)', () => {

  it('a student who holds nothing of the tree pays exactly what a sitting asks today', () => {
    expect(knowledge(newcomer)).toBe(0);
    expect(WebSystem.treeShare(0)).toBe(1);
    // No eye at all: half again, winged. The numbers StudySystem asked before this change.
    expect(ask(newcomer)).toEqual({ cost: Math.ceil(IDENTIFY_ENERGY * 1.5), seconds: IDENTIFY_BASE_SECONDS });
    // A schooled eye and still nothing of the tree.
    expect(ask(student(eye(1)))).toEqual({ cost: IDENTIFY_ENERGY, seconds: StudySystem.identifySeconds(1) });
    expect(ask(student(eye(9)))).toEqual({ cost: IDENTIFY_ENERGY, seconds: StudySystem.identifySeconds(9) });
  });

  it('what has no tree to read pays what it pays today, however much the student knows', () => {
    const words = StudySystem.targetOfWords('the weather');
    const person = StudySystem.targetOfPerson({ id: 'npc_1', name: 'Sera', tags: ['npc'] });
    for (const target of [words, person]) {
      expect(knowledge(woodsman, target)).toBe(0);
      expect(ask(woodsman, target)).toEqual(ask(newcomer, target));
    }
  });

  it('an unread piece shows no tags, so its price still gives nothing away (D32)', () => {
    const unread: IItem = {
      id: 'itm_unread', universalDefinitionId: 'def_x', name: 'Piece', description: '', type: ItemType.GEAR, slot: SlotType.MAIN_HAND,
      rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0.5, level: 1, value: 100, itemPower: 10, tags: ['flora', 'wood'],
      affixes: [], dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'm', colorHex: '#000' }, icon: 'i',
      isIdentified: false
    } as IItem;
    const target = StudySystem.targetOfItem(unread);
    expect(ask(woodsman, target)).toEqual(ask(newcomer, target));
  });

  it('the more of the tree is held, the less energy and the less time, strictly', () => {
    const ladder = [
      newcomer,
      student(known(null, ['flora', 'fiber'])),
      student(known(['axe'], ['flora', 'wood'])),
      student(known(['axe'], ['flora', 'wood'], 4000)),
      woodsman,
      student(known(['axe'], ['flora', 'wood'], 4000), known(['saw'], ['flora', 'wood'], 4000), known(null, ['flora', 'fiber'], 4000)),
      student(atLevel(known(['axe'], ['flora', 'wood'], 4000), 60), known(['saw'], ['flora', 'wood'], 4000), known(null, ['flora', 'fiber'], 4000))
    ];
    for (let i = 1; i < ladder.length; i++) {
      expect(knowledge(ladder[i])).toBeGreaterThan(knowledge(ladder[i - 1]));
      expect(WebSystem.treeShare(knowledge(ladder[i]))).toBeLessThan(WebSystem.treeShare(knowledge(ladder[i - 1])));
      expect(ask(ladder[i]).cost).toBeLessThanOrEqual(ask(ladder[i - 1]).cost);
      expect(ask(ladder[i]).seconds).toBeLessThanOrEqual(ask(ladder[i - 1]).seconds);
    }
    // None, some, much: whole numbers on the screen, and each strictly below the last
    const [none, some, much] = [ladder[0], ladder[3], ladder[6]].map(who => ask(who));
    expect(some.cost).toBeLessThan(none.cost);
    expect(much.cost).toBeLessThan(some.cost);
    expect(some.seconds).toBeLessThan(none.seconds);
    expect(much.seconds).toBeLessThan(some.seconds);
  });

  it('knowledge of a different tree changes nothing', () => {
    const miner = student(atLevel(known(['blunt'], ['mineral', 'stone'], 4000), 80), known(null, ['mineral', 'ore'], 4000));
    expect(knowledge(miner)).toBe(0);
    expect(ask(miner)).toEqual(ask(newcomer));
    expect(ask(woodsman, rock)).toEqual(ask(newcomer, rock));
  });

  it('a thing not yet learned, in a tree known well, costs less than a thing in a tree not known at all', () => {
    // The woodsman holds nothing on fiber and nothing on stone: both are unlearned. Before this, both paid the same.
    expect(Object.values(woodsman.bank.universalSkills).some(s => s.tags.includes('fiber') || s.tags.includes('stone'))).toBe(false);
    expect(ask(woodsman, reed).cost).toBeLessThan(ask(woodsman, rock).cost);
    expect(ask(woodsman, reed).seconds).toBeLessThan(ask(woodsman, rock).seconds);
  });

  it('a nearer branch counts for more than a far one in the same tree', () => {
    const nearer = student(known(['axe'], ['flora', 'wood'], 4000));
    const farther = student(known(['axe'], ['flora', 'fiber'], 4000));
    expect(knowledge(nearer)).toBeGreaterThan(knowledge(farther));
    expect(knowledge(farther)).toBeGreaterThan(0);
  });

  it('it never reaches free: energy never goes below 1, and a sitting always takes time', () => {
    const sage = student(atLevel(known(['axe'], ['flora', 'wood'], 4000), 100_000), atLevel(known(['saw'], ['flora', 'wood'], 4000), 100_000));
    expect(WebSystem.treeShare(knowledge(sage))).toBeGreaterThan(0);
    expect(ask(sage).cost).toBeGreaterThanOrEqual(1);
    expect(ask(sage).seconds).toBeGreaterThanOrEqual(IDENTIFY_FLOOR_SECONDS);
  });

  it('far past any real character it is still falling: no cap', () => {
    const at = (level: number) => knowledge(student(atLevel(known(['axe'], ['flora', 'wood']), level)));
    expect(at(10_000)).toBeGreaterThan(at(1_000));
    expect(at(100_000)).toBeGreaterThan(at(10_000));
    const shares = [1_000, 10_000, 100_000, 1_000_000].map(k => WebSystem.treeShare(k));
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
    expect(shares[shares.length - 1]).toBeGreaterThan(0);
  });

  it('the same inputs always give the same cost, in any order the record holds them', () => {
    const skills = [known(['axe'], ['flora', 'wood'], 4000), known(null, ['flora', 'fiber'], 900), known(['blunt'], ['mineral', 'stone'], 50)];
    const once = ask(student(...skills));
    expect(ask(student(...skills))).toEqual(once);
    expect(ask(student(...[...skills].reverse()))).toEqual(once);
    expect(knowledge(student(...[...skills].reverse()))).toBe(knowledge(student(...skills)));
  });
});

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
 * Changed on purpose 2026-11-12 (EN, the coordinator's call on Pedro's "no level of skill gets it down"): the energy is
 * now the day's one law's (`EnergyLaw`), and a rank's worth of what is known of the tree halves it, with no floor; the
 * curve fell by half only at fifty levels of a tree. The time keeps the curve and its floor.
 */

import { describe, it, expect } from 'vitest';
import { IPlayer, ISkillState, ItemType, Rarity, SlotType, IItem, UniversalRank } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { IDENTIFY_BASE_SECONDS, IDENTIFY_FLOOR_SECONDS, StudySystem } from '../src/logic/systems/StudySystem';
import { EnergyLaw } from '../shared/logic/systems/EnergyLaw';
import { ChainWeb, IChainGround, IChainRound, emptyChain } from '../shared/logic/theme/ChainWeb';
import { emptyTech, hubTreeOf } from '../src/entities/hub/hubTech';

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
    // No eye at all: half again, winged. The day's one law's sitting (EN).
    expect(ask(newcomer)).toEqual({ cost: EnergyLaw.cost('sitting', null), seconds: IDENTIFY_BASE_SECONDS });
    // A schooled eye and still nothing of the tree.
    expect(ask(student(eye(1)))).toEqual({ cost: EnergyLaw.cost('sitting', 0), seconds: StudySystem.identifySeconds(1) });
    expect(ask(student(eye(9)))).toEqual({ cost: EnergyLaw.cost('sitting', 0), seconds: StudySystem.identifySeconds(9) });
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
    // None, some, much: as the screen says them, and each strictly below the last
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

  it('a sitting always takes time; its energy, with no floor, falls toward nothing (changed on purpose, EN)', () => {
    const sage = student(atLevel(known(['axe'], ['flora', 'wood'], 4000), 100_000), atLevel(known(['saw'], ['flora', 'wood'], 4000), 100_000));
    expect(ask(sage).cost).toBeLessThanOrEqual(ask(woodsman).cost);
    expect(ask(sage).cost).toBeGreaterThanOrEqual(0);
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

/**
 * S1a, RULED. Pedro, 2026-11-11: "this is a function of hubs, there's a check we ran with haiku where I
 * posited fireball could be a skill acquired by going tech and magic, and it's the same thing, and they
 * would connect... you can try and find it". Then: "Yes, rebuild it". The check is C5's trial, four ways
 * to one fireball (D125, ChainWeb.ts): a hub's web is written backwards from a concept, and two roads to
 * one concept are one tree. So a thing's tree is the hub's web around it: every concept it sits under,
 * every way to each, and everything each way asks for. Its own family and materials stay as the least tree.
 */
describe('the tree is the hub\'s web: two roads to one concept are one tree (S1a, ruled)', () => {
  const good = (key: string, tags: string[], station: string, from: string[], answers: string): IChainRound['goods'][number] => ({
    key, name: key, blurb: 'x', tags, rank: 'E', weight: 'light', trade: 'smithing', station, from: from.map(k => ({ key: k, count: 1 })), makes: 1, answers
  });
  const station = (key: string, tool: string[], material: string[]): IChainRound['stations'][number] => ({ key, name: key, blurb: 'x', tool, material, bill: [] });
  const round = (over: Partial<IChainRound>): IChainRound => ({ tags: [], materials: [], stations: [], goods: [], gear: [], ...over });

  const GROUND: IChainGround = {
    things: [
      { key: 'palm', name: 'Palm', tags: ['flora', 'wood'], rank: 'F' },
      { key: 'flint', name: 'Flint', tags: ['mineral', 'stone'], rank: 'F' },
      { key: 'sand_heap', name: 'Sand', tags: ['mineral', 'sand'], rank: 'F' }
    ],
    stations: [],
    tools: ['sickle', 'blunt', 'tongs']
  };
  /** Magic and tech to one fireball: a plant that spits it, and a tube that fires it. A lamp answers something else. */
  const FIREBALL = ChainWeb.merge(emptyChain(), round({
    stations: [station('glasshouse', ['sickle'], ['flora']), station('tube_shop', ['blunt'], ['metal']), station('glass_shop', ['tongs'], ['glass'])],
    goods: [
      good('spit_plant', ['flora'], 'glasshouse', ['palm'], 'fireball'),
      good('tube', ['metal'], 'tube_shop', ['flint'], 'fireball'),
      good('lamp', ['glass'], 'glass_shop', ['sand_heap'], 'light')
    ]
  }));
  const hub = { chain: FIREBALL, ground: GROUND };

  const plant = StudySystem.targetOfThing({ id: 'spit_plant', name: 'A fire-spitting plant', tags: ['flora'] });
  const lamp = StudySystem.targetOfThing({ id: 'lamp', name: 'A lamp', tags: ['glass'] });
  const reedOffChain = StudySystem.targetOfThing({ id: 'reed', name: 'A reed', tags: ['flora', 'fiber'] });

  /** On the tube road only: works the tube shop's metal, and nothing of the plant's own. */
  const smith = student(known(['blunt'], ['metal'], 4000));
  const asks = (who: IPlayer, target: ReturnType<typeof StudySystem.targetOfThing>, h?: typeof hub) => StudySystem.studyAsk(who, target, h);

  it('holding skills on one way to a concept lowers the ask on another way to it', () => {
    expect(asks(smith, plant)).toEqual(asks(newcomer, plant));
    expect(asks(smith, plant, hub).cost).toBeLessThan(asks(smith, plant).cost);
    expect(asks(smith, plant, hub).seconds).toBeLessThan(asks(smith, plant).seconds);
  });

  it('a thing under a different concept is not helped', () => {
    expect(WebSystem.treeKnowledge(smith.bank.universalSkills, lamp.tags, hub, [lamp.ref])).toBe(0);
    expect(asks(smith, lamp, hub)).toEqual(asks(newcomer, lamp, hub));
  });

  it('a hub\'s web that says nothing of the thing gives exactly what the least tree gives', () => {
    const someone = student(known(null, ['flora', 'fiber'], 4000), known(['blunt'], ['metal'], 4000));
    expect(WebSystem.treeKnowledge(someone.bank.universalSkills, reedOffChain.tags, hub, [reedOffChain.ref])).toBe(WebSystem.treeKnowledge(someone.bank.universalSkills, reedOffChain.tags));
    expect(asks(someone, reedOffChain, hub)).toEqual(asks(someone, reedOffChain));
  });

  it('with no hub web at all nothing breaks, and a newcomer still pays today\'s price', () => {
    const bare = { chain: emptyChain(), ground: GROUND };
    expect(asks(newcomer, plant, bare)).toEqual({ cost: EnergyLaw.cost('sitting', null), seconds: IDENTIFY_BASE_SECONDS });
    expect(asks(smith, plant, bare)).toEqual(asks(smith, plant));
    expect(asks(newcomer, plant, hub)).toEqual(asks(newcomer, plant));
    // A hub that has written nothing hands over nothing to read
    expect(hubTreeOf(undefined)).toBeUndefined();
    expect(hubTreeOf(emptyTech())).toBeUndefined();
    expect(hubTreeOf({ chain: FIREBALL })?.chain).toBe(FIREBALL);
  });

  it('a need met by any way does not count the same skill twice for being on two ways', () => {
    const twoTubes = ChainWeb.merge(FIREBALL, round({ goods: [good('cannon', ['metal'], 'tube_shop', ['flint'], 'fireball')] }));
    const once = WebSystem.treeKnowledge(smith.bank.universalSkills, plant.tags, hub, [plant.ref]);
    expect(once).toBeGreaterThan(0);
    expect(WebSystem.treeKnowledge(smith.bank.universalSkills, plant.tags, { chain: twoTubes, ground: GROUND }, [plant.ref])).toBe(once);
  });

  it('a held piece is placed on the web by what it is, and an unread one still pays whole (D32)', () => {
    const piece = (isIdentified: boolean): IItem => ({
      id: `itm_${isIdentified}`, universalDefinitionId: 'spit_plant', name: 'Pod', description: '', type: ItemType.RESOURCE,
      rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0.5, level: 1, value: 10, itemPower: 1, tags: [],
      affixes: [], dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'm', colorHex: '#000' }, icon: 'i', isIdentified
    } as IItem);
    const holding = (item: IItem): IPlayer => ({ ...smith, bank: { ...smith.bank, stashTabs: [{ name: 'tab', items: [item] }] } } as IPlayer);
    const read = piece(true);
    const unread = piece(false);
    expect(StudySystem.studyAsk(holding(read), StudySystem.targetOfItem(read), hub).cost).toBeLessThan(StudySystem.studyAsk(holding(read), StudySystem.targetOfItem(read)).cost);
    expect(StudySystem.studyAsk(holding(unread), StudySystem.targetOfItem(unread), hub)).toEqual(StudySystem.studyAsk(holding(unread), StudySystem.targetOfItem(unread)));
  });

  it('the same inputs give the same cost, in any order the web was written', () => {
    const shuffled = { ...FIREBALL, goods: [...FIREBALL.goods].reverse(), stations: [...FIREBALL.stations].reverse() };
    expect(asks(smith, plant, hub)).toEqual(asks(smith, plant, hub));
    expect(asks(smith, plant, { chain: shuffled, ground: GROUND })).toEqual(asks(smith, plant, hub));
  });
});

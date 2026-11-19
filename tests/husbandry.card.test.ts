/**
 * WHAT AN ANIMAL IS FOR, ON ITS CARD AND THROUGH STUDY (AH, 2026-11-18).
 *
 * Pedro, of pigeons that never fight and keep out of reach: "the pigeons, before you have a way to trap them, they're
 * useless, the animal husbandry portion needs to be better defined thrtough the right clieck inspect/study".
 *
 * Read as built, each call the builder's and his to strike (PLAYTEST_LEDGER.md, AH1 to AH14):
 *  - a body whose nature does not come for a person says how it behaves in words, and its card speaks of taking it alive;
 *  - with nothing known and no trade held, the card says nothing is known and the four ways read as question marks;
 *  - a sitting that lands opens what a living one is good for and each way's standing; a second, or a deep one, the figures;
 *  - a trade held opens its own way on a kind never studied;
 *  - what the snare lacks is the card's need, and a snare in reach reads Ready;
 *  - a right click offers a look and a sitting on any living body, from the eye's reach;
 *  - what is held of the trades that take and keep a living thing makes a sitting on one cost less.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, IPlayer, ISkillState, InteractionType, StudyOutcome, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { creatureIdOf } from '../shared/logic/theme/ThemeCompiler';
import { Capture } from '../shared/logic/systems/Capture';
import { ExtractLaw } from '../shared/logic/systems/ExtractLaw';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { TILE_PX } from '../shared/entities/world/grid';
import { Card, firstLayer, inspectEntity, secondLayer } from '../src/render/atoms/inspect';
import { Herd } from '../src/entities/hub/herd';
import { Husbandry, KIND_FIGURED, KIND_KNOWN } from '../src/logic/systems/Husbandry';
import { InteractionEngine, WATCH_REACH_TILES } from '../src/entities/interaction/InteractionEngine';
import { pickInteract } from '../src/logic/systems/FieldInput';
import { FieldStudy } from '../src/logic/systems/FieldStudy';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { StudyDoor } from '../src/logic/systems/StudyDoor';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { SheetNumbers } from '../src/logic/systems/SheetNumbers';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useHubStore, hubPort } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const PIGEON = () => creatureIdOf(themeId, 'queue_pigeon');
const OX = () => creatureIdOf(themeId, 'pension_ox');
const AUDITOR = () => creatureIdOf(themeId, 'auditor_general');
const RAT = () => creatureIdOf(themeId, 'tally_rat');

const store = () => usePlayerStore.getState();
const player = () => store().player;
const set = (change: (p: IPlayer) => IPlayer) => usePlayerStore.setState(s => ({ player: change(s.player) }));

const body = (defId = PIGEON(), over: Partial<IWorldEntity> = {}): IWorldEntity => ({
  id: 'pop_1_1_bird_0', type: EntityType.MOB, definitionId: defId, position: { x: 0, y: 0 },
  rank: MOB_DEFINITIONS[defId].rank, rarity: 'COMMON', health: MOB_DEFINITIONS[defId].baseHealth, isHostile: false, ...over
} as IWorldEntity);

const snare = (): IItem => ({ id: 'itm_snare_test', universalDefinitionId: 'itm_snare', name: 'Snare', tags: ['snare', 'fiber'], stats: {}, affixes: [] } as unknown as IItem);
const carrying = (who: IPlayer, ...items: IItem[]): IPlayer => ({ ...who, currentSession: { ...(who.currentSession ?? {}), inventory: items, position: { x: 0, y: 0, z: 0 } } } as IPlayer);
const trade = (way: 'trap' | 'tame' | 'keep', level = 3): ISkillState => {
  const pair = WebSystem.mint(Capture.tradeOf(way), []);
  return { ...WebSystem.freshSkill(pair.id, pair.tags, 0), level };
};
const holding = (who: IPlayer, ...skills: ISkillState[]): IPlayer =>
  ({ ...who, bank: { ...who.bank, universalSkills: { ...who.bank.universalSkills, ...Object.fromEntries(skills.map(s => [s.id, s])) } } });

const card = (who: IPlayer, e = body(), dist = 8, ownsFarmPlot?: boolean): Card =>
  inspectEntity(e, { player: who, dist, level: WebSystem.knowledgeReader(who), ...(ownsFarmPlot === undefined ? {} : { ownsFarmPlot }) });
const row = (rows: [string, string][], key: string) => rows.find(([k]) => k === key)?.[1];
const WAYS = ['Hunt', 'Trap', 'Tame', 'Keep'];

const forced = (outcome: StudyOutcome) => vi.spyOn(StudySystem, 'rollSitting').mockReturnValue({ d100: 50, total: 50, dc: 41, outcome });
const said = () => useFeed.getState().lines.map(l => l.text);

beforeEach(() => {
  db.clear();
  vi.restoreAllMocks();
  useFeed.setState({ lines: [] });
  useIdentityStore.setState({ certificate: { metadata: { uid: 'ah_tester', displayName: 'TESTER', createdAt: 0 }, publicKey: {} } as never });
  useHubStore.setState({ rooms: {}, lots: [] as never });
  set(p => ({
    ...p, currentSession: undefined, energyToday: undefined, rest: undefined, restQueue: undefined, pendingDream: undefined,
    studyMarks: undefined, studyCount: 0, materialMastery: {},
    bank: { ...p.bank, universalSkills: {}, stashTabs: [{ ...p.bank.stashTabs[0], items: [] }] }
  }));
});
afterEach(() => { StudyDoor.reset(); });

// =============================================================================
// The card
// =============================================================================

describe('AH: the card of an animal that does not come for you', () => {

  it('the pigeon is such a body by its nature, with no tag saying so, and a body that comes for you is not', () => {
    expect(MOB_DEFINITIONS[PIGEON()].tags).not.toContain('livestock');
    expect(Husbandry.isStock(MOB_DEFINITIONS[PIGEON()])).toBe(true);
    expect(Husbandry.isStock(MOB_DEFINITIONS[OX()])).toBe(true);
    expect(Husbandry.isStock(MOB_DEFINITIONS[RAT()])).toBe(false);
    expect(Husbandry.read(body(RAT()), MOB_DEFINITIONS[RAT()], { player: player(), dist: 1 })).toBeNull();
  });

  // Changed on purpose 2026-11-19 (Pedro: "it shows TOO much information before I know anything, too expositive"):
  // this bar held a card that said how it behaves, its rank, its health, that nothing was known and to go and study it,
  // and four rows of question marks. With nothing known the card now says what the eye sees, and no more.
  it('with nothing known and no trade held: what it is called by sight, and nothing else', () => {
    const c = card(player());
    expect(c.title).toBe('Unknown Contact');
    expect(c.rows).toEqual([]);
    expect(c.needs).toEqual([]);
    expect(c.canAct).toBe(false);
    // What is not known may still be noted, in the player's own words
    expect(c.unknowns?.map(u => u.kind)).toEqual(['creature']);
    // Not a word of what there would be to know, and no telling them to go and learn it
    const all = JSON.stringify(c);
    for (const word of ['Rank', 'Health', 'Behavior', 'Study', '???', ...WAYS, 'snare', 'PASSIVE']) expect(all, word).not.toContain(word);
  });

  it('once the kind is known, how it behaves is said in words, and the ways stand in one order', () => {
    const c = card(Husbandry.learn(player(), PIGEON(), KIND_KNOWN));
    expect(row(firstLayer(c), 'Behavior')).toBe('Keeps to itself. Runs when hurt');
    expect(firstLayer(c).map(([k]) => k)).toEqual(expect.arrayContaining(['Rank', 'Health']));
    expect(secondLayer(c).map(([k]) => k).filter(k => WAYS.includes(k))).toEqual(WAYS);
    expect(JSON.stringify(c)).not.toContain('PASSIVE');
  });

  it('one that fights back when hurt says that instead', () => {
    expect(row(firstLayer(card(Husbandry.learn(player(), OX(), KIND_KNOWN), body(OX()))), 'Behavior')).toBe('Leaves you be. Fights back when hurt');
  });

  it('the kind known: what a living one is good for up top, and each way says whether it is open, what is missing and what it takes', () => {
    const who = Husbandry.learn(player(), PIGEON(), KIND_KNOWN);
    const c = card(who);
    expect(row(firstLayer(c), 'Known')).toBeUndefined();
    expect(row(firstLayer(c), 'Alive')).toBe('Worth more kept than dead: young while fed, meat, and what its kind leaves');
    expect(row(secondLayer(c), 'Hunt')).toMatch(/^Yes\. It runs when hurt\./);
    // Changed on purpose 2026-11-19 (Pedro: "i hate hard coded stuf"): no fixed bill ties one; it is asked for where one rests
    expect(row(secondLayer(c), 'Trap')).toMatch(/^Not yet: no snare carried\. Nobody sells one\. Where you rest, lay what one could be tied from and say what you want/);
    expect(row(secondLayer(c), 'Tame')).toMatch(/^Not yet: not caged\./);
    expect(row(secondLayer(c), 'Keep')).toMatch(/^Not yet: not caged\. Penned on a farm plot at home and fed for days/);
    // What the snare lacks is the card's own need, in its own place
    expect(c.needs).toEqual(['Needs a snare']);
    // Known for what it is for, and no figure yet: no minutes, no count of days, no count of cuts
    expect(row(secondLayer(c), 'Tame')).toContain('for a while');
    expect(row(firstLayer(c), 'Alive')).not.toMatch(/\d|one cut/);
  });

  it('keeping says a farm plot is missing only where it is known that none is this person\'s', () => {
    const who = Husbandry.learn(player(), PIGEON(), KIND_KNOWN);
    expect(row(secondLayer(card(who, body(), 8, false)), 'Keep')).toMatch(/^Not yet: no farm plot of yours\./);
    expect(row(secondLayer(card(who, body(), 8, true)), 'Keep')).toMatch(/^Not yet: not caged\./);
  });

  it('the kind known deeply: the figures, each the law\'s own', () => {
    const who = Husbandry.learn(player(), PIGEON(), KIND_FIGURED);
    const def = MOB_DEFINITIONS[PIGEON()];
    const c = card(who);
    const days = Herd.daysToKeep(def), cuts = Herd.cutsOf(def), minutes = Math.round(Capture.followMs(0) / 60_000);
    expect(row(secondLayer(c), 'Keep')).toContain(`fed ${days === 1 ? 'one day' : `${days} days`}`);
    expect(row(secondLayer(c), 'Tame')).toContain(`for ${minutes} minutes`);
    expect(row(firstLayer(c), 'Alive')).toContain(`${cuts === 1 ? 'one cut' : `${cuts} cuts`} of meat`);
    expect(row(secondLayer(c), 'Trap')).toContain('more surely the more hurt it is. A miss goes unnoticed');
  });

  it('how often the snare holds is said in the words every other try is, from the snare\'s own law, and a hurt body reads better', () => {
    const who = Husbandry.learn(player(), PIGEON(), KIND_KNOWN);
    const def = MOB_DEFINITIONS[PIGEON()];
    const whole = ExtractLaw.oddsSaid(100 * Capture.trapOdds({ rank: def.rank, behavior: def.behavior, healthShare: 1, skill: 0 }));
    expect(row(secondLayer(card(who)), 'Trap')).toContain(`It holds ${whole}`);
    const worn = ExtractLaw.oddsSaid(100 * Capture.trapOdds({ rank: def.rank, behavior: def.behavior, healthShare: 1 / def.baseHealth, skill: 0 }));
    expect(row(secondLayer(card(who, body(PIGEON(), { health: 1 }))), 'Trap')).toContain(`It holds ${worn}`);
    // Never the number (D32)
    expect(row(secondLayer(card(who)), 'Trap')).not.toMatch(/%|\d\d/);
  });

  it('a snare carried: move closer; in reach, the way is open and the card reads ready, as the menu offers it', () => {
    const who = carrying(Husbandry.learn(player(), PIGEON(), KIND_KNOWN), snare());
    const far = card(who, body(), 8);
    expect(row(secondLayer(far), 'Trap')).toMatch(/^Not yet: out of reach\. Stand beside it and right click/);
    expect(far.needs).toEqual(['Move closer']);
    expect(far.canAct).toBe(false);
    const near = card(who, body(), 1);
    expect(row(secondLayer(near), 'Trap')).toMatch(/^Yes\. Right click sets the snare/);
    expect(near.needs).toEqual([]);
    expect(near.canAct).toBe(true);
    expect(InteractionEngine.getAvailableInteractions(who, body(), 1).some(o => o.id.startsWith('int_snare_'))).toBe(true);
    // Someone who knows nothing of the kind is still told a snare in reach is ready: the menu offers it to them too.
    // Changed on purpose 2026-11-19 (Pedro: "it shows TOO much information before I know anything, too expositive"): and no row of question marks beside it
    const blind = card(carrying(player(), snare()), body(), 1);
    expect(blind.canAct).toBe(true);
    expect(blind.rows).toEqual([]);
  });

  it('a trade held opens its own way on a kind never studied, and no other', () => {
    const trapper = holding(player(), trade('trap'));
    const c = card(trapper);
    // Changed on purpose 2026-11-19 (Pedro: "it shows TOO much information before I know anything, too expositive"): the trade's own way is
    // read, and the ways it does not open are not so much as named
    expect(firstLayer(c)).toEqual([]);
    expect(row(secondLayer(c), 'Trap')).toMatch(/^Not yet: no snare carried/);
    expect(secondLayer(c).map(([k]) => k)).toEqual(['Trap']);
    expect(c.needs).toEqual(['Needs a snare']);
    // A keeper who knows nothing of trapping is told nothing of snares
    expect(card(holding(player(), trade('keep'))).needs).toEqual([]);
    expect(row(secondLayer(card(holding(player(), trade('keep')))), 'Keep')).toMatch(/^Not yet: not caged/);
    // A practised hand reads its own odds
    const def = MOB_DEFINITIONS[PIGEON()];
    expect(row(secondLayer(c), 'Trap')).toContain(`It holds ${ExtractLaw.oddsSaid(100 * Capture.trapOdds({ rank: def.rank, behavior: def.behavior, healthShare: 1, skill: 3 }))}`);
  });

  it('a body no snare holds says so, in the snare\'s own words', () => {
    const who = Husbandry.learn(player(), AUDITOR(), KIND_KNOWN);
    const trap = row(secondLayer(card(who, body(AUDITOR()))), 'Trap')!;
    expect(trap).toBe(`No. ${Capture.trapRefusal('pop_1_1_bird_0', MOB_DEFINITIONS[AUDITOR()])!.replace(/\.$/, '')}`);
    expect(card(who, body(AUDITOR())).needs).toEqual([]);
  });

  it('a body that comes for you keeps the card it had', () => {
    const c = card(Husbandry.learn(player(), RAT(), KIND_FIGURED), body(RAT()));
    expect(row(firstLayer(c), 'Behavior')).toBe(String(MOB_DEFINITIONS[RAT()].behavior));
    for (const key of ['Known', 'Alive', ...WAYS]) expect([...firstLayer(c), ...secondLayer(c)].map(([k]) => k)).not.toContain(key);
    expect(c.canAct).toBe(false);
  });
});

// =============================================================================
// The right click
// =============================================================================

describe('AH: a right click on a living body offers a look and a sitting', () => {

  it('from the eye\'s reach, with no snare and nothing known; past it, and for a dead one, nothing', () => {
    const ids = (dist: number, e = body()) => InteractionEngine.getAvailableInteractions(player(), e, dist).map(o => o.id);
    expect(ids(8)).toEqual(['int_inspect_pop_1_1_bird_0', 'int_studybody_pop_1_1_bird_0']);
    expect(ids(WATCH_REACH_TILES)).toEqual([]);
    expect(ids(2, body(PIGEON(), { health: 0 }))).toEqual([]);
    // The sheet's own study list reaches as far: 220 px
    expect(WATCH_REACH_TILES * TILE_PX).toBe(220);
  });

  it('the look is free, the sitting asks what study asks, and both name it only as the card does', () => {
    const [look, sit] = InteractionEngine.getAvailableInteractions(player(), body(), 2);
    expect(look.energyCost).toBe(0);
    expect(look.label).toBe('Inspect Unknown Contact');
    expect(sit.label).toBe('Study Unknown Contact');
    const ask = StudySystem.studyAsk(player(), FieldStudy.target(body(), player()));
    expect({ cost: sit.energyCost, seconds: sit.timeCostSeconds }).toEqual(ask);
    expect([look.type, sit.type]).toEqual([InteractionType.STUDY, InteractionType.STUDY]);
  });

  it('the snare, when one is carried and it is in reach, stands first; the key still walks past a body without one', () => {
    const who = carrying(player(), snare());
    expect(InteractionEngine.getAvailableInteractions(who, body(), 2).map(o => o.id)).toEqual(['int_snare_pop_1_1_bird_0', 'int_inspect_pop_1_1_bird_0', 'int_studybody_pop_1_1_bird_0']);
    expect(pickInteract(who, [body()], { x: 20, z: 0 })?.primary?.id).toBe('int_snare_pop_1_1_bird_0');
    expect(pickInteract(carrying(player()), [body()], { x: 20, z: 0 })).toBeNull();
  });
});

// =============================================================================
// Study
// =============================================================================

describe('AH: what a sitting on an animal leaves known', () => {

  const sit = async (outcome: StudyOutcome, defId = PIGEON()) => {
    forced(outcome);
    set(p => ({ ...p, energyToday: undefined }));
    const begun = StudyDoor.begin(FieldStudy.target(body(defId), player()), playerPort, hubPort);
    expect(begun.ok, begun.reason).toBe(true);
    return StudyDoor.finish(playerPort, hubPort);
  };

  it('a sitting that lands: known for what it is for, said at once, and the card opens', async () => {
    expect(Husbandry.known(player(), PIGEON())).toBe(0);
    await sit('success');
    expect(Husbandry.known(player(), PIGEON())).toBe(KIND_KNOWN);
    expect(said()).toContain('Unknown Contact is worth more alive than dead.');
    expect(row(firstLayer(card(player())), 'Alive')).toBeDefined();
    // It is the person's mark for the kind, beside its sittings, and never a line among the materials they have handled
    expect(player().studyMarks?.[`creature:${PIGEON()}`]).toMatchObject({ sittings: 1, known: KIND_KNOWN });
    expect(player().materialMastery[PIGEON()]).toBeUndefined();
    expect(SheetNumbers.mastery(player())).toEqual([]);
  });

  it('a second sitting that lands, or one that goes deep, gives the figures', async () => {
    await sit('success');
    await sit('success');
    expect(Husbandry.known(player(), PIGEON())).toBe(KIND_FIGURED);
    expect(said()).toContain('Unknown Contact: you know now what taking and keeping one asks, to the day.');
    expect(row(secondLayer(card(player())), 'Tame')).toMatch(/for \d+ minutes/);

    set(p => ({ ...p, studyMarks: undefined }));
    useFeed.setState({ lines: [] });
    await sit('major_win');
    expect(Husbandry.known(player(), PIGEON())).toBe(KIND_FIGURED);
    expect(said()).toContain('Unknown Contact is worth more alive than dead. You know what taking and keeping one asks, to the day.');
  });

  it('a sitting that fails teaches nothing of it, and the mark it leaves keeps what was known', async () => {
    await sit('failure');
    expect(Husbandry.known(player(), PIGEON())).toBe(0);
    expect(card(player()).rows).toEqual([]);
    await sit('success');
    await sit('failure');
    expect(Husbandry.known(player(), PIGEON())).toBe(KIND_KNOWN);
    expect(player().studyMarks?.[`creature:${PIGEON()}`]).toMatchObject({ sittings: 3, harm: 2, known: KIND_KNOWN });
  });

  it('a sitting that goes as badly as it can closes the kind until the next rest, and what was known of it is kept (Pedro: "Until next rest")', async () => {
    await sit('success');
    await sit('major_failure');
    expect(said()).toContain('Unknown Contact has closed to you. It will not sit for you until you have rested.');
    const closed = StudyDoor.begin(FieldStudy.target(body(), player()), playerPort, hubPort);
    expect(closed.ok).toBe(false);
    expect(closed.reason).toBe('Unknown Contact will not sit for you until you have rested.');
    // Every one of the kind, and no other kind
    expect(StudySystem.canStudy(player(), FieldStudy.target(body(PIGEON(), { id: 'pop_9_9_bird_7' }), player())).ok).toBe(false);
    expect(StudySystem.canStudy(player(), FieldStudy.target(body(OX()), player())).ok).toBe(true);
    set(p => RestSystem.wake(RestSystem.beginRest(p, 'FIELD', Date.now())));
    expect(StudySystem.canStudy(player(), FieldStudy.target(body(), player())).ok).toBe(true);
    expect(Husbandry.known(player(), PIGEON())).toBe(KIND_KNOWN);
    expect(player().studyMarks?.[`creature:${PIGEON()}`]).toEqual({ sittings: 2, harm: 1, known: KIND_KNOWN });
  });

  it('a body that comes for you is known as well, and nothing is said of keeping it', async () => {
    await sit('success', RAT());
    expect(Husbandry.known(player(), RAT())).toBe(KIND_KNOWN);
    expect(said().some(l => l.includes('alive'))).toBe(false);
  });

  it('once the kind is known a sitting is told its words, and not before (S1k)', () => {
    expect(FieldStudy.target(body(), player()).tags).toEqual([]);
    const who = Husbandry.learn(player(), PIGEON(), KIND_KNOWN);
    expect(FieldStudy.target(body(), who).tags).toEqual(MOB_DEFINITIONS[PIGEON()].tags);
  });

  it('what is held of the trades that take and keep a living thing makes a sitting on one cost less, and on nothing else', () => {
    const target = FieldStudy.target(body(), player());
    const plain = StudySystem.studyAsk(player(), target);
    const trapper = holding(player(), trade('trap', 6));
    const herder = holding(trapper, trade('keep', 6));
    expect(StudySystem.catchKnowledge(player())).toBe(0);
    expect(StudySystem.catchKnowledge(herder)).toBeGreaterThan(StudySystem.catchKnowledge(trapper));
    expect(StudySystem.studyAsk(trapper, target).cost).toBeLessThan(plain.cost);
    expect(StudySystem.studyAsk(herder, target).cost).toBeLessThan(StudySystem.studyAsk(trapper, target).cost);
    const log = StudySystem.targetOfThing({ id: 'log', name: 'A log', tags: ['flora', 'wood'] });
    expect(StudySystem.studyAsk(herder, log)).toEqual(StudySystem.studyAsk(player(), log));
  });

  it('what is known only climbs', () => {
    const deep = Husbandry.learn(player(), PIGEON(), KIND_FIGURED);
    expect(Husbandry.learn(deep, PIGEON(), KIND_KNOWN)).toBe(deep);
    expect(Husbandry.levelAfter(0, false)).toBe(KIND_KNOWN);
    expect(Husbandry.levelAfter(0, true)).toBe(KIND_FIGURED);
    expect(Husbandry.levelAfter(KIND_KNOWN, false)).toBe(KIND_FIGURED);
    expect(Husbandry.levelAfter(KIND_FIGURED, false)).toBe(KIND_FIGURED);
  });
});

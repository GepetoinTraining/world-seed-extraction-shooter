/**
 * DOWNTIME: THE ACTS, THE VIEW AND THE RETURN (the design pass, part 5b). Registered before the build.
 *
 * Every act a stack takes is the hand's own: a sitting through the study law and the one landing a hand's sitting goes
 * through, writing out through LorePiece, a rest through the rest's own settle, begin and wake. Each costs and gives what
 * it does by hand. The marked goal can fill a stack with the studies on the way to it, as far as energy reaches. On return,
 * a plain account in words: what was done, what stopped and why, what is still stacked.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IItem, IPlayer, ISkillState, ItemType, Rarity, UniversalRank } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { Downtime } from '../shared/logic/systems/Downtime';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { StudyLanding } from '../src/logic/systems/StudyLanding';
import { LorePiece } from '../src/logic/systems/LorePiece';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { DowntimeActs } from '../src/logic/systems/DowntimeActs';

const SRC = (p: string) => readFileSync(p, 'utf8');
const T0 = 1_800_000_000_000;
const skill = (tool: string[] | null, worked: string[], xp = 0): ISkillState => {
  const pair = WebSystem.mint(tool, worked);
  return WebSystem.withCumulativeXp(WebSystem.freshSkill(pair.id, pair.tags, 0), xp);
};
const item = (id: string, over: Partial<IItem> = {}): IItem => ({
  id, universalDefinitionId: 'res_tree_log', name: 'Log', description: '', type: ItemType.RESOURCE, rank: UniversalRank.F,
  rarity: Rarity.COMMON, quality: 0.5, level: 1, value: 3, itemPower: 1, tags: ['flora', 'wood'], affixes: [],
  dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i', isIdentified: true, ...over
} as IItem);
const paper = (id: string) => item(id, { name: 'Carbon Paper', universalDefinitionId: 'crf_paper', tags: ['paper'] });
const AXE = skill(['axe'], ['flora', 'wood'], 4000);
const FLOOR = Object.fromEntries(['strength', 'constitution', 'agility', 'dexterity', 'endurance', 'intelligence', 'focus', 'engineering', 'hacking', 'perception', 'charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership'].map(a => [a, 1]));
const person = (energy: number, stash: IItem[] = [], over: Partial<IPlayer> = {}): IPlayer => ({
  id: 'p_away', username: 'AWAY', attributes: FLOOR, equipment: undefined, currentSession: undefined, skillProgress: {},
  materialMastery: { res_tree_log: { resourceId: 'res_tree_log', knowledgeLevel: 1, discoveredAffixes: [] } }, energyToday: energy,
  bank: { universalSkills: { [AXE.id]: AXE }, stashTabs: [{ name: 'tab', items: stash }], loreHeld: 0, gold: 100 }, ...over
} as unknown as IPlayer);
const rulesAt = (place: 'INN' | 'BED') => DowntimeActs.rules({ place, who: p => ({ uid: p.id, name: p.username }) });

describe('a stacked sitting is a hand\'s sitting', () => {
  const log = item('itm_log');
  const target = StudySystem.targetOfItem(log);

  it('it asks what study asks, in its own time', () => {
    const who = person(50, [log]);
    expect(rulesAt('BED').ask(who, { kind: 'STUDY', target }, T0)).toEqual({ ok: true, ms: StudySystem.studyAsk(who, target).seconds * 1000 });
  });

  it('it pays what study asks and lands through the one landing a hand\'s sitting goes through', () => {
    const who = person(50, [log]);
    const cost = StudySystem.studyAsk(who, target).cost;
    const byHand = StudyLanding.land(StudySystem.pay(who, cost), target, cost, T0 + 12_000)!;
    const stacked = rulesAt('BED').take(who, { kind: 'STUDY', target }, T0, T0 + 12_000);
    expect(stacked.player).toEqual(StudyLanding.eyeGrown(byHand.player, byHand.eye));
    expect(stacked.said).toContain(log.name);
  });

  it('a thing known by name is sat with as the web prices it', () => {
    const def = RESOURCE_DEFINITIONS.res_tree_log;
    const known = StudySystem.targetOfThing({ id: def.id, name: def.name, tags: def.tags, rank: def.rank });
    const who = person(50);
    expect(rulesAt('BED').ask(who, { kind: 'STUDY', target: known }, T0)).toEqual({ ok: true, ms: StudySystem.studyAsk(who, known).seconds * 1000 });
  });

  it('too little energy stops it in the study law\'s own words; a piece no longer held stops it too', () => {
    // Changed on purpose 2026-11-12 (EN): a day holding half of what the sitting asks, whatever the law asks now
    const low = StudySystem.studyAsk(person(50, [log]), target).cost / 2;
    const asked = rulesAt('BED').ask(person(low, [log]), { kind: 'STUDY', target }, T0);
    expect(asked).toEqual({ ok: false, reason: StudySystem.canStudy(person(low, [log]), target, T0).reason });
    expect(rulesAt('BED').ask(person(50, []), { kind: 'STUDY', target }, T0)).toMatchObject({ ok: false });
  });
});

describe('a stacked writing out and a stacked rest are the hand\'s', () => {
  it('writing out pays a sheet and a sitting\'s ask, as LorePiece writes, and keeps the skill', () => {
    const who = person(50, [paper('pp_1')]);
    const stacked = rulesAt('BED').take(who, { kind: 'WRITE', skillId: AXE.id }, T0, T0 + 10_000);
    const byHand = LorePiece.write(who, AXE.id, { uid: who.id, name: 'AWAY' }, T0 + 10_000);
    expect(stacked.player).toEqual(byHand.player);
    expect(rulesAt('BED').ask(who, { kind: 'WRITE', skillId: AXE.id }, T0)).toEqual({ ok: true, ms: LorePiece.ask(who, AXE).seconds * 1000 });
  });

  it('a rest takes the rest\'s own time, settles what is ready, and wakes rested; at the inn it costs the night', () => {
    const tired = person(10);
    expect(rulesAt('BED').ask(tired, { kind: 'REST' }, T0)).toEqual({ ok: true, ms: RestSystem.restMs(tired) });
    const bed = rulesAt('BED').take(tired, { kind: 'REST' }, T0, T0 + RestSystem.restMs(tired));
    expect(bed.player.energyToday).toBe(RestSystem.wake(RestSystem.beginRest(tired, 'BED', T0)).energyToday);
    expect(bed.player.rest).toBeUndefined();
    const inn = rulesAt('INN').take(tired, { kind: 'REST' }, T0, T0 + RestSystem.restMs(tired));
    expect(inn.player.bank.gold).toBe(100 - 20);
    expect(rulesAt('INN').ask(person(10, [], { bank: { universalSkills: {}, stashTabs: [], gold: 5 } } as Partial<IPlayer>), { kind: 'REST' }, T0)).toMatchObject({ ok: false });
  });

  it('a skill made ready by a piece settles at a stacked rest for its price, or waits, said as the rest says it', () => {
    const ready = (lore: number) => person(10, [], {
      skillProgress: { 'skill_blunt+metal': { id: 'skill_blunt+metal', tags: ['blunt', 'metal'], rank: 0, attempts: 1, weight: 3, ready: true } },
      bank: { universalSkills: {}, stashTabs: [], loreHeld: lore, gold: 100 }
    } as unknown as Partial<IPlayer>);
    expect(rulesAt('BED').take(ready(40), { kind: 'REST' }, T0, T0 + 1).said).toMatch(/It settled: .*took 40 lore/);
    expect(rulesAt('BED').take(ready(0), { kind: 'REST' }, T0, T0 + 1).said).toMatch(/was ready to settle, and it wants 40 lore/);
  });
});

describe('the marked goal fills a stack, and the return is said in words', () => {
  it('the studies on the way to a mark, in order, as far as energy reaches, never past what focus holds', () => {
    const who = { ...person(50, [], { materialMastery: { res_tree_log: { resourceId: 'res_tree_log', knowledgeLevel: 1, discoveredAffixes: [] } } }), bank: { universalSkills: {}, stashTabs: [], loreHeld: 0, gold: 0 }, webGoal: { ref: 'station:stn_sawpit', at: 1 } } as unknown as IPlayer;
    const acts = DowntimeActs.fromGoal(who, { web: { nodes: {} } });
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.length).toBeLessThanOrEqual(Downtime.capacity(who.attributes));
    for (const act of acts) expect(act).toMatchObject({ kind: 'STUDY', target: { kind: 'thing', ref: 'res_tree_log' } });
    const spent = acts.reduce((sum, a) => sum + (a.kind === 'STUDY' ? StudySystem.studyAsk(who, a.target).cost : 0), 0);
    // A stack begins after the rest it is laid with, so it reaches as far as the energy that rest gives back
    const atStart = StudySystem.energyLeft(RestSystem.wake(who));
    expect(spent).toBeLessThanOrEqual(atStart);
    const tired = { ...who, energyToday: 0 } as IPlayer;
    expect(DowntimeActs.fromGoal(tired, { web: { nodes: {} } })).toEqual(acts);
    const focused = { ...who, attributes: { ...who.attributes, focus: 1 + 6 * 3 } } as IPlayer;
    const many = DowntimeActs.fromGoal(focused, { web: { nodes: {} } });
    // Changed on purpose 2026-11-12 (EN, ledger EN13): a sitting costs a fifth of what it did, so a rested day now reaches
    // as far as a well-focused stack holds; it never goes past either
    expect(many.length).toBeLessThanOrEqual(Downtime.capacity(focused.attributes));
    expect(many.reduce((sum, a) => sum + (a.kind === 'STUDY' ? StudySystem.studyAsk(focused, a.target).cost : 0), 0)).toBeLessThanOrEqual(StudySystem.energyLeft(RestSystem.wake(focused)));
  });

  it('what was done, what stopped and why, and what is still stacked, in plain words', () => {
    const log = item('itm_log');
    const lines = DowntimeActs.words({ done: [{ act: { kind: 'REST' }, at: T0, said: 'You rested.' }], stopped: { act: { kind: 'STUDY', target: StudySystem.targetOfItem(log) }, reason: 'Refused: needs 15 energy, you hold 5. Rest first.' } },
      [{ kind: 'STUDY', target: StudySystem.targetOfItem(log) }, { kind: 'WRITE', skillId: AXE.id }]);
    expect(lines[0]).toBe('You rested.');
    expect(lines.join(' ')).toContain('It stopped at sitting with Log: Refused: needs 15 energy, you hold 5. Rest first.');
    expect(lines.join(' ')).toMatch(/Still stacked: sitting with Log, writing out /);
  });
});

describe('the doors: laid where a character rests, kept with them, shown on the large sheet, walked on the game\'s clock', () => {
  it('kept on the character and set through the player store', () => {
    expect(SRC('shared/types.ts')).toMatch(/downtime\?:/);
    expect(SRC('src/entities/player/playerView.ts')).toMatch(/'DOWNTIME'/);
  });
  it('laid at the inn\'s keeper and at one\'s own bed', () => {
    expect(SRC('src/entities/hub/HubGenerator.ts')).toMatch(/LAY_STACK/);
    expect(SRC('src/components/HoldingsPanel.tsx')).toMatch(/DowntimePanel/);
  });
  it('the large sheet shows it, and the return walks it on the game\'s clock, never the device\'s', () => {
    expect(SRC('src/components/LargeSheet.tsx')).toMatch(/WHILE AWAY/);
    const door = SRC('src/logic/systems/DowntimeDoor.ts');
    expect(door).toMatch(/GameClock\.now\(\)/);
    expect(door).not.toMatch(/Date\.now\(\)/);
  });
  it('a hand\'s sitting lands through the same landing', () => {
    expect(SRC('src/logic/systems/StudyDoor.ts')).toMatch(/StudyLanding\.land\(/);
  });
});

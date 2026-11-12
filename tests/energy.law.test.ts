/**
 * THE DAY'S WORK (EN), bars set before the build and seen red.
 *
 * Pedro, 2026-11-12, after playing on main: "we need to separate the energy consumption, right now energy is bonkers,
 * it's using way too much, and no level of skill gets it down."
 *
 * The coordinator's calls, each his to strike (ledger EN): energy is the day's budget for work, and a weapon's own blow
 * takes none of it, a focus's cast included; every act of work has one cost from one law that every spending place
 * reads; the skill that does an act brings its cost down, a rank's worth of it halving the cost, with no floor and no
 * top; what a full pool pays at rank F with no skill is set by measure (EN1: a plain run's work fits one plain day);
 * the cost is said where the act is offered, and the sheet says what brings each one down.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IAttributes, IItem, ISkillState, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../shared/types';
import { EntityType, IChunk, IWorldEntity } from '../shared/entities/world/types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../shared/entities/item/data/resourceDefinitions';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { harvestNumbers } from '../shared/logic/theme/ThemeFormula';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { BASE_ENERGY } from '../shared/logic/systems/StatSystem';
import { LORE_ROLL_PER_POINT, LORE_ROLL_PER_RANK } from '../shared/logic/systems/LoreConstants';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { EnergyLaw, LEVELS_A_RANK, PLAIN_RUN, UNSKILLED } from '../shared/logic/systems/EnergyLaw';
import { WorkCost } from '../shared/logic/systems/WorkCost';
import { emptyGroundRecord } from '../shared/entities/world/GroundReturn';
import { SpreadBook } from '../shared/entities/world/Spread';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { useTalk } from '../src/entities/interaction/talkStore';
import { useWorldStore } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';
import { fireGate } from '../src/logic/systems/FieldInput';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { SkillNames } from '../src/logic/systems/SkillNames';
import { said } from '../src/logic/systems/SheetWords';
import { Tutorial } from '../src/logic/systems/Tutorial';
import { LargeSheet } from '../src/components/LargeSheet';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_energy';
const CERT = { metadata: { uid: UID, displayName: 'TALLY', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any } as any;
const keyOf = (id: string) => id.replace(/^res_[0-9a-f]+_/, '');
const byKey = (key: string) => Object.values(RESOURCE_DEFINITIONS).find(d => keyOf(d.id) === key && d.themeId === FIRST_THEME_PACK.themeId)! as ResourceDef;
const wheat = () => byKey('chaffwheat');
const iron = () => byKey('collateral_iron');
const floor = (): IAttributes => Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 4])) as unknown as IAttributes;
const player = () => usePlayerStore.getState().player;
const store = () => usePlayerStore.getState();
const energy = () => player().currentSession!.energy;
const talk = () => useTalk.getState();

/** A skill held at this level, born at this rank: the pair's own id and words. */
const skillAt = (id: string, tags: string[], level: number, rank = 0): ISkillState => ({ ...WebSystem.freshSkill(id, tags, rank), level, bornRank: rank, rank });
const holding = (...skills: ISkillState[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, universalSkills: Object.fromEntries(skills.map(k => [k.id, k])) } }
}));
const pickOf = (rank: UniversalRank): IItem => {
  const base = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.items.tool_bases.find(d => JSON.stringify(d).includes('pickaxe'))!;
  const item = ItemFactory.createItem(rank, false, Rng.fromKey('pick'), undefined, base.id);
  return { ...item, rank, quality: 0, stats: { ...item.stats, durability: 100, maxDurability: 100 } } as IItem;
};
const material = (def: ResourceDef, key: string): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(key));
const snare = (): IItem => ({ ...material(wheat(), 'snare'), id: 'itm_snare', name: 'Snare', tags: ['snare', 'trap'] } as IItem);

const place = (def: ResourceDef, id: string): IWorldEntity => ({
  id, type: EntityType.RESOURCE, definitionId: def.id, position: { x: 40, y: 40 }, rank: def.rank as UniversalRank,
  rarity: Rarity.COMMON, isHostile: false, usesRemaining: 100
});
const chest = (id: string): IWorldEntity => ({
  id, type: EntityType.CONTAINER, definitionId: 'chest_ruin', position: { x: 40, y: 40 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  container: { lootRank: UniversalRank.F, looted: false, hasLore: false }
} as IWorldEntity);
const cache = (id: string): IWorldEntity => ({
  id, type: EntityType.CONTAINER, definitionId: 'ground_cache', position: { x: 40, y: 40 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  container: { lootRank: UniversalRank.F, looted: false, hasLore: false, items: [material(wheat(), 'cached')] }
} as IWorldEntity);
const person = (id: string, disposition = 30): IWorldEntity => ({
  id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 40, y: 40 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition, attempts: 0 }
} as IWorldEntity);
const creature = (id: string): IWorldEntity => {
  const def = Object.values(MOB_DEFINITIONS).find(d => (d as any).themeId === FIRST_THEME_PACK.themeId && !(d.tags ?? []).includes('leader'))!;
  return { id, type: EntityType.MOB, definitionId: def.id, position: { x: 40, y: 40 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: true, health: 8, maxHealth: 8 } as IWorldEntity;
};

const tutorial = Tutorial.card(0, 0);
/** A character standing in a field with these, carrying these, with a day of 1000 so a cost is read off what it took. */
const stage = (entities: IWorldEntity[], carried: IItem[] = []) => {
  const chunk = { id: 'c', x: 0, y: 0, biome: 'INDUSTRIAL', difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities, scanLevel: 0, isTraversable: true, hasExtraction: false } as unknown as IChunk;
  useWorldStore.setState({
    currentMap: { seed: tutorial.seed, width: 32, height: 32, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': chunk } } as never,
    availableWorlds: [tutorial], activeWorldId: tutorial.id, groundRecord: emptyGroundRecord()
  } as never);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'TALLY', attributes: floor(), baseAttributes: floor(), materialMastery: {}, skillProgress: {},
      equipment: LoadoutSystem.emptyEquipment(), bank: { ...s.player.bank, universalSkills: {} },
      currentSession: { sessionId: 'sess_energy', layerId: 'l', inventory: carried, inventoryLayout: {}, kitItemIds: [], health: 100, maxHealth: 100, energy: 1000, maxEnergy: 1000, position: { x: 40, y: 0, z: 40 }, statusEffects: [] } as never
    }
  }));
};
const option = (e: IWorldEntity, starts: string) => InteractionEngine.getAvailableInteractions(player(), e, 1).find(o => o.id.startsWith(starts))!;
/** What a press took from the day. */
const took = (fn: () => unknown) => { const before = energy(); fn(); return Math.round((before - energy()) * 1000) / 1000; };
const tookAsync = async (fn: () => Promise<unknown>) => { const before = energy(); await fn(); return Math.round((before - energy()) * 1000) / 1000; };
const answering = () => vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(async () => ({ status: 'OK', data: { band: 'lands', asked: { promise: 'keeps', harm: 'none' }, reply: 'Go on, then.', wants: '' }, usage: { model: 'faked', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0 } } as any));

beforeEach(() => {
  localStorage.clear();
  useFeed.setState({ lines: [] } as never);
  useTalk.getState().close();
  useIdentityStore.setState({ certificate: CERT } as any);
  usePlayerStore.getState().initializeSession(CERT, 'NOMAD');
  SpreadBook.enter(ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.F).resourceDefinitions as ResourceDef[], FIRST_THEME_PACK.themeId);
});
afterEach(() => { vi.restoreAllMocks(); });

// -----------------------------------------------------------------------------
// ONE LAW, SET BY MEASURE
// -----------------------------------------------------------------------------

describe('EN: one law, and a plain run\'s work fits one plain day', () => {
  it('a plain run at rank F with no skill (EN1: 19 tries with a tool, 2 chests, a person turned and secured, 2 sittings) is one plain day', () => {
    const tool = harvestNumbers('tool', 'F').energyCost;
    const run = PLAIN_RUN.tries * EnergyLaw.raw('try', null, tool)
      + PLAIN_RUN.chests * EnergyLaw.raw('open', null)
      + PLAIN_RUN.asks * EnergyLaw.raw('round', null)
      + PLAIN_RUN.secured * EnergyLaw.raw('secure', null)
      + PLAIN_RUN.sittings * EnergyLaw.raw('sitting', null);
    expect(run).toBeCloseTo(BASE_ENERGY, 6);
    // The count it was set by, as measured in the hidden window on main
    expect(PLAIN_RUN).toEqual({ tries: 19, chests: 2, asks: 8, secured: 1, sittings: 2 });
  });

  it('every act keeps its size against the others as main had it; only the day they are counted against moved', () => {
    const tool = harvestNumbers('tool', 'F').energyCost;
    const hands = harvestNumbers('hands', 'F').energyCost;
    const unit = EnergyLaw.raw('round', undefined) / 5;
    expect(EnergyLaw.raw('try', undefined, tool) / unit).toBeCloseTo(6);
    expect(EnergyLaw.raw('try', undefined, hands) / unit).toBeCloseTo(2);
    expect(EnergyLaw.raw('sitting', undefined) / unit).toBeCloseTo(10);
    expect(EnergyLaw.raw('open', undefined) / unit).toBeCloseTo(2);
    expect(EnergyLaw.raw('snare', undefined) / unit).toBeCloseTo(3);
    expect(EnergyLaw.raw('make', undefined) / unit).toBeCloseTo(5);
    expect(EnergyLaw.raw('gift', undefined) / unit).toBeCloseTo(2);
    expect(EnergyLaw.raw('secure', undefined) / unit).toBeCloseTo(5);
    // Main's flat 10 a sitting, 5 a round: a plain day now pays for about five and a half times the work
    expect(unit * 5).toBeLessThan(1);
  });

  it('an act that has a skill, done with none of it, costs half again; one no skill does costs its base', () => {
    expect(UNSKILLED).toBe(1.5);
    expect(EnergyLaw.raw('round', null)).toBeCloseTo(1.5 * EnergyLaw.raw('round', undefined));
    expect(EnergyLaw.raw('round', 0)).toBeCloseTo(EnergyLaw.raw('round', undefined));
  });

  it('what is spent is what is said: whole from ten up, to one place under it', () => {
    for (const act of ['try', 'sitting', 'round', 'open', 'snare', 'make', 'gift', 'secure', 'analyze'] as const) {
      for (const levels of [null, undefined, 0, 1, 2.5, 7, 20]) {
        for (const weight of [undefined, 2, 6, 100]) {
          const cost = EnergyLaw.cost(act, levels, act === 'try' ? weight ?? 6 : undefined);
          expect(String(cost)).toBe(said(cost));
        }
      }
    }
  });
});

// -----------------------------------------------------------------------------
// THE SKILL THAT DOES IT BRINGS IT DOWN
// -----------------------------------------------------------------------------

describe('EN: a rank\'s worth of the skill that does it halves the cost, with no floor and no top', () => {
  it('a rank\'s worth is as many levels as the roll gives for a rank of what is faced: three', () => {
    expect(LEVELS_A_RANK).toBe(LORE_ROLL_PER_RANK / LORE_ROLL_PER_POINT);
    expect(LEVELS_A_RANK).toBe(3);
    expect(EnergyLaw.share(0)).toBe(1);
    expect(EnergyLaw.share(LEVELS_A_RANK)).toBeCloseTo(0.5);
    expect(EnergyLaw.share(2 * LEVELS_A_RANK)).toBeCloseTo(0.25);
  });

  it('a skill brings its levels past the first, each worth what a level of its rarity is worth', () => {
    expect(EnergyLaw.levelsOf(undefined)).toBeNull();
    expect(EnergyLaw.levelsOf(skillAt('skill_x', ['x'], 1))).toBe(0);
    expect(EnergyLaw.levelsOf(skillAt('skill_x', ['x'], 4))).toBe(3);
    // Pedro: a rarer skill should "level up slowly and have a large impact per level"
    expect(EnergyLaw.levelsOf(skillAt('skill_x', ['x'], 4, 1))!).toBeGreaterThan(3);
  });

  it('no floor and no top: every level brings it lower, and it never stops', () => {
    let last = Infinity;
    for (let level = 1; level <= 90; level++) {
      const raw = EnergyLaw.raw('try', EnergyLaw.levelsOf(skillAt('skill_x', ['x'], level)), 6);
      expect(raw).toBeLessThan(last);
      expect(raw).toBeGreaterThan(0);
      last = raw;
    }
  });

  it('a try: level 4 of that tool on that material costs half of level 1, and levels 1, 5 and 10 each cost less than the last', () => {
    stage([]);
    const pair = WebSystem.pairOfHarvest(player(), iron())!;
    const at = (level: number) => { holding(skillAt(pair.id, pair.tags, level)); return WebSystem.energyFor(player(), pair, 100).cost; };
    expect(at(4) / at(1)).toBeCloseTo(0.5, 1);
    expect(at(5)).toBeLessThan(at(1));
    expect(at(10)).toBeLessThan(at(5));
    holding();
    expect(WebSystem.energyFor(player(), pair, 100).cost).toBe(EnergyLaw.cost('try', null, 100));
  });

  it('a sitting: a rank\'s worth of what the person knows of the thing\'s tree halves it, and the eye says only whether it is winged', () => {
    stage([]);
    const thing = StudySystem.targetOfThing({ id: 'x', name: 'x', tags: ['mineral', 'stone'], rank: UniversalRank.F });
    const eye = (level: number) => skillAt(StudySystem.scopeSkillId('material'), ['identify_material'], level);
    holding();
    expect(StudySystem.studyAsk(player(), thing).cost).toBe(EnergyLaw.cost('sitting', null));
    holding(eye(1));
    expect(StudySystem.studyAsk(player(), thing).cost).toBe(EnergyLaw.cost('sitting', 0));
    // With no eye schooled it is winged, and what is known of its tree still brings it down, as the study-cost work had it
    holding(skillAt('skill_mineral+stone', ['mineral', 'stone'], 1));
    const winged = WebSystem.treeKnowledge(player().bank.universalSkills, thing.tags);
    expect(StudySystem.studyAsk(player(), thing).cost).toBe(EnergyLaw.cost('sitting', winged, undefined, true));
    expect(StudySystem.studyAsk(player(), thing).cost).toBeLessThan(EnergyLaw.cost('sitting', null));
    holding(eye(1), skillAt('skill_mineral+stone', ['mineral', 'stone'], 1));
    const known = WebSystem.treeKnowledge(player().bank.universalSkills, thing.tags);
    expect(known).toBeGreaterThan(0);
    expect(StudySystem.studyAsk(player(), thing).cost).toBe(EnergyLaw.cost('sitting', known));
    const costs = [1, 5, 10].map(l => { holding(eye(1), skillAt('skill_mineral+stone', ['mineral', 'stone'], l)); return EnergyLaw.raw('sitting', WebSystem.treeKnowledge(player().bank.universalSkills, thing.tags)); });
    expect(costs[1]).toBeLessThan(costs[0]);
    expect(costs[2]).toBeLessThan(costs[1]);
  });

  it('identifying at the bench: a rank\'s worth of the eye halves it', () => {
    stage([]);
    const piece = { ...material(wheat(), 'unread'), isIdentified: false } as IItem;
    const eye = (level: number) => skillAt(StudySystem.scopeSkillId('material'), ['identify_material'], level);
    holding();
    expect(StudySystem.identifyAsk(player(), piece).cost).toBe(EnergyLaw.cost('sitting', null));
    holding(eye(1));
    const one = StudySystem.identifyAsk(player(), piece).cost;
    holding(eye(4));
    expect(StudySystem.identifyAsk(player(), piece).cost).toBe(EnergyLaw.cost('sitting', 3));
    expect(StudySystem.identifyAsk(player(), piece).cost).toBeLessThan(one);
  });

  it('every other act: levels 1, 5 and 10 of the skill it trains each cost less than the last', () => {
    for (const act of ['round', 'open', 'snare', 'gift', 'secure', 'analyze'] as const) {
      stage([]);
      const pair = WorkCost.pairOf(act)!;
      expect(pair, act).toBeTruthy();
      const at = (level: number) => { holding(skillAt(pair.id, pair.tags, level)); return EnergyLaw.raw(act, EnergyLaw.levelsOf(player().bank.universalSkills[pair.id])); };
      expect(at(5), act).toBeLessThan(at(1));
      expect(at(10), act).toBeLessThan(at(5));
      holding();
      expect(WorkCost.of(player(), act), act).toBe(EnergyLaw.cost(act, null));
      holding(skillAt(pair.id, pair.tags, 4));
      expect(WorkCost.of(player(), act), act).toBe(EnergyLaw.cost(act, 3));
    }
  });

  it('working two things together: what the person knows of the two things\' tree brings it down, and nothing tells whether they make something', () => {
    stage([]);
    const a = material(wheat(), 'a'), b = material(iron(), 'b');
    holding();
    expect(WorkCost.make(player(), a, b)).toBe(EnergyLaw.cost('make', undefined));
    holding(skillAt('skill_mineral+stone', ['mineral', 'stone'], 4));
    const known = WebSystem.treeKnowledge(player().bank.universalSkills, [...(a.tags ?? []), ...(b.tags ?? [])]);
    expect(WorkCost.make(player(), a, b)).toBe(EnergyLaw.cost('make', known));
  });
});

// -----------------------------------------------------------------------------
// A BLOW TAKES NONE OF THE DAY
// -----------------------------------------------------------------------------

describe('EN: a weapon\'s own blow takes none of the day, a focus\'s cast included', () => {
  it('a focus fires on an empty day, as a bow does', () => {
    expect(fireGate({ held: true, now: 5000, lastShot: 0, cooldownMs: 100, mode: 'FOCUS' })).toBe('FIRE');
    expect(fireGate({ held: true, now: 5000, lastShot: 0, cooldownMs: 100, mode: 'SHOT' })).toBe('FIRE');
  });

  it('nothing in the field\'s fire takes energy', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).not.toMatch(/FOCUS_ENERGY_COST/);
    expect(canvas).not.toMatch(/Not enough energy to cast/);
    expect(SRC('src/logic/systems/FieldInput.ts')).not.toMatch(/NO_ENERGY|ENERGY_COST/);
  });
});

// -----------------------------------------------------------------------------
// EVERY PLACE THAT SPENDS READS THE LAW
// -----------------------------------------------------------------------------

describe('EN: every place that spends energy on work asks the law, and says what it asks', () => {
  it('a try: the menu says what the law asks, and the press takes exactly that', () => {
    const grain = place(wheat(), 'ent_0_0_r0');
    stage([grain]);
    const ask = option(grain, 'int_try_').energyCost;
    expect(ask).toBe(EnergyLaw.cost('try', null, wheat().harvestConfig!.energyCost));
    expect(took(() => store().performInteraction(`int_try_${grain.id}`, grain.id))).toBe(ask);
  });

  it('a try with a tool, with the skill of it at level 4: half of level 1, said and taken', () => {
    const vein = place(iron(), 'ent_0_0_r1');
    stage([vein], [pickOf(UniversalRank.F)]);
    const pair = WebSystem.pairOfHarvest(player(), iron())!;
    holding(skillAt(pair.id, pair.tags, 4));
    const ask = option(vein, 'int_try_').energyCost;
    expect(ask).toBe(EnergyLaw.cost('try', 3, iron().harvestConfig!.energyCost));
    expect(took(() => store().performInteraction(`int_try_${vein.id}`, vein.id))).toBe(ask);
  });

  it('a chest and a cache: the menu says the law\'s, and the press takes it', () => {
    const box = chest('ent_0_0_chest');
    const left = cache('ent_0_0_cache');
    stage([box, left]);
    const ask = option(box, 'int_open_').energyCost;
    expect(ask).toBe(WorkCost.of(player(), 'open'));
    expect(took(() => store().performInteraction(`int_open_${box.id}`, box.id))).toBe(ask);
    expect(took(() => store().performInteraction(`int_open_${left.id}`, left.id))).toBe(WorkCost.of(player(), 'open'));
  });

  it('a gift and someone secured: each takes the law\'s', () => {
    const given = person('ent_0_0_p1');
    const willing = person('ent_0_0_p2', 100);
    stage([given, willing], [material(wheat(), 'gift')]);
    expect(took(() => store().performInteraction(`int_gift_${given.id}`, given.id))).toBe(WorkCost.of(player(), 'gift'));
    expect(option(willing, 'int_recruit_').energyCost).toBe(WorkCost.of(player(), 'secure'));
    expect(took(() => store().performInteraction(`int_recruit_${willing.id}`, willing.id))).toBe(WorkCost.of(player(), 'secure'));
  });

  it('a snare: the menu says the law\'s, and the press takes it', () => {
    const body = creature('ent_0_0_m0');
    stage([body], [snare()]);
    const ask = option(body, 'int_snare_').energyCost;
    expect(ask).toBe(WorkCost.of(player(), 'snare'));
    expect(took(() => store().performInteraction(`int_snare_${body.id}`, body.id))).toBe(ask);
  });

  it('Analyze Structure takes what its menu says, where it said 2 and took nothing (EN2)', () => {
    const someone = person('ent_0_0_p3');
    stage([someone]);
    const ask = option(someone, 'int_study').energyCost;
    expect(ask).toBe(WorkCost.of(player(), 'analyze'));
    expect(ask).toBeGreaterThan(0);
    expect(took(() => store().performInteraction('int_study', someone.id))).toBe(ask);
  });

  it('a round of talk and a name asked take the law\'s, and the menu says it', async () => {
    answering();
    const them = person('ent_0_0_p4');
    stage([them]);
    expect(option(them, 'int_talk_').energyCost).toBe(WorkCost.of(player(), 'round'));
    await talk().open({ kind: 'FIELD_PERSON', entityId: them.id });
    expect(await tookAsync(() => talk().askName())).toBe(WorkCost.of(player(), 'round'));
    expect(await tookAsync(() => talk().say('I can carry it for you.'))).toBe(WorkCost.of(player(), 'round'));
  });

  it('crafting by two takes the law\'s', () => {
    const a = material(wheat(), 'm1'), b = material(wheat(), 'm2');
    stage([], [a, b]);
    const ask = WorkCost.make(player(), a, b);
    expect(took(() => store().combine(a.id, b.id))).toBe(ask);
  });

  it('no place keeps a number of its own', () => {
    const engine = SRC('src/entities/interaction/InteractionEngine.ts');
    expect(engine.match(/energyCost: [1-9]/g) ?? []).toEqual([]);
    expect(engine).not.toMatch(/TALK_ENERGY|SNARE_ENERGY/);
    const playerStore = SRC('src/entities/player/store.ts');
    expect(playerStore).not.toMatch(/spendEnergy\(\d|PAIR_ENERGY|SNARE_ENERGY|held < 2/);
    expect(SRC('src/entities/interaction/talkStore.ts')).not.toMatch(/TALK_ENERGY/);
    expect(SRC('src/components/TalkWindow.tsx')).not.toMatch(/TALK_ENERGY/);
    expect(SRC('src/logic/systems/ItemHands.ts')).not.toMatch(/PAIR_ENERGY/);
    expect(SRC('src/logic/systems/StudySystem.ts')).not.toMatch(/IDENTIFY_ENERGY/);
    expect(SRC('shared/logic/systems/WebSystem.ts')).not.toMatch(/WINGING_ENERGY_FACTOR|RUNG_ENERGY_DISCOUNT/);
  });
});

// -----------------------------------------------------------------------------
// EACH ACT READS THE SKILL IT TRAINS
// -----------------------------------------------------------------------------

describe('EN: the skill that brings an act\'s cost down is the one the act trains', () => {
  it('a chest opened, a round of talk, a gift and someone secured each grow the skill their cost reads', async () => {
    answering();
    const box = chest('ent_0_0_chest2');
    const given = person('ent_0_0_p5');
    const willing = person('ent_0_0_p6', 100);
    const them = person('ent_0_0_p7');
    stage([box, given, willing, them], [material(wheat(), 'gift2')]);
    store().performInteraction(`int_open_${box.id}`, box.id);
    store().performInteraction(`int_gift_${given.id}`, given.id);
    store().performInteraction(`int_recruit_${willing.id}`, willing.id);
    await talk().open({ kind: 'FIELD_PERSON', entityId: them.id });
    await talk().say('I can carry it for you.');
    const forming = Object.keys(player().skillProgress ?? {});
    for (const act of ['open', 'gift', 'secure', 'round'] as const) expect(forming, act).toContain(WorkCost.pairOf(act)!.id);
  });

  it('a snare reads the skill a snare practises; Analyze Structure the skill it pays toward', () => {
    expect(WorkCost.pairOf('snare')).toEqual(WebSystem.mint(['trapping'], []));
    expect(SRC('src/logic/systems/FieldCapture.ts')).toMatch(/practise\(\['trapping'\]/);
    expect(WorkCost.pairOf('analyze')!.id).toBe('skill_analysis');
    expect(SRC('src/entities/player/store.ts')).toMatch(/gainSkillXp\('skill_analysis'/);
  });
});

// -----------------------------------------------------------------------------
// THE SHEET SAYS WHAT BRINGS EACH COST DOWN
// -----------------------------------------------------------------------------

describe('EN: the sheet says what brings each cost down, as a fixed fact', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeAll(() => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined), set: () => true });
    (HTMLCanvasElement.prototype as any).getContext = () => ctx;
  });

  it('the large sheet says a blow takes none of it, and names the skill behind each act of work', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const words = host.textContent ?? '';
    expect(words).toMatch(/A blow takes none of it/);
    for (const act of ['round', 'open', 'snare', 'gift', 'secure'] as const) expect(words, act).toContain(SkillNames.nameOf(WorkCost.pairOf(act)!.id));
    expect(words).toMatch(/that tool on that material/);
    await act(async () => { root.unmount(); });
    host.remove();
  });
});


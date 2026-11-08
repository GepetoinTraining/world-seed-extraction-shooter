/**
 * THE TALK (D113, D114's menu, D116) — registered before the build. Test lines, stated plainly:
 *   147 convincing a person is a talk: each round carries the message, the roll and what is
 *       required, a model judges whether it is aligned and gives a bonus or a penalty, the roll
 *       moves a meter, and a tougher person is harder to bring. With no key the round still rolls
 *   148 an intelligent monster opens a bargain menu on a right click: aggressive to neutral to
 *       friendly, then what it wants
 *   149 a person's goal is set from the talk's log and their sheet before the model answers,
 *       follows the needs ladder, and their alignment refuses what it gates; there is no crime in code
 *   150 a person can post a quest, and ask for the building their goal needs
 *
 * Pedro at the stream's start, on what marks a monster: "it's a skill, intelligent means it can
 * develop mental stats and achieve speech. humanoid monsters should possess it by default, speech
 * bubbles over their head on occasion shows that to the player, use gibberish as the font face."
 * On alignment: "use D&D, we'll introduce infamy later". On the meter: the same number.
 *
 * No real key was available, so every model answer in this file is faked at the door.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const db = new Map<string, any>();

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, JSON.parse(JSON.stringify(doc))); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));

vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true
  }
}));

import { IAttributes, IItem, ItemType, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, SlotType, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { useWorldStore } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useHubStore, hubPort } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { talkFrom, useTalk } from '../src/entities/interaction/talkStore';
import { pickInteract } from '../src/logic/systems/FieldInput';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';
import { Ledger } from '../src/logic/ledger/Ledger';
import { NpcSheet } from '../shared/logic/systems/NpcSheet';
import { LADDER, NEEDS, NpcAgenda } from '../src/logic/systems/NpcAgenda';
import { ALIGNMENTS, Alignment } from '../shared/logic/systems/Alignment';
import { TalkLaw } from '../src/logic/systems/TalkLaw';
import { TalkDoor } from '../src/logic/systems/TalkDoor';
import { HARM_BANDS, JUDGE_BANDS, PROMISE_BANDS, TALK_MESSAGE_LIMIT as SAID_LIMIT } from '../shared/logic/systems/TalkTypes';
import { MIND_TAGS, MonsterMind, SPEECH_RUNG } from '../src/logic/systems/MonsterMind';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { SessionJournal } from '../src/logic/journal/SessionJournal';
import { bubbleOf, gibberish } from '../src/render/atoms/speech';
import { buildGibberishFace, GIBBERISH_FAMILY } from '../src/render/atoms/gibberishFace';
import { runGoldenCheck } from '../src/entities/world/goldens';
import { IntelligenceDoor, IDoorRequest, TALK_SPEND_LIMIT_USD, TALK_MESSAGE_LIMIT, AbsentProvider } from '../shared/intelligence/door';
import { ClaudeProvider, MODEL_FOR } from '../shared/intelligence/claude';
import { buildBargainRequest, buildNpcGoalRequest, buildNpcTalkRequest } from '../shared/intelligence/prompts';
import { createIntelligenceHandler } from '../server/intelligence/http';
import { worldDay } from '../src/entities/hub/store';
import { HubGenerator, POIType } from '../src/entities/hub/HubGenerator';
import { houseTags, livingPerDay, residentRung, residentWagePerDay, wantFor } from '../src/entities/hub/guild';
import { residentFacts } from '../src/entities/hub/money';
import { ResidentDay } from '../src/entities/hub/residentDay';
import { doorOf } from '../src/render/atoms/hub';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { GoldCommit } from '../src/logic/economy/GoldCommit';
import { TALK_ENERGY } from '../src/logic/systems/TalkLaw';
import { MemoryStore, rememberThreat } from '../src/entities/interaction/memoryStore';
import { MemoryLaw } from '../src/logic/memory/MemoryLaw';
import { MeetDoor } from '../src/logic/systems/MeetDoor';
import { MeetLaw } from '../src/logic/systems/MeetLaw';
import { PersonLedger } from '../src/logic/people/PersonLedger';

const UID = 'uid_talk';
const HUB = 'hub_talk';
const SEED = 'seed_talk';
const hub = () => useHubStore.getState();
const talk = () => useTalk.getState();
const player = () => usePlayerStore.getState().player;

const spread = (over: Partial<IAttributes> = {}): IAttributes =>
  ({ ...Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1])), ...over }) as unknown as IAttributes;

const person = (id = 'ent_person', rank = UniversalRank.E, over: Record<string, any> = {}): IWorldEntity => ({
  id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 0, y: 0 }, rank, rarity: Rarity.COMMON, isHostile: false,
  npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 30, attempts: 0, ...over }
});

/** A humanoid and a beast from the installed definitions, so the bars read what a world reads. */
const defWith = (test: (d: any) => boolean) => Object.values(MOB_DEFINITIONS).find(test) as any;
const humanoidDef = () => defWith(d => (d.tags ?? []).includes('humanoid') && d.behavior === 'AGGRESSIVE');
const beastDef = () => defWith(d => !(d.tags ?? []).includes('humanoid') && !(d.tags ?? []).includes('intelligent'));

const monster = (def: any, id = 'ent_mob'): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: def.id, position: { x: 20, y: 0 }, rank: def.rank, rarity: Rarity.COMMON, isHostile: true, health: 100
});

const stage = (...entities: IWorldEntity[]) => {
  useWorldStore.setState({
    currentMap: { seed: SEED, width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities } } } as any,
    availableWorlds: [], activeWorldId: null
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'QUOIN', attributes: spread({ charisma: 3 }), baseAttributes: spread({ charisma: 3 }),
      currentSession: { sessionId: 'sess_talk', layerId: 'l', inventory: [], kitItemIds: [], health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
    }
  }));
};

const live = (id: string) => Object.values(useWorldStore.getState().currentMap!.chunks).flatMap(c => c.entities).find(e => e.id === id)!;

const words = (over: Record<string, any> = {}): any => ({ band: 'lands', asked: { promise: 'keeps', harm: 'none' }, reply: 'Go on, then.', wants: '', ...over });
const goalWords = (over: Record<string, any> = {}): any => ({ need: 'survival', goal: 'Lay in food for the week.', means: { promise: 'keeps', harm: 'none' }, building: '', quest: null, ...over });

const answering = (data: unknown, status = 'OK') => {
  const usage = { model: 'claude-haiku-5-5', inputTokens: 900, outputTokens: 120, cacheReadTokens: 700, usd: 0.0002 };
  return vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(async () => ({ status, data, usage } as any));
};
const noVoice = () => {
  vi.spyOn(IntelligenceClient, 'npcTalk').mockResolvedValue({ status: 'NO_KEY', reason: 'No key.' } as any);
  vi.spyOn(IntelligenceClient, 'npcGoal').mockResolvedValue({ status: 'NO_KEY', reason: 'No key.' } as any);
  vi.spyOn(IntelligenceClient, 'bargain').mockResolvedValue({ status: 'NO_KEY', reason: 'No key.' } as any);
};

let minted = 0;
const thing = (over: Partial<IItem> = {}): IItem => ({
  id: `thing_${++minted}`, universalDefinitionId: 'res_tree_log', name: 'Oak Log', description: '', type: ItemType.RESOURCE, slot: SlotType.NONE,
  rank: UniversalRank.F, rarity: Rarity.COMMON, level: 1, quality: 0, value: 10, itemPower: 0, tags: ['wood', 'building', 'flora'], affixes: [],
  dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'x', colorHex: '#000000' }, icon: 'x', history: { dropDate: 0, killCount: 0 }, isIdentified: true,
  ...over
} as IItem);

const bondOf = (entityId = 'person_1', over: Record<string, any> = {}): IItem => thing({
  id: `bond_${entityId}`, universalDefinitionId: 'npc_contract', name: 'Escort Bond: Serin Vale', type: ItemType.LORE, rarity: Rarity.RARE, rank: UniversalRank.D, value: 200, tags: ['npc_contract', 'social'],
  bondData: { worldSeed: SEED, entityId, webVersion: WebBank.version(), rank: UniversalRank.D, rarity: Rarity.COMMON, sheet: { name: 'Serin Vale', temperament: 'COWARD', objective: 'HOARD', want: 'GIFT', disposition: 60, attempts: 3, ...over } }
});

const residentNamed = async (entityId = 'person_1') => {
  const bond = bondOf(entityId);
  usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, bond] } : t) } } }));
  await hub().redeemBond(bond.id);
  return hub().guild.residents.find(r => r.entityId === entityId)!;
};

beforeEach(async () => {
  vi.restoreAllMocks();
  MobAI.reset();
  db.clear();
  minted = 0;
  useTalk.setState(useTalk.getInitialState(), true);
  useIdentityStore.setState({ certificate: { metadata: { uid: UID, displayName: 'QUOIN' } } as any });
  usePlayerStore.setState(s => ({
    player: { ...s.player, id: UID, username: 'QUOIN', bank: { ...s.player.bank, gold: 0, universalSkills: {}, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) } }
  }));
  await Ledger.append('CHARACTER_GENESIS', { gold: 0 });
  await hub().loadHub(HUB);
  noVoice();
});

// ---------------------------------------------------------------------------
// THE SURFACE: a sheet for Haiku, with nothing stored and no vector moved
// ---------------------------------------------------------------------------

describe('a person\'s sheet is a surface, dealt at read time', () => {
  it('alignment is one of D&D\'s nine, keyed, the same on every read', () => {
    expect(ALIGNMENTS).toHaveLength(9);
    const sheet = NpcSheet.read(SEED, person(), 1);
    expect(ALIGNMENTS).toContain(sheet.alignment);
    expect(NpcSheet.read(SEED, person(), 1).alignment).toBe(sheet.alignment);
  });

  it('every word of the nine turns up, because the deal is on the seed and nothing else', () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => NpcSheet.read(SEED, person(`p${i}`), 1).alignment));
    expect(seen.size).toBe(9);
  });

  it('a bond reads the same alignment back', () => {
    const bond = bondOf('person_9');
    const sheet = NpcSheet.fromBond(bond)!;
    expect(sheet.alignment).toBe(NpcSheet.read(SEED, { id: 'person_9', rank: UniversalRank.D, npc: bond.bondData!.sheet as any }, WebBank.version()).alignment);
  });

  it('dealing it moves no stream: stats and skills are what they were, and the vectors stand', () => {
    const before = readFileSync('shared/logic/systems/NpcSheet.ts', 'utf8');
    expect(before).toMatch(/`\$\{key\}:stats`/);
    expect(before).toMatch(/`\$\{key\}:skills`/);
    expect(before).toMatch(/Alignment\.deal\(key\)/);
    expect(readFileSync('shared/logic/systems/Alignment.ts', 'utf8')).toMatch(/`\$\{key\}:alignment`/);
    expect(runGoldenCheck().ok).toBe(true);
  });

  it('a keeper of the city, who has no stored sheet, is still dealt a whole person', () => {
    const keeper = NpcSheet.keeper(HUB, 'npc_banker', UniversalRank.C, 'Marcus Goldweave');
    expect(keeper.name).toBe('Marcus Goldweave');
    expect(ALIGNMENTS).toContain(keeper.alignment);
    expect(keeper.temperament).toBeTruthy();
    expect(keeper.objective).toBeTruthy();
    expect(keeper.want).toBeTruthy();
    expect(JSON.stringify(NpcSheet.keeper(HUB, 'npc_banker', UniversalRank.C, 'Marcus Goldweave'))).toBe(JSON.stringify(keeper));
    expect(keeper.stats).toEqual(NpcSheet.read(HUB, { id: 'npc_banker', rank: UniversalRank.C }, undefined).stats);
  });

  it('the surface says who they are in words, and no raw stat reaches the model', () => {
    const surface = NpcSheet.surface(NpcSheet.read(SEED, person(), 1), UniversalRank.E);
    expect(surface.name).toBe('Mara Quill');
    expect(surface.alignment).toBeTruthy();
    expect(surface.rank).toBe(UniversalRank.E);
    for (const band of Object.values(surface.mind)) expect(['low', 'fair', 'high']).toContain(band);
    expect(Object.keys(surface.mind).sort()).toEqual([...MENTAL_ATTRIBUTES].sort());
  });
});

// ---------------------------------------------------------------------------
// LINE 147: THE ROUND
// ---------------------------------------------------------------------------

describe('line 147: convincing a person is a talk', () => {
  it('the menu opens the talk and rolls nothing; gifts are no longer a menu click', () => {
    const entity = person();
    stage(entity);
    const options = InteractionEngine.getAvailableInteractions(player(), entity, 1);
    expect(options.some(o => o.id === `int_talk_${entity.id}`)).toBe(true);
    expect(options.some(o => o.id.startsWith('int_gift_'))).toBe(false);
    expect(talkFrom(`int_talk_${entity.id}`, entity.id)).toBe(true);
    expect(talk().subject).toEqual({ kind: 'FIELD_PERSON', entityId: entity.id });
    expect(live(entity.id).npc!.attempts).toBe(0);
    expect(live(entity.id).npc!.disposition).toBe(30);
  });

  it('a round carries the message, the roll and what is required, on Haiku', async () => {
    const entity = person();
    stage(entity);
    const door = answering(words());
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('I can get you out of here.');
    const [, ask] = door.mock.calls[0] as [string, any];
    expect(ask.said).toBe('I can get you out of here.');
    expect(ask.roll).toBeGreaterThanOrEqual(1);
    expect(ask.roll).toBeLessThanOrEqual(100);
    expect(ask.required).toBeGreaterThan(0);
    expect(ask.who.name).toBe('Mara Quill');
    const request = buildNpcTalkRequest(ask);
    expect(MODEL_FOR[request.kind]).toBe('claude-haiku-5-5');
    const text = request.messages[0].content;
    expect(text).toContain('I can get you out of here.');
    expect(text).toContain(`"roll":${ask.roll}`);
    expect(text).toContain(`"required":${ask.required}`);
  });

  it('the band is the model\'s, and the number is the formula\'s (D57)', () => {
    expect(JUDGE_BANDS.map(b => TalkLaw.bonusOf(b))).toEqual([...JUDGE_BANDS.map(b => TalkLaw.bonusOf(b))].sort((a, b) => a - b));
    expect(TalkLaw.bonusOf('idle')).toBe(0);
    expect(TalkLaw.bonusOf('moves')).toBeGreaterThan(0);
    expect(TalkLaw.bonusOf('repels')).toBeLessThan(0);
    const schema = JSON.stringify(buildNpcTalkRequest({ who: {}, memory: [], said: 'x', roll: 1, required: 1, bonuses: {}, meter: 1 } as any).schema);
    expect(schema).not.toMatch(/"number"|"integer"/);
    for (const band of JUDGE_BANDS) expect(schema).toContain(band);
  });

  it('an aligned band moves the meter further than a band against, on the same roll', () => {
    const at = { roll: 60, required: 55, disposition: 30 };
    const moved = TalkLaw.settle({ ...at, band: 'moves' });
    const idle = TalkLaw.settle({ ...at, band: 'idle' });
    const against = TalkLaw.settle({ ...at, band: 'repels' });
    expect(moved.delta).toBeGreaterThan(idle.delta);
    expect(idle.delta).toBeGreaterThan(against.delta);
    expect(against.landed).toBe(false);
    expect(against.delta).toBeLessThan(0);
  });

  it('the meter stays 0 to 100', () => {
    expect(TalkLaw.settle({ roll: 100, required: 5, disposition: 99, band: 'moves' }).disposition).toBe(100);
    expect(TalkLaw.settle({ roll: 1, required: 95, disposition: 1, band: 'repels' }).disposition).toBe(0);
  });

  it('the roll is keyed, and the keys are on the journal', async () => {
    expect(TalkLaw.rollOf('k:1')).toBe(TalkLaw.rollOf('k:1'));
    const entity = person();
    stage(entity);
    const journal = vi.spyOn(SessionJournal, 'record');
    answering(words());
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('Come with me.');
    const row = journal.mock.calls.find(c => c[0] === 'INTERACT')![1] as any;
    expect(row).toMatchObject({ kind: 'TALK', targetId: entity.id, band: 'lands', by: 'DOOR' });
    expect(row.rollKey).toContain(entity.id);
    expect(row.roll).toBe(TalkLaw.rollOf(row.rollKey));
    expect(typeof row.required).toBe('number');
    expect(row.disposition).toBe(live(entity.id).npc!.disposition);
  });

  it('what the meter says moved is what moved, so a round at the top claims nothing', () => {
    expect(TalkLaw.settle({ roll: 100, required: 5, disposition: 100, band: 'moves' }).delta).toBe(0);
  });

  it('with no model the floor\'s line is narration, never put in their mouth', async () => {
    const entity = person();
    stage(entity);
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('Hello.');
    expect(talk().log[talk().log.length - 1].who).toBe('NOTE');
  });

  it('the menu says what a round costs', () => {
    const entity = person();
    stage(entity);
    const option = InteractionEngine.getAvailableInteractions(player(), entity, 1).find(o => o.id.startsWith('int_talk_'))!;
    expect(option.energyCost).toBe(5);
  });

  it('a tougher person asks more of the same words, by rank and by mind', () => {
    const attrs = spread({ charisma: 3 });
    const low = TalkLaw.required('GIFT', attrs, UniversalRank.F, spread());
    const high = TalkLaw.required('GIFT', attrs, UniversalRank.A, spread());
    expect(high).toBeGreaterThan(low);
    const sharp = TalkLaw.required('GIFT', attrs, UniversalRank.F, spread({ focus: 5, intelligence: 5 }));
    expect(sharp).toBeGreaterThan(low);
  });

  it('charisma still does the work it says it does', () => {
    const plain = TalkLaw.required('GIFT', spread(), UniversalRank.D, spread());
    const charming = TalkLaw.required('GIFT', spread({ charisma: 8 }), UniversalRank.D, spread());
    expect(charming).toBeLessThan(plain);
    expect(StatSystem.talkOdds('GIFT', spread({ charisma: 8 }))).toBeGreaterThan(StatSystem.talkOdds('GIFT', spread()));
  });

  it('with no key a round has no bonus, still rolls, and the meter moves', async () => {
    const entity = person();
    stage(entity);
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('Please.');
    const round = talk().rounds[0];
    expect(round.by).toBe('FLOOR');
    expect(round.band).toBe('idle');
    expect(round.bonus).toBe(0);
    expect(round.roll).toBeGreaterThanOrEqual(1);
    expect(live(entity.id).npc!.disposition).toBe(TalkLaw.settle({ roll: round.roll, required: round.required, band: 'idle', disposition: 30 }).disposition);
    expect(live(entity.id).npc!.attempts).toBe(1);
    expect(round.reply.length).toBeGreaterThan(0);
  });

  it('a refusal, a broken answer or a door that never answers all fall to the same floor', async () => {
    for (const out of [
      { status: 'REFUSED', reason: 'Declined.' },
      { status: 'OK', data: { band: 'stupendous', asked: { promise: 'keeps', harm: 'none' }, reply: 'x', wants: '' } },
      { status: 'OK', data: { band: 'lands', asked: { promise: 'keeps', harm: 'none' }, reply: '', wants: '' } },
      { status: 'CUT_OFF' }
    ]) {
      vi.spyOn(IntelligenceClient, 'npcTalk').mockResolvedValue(out as any);
      const answer = await TalkDoor.round('t', { who: NpcSheet.surface(NpcSheet.read(SEED, person(), 1), UniversalRank.E), memory: [], said: 'x', roll: 50, required: 50, bonuses: {}, meter: 30 } as any, { hidden: [] });
      expect(answer.by).toBe('FLOOR');
      expect(answer.band).toBe('idle');
    }
    vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(() => new Promise(() => {}) as any);
    const late = await TalkDoor.round('t', { who: {}, memory: [], said: 'x', roll: 50, required: 50, bonuses: {}, meter: 30 } as any, { hidden: [] }, 5);
    expect(late.by).toBe('FLOOR');
  });

  it('asking for what their alignment refuses cannot lift the meter, however well it was said', () => {
    const verdict = TalkLaw.judgeRound(words({ band: 'moves', asked: { promise: 'breaks', harm: 'none' } }), { alignment: 'lawful good', hidden: [] });
    expect(verdict.ok).toBe(true);
    expect(verdict.gated).toBe(true);
    expect(TalkLaw.bonusOf(verdict.band!)).toBeLessThan(0);
    const fine = TalkLaw.judgeRound(words({ band: 'moves', asked: { promise: 'breaks', harm: 'grave' } }), { alignment: 'chaotic evil', hidden: [] });
    expect(fine.band).toBe('moves');
    expect(fine.gated).toBe(false);
  });

  it('the disposition number is the meter, and following still reads it', async () => {
    const entity = person('ent_near', UniversalRank.F, { disposition: 69 });
    stage(entity);
    const line = StatSystem.recruitDisposition(player().attributes);
    const before = InteractionEngine.getAvailableInteractions(player(), live(entity.id), 1);
    expect(before.some(o => o.id.startsWith('int_recruit_'))).toBe(false);
    useWorldStore.getState().updateEntity(entity.id, { npc: { ...live(entity.id).npc!, disposition: line } });
    const after = InteractionEngine.getAvailableInteractions(player(), live(entity.id), 1);
    expect(after.some(o => o.id.startsWith('int_recruit_'))).toBe(true);
  });

  it('a gift stays, offered inside the talk, and the talk remembers it', async () => {
    const entity = person();
    stage(entity);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [thing({ name: 'A Cheap Thing', value: 1 })] } } }));
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    talk().give();
    expect(live(entity.id).npc!.disposition).toBeGreaterThan(30);
    expect(player().currentSession!.inventory).toHaveLength(0);
    expect(talk().log.some(l => l.text.includes('A Cheap Thing'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LINE 147: WHAT GUARDS THE BILL
// ---------------------------------------------------------------------------

describe('line 147: what guards a long talk\'s bill', () => {
  const fakeProvider = (usd = 0.001) => {
    const asked: IDoorRequest[] = [];
    return {
      asked,
      provider: {
        name: 'fake',
        status: async () => ({ available: true, provider: 'fake' }),
        ask: async (request: IDoorRequest) => { asked.push(request); return { status: 'OK', data: words(), usage: { model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd } }; },
        file: async () => ({ status: 'NO_KEY' as const }),
        collect: async () => ({ status: 'NO_KEY' as const }),
        ceiling: () => usd
      } as any
    };
  };
  const ask = (said = 'x') => buildNpcTalkRequest({ who: {}, memory: [], said, roll: 1, required: 1, bonuses: {}, meter: 1 } as any);

  it('a talk has a spend limit at the door: over it, nothing is sent', async () => {
    const { provider, asked } = fakeProvider(TALK_SPEND_LIMIT_USD / 2.5);
    const door = new IntelligenceDoor(provider);
    expect((await door.askTalk('t1', ask())).status).toBe('OK');
    expect((await door.askTalk('t1', ask())).status).toBe('OK');
    expect((await door.askTalk('t1', ask())).status).toBe('OVER_LIMIT');
    expect(asked).toHaveLength(2);
    expect((await door.askTalk('t2', ask())).status).toBe('OK');
  });

  it('a round with a little remembered is a small part of that limit on Haiku', () => {
    const provider = new ClaudeProvider({} as any);
    const full = buildNpcTalkRequest({
      who: NpcSheet.surface(NpcSheet.read(SEED, person(), 1), UniversalRank.E),
      memory: Array.from({ length: 12 }, (_, day) => ({ day, who: 'Pedro', did: 'said', what: 'y'.repeat(TALK_MESSAGE_LIMIT), toWhom: 'Mara' })),
      said: 'y'.repeat(TALK_MESSAGE_LIMIT), roll: 1, required: 1, bonuses: {}, meter: 1
    } as any);
    expect(provider.ceiling(full, false)).toBeLessThan(TALK_SPEND_LIMIT_USD / 10);
  });

  it('no count cuts what is remembered: a round that would pass the talk\'s limit is refused at the door, and nothing is sent', async () => {
    const claude = new ClaudeProvider({} as any);
    const { provider, asked } = fakeProvider();
    const door = new IntelligenceDoor({ ...provider, ceiling: (r: IDoorRequest, b: boolean) => claude.ceiling(r, b) });
    const huge = buildNpcTalkRequest({
      who: {}, said: 'x', roll: 1, required: 1, bonuses: {}, meter: 1,
      memory: Array.from({ length: 5000 }, (_, day) => ({ day, who: 'Pedro', did: 'said', what: 'y'.repeat(TALK_MESSAGE_LIMIT) }))
    } as any);
    expect((await door.askTalk('huge', huge)).status).toBe('OVER_LIMIT');
    expect(asked).toHaveLength(0);
  });

  it('what they remember goes whole and in order, with what they forgot left as "?"', () => {
    const memory = Array.from({ length: 40 }, (_, day) => ({ day, who: 'Pedro', did: `said line ${day} end`, how: day === 0 ? '?' : 'kindly' }));
    const request = buildNpcTalkRequest({ who: {}, memory, said: 'x', roll: 1, required: 1, bonuses: {}, meter: 1 } as any);
    const sent = JSON.parse(request.messages[0].content as string);
    expect(sent.memory).toEqual(memory);
    expect(sent.log).toBeUndefined();
    expect(request.system).toMatch(/"\?" is a part they have forgotten/);
  });

  it('the http door refuses a message over the size before anything is sent, and says so', async () => {
    const { provider, asked } = fakeProvider();
    const handler = createIntelligenceHandler(new IntelligenceDoor(provider), { allowRemote: true });
    const body = JSON.stringify({ talkId: 't', ask: { who: {}, memory: [], said: 'y'.repeat(TALK_MESSAGE_LIMIT + 1), roll: 1, required: 1, bonuses: {}, meter: 1 } });
    const out: any = {};
    const req: any = { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, on(event: string, fn: (b?: Buffer) => void) { if (event === 'data') fn(Buffer.from(body)); if (event === 'end') fn(); } };
    const res: any = { setHeader() {}, end(text: string) { Object.assign(out, JSON.parse(text)); } };
    await handler(req, res, '/npc/talk');
    expect(out.status).toBe('REFUSED');
    expect(asked).toHaveLength(0);
  });

  it('a round costs a person energy, so a day bounds a talk, and an empty day sends nothing', async () => {
    const entity = person();
    stage(entity);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, energy: 6 } } }));
    const door = answering(words());
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('One.');
    expect(player().currentSession!.energy).toBe(1);
    await talk().say('Two.');
    expect(door).toHaveBeenCalledTimes(1);
    expect(talk().rounds).toHaveLength(1);
  });

  it('one round at a time: a second press while one is out sends nothing', async () => {
    const entity = person();
    stage(entity);
    let release: (v: any) => void = () => {};
    const door = vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(() => new Promise(r => { release = r; }) as any);
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    const first = talk().say('One.');
    await talk().say('Two.');
    // What they remember is read before the door is asked, so the first round reaches it a moment later
    await vi.waitFor(() => expect(door).toHaveBeenCalled());
    expect(door).toHaveBeenCalledTimes(1);
    release({ status: 'OK', data: words() });
    await first;
  });

  it('walking off mid-round leaves a monster free, and leaves a city record as it was', async () => {
    const man = monster(humanoidDef());
    stage(man);
    let release: (v: any) => void = () => {};
    const out = vi.spyOn(IntelligenceClient, 'bargain').mockImplementation(() => new Promise(r => { release = r; }) as any);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    const said = talk().say('Wait.');
    await vi.waitFor(() => expect(out).toHaveBeenCalled());
    talk().close();
    release({ status: 'OK', data: words() });
    await said;
    expect(live(man.id).bargain!.holding).toBe(false);
    expect(talk().subject).toBeNull();
    expect(talk().rounds).toHaveLength(0);

    vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => ({ status: 'OK', data: goalWords({ need: ask.need }) }) as any);
    answering(words());
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    await talk().say('One.');
    const meter = talk().meter;
    const lines = talk().log.length;
    talk().close();
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(() => new Promise(r => { release = r; }) as any);
    const second = talk().say('Two.');
    await vi.waitFor(() => expect(release).toBeTruthy());
    talk().close();
    release({ status: 'OK', data: words() });
    await second;
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    expect(talk().meter).toBe(meter);
    expect(talk().log).toHaveLength(lines);
  });

  it('a person who is gone takes the talk with them', () => {
    expect(readFileSync('src/components/TalkWindow.tsx', 'utf8')).toMatch(/useEffect\(\(\) => \(\) => useTalk\.getState\(\)\.close\(\), \[\]\)/);
  });

  it('a message over the size is said to them, and sends nothing', async () => {
    const entity = person();
    stage(entity);
    const door = answering(words());
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('y'.repeat(SAID_LIMIT + 1));
    expect(door).not.toHaveBeenCalled();
    expect(talk().note).toMatch(/more than anyone can say/i);
    expect(player().currentSession!.energy).toBe(100);
  });

  it('what a talk has spent is kept and shown', async () => {
    const entity = person();
    stage(entity);
    answering(words());
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('One.');
    expect(talk().spentUsd).toBeCloseTo(0.0002);
  });

  it('the new kinds run on Haiku with no server-side fallback, at low effort', async () => {
    let params: any;
    const client = { beta: { messages: { stream: (p: any) => { params = p; return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(words()) }], usage: { input_tokens: 1, output_tokens: 1 } }) }; } } } };
    const provider = new ClaudeProvider(client as any);
    for (const request of [ask(), buildNpcGoalRequest({ binding: 'LADDER', who: {}, memory: [], rungs: [], need: 'survival', buildings: [], questTags: [] } as any), buildBargainRequest({ who: {}, memory: [], said: 'x', roll: 1, required: 1, bonuses: {}, meter: 1 } as any)]) {
      const out = await provider.ask(request);
      expect(params.model).toBe('claude-haiku-5-5');
      expect(params.fallbacks).toBeUndefined();
      expect(params.betas).toBeUndefined();
      expect(params.output_config.effort).toBe('low');
      expect(out.status).toBe('OK');
      expect(out.data).toBeTruthy();
    }
  });

  it('what a call cost counts what it wrote to the cache, so the spend limit reads the real bill', async () => {
    const client = { beta: { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(words()) }], usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 } }) }) } } };
    const out = await new ClaudeProvider(client as any).ask(ask());
    expect(out.usage!.usd).toBeCloseTo(0.125);
  });

  it('the system text is frozen and long enough to be cached; everything volatile goes in the message', () => {
    const a = buildNpcTalkRequest({ who: { name: 'A' }, memory: [], said: 'one', roll: 1, required: 1, bonuses: {}, meter: 1 } as any);
    const b = buildNpcTalkRequest({ who: { name: 'B' }, memory: [], said: 'two', roll: 9, required: 9, bonuses: {}, meter: 9 } as any);
    expect(a.system).toBe(b.system);
    // Haiku 5.5 caches from 512 tokens. Four characters a token is the safe reading of plain English.
    for (const request of [a, buildNpcGoalRequest({ binding: 'LADDER', who: {}, memory: [], rungs: [], need: 'survival', buildings: [], questTags: [] } as any), buildBargainRequest({ who: {}, memory: [], said: 'x', roll: 1, required: 1, bonuses: {}, meter: 1 } as any)]) {
      expect(request.system.length).toBeGreaterThan(512 * 4);
    }
  });

  it('with no provider the door still answers, and says why', async () => {
    const door = new IntelligenceDoor(new AbsentProvider());
    expect((await door.askTalk('t', ask())).status).toBe('NO_KEY');
  });
});

// ---------------------------------------------------------------------------
// LINE 148: A MIND, AND THE BARGAIN
// ---------------------------------------------------------------------------

describe('line 148: intelligence is a skill, and speech is reached', () => {
  it('it is a skill on the web, read through the same door as a person\'s', () => {
    const pair = WebSystem.mint(MIND_TAGS, []);
    expect(pair.id).toBe('skill_intelligent');
    expect(WebBank.current().names.some(n => n.tags.includes('intelligent'))).toBe(true);
  });

  it('a humanoid holds it by default and has reached speech', () => {
    const def = humanoidDef();
    expect(MonsterMind.holds(def)).toBe(true);
    expect(MonsterMind.speaks(def)).toBe(true);
    const mind = MonsterMind.read(SEED, monster(def), def, undefined);
    expect(mind.skill!.id).toBe('skill_intelligent');
    expect(WebSystem.masteryOf(mind.skill!).rung).toBeGreaterThanOrEqual(SPEECH_RUNG);
  });

  it('a beast does not hold it, and has no mental stats to speak of', () => {
    const def = beastDef();
    expect(MonsterMind.holds(def)).toBe(false);
    expect(MonsterMind.speaks(def)).toBe(false);
    const mind = MonsterMind.read(SEED, monster(def), def, undefined);
    expect(mind.skill).toBeNull();
    for (const attr of MENTAL_ATTRIBUTES) expect(mind.stats[attr]).toBe(0);
    expect(mind.stats.strength).toBeGreaterThan(0);
  });

  it('a kind that has come to the word holds it, and works its way up to speech by its own line', () => {
    const base = { ...beastDef(), tags: [...beastDef().tags, 'intelligent'] };
    expect(MonsterMind.holds(base)).toBe(true);
    expect(MonsterMind.speaks({ ...base, generation: 0 })).toBe(false);
    expect(MonsterMind.speaks({ ...base, generation: 8 })).toBe(true);
  });

  it('mental stats develop with the skill, and no other stat moves', () => {
    const base = { ...beastDef(), tags: [...beastDef().tags, 'intelligent'] };
    const young = MonsterMind.read(SEED, monster(base), { ...base, generation: 0 }, undefined);
    const old = MonsterMind.read(SEED, monster(base), { ...base, generation: 8 }, undefined);
    const sum = (s: IAttributes) => MENTAL_ATTRIBUTES.reduce((n, a) => n + s[a], 0);
    expect(sum(old.stats)).toBeGreaterThan(sum(young.stats));
    for (const attr of PHYSICAL_ATTRIBUTES) expect(old.stats[attr]).toBe(young.stats[attr]);
  });

  it('a line can bring the word: it is registered, so the law takes it in a changed kind\'s tags', () => {
    expect(WebBank.current().tags.some(t => t.tag === 'intelligent')).toBe(true);
    expect(readFileSync('shared/intelligence/prompts.ts', 'utf8')).toMatch(/intelligent/);
  });
});

describe('line 148: the bargain menu', () => {
  it('a right click on a speaker in reach offers the bargain; a beast offers nothing', () => {
    const man = monster(humanoidDef());
    const beast = monster(beastDef(), 'ent_beast');
    stage(man, beast);
    expect(InteractionEngine.getAvailableInteractions(player(), man, 2).some(o => o.id === `int_bargain_${man.id}`)).toBe(true);
    expect(InteractionEngine.getAvailableInteractions(player(), beast, 2).some(o => o.id.startsWith('int_bargain_'))).toBe(false);
  });

  it('nothing is said across a distance', () => {
    const man = monster(humanoidDef());
    stage(man);
    expect(InteractionEngine.getAvailableInteractions(player(), man, 30).some(o => o.id.startsWith('int_bargain_'))).toBe(false);
  });

  it('the interact key still walks past a monster: only the right click reaches it', () => {
    const man = monster(humanoidDef());
    man.position = { x: 2, y: 0 };
    stage(man);
    expect(pickInteract(player(), [man], { x: 0, z: 0 })).toBeNull();
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/int_bargain_/);
  });

  it('getting to neutral asks the same as getting a person to follow', () => {
    const attrs = spread();
    const line = StatSystem.recruitDisposition(attrs);
    expect(MonsterMind.stance(line - 1, attrs)).toBe('AGGRESSIVE');
    expect(MonsterMind.stance(line, attrs)).toBe('NEUTRAL');
    expect(MonsterMind.stance(100, attrs)).toBe('FRIENDLY');
    const led = spread({ leadership: 11 });
    expect(MonsterMind.stance(line - 1, led)).toBe('NEUTRAL');
  });

  it('an aggressive one starts where a cold person does, and a neutral kind already stands at the line', () => {
    expect(MonsterMind.startingMeter({ behavior: 'AGGRESSIVE' }, spread())).toBeLessThan(StatSystem.recruitDisposition(spread()));
    expect(MonsterMind.stance(MonsterMind.startingMeter({ behavior: 'NEUTRAL' }, spread()), spread())).toBe('NEUTRAL');
  });

  it('a bargain round uses the same number and the same roll, and goes through its own kind', async () => {
    const man = monster(humanoidDef());
    stage(man);
    expect(talkFrom(`int_bargain_${man.id}`, man.id)).toBe(true);
    expect(talk().subject).toEqual({ kind: 'MONSTER', entityId: man.id });
    await vi.waitFor(() => expect(talk().ready).toBe(true));
    const door = vi.spyOn(IntelligenceClient, 'bargain').mockResolvedValue({ status: 'OK', data: words({ band: 'moves' }) } as any);
    await talk().say('You do not have to do this.');
    expect(door).toHaveBeenCalledTimes(1);
    const body = live(man.id);
    expect(body.npc!.attempts).toBe(1);
    expect(typeof body.npc!.disposition).toBe('number');
    expect(talk().rounds[0].band).toBe('moves');
  });

  it('with no key a bargain still rolls', async () => {
    const man = monster(humanoidDef());
    stage(man);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    await talk().say('Hold.');
    expect(talk().rounds[0].by).toBe('FLOOR');
    expect(talk().rounds[0].bonus).toBe(0);
    expect(live(man.id).npc!.attempts).toBe(1);
  });

  it('its stance stands on the body, and a talked-round monster stops coming for you', () => {
    const def = humanoidDef();
    const body = { ...monster(def), bargain: { stance: 'NEUTRAL' as const } };
    expect(MonsterMind.behaviorOf(body, def.behavior)).toBe('NEUTRAL');
    const cold = { ...monster(def), bargain: { stance: 'AGGRESSIVE' as const } };
    expect(MonsterMind.behaviorOf(cold, def.behavior)).toBe(def.behavior);
    expect(MonsterMind.behaviorOf(monster(def), def.behavior)).toBe(def.behavior);
    expect(readFileSync('src/entities/mob/ai/MobAI.ts', 'utf8')).toMatch(/MonsterMind\.behaviorOf/);
  });

  it('harming one ends it: the talk refuses and what it was stands again', async () => {
    const man = monster(humanoidDef());
    stage(man);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    MobAI.provoke(man.id);
    await talk().say('Wait.');
    expect(talk().rounds).toHaveLength(0);
    expect(talk().note).toMatch(/talking/i);
    expect(MonsterMind.behaviorOf({ ...man, bargain: { stance: 'NEUTRAL' } }, 'AGGRESSIVE', true)).toBe('AGGRESSIVE');
  });

  it('the one you are bargaining with holds while you talk, and closing the window lets it go', async () => {
    const man = monster(humanoidDef());
    stage(man);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    expect(live(man.id).bargain!.holding).toBe(true);
    talk().close();
    expect(live(man.id).bargain!.holding).toBe(false);
  });

  it('what it wants comes out only once it is friendly', async () => {
    const man = monster(humanoidDef());
    stage(man);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    vi.spyOn(IntelligenceClient, 'bargain').mockResolvedValue({ status: 'OK', data: words({ wants: 'The old road, unwatched.' }) } as any);
    await talk().say('What do you want?');
    expect(talk().wants).toBeNull();
    useWorldStore.getState().updateEntity(man.id, { npc: { ...live(man.id).npc!, disposition: 99 } });
    await talk().say('What do you want?');
    expect(talk().wants).toBe('The old road, unwatched.');
    expect(MonsterMind.wantOf(live(man.id))).toBe('The old road, unwatched.');
  });

  it('its own words replace what its sheet said, and then they stand', async () => {
    const man = monster(humanoidDef());
    stage(man);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    useWorldStore.getState().updateEntity(man.id, { npc: { ...live(man.id).npc!, disposition: 99 } });
    await talk().say('Well?');
    expect(talk().wants).toBe(MonsterMind.floorWant(live(man.id).npc!));
    vi.spyOn(IntelligenceClient, 'bargain').mockResolvedValue({ status: 'OK', data: words({ wants: 'First answer.' }) } as any);
    await talk().say('Well?');
    expect(talk().wants).toBe('First answer.');
    vi.spyOn(IntelligenceClient, 'bargain').mockResolvedValue({ status: 'OK', data: words({ wants: 'Second answer.' }) } as any);
    await talk().say('Well?');
    expect(talk().wants).toBe('First answer.');
  });

  it('a humanoid who has reached speech has a real mind, not the rank\'s floor everywhere', () => {
    const def = humanoidDef();
    const bands = new Set(Array.from({ length: 30 }, (_, i) => {
      const body = { ...monster(def, `m${i}`), rank: UniversalRank.D };
      const mind = MonsterMind.read(SEED, body, def).stats;
      return Object.values(NpcSheet.surface({ ...NpcSheet.read(SEED, body, undefined), stats: mind }, UniversalRank.D).mind);
    }).flat());
    expect(bands.size).toBeGreaterThan(1);
  });

  it('with no key a friendly one still tells what it wants, from its sheet', () => {
    const man = monster(humanoidDef());
    expect(MonsterMind.floorWant(NpcSheet.read(SEED, { ...man, npc: { name: '', temperament: 'PASSIVE', objective: 'HOARD', want: 'GOLD', disposition: 0, attempts: 0 } }, undefined)).length).toBeGreaterThan(0);
  });

  it('its name stays masked: not sent to the model, and an answer that says it is refused (D60)', async () => {
    const def = humanoidDef();
    const man = monster(def);
    stage(man);
    const door = vi.spyOn(IntelligenceClient, 'bargain').mockResolvedValue({ status: 'OK', data: words({ reply: `I am the ${def.name}.` }) } as any);
    await talk().open({ kind: 'MONSTER', entityId: man.id });
    await talk().say('Who are you?');
    const [, ask] = door.mock.calls[0] as [string, any];
    expect(JSON.stringify(ask)).not.toContain(def.name);
    expect(talk().rounds[0].by).toBe('FLOOR');
    expect(talk().title).not.toContain(def.name);
    expect(talk().rounds[0].reply).not.toContain(def.name);
  });

  it('a keeper, a person, or a monster each get their own kind at the door', () => {
    expect(MODEL_FOR.npc_talk).toBe('claude-haiku-5-5');
    expect(MODEL_FOR.npc_goal).toBe('claude-haiku-5-5');
    expect(MODEL_FOR.bargain).toBe('claude-haiku-5-5');
  });
});

describe('line 148: speech bubbles, in gibberish', () => {
  it('a speaker speaks on occasion, keyed, and is quiet in between', () => {
    const at = (t: number) => bubbleOf('ent_a', t);
    const said = Array.from({ length: 400 }, (_, i) => at(i * 1000));
    const speaking = said.filter(Boolean).length;
    expect(speaking).toBeGreaterThan(0);
    expect(speaking).toBeLessThan(said.length);
    expect(at(123456)).toEqual(bubbleOf('ent_a', 123456));
  });

  it('what it says is gibberish, keyed, in pronounceable pieces', () => {
    expect(gibberish('k')).toBe(gibberish('k'));
    expect(gibberish('k')).not.toBe(gibberish('other'));
    expect(gibberish('k')).toMatch(/^[a-z ]+$/);
  });

  it('the font face is a real font, built from keyed strokes and no file', () => {
    const face = buildGibberishFace();
    const view = new DataView(face.buffer, face.byteOffset, face.byteLength);
    expect(view.getUint32(0)).toBe(0x00010000);
    const count = view.getUint16(4);
    const tags = Array.from({ length: count }, (_, i) => String.fromCharCode(...face.slice(12 + i * 16, 16 + i * 16)));
    expect(tags.sort()).toEqual(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'].sort());
    expect(Array.from(buildGibberishFace())).toEqual(Array.from(face));
    expect(GIBBERISH_FAMILY).toBeTruthy();
  });

  it('every table\'s checksum and offset holds', () => {
    const face = buildGibberishFace();
    const view = new DataView(face.buffer, face.byteOffset, face.byteLength);
    const count = view.getUint16(4);
    for (let i = 0; i < count; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(...face.slice(rec, rec + 4));
      const offset = view.getUint32(rec + 8);
      const length = view.getUint32(rec + 12);
      expect(offset % 4).toBe(0);
      expect(offset + length).toBeLessThanOrEqual(face.byteLength);
      if (tag === 'head') continue;
      let sum = 0;
      for (let at = 0; at < Math.ceil(length / 4); at++) sum = (sum + view.getUint32(offset + at * 4)) >>> 0;
      expect(sum, tag).toBe(view.getUint32(rec + 4));
    }
  });

  it('the field draws them', () => {
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/drawSpeech/);
  });
});

// ---------------------------------------------------------------------------
// LINE 149: THE LADDER, THE GOAL, ALIGNMENT
// ---------------------------------------------------------------------------

describe('line 149: the needs ladder', () => {
  const full = () => ({ needs: { survival: 90, safety: 90, belonging: 90, esteem: 90, purpose: 90 }, day: 0 });

  it('reads in Pedro\'s order: fed, a house, more money than they need, a spouse and children, then the goal', () => {
    expect(LADDER.map(r => r.need)).toEqual(['survival', 'safety', 'esteem', 'belonging', 'purpose']);
    expect(LADDER).toHaveLength(NEEDS.length);
    expect(new Set(LADDER.map(r => r.need)).size).toBe(NEEDS.length);
  });

  it('the rung is the first not met', () => {
    expect(NpcAgenda.rung({ ...full(), needs: { ...full().needs, survival: 10 } }).need).toBe('survival');
    expect(NpcAgenda.rung({ ...full(), needs: { ...full().needs, safety: 10, esteem: 10 } }).need).toBe('safety');
    expect(NpcAgenda.rung(full()).need).toBe('purpose');
  });

  it('what is known of them outranks the number', () => {
    const agenda = full();
    expect(NpcAgenda.rung(agenda, { house: false }).need).toBe('safety');
    expect(NpcAgenda.rung({ ...agenda, needs: { ...agenda.needs, safety: 0 } }, { house: true }).need).toBe('purpose');
    expect(NpcAgenda.rung(agenda, { house: true, money: false }).need).toBe('esteem');
    expect(NpcAgenda.rung(agenda, { house: true, money: true, family: false }).need).toBe('belonging');
  });

  it('a person\'s own goal comes only on the top rung, and the vendor\'s reading does not move', () => {
    expect(NpcAgenda.mayChase({ ...full(), needs: { ...full().needs, esteem: 10 } })).toBe(false);
    expect(NpcAgenda.mayChase(full())).toBe(true);
    expect(NpcAgenda.pressing({ ...full(), needs: { ...full().needs, belonging: 10, esteem: 10 } })).toBe('belonging');
  });

  it('it stays pure: the same days reach the same rung', () => {
    const fresh = NpcAgenda.fresh(0);
    expect(NpcAgenda.rung(NpcAgenda.fold(fresh, 9)).need).toBe(NpcAgenda.rung(NpcAgenda.fold(NpcAgenda.fold(fresh, 4), 9)).need);
  });
});

describe('line 149: alignment refuses, and there is no crime in code', () => {
  it('the axes read an action\'s own bands: no table of refusals', () => {
    expect(Alignment.refuses('lawful good', { promise: 'bends', harm: 'none' })).toBeTruthy();
    expect(Alignment.refuses('lawful evil', { promise: 'keeps', harm: 'grave' })).toBeNull();
    expect(Alignment.refuses('chaotic good', { promise: 'breaks', harm: 'none' })).toBeNull();
    expect(Alignment.refuses('chaotic good', { promise: 'keeps', harm: 'some' })).toBeTruthy();
    expect(Alignment.refuses('true neutral', { promise: 'bends', harm: 'some' })).toBeNull();
    expect(Alignment.refuses('true neutral', { promise: 'breaks', harm: 'none' })).toBeTruthy();
    expect(Alignment.refuses('true neutral', { promise: 'keeps', harm: 'grave' })).toBeTruthy();
    expect(Alignment.refuses('chaotic evil', { promise: 'breaks', harm: 'grave' })).toBeNull();
    expect([...PROMISE_BANDS, ...HARM_BANDS].length).toBe(6);
  });

  it('the law\'s files hold no crime: no bounty, no guards, no sentence, no infamy yet', () => {
    for (const file of ['shared/logic/systems/Alignment.ts', 'src/logic/systems/TalkLaw.ts', 'shared/logic/systems/TalkTypes.ts', 'src/logic/systems/TalkDoor.ts', 'src/entities/interaction/talkStore.ts']) {
      // His words are quoted in the comments. What is read here is the code.
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\bcrime|\bcriminal|\bbounty|\bguards?\b|\bjail|\bsentence|\binfamy/i);
    }
  });
});

describe('line 149: the goal is set before the answer', () => {
  const openKeeper = async () => { await talk().open({ kind: 'CITY', npcId: 'npc_banker' }); };

  it('in the city the goal is asked first, with what was said, what they remember and the sheet, and the answer knows it', async () => {
    const order: string[] = [];
    const goalDoor = vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => {
      order.push('goal');
      expect(ask.who.name).toBe('Marcus Goldweave');
      expect(ask.said).toBe('Good morning.');
      expect(Array.isArray(ask.memory)).toBe(true);
      return { status: 'OK', data: goalWords({ need: ask.need, goal: 'Stay ahead of the rent.' }) } as any;
    });
    const talkDoor = vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(async (_id: string, ask: any) => {
      order.push('talk');
      expect(ask.goal).toBe('Stay ahead of the rent.');
      return { status: 'OK', data: words() } as any;
    });
    await openKeeper();
    await talk().say('Good morning.');
    expect(order).toEqual(['goal', 'talk']);
    expect(goalDoor).toHaveBeenCalledTimes(1);
    expect(talkDoor).toHaveBeenCalledTimes(1);
    expect(talk().goal!.text).toBe('Stay ahead of the rent.');
  });

  it('in the field no goal is asked: a round is one call', async () => {
    const entity = person();
    stage(entity);
    const goalDoor = vi.spyOn(IntelligenceClient, 'npcGoal');
    answering(words());
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('Hello.');
    expect(goalDoor).not.toHaveBeenCalled();
  });

  it('a goal stands until the person\'s rung moves, so a long talk does not pay for it twice', async () => {
    const goalDoor = vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => ({ status: 'OK', data: goalWords({ need: ask.need }) }) as any);
    answering(words());
    await openKeeper();
    await talk().say('One.');
    await talk().say('Two.');
    expect(goalDoor).toHaveBeenCalledTimes(1);
  });

  it('it comes back after a reload, on the record', async () => {
    vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => ({ status: 'OK', data: goalWords({ need: ask.need, goal: 'Kept goal.' }) }) as any);
    answering(words());
    await openKeeper();
    await talk().say('One.');
    const meter = talk().meter;
    talk().close();
    useTalk.setState(useTalk.getInitialState(), true);
    await openKeeper();
    expect(talk().goal!.text).toBe('Kept goal.');
    expect(talk().meter).toBe(meter);
    expect(talk().log.length).toBeGreaterThan(0);
  });

  it('a goal off the ladder is refused, and the rung\'s plain goal stands instead', () => {
    const ask: any = { binding: 'LADDER', need: 'survival', who: { alignment: 'true neutral' }, memory: [], rungs: [], buildings: [], questTags: [], mayPost: true, mayAsk: true };
    expect(TalkLaw.judgeGoal(goalWords({ need: 'purpose' }), ask).ok).toBe(false);
    expect(TalkLaw.judgeGoal(goalWords({ need: 'survival' }), ask).ok).toBe(true);
    const floor = TalkLaw.floorGoal(ask);
    expect(floor.need).toBe('survival');
    expect(floor.goal.length).toBeGreaterThan(0);
    expect(floor.quest).toBeNull();
  });

  it('a goal whose means their alignment refuses is refused', () => {
    const ask: any = { binding: 'LADDER', need: 'survival', who: { alignment: 'lawful good' }, memory: [], rungs: [], buildings: [], questTags: [], mayPost: true, mayAsk: true };
    expect(TalkLaw.judgeGoal(goalWords({ means: { promise: 'breaks', harm: 'none' } }), ask).ok).toBe(false);
    expect(TalkLaw.judgeGoal(goalWords({ means: { promise: 'keeps', harm: 'some' } }), ask).ok).toBe(false);
    const rogue = { ...ask, who: { alignment: 'chaotic evil' } };
    expect(TalkLaw.judgeGoal(goalWords({ means: { promise: 'breaks', harm: 'grave' } }), rogue).ok).toBe(true);
  });

  it('a person acts for their own gain: the prompt says so, and the words never mention a law', () => {
    const request = buildNpcGoalRequest({ binding: 'LADDER', who: {}, memory: [], rungs: [], need: 'survival', buildings: [], questTags: [] } as any);
    expect(request.kind).toBe('npc_goal');
    expect(request.system).toMatch(/own gain/i);
    expect(request.system).not.toMatch(/\bcrime|\bcriminal/i);
  });

  it('a goal nothing answered asks again when something can, and one that cost money does not', async () => {
    await openKeeper();
    await talk().say('One.');
    expect(talk().goal!.by).toBe('FLOOR');
    const door = vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => ({ status: 'OK', data: goalWords({ need: ask.need, goal: 'Now it has a voice.' }) }) as any);
    await talk().say('Two.');
    expect(talk().goal!.text).toBe('Now it has a voice.');
    await talk().say('Three.');
    expect(door).toHaveBeenCalledTimes(1);
  });

  it('with no key the goal is the rung\'s plain one and the round still rolls', async () => {
    await openKeeper();
    await talk().say('Good morning.');
    expect(talk().goal!.by).toBe('FLOOR');
    expect(talk().rounds[0].by).toBe('FLOOR');
    expect(NEEDS as readonly string[]).toContain(talk().goal!.need);
  });

  it('a resident reads their house off the record', async () => {
    const resident = await residentNamed();
    await talk().open({ kind: 'CITY', npcId: resident.id });
    await talk().say('Hello.');
    // No house yet, whatever the number says: the rung is below a house or at it.
    expect(['survival', 'safety']).toContain(talk().goal!.need);
  });

  it('the seam a leader\'s weekly call uses: no ladder, a choice of its own goals', () => {
    const ask = TalkLaw.leaderAsk({ stats: spread(), temperament: 'cruel', drive: 'power', goal: 'take' } as any, ['take', 'grow', 'settle', 'hunt']);
    expect(ask.binding).toBe('FREE');
    expect(TalkLaw.judgeGoal(goalWords({ need: 'purpose', goal: 'take' }), ask).ok).toBe(true);
    expect(TalkLaw.judgeGoal(goalWords({ need: 'purpose', goal: 'dance' }), ask).ok).toBe(false);
    expect(buildNpcGoalRequest(ask).kind).toBe('npc_goal');
    expect(TalkLaw.floorGoal(ask).goal).toBe('take');
  });
});

// ---------------------------------------------------------------------------
// PEDRO, AFTER THE FIRST REPORT: the city center's keepers are the tech web
// "the city charges weekly as tax on upkeep, and, it charges for the services in the city center.
// That's where it taxes. And believe me, you can add infinite value to the city center because
// those NPC are the tech web, they can use the full aggregate you built and not make you walk around"
// ---------------------------------------------------------------------------

describe("the city center's keepers are the tech web", () => {
  const bond = () => NpcSheet.read(SEED, { id: 'person_tech', rank: UniversalRank.C, npc: { name: 'Serin Vale', temperament: 'COWARD', objective: 'HOARD', want: 'GIFT', disposition: 60, attempts: 0 } }, WebBank.version());
  const builtUp = () => {
    const skills = bond().skills!;
    const { web } = WebSystem.admit({ nodes: {} }, { uid: 'someone', name: 'Someone' }, skills, 1);
    useHubStore.setState({ web });
    return Object.keys(skills).map(id => WebSystem.nameOf(id));
  };

  it('a keeper speaks for all the hub has built, whoever built it', async () => {
    const names = builtUp();
    expect(names.length).toBeGreaterThan(0);
    const door = answering(words());
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    await talk().say('What can this city do?');
    const [, ask] = door.mock.calls[0] as [string, any];
    for (const name of names) expect(ask.who.city.knows).toContain(name);
    expect(ask.who.city.opens).toEqual(WebSystem.openStationsOf(hub().web, {}).map(s => s.name));
  });

  it('it grows as the hub does, with no list of its own', async () => {
    const door = answering(words());
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    await talk().say('Before.');
    expect((door.mock.calls[0][1] as any).who.city.knows).toHaveLength(0);
    const names = builtUp();
    await talk().say('After.');
    expect((door.mock.calls[1][1] as any).who.city.knows.length).toBe(names.length);
  });

  it('the door a counter can read: everything the center can reach', () => {
    builtUp();
    const reach = hub().centerReach();
    expect(reach.skills).toEqual(Object.keys(hub().web.nodes));
    expect(reach.stations).toEqual(WebSystem.openStationsOf(hub().web, {}));
  });

  it("a resident knows only what their own hands know: the center is the keepers'", async () => {
    builtUp();
    const resident = await residentNamed();
    const door = answering(words());
    await talk().open({ kind: 'CITY', npcId: resident.id });
    await talk().say('What can you do?');
    expect((door.mock.calls[0][1] as any).who.city).toBeUndefined();
  });

  it("the keeper does not send anyone walking, and does not promise what is the counter's to do", () => {
    const { system } = buildNpcTalkRequest({ who: {}, memory: [], said: 'x', roll: 1, required: 1, bonuses: {}, meter: 1 } as any);
    expect(system).toMatch(/never send them/i);
    expect(system).toMatch(/counter/i);
  });

  it('a talk is not where the city taxes: rounds move no gold', async () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 500 } } }));
    answering(words());
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    await talk().say('One.');
    await talk().say('Two.');
    expect(player().bank.gold).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// LINE 150: QUESTS AND BUILDINGS
// ---------------------------------------------------------------------------

// C3: a lodger's own want goes up on arrival, and a want is paid from their wallet. These bars are about the one a talk posts.
const onTheBoard = (id: string) => useHubStore.setState(st => ({ wallets: { ...st.wallets, [id]: 100000 }, guild: { ...st.guild, quests: st.guild.quests.filter(q => q.residentId !== id) } }));

describe('line 150: a person posts a quest and asks for a building', () => {
  const quest = { tag: 'building', size: 'small', text: 'Could use some timber for the back room.' };

  it('the words post a quest on the Hall\'s board; the formula writes how many and what it pays', async () => {
    const resident = await residentNamed();
    onTheBoard(resident.id);
    vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => ({ status: 'OK', data: goalWords({ need: ask.need, quest }) }) as any);
    answering(words());
    await talk().open({ kind: 'CITY', npcId: resident.id });
    await talk().say('What do you need?');
    const posted = hub().guild.quests.find(q => q.residentId === resident.id)!;
    expect(posted.text).toBe(quest.text);
    expect(posted.tag).toBe('building');
    expect(posted.count).toBe(TalkLaw.questCount('small', UniversalRank.D));
    expect(posted.state).toBe('OPEN');
  });

  it('a bigger band asks for more, and a tougher person asks for more', () => {
    expect(TalkLaw.questCount('large', UniversalRank.F)).toBeGreaterThan(TalkLaw.questCount('small', UniversalRank.F));
    expect(TalkLaw.questCount('small', UniversalRank.A)).toBeGreaterThan(TalkLaw.questCount('small', UniversalRank.F));
  });

  it('a quest\'s words may hold no digits and must name a real tag', () => {
    const ask: any = { binding: 'LADDER', need: 'survival', who: { alignment: 'true neutral' }, memory: [], rungs: [], buildings: [], questTags: ['building'], mayPost: true, mayAsk: true };
    expect(TalkLaw.judgeGoal(goalWords({ quest: { ...quest, text: 'Bring me 900 logs.' } }), ask).ok).toBe(false);
    expect(TalkLaw.judgeGoal(goalWords({ quest: { ...quest, tag: 'not_a_tag' } }), ask).ok).toBe(false);
    expect(TalkLaw.judgeGoal(goalWords({ quest }), ask).ok).toBe(true);
  });

  it('one open at a time: a person does not stack the board', async () => {
    const resident = await residentNamed();
    await hub().postTalkQuest(resident.id, resident.name, UniversalRank.D, 'GIFT', quest as any);
    await hub().postTalkQuest(resident.id, resident.name, UniversalRank.D, 'GIFT', quest as any);
    expect(hub().guild.quests.filter(q => q.residentId === resident.id && q.state === 'OPEN')).toHaveLength(1);
  });

  it('a keeper\'s quest comes out of their own wallet, and waits past what it holds', async () => {
    await hub().postTalkQuest('npc_armor_vendor', 'A Keeper', UniversalRank.F, 'GIFT', { ...quest, size: 'small' } as any);
    const posted = hub().guild.quests.find(q => q.residentId === 'npc_armor_vendor')!;
    const given = Array.from({ length: posted.count }, () => thing());
    usePlayerStore.setState(st => ({ player: { ...st.player, bank: { ...st.player.bank, stashTabs: st.player.bank.stashTabs.map((t, n) => n === 0 ? { ...t, items: [...t.items, ...given] } : t) } } }));
    useHubStore.setState(st => ({ wallets: { ...st.wallets, npc_armor_vendor: 0 } }));
    const refused = await hub().fulfilQuest(posted.id, given.map(g => g.id));
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('It waits');
    useHubStore.setState(st => ({ wallets: { ...st.wallets, npc_armor_vendor: 100000 } }));
    expect(await hub().fulfilQuest(posted.id, given.map(g => g.id))).toEqual({ ok: true });
    expect(hub().wallets.npc_armor_vendor).toBeLessThan(100000);
  });

  it('a resident\'s quest is met through the Hall\'s own door', async () => {
    const resident = await residentNamed();
    onTheBoard(resident.id);
    await hub().postTalkQuest(resident.id, resident.name, UniversalRank.F, 'GIFT', { ...quest, size: 'small' } as any);
    const posted = hub().guild.quests.find(q => q.residentId === resident.id)!;
    const given = Array.from({ length: posted.count }, () => thing());
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...given] } : t) } } }));
    const { Treasury } = await import('../src/logic/economy/Treasury');
    vi.spyOn(Treasury, 'balance').mockResolvedValue(100000);
    expect(await hub().fulfilQuest(posted.id, given.map(i => i.id))).toEqual({ ok: true });
    expect(hub().guild.quests.find(q => q.id === posted.id)!.state).toBe('DONE');
  });

  it('a keeper\'s quest is met through the same door, with no resident behind it', async () => {
    await hub().postTalkQuest('npc_banker', 'Marcus Goldweave', UniversalRank.F, 'GIFT', quest as any);
    const posted = hub().guild.quests.find(q => q.residentId === 'npc_banker')!;
    expect(posted.askerName).toBe('Marcus Goldweave');
    const given = Array.from({ length: posted.count }, () => thing());
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...given] } : t) } } }));
    const { Treasury } = await import('../src/logic/economy/Treasury');
    vi.spyOn(Treasury, 'balance').mockResolvedValue(100000);
    expect(await hub().fulfilQuest(posted.id, given.map(i => i.id))).toEqual({ ok: true });
  });

  it('a vendor who asked keeps what was brought, to look over like anything else they take in', async () => {
    await hub().postTalkQuest('npc_weapon_vendor', 'A Vendor', UniversalRank.F, 'GIFT', quest as any);
    const posted = hub().guild.quests.find(q => q.residentId === 'npc_weapon_vendor')!;
    const given = Array.from({ length: posted.count }, () => thing());
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...given] } : t) } } }));
    const { Treasury } = await import('../src/logic/economy/Treasury');
    vi.spyOn(Treasury, 'balance').mockResolvedValue(100000);
    expect(hub().vendors.npc_weapon_vendor).toBeTruthy();
    await hub().fulfilQuest(posted.id, given.map(i => i.id));
    expect(hub().vendors.npc_weapon_vendor.held.map(i => i.id)).toEqual(given.map(i => i.id));
  });

  it('a building ask is on the record, in the person\'s words, where C5 can read it', async () => {
    const resident = await residentNamed();
    vi.spyOn(IntelligenceClient, 'npcGoal').mockImplementation(async (_id: string, ask: any) => {
      expect(ask.buildings.length).toBeGreaterThan(0);
      return { status: 'OK', data: goalWords({ need: ask.need, building: ask.buildings[0] }) } as any;
    });
    answering(words());
    await talk().open({ kind: 'CITY', npcId: resident.id });
    await talk().say('What do you need?');
    const open = hub().openBuildingAsks();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ askerId: resident.id, askerName: resident.name, state: 'OPEN' });
    expect(open[0].building).toBeTruthy();
    expect(open[0].goal).toBeTruthy();
    await hub().meetBuildingAsk(open[0].id, 'lot_1');
    expect(hub().openBuildingAsks()).toHaveLength(0);
    expect(hub().guild.asks!.find(a => a.id === open[0].id)!.metBy).toBe('lot_1');
  });

  it('only a building the hub can name, and one open at a time', async () => {
    const ask: any = { binding: 'LADDER', need: 'survival', who: { alignment: 'true neutral' }, memory: [], rungs: [], buildings: ['bench'], questTags: [], mayPost: true, mayAsk: true };
    expect(TalkLaw.judgeGoal(goalWords({ building: 'palace' }), ask).ok).toBe(false);
    expect(TalkLaw.judgeGoal(goalWords({ building: 'bench' }), ask).ok).toBe(true);
    await hub().askForBuilding('npc_banker', 'Marcus Goldweave', 'bench', 'Stay ahead.', 'survival');
    await hub().askForBuilding('npc_banker', 'Marcus Goldweave', 'bench', 'Stay ahead.', 'survival');
    expect(hub().openBuildingAsks()).toHaveLength(1);
  });

  it('both survive a reload of the hub', async () => {
    await hub().askForBuilding('npc_banker', 'Marcus Goldweave', 'bench', 'Stay ahead.', 'survival');
    await hub().postTalkQuest('npc_banker', 'Marcus Goldweave', UniversalRank.F, 'GIFT', quest as any);
    await hub().loadHub(HUB);
    expect(hub().openBuildingAsks()).toHaveLength(1);
    expect(hub().guild.quests.some(q => q.residentId === 'npc_banker')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A PERSON'S ROAD, after leg 1 (Q18, Q19, Q20, Q50). Registered before the build.
// ---------------------------------------------------------------------------

const openWant = (residentId: string) => hub().guild.quests.find(q => q.residentId === residentId && q.state === 'OPEN');
const residentOf = (id: string) => hub().guild.residents.find(r => r.id === id)!;

/** Home on free ground, with what was owed of them cleared, as the house rising would leave them. */
const homeAt = (id: string) => {
  const lot = hub().lots.find(l => !l.ownerId)!;
  useHubStore.setState(s => ({
    guild: {
      ...s.guild,
      quests: s.guild.quests.filter(q => q.residentId !== id),
      residents: s.guild.residents.map(r => r.id === id ? { ...r, lotId: lot.id, homeAt: Date.now(), wantsMet: 1 } : r)
    }
  }));
  return lot;
};

describe('Q19: one want, and it is the one the talk set', () => {
  it('a lodger\'s want on the board answers the rung their talk names', async () => {
    const resident = await residentNamed();
    const quest = openWant(resident.id)!;
    await talk().open({ kind: 'CITY', npcId: resident.id });
    await talk().say('What would help?');
    expect(talk().goal!.need).toBe('safety');
    expect(quest.need).toBe(talk().goal!.need);
    expect(houseTags()).toContain(quest.tag);
    // The board reads the goal from the person, not only from the talk's own record.
    expect(residentOf(resident.id).goal).toMatchObject({ need: 'safety', text: talk().goal!.text });
  });

  it('home, the next want follows the rung they stand on', async () => {
    const resident = await residentNamed();
    homeAt(resident.id);
    const later = worldDay() + 2;
    await hub().resolveWants(later);
    const quest = openWant(resident.id)!;
    const rung = residentRung(residentOf(resident.id), residentFacts(residentOf(resident.id), hub().wallets[resident.id] ?? 0), later);
    expect(rung.need).not.toBe('safety');
    expect(quest.need).toBe(rung.need);
  });

  it('every rung asks for something the hub has a word for', async () => {
    const resident = await residentNamed();
    const sheet = NpcSheet.fromBond(bondOf())!;
    const known = new Set(WebBank.current().tags.map(t => t.tag));
    for (const rung of LADDER) {
      const want = wantFor(resident, sheet, HUB, 0, rung.need);
      expect(want.count, rung.need).toBeGreaterThan(0);
      expect(known.has(want.tag), `${rung.need}: ${want.tag}`).toBe(true);
    }
  });

  it('the window shows the want the board holds beside their goal', () => {
    const src = readFileSync('src/components/TalkWindow.tsx', 'utf8');
    expect(src).toMatch(/ON THE BOARD/);
  });
});

describe('Q20: after the house, their wallet is paid for work and pays for living', () => {
  it('home with a trade, the Hall pays them a day of their work, on its books', async () => {
    const resident = await residentNamed();
    homeAt(resident.id);
    const line = hub().runningBook().lines.find(l => l.who === resident.id);
    expect(line, 'a line for their work').toBeTruthy();
    expect(line!.why).toBe('WORK');
    expect(line!.amount).toBe(residentWagePerDay(resident.bond.rank));
    const before = hub().wallets[resident.id];
    await hub().resolveRunning(worldDay() + 1);
    expect(hub().wallets[resident.id]).toBe(before + line!.amount);
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('a lodger has no trade to be paid for yet', async () => {
    const resident = await residentNamed();
    expect(hub().runningBook().lines.some(l => l.who === resident.id)).toBe(false);
  });

  it('they pay for their living out of their own wallet, to whoever feeds them, and stay fed', async () => {
    const resident = await residentNamed();
    const wallet = hub().wallets[resident.id];
    const mags = hub().wallets.npc_bartender;
    await hub().resolveLiving(worldDay() + 3);
    const cost = 3 * livingPerDay(resident.bond.rank);
    expect(hub().wallets[resident.id]).toBe(wallet - cost);
    expect(hub().wallets.npc_bartender).toBe(mags + cost);
    expect(residentRung(residentOf(resident.id), residentFacts(residentOf(resident.id), wallet - cost), worldDay() + 3).need).toBe('safety');
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);

    homeAt(resident.id);
    const seller = hub().wallets.npc_alchemist;
    await hub().resolveLiving(worldDay() + 4);
    expect(hub().wallets.npc_alchemist).toBe(seller + livingPerDay(resident.bond.rank));
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });

  it('what they cannot pay they go without, nobody covers it, and hunger is the rung', async () => {
    const resident = await residentNamed();
    homeAt(resident.id);
    // Their coin spent elsewhere, on the record: the fold reads wallets from the database, not the screen.
    const all = hub().wallets[resident.id];
    await GoldCommit.commit({
      player: usePlayerStore.getState().player,
      rows: [{ type: 'TRADE', data: { kind: 'TEST_SPENT', playerDelta: 0, treasuryDelta: 0, wallets: { [resident.id]: -all } } }],
      wallets: { hubId: HUB, deltas: { [resident.id]: -all } }
    });
    await hub().settleWallets();
    expect(hub().wallets[resident.id]).toBe(0);
    const seller = hub().wallets.npc_alchemist;
    const later = worldDay() + 6;
    await hub().resolveLiving(later);
    expect(hub().wallets.npc_alchemist).toBe(seller);
    expect(residentRung(residentOf(resident.id), residentFacts(residentOf(resident.id), 0), later).need).toBe('survival');
    await hub().resolveWants(later);
    expect(openWant(resident.id)!.need).toBe('survival');
  });

  it('it is folded once: the same days are not paid twice, and it comes back after a reload', async () => {
    const resident = await residentNamed();
    await hub().resolveLiving(worldDay() + 2);
    const after = hub().wallets[resident.id];
    await hub().resolveLiving(worldDay() + 2);
    expect(hub().wallets[resident.id]).toBe(after);
    await hub().loadHub(HUB);
    expect(residentOf(resident.id).livedDay).toBe(worldDay() + 2);
  });

  // C4 (leg 2), by Q39: over two days in the city Orrin's food went unpaid and no meeting with the feeder was
  // queued; the next load made the days up at once. The midnight fold folds their living too.
  it('the midnight fold, while the person stays in the city, folds their living as a load would', async () => {
    const resident = await residentNamed();
    const day = worldDay();
    const wallet = hub().wallets[resident.id];
    vi.spyOn(Date, 'now').mockImplementation(() => (day + 1) * 86_400_000 + 1_000);
    await hub().turnTheDay();
    expect(residentOf(resident.id).livedDay).toBe(day + 1);
    expect(hub().wallets[resident.id]).toBe(wallet - livingPerDay(resident.bond.rank));
    expect((await GoldAudit.run(usePlayerStore.getState().player)).ok).toBe(true);
  });
});

describe('Q20: walked to by goals', () => {
  const layout = HubGenerator.generate();
  const walkable = (x: number, y: number) => !!layout.navMesh[y]?.[x];
  const lot = layout.zones.flatMap(z => z.pois).find(p => p.type === POIType.PLAYER_LOT)!;
  const poiOf = (type: POIType) => layout.zones.flatMap(z => z.pois).find(p => p.type === type)!;
  const step = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  const beside = (stop: { x: number; y: number }, door: { x: number; y: number }) => step(stop, door) >= 2 && step(stop, door) <= 4;

  it('from their door to whoever feeds them, to where their rung sends them, and home again', () => {
    const route = ResidentDay.route(layout, walkable, { homeLotId: lot.id, need: 'belonging' });
    expect(beside(route.tiles[0], doorOf(lot))).toBe(true);
    expect(route.tiles[route.tiles.length - 1]).toEqual(route.tiles[0]);
    expect(route.tiles).toContainEqual(doorOf(lot));
    const stops = route.stops.map(i => route.tiles[i]);
    expect(stops.some(t => beside(t, doorOf(poiOf(POIType.VENDOR_CONSUMABLES))))).toBe(true);
    expect(stops.some(t => beside(t, doorOf(poiOf(POIType.TAVERN))))).toBe(true);
    for (let i = 1; i < route.tiles.length; i++) expect(step(route.tiles[i - 1], route.tiles[i])).toBeLessThanOrEqual(1);
    for (const t of route.tiles) expect(walkable(t.x, t.y), `${t.x},${t.y}`).toBe(true);
  });

  it('found by playing: someone waiting at a door leaves it free, so the door still answers the interact key', () => {
    for (const need of ['survival', 'esteem', 'belonging', 'purpose'] as const) {
      const route = ResidentDay.route(layout, walkable, { homeLotId: lot.id, need });
      const doors = [lot, ...layout.zones.flatMap(z => z.pois).filter(p => p.npcId)].map(doorOf);
      for (const i of route.stops) {
        const at = { x: route.tiles[i].x + 0.5, y: route.tiles[i].y + 0.5 };
        for (const door of doors) expect(ResidentDay.personInReach([{ id: 'r', at }], door), `${need} waits in reach of ${door.x},${door.y}`).toBeNull();
      }
    }
  });

  it('the rung chooses the place: a different rung, a different door', () => {
    const places = LADDER.map(r => ResidentDay.placeOf(r.need));
    expect(new Set(places).size).toBe(places.length);
  });

  it('where they are is the clock\'s: the same on every machine, on the route, and moving', () => {
    const route = ResidentDay.route(layout, walkable, { homeLotId: lot.id, need: 'esteem' });
    const t0 = 1_800_000_000_000;
    expect(ResidentDay.whereAt(route, t0, 'res_a')).toEqual(ResidentDay.whereAt(route, t0, 'res_a'));
    const seen = new Set<string>();
    for (let t = t0; t < t0 + ResidentDay.ERRAND_MS; t += 30_000) {
      const at = ResidentDay.whereAt(route, t, 'res_a');
      const tile = { x: Math.floor(at.x), y: Math.floor(at.y) };
      expect(route.tiles.some(r => step(r, tile) <= 1)).toBe(true);
      seen.add(`${tile.x},${tile.y}`);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('a lodger stands by the tavern', () => {
    const route = ResidentDay.route(layout, walkable, { homeLotId: null, need: 'safety' });
    expect(route.tiles).toHaveLength(1);
    expect(step(route.tiles[0], doorOf(poiOf(POIType.TAVERN)))).toBeLessThanOrEqual(4);
  });
});

describe('Q18: a person at home is talked to where they are', () => {
  it('found by playing: a talk opened after their rung has moved reads the rung they stand on now, before a word is said', async () => {
    const resident = await residentNamed();
    await talk().open({ kind: 'CITY', npcId: resident.id });
    await talk().say('What would help?');
    expect(talk().goal!.need).toBe('safety');
    talk().close();
    homeAt(resident.id);
    await talk().open({ kind: 'CITY', npcId: resident.id });
    const rung = residentRung(residentOf(resident.id), residentFacts(residentOf(resident.id), hub().wallets[resident.id] ?? 0), worldDay());
    expect(talk().goal!.need).toBe(rung.need);
    // Nothing was asked of a model for it: the next round still asks, in case one can answer.
    expect(talk().goal!.unanswered).toBe(true);
  });

  it('within reach of their body you can talk, and across the street you cannot', () => {
    const people = [{ id: 'res_a', at: { x: 10.5, y: 10.5 } }, { id: 'res_b', at: { x: 30.5, y: 10.5 } }];
    expect(ResidentDay.personInReach(people, { x: 11, y: 10 })).toBe('res_a');
    expect(ResidentDay.personInReach(people, { x: 20, y: 10 })).toBeNull();
  });

  it('the city opens the talk at their body, by the interact key', () => {
    const src = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
    expect(src).toMatch(/personInReach/);
    expect(src).toMatch(/nearPersonRef\.current[\s\S]{0,200}kind: 'CITY'/);
  });
});

describe('Q50: a talk shows no cost, and asking draws out what they want', () => {
  it('the window says nothing of money, and offers the ask', () => {
    const src = readFileSync('src/components/TalkWindow.tsx', 'utf8');
    expect(src).not.toMatch(/has cost|\$\$\{/);
    expect(src).toMatch(/ASK IF THEY WANT SOMETHING/);
  });

  it('the odds are the mental stats, yours against theirs, and never sure', () => {
    const plain = TalkLaw.askRequired(spread(), spread());
    expect(TalkLaw.askRequired(spread({ intelligence: 9, perception: 9 }), spread())).toBeLessThan(plain);
    expect(TalkLaw.askRequired(spread(), spread({ intelligence: 9, focus: 9 }))).toBeGreaterThan(plain);
    // Physical stats are not what draws anyone out.
    expect(TalkLaw.askRequired(spread({ strength: 9 }), spread())).toBe(plain);
    const sharp = spread(Object.fromEntries(MENTAL_ATTRIBUTES.map(a => [a, 99])) as any);
    expect(TalkLaw.askRequired(sharp, spread())).toBeGreaterThan(1);
    expect(TalkLaw.askRequired(spread(), sharp)).toBeLessThanOrEqual(100);
  });

  it('a landed ask in the city says the want the board holds, and costs nothing', async () => {
    const resident = await residentNamed();
    const quest = openWant(resident.id)!;
    vi.spyOn(TalkLaw, 'rollOf').mockReturnValue(100);
    await talk().open({ kind: 'CITY', npcId: resident.id });
    const meter = talk().meter;
    await talk().ask();
    const said = talk().log.filter(l => l.who === 'NOTE').map(l => l.text).join(' ');
    expect(said).toContain(quest.tag.replace(/_/g, ' '));
    expect(talk().meter).toBe(meter);
  });

  it('a missed ask gives nothing away and wears on them a little', async () => {
    const resident = await residentNamed();
    vi.spyOn(TalkLaw, 'rollOf').mockReturnValue(1);
    await talk().open({ kind: 'CITY', npcId: resident.id });
    const meter = talk().meter;
    await talk().ask();
    expect(talk().meter).toBe(meter - 1);
    expect(talk().log[talk().log.length - 1].text).toMatch(/nothing away/i);
  });

  it('in the field an ask costs what a round costs, and says what they would take kindly', async () => {
    const entity = person();
    stage(entity);
    vi.spyOn(TalkLaw, 'rollOf').mockReturnValue(100);
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().ask();
    expect(player().currentSession!.energy).toBe(100 - TALK_ENERGY);
    expect(talk().log[talk().log.length - 1].text).toMatch(/gift/i);
  });

  it('a monster drawn out tells what it wants before it is friendly', async () => {
    const entity = monster(humanoidDef());
    stage(entity);
    vi.spyOn(TalkLaw, 'rollOf').mockReturnValue(100);
    await talk().open({ kind: 'MONSTER', entityId: entity.id });
    expect(talk().stance).not.toBe('FRIENDLY');
    await talk().ask();
    expect(talk().wants).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MEMORY (Pedro, 2026-11-06): what a person remembers goes in place of a tail of the log, and
// people who meet remember one another
// ---------------------------------------------------------------------------

describe('a person remembers the talk, and one another', () => {
  it('in the city, what the last round left is in what the next round sends, by name, in their words', async () => {
    const asks: any[] = [];
    vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(async (_id: string, ask: any) => {
      asks.push(ask);
      return { status: 'OK', data: words({ remember: { did: 'asked about', what: 'the price of 3 loaves', how: 'politely', why: '' } }) } as any;
    });
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    await talk().say('What does bread cost here?');
    await talk().say('And for a week of it?');
    expect(asks[0].memory).toEqual([]);
    expect(asks[0].log).toBeUndefined();
    const line = asks[1].memory.find((m: any) => m.did === 'asked about');
    expect(line).toMatchObject({ who: 'QUOIN', toWhom: 'Marcus Goldweave', how: 'politely', where: 'at their counter face to face' });
    // A number is not a slot word
    expect(line.what).toBe('the price of loaves');
    // Mounted with it: how they stand with the one talking, and what they are after
    expect(asks[0].toward).toEqual({ knows: 'stranger', open: [] });
    expect(asks[1].toward.knows).toBe('well known');
    expect(db.has(`mind_${HUB}_npc_banker`)).toBe(true);
    expect(db.has(`book_${HUB}`)).toBe(true);
  });

  it('in the field with no voice, what was said is what they keep', async () => {
    const entity = person('ent_memory_field');
    stage(entity);
    const asks: any[] = [];
    vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(async (_id: string, ask: any) => { asks.push(ask); return { status: 'NO_KEY', reason: 'No key.' } as any; });
    await talk().open({ kind: 'FIELD_PERSON', entityId: entity.id });
    await talk().say('The bridge is out to the north.');
    await talk().say('Anything else?');
    expect(asks[1].memory.some((m: any) => m.did === 'said' && m.what === 'the bridge is out to the north' && m.toWhom === 'Mara Quill')).toBe(true);
  });

  it('someone who walks to whoever feeds them is remembered by them, and remembers them', async () => {
    const resident = await residentNamed('person_memory');
    await hub().resolveLiving(worldDay() + 2);
    const today = worldDay() + 2;
    expect(await MemoryStore.regard({ hubId: HUB }, 'npc_bartender', resident.id, today)).toBeGreaterThan(0);
    expect(await MemoryStore.regard({ hubId: HUB }, resident.id, 'npc_bartender', today)).toBeGreaterThan(0);
    const mind = await MemoryStore.mind({ hubId: HUB }, resident.id, today);
    const book = (db.get(`book_${HUB}`) as any).data;
    // Two days walked to the same counter are one memory, rehearsed: the day it started, and the last day it said
    const fed = mind.memories.map(m => MemoryLaw.words(m, book)).filter(m => m.did === 'bought food from');
    expect(fed).toHaveLength(1);
    expect(fed[0]).toMatchObject({ who: resident.id, toWhom: 'npc_bartender', when: `day ${worldDay() + 1}` });
  });

  it('a want put up at the Hall is a promise the ledger keeps open', async () => {
    const resident = await residentNamed('person_promise');
    await hub().resolveWants(worldDay());
    const quest = hub().guild.quests.find(q => q.residentId === resident.id && q.state === 'OPEN')!;
    const mind = await MemoryStore.mind({ hubId: HUB }, resident.id, worldDay() + 1000);
    expect(mind.memories.find(m => m.ledger?.key === quest.id)?.ledger).toMatchObject({ kind: 'promise', open: true });
  });

  it('harm taken in the field is an open ledger entry, and repeats in one encounter are one entry', async () => {
    await rememberThreat(SEED, 'ent_struck', UID, 5);
    await rememberThreat(SEED, 'ent_struck', UID, 5);
    const mind = await MemoryStore.mind({ seed: SEED }, 'ent_struck', 5);
    expect(mind.memories).toHaveLength(1);
    expect(mind.memories[0].ledger).toMatchObject({ kind: 'threat', open: true });
    const recalled = await MemoryStore.recall({ seed: SEED }, 'ent_struck', 500, { people: [UID] }, id => (id === UID ? 'QUOIN' : undefined));
    expect(recalled[0]).toMatchObject({ who: 'QUOIN', did: 'hurt', ledger: 'threat, open' });
  });
});

describe('two people meeting (Pedro: batched when nobody watches, live in bubbles when somebody does)', () => {
  const sideWords = (band: string, did: string) => ({ band, remember: { did, what: 'the price of bread', how: 'quietly', why: '' } });

  it('the walk to whoever feeds them waits as a meeting; a batch takes it, and what came back is remembered and felt', async () => {
    const resident = await residentNamed('person_meet');
    await hub().resolveLiving(worldDay() + 1);
    const queued = db.get(`meets_${HUB}`).data;
    const key = MeetLaw.key(resident.id, 'npc_bartender', worldDay());
    expect(queued.pending.map((p: any) => p.key)).toContain(key);

    const filed = vi.spyOn(IntelligenceClient, 'fileWindow').mockResolvedValue({ status: 'PENDING', batchId: 'batch_1' } as any);
    vi.spyOn(IntelligenceClient, 'collectWindow').mockResolvedValue({ status: 'PENDING' } as any);
    await MeetDoor.tick(HUB, hubPort);
    expect(filed).toHaveBeenCalledTimes(1);
    const [, kind, asks] = filed.mock.calls[0] as any[];
    expect(kind).toBe('meet');
    const ask = asks.find((a: any) => a.id === key);
    expect(ask.a.who.name).toBe('Serin Vale');
    expect(ask.b.toward.knows).not.toBe('stranger');
    expect(db.get(`meets_${HUB}`).data.out).toHaveLength(1);

    const belongingBefore = residentOf(resident.id).agenda!.needs.belonging;
    vi.spyOn(IntelligenceClient, 'collectWindow').mockResolvedValue({
      status: 'OK', data: { meetings: asks.map((a: any) => ({ id: a.id, a: sideWords('lands', 'joked about'), b: sideWords('lands', 'haggled over'), lines: [] })) }
    } as any);
    await MeetDoor.tick(HUB, hubPort);
    expect(db.get(`meets_${HUB}`).data.out).toHaveLength(0);
    expect(residentOf(resident.id).agenda!.needs.belonging).toBeGreaterThan(belongingBefore);
    const book = db.get(`book_${HUB}`).data;
    const mind = await MemoryStore.mind({ hubId: HUB }, resident.id, worldDay());
    expect(mind.memories.map(m => MemoryLaw.words(m, book)).some(m => m.did === 'joked about' && m.who === 'npc_bartender')).toBe(true);
  });

  it('with no key the batch never goes, and the meeting is let go: what the deed wrote stands', async () => {
    const resident = await residentNamed('person_nokey');
    await hub().resolveLiving(worldDay() + 1);
    vi.spyOn(IntelligenceClient, 'fileWindow').mockResolvedValue({ status: 'NO_KEY' } as any);
    vi.spyOn(IntelligenceClient, 'collectWindow').mockResolvedValue({ status: 'NO_KEY' } as any);
    await MeetDoor.tick(HUB, hubPort);
    const q = db.get(`meets_${HUB}`).data;
    expect(q.pending).toHaveLength(0);
    expect(q.out).toHaveLength(0);
    expect(await MemoryStore.regard({ hubId: HUB }, resident.id, 'npc_bartender', worldDay() + 1)).toBeGreaterThan(0);
  });

  it('watched, two people talk now, their lines come back for the bubbles, and once a day is all', async () => {
    const one = await residentNamed('person_left');
    const two = await residentNamed('person_right');
    const said = vi.spyOn(IntelligenceClient, 'npcMeet').mockImplementation(async (id: string, ask: any) => ({
      status: 'OK', data: { id, a: sideWords('moves', 'told a story about'), b: sideWords('grates', 'went on about'), lines: [{ by: 'a', text: 'You hear about the bridge?' }, { by: 'b', text: 'Everyone has.' }] }
    }) as any);
    const day = worldDay();
    const lines = await MeetDoor.live(HUB, { a: one.id, b: two.id, day, where: 'by the tavern', why: 'waiting at the same door' }, hubPort);
    expect(lines).toEqual([{ by: 'a', text: 'You hear about the bridge?' }, { by: 'b', text: 'Everyone has.' }]);
    expect((said.mock.calls[0][1] as any).a.toward.knows).toBe('stranger');
    expect(await MeetDoor.live(HUB, { a: two.id, b: one.id, day, where: 'by the tavern', why: 'again' }, hubPort)).toBeNull();
    expect(said).toHaveBeenCalledTimes(1);
    // It went badly for the second: a loss, and what they keep of the first weighs on them
    expect(await MemoryStore.regard({ hubId: HUB }, two.id, one.id, day)).toBeGreaterThan(await MemoryStore.regard({ hubId: HUB }, one.id, two.id, day));
    await MeetDoor.queue(HUB, [{ a: one.id, b: two.id, day, where: 'x', why: 'y' }]);
    expect(db.get(`meets_${HUB}`).data.pending).toHaveLength(0);
  });

  it('nothing on screen reads what a meeting left behind: the canvas only draws the lines it was handed', () => {
    const canvas = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
    expect(canvas).toMatch(/MeetDoor\.live/);
    expect(canvas).not.toMatch(/MemoryStore|NpcContext|MemoryLaw/);
  });
});


describe('the usual, at the door: no model once it is a habit, and back to one when something is new', () => {
  it('two people who meet watched every day stop asking a model, say the lines they said before, and a new goal asks again', async () => {
    const one = await residentNamed('person_bob');
    const two = await residentNamed('person_glenda');
    const lines = [{ by: 'a', text: 'Want the usual?' }, { by: 'b', text: 'Yes, Bob.' }];
    const said = vi.spyOn(IntelligenceClient, 'npcMeet').mockImplementation(async (id: string) => ({
      status: 'OK', data: { id, a: { band: 'lands', remember: { did: 'asked about', what: 'the usual', how: 'cheerfully', why: '' } }, b: { band: 'lands', remember: { did: 'answered about', what: 'the usual', how: 'cheerfully', why: '' } }, lines }
    }) as any);
    const start = worldDay();
    const meet = (d: number) => MeetDoor.live(HUB, { a: one.id, b: two.id, day: start + d, where: 'by the tavern', why: 'waiting at the same door' }, hubPort);
    let quiet = -1;
    for (let d = 0; d < 15 && quiet < 0; d++) {
      const before = said.mock.calls.length;
      const heard = await meet(d);
      expect(heard).toEqual(lines);
      if (said.mock.calls.length === before) quiet = d;
    }
    expect(quiet, 'a habit formed').toBeGreaterThan(0);
    const calls = said.mock.calls.length;
    expect(await meet(quiet + 1)).toEqual(lines);
    expect(said.mock.calls.length).toBe(calls);
    expect(db.get(`meets_${HUB}`).data.habits).toBeTruthy();

    await hub().noteResidentGoal(one.id, { need: 'safety', text: 'Save for a roof.', setAt: start + quiet + 2 });
    await meet(quiet + 2);
    expect(said.mock.calls.length).toBe(calls + 1);
  });

  it('a meeting nobody watched that is the usual never reaches the batch', async () => {
    const one = await residentNamed('person_cal');
    const two = await residentNamed('person_dee');
    const where = 'by the well', why = 'drawing water';
    const answer = (asks: any[]) => ({ status: 'OK', data: { meetings: asks.map(a => ({ id: a.id, a: { band: 'idle', remember: { did: 'nodded at', what: 'the water', how: '', why: '' } }, b: { band: 'idle', remember: { did: 'nodded at', what: 'the water', how: '', why: '' } }, lines: [] })) } });
    const filed = vi.spyOn(IntelligenceClient, 'fileWindow').mockImplementation(async (_id: string, _kind: string, asks: any) => answer(asks) as any);
    vi.spyOn(IntelligenceClient, 'collectWindow').mockResolvedValue({ status: 'PENDING' } as any);
    const start = worldDay();
    let quiet = -1;
    for (let d = 0; d < 15 && quiet < 0; d++) {
      await MeetDoor.queue(HUB, [{ a: one.id, b: two.id, day: start + d, where, why }]);
      const before = filed.mock.calls.length;
      await MeetDoor.tick(HUB, hubPort);
      if (filed.mock.calls.length === before) quiet = d;
    }
    expect(quiet, 'a habit formed').toBeGreaterThan(0);
    expect(db.get(`meets_${HUB}`).data.pending).toHaveLength(0);
    const book = db.get(`book_${HUB}`).data;
    const mind = await MemoryStore.mind({ hubId: HUB }, one.id, start + quiet);
    expect(mind.memories.map(m => MemoryLaw.words(m, book)).some(m => m.did === 'nodded at' && m.when === `day ${start + quiet}`)).toBe(true);
  });
});

describe('a city\'s people, minted on the hub\'s chain, acting on chains of their own', () => {
  it('loading the city mints every keeper and resident once on the hub\'s chain, and the table is the fold of their mints and chains', async () => {
    const resident = await residentNamed('person_minted');
    await hub().settleWallets();
    await hub().settleWallets();
    const table = await PersonLedger.table(HUB);
    expect(table.find(p => p.npcId === 'npc_bartender')).toMatchObject({ as: 'keeper' });
    expect(table.find(p => p.npcId === resident.id)).toMatchObject({ as: 'resident', name: 'Serin Vale' });
    // One mint each on the hub's chain, none on their own
    const minted = (await PersonLedger.hubRows(HUB)).map(r => r.payload.data.npcId);
    expect(minted.filter(id => id === resident.id)).toHaveLength(1);
    expect(minted.filter(id => id === 'npc_bartender')).toHaveLength(1);
    expect((await PersonLedger.rows(HUB, 'npc_bartender')).some(r => r.payload.data.kind === 'MINTED')).toBe(false);
  });

  it('what they do goes on their chain: the walk to whoever feeds them, and the meetings, the usual marked', async () => {
    const one = await residentNamed('person_chain_a');
    const two = await residentNamed('person_chain_b');
    await hub().settleWallets();
    await hub().resolveLiving(worldDay() + 2);
    const fed = await PersonLedger.record(HUB, one.id);
    expect(typeof fed !== 'string' && fed.fed.paid).toBe(2);
    // Their own chain starts with an act naming the link of their mint row
    const [first] = await PersonLedger.rows(HUB, one.id);
    expect(first.payload.seq).toBe(1);
    expect(first.payload.data.mint).toBe(typeof fed !== 'string' && fed.mint);
    vi.spyOn(IntelligenceClient, 'npcMeet').mockImplementation(async (id: string) => ({
      status: 'OK', data: { id, a: { band: 'lands', remember: { did: 'greeted', what: 'the day', how: '', why: '' } }, b: { band: 'idle', remember: { did: 'greeted', what: 'the day', how: '', why: '' } }, lines: [{ by: 'a', text: 'Morning.' }] }
    }) as any);
    await MeetDoor.live(HUB, { a: one.id, b: two.id, day: worldDay(), where: 'by the tavern', why: 'waiting' }, hubPort);
    const a = await PersonLedger.record(HUB, one.id);
    const b = await PersonLedger.record(HUB, two.id);
    expect(typeof a !== 'string' && a.met[two.id]).toEqual({ times: 1, band: 'lands', usual: 0 });
    expect(typeof b !== 'string' && b.met[one.id]).toEqual({ times: 1, band: 'idle', usual: 0 });
  });

  it('a talk with someone in the city goes on that person\'s chain', async () => {
    await hub().settleWallets();
    answering(words());
    await talk().open({ kind: 'CITY', npcId: 'npc_banker' });
    await talk().say('Good day.');
    const banker = await PersonLedger.record(HUB, 'npc_banker');
    expect(typeof banker !== 'string' && banker.acts.TALKED).toBe(1);
  });
});

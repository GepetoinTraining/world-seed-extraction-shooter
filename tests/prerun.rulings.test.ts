/**
 * THREE RULINGS BEFORE THE SECOND RUN (Pedro, 2026-11-10). Registered before the build.
 *
 *   On a person's name: "if you never ask someone's name, they dion't have one, they're just a
 *     random person doing something. a player only knows WHAT they study or interact with"
 *   On a kit against the skills (C9): "api call haiku and make him check if the kit makes
 *     sense... randomness shouldn't be allowed there."
 *   On a blade against a moth (C14): "we should add the ability to pick up pebbles and equipe them"
 *
 * No test calls a model. Every answer a model would give is faked at the door, and says so.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

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
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IAttributes, IItem, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { isThrowable, thrownDamage } from '../shared/entities/item/Throwable';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { buildCreationRequest, buildKamiSetRequest, CREATION_SCHEMA, tightSkills } from '../shared/intelligence/prompts';
import { CombatMath, UNARMED_DAMAGE } from '../src/entities/combat/CombatMath';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { useTalk } from '../src/entities/interaction/talkStore';
import { usePlayerStore } from '../src/entities/player/store';
import { useWorldStore } from '../src/entities/world/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { OriginBank } from '../src/logic/content/OriginBank';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';
import { PlayerPersistence } from '../src/logic/persistence/PlayerPersistence';
import { ContactNames } from '../src/logic/systems/ContactNames';
import { CreationDoor } from '../src/logic/systems/CreationDoor';
import { CreationSystem, GRANTED_SKILLS, ICreationWords, IKamiWords } from '../src/logic/systems/CreationSystem';
import { fireMode, throwsLeft, wieldRefusal } from '../src/logic/systems/FieldInput';
import { SurveySystem } from '../src/logic/systems/SurveySystem';
import { WorkCost } from '../shared/logic/systems/WorkCost';
import { inspectEntity } from '../src/render/atoms/inspect';
import { TalkWindow } from '../src/components/TalkWindow';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_rulings';
const SEED = 'seed_rulings';
const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;

const player = () => usePlayerStore.getState().player;
const talk = () => useTalk.getState();
const fed = () => useFeed.getState().lines.map(l => l.text).join(' | ');

const spread = (over: Partial<IAttributes> = {}): IAttributes =>
  ({ ...Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1])), ...over }) as unknown as IAttributes;

const person = (id = 'ent_person', over: Record<string, any> = {}): IWorldEntity => ({
  id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 0, y: 0 }, rank: UniversalRank.E, rarity: Rarity.COMMON, isHostile: false,
  npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 30, attempts: 0, ...over }
} as IWorldEntity);

/** A character standing in a field with these bodies, as the talk's own bars stage one. */
const stage = (...entities: IWorldEntity[]) => {
  useWorldStore.setState({
    currentMap: { seed: SEED, width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities } } } as any,
    availableWorlds: [], activeWorldId: null
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'QUOIN', attributes: spread({ charisma: 3 }), baseAttributes: spread({ charisma: 3 }), namesKnown: undefined,
      equipment: LoadoutSystem.emptyEquipment(),
      currentSession: { sessionId: 'sess_rulings', layerId: 'l', inventory: [], kitItemIds: [], health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
    }
  }));
};
const live = (id: string) => Object.values(useWorldStore.getState().currentMap!.chunks).flatMap(c => c.entities).find(e => e.id === id)!;

/** What a model would answer in a round. Faked: no model is called. */
const roundWords = (over: Record<string, any> = {}): any => ({ band: 'lands', asked: { promise: 'keeps', harm: 'none' }, reply: 'Go on, then.', wants: '', ...over });
const answering = (data: unknown) => vi.spyOn(IntelligenceClient, 'npcTalk').mockImplementation(async () => ({ status: 'OK', data, usage: { model: 'faked', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, usd: 0 } } as any));
const noVoice = () => vi.spyOn(IntelligenceClient, 'npcTalk').mockResolvedValue({ status: 'NO_KEY', reason: 'No key.' } as any);

let root: Root | null = null;
let host: HTMLDivElement;
const mount = async (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};
const button = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? '')) as HTMLButtonElement | undefined;

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  useTalk.getState().close();
  useIdentityStore.setState({ certificate: CERT(UID, 'QUOIN') } as any);
  usePlayerStore.getState().initializeSession(CERT(UID, 'QUOIN'), 'NOMAD');
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// A PERSON HAS NO NAME UNTIL IT IS ASKED
// -----------------------------------------------------------------------------

describe('a person nobody has asked is an unknown figure, everywhere a character could read them', () => {
  const talkLabel = (e: IWorldEntity) => InteractionEngine.getAvailableInteractions(player(), e, 1).find(o => o.id.startsWith('int_talk_'))!.label;

  it('the card, the talk prompt and a scan say so, and none says the name', () => {
    stage(person('ent_p1'));
    const them = live('ent_p1');
    expect(ContactNames.of(them, () => 1, player())).toBe('Unknown Figure');
    expect(inspectEntity(them, { player: player(), dist: 1, level: () => 1 }).title).toBe('Unknown Figure');
    expect(talkLabel(them)).toContain('Unknown Figure');
    const scan = JSON.stringify(SurveySystem.manifest([them], () => 1, player()));
    expect(scan).toContain('Unknown Figure');
    for (const said of [talkLabel(them), scan, JSON.stringify(inspectEntity(them, { player: player(), dist: 1, level: () => 1 }))]) expect(said).not.toContain('Mara');
  });

  it('once the name is known to this character, all three say it', () => {
    stage(person('ent_p1'));
    usePlayerStore.setState(s => ({ player: ContactNames.learnName(s.player, live('ent_p1')) }));
    const them = live('ent_p1');
    expect(ContactNames.knowsName(player(), them)).toBe(true);
    expect(inspectEntity(them, { player: player(), dist: 1, level: () => 1 }).title).toBe('Mara Quill');
    expect(talkLabel(them)).toContain('Mara Quill');
    expect(SurveySystem.manifest([them], () => 1, player())[0].label).toBe('Mara Quill');
  });

  it('a name belongs to one person: another body with the same id and another name stays unknown', () => {
    stage(person('ent_p1'));
    usePlayerStore.setState(s => ({ player: ContactNames.learnName(s.player, live('ent_p1')) }));
    const elsewhere = person('ent_p1', { name: 'Io Null' });
    expect(ContactNames.knowsName(player(), elsewhere)).toBe(false);
    expect(ContactNames.of(elsewhere, () => 1, player())).toBe('Unknown Figure');
  });

  it('with no reader given, nobody is named', () => {
    expect(ContactNames.of(person('ent_p1'), () => 3)).toBe('Unknown Figure');
    expect(SurveySystem.manifest([person('ent_p1')])[0].label).toBe('Unknown Figure');
  });

  it('what a character knows of names is kept with them between drops', () => {
    stage(person('ent_p1'));
    usePlayerStore.setState(s => ({ player: ContactNames.learnName(s.player, live('ent_p1')) }));
    const kept = PlayerPersistence.persistable(player());
    expect(ContactNames.knowsName(kept, live('ent_p1'))).toBe(true);
  });
});

describe('the talk is where a name is asked', () => {
  // A talk in the field is kept for the session by who it is with, so each bar meets someone new
  let met = 0;
  let id = '';
  const open = async (over: Record<string, any> = {}) => {
    id = `ent_met_${++met}`;
    stage(person(id, over));
    await talk().open({ kind: 'FIELD_PERSON', entityId: id });
  };

  it('it opens on an unknown figure', async () => {
    noVoice();
    await open();
    expect(talk().title).toBe('Unknown Figure');
    expect(talk().named).toBe(false);
  });

  it('asking their name is a line of the talk: it costs what a round costs, and they give it', async () => {
    noVoice();
    await open();
    const energy = player().currentSession!.energy;
    // Changed on purpose 2026-11-12 (EN): what a round costs is the day's one law's
    const round = WorkCost.of(player(), 'round');
    await talk().askName();
    expect(talk().title).toBe('Mara Quill');
    expect(talk().named).toBe(true);
    expect(player().currentSession!.energy).toBeCloseTo(energy - round, 9);
    expect(ContactNames.knowsName(player(), live(id))).toBe(true);
    expect(talk().log.map(l => l.text).join(' ')).toMatch(/You ask their name/);
    expect(talk().log.map(l => l.text).join(' ')).toMatch(/Mara Quill/);
  });

  it('asking twice costs once: there is nothing left to ask', async () => {
    noVoice();
    await open();
    await talk().askName();
    const energy = player().currentSession!.energy;
    await talk().askName();
    expect(player().currentSession!.energy).toBe(energy);
  });

  it('with no energy for it, the ask says so and they stay unnamed', async () => {
    noVoice();
    await open();
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, energy: WorkCost.of(s.player, 'round') / 2 } } }));
    await talk().askName();
    expect(talk().title).toBe('Unknown Figure');
    expect(talk().note).toMatch(/energy/);
  });

  it('talking of anything else leaves them unnamed, in the window and in the feed', async () => {
    noVoice();
    await open();
    await talk().say('Hard ground, this.');
    expect(talk().title).toBe('Unknown Figure');
    expect(talk().log.map(l => l.text).join(' ')).not.toContain('Mara');
    expect(fed()).not.toContain('Mara');
  });

  it('a name they say themselves is heard, and is theirs from then on', async () => {
    answering(roundWords({ reply: 'Mara. Mara Quill, if it matters to you.' }));
    await open();
    await talk().say('Who are you?');
    expect(talk().title).toBe('Mara Quill');
    expect(talk().named).toBe(true);
    expect(ContactNames.knowsName(player(), live(id))).toBe(true);
  });

  it('a first name alone is enough, as a word of its own and written as a name', async () => {
    answering(roundWords({ reply: 'They call me Mara out here.' }));
    await open();
    await talk().say('What do I call you?');
    expect(talk().named).toBe(true);
  });

  it('a reply that never says it leaves them unnamed, and a word that only holds the name inside it is not the name', async () => {
    answering(roundWords({ reply: 'The marauders took the road. Go on, then.' }));
    await open();
    await talk().say('Who are you?');
    expect(talk().title).toBe('Unknown Figure');
    expect(talk().named).toBe(false);
  });

  it('someone who agrees to come gives their name as they do', async () => {
    noVoice();
    await open({ disposition: 100 });
    talk().bring();
    expect(live(id).escort, 'they walk beside the character').toBeTruthy();
    expect(ContactNames.knowsName(player(), live(id))).toBe(true);
    expect(fed()).toMatch(/They give their name, Mara Quill, and walk beside you now/);
  });

  it('a gift to someone unnamed names nobody', async () => {
    noVoice();
    await open();
    const def = Object.values(RESOURCE_DEFINITIONS)[0];
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [ItemFactory.createResourceItem(def, Rng.fromKey('gift'))] } } }));
    talk().give();
    expect(fed()).toMatch(/Gave /);
    expect(fed()).not.toContain('Mara');
  });

  it('the window offers the ask while the name is not known, and takes it away once it is', async () => {
    noVoice();
    await open();
    await mount(createElement(TalkWindow));
    expect(host.textContent).toMatch(/TALK: UNKNOWN FIGURE/);
    expect(button(/ASK THEIR NAME/)).toBeTruthy();
    await act(async () => { await talk().askName(); });
    expect(host.textContent).toMatch(/TALK: MARA QUILL/);
    expect(button(/ASK THEIR NAME/)).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// C9: THE KIT AND THE SKILLS AGREE, AND NOTHING ROLLS FOR IT
// -----------------------------------------------------------------------------

describe('C9: what the hands are granted is what the kit can work', () => {
  const MINING = 'skill_metal+mineral+ore+pickaxe';
  const FELLING = 'skill_axe+flora+wood';
  const GLEANING = 'skill_flora+grain';
  const FRUIT = 'skill_flora+fruit';
  const FORAGING = 'skill_berry+flora';

  const draft = (originId: string, kitId: string, pick = 0) => ({
    originId, kitId, silhouette: OriginBank.origin(originId)!.silhouette, hubId: '', themeId: '',
    answers: Object.fromEntries(CreationSystem.questionsFor(originId).map(q => [q.id, q.answers[pick % q.answers.length].id])),
    said: ''
  });
  /** What a model would grant. Faked: no model is called. */
  const grant = (ids: string[]): ICreationWords => ({
    line: 'The bank honors it.',
    skills: ids.map((id, i) => ({ id, name: `Named ${i}`, flavor: 'It was in the hands first.', grants: [] }))
  });
  const toolKinds = () => new Set(WebBank.current().tags.filter(t => t.kind === 'tool').map(t => t.tag));
  const toolsOf = (id: string) => (TagLaw.parseSkillId(id) ?? []).filter(t => toolKinds().has(t));
  const carriedTags = (kitId: string) => new Set(CreationSystem.kitPreview(kitId).flatMap(p => p.tags));
  const works = (kitId: string, id: string) => toolsOf(id).every(t => carriedTags(kitId).has(t));

  it('the ask says what each carried thing is, and what each skill is worked with', () => {
    const ask = CreationSystem.ask(draft('slow_life', 'kit_pantry'));
    expect(ask.carries.every(c => typeof c.name === 'string' && Array.isArray(c.tags))).toBe(true);
    expect(ask.carries.some(c => c.tags.includes('axe'))).toBe(true);
    expect(ask.candidates.find(c => c.id === MINING)!.tool).toEqual(['pickaxe']);
    expect(ask.candidates.find(c => c.id === FELLING)!.tool).toEqual(['axe']);
    expect(ask.candidates.find(c => c.id === GLEANING)!.tool ?? []).toEqual([]);
  });

  it('the law refuses a skill whose tool they do not carry, and says which', () => {
    const ask = CreationSystem.ask(draft('slow_life', 'kit_pantry'));
    const verdict = CreationSystem.judge(grant([GLEANING, FRUIT, MINING]), ask);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/pickaxe/);
    expect(verdict.reason).toMatch(/carry none/);
  });

  it('and takes a grant worked by hand or with what they carry', () => {
    const ask = CreationSystem.ask(draft('slow_life', 'kit_pantry'));
    expect(CreationSystem.judge(grant([GLEANING, FRUIT, FELLING]), ask).ok).toBe(true);
  });

  it('with every life, every kit and every answer, the floor grants only what the kit can work', () => {
    for (const origin of OriginBank.origins()) for (const kitId of origin.kits) for (let pick = 0; pick < 4; pick++) {
      const d = draft(origin.id, kitId, pick);
      const floor = CreationSystem.floor(d);
      expect(floor.skills).toHaveLength(GRANTED_SKILLS);
      for (const s of floor.skills) expect(works(kitId, s.id), `${origin.id} ${kitId} ${pick}: ${s.id}`).toBe(true);
      expect(CreationSystem.judge(floor, CreationSystem.ask(d)).ok, `${origin.id} ${kitId} ${pick}`).toBe(true);
    }
  });

  it('a kit with no tool in it is granted only what bare hands do', () => {
    const floor = CreationSystem.floor(draft('economic_genius', 'kit_light'));
    for (const s of floor.skills) expect(toolsOf(s.id), s.id).toEqual([]);
  });

  it('the quiet life with a pantry is no longer handed a skill it cannot work', () => {
    // The very deal this pass met on screen: Gleaning, Fruit-Picking and Mining, with a hatchet and no pick
    const floor = CreationSystem.floor(draft('slow_life', 'kit_pantry'));
    expect(floor.skills.map(s => s.id)).not.toContain(MINING);
  });

  it('nothing is rolled for it: the candidates come in an order anyone could work out', () => {
    for (const origin of OriginBank.origins()) {
      const d = draft(origin.id, origin.kits[0]);
      const ask = CreationSystem.ask(d);
      const lean = new Set([...origin.leans.main, ...origin.leans.sub, ...OriginBank.questions().flatMap(q => q.answers.find(a => a.id === d.answers[q.id])?.leans ?? [])]);
      const rank = (c: { id: string; tags: string[] }) => [
        works(d.kitId, c.id) ? 0 : 1,
        -c.tags.filter(t => lean.has(t)).length,
        WebSystem.bankNameOf(c.id) ? 0 : 1
      ];
      for (let i = 1; i < ask.candidates.length; i++) {
        const a = rank(ask.candidates[i - 1]), b = rank(ask.candidates[i]);
        const order = a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (ask.candidates[i - 1].id < ask.candidates[i].id ? -1 : 1);
        expect(order, `${origin.id}: ${ask.candidates[i - 1].id} before ${ask.candidates[i].id}`).toBeLessThan(0);
      }
    }
  });

  it('and the same choices are granted the same, whoever makes them and however often', () => {
    const a = CreationSystem.floor(draft('cooking', 'kit_pantry')), b = CreationSystem.floor(draft('cooking', 'kit_pantry'));
    expect(a.skills.map(s => s.id)).toEqual(b.skills.map(s => s.id));
    expect(CreationSystem.ask(draft('cooking', 'kit_pantry')).candidates.map(c => c.id))
      .toEqual(CreationSystem.ask(draft('cooking', 'kit_pantry')).candidates.map(c => c.id));
  });

  it('Kami is held to it: the kit he picks has to work the skills he grants', () => {
    const ask = CreationSystem.kamiAsk();
    expect(ask.kits.every(k => k.carries.every(c => Array.isArray(c.tags)))).toBe(true);
    const set = (kit: string, ids: string[]): IKamiWords => ({ name: 'THE LAST STAKE', main: 'strength', sub: 'endurance', kit, ...grant(ids) });
    const refused = CreationSystem.judgeKami(set('kit_light', [GLEANING, FRUIT, MINING]), ask);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/pickaxe/);
    expect(CreationSystem.judgeKami(set('kit_working', [GLEANING, FELLING, MINING]), ask).ok).toBe(true);
  });

  it('fate still deals, and deals inside it', () => {
    const kits = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const dealt = CreationSystem.fateFloor([{ role: 'user', content: `stake ${i}` }]);
      kits.add(dealt.kit);
      for (const s of dealt.skills) expect(works(dealt.kit, s.id), `${dealt.kit}: ${s.id}`).toBe(true);
      expect(CreationSystem.judgeKami(dealt, CreationSystem.kamiAsk()).ok).toBe(true);
    }
    expect(kits.size).toBeGreaterThan(1);
  });

  it('a grant the law refuses is asked once more with the reason, and the second answer stands', async () => {
    const d = draft('slow_life', 'kit_pantry');
    const asks: any[] = [];
    vi.spyOn(IntelligenceClient, 'grantSkills').mockImplementation(async (ask: any) => {
      asks.push(ask);
      return { status: 'OK', data: asks.length === 1 ? grant([GLEANING, FRUIT, MINING]) : grant([GLEANING, FRUIT, FORAGING]), usage: { model: 'faked', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, usd: 0.001 } } as any;
    });
    const out = await CreationDoor.seek(d);
    expect(asks).toHaveLength(2);
    expect(asks[0].refused).toBeUndefined();
    expect(asks[1].refused).toMatch(/pickaxe/);
    expect(out.by).toBe('DOOR');
    expect(out.words.skills.map(s => s.id)).toEqual([GLEANING, FRUIT, FORAGING]);
    expect(out.usage!.usd).toBeCloseTo(0.002);
  });

  it('refused twice, it falls to the floor, which makes sense on its own', async () => {
    const d = draft('slow_life', 'kit_pantry');
    const door = vi.spyOn(IntelligenceClient, 'grantSkills').mockResolvedValue({ status: 'OK', data: grant([GLEANING, FRUIT, MINING]) } as any);
    const out = await CreationDoor.seek(d);
    expect(door).toHaveBeenCalledTimes(2);
    expect(out.by).toBe('FLOOR');
    expect(out.reason).toMatch(/pickaxe/);
    for (const s of out.words.skills) expect(works('kit_pantry', s.id)).toBe(true);
  });

  it('the Seed is told to check the kit, and what a refusal is', () => {
    const ask = CreationSystem.ask(draft('slow_life', 'kit_pantry'));
    const req = buildCreationRequest(ask);
    expect(req.system).toMatch(/what they carry/);
    expect(req.system).toMatch(/"tool"/);
    expect(req.system).toMatch(/"refused"/);
    expect(buildKamiSetRequest([], CreationSystem.kamiAsk()).system).toMatch(/"tool"/);
  });

  it('a model held to the grammar is offered only what the kit can work', () => {
    const ask = CreationSystem.ask(draft('slow_life', 'kit_pantry'));
    const tight = tightSkills(CREATION_SCHEMA, ask) as any;
    const offered: string[] = tight.properties.skills.items.properties.id.enum;
    expect(offered.length).toBeGreaterThanOrEqual(GRANTED_SKILLS);
    expect(offered).not.toContain(MINING);
    for (const id of offered) expect(works('kit_pantry', id), id).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// C14: A PEBBLE PICKED UP CAN BE THROWN
// -----------------------------------------------------------------------------

describe('C14: a pebble can be picked up, taken in the hand and thrown', () => {
  const defs = () => Object.values(RESOURCE_DEFINITIONS) as any[];
  const pebbleDef = () => defs().find(d => d.visuals?.modelId === 'pebble' && d.themeId)!;
  const rockDef = () => defs().find(d => d.visuals?.modelId === 'rock' && d.themeId)!;
  const treeDef = () => defs().find(d => d.visuals?.modelId === 'tree' && d.themeId)!;
  const mint = (def: any, key: string): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(key));
  const pebble = (key = 'p1') => mint(pebbleDef(), key);
  const carrying = (items: IItem[]) => {
    stage();
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: items } } }));
  };
  const hand = (slot: 'RIGHT_HAND' | 'LEFT_HAND' = 'RIGHT_HAND') => LoadoutSystem.itemIn(player().equipment!, slot);
  const pack = () => player().currentSession!.inventory;

  it('a world\'s pebble is something to throw, and nothing else lying about is', () => {
    expect(pebbleDef(), 'the shipped world has a pebble').toBeDefined();
    expect(isThrowable(pebble())).toBe(true);
    expect(isThrowable(mint(rockDef(), 'r'))).toBe(false);
    expect(isThrowable(mint(treeDef(), 't'))).toBe(false);
    expect(isThrowable(undefined)).toBe(false);
    expect(isThrowable({ ...pebble(), isIdentified: false })).toBe(false);
  });

  it('it goes in a hand, either one, and nowhere else on the body', () => {
    const p = pebble();
    const empty = LoadoutSystem.emptyEquipment();
    expect(LoadoutSystem.slotForItem(p, empty)).toBe('RIGHT_HAND');
    expect(LoadoutSystem.slotAccepts('RIGHT_HAND', p).ok).toBe(true);
    expect(LoadoutSystem.slotAccepts('LEFT_HAND', p).ok).toBe(true);
    expect(LoadoutSystem.slotAccepts('CHEST', p).ok).toBe(false);
    expect(LoadoutSystem.slotAccepts('TOOL_1', p).ok).toBe(false);
    // With the right hand full it goes to the left, so a blade and a stone ride together
    expect(LoadoutSystem.slotForItem(p, { ...empty, slots: { RIGHT_HAND: 'a_blade' } })).toBe('LEFT_HAND');
  });

  it('other cargo is still cargo', () => {
    expect(LoadoutSystem.slotForItem(mint(treeDef(), 't'), LoadoutSystem.emptyEquipment())).toBeNull();
    expect(LoadoutSystem.slotAccepts('RIGHT_HAND', mint(treeDef(), 't')).ok).toBe(false);
  });

  it('the hand that holds one throws it', () => {
    expect(wieldRefusal(pebble())).toBeNull();
    expect(fireMode(pebble())).toBe('SHOT');
  });

  it('it lands harder than a bare hand, by how hard the stone is', () => {
    const p = pebble();
    expect(CombatMath.weaponDamage(p)).toBe(thrownDamage(p));
    expect(thrownDamage(p)).toBeGreaterThan(UNARMED_DAMAGE);
    expect(CombatMath.weaponDamage(undefined)).toBe(UNARMED_DAMAGE);
    const harder = { ...pebbleDef(), id: 'res_test_flint', materialProps: { ...pebbleDef().materialProps, HARDNESS: pebbleDef().materialProps.HARDNESS * 3 } };
    RESOURCE_DEFINITIONS[harder.id] = harder;
    // A stone with no hardness at all lands as a bare hand does: one number, said in one place each
    const soft = { ...pebbleDef(), id: 'res_test_chalk', materialProps: { ...pebbleDef().materialProps, HARDNESS: 0 } };
    RESOURCE_DEFINITIONS[harder.id] = harder;
    RESOURCE_DEFINITIONS[soft.id] = soft;
    try {
      expect(thrownDamage(mint(harder, 'h'))).toBeGreaterThan(thrownDamage(p));
      expect(thrownDamage(mint(soft, 's'))).toBe(UNARMED_DAMAGE);
    } finally {
      delete RESOURCE_DEFINITIONS[harder.id];
      delete RESOURCE_DEFINITIONS[soft.id];
    }
  });

  it('taking one in the hand takes it out of the pack', () => {
    const [a, b, c] = [pebble('a'), pebble('b'), pebble('c')];
    carrying([a, b, c]);
    expect(usePlayerStore.getState().equipToSlot(a.id).ok).toBe(true);
    expect(hand()!.id).toBe(a.id);
    expect(pack().map(i => i.id)).toEqual([b.id, c.id]);
  });

  it('a throw spends it, and the next one carried comes to the same hand', () => {
    const [a, b, c] = [pebble('a'), pebble('b'), pebble('c')];
    carrying([a, b, c]);
    usePlayerStore.getState().equipToSlot(a.id);
    usePlayerStore.getState().spendThrown('RIGHT_HAND');
    expect(hand()!.id).toBe(b.id);
    expect(pack().map(i => i.id)).toEqual([c.id]);
    expect(player().equipment!.items.some(i => i.id === a.id)).toBe(false);
    usePlayerStore.getState().spendThrown('RIGHT_HAND');
    expect(hand()!.id).toBe(c.id);
    expect(pack()).toEqual([]);
  });

  it('the last one leaves the hand empty, and the feed says so', () => {
    const a = pebble('a');
    carrying([a]);
    usePlayerStore.getState().equipToSlot(a.id);
    usePlayerStore.getState().spendThrown('RIGHT_HAND');
    expect(hand()).toBeUndefined();
    expect(player().equipment!.slots.RIGHT_HAND).toBeUndefined();
    expect(fed()).toMatch(/last one/i);
  });

  it('the hand says how many throws are left: the one held and every one carried', () => {
    const [a, b, c] = [pebble('a'), pebble('b'), pebble('c')];
    const oak = mint(treeDef(), 't');
    expect(throwsLeft(a, [b, oak, c])).toBe(3);
    expect(throwsLeft(a, [])).toBe(1);
    // A hand holding anything else, or nothing, counts no throws
    expect(throwsLeft(oak, [a, b])).toBeUndefined();
    expect(throwsLeft(undefined, [a, b])).toBeUndefined();
    // 2026-11-10: the hotbar also says which hand is firing, so an empty one counts the stones it will reach for
    expect(SRC('src/components/Hotbar.tsx')).toMatch(/throwsLeft\(item, carried, isActive\)/);
  });

  it('nothing but a thing to throw is spent that way', () => {
    const oak = mint(treeDef(), 't');
    carrying([oak]);
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: { ...LoadoutSystem.emptyEquipment(), slots: { RIGHT_HAND: 'held' }, items: [{ ...oak, id: 'held' }] } } }));
    usePlayerStore.getState().spendThrown('RIGHT_HAND');
    expect(hand()!.id).toBe('held');
    expect(pack()).toHaveLength(1);
  });

  it('the field spends one for each throw, where a weapon would wear', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    // Wear by the work done (2026-11-12): a weapon wears by `blowWear`, no longer one a use
    expect(field).toMatch(/if \(isThrowable\(weapon\)\) st\.spendThrown\(slot\);[\s\S]{0,200}?else if \(weapon\) st\.wearSlot\(slot, blowWear\(/);
  });

  it('the sheet offers to take one in the hand: by its button, and by the click that wears anything else', () => {
    const sheet = SRC('src/components/CharacterSheet.tsx');
    expect(sheet).toMatch(/item\.tags\?\.includes\('tool'\) \|\| isThrowable\(item\)\) \{ st\.equipSwap\(item\.id\)/);
    expect(sheet).toMatch(/isThrowable\(selectedItem\)\)/);
    expect(sheet).toMatch(/tool \|\| isThrowable\(piece\)\)/);
  });

  it('taking one off the ground is said as picking it up', () => {
    stage();
    const node = (def: any): IWorldEntity => ({ id: `node_${def.id}`, type: EntityType.RESOURCE, definitionId: def.id, position: { x: 0, y: 0 }, rank: def.rank, rarity: Rarity.COMMON, isHostile: false, usesRemaining: 1 } as IWorldEntity);
    // ML: what is worked is tried with the hand or the tool; only a stone off the ground is picked up
    const label = (def: any) => InteractionEngine.getAvailableInteractions(player(), node(def), 1).find(o => o.id.startsWith('int_harvest_') || o.id.startsWith('int_try_'))?.label;
    // 2026-11-10: a thing never worked reads by its form in the prompt too, and by its name once some is held
    expect(label(pebbleDef())).toBe('Pick up Unknown Pebble');
    const byHand = defs().find(d => d.themeId && d.visuals?.modelId !== 'pebble' && d.harvestConfig?.requiredToolTags.length === 0)!;
    expect(label(byHand)).toMatch(/^Try your hands on Unknown /);
    carrying([pebble('known'), mint(byHand, 'known')]);
    expect(label(pebbleDef())).toBe(`Pick up ${pebbleDef().name}`);
    expect(label(byHand)).toBe(`Try your hands on ${byHand.name}`);
    expect(SRC('src/entities/player/store.ts')).toMatch(/isLooseStone\(def\) \? 'Picked up' : 'Harvested'/);
  });
});

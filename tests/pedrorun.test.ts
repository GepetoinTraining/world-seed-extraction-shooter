/**
 * WHAT PEDRO FOUND IN HIS OWN RUN (2026-11-10), in his words:
 *
 *   "names of the materials still appear in the world (compound oak before I chopped it)"
 *   "the NPC are extracted and respawn"
 *   "the chests always respawn"
 *   "tutorial world doesn't allow the scans of other regions"
 *   "resting outside the world needs to be EITHER loading over a night and watching the dream play
 *     out ... or continue as is but not advance the day (server clock is the clock)"
 *   "the npc needs to be auto left out when one gets to town if there's space in the inn"
 *
 * Registered before the build. No test calls a model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IAttributes, IItem, IPlayer, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { Population, PopulationStore, emptyPopulationRecord } from '../shared/entities/world/Population';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { WorldClock } from '../src/entities/world/WorldClock';
import { TutorialStart } from '../src/entities/world/TutorialStart';
import { InventorySystem } from '../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { reachFor } from '../src/logic/systems/FieldInput';
import { Escort } from '../src/logic/systems/Escort';
import { FieldEscort } from '../src/logic/systems/FieldEscort';
import { RestDoor } from '../src/logic/systems/RestDoor';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { STUDY_LOST_DAYS, StudySystem } from '../src/logic/systems/StudySystem';
import { Tutorial, TUTORIAL_WORLD_ID } from '../src/logic/systems/Tutorial';
import { hubPort } from '../src/entities/hub/store';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useWorldStore, worldPort } from '../src/entities/world/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { ContactNames } from '../src/logic/systems/ContactNames';
import { SurveySystem } from '../src/logic/systems/SurveySystem';
import { inspectEntity } from '../src/render/atoms/inspect';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_pedrorun';
const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;

const player = () => usePlayerStore.getState().player;
const fed = () => useFeed.getState().lines.map(l => l.text).join(' | ');

/** The first thing a world wrote in this form: a tree, a loose stone. */
const written = (form: string) => Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && (d as any).visuals?.modelId === form)! as any;
const mint = (def: any, key: string): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(key));
const node = (def: any, id = `ent_${def.id}`): IWorldEntity => ({
  id, type: EntityType.RESOURCE, definitionId: def.id, position: { x: 0, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, usesRemaining: 100
} as IWorldEntity);

/** A character standing in a one-chunk field with these bodies and this in the pack. */
const stage = (entities: IWorldEntity[], carried: IItem[] = []) => {
  useWorldStore.setState({
    currentMap: { seed: 'seed_pedrorun', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities } } } as any,
    availableWorlds: [], activeWorldId: null
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      currentSession: { sessionId: 'sess_pedrorun', layerId: 'l', inventory: carried, kitItemIds: [], health: 100, maxHealth: 100, energy: 100_000, maxEnergy: 100_000, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
    }
  }));
};

const cardOf = (e: IWorldEntity) => inspectEntity(e, { player: player(), dist: 1, level: WebSystem.knowledgeReader(player()) });
const harvestLabel = (e: IWorldEntity) => InteractionEngine.getAvailableInteractions(player(), e, 1).find(o => o.id.startsWith('int_harvest_'))?.label;

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  useIdentityStore.setState({ certificate: CERT(UID, 'PEDRO') } as any);
  usePlayerStore.getState().initializeSession(CERT(UID, 'PEDRO'), 'NOMAD');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// A MATERIAL HAS NO NAME UNTIL IT IS WORKED OR HELD
// -----------------------------------------------------------------------------

describe('a thing to gather is not named before this character has worked it or holds some', () => {
  const oak = () => written('tree');
  const stone = () => written('pebble');

  it('nothing filed and nothing held reads as not known at all', () => {
    expect(WebSystem.knowledgeReader(player())(oak().id)).toBe(0);
  });

  it('its card says what is plain to see, its form, and keeps its name back', () => {
    stage([node(oak())]);
    const card = cardOf(node(oak()));
    expect(card.title).toBe('Unknown Tree');
    expect(card.title).not.toContain(oak().name);
    expect(card.compact).not.toContain(oak().name);
    expect(card.rows.some(r => r[0] === 'Rank')).toBe(false);
  });

  it('the key that works it says the same: no name in the prompt or the menu', () => {
    // A stone asks for no tool, so the prompt is there for bare hands
    stage([node(stone())]);
    expect(harvestLabel(node(stone()))).toBe('Pick up Unknown Pebble');
  });

  it('every form a world writes in reads by that form', () => {
    for (const form of ['grain', 'shrub', 'fruit', 'tree', 'vein', 'sand', 'rock', 'pebble']) {
      const def = written(form);
      if (!def) continue;
      expect(ContactNames.of(node(def), () => 0), form).toBe(`Unknown ${form[0].toUpperCase()}${form.slice(1)}`);
    }
  });

  it('a thing with no form on record is still an unknown substance', () => {
    const odd = { ...node(oak()), definitionId: 'res_nobody_wrote_this' } as IWorldEntity;
    expect(ContactNames.of(odd, () => 0)).toBe('Unknown Substance');
  });

  it('working it once names it from then on: the card, the prompt and the scan', () => {
    const e = node(stone());
    stage([e]);
    usePlayerStore.getState().performInteraction(`int_harvest_${e.id}`, e.id);
    expect(fed()).toContain(stone().name);
    expect(WebSystem.knowledgeReader(player())(stone().id)).toBeGreaterThanOrEqual(1);
    // The pack is emptied, so the name is known by the record and not by what is held
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [] } } }));
    expect(cardOf(e).title).toBe(stone().name);
    expect(harvestLabel(e)).toBe(`Pick up ${stone().name}`);
    expect(SurveySystem.manifest([e], WebSystem.knowledgeReader(player()), player()).map(l => l.label)).toEqual([stone().name]);
  });

  it('holding some of it is knowing its name: in the pack, in a hand, or in the stash', () => {
    const piece = mint(oak(), 'held');
    stage([node(oak())], [piece]);
    expect(cardOf(node(oak())).title).toBe(oak().name);

    stage([node(oak())]);
    expect(cardOf(node(oak())).title).toBe('Unknown Tree');
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [piece] }] } } }));
    expect(cardOf(node(oak())).title).toBe(oak().name);
  });

  it('a scan lists what was never worked by its form, and never by its name', () => {
    const lines = SurveySystem.manifest([node(oak(), 'a'), node(oak(), 'b')], WebSystem.knowledgeReader(player()), player());
    expect(lines.map(l => l.label)).toEqual(['Unknown Tree']);
    expect(lines[0].count).toBe(2);
  });

  it('the prompt is named through the one naming law', () => {
    expect(SRC('src/entities/interaction/InteractionEngine.ts')).not.toMatch(/Extract'\} \$\{resourceDef\.name\}/);
  });
});

// -----------------------------------------------------------------------------
// A PERSON BROUGHT OUT OF A WORLD IS GONE FROM IT
// -----------------------------------------------------------------------------

describe('a person brought out of a world does not stand in it again', () => {
  const person = (id = 'ent_person'): IWorldEntity => ({
    id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 40, y: 0 }, rank: UniversalRank.E, rarity: Rarity.COMMON, isHostile: false,
    npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 99, attempts: 3 }
  } as IWorldEntity);
  const chunkWith = (...entities: IWorldEntity[]) => ({ id: '0,0', x: 0, y: 0, entities }) as any;
  const sure = (over: Partial<IAttributes> = {}): IAttributes =>
    ({ ...Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 2])), ...over }) as unknown as IAttributes;
  /** In a world that keeps a record, with someone who has agreed to come. */
  const walkingWith = () => {
    MobAI.reset();
    stage([person()]);
    useWorldStore.setState({ activeWorldId: 'w_left', populationRecord: emptyPopulationRecord(), generation: 2 } as never);
    // Sure of being heard, and strong enough to lift a person
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: sure({ charisma: 6, strength: 9 }), baseAttributes: sure({ charisma: 6, strength: 9 }) } }));
    usePlayerStore.getState().performInteraction('int_recruit_ent_person', 'ent_person');
    expect(player().currentSession!.escorts?.[0]?.entityId).toBe('ent_person');
  };

  it('the record keeps who left, and writing it twice changes nothing', () => {
    const record = Population.left(emptyPopulationRecord(), 'ent_3_4_npc', 5);
    expect(record.left).toEqual({ ent_3_4_npc: { at: 5 } });
    expect(Population.left(record, 'ent_3_4_npc', 9)).toBe(record);
  });

  it('a chunk laid from the record stands without them, and with everyone else', () => {
    const record = Population.left(emptyPopulationRecord(), 'ent_3_4_npc', 0);
    const chunk = chunkWith(person('ent_3_4_npc'), person('ent_5_6_npc'));
    Population.layOver('seed_left', chunk, record, 0, {} as any);
    expect(chunk.entities.map((e: IWorldEntity) => e.id)).toEqual(['ent_5_6_npc']);
  });

  it('at any later cycle too: folding the world forward never brings them back', () => {
    const context = ContentRegistry.contextFor(ContentRegistry.defaultThemeId(), UniversalRank.F);
    const record = Population.left(emptyPopulationRecord(), 'ent_3_4_npc', 0);
    const chunk = chunkWith(person('ent_3_4_npc'), person('ent_5_6_npc'));
    Population.layOver('seed_left', chunk, record, 3, context);
    const people = chunk.entities.filter((e: IWorldEntity) => e.type === EntityType.NPC).map((e: IWorldEntity) => e.id);
    expect(people).toEqual(['ent_5_6_npc']);
    expect(record.left).toEqual({ ent_3_4_npc: { at: 0 } });
  });

  it("walking out with someone writes it down through the world's own door, and it is saved", async () => {
    walkingWith();
    FieldEscort.walkOut(worldPort, playerPort);
    expect(useWorldStore.getState().populationRecord!.left).toEqual({ ent_person: { at: 2 } });
    await Promise.resolve();
    expect((await PopulationStore.load('w_left')).left).toEqual({ ent_person: { at: 2 } });
  });

  it('carried out, they are gone from it the same', () => {
    walkingWith();
    FieldEscort.fall('ent_person', worldPort, playerPort);
    expect(FieldEscort.carry('ent_person', worldPort, playerPort)).toBe(true);
    FieldEscort.walkOut(worldPort, playerPort);
    expect(useWorldStore.getState().populationRecord!.left).toEqual({ ent_person: { at: 2 } });
  });

  it('someone left lying in the world has not left it', () => {
    walkingWith();
    FieldEscort.fall('ent_person', worldPort, playerPort);
    FieldEscort.walkOut(worldPort, playerPort);
    expect(useWorldStore.getState().populationRecord!.left ?? {}).toEqual({});
  });
});

// -----------------------------------------------------------------------------
// THE TUTORIAL NEVER CLOSES, AND IT STILL TURNS
// -----------------------------------------------------------------------------

describe('the tutorial never closes, and it still turns', () => {
  const cadence = WorldClock.cadenceFor(32);
  const period = cadence.upMs + cadence.offMs + cadence.scanMs;

  it('a world outside the clock that was given no start stands at alpha for ever', () => {
    const outside = { createdAt: 0, size: 32, isDebug: true };
    expect(WorldClock.momentAt(outside, 10 * period).generation).toBe(0);
    expect(WorldClock.turns(outside)).toBe(false);
  });

  it("given a start, its cycles are counted from it at its size's cadence, and its gate is always open", () => {
    const card = Tutorial.card(123, 1000);
    expect(card.turnsFrom).toBe(1000);
    expect(WorldClock.turns(card)).toBe(true);
    expect(WorldClock.momentAt(card, 999).generation).toBe(0);
    expect(WorldClock.momentAt(card, 1000 + period - 1).generation).toBe(0);
    expect(WorldClock.momentAt(card, 1000 + period).generation).toBe(1);
    // At every point of a cycle, where a clocked world would stand dark or booting
    for (const into of [1, cadence.upMs + 1, cadence.upMs + cadence.offMs + 1]) {
      const m = WorldClock.momentAt(card, 1000 + 3 * period + into);
      expect(m.generation).toBe(3);
      expect(m.phase).toBe('UP');
      expect(m.canDeploy).toBe(true);
      expect(m.warning).toBe('NONE');
      expect(m.msLeft).toBe(Infinity);
    }
  });

  it('a hub writes down when its tutorial began, once', async () => {
    expect(await TutorialStart.at(5000)).toBe(5000);
    expect(await TutorialStart.at(9000)).toBe(5000);
  });

  it('the zones list gives the tutorial that start', async () => {
    await useWorldStore.getState().refreshWorlds();
    const card = useWorldStore.getState().availableWorlds.find(w => w.id === TUTORIAL_WORLD_ID)!;
    expect(typeof card.turnsFrom).toBe('number');
    expect(card.turnsFrom).toBe(await TutorialStart.at(Date.now() + 99_999));
  });

  it('so it keeps a record of its chests and its people, as any world that turns does', async () => {
    await useWorldStore.getState().refreshWorlds();
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    expect(useWorldStore.getState().chestRecord).not.toBeNull();
    expect(useWorldStore.getState().populationRecord).not.toBeNull();
    useWorldStore.getState().exitWorld();
  });

  it('a chest opened there is still opened at the next drop', async () => {
    await useWorldStore.getState().refreshWorlds();
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    useWorldStore.getState().reportChestLooted('ent_1_1_chest');
    await Promise.resolve();
    useWorldStore.getState().exitWorld();
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    expect(useWorldStore.getState().chestRecord!.chests.ent_1_1_chest).toBeDefined();
    useWorldStore.getState().exitWorld();
  });

  it('the card says which regeneration it stands at', () => {
    expect(SRC('src/components/MissionControl.tsx')).toMatch(/WorldClock\.turns\(world\)/);
  });
});

// -----------------------------------------------------------------------------
// A PIECE TURNS ("rotate needs to be fixed")
// -----------------------------------------------------------------------------

describe('a piece turns where it lies, or at the nearest place it fits, and says so when there is none', () => {
  const piece = (id: string, width: number, height: number): IItem => ({ ...mint(written('tree'), id), id, dimensions: { width, height } });
  const packWith = (items: IItem[], layout: Record<string, { x: number; y: number; rotated: boolean }>) => {
    stage([], items);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventoryLayout: layout } } }));
  };
  const at = (id: string) => player().currentSession!.inventoryLayout![id];
  const overlaps = (items: IItem[], layout: Record<string, { x: number; y: number; rotated: boolean }>) =>
    InventorySystem.usedCells(items, layout) !== items.reduce((n, i) => { const f = InventorySystem.footprint(i, layout[i.id].rotated); return n + f.w * f.h; }, 0);

  // As found on screen: a 2x3 coat packed beside a 1x3 pick. Turned in place it would lie across the pick.
  const coat = () => piece('coat', 2, 3);
  const pick = () => piece('pick', 1, 3);
  const packed = { coat: { x: 0, y: 0, rotated: false }, pick: { x: 2, y: 0, rotated: false } };

  it('with room where it lies, it turns in place', () => {
    const turned = InventorySystem.tryRotate([coat()], { coat: packed.coat }, 'coat');
    expect(turned).toEqual({ x: 0, y: 0, rotated: true });
  });

  it('packed against a neighbour, it turns at the nearest place it fits', () => {
    const items = [coat(), pick()];
    const turned = InventorySystem.tryRotate(items, packed, 'coat');
    expect(turned).not.toBeNull();
    expect(turned!.rotated).toBe(true);
    expect(overlaps(items, { ...packed, coat: turned! })).toBe(false);
    // Nearest: no farther than the first free place below or beside where it lay
    expect(Math.abs(turned!.x - 0) + Math.abs(turned!.y - 0)).toBeLessThanOrEqual(3);
  });

  it('with no room for it turned anywhere, it stays, and the law says there is none', () => {
    // A grid one cell wide: a 1x3 can never lie across it
    expect(InventorySystem.tryRotate([pick()], { pick: { x: 0, y: 0, rotated: false } }, 'pick', 1, 6)).toBeNull();
  });

  it('through the sheet: the piece turns, and nothing lies on anything', () => {
    packWith([coat(), pick()], packed);
    usePlayerStore.getState().rotateItem('coat');
    expect(at('coat').rotated).toBe(true);
    expect(overlaps([coat(), pick()], player().currentSession!.inventoryLayout!)).toBe(false);
    expect(at('pick')).toEqual(packed.pick);
  });

  it('and when the pack has no room for it turned, the feed says why and nothing moves', () => {
    // Every other cell of the 8x6 pack is taken, so a turned 1x3 has nowhere to lie
    const filler: IItem[] = [];
    const layout: Record<string, { x: number; y: number; rotated: boolean }> = { pick: { x: 0, y: 0, rotated: false } };
    for (let y = 0; y < 6; y++) for (let x = 1; x < 8; x++) { const f = piece(`f_${x}_${y}`, 1, 1); filler.push(f); layout[f.id] = { x, y, rotated: false }; }
    for (let y = 3; y < 6; y++) { const f = piece(`f_0_${y}`, 1, 1); filler.push(f); layout[f.id] = { x: 0, y, rotated: false }; }
    packWith([pick(), ...filler], layout);
    usePlayerStore.getState().rotateItem('pick');
    expect(at('pick')).toEqual({ x: 0, y: 0, rotated: false });
    expect(fed()).toMatch(/no room/i);
  });

  it('a piece in the vault turns the same way', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [coat(), pick()], layout: packed }] } } }));
    usePlayerStore.getState().rotateItem('coat');
    const tab = player().bank.stashTabs[0];
    expect(tab.layout!.coat.rotated).toBe(true);
    expect(overlaps(tab.items, tab.layout as any)).toBe(false);
    expect(SRC('src/components/PlayerHub.tsx')).toMatch(/onRotate=\{item => usePlayerStore\.getState\(\)\.rotateItem\(item\.id\)\}/);
  });
});

// -----------------------------------------------------------------------------
// AN EMPTY HAND THROWS THE STONES IT CARRIES ("the pebbles don't lose ammo")
// -----------------------------------------------------------------------------

describe('an empty hand that fires throws a stone it carries, and the stone is spent', () => {
  const stone = (key: string) => mint(written('pebble'), key);
  const hand = () => { const eq = player().equipment!; return eq.items.find(i => i.id === eq.slots.RIGHT_HAND); };
  const pack = () => player().currentSession!.inventory;

  it('the law: an empty hand reaches for the first stone carried; a hand holding anything, or carrying none, does not', () => {
    const [a, b] = [stone('a'), stone('b')];
    const oak = mint(written('tree'), 'oak');
    expect(reachFor(undefined, [oak, a, b])?.id).toBe(a.id);
    expect(reachFor(a, [b])).toBeUndefined();
    expect(reachFor(oak, [a])).toBeUndefined();
    expect(reachFor(undefined, [oak])).toBeUndefined();
    expect(reachFor(undefined, [])).toBeUndefined();
  });

  it('a stone nobody has read is not known to be one, so it is not reached for', () => {
    expect(reachFor(undefined, [{ ...stone('u'), isIdentified: false }])).toBeUndefined();
  });

  it('reached for, it is in the firing hand and out of the pack, and each throw spends one until none is left', () => {
    const [a, b] = [stone('a'), stone('b')];
    stage([], [a, b]);
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: LoadoutSystem.emptyEquipment() } }));
    const first = reachFor(hand(), pack())!;
    expect(usePlayerStore.getState().equipToSlot(first.id, 'RIGHT_HAND').ok).toBe(true);
    expect(hand()!.id).toBe(a.id);
    expect(pack().map(i => i.id)).toEqual([b.id]);
    usePlayerStore.getState().spendThrown('RIGHT_HAND');
    expect(hand()!.id).toBe(b.id);
    usePlayerStore.getState().spendThrown('RIGHT_HAND');
    expect(hand()).toBeUndefined();
    expect(reachFor(hand(), pack())).toBeUndefined();
  });

  it('the field reaches before it fires, and reads the hand again afterwards', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    const reach = field.indexOf('reachFor(activeWeapon().item');
    const fire = field.indexOf('const { slot, item: weapon } = activeWeapon();', reach);
    expect(reach).toBeGreaterThan(0);
    expect(fire).toBeGreaterThan(reach);
  });
});

// -----------------------------------------------------------------------------
// A REST OUTSIDE A WORLD DOES NOT TURN THE DAY
// -----------------------------------------------------------------------------

describe('a rest outside a world restores the character and does not turn their day', () => {
  const DAY = 86_400_000;
  const base = (over: Partial<IPlayer> = {}): IPlayer => ({ ...usePlayerStore.getState().player, currentSession: undefined, ...over });

  it('a night at the inn or in a bed gives the energy back on waking, and the day stands', () => {
    for (const place of ['INN', 'BED'] as const) {
      const awake = RestSystem.wake(RestSystem.beginRest(base({ energyToday: 0, dayCount: 2 }), place, 1000));
      expect(awake.energyToday, place).toBeUndefined();
      expect(awake.rest, place).toBeUndefined();
      expect(awake.dayCount, place).toBe(2);
    }
  });

  it('a rest inside a world is as it was', () => {
    const awake = RestSystem.wake(RestSystem.beginRest(base({ energyToday: 0, dayCount: 2 }), 'FIELD', 1000));
    expect(awake.dayCount).toBe(3);
  });

  it('waking in town says it is the same day, and never another one', async () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined, energyToday: 0, rest: { until: 10, place: 'INN', startedAt: 0 } } }));
    expect(await RestDoor.wakeIfDue(playerPort, hubPort, 20)).toBe(true);
    expect(fed()).toMatch(/same day/i);
    expect(fed()).not.toMatch(/another day/i);
    expect(player().rest).toBeUndefined();
  });

  it('what will not sit for some days counts them on the clock, so no number of rests brings it back sooner', () => {
    const vex = StudySystem.targetOfPerson({ id: 'npc_vex', name: 'Vex', title: 'The Guild' });
    const now = 400 * DAY + 5;
    const lost = { ...base(), studyMarks: { [StudySystem.keyOf(vex)]: { sittings: 1, harm: 1, lostUntilDay: StudySystem.dayOf(now) + STUDY_LOST_DAYS } } } as IPlayer;
    expect(StudySystem.canStudy(lost, vex, now).ok).toBe(false);
    // Seven rests on the same day change nothing
    let rested = lost;
    for (let i = 0; i < 7; i++) rested = RestSystem.wake(RestSystem.beginRest(rested, 'INN', now));
    expect(StudySystem.canStudy(rested, vex, now).ok).toBe(false);
    expect(StudySystem.canStudy(rested, vex, now + (STUDY_LOST_DAYS - 1) * DAY).ok).toBe(false);
    expect(StudySystem.canStudy(rested, vex, now + STUDY_LOST_DAYS * DAY).ok).toBe(true);
  });

  it('a sitting that loses its subject marks the day by the clock it was handed', () => {
    const src = SRC('src/logic/systems/StudySystem.ts');
    expect(src).toMatch(/lostUntilDay: this\.dayOf\(now\) \+ STUDY_LOST_DAYS/);
    expect(src).not.toMatch(/dayCount/);
    expect(SRC('src/logic/systems/StudyDoor.ts')).toMatch(/GameClock\.now\(\)/);
  });
});

// -----------------------------------------------------------------------------
// WHOEVER COMES OUT WITH YOU IS TAKEN TO THE TAVERN ON ARRIVAL
// -----------------------------------------------------------------------------

describe('whoever comes out with you is lodged at the tavern on arrival, with no paper to hand over', () => {
  const bondOf = (name: string, entityId: string): IItem => Escort.bondOf(
    { worldSeed: 'seed_arrivals', entityId, rank: UniversalRank.E, rarity: Rarity.COMMON, sheet: { name, temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 60, attempts: 0 } } as any,
    `bond_${entityId}`, false);

  it('each person in the haul is taken in, and the feed says where they are', async () => {
    const asked: string[] = [];
    const out = await FieldEscort.lodgeArrivals(
      [bondOf('Mara Quill', 'ent_a'), mint(written('tree'), 'log'), bondOf('Io Null', 'ent_b')],
      async id => { asked.push(id); return { ok: true }; });
    expect(asked).toEqual(['bond_ent_a', 'bond_ent_b']);
    expect(out.lodged).toEqual(['Mara Quill', 'Io Null']);
    expect(out.waiting).toEqual([]);
    expect(fed()).toMatch(/Mara Quill has a bed at the Rusty Anchor/);
    expect(fed()).toMatch(/Io Null has a bed at the Rusty Anchor/);
  });

  it('whoever the tavern cannot take stays a bond in the stash, and the feed says why', async () => {
    const out = await FieldEscort.lodgeArrivals([bondOf('Mara Quill', 'ent_a')], async () => ({ ok: false, reason: 'There is no tavern open.' }));
    expect(out.lodged).toEqual([]);
    expect(out.waiting).toEqual(['Mara Quill']);
    expect(fed()).toMatch(/There is no tavern open\./);
    expect(fed()).toMatch(/Mara Quill.*bond.*stash/i);
  });

  it('a haul with nobody in it asks the tavern nothing', async () => {
    let asked = 0;
    await FieldEscort.lodgeArrivals([mint(written('tree'), 'log')], async () => { asked++; return { ok: true }; });
    expect(asked).toBe(0);
    expect(fed()).toBe('');
  });

  it('an extraction does it once the run is sealed and saved', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    const sealed = field.indexOf("PlayerPersistence.flush('extract'");
    const lodged = field.indexOf('FieldEscort.lodgeArrivals(haul');
    expect(sealed).toBeGreaterThan(0);
    expect(lodged).toBeGreaterThan(sealed);
  });
});

// -----------------------------------------------------------------------------
// ONCE THE FIRST ORDER IS SEALED, THE TUTORIAL READS AND DROPS ANYWHERE
// -----------------------------------------------------------------------------

describe('once the first order is sealed, the tutorial reads and drops anywhere', () => {
  const map = () => WorldGenerator.generate('dev-sandbox-v4', 4, ContentRegistry.contextFor(ContentRegistry.defaultThemeId(), UniversalRank.F));
  const elsewhere = (m: ReturnType<typeof map>) => {
    const known = Tutorial.knownBlock(m);
    return { x: (known.x + 1) % m.width, y: known.y };
  };

  it('while the first order stands, only the marked block is read and dropped on', () => {
    const m = map();
    const other = elsewhere(m);
    expect(Tutorial.mayScan(m, other.x, other.y, true).ok).toBe(false);
    expect(Tutorial.mayDrop(m, other.x, other.y, true).ok).toBe(false);
  });

  it('sealed, any block scans and any block takes a drop, as in any world', () => {
    const m = map();
    const other = elsewhere(m);
    expect(Tutorial.mayScan(m, other.x, other.y, false).ok).toBe(true);
    expect(Tutorial.mayDrop(m, other.x, other.y, false).ok).toBe(true);
  });

  it('the refusal says the order is what holds it, and that it ends', () => {
    const m = map();
    const other = elsewhere(m);
    expect(Tutorial.mayScan(m, other.x, other.y, true).reason).toMatch(/first order/i);
  });

  it('the view asks the law with whether the first order still stands', () => {
    const view = SRC('src/components/ReconView.tsx');
    expect(view).toMatch(/Tutorial\.mayScan\(currentMap, sx, sy, firstOrder\)/);
    expect(view).toMatch(/Tutorial\.mayDrop\(currentMap, x, y, firstOrder\)/);
    expect(view).toMatch(/Tutorial\.mayDrop\(currentMap, selected\.x, selected\.y, firstOrder\)/);
  });
});

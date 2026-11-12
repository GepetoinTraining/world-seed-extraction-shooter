/**
 * THE TUTORIAL'S FIVE TASKS (TQ), bars set before the build and seen red.
 *
 * Pedro, 2026-11-12: "also, remove the tutorial after the first run, make it staged with quests 1. kill 3 mobs 2. open a
 * chest 3. grab materials 4. bring one npc out 5. extract. once the 5 are done allow the player to place a free point and
 * ask the voice for a gift, they get a tweet, one short tweet, to get themselves a gift".
 *
 * The coordinator's calls, each an open ledger row:
 *   1. the five are kept on the character and shown in the field as a short list in his order, the first not yet done
 *      marked as the current one, done ones ticked by a mark and a word, never by hue;
 *   2. a thing done ahead of its turn counts; extract counts only with the other four done;
 *   3. what counts: three creatures felled, one chest opened, material taken from one place, one person walked out
 *      alive, extracting;
 *   4. the tutorial's ground always holds what the five need, laid from the way in to the way out in his order;
 *   5. a death keeps every tick and costs nothing;
 *   6. when the fifth is done the tutorial is over for that character, on every screen; the world is not deleted;
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

import React, { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { IAttributes, IItem, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { emptyPopulationRecord } from '../shared/entities/world/Population';
import { emptyChestRecord } from '../shared/entities/world/ChestSystem';
import { DROP_CLEAR_TILES, WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { TerrainSystem } from '../shared/entities/world/TerrainSystem';
import { TILE_PX, tileOf } from '../shared/entities/world/grid';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ExtractLaw } from '../shared/logic/systems/ExtractLaw';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { FieldEscort } from '../src/logic/systems/FieldEscort';
import { Tutorial, TUTORIAL_WORLD_ID } from '../src/logic/systems/Tutorial';
import { FIRST_TASKS, CREATURES_TO_FELL, FirstOrder } from '../src/logic/systems/FirstOrder';
import { FirstOrderDoor } from '../src/logic/systems/FirstOrderDoor';
import { FirstOrderLane } from '../src/logic/systems/FirstOrderLane';
import { deployToWorld } from '../src/logic/systems/Deploy';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useWorldStore, worldPort, IWorldCard } from '../src/entities/world/store';
import { hubPort } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { quickDeployTargetId } from '../src/entities/hub/dialogue';
import { MissionControl } from '../src/components/MissionControl';
import { TutorialGuide } from '../src/components/TutorialGuide';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_firstorder';
const CERT = (uid: string, name: string) => ({ metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;
const player = () => usePlayerStore.getState().player;
const record = () => FirstOrder.of(player());
const M = 60_000;

const openWorld = (over: Partial<IWorldCard> = {}): IWorldCard => ({
  id: 'w_other', seed: 'grey-reach', size: 16, createdAt: Date.now() - 10 * M, playerCount: 0, name: 'Grey Reach', difficulty: 'F' as never,
  creator: 'x', extractionTaxRate: 0.05, deathPenalty: 'INVENTORY_LOSS', ...over
});
const written = (form: string) => Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && (d as any).visuals?.modelId === form)! as any;
const mint = (def: any, key: string): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(key));

/** Standing in a one-chunk field of the tutorial (or another world) with these bodies, and this in the pack. */
const stage = (entities: IWorldEntity[], inTutorial = true, carried: IItem[] = []) => {
  const card = inTutorial ? Tutorial.card(Date.now(), Date.now()) : openWorld();
  useWorldStore.setState({
    currentMap: { seed: 'seed_firstorder', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities } } } as any,
    availableWorlds: [card], activeWorldId: card.id, chestRecord: emptyChestRecord(), populationRecord: emptyPopulationRecord(), generation: 0
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      currentSession: { sessionId: 'sess_fo', layerId: 'l', inventory: carried, kitItemIds: [], health: 100, maxHealth: 100, energy: 100_000, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
    }
  }));
};
const chest = (id = 'ent_1_1_chest'): IWorldEntity => ({
  id, type: EntityType.CONTAINER, definitionId: 'chest_ruin', position: { x: 10, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  container: { lootRank: UniversalRank.F, looted: false, hasLore: true }
} as IWorldEntity);
const place = (def: any, id = 'ent_1_1_r0'): IWorldEntity => ({
  id, type: EntityType.RESOURCE, definitionId: def.id, position: { x: 10, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, usesRemaining: 3
} as IWorldEntity);
const someone = (id = 'ent_1_1_npc'): IWorldEntity => ({
  id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 40, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 99, attempts: 0 }
} as IWorldEntity);
const sure = (over: Partial<IAttributes> = {}): IAttributes =>
  ({ ...Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 2])), ...over }) as unknown as IAttributes;
/** Every task but these, already done. */
const doneBut = (...left: string[]) => {
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      firstOrder: { felled: left.includes('FELL') ? 0 : CREATURES_TO_FELL, done: Object.fromEntries(FIRST_TASKS.filter(t => !left.includes(t)).map(t => [t, 1])) }
    }
  }));
};

let root: Root | null = null;
let host: HTMLDivElement;
const mount = async (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};
const text = () => host.textContent ?? '';

beforeEach(() => {
  db.clear();
  localStorage.clear();
  MobAI.reset();
  useFeed.setState({ lines: [] });
  useIdentityStore.setState({ certificate: CERT(UID, 'FIRSTLING') } as any);
  usePlayerStore.getState().initializeSession(CERT(UID, 'FIRSTLING'), 'NOMAD');
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// CALLS 1 TO 3: THE FIVE, IN HIS ORDER
// -----------------------------------------------------------------------------

describe('the first order is five tasks, in his order', () => {
  it('a newcomer has five, none done, and the first is the current one', () => {
    expect(FIRST_TASKS).toEqual(['FELL', 'CHEST', 'MATERIAL', 'PERSON', 'OUT']);
    expect(CREATURES_TO_FELL).toBe(3);
    expect(record()).toEqual({ felled: 0, done: {} });
    expect(FirstOrder.current(record())).toBe('FELL');
    expect(FirstOrder.allDone(record())).toBe(false);
  });

  it('felling counts to three, and the third ticks it', () => {
    let p = player();
    p = FirstOrder.tick(p, 'FELL', 1).player;
    p = FirstOrder.tick(p, 'FELL', 2).player;
    expect(FirstOrder.isDone(FirstOrder.of(p), 'FELL')).toBe(false);
    const third = FirstOrder.tick(p, 'FELL', 3);
    expect(third.ticked).toBe(true);
    expect(FirstOrder.isDone(FirstOrder.of(third.player), 'FELL')).toBe(true);
    expect(FirstOrder.of(third.player).done.FELL).toBe(3);
    // Two at once count as two
    expect(FirstOrder.of(FirstOrder.tick(player(), 'FELL', 5, 2).player).felled).toBe(2);
  });

  it('call 2: a thing done ahead of its turn counts when it is done, and the current one is the first not done', () => {
    const p = FirstOrder.tick(player(), 'CHEST', 7).player;
    expect(FirstOrder.of(p).done.CHEST).toBe(7);
    expect(FirstOrder.current(FirstOrder.of(p))).toBe('FELL');
  });

  it('call 2: extract counts only with the other four done; before, nothing is ticked and the order stands', () => {
    doneBut('PERSON', 'OUT');
    const early = FirstOrder.tick(player(), 'OUT', 9);
    expect(early.ticked).toBe(false);
    expect(early.sealed).toBe(false);
    expect(FirstOrder.of(early.player).done.OUT).toBeUndefined();
    expect(Tutorial.firstOrderOpen(early.player)).toBe(true);
  });

  it('with the other four done, extracting ends the first order, once', () => {
    doneBut('OUT');
    const out = FirstOrder.tick(player(), 'OUT', 11);
    expect(out.ticked).toBe(true);
    expect(out.sealed).toBe(true);
    expect(out.player.tutorialSealedAt).toBe(11);
    expect(Tutorial.firstOrderOpen(out.player)).toBe(false);
    const again = FirstOrder.tick(out.player, 'OUT', 12);
    expect(again.ticked).toBe(false);
    expect(again.player).toBe(out.player);
  });

  it('call 1: the list says each in words, the current one by a mark and a word, and done ones by a mark and a word', () => {
    const p = FirstOrder.tick(FirstOrder.tick(player(), 'FELL', 1).player, 'CHEST', 2).player;
    const rows = FirstOrder.rows(FirstOrder.of(p));
    expect(rows.map(r => r.task)).toEqual(FIRST_TASKS);
    expect(rows[0].title).toMatch(/1 of 3/);
    const chestRow = rows.find(r => r.task === 'CHEST')!;
    expect(chestRow.done).toBe(true);
    expect(chestRow.mark).not.toBe(rows[0].mark);
    expect(chestRow.word).toBe('DONE');
    expect(rows[0].current).toBe(true);
    expect(rows[0].word).toBe('NOW');
    const later = rows.find(r => r.task === 'PERSON')!;
    expect(later.current).toBe(false);
    expect(later.mark).not.toBe(rows[0].mark);
    expect(later.mark).not.toBe(chestRow.mark);
    for (const r of rows) expect(r.title.length).toBeGreaterThan(0);
    expect(FirstOrder.hint('FELL').length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// CALL 3: WHAT COUNTS, WHERE THE GAME ALREADY DOES IT
// -----------------------------------------------------------------------------

describe('what counts, where the game already does it', () => {
  it('a chest opened in the tutorial ticks the chest; in any other world nothing', () => {
    stage([chest()]);
    usePlayerStore.getState().performInteraction('int_open_ent_1_1_chest', 'ent_1_1_chest');
    expect(record().done.CHEST).toBeGreaterThan(0);

    usePlayerStore.getState().initializeSession(CERT(UID, 'FIRSTLING'), 'NOMAD');
    stage([chest()], false);
    usePlayerStore.getState().performInteraction('int_open_ent_1_1_chest', 'ent_1_1_chest');
    expect(record().done.CHEST).toBeUndefined();
  });

  it('material taken from a place ticks the material: a stone picked up', () => {
    const stone = written('pebble');
    stage([place(stone, 'ent_1_1_loose0')]);
    usePlayerStore.getState().performInteraction('int_harvest_ent_1_1_loose0', 'ent_1_1_loose0');
    expect(record().done.MATERIAL).toBeGreaterThan(0);
  });

  it('a try with bare hands that comes away ticks it; one that slips does not', () => {
    const berry = Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && ExtractLaw.asks(d as never).length === 0 && !(d as any).visuals?.modelId?.includes('pebble'))! as any;
    let landed = false;
    for (let n = 0; n < 40 && !landed; n++) {
      stage([place(berry, `ent_1_1_r${n}`)]);
      usePlayerStore.getState().performInteraction(`int_try_ent_1_1_r${n}`, `ent_1_1_r${n}`);
      const took = (player().currentSession?.inventory ?? []).length > 0;
      expect(!!record().done.MATERIAL).toBe(took);
      landed = took;
    }
    expect(landed).toBe(true);
  });

  it('a person walked out alive ticks it; one carried out does not', () => {
    stage([someone()]);
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: sure({ charisma: 6, strength: 9 }), baseAttributes: sure({ charisma: 6, strength: 9 }) } }));
    usePlayerStore.getState().performInteraction('int_recruit_ent_1_1_npc', 'ent_1_1_npc');
    expect(player().currentSession!.escorts?.[0]?.entityId).toBe('ent_1_1_npc');
    FieldEscort.walkOut(worldPort, playerPort);
    expect(record().done.PERSON).toBeGreaterThan(0);

    usePlayerStore.getState().initializeSession(CERT(UID, 'FIRSTLING'), 'NOMAD');
    stage([someone()]);
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: sure({ charisma: 6, strength: 9 }), baseAttributes: sure({ charisma: 6, strength: 9 }) } }));
    usePlayerStore.getState().performInteraction('int_recruit_ent_1_1_npc', 'ent_1_1_npc');
    FieldEscort.fall('ent_1_1_npc', worldPort, playerPort);
    expect(FieldEscort.carry('ent_1_1_npc', worldPort, playerPort)).toBe(true);
    FieldEscort.walkOut(worldPort, playerPort);
    expect(record().done.PERSON).toBeUndefined();
  });

  it('kills: the door counts what the field hands it, in the tutorial only', () => {
    stage([]);
    expect(FirstOrderDoor.note('FELL', worldPort, playerPort, 2)).toBe(true);
    expect(record().felled).toBe(2);
    stage([], false);
    expect(FirstOrderDoor.note('FELL', worldPort, playerPort, 1)).toBe(false);
    expect(record().felled).toBe(2);
  });

  it('the field hands the door the kills it pays for, and the extraction after whoever walked out', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    expect(field).toMatch(/FirstOrderDoor\.note\('FELL'/);
    const extraction = field.slice(field.indexOf('const completeExtraction'), field.indexOf('// 1. Drop Confirmation'));
    expect(extraction.indexOf("FirstOrderDoor.note('OUT'")).toBeGreaterThan(extraction.indexOf('FieldEscort.walkOut'));
    // The old mark set by any extraction is gone: the fifth sets it
    expect(extraction).not.toMatch(/tutorialSealedAt: Date\.now\(\)/);
  });

  it('call 5: a death in the tutorial keeps every tick and costs nothing', () => {
    const kit = [mint(written('pebble'), 'kit:stone')];
    stage([], true, kit);
    FirstOrderDoor.note('FELL', worldPort, playerPort, 3);
    FirstOrderDoor.note('CHEST', worldPort, playerPort);
    const before = record();
    const outcome = usePlayerStore.getState().emergencyJackOut(Tutorial.card(0).deathPenalty);
    expect(outcome.lost).toEqual([]);
    expect(record()).toEqual(before);
    expect(player().bank.stashTabs[0].items.map(i => i.id)).toContain(kit[0].id);
  });
});

// -----------------------------------------------------------------------------
// CALL 4: THE GROUND ALWAYS HOLDS WHAT THE FIVE NEED
// -----------------------------------------------------------------------------

describe("the tutorial's ground always holds what the five need, laid on the way out in his order", () => {
  /** The tutorial opened by this person, with every piece of their lane's chunks built. */
  const open = async (carried: IItem[] = []) => {
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: carried }] } } }));
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now(), Date.now())] } as never);
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    const map = useWorldStore.getState().currentMap!;
    const way = FirstOrderLane.way(map)!;
    expect(way).not.toBeNull();
    for (let d = 0; d <= way.length; d += 600) {
      const f = d / way.length;
      useWorldStore.getState().loadAround(way.from.x + (way.to.x - way.from.x) * f, way.from.y + (way.to.y - way.from.y) * f, 900);
    }
    const key = FirstOrderLane.keyOf(player().id);
    const laid = Object.values(useWorldStore.getState().currentMap!.chunks).flatMap(c => c.entities).filter(e => e.id.startsWith(`${key}_`));
    return { map, way, laid, key };
  };
  const along = (way: { from: { x: number; y: number }; to: { x: number; y: number }; length: number }, e: IWorldEntity) =>
    ((e.position.x - way.from.x) * (way.to.x - way.from.x) + (e.position.y - way.from.y) * (way.to.y - way.from.y)) / way.length;

  it('three creatures of the kind a newcomer fells most easily, a chest, a place a bare hand takes and one person', async () => {
    const { laid } = await open();
    const creatures = laid.filter(e => e.type === EntityType.MOB);
    expect(creatures).toHaveLength(3);
    expect(new Set(creatures.map(c => c.definitionId)).size).toBe(1);
    expect(creatures.every(c => c.isHostile && c.rank === UniversalRank.F)).toBe(true);
    expect(laid.filter(e => e.type === EntityType.CONTAINER && e.container && !e.container.looted && e.id.endsWith('_chest'))).toHaveLength(1);
    const bare = laid.filter(e => e.type === EntityType.RESOURCE && ExtractLaw.asks(RESOURCE_DEFINITIONS[e.definitionId] as never).length === 0);
    expect(bare.length).toBeGreaterThanOrEqual(1);
    expect(laid.filter(e => e.type === EntityType.NPC && e.npc)).toHaveLength(1);
  });

  it('the creatures are the weakest the land lays, by rank and then by what they hold and deal', async () => {
    const { laid } = await open();
    const kind = FirstOrderLane.creatureOf(ContentRegistryContext()) as any;
    expect(laid.find(e => e.type === EntityType.MOB)!.definitionId).toBe(kind.id);
    const all = ContentRegistryContext().mobDefinitions as any[];
    const plain = all.filter(m => !(m.tags ?? []).some((t: string) => ['elite', 'boss', 'titan', 'god'].includes(t)));
    const order = Object.values(UniversalRank) as string[];
    const lowest = Math.min(...plain.map(m => order.indexOf(m.rank)));
    expect(order.indexOf(kind.rank)).toBe(lowest);
    expect(plain.filter(m => order.indexOf(m.rank) === lowest).every(m => m.baseHealth * m.baseDamage >= kind.baseHealth * kind.baseDamage)).toBe(true);
  });

  it('in his order from the drop to the beacon, every piece on open ground and outside the clear ground of the drop', async () => {
    const { way, laid, map } = await open();
    const at = (pred: (e: IWorldEntity) => boolean) => laid.filter(pred).map(e => along(way, e));
    const creatures = at(e => e.type === EntityType.MOB);
    const chests = at(e => e.type === EntityType.CONTAINER);
    const places = at(e => e.type === EntityType.RESOURCE);
    const people = at(e => e.type === EntityType.NPC);
    expect(Math.max(...creatures)).toBeLessThan(Math.min(...chests));
    expect(Math.max(...chests)).toBeLessThan(Math.min(...places));
    expect(Math.max(...places)).toBeLessThan(Math.min(...people));
    expect(Math.max(...people)).toBeLessThan(way.length);
    for (const e of laid) {
      expect(TerrainSystem.isBlockedTile(map.seed, tileOf(e.position.x), tileOf(e.position.y))).toBe(false);
      expect(Math.hypot(e.position.x - way.from.x, e.position.y - way.from.y)).toBeGreaterThan(DROP_CLEAR_TILES * TILE_PX);
    }
    // One to a tile
    expect(new Set(laid.map(e => `${tileOf(e.position.x)},${tileOf(e.position.y)}`)).size).toBe(laid.length);
  });

  it('a tool the person carries gets a place it takes; with none, no such place, and the bare hand still has one', async () => {
    const toolFit = (carried: IItem[]) => (e: IWorldEntity) => {
      const def = RESOURCE_DEFINITIONS[e.definitionId] as never;
      return ExtractLaw.asks(def).length > 0 && !!ExtractLaw.toolFor(carried, def);
    };
    const none = await open([]);
    expect(none.laid.filter(e => e.type === EntityType.RESOURCE && ExtractLaw.asks(RESOURCE_DEFINITIONS[e.definitionId] as never).length > 0)).toHaveLength(0);
    const tool = FirstOrderLane.toolPlaceOf(ContentRegistryContext(), [pickaxe()]);
    expect(tool).not.toBeNull();
    const withPick = await open([pickaxe()]);
    expect(withPick.laid.filter(e => e.type === EntityType.RESOURCE && toolFit([pickaxe()])(e))).toHaveLength(1);
  });

  it("keyed by the person: the same person meets the same lane, and another person another lane of their own", async () => {
    const first = await open();
    const again = await open();
    expect(again.laid.map(e => `${e.id}@${e.position.x},${e.position.y}`).sort()).toEqual(first.laid.map(e => `${e.id}@${e.position.x},${e.position.y}`).sort());
    useIdentityStore.setState({ certificate: CERT('uid_someone_else', 'OTHER') } as any);
    usePlayerStore.getState().initializeSession(CERT('uid_someone_else', 'OTHER'), 'NOMAD');
    const other = await open();
    expect(other.key).not.toBe(first.key);
    expect(other.laid.length).toBe(first.laid.length);
    expect(other.laid.some(e => first.laid.some(f => f.id === e.id))).toBe(false);
  });

  it('it stands only in the tutorial, and only while the first order does', async () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, tutorialSealedAt: 1 } }));
    const sealed = await open();
    expect(sealed.laid).toHaveLength(0);
    expect(SRC('src/entities/world/store.ts')).toMatch(/Tutorial\.isTutorial\(worldCard\) && Tutorial\.firstOrderOpen\(/);
  });

  it("what one takes stays taken by the world's own records: the chest opened stays empty its cycle, the person brought out never stands again", async () => {
    const { laid } = await open();
    const box = laid.find(e => e.type === EntityType.CONTAINER)!;
    const person = laid.find(e => e.type === EntityType.NPC)!;
    useWorldStore.getState().reportLeft(person.id);
    worldPort.apply({ kind: 'CHEST_LOOTED', chestId: box.id });
    await new Promise(r => setTimeout(r, 0));
    const after = await open();
    expect(after.laid.find(e => e.id === person.id)).toBeUndefined();
    expect(after.laid.find(e => e.id === box.id)?.container?.looted).toBe(true);
    // Found while building: one of the lane carried out is gone for good and is not counted, so the next stands in their place
    const next = after.laid.filter(e => e.type === EntityType.NPC);
    expect(next).toHaveLength(1);
    expect(next[0].id).not.toBe(person.id);
  });
});

/** The tutorial's own content, as its world reads it. */
function ContentRegistryContext() {
  return ContentRegistry.contextFor(Tutorial.card(0).themeId, 'F');
}
/** A pick, as the tools kit carries one: a tool whose words fit a vein. */
function pickaxe(): IItem {
  return { id: 'item_pick_fo', name: 'Claim Pick', type: 'TOOL', rank: UniversalRank.F, rarity: Rarity.COMMON, tags: ['tool', 'pickaxe'], toolData: { toolTags: ['pickaxe'], power: 1 }, affixes: [], value: 1, weight: 1, dimensions: { width: 1, height: 2 }, stats: { maxDurability: 100 } } as unknown as IItem;
}

// -----------------------------------------------------------------------------
// CALL 6: ONCE THE FIFTH IS DONE, NOTHING OFFERS THE TUTORIAL AGAIN
// -----------------------------------------------------------------------------

describe('once the fifth is done, nothing offers the tutorial again', () => {
  const sealNow = () => {
    doneBut('OUT');
    usePlayerStore.setState(s => ({ player: FirstOrder.tick(s.player, 'OUT', Date.now()).player }));
    expect(Tutorial.firstOrderOpen(player())).toBe(false);
  };

  it('the zones list shows it while the order stands, and not after', async () => {
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now(), Date.now()), openWorld()], refreshWorlds: async () => {} } as never);
    await mount(createElement(MissionControl));
    expect(text()).toMatch(/THE TUTORIAL/);
    await act(async () => { sealNow(); });
    expect(text()).not.toMatch(/THE TUTORIAL/);
    expect(text()).toMatch(/GREY REACH/);
  });

  it('quick deploy never reaches it again, even with no world of their own', () => {
    sealNow();
    expect(quickDeployTargetId([Tutorial.card(Date.now(), Date.now()), openWorld({ id: 'mine' })], player())).toBe('mine');
    expect(quickDeployTargetId([Tutorial.card(Date.now(), Date.now())], player())).toBeNull();
  });

  it('the one door into a world refuses it, and the world itself still stands for others', async () => {
    sealNow();
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now(), Date.now())] } as never);
    const res = await deployToWorld(TUTORIAL_WORLD_ID, worldPort, playerPort, hubPort);
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
    expect(player().currentSession).toBeUndefined();
    expect(Tutorial.offered([Tutorial.card(Date.now(), Date.now())], { ...player(), tutorialSealedAt: undefined })).toHaveLength(1);
  });

  it('the field shows the list in the tutorial only, with the current one and the done ones by mark and word', async () => {
    stage([]);
    FirstOrderDoor.note('CHEST', worldPort, playerPort);
    await mount(createElement(TutorialGuide, { at: { x: 0, z: 0 }, exit: null }));
    const shown = text();
    for (const r of FirstOrder.rows(record())) expect(shown).toContain(r.title);
    expect(shown).toContain('NOW');
    expect(shown).toContain('DONE');
    await act(async () => { root!.unmount(); });
    root = null;
    stage([], false);
    await mount(createElement(TutorialGuide, { at: { x: 0, z: 0 }, exit: null }));
    expect(text()).toBe('');
  });
});

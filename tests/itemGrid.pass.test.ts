/**
 * THE ITEM GRID, AND DROPPING BY DRAGGING OUT (the interface pass, part 1), bars set before the build.
 *
 * Pedro, 2026-11-11: "dragging items outside to drop would be good too ... and an overall better
 * inventory tetris system would be good". DESIGN_BACKLOG.md 1.2 and 1.4.
 *
 * The shape chosen for stacks: every piece stays its own thing in the list, as today, so whatever
 * counts, sells, crafts, drops or throws still sees each one. A stack is only where things lie: like
 * pieces share one placement, one footprint. Nothing caps a stack; the weight does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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
    signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useWorldStore } from '../src/entities/world/store';
import '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { useFeed } from '../src/components/ui/stores';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { InventorySystem, GRID_H, GRID_W } from '../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { CartSystem } from '../src/entities/world/CartSystem';
import { StashGrid } from '../src/entities/player/systems/StashGrid';
import { Held, Place, probeMove, commitMove, GROUND_REACH } from '../src/logic/systems/ItemHands';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { shortIdOf } from '../shared/logic/theme/ThemeCompiler';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_gridpass';
const CERT = (uid: string) => ({ metadata: { uid, displayName: 'GRID', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;

installShippedThemes();
const sid = shortIdOf(FIRST_THEME_PACK.themeId);
const res = (key: string) => RESOURCE_DEFINITIONS[`res_${sid}_${key}`] as any;
let minted = 0;
const mint = (key: string, quality = 0): IItem => ItemFactory.createResourceItem(res(key), Rng.fromKey(`gridpass:${key}:${++minted}`), { quality });
const pebbles = (n: number) => Array.from({ length: n }, () => mint('tally_pebble'));

/** One-off things that never stack with each other: each its own kind. */
const odd = (id: string, w = 1, h = 1, weight = 1): IItem => ({
  id, universalDefinitionId: `odd_${id}`, name: id.toUpperCase(), description: '', type: ItemType.RESOURCE, slot: SlotType.NONE,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1, value: 1, itemPower: 0, tags: ['material'], affixes: [],
  dimensions: { width: w, height: h }, weight, stats: {}, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i',
  history: { dropDate: 0, killCount: 0 }, isIdentified: true
}) as IItem;

const store = () => usePlayerStore.getState();
const session = () => store().player.currentSession!;
const lines = () => useFeed.getState().lines.map(l => l.text);
const entities = () => Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).flatMap((c: any) => c.entities as IWorldEntity[]);
const piles = () => entities().filter(e => e.definitionId === 'ground_cache');

function field(items: IItem[], extra: IWorldEntity[] = [], at = { x: 0, z: 0 }) {
  useWorldStore.setState({
    currentMap: { seed: 'grid_world', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities: extra } } }
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      currentSession: {
        sessionId: 'sess_gridpass', layerId: 'l', inventory: [...items], inventoryLayout: InventorySystem.placeAll(items),
        kitItemIds: [], health: 100, maxHealth: 100, energy: 1000, position: { x: at.x, y: 0, z: at.z }, statusEffects: []
      } as any
    }
  }));
  store().recalcWeight();
}

const cartWith = (id: string, items: IItem[]): IWorldEntity => {
  let cart = CartSystem.newCart({ ...odd('kit_' + id), cartData: { gridW: 10, gridH: 8 } } as IItem, UID, 'GRID');
  for (const item of items) cart = CartSystem.load(cart, item)!;
  return { id, type: EntityType.CART, definitionId: 'cart_field', position: { x: 20, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, cart } as any;
};
const cartOf = (id: string) => entities().find(e => e.id === id)!.cart!;

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  useIdentityStore.setState({ certificate: CERT(UID) } as any);
  store().initializeSession(CERT(UID), 'NOMAD');
  usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, strength: 500 }, equipment: LoadoutSystem.emptyEquipment() } }));
});

// -----------------------------------------------------------------------------
// LIKE THINGS STACK
// -----------------------------------------------------------------------------

describe('what is alike: the same kind, rank, quality as shown, read or unread alike, no properties of its own', () => {
  it('two pebbles of one harvest are alike; a different quality, an unread one, or one with an affix is not', () => {
    const [a, b] = pebbles(2);
    expect(InventorySystem.stackKey(a)).not.toBeNull();
    expect(InventorySystem.stackKey(a)).toBe(InventorySystem.stackKey(b));
    // Quality as the card shows it: a whole percent
    expect(InventorySystem.stackKey(mint('tally_pebble', 0.101))).toBe(InventorySystem.stackKey(mint('tally_pebble', 0.104)));
    expect(InventorySystem.stackKey(mint('tally_pebble', 0.1))).not.toBe(InventorySystem.stackKey(mint('tally_pebble', 0.2)));
    expect(InventorySystem.stackKey({ ...a, isIdentified: false })).not.toBe(InventorySystem.stackKey(a));
    expect(InventorySystem.stackKey({ ...a, affixes: [{ id: 'x', name: 'X', type: 'PREFIX', stats: {} } as any] })).toBeNull();
  });

  it('gear, a pouch, a charm, a cage and a cart kit never stack', () => {
    const p = pebbles(1)[0];
    expect(InventorySystem.stackKey({ ...p, type: ItemType.GEAR })).toBeNull();
    expect(InventorySystem.stackKey({ ...p, pouchData: { accepts: [], capacity: 1, contents: [] } })).toBeNull();
    expect(InventorySystem.stackKey({ ...p, type: ItemType.CONSUMABLE, charmData: { slots: 1, chosen: false, uses: 1 } })).toBeNull();
    expect(InventorySystem.stackKey({ ...p, type: ItemType.CONSUMABLE, creatureData: {} as any })).toBeNull();
    expect(InventorySystem.stackKey({ ...p, cartData: { gridW: 10, gridH: 8 } })).toBeNull();
  });

  it('like pieces picked up share one footprint and weigh their sum; nothing caps the count', () => {
    const many = pebbles(60);
    let layout: Record<string, any> = {};
    const held: IItem[] = [];
    for (const p of many) {
      const at = InventorySystem.autoPlace(held, layout, p);
      expect(at).not.toBeNull();
      layout = { ...layout, [p.id]: at! };
      held.push(p);
    }
    expect(InventorySystem.usedCells(held, layout)).toBe(1);
    expect(InventorySystem.stacks(held, layout)).toHaveLength(1);
    expect(InventorySystem.stacks(held, layout)[0].ids).toHaveLength(60);
    expect(InventorySystem.totalWeight(held)).toBeCloseTo(60 * many[0].weight, 5);
  });

  it('a like piece may be set exactly on its stack; offset, or an unlike piece, may not', () => {
    const [a, b] = pebbles(2);
    const other = odd('other');
    const layout = { [a.id]: { x: 2, y: 2, rotated: false }, [other.id]: { x: 5, y: 2, rotated: false } };
    const items = [a, other, b];
    expect(InventorySystem.fitsAt(items, layout, b, 2, 2, false)).toBe(true);
    expect(InventorySystem.fitsAt(items, layout, b, 5, 2, false)).toBe(false);
    expect(InventorySystem.fitsAt(items, layout, odd('third'), 2, 2, false)).toBe(false);
  });

  it('a whole stack may move one cell over where it lay, every piece of it in hand at once', () => {
    const reeds = Array.from({ length: 3 }, () => mint('tellers_reed'));
    const layout: Record<string, any> = {};
    for (const r of reeds) layout[r.id] = { x: 0, y: 0, rotated: false };
    const { w } = InventorySystem.footprint(reeds[0], false);
    expect(InventorySystem.fitsAt(reeds, layout, reeds[0], 0, 1, false, GRID_W, GRID_H, reeds.map(r => r.id))).toBe(true);
    // Only the first in hand, the rest still lying there: the old place blocks it when the shapes overlap
    if (InventorySystem.footprint(reeds[0], false).h > 1) {
      expect(InventorySystem.fitsAt(reeds, layout, reeds[0], 0, 1, false, GRID_W, GRID_H, [reeds[0].id])).toBe(false);
    }
    expect(w).toBeGreaterThan(0);
  });

  it('a layout put back together gathers like things scattered: six pebbles and two others take three footprints', () => {
    const items = [...pebbles(6), odd('a'), odd('b')];
    const layout = InventorySystem.placeAll(items);
    expect(Object.keys(layout)).toHaveLength(8);
    expect(InventorySystem.stacks(items, layout)).toHaveLength(3);
  });

  it('the pack says when it is full: forty-eight odd pieces fill it, forty-eight pebbles do not', () => {
    const odds = Array.from({ length: GRID_W * GRID_H }, (_, i) => odd(`o${i}`));
    expect(InventorySystem.isFull(odds, InventorySystem.placeAll(odds))).toBe(true);
    const peb = pebbles(GRID_W * GRID_H);
    expect(InventorySystem.isFull(peb, InventorySystem.placeAll(peb))).toBe(false);
  });

  it('the vault keeps a stack where it lies, lets a like piece join it, and its sorts stack like things', () => {
    const [a, b, c] = pebbles(3);
    const layout = StashGrid.resolve([a, b], { [a.id]: { x: 3, y: 1, rotated: false }, [b.id]: { x: 3, y: 1, rotated: false } });
    expect(layout[b.id]).toEqual(layout[a.id]);
    expect(StashGrid.canPlace([a, b, c], layout, c.id, 1, 1, 3, 1)).toBe(true);
    const sorted = StashGrid.arrange([a, odd('x'), b, c], 'NAME');
    expect(InventorySystem.stacks([a, b, c], sorted)).toHaveLength(1);
  });

  it('a load is told in words, not by a tone alone', () => {
    expect(InventorySystem.loadWord(10, 100)).toBe('');
    expect(InventorySystem.loadWord(85, 100)).toMatch(/SLOWED/);
    expect(InventorySystem.loadWord(110, 100)).toMatch(/OVER/);
  });
});

// -----------------------------------------------------------------------------
// THE PACK'S OWN DOORS
// -----------------------------------------------------------------------------

describe('the pack arranges, sorts, refuses aloud and says when it is full', () => {
  it('packing tight keeps every piece and stacks like ones', () => {
    const items = [...pebbles(5), odd('big', 2, 3), odd('long', 1, 3), ...pebbles(3)];
    field(items);
    // Scatter them first: each in its own cell, the way an old save holds them
    const scattered: Record<string, any> = {};
    items.forEach((it, i) => { scattered[it.id] = { x: (i * 2) % GRID_W, y: Math.floor((i * 2) / GRID_W) * 3, rotated: false }; });
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventoryLayout: InventorySystem.placeAll(items) } } }));
    const v = store().arrangePack('TIGHT');
    expect(v.ok).toBe(true);
    expect(session().inventory.map(i => i.id).sort()).toEqual(items.map(i => i.id).sort());
    expect(Object.keys(session().inventoryLayout!).sort()).toEqual(items.map(i => i.id).sort());
    expect(InventorySystem.stacks(session().inventory, session().inventoryLayout!)).toHaveLength(3);
  });

  it('the stash\'s sorts sort the pack too, and a sort that cannot hold everything moves nothing', () => {
    const items = [odd('zeta'), odd('alpha'), odd('mid')];
    field(items);
    expect(store().arrangePack('NAME').ok).toBe(true);
    const at = (id: string) => session().inventoryLayout![id];
    expect(at('alpha').y * GRID_W + at('alpha').x).toBeLessThan(at('zeta').y * GRID_W + at('zeta').x);
    expect(InventorySystem.packInOrder([odd('w', GRID_W, GRID_H), odd('one')])).toBeNull();
  });

  it('a pickup that does not fit is refused on the screen, saying why', () => {
    const odds = Array.from({ length: GRID_W * GRID_H }, (_, i) => odd(`o${i}`, 1, 1, 0.1));
    field(odds);
    const { rejected } = store().tryAddItems([odd('one_more')]);
    expect(rejected).toHaveLength(1);
    expect(lines().join(' | ')).toMatch(/pack is full/i);
    useFeed.setState({ lines: [] });
    field([]);
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, strength: 0 } } }));
    store().tryAddItems([odd('anvil', 1, 1, 9999)]);
    expect(lines().join(' | ')).toMatch(/weight/i);
  });

  it('a stack moves whole, and a split moves only what is in hand', () => {
    const four = pebbles(4);
    field(four);
    const head = four[0];
    const ids = four.map(i => i.id);
    expect(store().placeInPack(head.id, 5, 4, false, ids).ok).toBe(true);
    for (const id of ids) expect(session().inventoryLayout![id]).toEqual({ x: 5, y: 4, rotated: false });
    expect(store().placeInPack(four[2].id, 0, 0, false, [four[2].id, four[3].id]).ok).toBe(true);
    expect(InventorySystem.stacks(session().inventory, session().inventoryLayout!).map(s => s.ids.length).sort()).toEqual([2, 2]);
    expect(session().inventory).toHaveLength(4);
  });

  it('turning a stack turns every piece of it', () => {
    const reeds = Array.from({ length: 3 }, () => mint('tellers_reed'));
    field(reeds);
    const before = session().inventoryLayout![reeds[0].id].rotated;
    store().rotateItem(reeds[0].id);
    for (const r of reeds) expect(session().inventoryLayout![r.id].rotated).toBe(!before);
    expect(InventorySystem.stacks(session().inventory, session().inventoryLayout!)).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// THE GROUND: one pile, not a cache each
// -----------------------------------------------------------------------------

describe('things dropped in one spot make one pile', () => {
  it('two drops in reach make one pile of two; a drop out of reach starts another', () => {
    const [a, b, c] = [odd('a'), odd('b'), odd('c')];
    field([a, b, c]);
    store().dropItem(a.id);
    store().dropItem(b.id);
    expect(piles()).toHaveLength(1);
    expect(piles()[0].container!.items!.map(i => i.id).sort()).toEqual(['a', 'b']);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, position: { x: GROUND_REACH * 4, y: 0, z: 0 } } } }));
    store().dropItem(c.id);
    expect(piles()).toHaveLength(2);
    expect(lines().join(' | ')).toMatch(/pile/i);
  });

  it('another person\'s pile is not mine to add to', () => {
    const theirs: IWorldEntity = {
      id: 'cache_theirs', type: EntityType.CONTAINER, definitionId: 'ground_cache', position: { x: 10, y: 0 },
      rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
      container: { lootRank: UniversalRank.F, looted: false, hasLore: false, items: [odd('theirs')], cacheOwner: 'someone_else' }
    } as any;
    field([odd('mine')], [theirs]);
    store().dropItem('mine');
    expect(piles()).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
// THE HANDS: a stack in hand, a pouch's contents, the cart bed
// -----------------------------------------------------------------------------

describe('the hands carry a stack, take from a pouch, and work on the cart bed', () => {
  const held = (item: IItem, from: Place, along: IItem[] = []): Held => ({ item, from, rotated: false, along });

  it('a stack let go over clear ground drops every piece of it into one pile', () => {
    const four = pebbles(4);
    field(four);
    const v = commitMove(held(four[0], { kind: 'PACK' }, four.slice(1)), { kind: 'GROUND' }, useWorldStore.getState(), playerPort);
    expect(v.ok).toBe(true);
    expect(session().inventory).toHaveLength(0);
    expect(piles()).toHaveLength(1);
    expect(piles()[0].container!.items).toHaveLength(4);
  });

  it('half a stack in hand set on another cell leaves the other half where it was', () => {
    const four = pebbles(4);
    field(four);
    const was = { ...session().inventoryLayout![four[0].id] };
    const target = { kind: 'PACK' as const, x: 7, y: 5, rotated: false };
    expect(commitMove(held(four[2], { kind: 'PACK' }, [four[3]]), target, useWorldStore.getState(), playerPort).ok).toBe(true);
    expect(session().inventoryLayout![four[0].id]).toEqual(was);
    expect(session().inventoryLayout![four[3].id]).toEqual({ x: 7, y: 5, rotated: false });
  });

  it('there is no ground at home: the piece goes back and the words say why', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined } }));
    const v = probeMove(store().player, held(odd('x'), { kind: 'STASH' }), { kind: 'GROUND' }, useWorldStore.getState());
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/no ground/i);
  });

  it('U23: what rides a pouch is dragged out of it into a chosen cell of the pack', () => {
    const vial = { ...odd('vial'), type: ItemType.CONSUMABLE, tags: ['vial'] } as IItem;
    const pouch = { ...odd('pouch'), slot: SlotType.BAG, type: ItemType.CONTAINER, pouchData: { accepts: ['vial'], capacity: 4, contents: [vial] } } as IItem;
    const belt = { ...odd('belt'), slot: SlotType.BELT, type: ItemType.GEAR, beltData: { pouchSlots: 1 } } as IItem;
    field([]);
    let eq = LoadoutSystem.emptyEquipment();
    eq = { ...eq, items: [belt, pouch], slots: { ...eq.slots, BELT: belt.id, POUCH_1: pouch.id } };
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: eq } }));
    const from: Place = { kind: 'POUCH', slot: 'POUCH_1' } as Place;
    const v = commitMove(held(vial, from), { kind: 'PACK', x: 3, y: 2, rotated: false }, useWorldStore.getState(), playerPort);
    expect(v.ok).toBe(true);
    expect(session().inventory.map(i => i.id)).toEqual(['vial']);
    expect(session().inventoryLayout!.vial).toEqual({ x: 3, y: 2, rotated: false });
    expect(LoadoutSystem.itemIn(store().player.equipment!, 'POUCH_1')!.pouchData!.contents).toHaveLength(0);
  });

  it('H1b: a piece on the cart bed turns by a door of its own', () => {
    const reed = mint('tellers_reed');
    field([], [cartWith('cart_t', [reed])]);
    const before = cartOf('cart_t').layout[reed.id].rotated;
    expect(store().rotateOnCart('cart_t', reed.id).ok).toBe(true);
    expect(cartOf('cart_t').layout[reed.id].rotated).toBe(!before);
  });

  it('H13d: one material set on another on the cart bed works them together there', () => {
    const [pebble, reed] = [mint('tally_pebble'), mint('tellers_reed')];
    field([], [cartWith('cart_w', [pebble, reed])]);
    const onto: Place = { kind: 'ONTO', grid: 'CART', entityId: 'cart_w', targetId: reed.id } as Place;
    const h = held(pebble, { kind: 'CART', entityId: 'cart_w' });
    expect(probeMove(store().player, h, onto, useWorldStore.getState()).ok).toBe(true);
    expect(commitMove(h, onto, useWorldStore.getState(), playerPort).ok).toBe(true);
    const aboard = cartOf('cart_w').items;
    expect(aboard.some(i => i.id === pebble.id || i.id === reed.id)).toBe(false);
    expect(aboard).toHaveLength(1);
    expect(aboard[0].isIdentified).toBe(false);
    expect(store().player.restQueue?.made ?? []).toHaveLength(1);
  });

  it('a stack moves across onto the cart bed whole, into one footprint', () => {
    const three = pebbles(3);
    field(three, [cartWith('cart_s', [])]);
    const v = commitMove(held(three[0], { kind: 'PACK' }, three.slice(1)), { kind: 'CART', entityId: 'cart_s', x: 4, y: 4, rotated: false }, useWorldStore.getState(), playerPort);
    expect(v.ok).toBe(true);
    expect(cartOf('cart_s').items).toHaveLength(3);
    expect(InventorySystem.stacks(cartOf('cart_s').items, cartOf('cart_s').layout)).toHaveLength(1);
    expect(cartOf('cart_s').layout[three[2].id]).toEqual({ x: 4, y: 4, rotated: false });
  });
});

// -----------------------------------------------------------------------------
// WHAT ONLY THE SCREEN DOES: wired, and seen in the hidden window
// -----------------------------------------------------------------------------

describe('the screen\'s wiring', () => {
  it('the field is marked as ground, and the hands drop there, by a key too, and say where there is none', () => {
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/data-field-ground/);
    const hands = SRC('src/components/ui/hands.tsx');
    expect(hands).toMatch(/data-field-ground/);
    expect(hands).toMatch(/noGround/);
    expect(hands).toMatch(/key\.toLowerCase\(\) === 'x'/);
    expect(hands).toMatch(/key\.toLowerCase\(\) === 'o'/);
  });

  it('the grid draws a stack once with its count, and a modifier takes half', () => {
    const grid = SRC('src/components/ui/ItemGrid.tsx');
    expect(grid).toMatch(/InventorySystem\.stacks\(/);
    expect(grid).toMatch(/shiftKey/);
  });

  it('the hub\'s kit panel tells the load in words', () => {
    const hub = SRC('src/components/PlayerHub.tsx');
    expect(hub).toMatch(/loadWord\(/);
  });

  it('the pack has an arranging row and a key for it, and says FULL', () => {
    const sheet = SRC('src/components/CharacterSheet.tsx');
    expect(sheet).toMatch(/arrangePack\(/);
    expect(sheet).toMatch(/FULL/);
  });

  it('the cart window turns a piece by a button and a key', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/rotateOnCart\(/);
  });
});

/**
 * THE USABILITY PASS BARS — registered before the build (guardrail 1).
 * Test lines:
 *   57 opening a cache with a full pack creates no new entity and no new item,
 *      however often it is tried; a partial pickup leaves the rest only in the
 *      original cache
 *   58 a stray click or Escape cannot silently discard a mint-world draft
 *   59 a pack item can be moved to a chosen cell by mouse and by keyboard, and
 *      no grab, rotate or place sequence ever loses or duplicates it
 *   72 holding the button keeps firing at the weapon's own rate; one key
 *      interacts everywhere; firing never opens a menu
 *   73 every item anywhere shows its card on hover at once, compared with what
 *      is worn or held, without moving the layout
 *   74 items drag between every grid and slot with the same hands, by mouse and
 *      by keyboard, and no sequence loses or duplicates one
 *   75 hands and tools are on a hotbar the HUD shows, and the field and city
 *      have a minimap
 *   76 one key opens one character sheet, in the field and the city alike: the
 *      body, what you carry, attributes and skills together, through no other view
 * Plus PLAYTEST_LEDGER's U-items that have a bar of their own, and the standing
 * laws: colourblind coding, grayscale, the knowledge law (D19, D26).
 * This pass changes how things are used, not how they look.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const db = new Map<string, any>();
vi.mock('../src/entities/data/VectorStore', () => ({
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

import { EquipSlotId, IItem, ItemType, Rarity, SlotType, UniversalRank } from '../types';
import { usePlayerStore } from '../src/entities/player/store';
import { useWorldStore } from '../src/entities/world/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { useAppView, useFeed, useSheet } from '../src/components/ui/stores';
import { EntityType, IWorldEntity, ScanLevel, BiomeType } from '../src/entities/world/types';
import { InventorySystem, GRID_H, GRID_W } from '../src/entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../src/entities/player/systems/LoadoutSystem';
import { CartSystem } from '../src/entities/world/CartSystem';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { inspectItem, compareItems, comparisonFor, placeCard } from '../src/render/atoms/inspect';
import {
  fireGate, fireMode, FOCUS_ENERGY_COST, isInteractKey, pickInteract, hotbarCells, hotbarSlotForDigit,
  wieldRefusal, cityCamera, suggestStart, shouldSkipHubStop, draftDismissal
} from '../src/logic/systems/FieldInput';
import { Held, Place, probeMove, commitMove, ghostStyle, stepGhost } from '../src/logic/systems/ItemHands';
import { STASH_COLS, StashGrid } from '../src/entities/player/systems/StashGrid';
import { MINIMAP_ATOMS, MinimapMark, cityMinimap, fieldMinimap, minimapMark } from '../src/render/atoms/minimap';
import { buildPalette, grayscale } from '../src/render/atoms/atoms';
import { TERMINAL_GENRE } from '../src/components/ui/tokens';
import { HubGenerator } from '../src/entities/hub/HubGenerator';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const FUZZ_OPS = 1200;              // conservation: any drag sequence, keyed, deterministic
const HOLD_RATE_TOLERANCE = 1;      // shots in a held window, at the weapon's own rate
const MINIMAP_COMPOSE_MS = 6;       // a recomposition, median; it runs a few times a second
const MARK_GRAY_MIN = 0.25;         // a minimap mark apart from the ground, in grayscale value
const PLACE_SWEEP_STEP = 37;        // px; the card placement sweep over a window

const SRC = (p: string) => readFileSync(p, 'utf8');

const CERT = (uid: string, name = 'HANDS') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const synth = (id: string, slot: SlotType, over: Partial<IItem> = {}): IItem => ({
  id, universalDefinitionId: `syn_${id}`, name: over.name ?? id.toUpperCase(),
  description: '', type: over.type ?? ItemType.GEAR, slot,
  rank: over.rank ?? UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1,
  value: over.value ?? 1, itemPower: over.itemPower ?? 1, tags: over.tags ?? [], affixes: over.affixes ?? [],
  dimensions: over.dimensions ?? { width: 1, height: 1 }, weight: over.weight ?? 1,
  stats: over.stats ?? {}, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i',
  history: { dropDate: 0, killCount: 0 }, isIdentified: over.isIdentified ?? true,
  ...(over.pouchData ? { pouchData: over.pouchData } : {}),
  ...(over.beltData ? { beltData: over.beltData } : {}),
  ...(over.cartData ? { cartData: over.cartData } : {})
}) as IItem;

const rock = (id: string, w = 1, h = 1, weight = 1) => synth(id, SlotType.NONE, {
  type: ItemType.RESOURCE, dimensions: { width: w, height: h }, weight, tags: ['material']
});
const vial = (id: string) => synth(id, SlotType.NONE, { type: ItemType.CONSUMABLE, tags: ['consumable', 'vial'], stats: { health_restore: 5 } });
const vialPouch = (id: string) => synth(id, SlotType.BAG, { pouchData: { accepts: ['vial'], capacity: 4, contents: [] } });
const belt = (id: string, pouchSlots = 2) => synth(id, SlotType.BELT, { beltData: { pouchSlots } });

const store = () => usePlayerStore.getState();
const player = () => store().player;
const session = () => player().currentSession!;
const stash = () => player().bank.stashTabs[0].items;

const entities = () => Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).flatMap((c: any) => c.entities as IWorldEntity[]);

/** A session standing in a one-chunk world, holding these things. */
function field(items: IItem[], extra: IWorldEntity[] = [], energy = 1000) {
  useWorldStore.setState({
    currentMap: { seed: 'hands_world', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities: extra } } }
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      currentSession: {
        sessionId: 'sess_hands', layerId: 'l', inventory: [...items],
        inventoryLayout: InventorySystem.placeAll(items),
        kitItemIds: [], health: 100, maxHealth: 100, energy, position: { x: 0, y: 0, z: 0 }, statusEffects: []
      } as any
    }
  }));
  store().recalcWeight();
}

const groundCache = (id: string, items: IItem[]): IWorldEntity => ({
  id, type: EntityType.CONTAINER, definitionId: 'ground_cache', position: { x: 10, y: 0 },
  rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  container: { lootRank: UniversalRank.F, looted: false, hasLore: false, items, cacheOwner: 'uid_hands' }
} as any);

const cartEntity = (id: string): IWorldEntity => ({
  id, type: EntityType.CART, definitionId: 'cart_field', position: { x: 20, y: 0 },
  rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false,
  cart: CartSystem.newCart(synth('kit_' + id, SlotType.NONE, { cartData: { gridW: 10, gridH: 8 } }), 'uid_hands', 'HANDS')
} as any);

const fullPack = () => Array.from({ length: GRID_W * GRID_H }, (_, i) => rock(`fill_${i}`));

const held = (item: IItem, from: Place, rotated = false): Held => ({ item, from, rotated });

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  useSheet.setState({ open: false });
  useAppView.setState({ view: 'HUB' });
  useIdentityStore.setState({ certificate: CERT('uid_hands') } as any);
  store().initializeSession(CERT('uid_hands'), 'NOMAD');
  usePlayerStore.setState(s => ({
    player: { ...s.player, attributes: { ...s.player.attributes, strength: 500 }, equipment: LoadoutSystem.emptyEquipment() }
  }));
});

// -----------------------------------------------------------------------------
// LINE 57 — the cache duplication
// -----------------------------------------------------------------------------

describe('line 57: a cache never duplicates what it holds', () => {
  it('a full pack: no new entity, no new item, however often it is tried', () => {
    const inside = [rock('cached_a'), rock('cached_b')];
    field(fullPack(), [groundCache('cache_1', inside)]);
    const before = entities().length;
    for (let i = 0; i < 6; i++) store().performInteraction('int_open_cache_1', 'cache_1');
    expect(entities().length).toBe(before);
    expect(entities().filter(e => e.id.startsWith('cache_ovf_'))).toEqual([]);
    const cache = entities().find(e => e.id === 'cache_1')!;
    expect(cache.container!.items!.map(i => i.id).sort()).toEqual(['cached_a', 'cached_b']);
    expect(session().inventory.length).toBe(GRID_W * GRID_H);
  });

  it('a refused press costs nothing and says so in voice', () => {
    field(fullPack(), [groundCache('cache_1', [rock('cached_a'), rock('cached_b')])], 50);
    store().performInteraction('int_open_cache_1', 'cache_1');
    expect(session().energy).toBe(50);
    expect(useFeed.getState().lines.map(l => l.text).join(' ')).toMatch(/The pack refuses 2; they stay in the cache\./);
  });

  it('a partial pickup leaves the rest only in the original cache', () => {
    const pack = fullPack().slice(0, GRID_W * GRID_H - 1); // one cell free
    const inside = [rock('cached_a'), rock('cached_b'), rock('cached_c')];
    field(pack, [groundCache('cache_1', inside)]);
    store().performInteraction('int_open_cache_1', 'cache_1');
    const inPack = session().inventory.filter(i => i.id.startsWith('cached_')).map(i => i.id);
    const left = entities().find(e => e.id === 'cache_1')!.container!.items!.map(i => i.id);
    expect(inPack.length).toBe(1);
    expect(left.length).toBe(2);
    expect([...inPack, ...left].sort()).toEqual(['cached_a', 'cached_b', 'cached_c']);
    expect(entities().filter(e => e.type === EntityType.CONTAINER).length).toBe(1);
  });

  it('a cache that empties is gone, and a chest still overflows at your feet', () => {
    field([], [groundCache('cache_1', [rock('cached_a')])]);
    store().performInteraction('int_open_cache_1', 'cache_1');
    expect(entities().find(e => e.id === 'cache_1')).toBeUndefined();
    expect(session().inventory.map(i => i.id)).toEqual(['cached_a']);
  });
});

// -----------------------------------------------------------------------------
// LINE 58 — the mint-world draft
// -----------------------------------------------------------------------------

describe('line 58: a stray click or Escape cannot discard a draft', () => {
  it('the law: the backdrop never closes a heavy flow; Escape asks when dirty', () => {
    expect(draftDismissal(true, 'BACKDROP')).toBe('IGNORE');
    expect(draftDismissal(false, 'BACKDROP')).toBe('IGNORE');
    expect(draftDismissal(true, 'ESCAPE')).toBe('ASK');
    expect(draftDismissal(true, 'CLOSE')).toBe('ASK');
    expect(draftDismissal(false, 'ESCAPE')).toBe('CLOSE');
  });

  it('the real creator: backdrop stays, Escape asks in voice, reopening restores the draft', async () => {
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react-dom/test-utils');
    const { WorldCreator } = await import('../src/components/WorldCreator');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let open = true;
    const render = () => act(async () => {
      root.render(React.createElement(WorldCreator, { opened: open, onClose: () => { open = false; }, onCreated: () => {} }));
    });
    await render();

    const name = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(name, 'SECTOR SEVEN');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('SECTOR SEVEN');

    // A backdrop click: nothing happens.
    const overlay = host.querySelector('.ws-overlay') as HTMLElement;
    await act(async () => { overlay.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await render();
    expect(open).toBe(true);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('SECTOR SEVEN');

    // Escape from inside an input: it asks, in voice, and keeps everything.
    await act(async () => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await render();
    expect(open).toBe(true);
    expect(host.textContent).toMatch(/The draft is unsigned\. Abandon it\?/);

    // Keep drafting answers the question and loses nothing.
    const keep = [...host.querySelectorAll('button')].find(b => /KEEP DRAFTING/.test(b.textContent ?? ''))!;
    await act(async () => { keep.click(); });
    expect(host.textContent).not.toMatch(/Abandon it\?/);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('SECTOR SEVEN');

    // Closed by any route that does not abandon, the draft is still there on reopening.
    await act(async () => { root.render(React.createElement(WorldCreator, { opened: false, onClose: () => {}, onCreated: () => {} })); });
    await act(async () => { root.render(React.createElement(WorldCreator, { opened: true, onClose: () => {}, onCreated: () => {} })); });
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('SECTOR SEVEN');
    await act(async () => { root.unmount(); });
    host.remove();
  });
});

// -----------------------------------------------------------------------------
// LINE 59 — a chosen cell
// -----------------------------------------------------------------------------

describe('line 59: a pack item moves to a chosen cell', () => {
  it('sets down exactly where asked, and only where it fits', () => {
    const a = rock('a', 2, 2), b = rock('b', 1, 1);
    field([a, b]);
    expect(commitMove(held(a, { kind: 'PACK' }), { kind: 'PACK', x: 5, y: 3, rotated: false }).ok).toBe(true);
    expect(session().inventoryLayout!['a']).toEqual({ x: 5, y: 3, rotated: false });

    const refused = commitMove(held(b, { kind: 'PACK' }), { kind: 'PACK', x: 6, y: 4, rotated: false });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/\S/);
    expect(session().inventoryLayout!['b']).not.toEqual({ x: 6, y: 4, rotated: false });
  });

  it('off the grid and over the edge are refused; rotating while held changes the footprint asked for', () => {
    const long = rock('long', 3, 1);
    field([long]);
    expect(probeMove(player(), held(long, { kind: 'PACK' }), { kind: 'PACK', x: GRID_W - 1, y: 0, rotated: false }).ok).toBe(false);
    expect(probeMove(player(), held(long, { kind: 'PACK' }, true), { kind: 'PACK', x: GRID_W - 1, y: 0, rotated: true }).ok).toBe(true);
    expect(commitMove(held(long, { kind: 'PACK' }, true), { kind: 'PACK', x: GRID_W - 1, y: 0, rotated: true }).ok).toBe(true);
    expect(session().inventoryLayout!['long']).toEqual({ x: GRID_W - 1, y: 0, rotated: true });
  });

  it('valid and invalid read by shape and seam, not by hue', () => {
    const ok = ghostStyle(true), bad = ghostStyle(false);
    expect(ok.outlineStyle).toBe('solid');
    expect(bad.outlineStyle).toBe('dashed');
    expect(ok.outlineStyle).not.toBe(bad.outlineStyle);
    // the same colour on both: the seam alone carries it
    expect(ok.outlineColor).toBe(bad.outlineColor);
  });

  it('the keyboard path walks a grid and stops at its edges', () => {
    const a = rock('a', 2, 1);
    field([a]);
    let at = { kind: 'PACK', x: 0, y: 0, rotated: false } as Place;
    at = stepGhost(at, 1, 0, a, GRID_W, GRID_H);
    expect(at).toMatchObject({ x: 1, y: 0 });
    at = stepGhost(at, -5, 0, a, GRID_W, GRID_H);
    expect(at).toMatchObject({ x: 0, y: 0 });
    for (let i = 0; i < 20; i++) at = stepGhost(at, 1, 0, a, GRID_W, GRID_H);
    expect(at).toMatchObject({ x: GRID_W - 2 });
    expect(commitMove(held(a, { kind: 'PACK' }), at).ok).toBe(true);
  });

  it('no grab, rotate or place sequence loses or duplicates anything', () => {
    const items = [rock('p1', 2, 2), rock('p2', 1, 3), rock('p3', 3, 1), rock('p4'), rock('p5', 2, 1)];
    field(items);
    const rng = Rng.fromKey('line59');
    for (let op = 0; op < FUZZ_OPS; op++) {
      const pool = session().inventory;
      const item = pool[rng.int(0, pool.length)];
      const rotated = rng.int(0, 2) === 1;
      const to: Place = { kind: 'PACK', x: rng.int(-1, GRID_W + 1), y: rng.int(-1, GRID_H + 1), rotated };
      const h = held(item, { kind: 'PACK' }, rotated);
      if (rng.int(0, 4) !== 0) commitMove(h, to); // else: Escape, nothing happened
      const ids = session().inventory.map(i => i.id).sort();
      expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
      const occ = InventorySystem.buildOccupancy(session().inventory, session().inventoryLayout!);
      const cells = occ.flat().filter(Boolean).length;
      const want = session().inventory.reduce((n, i) => n + (i.dimensions.width * i.dimensions.height), 0);
      expect(cells).toBe(want); // nothing overlaps, nothing is off the grid
    }
  });
});

// -----------------------------------------------------------------------------
// LINE 72 — hold to fire, one interact key
// -----------------------------------------------------------------------------

describe('line 72: holding fires at the weapon\'s own rate; interacting has its own input', () => {
  const heldWindow = (item: IItem | undefined, ms: number, energy = 1e6) => {
    const cooldownMs = 1000 / (item?.stats?.attack_speed || 1);
    let last = -Infinity, shots = 0, spend = energy;
    for (let now = 0; now <= ms; now += 16) {
      const gate = fireGate({ held: true, now, lastShot: last, cooldownMs, mode: fireMode(item), energy: spend });
      if (gate === 'FIRE') { shots++; last = now; if (fireMode(item) === 'FOCUS') spend -= FOCUS_ENERGY_COST; }
    }
    return shots;
  };

  it('melee, ranged and focus alike keep firing while held', () => {
    const melee = synth('sw', SlotType.MAIN_HAND, { tags: ['melee'], stats: { attack_speed: 2 } });
    const ranged = synth('bw', SlotType.MAIN_HAND, { tags: ['ranged'], stats: { attack_speed: 4 } });
    const focus = synth('fc', SlotType.MAIN_HAND, { tags: ['magic'], stats: { attack_speed: 1 } });
    expect(fireMode(melee)).toBe('MELEE');
    expect(fireMode(ranged)).toBe('SHOT');
    expect(fireMode(focus)).toBe('FOCUS');
    expect(Math.abs(heldWindow(melee, 5000) - 11)).toBeLessThanOrEqual(HOLD_RATE_TOLERANCE);
    expect(Math.abs(heldWindow(ranged, 5000) - 21)).toBeLessThanOrEqual(HOLD_RATE_TOLERANCE);
    expect(Math.abs(heldWindow(focus, 5000) - 6)).toBeLessThanOrEqual(HOLD_RATE_TOLERANCE);
  });

  it('releasing stops it, and a click still fires exactly once', () => {
    expect(fireGate({ held: false, now: 5000, lastShot: 0, cooldownMs: 100, mode: 'SHOT', energy: 0 })).toBe('IDLE');
    expect(fireGate({ held: true, now: 50, lastShot: 0, cooldownMs: 100, mode: 'SHOT', energy: 0 })).toBe('WAIT');
    expect(fireGate({ held: true, now: 100, lastShot: 0, cooldownMs: 100, mode: 'SHOT', energy: 0 })).toBe('FIRE');
  });

  it('a focus with no energy refuses rather than fires', () => {
    const gate = fireGate({ held: true, now: 5000, lastShot: 0, cooldownMs: 100, mode: 'FOCUS', energy: FOCUS_ENERGY_COST - 1 });
    expect(gate).toBe('NO_ENERGY');
  });

  it('a tool in the hand swings; a shield in the hand does not', () => {
    const axe = synth('axe', SlotType.TOOL, { tags: ['tool', 'axe'] });
    expect(fireMode(axe)).toBe('MELEE');
    expect(wieldRefusal(axe)).toBeNull();
    const shield = synth('sh', SlotType.OFF_HAND);
    expect(wieldRefusal(shield)).toMatch(/\S/);
    expect(wieldRefusal(undefined)).toBeNull(); // bare hands are always there
  });

  it('one key: the field and the city ask the same law', () => {
    expect(isInteractKey('e')).toBe(true);
    expect(isInteractKey('E')).toBe(true);
    expect(isInteractKey('Enter')).toBe(true);
    expect(isInteractKey('q')).toBe(false);
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/isInteractKey\(/);
    expect(SRC('src/entities/hub/HubCanvas.tsx')).toMatch(/isInteractKey\(/);
  });

  it('the interact key takes the nearest thing that can be acted on', () => {
    const near = { ...groundCache('near', [rock('x')]), position: { x: 20, y: 0 } };
    const far = { ...groundCache('far', [rock('y')]), position: { x: 50, y: 0 } };
    const tooFar = { ...groundCache('out', [rock('z')]), position: { x: 400, y: 0 } };
    field([], [near, far, tooFar]);
    const pick = pickInteract(player(), entities(), { x: 0, z: 0 });
    expect(pick?.entity.id).toBe('near');
    expect(pick?.primary?.id).toBe('int_open_near');
    expect(pickInteract(player(), [tooFar], { x: 0, z: 0 })).toBeNull();
  });

  it('a thing with several answers asks, and a study option never steals the key', () => {
    const cart = cartEntity('c1');
    field([], [cart]);
    const pick = pickInteract(player(), entities(), { x: 0, z: 0 });
    expect(pick?.primary).toBeUndefined();          // tow or open: the menu asks
    expect(pick?.options.length).toBeGreaterThan(1);

    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, intelligence: 9 } } }));
    const cache = groundCache('c2', [rock('q')]);
    const solo = pickInteract(player(), [cache], { x: 0, z: 0 });
    expect(solo?.primary?.id).toBe('int_open_c2');
  });

  it('firing opens no menu: a click on the field only ever fires', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).not.toMatch(/handleEntityClick/);
    expect(canvas).not.toMatch(/onClick=\{handleCanvasClick\}/);
    expect(canvas).toMatch(/onPointerDown=/);
    // the only door into the menu is the interact path
    const openers = [...canvas.matchAll(/setMenuPosition\(\{/g)].length;
    expect(openers).toBe(1);
  });

  it('U7: leaving has keys, in the field and in recon', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/<Kbd>E<\/Kbd> EXTRACT/);
    expect(canvas).toMatch(/<Kbd>X<\/Kbd> WITHDRAW/);
    expect(canvas).toMatch(/<Kbd>ENTER<\/Kbd> CONFIRM DROP/);
    expect(canvas).toMatch(/<Kbd>ESC<\/Kbd> ABORT/);
  });
});

// -----------------------------------------------------------------------------
// LINE 73 — the card on hover, compared
// -----------------------------------------------------------------------------

describe('line 73: every item shows its card at once, compared, moving nothing', () => {
  const affix = (id: string, stats: Record<string, number>) => ({ id, name: `of ${id}`, stats }) as any;

  it('the comparison reads position and sign', () => {
    const worn = synth('w', SlotType.MAIN_HAND, { stats: { attack_speed: 1, reach: 5 } });
    const cand = synth('c', SlotType.MAIN_HAND, { stats: { attack_speed: 2, reach: 3, weight_bonus: 1 } });
    const cmp = compareItems(cand, worn, player());
    const row = (k: string) => cmp.rows.find(r => r.stat === k)!;
    expect(row('attack speed')).toMatchObject({ here: '2', there: '1', delta: '+1', mark: '▲' });
    expect(row('reach')).toMatchObject({ here: '3', there: '5', delta: '−2', mark: '▼' });
    expect(row('weight bonus')).toMatchObject({ here: '1', there: '—', mark: '▲' });
  });

  it('D19: an unstudied affix on either side is invisible to the comparison, and does not leak by arithmetic', () => {
    const baseC = { attack_speed: 2 }, baseW = { attack_speed: 1 };
    const secret = affix('secret', { attack_speed: 7, hidden_stat: 3 });
    const cand = synth('c', SlotType.MAIN_HAND, { stats: { attack_speed: 9, hidden_stat: 3 }, affixes: [secret] });
    const worn = synth('w', SlotType.MAIN_HAND, { stats: { attack_speed: 8, hidden_stat: 3 }, affixes: [affix('other', { attack_speed: 7, hidden_stat: 3 })] });
    const blind = compareItems(cand, worn, player());
    // exactly what the same comparison of the plain twins reads
    const twin = compareItems(synth('c', SlotType.MAIN_HAND, { stats: baseC }), synth('w', SlotType.MAIN_HAND, { stats: baseW }), player());
    expect(blind.rows).toEqual(twin.rows);
    expect(JSON.stringify(blind.rows)).not.toMatch(/hidden|secret|other|\b9\b|\b8\b/);
    expect(blind.blind).toEqual({ here: 1, there: 1 });
  });

  it('D19: study reveals exactly what was banked, into the comparison too', () => {
    const secret = affix('aff_secret', { attack_speed: 7 });
    const cand = synth('c', SlotType.MAIN_HAND, { stats: { attack_speed: 9 }, affixes: [secret] });
    const worn = synth('w', SlotType.MAIN_HAND, { stats: { attack_speed: 1 } });
    usePlayerStore.setState(s => ({
      player: { ...s.player, materialMastery: { syn_c: { materialId: 'syn_c', knowledgeLevel: 1, discoveredAffixes: ['aff_secret'] } as any } }
    }));
    expect(compareItems(cand, worn, player()).rows.find(r => r.stat === 'attack speed')).toMatchObject({ here: '9', there: '1', delta: '+8' });
    expect(compareItems(cand, worn, player()).blind.here).toBe(0);
  });

  it('D19: an unidentified item compares nothing at all', () => {
    const cand = synth('c', SlotType.MAIN_HAND, { stats: { attack_speed: 9 }, isIdentified: false });
    const worn = synth('w', SlotType.MAIN_HAND, { stats: { attack_speed: 1 } });
    expect(compareItems(cand, worn, player()).rows).toEqual([]);
    // and a worn unidentified piece reads nothing on its side
    const w2 = synth('w', SlotType.MAIN_HAND, { stats: { attack_speed: 1 }, isIdentified: false });
    const c2 = synth('c', SlotType.MAIN_HAND, { stats: { attack_speed: 3 } });
    expect(compareItems(c2, w2, player()).rows.find(r => r.stat === 'attack speed')).toMatchObject({ there: '—' });
  });

  it('D22: a mental line on gear is asleep, so it is no gain', () => {
    const cand = synth('c', SlotType.HEAD, { stats: { intelligence: 5, armor: 2 } });
    const worn = synth('w', SlotType.HEAD, { stats: { armor: 1 } });
    const rows = compareItems(cand, worn, player()).rows;
    expect(rows.map(r => r.stat)).not.toContain('intelligence');
    expect(rows.find(r => r.stat === 'armor')).toMatchObject({ delta: '+1' });
  });

  it('it compares with what would be replaced, and says when nothing is worn', () => {
    const sword = synth('s', SlotType.MAIN_HAND, { stats: { attack_speed: 1 } });
    const owned = synth('h', SlotType.MAIN_HAND, { stats: { attack_speed: 3 } });
    expect(comparisonFor(sword, player())?.against).toBeNull(); // nothing in that hand
    usePlayerStore.setState(s => ({
      player: { ...s.player, equipment: { ...s.player.equipment!, slots: { RIGHT_HAND: 'h' }, items: [owned] } }
    }));
    const cmp = comparisonFor(sword, player())!;
    expect(cmp.against?.id).toBe('h');
    expect(comparisonFor(owned, player())).toBeNull(); // the worn piece is not compared with itself
    expect(comparisonFor(rock('r'), player())).toBeNull(); // cargo has nothing to compare against
  });

  it('a tool compares with the worn tool of its own kind', () => {
    const axe = synth('a', SlotType.TOOL, { tags: ['tool', 'axe'], stats: { chopping_power: 2 } });
    const worn = synth('b', SlotType.TOOL, { tags: ['tool', 'axe'], stats: { chopping_power: 5 } });
    usePlayerStore.setState(s => ({
      player: { ...s.player, equipment: { ...s.player.equipment!, slots: { TOOL_1: 'b' }, items: [worn] } }
    }));
    expect(comparisonFor(axe, player())?.against?.id).toBe('b');
  });

  it('the card never covers the thing, never leaves the window', () => {
    const view = { w: 1280, h: 800 };
    const card = { w: 300, h: 260 };
    for (let x = 0; x < view.w; x += PLACE_SWEEP_STEP) for (let y = 0; y < view.h; y += PLACE_SWEEP_STEP) {
      const anchor = { left: x, top: y, width: 36, height: 36 };
      const at = placeCard(anchor, card, view);
      expect(at.left).toBeGreaterThanOrEqual(0);
      expect(at.top).toBeGreaterThanOrEqual(0);
      expect(at.left + card.w).toBeLessThanOrEqual(view.w);
      expect(at.top + card.h).toBeLessThanOrEqual(view.h);
      const overlaps = at.left < x + 36 && at.left + card.w > x && at.top < y + 36 && at.top + card.h > y;
      expect(overlaps, `${x},${y}`).toBe(false);
    }
  });

  it('every item sprite anywhere answers the pointer and the keyboard, by construction', async () => {
    const kit = SRC('src/components/ui/kit.tsx');
    expect(kit).toMatch(/hoverProps\(item\)/);
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ItemSprite } = await import('../src/components/ui/kit');
    const html = renderToStaticMarkup(React.createElement(ItemSprite, { item: rock('r') }));
    expect(html).toContain('canvas');
    // No screen may turn it off except the ghost in the hands
    for (const f of ['src/components/WorldCanvas.tsx', 'src/components/PlayerHub.tsx', 'src/components/PaperDoll.tsx', 'src/entities/hub/HubCanvas.tsx']) {
      expect(SRC(f)).not.toMatch(/noHover/);
    }
  });

  it('U10: selecting an item grows nothing: the pack\'s actions live in a fixed column', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).not.toMatch(/\{selectedItem && \(\s*<div onClick=\{e => e\.stopPropagation\(\)\} style=\{\{ marginTop: 8/);
    expect(SRC('src/components/CharacterSheet.tsx')).toMatch(/PACK_ACTIONS_W/);
  });

  it('U11: the shop, the sale, the repair, the counter and the fitting list all compare', () => {
    expect(SRC('src/components/ui/HoverLayer.tsx')).toMatch(/comparisonFor\(/);
    const hub = SRC('src/entities/hub/HubCanvas.tsx');
    expect((hub.match(/hoverProps\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(SRC('src/components/PaperDoll.tsx')).toMatch(/hoverProps\(/);
  });
});

// -----------------------------------------------------------------------------
// LINE 74 — the same hands everywhere; conservation
// -----------------------------------------------------------------------------

describe('line 74: one pair of hands, and nothing lost or duplicated', () => {
  const FIELD_ITEMS = () => [
    synth('fz_helm', SlotType.HEAD), synth('fz_helm2', SlotType.HEAD), synth('fz_plate', SlotType.CHEST, { weight: 3, dimensions: { width: 2, height: 3 } }),
    synth('fz_sword', SlotType.MAIN_HAND, { tags: ['melee', 'one_hand'], dimensions: { width: 1, height: 3 } }),
    synth('fz_ring', SlotType.RING), synth('fz_ring2', SlotType.RING),
    belt('fz_belt'), belt('fz_belt2', 3), vialPouch('fz_pouch'),
    vial('fz_p1'), vial('fz_p2'),
    synth('fz_pick', SlotType.TOOL, { tags: ['tool'] }),
    rock('fz_r1', 2, 2), rock('fz_r2', 3, 1)
  ];

  const everywhere = () => {
    const eq = player().equipment;
    const carts = entities().filter(e => e.cart).flatMap(e => e.cart!.items);
    const caches = entities().filter(e => e.container?.items).flatMap(e => e.container!.items!);
    const inPouches = (list: IItem[]) => list.flatMap(i => i.pouchData?.contents ?? []);
    const places = [...session().inventory, ...(eq?.items ?? []), ...carts, ...caches];
    return [...places, ...inPouches(places)].map(i => i.id).filter(id => id.startsWith('fz_')).sort();
  };

  const zones = (): Place[] => {
    const eq = player().equipment!;
    const slots = LoadoutSystem.availableSlots(eq).map(slot => ({ kind: 'SLOT', slot }) as Place);
    return [
      ...slots,
      { kind: 'PACK' },
      { kind: 'GROUND' },
      { kind: 'CART', entityId: 'cart_1' }
    ];
  };

  it('any drag sequence in the field conserves every item', () => {
    const items = FIELD_ITEMS();
    field(items, [cartEntity('cart_1')]);
    const expected = items.map(i => i.id).sort();
    expect(everywhere()).toEqual(expected);
    const rng = Rng.fromKey('line74');
    let moved = 0, refused = 0;
    for (let op = 0; op < FUZZ_OPS; op++) {
      // Anything anywhere can be picked up
      const eq = player().equipment!;
      const sources: Held[] = [
        ...session().inventory.map(i => held(i, { kind: 'PACK' })),
        ...(Object.entries(eq.slots) as [EquipSlotId, string][]).filter(([, id]) => id).map(([slot, id]) => held(eq.items.find(i => i.id === id)!, { kind: 'SLOT', slot })),
        ...entities().filter(e => e.cart).flatMap(e => e.cart!.items.map(i => held(i, { kind: 'CART', entityId: e.id }))),
        ...entities().filter(e => e.container?.items).flatMap(e => e.container!.items!.map(i => held(i, { kind: 'CACHE', entityId: e.id })))
      ].filter(s => s.item.id.startsWith('fz_'));
      if (sources.length === 0) continue;
      const h = sources[rng.int(0, sources.length)];
      const all = zones();
      let to = all[rng.int(0, all.length)];
      // Half the time the hand knows where a piece goes, so the fuzz really moves things
      const home = LoadoutSystem.slotForItem(h.item, player().equipment);
      if (home && rng.int(0, 2) === 0) to = { kind: 'SLOT', slot: home };
      if (to.kind === 'PACK' && rng.int(0, 2) === 0) to = { kind: 'PACK', x: rng.int(0, GRID_W), y: rng.int(0, GRID_H), rotated: rng.int(0, 2) === 1 };
      if (to.kind === 'CART' && rng.int(0, 2) === 0) to = { kind: 'CART', entityId: 'cart_1', x: rng.int(0, 10), y: rng.int(0, 8), rotated: false };
      const asked = rng.int(0, 5);
      if (asked === 0) continue; // Escape: put it back
      const verdict = commitMove(h, to);
      if (verdict.ok) moved++; else { refused++; expect(verdict.reason, JSON.stringify(to)).toMatch(/\S/); }
      expect(everywhere(), `op ${op}`).toEqual(expected);
    }
    expect(moved).toBeGreaterThan(200);   // the fuzz really moved things
    expect(refused).toBeGreaterThan(50);  // and really was refused
  });

  it('any drag sequence at the bank conserves every item, stash grid included', () => {
    const items = [...FIELD_ITEMS(), rock('fz_big', 4, 4)];
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined, bank: { ...s.player.bank, stashTabs: [{ name: 'MAIN', items }] } } }));
    const everywhereBank = () => {
      const eq = player().equipment;
      const places = [...stash(), ...(eq?.items ?? [])];
      return [...places, ...places.flatMap(i => i.pouchData?.contents ?? [])].map(i => i.id).sort();
    };
    const expected = items.map(i => i.id).sort();
    const rng = Rng.fromKey('line74bank');
    let moved = 0;
    for (let op = 0; op < FUZZ_OPS; op++) {
      const eq = player().equipment!;
      const sources: Held[] = [
        ...stash().map(i => held(i, { kind: 'STASH' })),
        ...(Object.entries(eq.slots) as [EquipSlotId, string][]).filter(([, id]) => id).map(([slot, id]) => held(eq.items.find(i => i.id === id)!, { kind: 'SLOT', slot }))
      ];
      const h = sources[rng.int(0, sources.length)];
      const slots = LoadoutSystem.availableSlots(eq).map(slot => ({ kind: 'SLOT', slot }) as Place);
      const to: Place = rng.int(0, 2) === 0
        ? { kind: 'STASH', x: rng.int(-1, STASH_COLS + 1), y: rng.int(0, 12), rotated: rng.int(0, 2) === 1 }
        : slots[rng.int(0, slots.length)];
      if (commitMove(h, to).ok) moved++;
      expect(everywhereBank(), `op ${op}`).toEqual(expected);
    }
    expect(moved).toBeGreaterThan(200);
    const layout = StashGrid.resolve(stash(), player().bank.stashTabs[0].layout);
    const area = stash().reduce((n, i) => n + i.dimensions.width * i.dimensions.height, 0);
    expect(StashGrid.occupied(stash(), layout)).toBe(area); // nothing overlaps
  });

  it('a refusal speaks in the store\'s own voice, and the ghost knew first', () => {
    const helm = synth('helm', SlotType.HEAD);
    field([helm]);
    const to: Place = { kind: 'SLOT', slot: 'CHEST' };
    const asked = probeMove(player(), held(helm, { kind: 'PACK' }), to);
    expect(asked.ok).toBe(false);
    expect(asked.reason).toBe(LoadoutSystem.canEquip(player(), helm, 'CHEST').reason);
    const done = commitMove(held(helm, { kind: 'PACK' }), to);
    expect(done).toEqual(asked);
    expect(session().inventory.map(i => i.id)).toEqual(['helm']);
  });

  it('U6: equipping is one step, and a worn piece swaps out in the same step', () => {
    const a = synth('sw_a', SlotType.MAIN_HAND), b = synth('sw_b', SlotType.MAIN_HAND);
    field([a, b]);
    expect(store().equipSwap('sw_a').ok).toBe(true);
    expect(player().equipment!.slots.RIGHT_HAND).toBe('sw_a');
    const verdict = store().equipSwap('sw_b');
    expect(verdict.ok).toBe(true);
    expect(player().equipment!.slots.RIGHT_HAND).toBe('sw_b');
    expect(session().inventory.map(i => i.id)).toEqual(['sw_a']);
  });

  it('U6: a swap in a full pack works, because the piece leaving makes the room', () => {
    const a = synth('sw_a', SlotType.MAIN_HAND), b = synth('sw_b', SlotType.MAIN_HAND);
    field([...fullPack().slice(0, GRID_W * GRID_H - 1), b]);
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: { ...s.player.equipment!, slots: { RIGHT_HAND: 'sw_a' }, items: [a] } } }));
    expect(store().equipSwap('sw_b').ok).toBe(true);
    expect(session().inventory.find(i => i.id === 'sw_a')).toBeTruthy();
    expect(session().inventory.length).toBe(GRID_W * GRID_H);
  });

  it('a swap the laws refuse moves nothing', () => {
    const big = synth('big', SlotType.MAIN_HAND, { rank: UniversalRank.SS });
    const a = synth('sw_a', SlotType.MAIN_HAND);
    field([big]);
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, strength: 1 }, equipment: { ...s.player.equipment!, slots: { RIGHT_HAND: 'sw_a' }, items: [a] } } }));
    const verdict = store().equipSwap('big');
    expect(verdict.ok).toBe(false);
    expect(player().equipment!.slots.RIGHT_HAND).toBe('sw_a');
    expect(session().inventory.map(i => i.id)).toEqual(['big']);
  });

  it('the belt: a pouch sits on it, and what it stacks drops into the pouch', () => {
    const b = belt('b'), p = vialPouch('p'), v = vial('v'), r = rock('r');
    field([b, p, v, r]);
    expect(commitMove(held(b, { kind: 'PACK' }), { kind: 'SLOT', slot: 'BELT' }).ok).toBe(true);
    expect(commitMove(held(p, { kind: 'PACK' }), { kind: 'SLOT', slot: 'POUCH_1' }).ok).toBe(true);
    expect(commitMove(held(v, { kind: 'PACK' }), { kind: 'SLOT', slot: 'POUCH_1' }).ok).toBe(true);
    expect(player().equipment!.items.find(i => i.id === 'p')!.pouchData!.contents.map(c => c.id)).toEqual(['v']);
    const no = commitMove(held(r, { kind: 'PACK' }), { kind: 'SLOT', slot: 'POUCH_1' });
    expect(no.ok).toBe(false);
    expect(no.reason).toMatch(/stacks only/);
  });

  it('the ground: leaving a thing makes one cache, and taking it back empties that cache', () => {
    const r = rock('r');
    field([r]);
    expect(commitMove(held(r, { kind: 'PACK' }), { kind: 'GROUND' }).ok).toBe(true);
    const cache = entities().find(e => e.container?.items)!;
    expect(session().inventory).toEqual([]);
    expect(commitMove(held(r, { kind: 'CACHE', entityId: cache.id }), { kind: 'PACK', x: 3, y: 2, rotated: false }).ok).toBe(true);
    expect(entities().find(e => e.id === cache.id)).toBeUndefined();
    expect(session().inventoryLayout!['r']).toEqual({ x: 3, y: 2, rotated: false });
  });

  it('the cart: a chosen cell on the bed, and back into a chosen cell in the pack', () => {
    const r = rock('r', 2, 2);
    field([r], [cartEntity('cart_1')]);
    expect(commitMove(held(r, { kind: 'PACK' }), { kind: 'CART', entityId: 'cart_1', x: 4, y: 3, rotated: false }).ok).toBe(true);
    const cart = () => entities().find(e => e.id === 'cart_1')!.cart!;
    expect(cart().layout['r']).toEqual({ x: 4, y: 3, rotated: false });
    expect(commitMove(held(r, { kind: 'CART', entityId: 'cart_1' }), { kind: 'CART', entityId: 'cart_1', x: 0, y: 0, rotated: true }).ok).toBe(true);
    expect(cart().layout['r']).toEqual({ x: 0, y: 0, rotated: true });
    expect(commitMove(held(r, { kind: 'CART', entityId: 'cart_1' }), { kind: 'PACK', x: 6, y: 4, rotated: false }).ok).toBe(true);
    expect(cart().items).toEqual([]);
    expect(session().inventoryLayout!['r']).toEqual({ x: 6, y: 4, rotated: false });
  });

  it('every grid uses the one hand system', () => {
    const grid = SRC('src/components/ui/ItemGrid.tsx');
    expect(grid).toMatch(/useDropZone/);
    for (const f of ['src/components/WorldCanvas.tsx', 'src/components/PlayerHub.tsx']) expect(SRC(f)).toMatch(/<ItemGrid/);
    for (const f of ['src/components/PaperDoll.tsx', 'src/components/Hotbar.tsx']) expect(SRC(f)).toMatch(/useDropZone|slotZone/);
    expect(SRC('App.tsx')).toMatch(/<HandsLayer/);
  });
});

// -----------------------------------------------------------------------------
// LINE 75 — the hotbar and the minimap
// -----------------------------------------------------------------------------

describe('line 75: a hotbar the HUD shows', () => {
  it('hands first, then tools, then the belt, each with its digit', () => {
    const eq = { ...LoadoutSystem.emptyEquipment(), slots: { BELT: 'b' }, items: [belt('b', 2)] };
    const cells = hotbarCells(eq);
    expect(cells.map(c => c.slot)).toEqual(['RIGHT_HAND', 'LEFT_HAND', 'TOOL_1', 'POUCH_1', 'POUCH_2']);
    expect(cells.map(c => c.digit)).toEqual(['1', '2', '3', '4', '5']);
    expect(cells.map(c => c.group)).toEqual(['HAND', 'HAND', 'TOOL', 'BELT', 'BELT']);
    expect(hotbarSlotForDigit(eq, '4')).toBe('POUCH_1');
    expect(hotbarSlotForDigit(eq, '9')).toBeNull();
  });

  it('nothing caps it: a belt of twelve pouches shows twelve, and digits reach as far as digits go', () => {
    const eq = { ...LoadoutSystem.emptyEquipment(), slots: { BELT: 'b' }, items: [belt('b', 12)] };
    const cells = hotbarCells(eq);
    expect(cells.filter(c => c.group === 'BELT').length).toBe(12);
    expect(cells[8].digit).toBe('9');
    expect(cells[9].digit).toBe('0');
    expect(cells[10].digit).toBeNull();
  });

  it('the HUD draws it from the harness, and a digit still reaches a belt pouch', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/<Hotbar/);
    expect(canvas).toMatch(/hotbarSlotForDigit/);
    const bar = SRC('src/components/Hotbar.tsx');
    expect(bar).toMatch(/hotbarCells\(/);
    expect(bar).toMatch(/quickUse\(/);
    // the seam between groups is a shape, never a hue
    expect(bar).toMatch(/group/);
  });
});

describe('line 75: a minimap, from the atoms, that keeps the fog', () => {
  const baseMap = (seed: string, sectors: any = {}) => ({ seed, width: 8, height: 8, gridVersion: 2, sectors, chunks: {}, generatedAt: 0 }) as any;
  const sector = (x: number, y: number, scanLevel: number, hasExtraction = false, biome = BiomeType.RUINS) => ({
    id: `${x},${y}`, x, y, biome, difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities: [], scanLevel, hasExtraction
  });
  const center = { x: 20480, z: 20480 };

  it('with nothing seen or scanned, it knows nothing: two different worlds draw the same but for the player', () => {
    const a = fieldMinimap({ map: baseMap('world_a'), center, seen: new Set(), things: [], exits: [] });
    const b = fieldMinimap({ map: baseMap('world_b'), center, seen: new Set(), things: [], exits: [] });
    expect(a.w).toBe(MINIMAP_ATOMS);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it('a hidden contact and a hidden exit do not change a single atom', () => {
    const bare = fieldMinimap({ map: baseMap('w'), center, seen: new Set(), things: [], exits: [] });
    const withMob = fieldMinimap({
      map: baseMap('w'), center, seen: new Set(),
      things: [{ x: center.x + 300, y: center.z, kind: 'HOSTILE' }],
      exits: [{ x: center.x + 200, y: center.z }]
    });
    expect(Buffer.from(bare.data).equals(Buffer.from(withMob.data))).toBe(true);
  });

  it('what has been seen draws, and a seen contact shows', () => {
    const qx = Math.floor(center.x / 320), qz = Math.floor(center.z / 320);
    const seen = new Set([`${qx},${qz}`]);
    const unseen = fieldMinimap({ map: baseMap('w'), center, seen: new Set(), things: [], exits: [] });
    const looked = fieldMinimap({ map: baseMap('w'), center, seen, things: [{ x: center.x + 40, y: center.z, kind: 'HOSTILE' }], exits: [] });
    expect(Buffer.from(unseen.data).equals(Buffer.from(looked.data))).toBe(false);
  });

  it('a scanned sector reads its biome, an unscanned one stays static; a scanned exit shows', () => {
    const sx = Math.floor(center.x / 10240), sy = Math.floor(center.z / 10240);
    const none = fieldMinimap({ map: baseMap('w'), center, seen: new Set(), things: [], exits: [] });
    const scanned = fieldMinimap({ map: baseMap('w', { [`${sx},${sy}`]: sector(sx, sy, ScanLevel.BASIC) }), center, seen: new Set(), things: [], exits: [] });
    expect(Buffer.from(none.data).equals(Buffer.from(scanned.data))).toBe(false);
  });

  it('marks read in grayscale, apart from the ground and apart from each other by shape', () => {
    const gray = grayscale(buildPalette(TERMINAL_GENRE));
    const value = (v: number) => gray[v * 3];
    const marks: MinimapMark[] = ['PLAYER', 'HOSTILE', 'EXIT', 'THING'];
    const shapes = marks.map(m => minimapMark(m));
    const prints = shapes.map(s => JSON.stringify(s.cells));
    expect(new Set(prints).size).toBe(marks.length);
    const plain = fieldMinimap({ map: baseMap('w'), center, seen: new Set(), things: [], exits: [] });
    const ground = value(plain.data[0]);
    for (const s of shapes) {
      expect(Math.abs(value(s.ink) - ground) / 255, `${s.ink}`).toBeGreaterThanOrEqual(MARK_GRAY_MIN);
    }
  });

  it('composing it stays inside its share of a frame', () => {
    const qx = Math.floor(center.x / 320), qz = Math.floor(center.z / 320);
    const seen = new Set<string>();
    for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) seen.add(`${qx + a},${qz + b}`);
    const things = Array.from({ length: 300 }, (_, i) => ({ x: center.x + (i % 40) * 20, y: center.z + (i % 30) * 20, kind: 'HOSTILE' as const }));
    const times: number[] = [];
    fieldMinimap({ map: baseMap('perf'), center, seen, things, exits: [] }); // first pass fills the terrain cache
    for (let i = 0; i < 25; i++) {
      const t = performance.now();
      fieldMinimap({ map: baseMap('perf'), center: { x: center.x + i * 3, z: center.z }, seen, things, exits: [] });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[12]).toBeLessThan(MINIMAP_COMPOSE_MS);
  });

  it('the city draws whole, with its lots told apart by state and the player marked', () => {
    const layout = HubGenerator.generate();
    const empty = cityMinimap(layout, {}, { x: 10, y: 10 });
    const owned = cityMinimap(layout, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, 'WORKSHOP'])) as any, { x: 10, y: 10 });
    const moved = cityMinimap(layout, {}, { x: 12, y: 10 });
    expect(empty.w).toBeGreaterThanOrEqual(layout.width);
    expect(Buffer.from(empty.data).equals(Buffer.from(moved.data))).toBe(false);
    expect(Buffer.from(empty.data).equals(Buffer.from(owned.data))).toBe(false);
  });

  it('both views mount one', () => {
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/fieldMinimap\(/);
    expect(SRC('src/entities/hub/HubCanvas.tsx')).toMatch(/cityMinimap\(/);
  });
});

// -----------------------------------------------------------------------------
// THE VIEWS (U12–U21)
// -----------------------------------------------------------------------------

describe('U13, U14: the stash is a grid, and selling is deliberate', () => {
  const items = () => [
    synth('s_helm', SlotType.HEAD, { name: 'Zinc Helm', rank: UniversalRank.C, value: 50, weight: 2 }),
    synth('s_axe', SlotType.TOOL, { name: 'Field Axe', rank: UniversalRank.F, value: 10, weight: 5, tags: ['tool', 'axe'], dimensions: { width: 1, height: 3 } }),
    rock('s_log', 2, 3, 9),
    synth('s_vial', SlotType.NONE, { name: 'Bitter Vial', type: ItemType.CONSUMABLE, value: 200, weight: 1, tags: ['consumable'] }),
    synth('s_sig', SlotType.MAIN_HAND, { name: 'Secret Blade', isIdentified: false, value: 999 })
  ];

  it('every item has a place, none overlap, and the rows grow rather than refuse', () => {
    const many = Array.from({ length: 300 }, (_, i) => rock(`m_${i}`, 2, 2));
    const layout = StashGrid.resolve(many);
    expect(Object.keys(layout).length).toBe(300);
    expect(StashGrid.occupied(many, layout)).toBe(1200);
    expect(StashGrid.rows(many, layout)).toBeGreaterThan(30);
    for (const p of Object.values(layout)) expect(p.x + 2).toBeLessThanOrEqual(STASH_COLS);
  });

  it('a chosen place stays chosen; a newcomer finds the next free cell', () => {
    const it = items();
    const layout = StashGrid.resolve(it, { s_helm: { x: 7, y: 5, rotated: false } });
    expect(layout['s_helm']).toEqual({ x: 7, y: 5, rotated: false });
    const after = StashGrid.resolve([...it, rock('new')], layout);
    expect(after['s_helm']).toEqual({ x: 7, y: 5, rotated: false });
    expect(after['new']).toBeTruthy();
  });

  it('it sorts by what can be seen', () => {
    const order = (key: any) => {
      const l = StashGrid.arrange(items(), key);
      return [...items()].sort((a, b) => l[a.id].y - l[b.id].y || l[a.id].x - l[b.id].x).map(i => i.id);
    };
    expect(order('VALUE')[0]).toBe('s_sig');
    expect(order('WEIGHT')[0]).toBe('s_log');
    expect(order('RANK')[0]).toBe('s_helm');
    expect(StashGrid.occupied(items(), StashGrid.arrange(items(), 'NAME'))).toBe(1 + 3 + 6 + 1 + 1);
  });

  it('D19: the filter finds no hidden name', () => {
    const blade = items().find(i => i.id === 's_sig')!;
    expect(StashGrid.matches(blade, { text: 'secret', kind: 'ALL' })).toBe(false);
    expect(StashGrid.matches(blade, { text: 'unidentified', kind: 'ALL' })).toBe(true);
    expect(StashGrid.matches(blade, { text: '', kind: 'UNREAD' }, player())).toBe(true);
  });

  it('filters by kind', () => {
    const it = items();
    expect(it.filter(i => StashGrid.matches(i, { text: '', kind: 'TOOL' })).map(i => i.id)).toEqual(['s_axe']);
    expect(it.filter(i => StashGrid.matches(i, { text: '', kind: 'GEAR' })).map(i => i.id)).toEqual(['s_helm', 's_sig']);
    expect(it.filter(i => StashGrid.matches(i, { text: '', kind: 'MATERIAL' })).map(i => i.id)).toEqual(['s_log']);
    expect(it.filter(i => StashGrid.matches(i, { text: '', kind: 'USE' })).map(i => i.id)).toEqual(['s_vial']);
    expect(it.filter(i => StashGrid.matches(i, { text: 'vial', kind: 'ALL' })).map(i => i.id)).toEqual(['s_vial']);
  });

  it('arranging is a store door, and it moves no item', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined, bank: { ...s.player.bank, stashTabs: [{ name: 'MAIN', items: items() }] } } }));
    const before = stash().map(i => i.id).sort();
    store().arrangeStash('VALUE');
    expect(stash().map(i => i.id).sort()).toEqual(before);
    expect(player().bank.stashTabs[0].layout!['s_sig']).toMatchObject({ x: 0, y: 0 });
  });

  it('selling is behind a deliberate step, in the stash and at the counter', () => {
    const hub = SRC('src/components/PlayerHub.tsx');
    const city = SRC('src/entities/hub/HubCanvas.tsx');
    expect(hub).toMatch(/ArmedButton/);
    expect(city).toMatch(/ArmedButton/);
    expect(hub).not.toMatch(/<Button tone="proof" onClick=\{\(\) => \{ void sellToVendor/);
    expect(SRC('src/components/ui/kit.tsx')).toMatch(/export const ArmedButton/);
  });

  it('the armed button acts on the second press only, and changes shape when armed', async () => {
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react-dom/test-utils');
    const { ArmedButton } = await import('../src/components/ui/kit');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let sold = 0;
    await act(async () => { root.render(React.createElement(ArmedButton, { onConfirm: () => { sold++; }, confirmLabel: 'SELL: SURE?' }, 'SELL 30G')); });
    const press = async () => { await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); }); };
    await press();
    expect(sold).toBe(0);
    expect(host.textContent).toContain('SELL: SURE?');
    expect((host.querySelector('button') as HTMLButtonElement).className).toContain('ws-btn--primary');
    await press();
    expect(sold).toBe(1);
    expect(host.textContent).toContain('SELL 30G');
    await act(async () => { root.unmount(); });
    host.remove();
  });
});

describe('U15–U21: the views', () => {
  it('U15: the body is a filled figure showing what is worn', () => {
    const doll = SRC('src/components/PaperDoll.tsx');
    expect(doll).toMatch(/figure\(/);
    expect(doll).toMatch(/weaponClass\(/);
    expect(doll).toMatch(/armorClass\(/);
  });

  it('U16: the city fills the window: its camera shows what fits and centers what does not', () => {
    const map = { w: 1000, h: 1000 };
    // a window smaller than the city follows and clamps
    expect(cityCamera({ w: 800, h: 600 }, map, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(cityCamera({ w: 800, h: 600 }, map, { x: 1000, y: 1000 })).toEqual({ x: 200, y: 400 });
    expect(cityCamera({ w: 800, h: 600 }, map, { x: 500, y: 500 })).toEqual({ x: 100, y: 200 });
    // a window larger than the city centers it, whole: nothing cut off
    const wide = cityCamera({ w: 1600, h: 1200 }, map, { x: 0, y: 0 });
    expect(wide).toEqual({ x: -300, y: -100 });
    const canvas = SRC('src/entities/hub/HubCanvas.tsx');
    expect(canvas).not.toMatch(/width=\{VIEWPORT_TILES \* TILE_SIZE\}/);
    expect(canvas).toMatch(/ResizeObserver/);
  });

  it('U18: recon says where to start, from what the drone has recorded and nothing else', () => {
    const blank = { seed: 's', width: 4, height: 4, sectors: {} as any } as any;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      blank.sectors[`${x},${y}`] = { x, y, biome: BiomeType.RUINS, difficulty: UniversalRank.SS, entities: [], scanLevel: ScanLevel.UNKNOWN, hasExtraction: x === 3 };
    }
    const first = suggestStart(blank);
    expect(first.kind).toBe('SCAN');
    expect(first.why).toMatch(/\S/);

    // The unscanned truth cannot move the suggestion
    const other = JSON.parse(JSON.stringify(blank));
    for (const k of Object.keys(other.sectors)) other.sectors[k].difficulty = UniversalRank.F;
    expect(suggestStart(other)).toEqual(first);

    // Once scanned, it reads the lowest threat with a way out
    blank.sectors['1,1'].scanLevel = ScanLevel.BASIC; blank.sectors['1,1'].difficulty = UniversalRank.C;
    blank.sectors['2,2'].scanLevel = ScanLevel.BASIC; blank.sectors['2,2'].difficulty = UniversalRank.F;
    blank.sectors['3,3'].scanLevel = ScanLevel.BASIC; blank.sectors['3,3'].difficulty = UniversalRank.D; // has the exit
    const next = suggestStart(blank);
    expect(next.kind).toBe('DROP');
    expect([next.x, next.y]).toEqual([3, 3]);

    const recon = SRC('src/components/WorldCanvas.tsx');
    expect(recon).toMatch(/suggestStart\(/);
    expect(recon).not.toMatch(/overflow: 'auto'\s*\}\}\s*>\s*<div style=\{\{ position: 'relative', width: currentMap\.width/);
  });

  it('U19: no hub stop when there is one hub', () => {
    expect(shouldSkipHubStop([{}])).toBe(true);
    expect(shouldSkipHubStop([])).toBe(false);
    expect(shouldSkipHubStop([{}, {}])).toBe(false);
    expect(SRC('src/components/HubSelector.tsx')).toMatch(/shouldSkipHubStop/);
  });

  it('U20: the player\'s bar carries no developer controls, and dev mode reaches them', () => {
    const app = SRC('App.tsx');
    const bar = app.slice(app.indexOf('const TerminalBar'), app.indexOf('const App: React.FC'));
    expect(bar).not.toMatch(/>ONLINE</);
    expect(bar).toMatch(/devMode &&/);
    const beforeDev = bar.slice(0, bar.indexOf('{devMode && ('));
    expect(beforeDev).not.toMatch(/CONSOLE/);
    expect(beforeDev).not.toMatch(/>BACKUP/);
    expect(beforeDev).not.toMatch(/>SWITCH/);
    expect(app).toMatch(/SYSTEM/); // backup and switch are the player's, one step in
  });

  it('U12, U21: no raw coordinates, and the key help stands apart from the data', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).not.toMatch(/POS \{Math\.floor/);
    expect(canvas).toMatch(/KeyHelp/);
    const city = SRC('src/entities/hub/HubCanvas.tsx');
    expect(city).not.toMatch(/\$\{playerTile\.x\}, \$\{playerTile\.y\}/);
  });
});

// -----------------------------------------------------------------------------
// LINE 76 — the character sheet
// -----------------------------------------------------------------------------

describe('line 76: one key, one sheet, field and city alike', () => {
  const mount = async () => {
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react-dom/test-utils');
    const { CharacterSheet } = await import('../src/components/CharacterSheet');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(CharacterSheet)); });
    const press = async (key: string, target: EventTarget = window) => {
      await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
    };
    const done = async () => { await act(async () => { root.unmount(); }); host.remove(); };
    return { host, press, done, act };
  };

  it('it opens and closes on one key, and is not there until asked', async () => {
    const { host, press, done } = await mount();
    expect(host.querySelector('[data-pack-window]')).toBeNull();
    await press('Tab');
    expect(host.querySelector('[data-pack-window]')).not.toBeNull();
    await press('Tab');
    expect(host.querySelector('[data-pack-window]')).toBeNull();
    await press('c');
    expect(host.querySelector('[data-pack-window]')).not.toBeNull();
    await press('Escape');
    expect(host.querySelector('[data-pack-window]')).toBeNull();
    await done();
  });

  it('at home: the vault, the body, the attributes and the skills on one screen', async () => {
    usePlayerStore.setState(s => ({
      player: {
        ...s.player, currentSession: undefined,
        bank: {
          ...s.player.bank,
          stashTabs: [{ name: 'MAIN', items: [rock('at_home')] }],
          universalSkills: { skill_identify_weapon: { id: 'skill_identify_weapon', level: 3, currentXp: 1, tags: ['study', 'intel'] } as any }
        }
      }
    }));
    const { host, press, done } = await mount();
    await press('Tab');
    const sheet = host.querySelector('[data-pack-window]') as HTMLElement;
    expect(sheet.textContent).toMatch(/THE VAULT/);
    expect(sheet.textContent).toMatch(/THE BODY/);
    expect(sheet.textContent).toMatch(/STR/);
    expect(sheet.textContent).toMatch(/SKILLS/);
    expect(sheet.querySelector('[data-item-id="at_home"]')).not.toBeNull();
    expect(sheet.querySelector('[data-drop-zone="sheet_vault"]')).not.toBeNull();
    await done();
  });

  it('in the field: the pack instead of the vault, and the same sheet around it', async () => {
    field([rock('in_field')]);
    const { host, press, done } = await mount();
    await press('Tab');
    const sheet = host.querySelector('[data-pack-window]') as HTMLElement;
    expect(sheet.textContent).toMatch(/PACK/);
    expect(sheet.textContent).not.toMatch(/THE VAULT/);
    expect(sheet.textContent).toMatch(/THE BODY/);
    expect(sheet.textContent).toMatch(/STR/);
    expect(sheet.querySelector('[data-item-id="in_field"]')).not.toBeNull();
    expect(sheet.querySelector('[data-drop-zone="pack"]')).not.toBeNull();
    await done();
  });

  it('a point spent on the sheet is really spent', async () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, attributePoints: 2 } }));
    const before = player().baseAttributes.strength;
    const { host, press, done, act } = await mount();
    await press('Tab');
    const raise = host.querySelector('[aria-label="Raise strength"]') as HTMLButtonElement;
    await act(async () => { raise.click(); });
    expect(player().baseAttributes.strength).toBe(before + 1);
    expect(player().attributePoints).toBe(1);
    await done();
  });

  it('it stays out of the way of typing and of an open window', async () => {
    const { host, press, done } = await mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    await press('c', input);
    expect(host.querySelector('[data-pack-window]')).toBeNull();
    input.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ws-overlay';
    document.body.appendChild(overlay);
    await press('Tab');
    expect(host.querySelector('[data-pack-window]')).toBeNull();
    overlay.remove();
    await done();
  });

  it('there is one sheet: the app mounts it, and the field keeps no pack window of its own', () => {
    const app = SRC('App.tsx');
    expect((app.match(/<CharacterSheet \/>/g) ?? []).length).toBe(2); // the field's tree and the city's
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).not.toMatch(/showPack/);
    expect(canvas).not.toMatch(/PackWindow/);
    expect(canvas).toMatch(/SHEET/);
    expect(SRC('src/components/CharacterSheet.tsx')).toMatch(/<PaperDoll/);
  });

  it('the other views are not on the player\'s bar; the city is the way to them, and each has a way back', () => {
    const app = SRC('App.tsx');
    const bar = app.slice(app.indexOf('const TerminalBar'), app.indexOf('const App: React.FC'));
    const beforeDev = bar.slice(0, bar.indexOf('{devMode && ('));
    expect(beforeDev).not.toMatch(/label: 'ZONES'/);
    expect(beforeDev).not.toMatch(/label: 'BANK'/);
    expect(beforeDev).not.toMatch(/label: 'HOLDINGS'/);
    expect(beforeDev).not.toMatch(/VIEW_KEYS/);
    expect(beforeDev).toMatch(/BACK TO THE CITY/);
    const city = SRC('src/entities/hub/HubCanvas.tsx');
    expect(city).toMatch(/effect\.panel === 'missions'\) setView\('MISSIONS'\)/); // the Conduit reaches the zones and the mint
    expect(city).toMatch(/setView\('HOLDINGS'\)[\s\S]*THE DEEDS|THE DEEDS[\s\S]*setView\('HOLDINGS'\)/); // an owner reaches the deeds from a room
  });

  it('DISCARD in the vault really discards, and only what was asked', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined, bank: { ...s.player.bank, stashTabs: [{ name: 'MAIN', items: [rock('keep'), rock('gone')] }] } } }));
    store().trashItem('gone', 'INVENTORY');
    expect(stash().map(i => i.id)).toEqual(['keep']);
  });
});

// -----------------------------------------------------------------------------
// PEDRO'S RUN, 2026-10-31: "the cart could be used unidentified" (lines 52, 73, 74)
// -----------------------------------------------------------------------------

describe('what has not been read cannot be worked, and does not give itself away', () => {
  const SECRET = 'Zzsecretname';
  const kit = (over: Partial<IItem> = {}) => synth('sig_kit', SlotType.NONE, {
    name: SECRET, isIdentified: false, cartData: { gridW: 10, gridH: 8 }, tags: ['cart', 'heavy'], dimensions: { width: 2, height: 3 }, ...over
  });
  const fed = () => useFeed.getState().lines.map(l => l.text).join(' | ');

  it('a cart kit nobody has read does not unfold, and stays in the pack', async () => {
    field([kit()]);
    const verdict = await store().deployCart('sig_kit');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/\S/);
    expect(verdict.reason).not.toContain(SECRET);
    expect(entities().filter(e => e.cart)).toEqual([]);
    expect(session().inventory.map(i => i.id)).toEqual(['sig_kit']);
    expect(fed()).not.toContain(SECRET);
  });

  it('read, the same kit unfolds', async () => {
    field([kit({ isIdentified: true })]);
    expect((await store().deployCart('sig_kit')).ok).toBe(true);
    expect(entities().filter(e => e.cart).length).toBe(1);
    expect(session().inventory).toEqual([]);
  });

  it('a charm nobody has read does not spend itself', () => {
    const charm = synth('sig_charm', SlotType.NONE, { name: SECRET, isIdentified: false });
    (charm as any).charmData = { slots: 1, chosen: false, uses: 1 };
    field([charm]);
    const verdict = store().useProtection('sig_charm');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).not.toContain(SECRET);
    expect(session().inventory.map(i => i.id)).toEqual(['sig_charm']);
  });

  it('the sheet offers one action for any signal, so the buttons tell nothing of what it is', async () => {
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react-dom/test-utils');
    const { CharacterSheet } = await import('../src/components/CharacterSheet');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const blade = synth('sig_blade', SlotType.MAIN_HAND, { name: SECRET, isIdentified: false, tags: ['melee'] });
    field([kit(), blade]);
    useSheet.setState({ open: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(CharacterSheet)); });
    const actionsOf = async (id: string) => {
      await act(async () => { (host.querySelector(`[data-item-id="${id}"]`) as HTMLButtonElement).click(); });
      const words = [...host.querySelectorAll('[data-pack-window] .ws-btn')].map(b => b.textContent ?? '').filter(t => !/^\+$/.test(t));
      await act(async () => { (host.querySelector(`[data-item-id="${id}"]`) as HTMLButtonElement).click(); });
      return words;
    };
    const onKit = await actionsOf('sig_kit');
    const onBlade = await actionsOf('sig_blade');
    expect(onKit.join()).not.toMatch(/UNFOLD/);
    expect(onKit).toContain('TRY IT');
    expect(onKit).toEqual(onBlade);
    expect(host.textContent).not.toContain(SECRET);
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('no door says the name of what has not been read, whatever is done with it', () => {
    const blade = synth('sig_blade', SlotType.MAIN_HAND, { name: SECRET, isIdentified: false, tags: ['melee'] });
    const worn = synth('sig_worn', SlotType.MAIN_HAND, { name: SECRET, isIdentified: false, tags: ['melee'] });
    const r = kit();
    const pouch = vialPouch('pch');
    field([blade, worn, r, pouch, belt('blt')], [cartEntity('cart_1')]);
    const heard: string[] = [];
    const listen = (v: { reason?: string }) => { if (v.reason) heard.push(v.reason); };
    store().equipSwap('blt');
    store().equipSwap('pch', 'POUCH_1');
    const places: Place[] = [
      { kind: 'SLOT', slot: 'CHEST' }, { kind: 'SLOT', slot: 'POUCH_1' }, { kind: 'SLOT', slot: 'TOOL_1' },
      { kind: 'PACK', x: 99, y: 99, rotated: false }, { kind: 'CART', entityId: 'cart_1', x: 99, y: 99, rotated: false }
    ];
    for (const item of [blade, r]) for (const to of places) {
      listen(probeMove(player(), held(item, { kind: 'PACK' }), to));
      listen(commitMove(held(item, { kind: 'PACK' }), to));
    }
    // and through a swap, a move off the body, the ground and the cart
    listen(store().equipSwap('sig_blade', 'RIGHT_HAND'));
    listen(store().equipSwap('sig_worn', 'RIGHT_HAND'));
    listen(store().unequipFromSlot('RIGHT_HAND'));
    const onePack = session().inventory.find(i => i.id === 'sig_blade');
    if (onePack) {
      listen(store().loadCart('cart_1', onePack.id));
      listen(store().unloadCart('cart_1', onePack.id));
      store().dropItem(onePack.id);
      const cache = entities().find(e => e.container?.items?.some(i => i.id === onePack.id));
      if (cache) listen(store().takeFromCache(cache.id, onePack.id));
    }
    expect(heard.join(' | ')).not.toContain(SECRET);
    expect(fed()).not.toContain(SECRET);
    expect(session().inventory.length + player().equipment!.items.length).toBeGreaterThan(0);
  });

  it('the hover says nothing either: no comparison, and no rank', () => {
    const blade = synth('sig_blade', SlotType.MAIN_HAND, { name: SECRET, isIdentified: false, rank: UniversalRank.S });
    const owned = synth('h', SlotType.MAIN_HAND, { stats: { attack_speed: 3 } });
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: { ...s.player.equipment!, slots: { RIGHT_HAND: 'h' }, items: [owned] } } }));
    expect(comparisonFor(blade, player())).toBeNull();
    expect(JSON.stringify(inspectItem(blade, player()))).not.toContain(SECRET);
    expect(SRC('src/components/ui/HoverLayer.tsx')).toMatch(/item\.isIdentified === false \? undefined : <RankMark/);
  });

  it('an eye not yet schooled refuses without naming the kind', () => {
    field([kit()]);
    const asked = store().fieldIdentify('sig_kit');
    expect(asked.ok).toBe(false);
    expect(asked.reason).not.toMatch(/\btool\b/);
    expect(asked.reason).not.toContain(SECRET);
    expect(asked.reason).toMatch(/not schooled/);
  });
});

// -----------------------------------------------------------------------------
// THE STANDING LAWS
// -----------------------------------------------------------------------------

describe('the standing laws reach everything this pass adds', () => {
  const FILES = [
    'src/components/ui/hands.tsx', 'src/components/ui/ItemGrid.tsx', 'src/components/ui/HoverLayer.tsx',
    'src/components/ui/MinimapView.tsx', 'src/components/Hotbar.tsx', 'src/components/CharacterSheet.tsx'
  ];
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it('no emoji and nothing below the floor', () => {
    for (const f of FILES) {
      const text = SRC(f);
      expect(text.match(EMOJI), f).toBeNull();
      for (const m of text.matchAll(/fontSize:\s*'?(\d+)(?:px)?'?/g)) expect(Number(m[1]), f).toBeGreaterThanOrEqual(12);
    }
  });

  it('the new grids and cells are native controls, and each answers Enter', () => {
    const grid = SRC('src/components/ui/ItemGrid.tsx');
    expect(grid).toMatch(/<button/);
    expect(grid).toMatch(/onKeyDown/);
    expect(grid).toMatch(/'Enter'/);
    expect(SRC('src/components/Hotbar.tsx')).toMatch(/<button/);
  });

  it('types.ts is additive: the layout on a stash tab is optional', () => {
    const types = SRC('types.ts');
    expect(types).toMatch(/layout\?: Record<string, IGridPlacement>/);
  });
});

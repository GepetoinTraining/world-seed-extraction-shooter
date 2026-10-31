/**
 * WAVE 10C BARS — registered before the load-out was built (guardrail 1).
 * Test lines 47–49:
 *   47 every slot on the body holds what it should and refuses what it should
 *      not, in voice, requirements included
 *   48 equipped gear weighs nothing against the carry limit; bags, pouches and
 *      the belt hold and stack exactly what their rules say
 *   49 a cart is loaded, towed at a cost, left, and recovered; nothing in it is
 *      ever lost or duplicated, even across a death
 * Plus the wave's own bars (PLAN 3B, Wave 10C): every slot holds/refuses with
 * the reason; no equip/unequip/bag/pouch/belt/cart sequence ever loses or
 * duplicates an item; equipped weight provably exempt while hauled weight
 * provably counts; cart contents deterministic and intact across reload and
 * across a death; the paper-doll reads in grayscale; the whole screen works by
 * keyboard. And the decisions' own laws: D22 (the head budget and the stat
 * partition — mental stats ONLY from frames, and they drive recon), D21 (the
 * slot-protection contract: a death keeps exactly the protected slots and the
 * receipt says by whose magic), D19 reaching back (no visible stat change for
 * unstudied affixes), D17 (a pouch stacks only what its rule names).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
  IItem, IAttributes, ItemType, SlotType, UniversalRank, Rarity,
  BODY_SLOT_IDS, EquipSlotId, HEAD_BUDGET_POSITIONS, MAX_FRAMES,
  TOOL_SLOT_COUNT, toolSlotIds, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES
} from '../types';
import { LoadoutSystem, paperDollLayout } from '../src/entities/player/systems/LoadoutSystem';
import { InventorySystem } from '../src/entities/player/systems/InventorySystem';
import { CartSystem } from '../src/entities/world/CartSystem';
import { CartOverlay } from '../src/entities/world/CartOverlay';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { COGNITIVE_FRAMES } from '../src/entities/player/data/cognitiveFrames';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { frameMark, itemArtFor } from '../src/render/atoms/items';
import { Sprite, buildPalette, grayscale } from '../src/render/atoms/atoms';
import { TERMINAL_GENRE } from '../src/components/ui/tokens';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const CART_GRID_MIN_CELLS = 49;     // the cart's grid is bigger than any pack (8x6=48)
const TOW_COST_MAX = 0.8;           // towing always costs: modifier strictly below this
const TOW_FLOOR = 0.3;              // but a cart can always be moved at all
const MARK_GRAY_DIFF_MIN = 0.25;    // frame mark vs item art, share of atoms apart in grayscale
const FRAME_TYPE_DIFF_MIN = 0.10;   // the three frame types apart from each other by shape
const SEQUENCE_OPS = 400;           // conservation fuzz length (keyed, deterministic)

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

/** Mint a specific base deterministically. */
const mintBase = (baseId: string, key: string, category: 'weapon' | 'armor' | 'tool' = 'armor'): IItem =>
  ItemFactory.createItem(undefined, true, Rng.fromKey(key), category, baseId);

/** A bare synthetic item when no base should interfere (no affixes, chosen slot). */
const synth = (id: string, slot: SlotType, over: Partial<IItem> = {}): IItem => ({
  id, universalDefinitionId: `syn_${id}`, name: over.name ?? id.toUpperCase(),
  description: '', type: over.type ?? ItemType.GEAR, slot,
  rank: over.rank ?? UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1,
  value: 1, itemPower: 1, tags: over.tags ?? [], affixes: over.affixes ?? [],
  dimensions: over.dimensions ?? { width: 1, height: 1 }, weight: over.weight ?? 1,
  stats: over.stats ?? {}, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i',
  history: { dropDate: 0, killCount: 0 }, isIdentified: over.isIdentified ?? true,
  ...(over.requirements ? { requirements: over.requirements } : {}),
  ...(over.pouchData ? { pouchData: over.pouchData } : {}),
  ...(over.beltData ? { beltData: over.beltData } : {}),
  ...(over.cartData ? { cartData: over.cartData } : {})
});

const FLAT_ATTRS = (n: number): IAttributes => ({
  strength: n, constitution: n, agility: n, dexterity: n, endurance: n,
  intelligence: n, focus: n, engineering: n, hacking: n, perception: n,
  charisma: n, intimidation: n, subterfuge: n, bartering: n, leadership: n
});

/** Boot a live store character with a session, deterministic. */
const bootPlayer = (uid = 'uid_loadout', attrs = 5) => {
  useIdentityStore.setState({ certificate: CERT(uid) } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      id: uid, username: 'LOADOUT', archetype: 'OPERATOR',
      baseAttributes: FLAT_ATTRS(attrs), attributes: FLAT_ATTRS(attrs),
      bank: { accountId: 'acc', gold: 1000, stashTabs: [{ name: 'MAIN', items: [] }], universalSkills: {}, lore: {} },
      materialMastery: {}, floatMemory: [null, null, null],
      equipment: undefined,
      currentSession: {
        sessionId: 'sess_loadout', layerId: 'test-layer',
        inventory: [], inventoryLayout: {}, kitItemIds: [],
        health: 100, maxHealth: 100, energy: 50,
        position: { x: 1500, y: 0, z: 1500 }, statusEffects: []
      }
    }
  }));
  usePlayerStore.getState().recalcWeight();
};

const session = () => usePlayerStore.getState().player.currentSession!;
const equipment = () => usePlayerStore.getState().player.equipment;
const packIds = () => session().inventory.map(i => i.id);
const addToPack = (items: IItem[]) => usePlayerStore.getState().tryAddItems(items);

beforeEach(() => {
  db.clear();
});

// =============================================================================
// 1. THE SLOT TREE (line 47): every slot holds what it should…
// =============================================================================

describe('the slot tree (10C.1, line 47)', () => {
  it('names the full body: fifteen positions plus dedicated TOOL slots', () => {
    expect(BODY_SLOT_IDS).toEqual(expect.arrayContaining([
      'HEAD', 'EYES', 'RIGHT_HAND', 'LEFT_HAND', 'CHEST', 'LEGS', 'BOOTS',
      'SHOULDER', 'BAG', 'NECKLACE', 'EARRING', 'RING_1', 'RING_2', 'QUIVER', 'BELT'
    ]));
    expect(BODY_SLOT_IDS.length).toBe(15);
    expect(TOOL_SLOT_COUNT).toBeGreaterThanOrEqual(1);
    // more tool-class slots are cheap to add: one call, any count
    expect(toolSlotIds(3)).toEqual(['TOOL_1', 'TOOL_2', 'TOOL_3']);
  });

  it('every slot holds what it should', () => {
    const fits: [IItem, EquipSlotId][] = [
      [synth('helm', SlotType.HEAD), 'HEAD'],
      [synth('glasses', SlotType.EYES), 'EYES'],
      [synth('sword', SlotType.MAIN_HAND, { tags: ['melee', 'one_hand'] }), 'RIGHT_HAND'],
      [synth('offhand', SlotType.OFF_HAND), 'LEFT_HAND'],
      [synth('plate', SlotType.CHEST), 'CHEST'],
      [synth('greaves', SlotType.LEGS), 'LEGS'],
      [synth('boots', SlotType.FEET), 'BOOTS'],
      [synth('mantle', SlotType.SHOULDER), 'SHOULDER'],
      [synth('satchel', SlotType.BAG), 'BAG'],
      [synth('pendant', SlotType.NECKLACE), 'NECKLACE'],
      [synth('stud', SlotType.EARRING), 'EARRING'],
      [synth('ring_a', SlotType.RING), 'RING_1'],
      [synth('ring_b', SlotType.RING), 'RING_2'],
      [synth('quiver', SlotType.QUIVER), 'QUIVER'],
      [synth('belt', SlotType.BELT), 'BELT'],
      [synth('pick', SlotType.TOOL, { tags: ['tool', 'pickaxe'] }), 'TOOL_1']
    ];
    for (const [item, slot] of fits) {
      const v = LoadoutSystem.slotAccepts(slot, item);
      expect(v.ok, `${item.name} should fit ${slot}: ${v.reason}`).toBe(true);
    }
  });

  it('every slot refuses what it should not, with the reason', () => {
    const boots = synth('boots', SlotType.FEET);
    const head = LoadoutSystem.slotAccepts('HEAD', boots);
    expect(head.ok).toBe(false);
    expect(head.reason).toMatch(/HEAD/);

    const ore = synth('ore', SlotType.NONE, { type: ItemType.RESOURCE });
    for (const slot of BODY_SLOT_IDS) {
      expect(LoadoutSystem.slotAccepts(slot, ore).ok, `resource must not fit ${slot}`).toBe(false);
    }

    // a pouch is not a belt: it rides IN one
    const pouch = synth('pouch', SlotType.POUCH, { pouchData: { accepts: ['consumable'], capacity: 4, contents: [] } });
    expect(LoadoutSystem.slotAccepts('BELT', pouch).ok).toBe(false);
    expect(LoadoutSystem.slotAccepts('POUCH_1', pouch).ok).toBe(true);
  });

  it('a one-handed weapon may ride the left hand; a two-handed one may not', () => {
    const oneHand = synth('kris', SlotType.MAIN_HAND, { tags: ['melee', 'one_hand'] });
    const twoHand = synth('maul', SlotType.MAIN_HAND, { tags: ['melee', 'two_hand', 'heavy'] });
    expect(LoadoutSystem.slotAccepts('LEFT_HAND', oneHand).ok).toBe(true);
    const v = LoadoutSystem.slotAccepts('LEFT_HAND', twoHand);
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it('legacy ACCESSORY tools find the TOOL slot (migration law)', () => {
    const pick = mintBase('tool_pick_rusty_t1', 'bars:pick', 'tool');
    expect(LoadoutSystem.slotForItem(pick)).toMatch(/^TOOL_/);
    expect(LoadoutSystem.slotAccepts('TOOL_1', pick).ok).toBe(true);
  });

  it('a full body stands at once: weapons in both hands AND a tool in its own slot', () => {
    bootPlayer();
    const sword = synth('sword', SlotType.MAIN_HAND, { tags: ['melee', 'one_hand'] });
    const off = synth('buckler', SlotType.OFF_HAND);
    const pick = synth('pick', SlotType.TOOL, { tags: ['tool', 'pickaxe'], stats: { mining_power: 20 } });
    addToPack([sword, off, pick]);
    expect(usePlayerStore.getState().equipToSlot(sword.id, 'RIGHT_HAND').ok).toBe(true);
    expect(usePlayerStore.getState().equipToSlot(off.id, 'LEFT_HAND').ok).toBe(true);
    expect(usePlayerStore.getState().equipToSlot(pick.id, 'TOOL_1').ok).toBe(true);
    const eq = equipment()!;
    expect(eq.slots.RIGHT_HAND).toBe(sword.id);
    expect(eq.slots.LEFT_HAND).toBe(off.id);
    expect(eq.slots.TOOL_1).toBe(pick.id);
    // the tool is used from its slot: nothing in the pack, nothing swapped
    expect(packIds()).toEqual([]);
  });
});

// =============================================================================
// 2. REQUIREMENTS (10C.2): refused in voice, with the numbers
// =============================================================================

describe('stat requirements (10C.2, line 47)', () => {
  it('an unmet requirement refuses in voice with both numbers and the attribute', () => {
    const helm = synth('greathelm', SlotType.HEAD, { requirements: { constitution: 8 } });
    const v = LoadoutSystem.checkRequirements(FLAT_ATTRS(2), helm);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/constitution/i);
    expect(v.reason).toMatch(/8/);
    expect(v.reason).toMatch(/2/);
  });

  it('meeting the requirement passes', () => {
    const helm = synth('greathelm', SlotType.HEAD, { requirements: { constitution: 8 } });
    expect(LoadoutSystem.checkRequirements(FLAT_ATTRS(8), helm).ok).toBe(true);
  });

  it('requirements derive deterministically from rank and tags, and climb with rank', () => {
    const f = LoadoutSystem.requirementsFor(synth('a', SlotType.MAIN_HAND, { tags: ['melee', 'heavy'], rank: UniversalRank.F }));
    const d = LoadoutSystem.requirementsFor(synth('b', SlotType.MAIN_HAND, { tags: ['melee', 'heavy'], rank: UniversalRank.D }));
    const d2 = LoadoutSystem.requirementsFor(synth('c', SlotType.MAIN_HAND, { tags: ['melee', 'heavy'], rank: UniversalRank.D }));
    expect(d).toEqual(d2);
    const fNeed = Math.max(0, ...Object.values(f));
    const dNeed = Math.max(0, ...Object.values(d));
    expect(dNeed).toBeGreaterThan(fNeed);
    // F-rank gear asks nothing a newborn cannot answer
    expect(fNeed).toBeLessThanOrEqual(1);
  });

  it('the store refuses the equip itself, in voice', () => {
    bootPlayer('uid_req', 1);
    const helm = synth('greathelm', SlotType.HEAD, { requirements: { constitution: 9 } });
    addToPack([helm]);
    const v = usePlayerStore.getState().equipToSlot(helm.id, 'HEAD');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/9/);
    // refused means untouched: still in the pack, not on the body
    expect(packIds()).toContain(helm.id);
    expect(equipment()?.slots.HEAD).toBeUndefined();
  });
});

// =============================================================================
// 3. THE HEAD BUDGET (D22): gear and frames cancel; the partition is law
// =============================================================================

describe('the head budget (D22)', () => {
  it('the budget is the four positions', () => {
    expect(HEAD_BUDGET_POSITIONS).toEqual(['HEAD', 'EYES', 'EARRING', 'NECKLACE']);
    expect(MAX_FRAMES).toBe(3);
  });

  it('a frame in HEAD refuses the helmet, in voice; dropping the frame admits it', () => {
    bootPlayer('uid_budget');
    const st = usePlayerStore.getState();
    expect(st.setFrame('HEAD', 'frame_analytic').ok).toBe(true);
    const helm = synth('helm', SlotType.HEAD);
    addToPack([helm]);
    const refused = usePlayerStore.getState().equipToSlot(helm.id, 'HEAD');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/frame|Analytic/i);
    expect(usePlayerStore.getState().setFrame('HEAD', null).ok).toBe(true);
    expect(usePlayerStore.getState().equipToSlot(helm.id, 'HEAD').ok).toBe(true);
  });

  it('gear in a position refuses a frame there', () => {
    bootPlayer('uid_budget2');
    const pendant = synth('pendant', SlotType.NECKLACE);
    addToPack([pendant]);
    expect(usePlayerStore.getState().equipToSlot(pendant.id, 'NECKLACE').ok).toBe(true);
    const v = usePlayerStore.getState().setFrame('NECKLACE', 'frame_diplomat');
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it('three frames at most: the fourth position keeps its gear, in voice', () => {
    bootPlayer('uid_budget3');
    const st = usePlayerStore.getState();
    expect(st.setFrame('HEAD', 'frame_analytic').ok).toBe(true);
    expect(st.setFrame('EYES', 'frame_architect').ok).toBe(true);
    expect(st.setFrame('EARRING', 'frame_flow').ok).toBe(true);
    const fourth = usePlayerStore.getState().setFrame('NECKLACE', 'frame_shadow');
    expect(fourth.ok).toBe(false);
    expect(fourth.reason).toMatch(/three|3/i);
  });

  it('frames drive effective attributes from their positions, mirrored into float memory', () => {
    bootPlayer('uid_budget4');
    const before = usePlayerStore.getState().player.attributes.intelligence;
    usePlayerStore.getState().setFrame('EARRING', 'frame_analytic'); // +3 intelligence
    const after = usePlayerStore.getState().player.attributes.intelligence;
    expect(after - before).toBe(COGNITIVE_FRAMES['frame_analytic'].modifiers.intelligence);
    const memory = usePlayerStore.getState().player.floatMemory.filter(Boolean);
    expect(memory.length).toBe(1);
    expect(memory[0]!.id).toBe('frame_analytic');
  });

  it('the stat partition is law: mental stats never ride physical gear', () => {
    expect([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].sort())
      .toEqual(Object.keys(FLAT_ATTRS(1)).sort());
    // gear granting a mental attribute is invalid — the rule 10E's banks inherit
    const psychicHelm = synth('psychic', SlotType.HEAD, {
      affixes: [{ id: 'af_mind', name: 'of Mind', type: 'SUFFIX', stats: { intelligence: 3 }, tier: 1 }]
    });
    const v = LoadoutSystem.validateStatPartition(psychicHelm);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/frame/i);
    // but the WARDROBE admits it: the partition is a stat law and a bank law,
    // not a dress code. Worn contraband moves no attribute — gear has no
    // pathway into the mind, so the robe is just armor with a dead line.
    bootPlayer('uid_partition');
    addToPack([psychicHelm]);
    const before = { ...usePlayerStore.getState().player.attributes };
    expect(usePlayerStore.getState().equipToSlot(psychicHelm.id, 'HEAD').ok).toBe(true);
    expect(usePlayerStore.getState().player.attributes).toEqual(before);
    // physical attributes on gear pass the partition
    const bracer = synth('bracer', SlotType.CHEST, {
      affixes: [{ id: 'af_ox', name: 'of the Ox', type: 'SUFFIX', stats: { strength: 2 }, tier: 1 }]
    });
    expect(LoadoutSystem.validateStatPartition(bracer).ok).toBe(true);
    // non-attribute simulation stats are not the partition's business
    const quick = synth('quick', SlotType.MAIN_HAND, { stats: { attack_speed: 1.4 } });
    expect(LoadoutSystem.validateStatPartition(quick).ok).toBe(true);
  });

  it('mental stats drive the recon phase: frames raise scan depth', () => {
    const base = LoadoutSystem.reconEfficiency(FLAT_ATTRS(1));
    expect(base).toBeGreaterThanOrEqual(1);
    const analyst = { ...FLAT_ATTRS(1), intelligence: 7, perception: 4, focus: 4 };
    expect(LoadoutSystem.reconEfficiency(analyst)).toBeGreaterThan(base);
    // physical stats move nothing in the survey
    const bull = { ...FLAT_ATTRS(1), strength: 20, constitution: 20 };
    expect(LoadoutSystem.reconEfficiency(bull)).toBe(base);
  });
});

// =============================================================================
// 4. THE WEIGHT LAW (10C.3, line 48): the limit is the haul, not the harness
// =============================================================================

describe('the weight law (10C.3, line 48)', () => {
  it('equipped gear weighs nothing against the carry limit', () => {
    bootPlayer('uid_weight', 1); // strength 1 -> cap 40kg
    const plate = synth('plate', SlotType.CHEST, { weight: 20 });
    addToPack([plate]);
    expect(usePlayerStore.getState().currentWeight).toBe(20);
    expect(usePlayerStore.getState().equipToSlot(plate.id, 'CHEST').ok).toBe(true);
    // the harness carries it now; the pack does not
    expect(usePlayerStore.getState().currentWeight).toBe(0);
    expect(LoadoutSystem.harnessWeight(equipment()!)).toBe(20);
    // and the freed capacity is real: a 35kg haul now fits
    const ore = synth('ore', SlotType.NONE, { type: ItemType.RESOURCE, weight: 35 });
    const { added } = addToPack([ore]);
    expect(added.length).toBe(1);
  });

  it('hauled weight still counts (the caps did not move)', () => {
    bootPlayer('uid_weight2', 1);
    const heavy = synth('slab', SlotType.NONE, { type: ItemType.RESOURCE, weight: 45 });
    const { rejected } = addToPack([heavy]);
    expect(rejected.length).toBe(1);
  });

  it('unequipping returns the weight to the pack, through the caps', () => {
    bootPlayer('uid_weight3', 1);
    const plate = synth('plate', SlotType.CHEST, { weight: 20 });
    addToPack([plate]);
    usePlayerStore.getState().equipToSlot(plate.id, 'CHEST');
    expect(usePlayerStore.getState().unequipFromSlot('CHEST').ok).toBe(true);
    expect(usePlayerStore.getState().currentWeight).toBe(20);
    expect(packIds()).toContain(plate.id);
  });

  it('unequip into a full pack refuses and the harness keeps the item', () => {
    bootPlayer('uid_weight4', 1);
    const plate = synth('plate', SlotType.CHEST, { weight: 2, dimensions: { width: 2, height: 3 } });
    addToPack([plate]);
    usePlayerStore.getState().equipToSlot(plate.id, 'CHEST');
    // brick the grid full
    const bricks = Array.from({ length: 12 }, (_, i) =>
      synth(`brick${i}`, SlotType.NONE, { type: ItemType.RESOURCE, weight: 0.1, dimensions: { width: 2, height: 2 } }));
    expect(addToPack(bricks).added.length).toBe(12);
    const v = usePlayerStore.getState().unequipFromSlot('CHEST');
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
    expect(equipment()!.slots.CHEST).toBe(plate.id);
    expect(equipment()!.items.some(i => i.id === plate.id)).toBe(true);
  });

  it('bags extend capacity (D17: the BAG slot earns its place)', () => {
    bootPlayer('uid_bag', 1);
    const cap0 = usePlayerStore.getState().maxWeight;
    const satchel = synth('satchel', SlotType.BAG, { weight: 2, stats: { carry_bonus_kg: 10 } });
    addToPack([satchel]);
    usePlayerStore.getState().equipToSlot(satchel.id, 'BAG');
    expect(usePlayerStore.getState().maxWeight).toBe(cap0 + 10);
    usePlayerStore.getState().unequipFromSlot('BAG');
    expect(usePlayerStore.getState().maxWeight).toBe(cap0);
  });
});

// =============================================================================
// 5. THE BELT AND POUCH LAW (D17, line 48)
// =============================================================================

const mkBelt = () => synth('belt', SlotType.BELT, { beltData: { pouchSlots: 2 } });
const mkVialPouch = (id = 'vialpouch') =>
  synth(id, SlotType.POUCH, { pouchData: { accepts: ['consumable'], capacity: 3, contents: [] } });
const mkPotion = (id: string) =>
  synth(id, SlotType.NONE, { type: ItemType.CONSUMABLE, tags: ['consumable'], stats: { health_restore: 15 }, weight: 0.5 });

describe('the belt and pouch law (D17, line 48)', () => {
  it('the belt opens pouch slots; without it there are none', () => {
    bootPlayer('uid_belt');
    expect(LoadoutSystem.availableSlots(equipment()).filter(s => s.startsWith('POUCH_'))).toEqual([]);
    const belt = mkBelt();
    addToPack([belt]);
    usePlayerStore.getState().equipToSlot(belt.id, 'BELT');
    expect(LoadoutSystem.availableSlots(equipment()).filter(s => s.startsWith('POUCH_')))
      .toEqual(['POUCH_1', 'POUCH_2']);
  });

  it('a pouch stacks ONLY what its rule names, in voice, up to its capacity', () => {
    bootPlayer('uid_pouch');
    const belt = mkBelt(); const pouch = mkVialPouch();
    addToPack([belt, pouch]);
    usePlayerStore.getState().equipToSlot(belt.id, 'BELT');
    expect(usePlayerStore.getState().equipToSlot(pouch.id, 'POUCH_1').ok).toBe(true);

    const potions = [mkPotion('p1'), mkPotion('p2'), mkPotion('p3'), mkPotion('p4')];
    const sword = synth('sword', SlotType.MAIN_HAND, { tags: ['melee'] });
    addToPack([...potions, sword]);

    expect(usePlayerStore.getState().stowInPouch('POUCH_1', 'p1').ok).toBe(true);
    expect(usePlayerStore.getState().stowInPouch('POUCH_1', 'p2').ok).toBe(true);
    expect(usePlayerStore.getState().stowInPouch('POUCH_1', 'p3').ok).toBe(true);

    const wrong = usePlayerStore.getState().stowInPouch('POUCH_1', sword.id);
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toMatch(/consumable|stacks/i);

    const overflow = usePlayerStore.getState().stowInPouch('POUCH_1', 'p4');
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toMatch(/3/); // the capacity, named
  });

  it('quick-use consumes from the pouch with no pack-opening', () => {
    bootPlayer('uid_quick');
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, health: 50 } } }));
    const belt = mkBelt(); const pouch = mkVialPouch();
    addToPack([belt, pouch, mkPotion('p1')]);
    usePlayerStore.getState().equipToSlot(belt.id, 'BELT');
    usePlayerStore.getState().equipToSlot(pouch.id, 'POUCH_1');
    usePlayerStore.getState().stowInPouch('POUCH_1', 'p1');
    const packBefore = packIds();
    expect(usePlayerStore.getState().quickUse('POUCH_1').ok).toBe(true);
    expect(session().health).toBe(65);
    const eq = equipment()!;
    const livePouch = eq.items.find(i => i.id === pouch.id)!;
    expect(livePouch.pouchData!.contents.length).toBe(0);
    expect(packIds()).toEqual(packBefore); // the pack never opened
  });

  it('unequipping the belt brings its pouches and their contents home intact', () => {
    bootPlayer('uid_beltoff');
    const belt = mkBelt(); const pouch = mkVialPouch();
    addToPack([belt, pouch, mkPotion('p1')]);
    usePlayerStore.getState().equipToSlot(belt.id, 'BELT');
    usePlayerStore.getState().equipToSlot(pouch.id, 'POUCH_1');
    usePlayerStore.getState().stowInPouch('POUCH_1', 'p1');
    expect(usePlayerStore.getState().unequipFromSlot('BELT').ok).toBe(true);
    // belt and pouch back in the pack; the potion still inside the pouch
    expect(packIds()).toEqual(expect.arrayContaining([belt.id, pouch.id]));
    const packPouch = session().inventory.find(i => i.id === pouch.id)!;
    expect(packPouch.pouchData!.contents.map(c => c.id)).toEqual(['p1']);
    expect(equipment()!.slots.BELT).toBeUndefined();
    expect(equipment()!.slots.POUCH_1).toBeUndefined();
  });
});

// =============================================================================
// 6. CONSERVATION: no sequence ever loses or duplicates an item (lines 48–49)
// =============================================================================

describe('conservation across every door', () => {
  it(`${SEQUENCE_OPS} keyed random loadout operations conserve the item multiset`, () => {
    bootPlayer('uid_fuzz', 9);
    const rng = Rng.fromKey('bars:loadout:fuzz:v1');
    const tracked: IItem[] = [
      synth('fz_helm', SlotType.HEAD), synth('fz_plate', SlotType.CHEST, { weight: 3 }),
      synth('fz_sword', SlotType.MAIN_HAND, { tags: ['melee', 'one_hand'] }),
      synth('fz_ring', SlotType.RING),
      synth('fz_belt', SlotType.BELT, { beltData: { pouchSlots: 2 } }),
      mkVialPouch('fz_pouch'),
      mkPotion('fz_p1'), mkPotion('fz_p2'),
      synth('fz_pick', SlotType.TOOL, { tags: ['tool'] })
    ];
    addToPack(tracked);
    let cart = CartSystem.newCart(synth('fz_cartkit', SlotType.NONE, { cartData: { gridW: 10, gridH: 8 } }), 'uid_fuzz', 'LOADOUT');

    const allIds = () => {
      const st = usePlayerStore.getState();
      const eq = st.player.equipment;
      const ids: string[] = [
        ...st.player.currentSession!.inventory.flatMap(i => [i.id, ...(i.pouchData?.contents.map(c => c.id) ?? [])]),
        ...(eq?.items.flatMap(i => [i.id, ...(i.pouchData?.contents.map(c => c.id) ?? [])]) ?? []),
        ...cart.items.map(i => i.id)
      ];
      return ids.filter(id => id.startsWith('fz_')).sort();
    };
    const expected = tracked.map(i => i.id).sort();
    expect(allIds()).toEqual(expected);

    const slots: EquipSlotId[] = ['HEAD', 'CHEST', 'RIGHT_HAND', 'RING_1', 'BELT', 'POUCH_1', 'TOOL_1'];
    for (let op = 0; op < SEQUENCE_OPS; op++) {
      const st = usePlayerStore.getState();
      const kind = rng.int(0, 6);
      if (kind === 0) {
        const inv = st.player.currentSession!.inventory.filter(i => i.id.startsWith('fz_'));
        if (inv.length) { const item = inv[rng.int(0, inv.length)]; st.equipToSlot(item.id, undefined); }
      } else if (kind === 1) {
        const used = Object.keys(st.player.equipment?.slots ?? {}) as EquipSlotId[];
        if (used.length) st.unequipFromSlot(used[rng.int(0, used.length)]);
      } else if (kind === 2) {
        const pots = st.player.currentSession!.inventory.filter(i => i.id.startsWith('fz_p') && i.type === ItemType.CONSUMABLE);
        if (pots.length) st.stowInPouch('POUCH_1', pots[rng.int(0, pots.length)].id);
      } else if (kind === 3) {
        st.takeFromPouch('POUCH_1');
      } else if (kind === 4) {
        const inv = st.player.currentSession!.inventory.filter(i => i.id.startsWith('fz_') && !i.pouchData?.contents.length);
        if (inv.length) {
          const item = inv[rng.int(0, inv.length)];
          const loaded = CartSystem.load(cart, item);
          if (loaded) {
            cart = loaded;
            usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: {
              ...s.player.currentSession!,
              inventory: s.player.currentSession!.inventory.filter(i2 => i2.id !== item.id)
            } } }));
            usePlayerStore.getState().recalcWeight();
          }
        }
      } else if (kind === 5) {
        if (cart.items.length) {
          const item = cart.items[rng.int(0, cart.items.length)];
          const { added } = usePlayerStore.getState().tryAddItems([item]);
          if (added.length) cart = CartSystem.unload(cart, item.id)!;
        }
      } else {
        const equipSlot = slots[rng.int(0, slots.length)];
        const eqItems = st.player.equipment?.items.filter(i => i.id.startsWith('fz_')) ?? [];
        if (eqItems.length) st.equipToSlot(eqItems[rng.int(0, eqItems.length)].id, equipSlot); // no-op or refusal, never loss
      }
      expect(allIds(), `after op ${op} kind ${kind}`).toEqual(expected);
    }
  });
});

// =============================================================================
// 7. THE SLOT-PROTECTION CONTRACT (D21, line 56's contract half)
// =============================================================================

describe('the slot-protection contract (D21)', () => {
  it('a slot is marked protected for the session, naming the magic', () => {
    bootPlayer('uid_protect');
    usePlayerStore.getState().markSlotProtected('CHEST', 'Ward of the Last Stand');
    expect(equipment()!.protected).toEqual([{ slot: 'CHEST', by: 'Ward of the Last Stand' }]);
  });

  it('the death path keeps exactly the protected slots — nothing more', () => {
    bootPlayer('uid_death');
    const plate = synth('plate', SlotType.CHEST, { weight: 2 });
    const helm = synth('helm', SlotType.HEAD);
    const loot = synth('loot', SlotType.NONE, { type: ItemType.RESOURCE });
    addToPack([plate, helm, loot]);
    usePlayerStore.getState().equipToSlot(plate.id, 'CHEST');
    usePlayerStore.getState().equipToSlot(helm.id, 'HEAD');
    usePlayerStore.getState().markSlotProtected('CHEST', 'Ward of the Last Stand');

    const outcome = usePlayerStore.getState().emergencyJackOut('INVENTORY_LOSS');

    const after = usePlayerStore.getState().player;
    // the protected slot survived, on the body
    expect(after.equipment!.slots.CHEST).toBe(plate.id);
    expect(after.equipment!.items.map(i => i.id)).toEqual([plate.id]);
    // everything else fell: the helm and the pack
    expect(after.equipment!.slots.HEAD).toBeUndefined();
    expect(after.bank.stashTabs[0].items.map(i => i.id)).not.toContain(helm.id);
    expect(after.bank.stashTabs[0].items.map(i => i.id)).not.toContain(loot.id);
    // the receipt's half: what was kept, and by whose magic
    expect(outcome.kept).toEqual([{ item: expect.objectContaining({ id: plate.id }), by: 'Ward of the Last Stand' }]);
    expect(outcome.lost.map(i => i.id).sort()).toEqual([helm.id, loot.id].sort());
    // protection is session-scoped: spent by the death
    expect(after.equipment!.protected).toEqual([]);
  });

  it('a clean extraction never consumes the marks or the gear', () => {
    bootPlayer('uid_extract');
    const plate = synth('plate', SlotType.CHEST);
    addToPack([plate]);
    usePlayerStore.getState().equipToSlot(plate.id, 'CHEST');
    const outcome = usePlayerStore.getState().emergencyJackOut('NONE');
    expect(outcome.lost).toEqual([]);
    expect(usePlayerStore.getState().player.equipment!.slots.CHEST).toBe(plate.id);
  });
});

// =============================================================================
// 8. THE CART (D16, line 49)
// =============================================================================

describe('the cart (D16, line 49)', () => {
  const kit = () => synth('cartkit', SlotType.NONE, {
    name: 'Field Cart', tags: ['cart'], weight: 14,
    dimensions: { width: 2, height: 3 }, cartData: { gridW: 10, gridH: 8 }
  });

  it('a cart has its own grid, bigger than any pack, under its owner seal', () => {
    const cart = CartSystem.newCart(kit(), 'uid_owner', 'BASALT');
    expect(cart.gridW * cart.gridH).toBeGreaterThanOrEqual(CART_GRID_MIN_CELLS);
    expect(cart.ownerId).toBe('uid_owner');
    expect(cart.ownerName).toBe('BASALT');
    expect(cart.items).toEqual([]);
    expect(cart.theftLog).toEqual([]);
  });

  it('loads through its grid and refuses a full grid in voice', () => {
    let cart = CartSystem.newCart(kit(), 'uid_owner', 'BASALT');
    const slabs = Array.from({ length: 20 }, (_, i) =>
      synth(`slab${i}`, SlotType.NONE, { type: ItemType.RESOURCE, dimensions: { width: 2, height: 2 }, weight: 8 }));
    for (const s of slabs.slice(0, 20)) {
      const next = CartSystem.load(cart, s);
      if (next) cart = next;
    }
    expect(cart.items.length).toBe(20); // 20 of 2x2 fill 10x8 exactly
    const refused = CartSystem.canLoad(cart, synth('onemore', SlotType.NONE, { type: ItemType.RESOURCE }));
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBeTruthy();
  });

  it('towing costs speed, more when loaded, never below the floor', () => {
    const empty = CartSystem.towSpeedModifier(0);
    expect(empty).toBeLessThan(TOW_COST_MAX);
    const loaded = CartSystem.towSpeedModifier(100);
    expect(loaded).toBeLessThan(empty);
    expect(CartSystem.towSpeedModifier(10_000)).toBeGreaterThanOrEqual(TOW_FLOOR);
  });

  it('cart contents are byte-deterministic across a reload', async () => {
    let cart = CartSystem.newCart(kit(), 'uid_owner', 'BASALT');
    cart = CartSystem.load(cart, synth('log1', SlotType.NONE, { type: ItemType.RESOURCE, dimensions: { width: 1, height: 3 } }))!;
    cart = CartSystem.load(cart, synth('ore1', SlotType.NONE, { type: ItemType.RESOURCE, weight: 4 }))!;
    const placed = { id: 'cart_1', position: { x: 2000, y: 1800 }, cart };
    await CartOverlay.save('world_test', [placed]);
    const restored = await CartOverlay.load('world_test');
    expect(JSON.stringify(restored)).toBe(JSON.stringify([placed]));
    // and a second save/load cycle changes nothing (no drift)
    await CartOverlay.save('world_test', restored);
    expect(JSON.stringify(await CartOverlay.load('world_test'))).toBe(JSON.stringify([placed]));
  });

  it('the cart stays in the world across your death, intact', async () => {
    bootPlayer('uid_cartdeath');
    let cart = CartSystem.newCart(kit(), 'uid_cartdeath', 'LOADOUT');
    cart = CartSystem.load(cart, synth('haul1', SlotType.NONE, { type: ItemType.RESOURCE }))!;
    await CartOverlay.save('world_d', [{ id: 'cart_d', position: { x: 100, y: 100 }, cart }]);

    usePlayerStore.getState().emergencyJackOut('INVENTORY_LOSS');

    const after = await CartOverlay.load('world_d');
    expect(after.length).toBe(1);
    expect(after[0].cart.items.map(i => i.id)).toEqual(['haul1']);
    expect(after[0].cart.ownerId).toBe('uid_cartdeath');
  });

  it('anyone may tow it away, and the theft is a signed fact', async () => {
    const cart = CartSystem.newCart(kit(), 'uid_owner', 'BASALT');
    const stolen = await CartSystem.recordTheft(cart, 'uid_thief', 'MAGPIE');
    expect(stolen.theftLog.length).toBe(1);
    expect(stolen.theftLog[0].by).toBe('uid_thief');
    expect(stolen.theftLog[0].byName).toBe('MAGPIE');
    expect(stolen.theftLog[0].at).toBeGreaterThan(0);
    // the owner's claim is not erased by the theft
    expect(stolen.ownerId).toBe('uid_owner');
    // towing by the owner signs nothing
    const honest = await CartSystem.recordTheft(cart, 'uid_owner', 'BASALT');
    expect(honest.theftLog.length).toBe(0);
  });
});

// =============================================================================
// 9. D19 REACHES BACK: the sheet is blind to the unstudied; the item acts
// =============================================================================

describe('the knowledge law reaches back (D19)', () => {
  it('equip shows NO visible stat change for unstudied affixes — while they act', () => {
    bootPlayer('uid_blind');
    const player = usePlayerStore.getState().player;
    const sly = synth('sly', SlotType.MAIN_HAND, {
      tags: ['melee'],
      stats: { damage: 10, attack_speed: 1.5 }, // merged: base 10 + affix 1.5… acting values
      affixes: [{ id: 'af_swift', name: 'Swift', type: 'PREFIX', stats: { attack_speed: 0.5 }, tier: 1 }]
    });
    expect(LoadoutSystem.isAffixStudied(player, 'af_swift')).toBe(false); // the stub: nothing is studied yet
    const visible = LoadoutSystem.visibleItemStats(sly, player);
    // the sheet subtracts what is unstudied; the acting stats stay merged
    expect(visible.attack_speed).toBe(1.0);
    expect(visible.damage).toBe(10);
    expect(sly.stats.attack_speed).toBe(1.5);
  });

  it('a wholly unidentified item shows nothing at all', () => {
    bootPlayer('uid_blind2');
    const noise = synth('noise', SlotType.MAIN_HAND, { isIdentified: false, stats: { damage: 22 } });
    expect(LoadoutSystem.visibleItemStats(noise, usePlayerStore.getState().player)).toEqual({});
  });
});

// =============================================================================
// 10. THE PAPER-DOLL: position and shape, keyboard-complete
// =============================================================================

describe('the paper-doll (10C.1)', () => {
  it('lays out every slot exactly once, no overlaps, in a stable keyboard order', () => {
    const layout = paperDollLayout();
    const ids = layout.map(c => c.slot);
    const expected = [...BODY_SLOT_IDS, ...toolSlotIds(TOOL_SLOT_COUNT)];
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i], b = layout[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.slot} overlaps ${b.slot}`).toBe(true);
      }
    }
    expect(paperDollLayout().map(c => c.slot)).toEqual(ids); // stable: the keyboard can trust it
  });

  it('a frame reads apart from gear and from emptiness in grayscale, by shape', () => {
    const logic = frameMark(COGNITIVE_FRAMES['frame_analytic']);
    const instinct = frameMark(COGNITIVE_FRAMES['frame_predator']);
    const social = frameMark(COGNITIVE_FRAMES['frame_diplomat']);
    const helm = itemArtFor(synth('helm', SlotType.HEAD, { tags: ['armor', 'heavy'] }));

    // Grayscale comparison, by the suite's convention: luminance via the
    // terminal's own palette; an atom counts as apart when its gray differs
    // by at least a ramp step, or when one sprite marks it and the other not.
    const gray = grayscale(buildPalette(TERMINAL_GENRE));
    const diff = (a: Sprite, b: Sprite) => {
      const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
      let changed = 0, total = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        // compare scaled onto the shared box so footprint differences read as shape
        const av = a.data[Math.floor((y * a.h) / h) * a.w + Math.floor((x * a.w) / w)] ?? 0;
        const bv = b.data[Math.floor((y * b.h) / h) * b.w + Math.floor((x * b.w) / w)] ?? 0;
        if (av === 0 && bv === 0) continue;
        total++;
        if ((av === 0) !== (bv === 0)) { changed++; continue; }
        if (Math.abs(gray[av * 3] - gray[bv * 3]) >= 24) changed++;
      }
      return total === 0 ? 0 : changed / total;
    };

    // a frame-held position is never mistaken for a gear-held one
    expect(diff(logic, helm)).toBeGreaterThanOrEqual(MARK_GRAY_DIFF_MIN);
    // the three frame types read apart from each other by shape alone
    expect(diff(logic, instinct)).toBeGreaterThanOrEqual(FRAME_TYPE_DIFF_MIN);
    expect(diff(logic, social)).toBeGreaterThanOrEqual(FRAME_TYPE_DIFF_MIN);
    expect(diff(instinct, social)).toBeGreaterThanOrEqual(FRAME_TYPE_DIFF_MIN);
    // a mark exists at all (an empty slot draws nothing)
    expect(logic.data.some(v => v !== 0)).toBe(true);
  });
});

// =============================================================================
// 11. MIGRATION: Wave 4's three buckets come in without loss
// =============================================================================

describe('migration (the contract is additive)', () => {
  it('a legacy session with mainHand/armor/accessory migrates into the tree', () => {
    bootPlayer('uid_legacy');
    const sword = synth('oldsword', SlotType.MAIN_HAND, { tags: ['melee', 'one_hand'] });
    const plate = synth('oldplate', SlotType.CHEST, { weight: 4 });
    const pick = synth('oldpick', SlotType.ACCESSORY, { tags: ['tool', 'pickaxe'] });
    usePlayerStore.setState(s => ({
      player: {
        ...s.player,
        equipment: undefined,
        currentSession: {
          ...s.player.currentSession!,
          inventory: [sword, plate, pick],
          inventoryLayout: InventorySystem.placeAll([sword, plate, pick]),
          equipped: { mainHand: sword.id, armor: plate.id, accessory: pick.id }
        }
      }
    }));

    const migrated = LoadoutSystem.migrate(usePlayerStore.getState().player);
    usePlayerStore.setState(s => ({ player: migrated }));
    usePlayerStore.getState().recalcWeight();

    const eq = usePlayerStore.getState().player.equipment!;
    expect(eq.slots.RIGHT_HAND).toBe(sword.id);
    expect(eq.slots.CHEST).toBe(plate.id);
    expect(eq.slots.TOOL_1).toBe(pick.id);
    // migrated items moved from pack to harness: nothing doubled, nothing lost
    expect(packIds()).toEqual([]);
    expect(eq.items.map(i => i.id).sort()).toEqual([sword.id, plate.id, pick.id].sort());
    // and the weight law applies to them at once
    expect(usePlayerStore.getState().currentWeight).toBe(0);
    // migration is idempotent
    const again = LoadoutSystem.migrate(migrated);
    expect(JSON.stringify(again.equipment)).toBe(JSON.stringify(eq));
  });
});

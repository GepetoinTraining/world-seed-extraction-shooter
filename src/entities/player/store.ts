import { create } from 'zustand';
import {
  IPlayer, IItem, UniversalRank, IAttributes, ICognitiveFrame, IEquippedSlots, SlotType,
  EquipSlotId, HeadPositionId, HEAD_BUDGET_POSITIONS, IEquipmentState, ItemType as IT
} from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { POINTS_PER_RANK_UP, ProgressionSystem } from './systems/ProgressionSystem';
import { SkillDiscovery, IActionContext } from './systems/SkillDiscovery';
import { DEFAULT_ATTRIBUTES, IBaseAttributes } from './types';
import { IPlayerCertificate } from '../identity/certificateSystem';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { useWorldStore } from '../world/store';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { LootTable } from '../world/LootTable';
import { LORE_FRAGMENTS } from '../lore/LoreBible';
import { SessionJournal } from '../../logic/journal/SessionJournal';
import { ItemType, Rarity } from '../../../types';
import { InventorySystem } from './systems/InventorySystem';
import { StashGrid, StashSortKey } from './systems/StashGrid';
import { LoadoutSystem, Verdict } from './systems/LoadoutSystem';
import { CartSystem } from '../world/CartSystem';
import { CartOverlay, IPlacedCart } from '../world/CartOverlay';
import { EntityType, ICartState } from '../world/types';
import { MaterialScience } from '../world/MaterialScience';
import { COGNITIVE_FRAMES } from './data/cognitiveFrames'; // Import definitions
import { useFeed } from '../../components/ui/stores'; // Wave 9.6: the machine says what happened
import { improvise } from '../../logic/systems/ImprovisedCrafting'; // Wave 10D: the floor
import { CompositionSystem } from '../../logic/economy/CompositionSystem';
import { StudySystem } from '../../logic/systems/StudySystem'; // Wave 10E: the knowledge law (D19)
import { InsuranceSystem } from '../../logic/systems/InsuranceSystem'; // Wave 10E: insurance is an item (D21)
import { DreamingSystem } from '../world/Dreaming'; // Wave 10E: the Dreaming (10E.3)
import { PROCESS_SKILL_XP_PER_JOB, ProcessFamily, ProcessSystem } from '../../logic/systems/ProcessSystem'; // The raw materials leg (D26)
import { IRoomState, roomAdditions } from '../hub/room';
import { chunkOf } from '../world/grid';
import { ISkillPair, MASTERY_RUNGS, WebSystem, rankIndexOf } from '../../logic/systems/WebSystem'; // D27: the web and the auto skill
import { TagLaw } from '../../logic/content/TagLaw';

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

/** The biome under a world position, when its chunk is built (10E: the Dreaming reads it). */
const biomeAt = (pos: { x: number; y: number }) => {
  const map = useWorldStore.getState().currentMap;
  return map?.chunks[`${chunkOf(pos.x)},${chunkOf(pos.y)}`]?.biome;
};

// Archetype Definitions for Character Creation
export const ARCHETYPES: Record<string, Partial<IBaseAttributes>> = {
  'OPERATOR': { intelligence: 3, hacking: 3, engineering: 2 },
  'STREET_SAMURAI': { strength: 2, agility: 3, dexterity: 2 }, 
  'NOMAD': { endurance: 3, perception: 3, subterfuge: 2 },
  'ARCANIST': { focus: 4, intelligence: 2, charisma: 2 }
};

interface PlayerState {
  player: IPlayer;
  view: 'BANK' | 'SESSION';
  lootContainer: IItem[] | null;
  lootContainerId: string | null;
  // Wave 10C (D16): the cart window — which cart entity stands open
  cartWindowId: string | null;
  openCartWindow: (entityId: string) => void;
  closeCartWindow: () => void;
  
  // Physics
  currentWeight: number;
  maxWeight: number;

  // --- ACTIONS ---
  initializeSession: (certificate: IPlayerCertificate, archetypeId: string) => void;
  // Wave 9.3: idempotent login — initializes ONLY when the store does not
  // already hold this identity's character, so a returning player is never
  // reset (handleLogin used to rebuild everyone as an Operator).
  ensureCharacter: (certificate: IPlayerCertificate, archetypeId: string) => void;
  // Wave 9.5: kills feed the universal rank
  applyKillXp: (amount: number) => { rankedUp: boolean; from: UniversalRank; to: UniversalRank; pointsGranted: number };
  spendAttributePoint: (attribute: keyof IAttributes) => boolean;
  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  // Wave 10C (D21): the death path returns what fell and what the magic kept
  emergencyJackOut: (penalty?: 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH') => { lost: IItem[]; kept: { item: IItem; by: string }[] };
  movePlayer: (direction: 'W' | 'A' | 'S' | 'D') => void;

  // Wave 10C: THE SLOT TREE
  /** Equip through every law at once. No slot given: the item finds its home. */
  equipToSlot: (itemId: string, slotId?: EquipSlotId) => Verdict;
  /** The usability pass (U6): equipping in one step. What the slot held goes where this came from. */
  equipSwap: (itemId: string, slotId?: EquipSlotId) => Verdict;
  /** The usability pass (line 59): set a pack item down on a chosen cell. */
  placeInPack: (itemId: string, x: number, y: number, rotated: boolean) => Verdict;
  /** The usability pass (U13): where things sit in the vault. Nothing here moves an item out of it. */
  placeInStash: (itemId: string, x: number, y: number, rotated: boolean) => Verdict;
  arrangeStash: (key: StashSortKey) => void;
  /** The usability pass (line 74): one thing out of a ground cache, through the pack's caps. */
  takeFromCache: (entityId: string, itemId: string) => Verdict;
  placeOnCart: (entityId: string, itemId: string, x: number, y: number, rotated: boolean) => Verdict;
  /** What is in this slot wears, whichever hand fired it. */
  wearSlot: (slot: EquipSlotId, amount: number) => void;
  /** Unequip to the pack (in session, cap-checked) or the stash (in the bank). */
  unequipFromSlot: (slotId: EquipSlotId) => Verdict;
  /** D22: set or clear a cognitive frame on a head-budget position. */
  setFrame: (position: HeadPositionId, frameId: string | null) => Verdict;
  /** D21: mark a slot protected for this session, naming the magic (10E's items spend this). */
  markSlotProtected: (slot: EquipSlotId, by: string, until?: number) => void;
  clearSlotProtection: (slot: EquipSlotId) => void;
  /** 10E (D21): spend a charm or scroll — the magic names exactly what it keeps. */
  useProtection: (itemId: string, chosenSlot?: EquipSlotId) => Verdict;
  /** 10E (D19): one sitting at a workstation — trains the scoped eye, opens this item's record. */
  studyItemAtStation: (itemId: string) => Verdict;
  /** D26: a sitting at this room's own bench opens what is worked into its walls. */
  studyRoomAtStation: (room: IRoomState) => Verdict;
  /** D26: lore reveals. A trade note read opens the first pool of its trade. */
  readLore: (itemId: string) => Verdict;
  /** D6, D26: a finished job is practice. The trade's skill grows, and hands learn. */
  practiceTrade: (family: ProcessFamily) => void;
  /** 10E (D19): ask the field identify — scoped and ALWAYS timed; the caller runs the clock. */
  fieldIdentify: (itemId: string) => { ok: boolean; reason?: string; seconds?: number };
  /** 10E (D19): the clock ran honestly — reveal the record through the one door. */
  completeFieldIdentify: (itemId: string) => Verdict;
  /** D17: pouches — stow through the pouch's own rule; quick-use without pack-opening. */
  stowInPouch: (pouchSlot: EquipSlotId, itemId: string) => Verdict;
  takeFromPouch: (pouchSlot: EquipSlotId) => Verdict;
  quickUse: (pouchSlot: EquipSlotId) => Verdict;

  // Wave 10C (D16): THE CART
  deployCart: (itemId: string) => Promise<Verdict>;
  towCart: (entityId: string) => Promise<Verdict>;
  releaseCart: () => void;
  loadCart: (entityId: string, itemId: string) => Verdict;
  unloadCart: (entityId: string, itemId: string) => Verdict;
  /** Write every cart in the live world into the overlay (death, exit, change). */
  persistCarts: () => Promise<void>;
  
  // Item Management
  identifyItem: (itemId: string) => void;
  openLootContainer: (id: string, items: IItem[]) => void;
  closeLootContainer: () => void;
  transferItem: (itemId: string, from: 'INVENTORY' | 'CONTAINER', to: 'INVENTORY' | 'CONTAINER') => void;
  trashItem: (itemId: string, source: 'INVENTORY' | 'CONTAINER') => void;
  
  // Float Memory
  equipFrame: (slotIndex: number, frameId: string) => void;
  unequipFrame: (slotIndex: number) => void;

  // Wave 3: the body is real
  tryAddItems: (items: IItem[]) => { added: IItem[]; rejected: IItem[] };
  dropItem: (itemId: string) => void;
  // Wave 10D (10D.2): the floor — stone-and-stick, no bench, anywhere
  improviseInField: (recipeId: string) => { ok: boolean; reason?: string };
  rotateItem: (itemId: string) => void;

  toggleCarry: (itemId: string) => void;
  consumeItem: (itemId: string) => void;

  // Wave 4: stats mean something
  equipItem: (itemId: string) => void;
  unequipSlot: (slot: keyof IEquippedSlots) => void;
  wearEquipment: (slot: keyof IEquippedSlots, amount: number) => void;

  // Mechanics
  recalcWeight: () => void;
  recalcAttributes: () => void; // NEW
  performInteraction: (interactionId: string, targetId: string) => void;
  gainSkillXp: (skillId: string, amount: number, tags: string[], actionContext?: IActionContext) => void;
  /** D27: work done with a pair. Held, it grows by use. Not held, it wings it and accrues. */
  workOn: (pair: ISkillPair, rank: number, xp: number) => void;
  processAction: (context: IActionContext) => void;
}

const INITIAL_PLAYER_TEMPLATE: IPlayer = {
  id: 'temp_id',
  username: 'Unknown',
  baseAttributes: DEFAULT_ATTRIBUTES, // RAW
  attributes: DEFAULT_ATTRIBUTES,     // EFFECTIVE
  bank: {
    accountId: 'temp_acc',
    gold: 100,
    stashTabs: [{ name: 'MAIN STASH', items: [] }],
    universalSkills: {},
    lore: {}
  },
  currentSession: undefined,
  materialMastery: {},
  floatMemory: [null, null, null]
};

let cacheSeq = 0;
const shown = LoadoutSystem.shownName.bind(LoadoutSystem);

export const usePlayerStore = create<PlayerState>((set, get) => ({
  player: INITIAL_PLAYER_TEMPLATE,
  view: 'BANK',
  lootContainer: null,
  lootContainerId: null,
  cartWindowId: null,
  openCartWindow: (entityId) => set({ cartWindowId: entityId }),
  closeCartWindow: () => set({ cartWindowId: null }),
  currentWeight: 0,
  maxWeight: 50,

  initializeSession: (certificate, archetypeId) => {
    const baseAttrs = { ...DEFAULT_ATTRIBUTES };
    const bonuses = ARCHETYPES[archetypeId] || {};
    
    // Apply Archetype Bonuses to BASE
    Object.entries(bonuses).forEach(([key, val]) => {
      if (key in baseAttrs) (baseAttrs as any)[key] += val;
    });

    set({
      player: {
        id: certificate.metadata.uid,
        username: certificate.metadata.displayName,
        archetype: archetypeId,
        baseAttributes: baseAttrs,
        attributes: baseAttrs, // Initially same as base
        bank: {
          accountId: `acc_${certificate.metadata.uid.substring(0, 8)}`,
          gold: 500,
          // Keyed genesis roll: the same identity always starts with the same item
          stashTabs: [{ name: 'CACHE_01', items: [ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey(`${certificate.metadata.uid}:genesis:starter`))] }],
          universalSkills: {},
          lore: {}
        },
        rankXp: 0,
        attributePoints: 0,
        materialMastery: {},
        floatMemory: [null, null, null]
      }
    });
  },

  ensureCharacter: (certificate, archetypeId) => {
    if (get().player.id === certificate.metadata.uid) return;
    get().initializeSession(certificate, archetypeId);
  },

  // --- RANK (Wave 9.5): kills count, and a rank-up gives something real ---

  applyKillXp: (amount) => {
    const before = get().player.rankXp ?? 0;
    const from = ProgressionSystem.rankFromXp(before);
    const after = before + Math.max(0, amount);
    const to = ProgressionSystem.rankFromXp(after);
    const ranks = ProgressionSystem.rankIndex(to) - ProgressionSystem.rankIndex(from);
    const pointsGranted = ranks > 0 ? ranks * POINTS_PER_RANK_UP : 0;
    set(state => ({
      player: {
        ...state.player,
        rankXp: after,
        attributePoints: (state.player.attributePoints ?? 0) + pointsGranted
      }
    }));
    return { rankedUp: ranks > 0, from, to, pointsGranted };
  },

  spendAttributePoint: (attribute) => {
    const p = get().player;
    if ((p.attributePoints ?? 0) <= 0) return false;
    if (!(attribute in p.baseAttributes)) return false;
    set(state => ({
      player: {
        ...state.player,
        attributePoints: (state.player.attributePoints ?? 0) - 1,
        baseAttributes: {
          ...state.player.baseAttributes,
          [attribute]: (state.player.baseAttributes as any)[attribute] + 1
        }
      }
    }));
    get().recalcAttributes();
    return true;
  },

  // --- THE HEAD BUDGET (D22) — frames live at positions; float memory mirrors ---

  /** LEGACY: index-based equip, kept for old callers. Routes through the budget. */
  equipFrame: (slotIndex, frameId) => {
    const position = HEAD_BUDGET_POSITIONS[slotIndex];
    if (position) get().setFrame(position, frameId);
  },

  unequipFrame: (slotIndex) => {
    const eq = get().player.equipment;
    if (!eq) return;
    // The legacy index counts worn frames in budget order
    const worn = HEAD_BUDGET_POSITIONS.filter(p => eq.frames[p]);
    if (worn[slotIndex]) get().setFrame(worn[slotIndex], null);
  },

  setFrame: (position, frameId) => {
    const equipment = get().player.equipment ?? LoadoutSystem.emptyEquipment();
    if (frameId !== null) {
      const verdict = LoadoutSystem.canSlotFrame(equipment, position, frameId);
      if (!verdict.ok) {
        feed(verdict.reason!, 'loss');
        return verdict;
      }
    }
    set(state => {
      const eq = state.player.equipment ?? LoadoutSystem.emptyEquipment();
      const frames = { ...eq.frames };
      if (frameId === null) delete frames[position];
      else frames[position] = frameId;
      return { player: { ...state.player, equipment: { ...eq, frames } } };
    });
    get().recalcAttributes();
    const frame = frameId ? COGNITIVE_FRAMES[frameId] : null;
    feed(frame ? `${frame.name} seated at ${position}. Mind holds the position.` : `${position} cleared. The position is open to matter again.`, 'signal');
    return { ok: true };
  },

  recalcAttributes: () => {
    set(state => {
      const { baseAttributes, equipment } = state.player;
      const newAttributes = { ...baseAttributes };

      // D22: frames apply from their head-budget positions (legacy floatMemory
      // only when no equipment exists yet — migration brings it in)
      const worn: ICognitiveFrame[] = equipment
        ? HEAD_BUDGET_POSITIONS.map(p => equipment.frames[p]).filter(Boolean).map(id => COGNITIVE_FRAMES[id!]).filter(Boolean)
        : (state.player.floatMemory.filter(Boolean) as ICognitiveFrame[]);

      worn.forEach(frame => {
        Object.entries(frame.modifiers).forEach(([key, val]) => {
          if (key in newAttributes) {
            (newAttributes as any)[key] += val;
          }
        });
      });

      // Clamp values (Min 1)
      Object.keys(newAttributes).forEach(k => {
        if ((newAttributes as any)[k] < 1) (newAttributes as any)[k] = 1;
      });

      // The legacy mirror: old readers see the worn frames, in budget order
      const mirror = [worn[0] ?? null, worn[1] ?? null, worn[2] ?? null] as [ICognitiveFrame | null, ICognitiveFrame | null, ICognitiveFrame | null];

      return {
        player: { ...state.player, attributes: newAttributes, floatMemory: mirror }
      };
    });
  },

  // --- THE SLOT TREE (Wave 10C): one door on, one door off ---

  equipToSlot: (itemId, slotId) => {
    const state = get();
    const player = state.player;
    const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
    const inSession = !!player.currentSession;

    // The item comes from the pack in the field, the stash in the bank —
    // or it is already on the body and moving to another slot.
    const pack = player.currentSession?.inventory ?? [];
    const stash = player.bank.stashTabs[0]?.items ?? [];
    const onBody = equipment.items.find(i => i.id === itemId);
    const item = onBody ?? (inSession ? pack.find(i => i.id === itemId) : stash.find(i => i.id === itemId));
    if (!item) return { ok: false, reason: 'No such item within reach.' };

    const target = slotId ?? LoadoutSystem.slotForItem(item, equipment);
    if (!target) return { ok: false, reason: `${shown(item)} has no slot on the body.` };

    const occupant = equipment.slots[target];
    if (occupant && occupant !== itemId) {
      const holder = equipment.items.find(i => i.id === occupant);
      const verdict = { ok: false, reason: `${target} holds ${holder ? shown(holder) : 'something'}. Unequip it first.` };
      feed(verdict.reason, 'loss');
      return verdict;
    }

    // Moving on the body: validate against the tree with its current slot ignored
    const currentSlot = onBody
      ? (Object.entries(equipment.slots).find(([, id]) => id === itemId)?.[0] as EquipSlotId | undefined)
      : undefined;
    const probe: IEquipmentState = currentSlot
      ? { ...equipment, slots: Object.fromEntries(Object.entries(equipment.slots).filter(([k]) => k !== currentSlot)) }
      : equipment;

    const verdict = LoadoutSystem.canEquip({ ...player, equipment: probe }, item, target);
    if (!verdict.ok) {
      feed(verdict.reason!, 'loss');
      return verdict;
    }

    set(s => {
      const eq = s.player.equipment ?? LoadoutSystem.emptyEquipment();
      const slots = { ...eq.slots };
      if (currentSlot) delete slots[currentSlot];
      slots[target] = itemId;
      const items = onBody ? eq.items : [...eq.items, item];

      let currentSession = s.player.currentSession;
      let stashTabs = s.player.bank.stashTabs;
      if (!onBody && inSession && currentSession) {
        const layout = { ...(currentSession.inventoryLayout || {}) };
        delete layout[itemId];
        currentSession = {
          ...currentSession,
          inventory: currentSession.inventory.filter(i => i.id !== itemId),
          inventoryLayout: layout
        };
      } else if (!onBody && !inSession) {
        stashTabs = stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab);
      }

      return {
        player: {
          ...s.player,
          equipment: { ...eq, slots, items },
          currentSession,
          bank: { ...s.player.bank, stashTabs }
        }
      };
    });
    get().recalcWeight();
    feed(`Equipped ${shown(item)} — ${target.replace('_', ' ')}.`, 'proof');
    return { ok: true };
  },

  equipSwap: (itemId, slotId) => {
    const player = get().player;
    const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
    const inSession = !!player.currentSession;
    const onBody = equipment.items.find(i => i.id === itemId);
    const pack = player.currentSession?.inventory ?? [];
    const stash = player.bank.stashTabs[0]?.items ?? [];
    const item = onBody ?? (inSession ? pack.find(i => i.id === itemId) : stash.find(i => i.id === itemId));
    if (!item) return { ok: false, reason: 'No such item within reach.' };

    const target = slotId ?? LoadoutSystem.slotForItem(item, equipment);
    if (!target) {
      const v = { ok: false, reason: `${shown(item)} has no slot on the body.` };
      feed(v.reason, 'loss');
      return v;
    }
    const occupantId = equipment.slots[target];
    if (!occupantId || occupantId === itemId) return get().equipToSlot(itemId, target);
    const holder = equipment.items.find(i => i.id === occupantId);
    if (!holder) return get().equipToSlot(itemId, target);

    // The laws ask first, with the slot as it will be: a refusal moves nothing.
    const currentSlot = onBody
      ? (Object.entries(equipment.slots).find(([, id]) => id === itemId)?.[0] as EquipSlotId | undefined)
      : undefined;
    const probe: IEquipmentState = {
      ...equipment,
      slots: Object.fromEntries(Object.entries(equipment.slots).filter(([k]) => k !== target && k !== currentSlot))
    };
    const say = (v: Verdict) => { if (v.reason) feed(v.reason, 'loss'); return v; };
    const verdict = LoadoutSystem.canEquip({ ...player, equipment: probe }, item, target);
    if (!verdict.ok) return say(verdict);

    // A belt comes off with its pouches, whole, through the one door that knows how.
    if (target === 'BELT' && Object.keys(equipment.slots).some(s => s.startsWith('POUCH_') && equipment.slots[s as EquipSlotId])) {
      const off = get().unequipFromSlot('BELT');
      return off.ok ? get().equipToSlot(itemId, target) : off;
    }

    if (onBody && currentSlot) {
      // Two pieces on the body trade places, if the old piece can sit in the new place.
      const back = LoadoutSystem.canEquip({ ...player, equipment: probe }, holder, currentSlot);
      if (!back.ok) return say(back);
      set(s => {
        const eq = s.player.equipment!;
        return { player: { ...s.player, equipment: { ...eq, slots: { ...eq.slots, [target]: itemId, [currentSlot]: holder.id } } } };
      });
      get().recalcWeight();
      feed(`${shown(item)} and ${shown(holder)} trade places.`, 'proof');
      return { ok: true };
    }

    if (inSession) {
      const session = player.currentSession!;
      const inv = pack.filter(i => i.id !== itemId);
      const layout = { ...(session.inventoryLayout || {}) };
      const oldPlace = layout[itemId];
      delete layout[itemId];
      const newBag = target === 'BAG' ? (item.stats?.carry_bonus_kg ?? 0) : LoadoutSystem.bagCapacityBonus(equipment);
      const limit = InventorySystem.maxCarryWeight(player.attributes.strength) + newBag;
      const weight = InventorySystem.totalWeight(inv) + InventorySystem.totalWeight([holder]);
      if (weight > limit) return say({ ok: false, reason: `The pack refuses the weight: ${weight.toFixed(1)} of ${limit} kg. The harness holds ${shown(holder)} still.` });
      const occ = InventorySystem.buildOccupancy(inv, layout);
      const here = oldPlace && (() => {
        const { w, h } = InventorySystem.footprint(holder, oldPlace.rotated);
        return InventorySystem.canPlaceAt(occ, w, h, oldPlace.x, oldPlace.y) ? oldPlace : null;
      })();
      const place = here || InventorySystem.autoPlace(inv, layout, holder);
      if (!place) return say({ ok: false, reason: `The pack refuses ${shown(holder)}: no room in the grid. The harness holds it still.` });
      layout[holder.id] = place;
      set(s => {
        const eq = s.player.equipment!;
        return {
          player: {
            ...s.player,
            equipment: { ...eq, slots: { ...eq.slots, [target]: itemId }, items: [...eq.items.filter(i => i.id !== holder.id), item] },
            currentSession: s.player.currentSession
              ? { ...s.player.currentSession, inventory: [...inv, holder], inventoryLayout: layout }
              : s.player.currentSession
          }
        };
      });
    } else {
      set(s => {
        const eq = s.player.equipment!;
        return {
          player: {
            ...s.player,
            equipment: { ...eq, slots: { ...eq.slots, [target]: itemId }, items: [...eq.items.filter(i => i.id !== holder.id), item] },
            bank: {
              ...s.player.bank,
              stashTabs: s.player.bank.stashTabs.map((tab, idx) => {
                if (idx !== 0) return tab;
                const layout = tab.layout ? { ...tab.layout } : undefined;
                if (layout) delete layout[itemId]; // the piece coming home finds its own cell
                return { ...tab, items: [...tab.items.filter(i => i.id !== itemId), holder], ...(layout ? { layout } : {}) };
              })
            }
          }
        };
      });
    }
    get().recalcWeight();
    feed(`Equipped ${shown(item)} — ${target.replace('_', ' ')}. ${shown(holder)} comes off.`, 'proof');
    return { ok: true };
  },

  placeInPack: (itemId, x, y, rotated) => {
    const session = get().player.currentSession;
    const item = session?.inventory.find(i => i.id === itemId);
    if (!session || !item) return { ok: false, reason: 'No such item in the pack.' };
    const layout = session.inventoryLayout || {};
    const { w, h } = InventorySystem.footprint(item, rotated);
    const occ = InventorySystem.buildOccupancy(session.inventory, layout);
    if (!InventorySystem.canPlaceAt(occ, w, h, x, y, itemId)) {
      return { ok: false, reason: `The pack has no room there. ${shown(item)} stays where it was.` };
    }
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventoryLayout: { ...(s.player.currentSession.inventoryLayout || {}), [itemId]: { x, y, rotated } }
      } }
    }) : s);
    return { ok: true };
  },

  placeInStash: (itemId, x, y, rotated) => {
    const tab = get().player.bank.stashTabs[0];
    const item = tab?.items.find(i => i.id === itemId);
    if (!tab || !item) return { ok: false, reason: 'No such item in the vault.' };
    const layout = StashGrid.resolve(tab.items, tab.layout);
    const { w, h } = InventorySystem.footprint(item, rotated);
    if (!StashGrid.canPlace(tab.items, layout, itemId, w, h, x, y)) {
      return { ok: false, reason: `The vault has something there. ${shown(item)} stays where it was.` };
    }
    layout[itemId] = { x, y, rotated };
    set(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, idx) => idx === 0 ? { ...t, layout } : t) } }
    }));
    return { ok: true };
  },

  arrangeStash: (key) => {
    set(s => ({
      player: {
        ...s.player,
        bank: {
          ...s.player.bank,
          stashTabs: s.player.bank.stashTabs.map((t, idx) => idx === 0 ? { ...t, layout: StashGrid.arrange(t.items, key) } : t)
        }
      }
    }));
  },

  takeFromCache: (entityId, itemId) => {
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    const inside = entity?.container?.items;
    const item = inside?.find(i => i.id === itemId);
    if (!entity || !inside || !item) return { ok: false, reason: 'Nothing of that name in the cache.' };
    const { added } = get().tryAddItems([item]);
    if (added.length === 0) {
      const v = { ok: false, reason: `The pack refuses ${shown(item)}. It stays in the cache.` };
      feed(v.reason, 'loss');
      return v;
    }
    const left = inside.filter(i => i.id !== itemId);
    if (left.length === 0) world.removeEntity(entityId);
    else world.updateEntity(entityId, { container: { ...entity.container!, items: left } });
    SessionJournal.record('INTERACT', { kind: 'CACHE_PICKUP', targetId: entityId, itemIds: [itemId] });
    return { ok: true };
  },

  placeOnCart: (entityId, itemId, x, y, rotated) => {
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (!entity?.cart) return { ok: false, reason: 'No cart there.' };
    const placed = CartSystem.placeAt(entity.cart, itemId, x, y, rotated);
    if (!placed) return { ok: false, reason: 'The cart bed has no room there. It stays where it was.' };
    world.updateEntity(entityId, { cart: placed });
    void get().persistCarts();
    return { ok: true };
  },

  unequipFromSlot: (slotId) => {
    const state = get();
    const player = state.player;
    const equipment = player.equipment;
    const itemId = equipment?.slots[slotId];
    const item = itemId ? equipment!.items.find(i => i.id === itemId) : undefined;
    if (!equipment || !itemId || !item) return { ok: false, reason: `${slotId} holds nothing.` };

    // A belt comes off with its pouches — all or nothing
    const coming: IItem[] = [item];
    const vacated: EquipSlotId[] = [slotId];
    if (slotId === 'BELT') {
      for (const [slot, id] of Object.entries(equipment.slots)) {
        if (slot.startsWith('POUCH_') && id) {
          const pouch = equipment.items.find(i => i.id === id);
          if (pouch) { coming.push(pouch); vacated.push(slot as EquipSlotId); }
        }
      }
    }

    const inSession = !!player.currentSession;
    if (inSession) {
      // The pack's caps hold: weight AND space for everything coming off, or nothing moves
      const session = player.currentSession!;
      const bagBonus = LoadoutSystem.bagCapacityBonus({
        ...equipment,
        slots: Object.fromEntries(Object.entries(equipment.slots).filter(([k]) => !vacated.includes(k as EquipSlotId)))
      });
      const maxW = InventorySystem.maxCarryWeight(player.attributes.strength) + bagBonus;
      const weight = InventorySystem.totalWeight(session.inventory) + InventorySystem.totalWeight(coming);
      if (weight > maxW) {
        const v = { ok: false, reason: `The pack refuses the weight: ${weight.toFixed(1)} of ${maxW} kg. The harness holds ${shown(item)} still.` };
        feed(v.reason, 'loss');
        return v;
      }
      let inv = [...session.inventory];
      let layout = { ...(session.inventoryLayout || {}) };
      for (const c of coming) {
        const place = InventorySystem.autoPlace(inv, layout, c);
        if (!place) {
          const v = { ok: false, reason: `The pack refuses ${shown(c)}: no room in the grid. The harness holds it still.` };
          feed(v.reason, 'loss');
          return v;
        }
        layout[c.id] = place;
        inv = [...inv, c];
      }
      set(s => {
        const eq = s.player.equipment!;
        const slots = { ...eq.slots };
        vacated.forEach(v => delete slots[v]);
        return {
          player: {
            ...s.player,
            equipment: { ...eq, slots, items: eq.items.filter(i => !coming.some(c => c.id === i.id)) },
            currentSession: s.player.currentSession ? { ...s.player.currentSession, inventory: inv, inventoryLayout: layout } : s.player.currentSession
          }
        };
      });
    } else {
      // The vault takes anything
      set(s => {
        const eq = s.player.equipment!;
        const slots = { ...eq.slots };
        vacated.forEach(v => delete slots[v]);
        return {
          player: {
            ...s.player,
            equipment: { ...eq, slots, items: eq.items.filter(i => !coming.some(c => c.id === i.id)) },
            bank: {
              ...s.player.bank,
              stashTabs: s.player.bank.stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: [...tab.items, ...coming] } : tab)
            }
          }
        };
      });
    }
    get().recalcWeight();
    feed(`Unequipped ${shown(item)}${coming.length > 1 ? ` and ${coming.length - 1} pouch${coming.length > 2 ? 'es' : ''}` : ''}.`, 'plain');
    return { ok: true };
  },

  // --- D21: THE SLOT-PROTECTION CONTRACT ---

  markSlotProtected: (slot, by, until) => {
    set(s => {
      const eq = s.player.equipment ?? LoadoutSystem.emptyEquipment();
      const kept = (eq.protected ?? []).filter(p => p.slot !== slot);
      return { player: { ...s.player, equipment: { ...eq, protected: [...kept, until ? { slot, by, until } : { slot, by }] } } };
    });
    feed(until
      ? `${slot} stands under ${by} until the clock says otherwise.`
      : `${slot} stands under ${by}. A death will not take what it holds.`, 'proof');
  },

  clearSlotProtection: (slot) => {
    set(s => {
      const eq = s.player.equipment;
      if (!eq) return s;
      return { player: { ...s.player, equipment: { ...eq, protected: (eq.protected ?? []).filter(p => p.slot !== slot) } } };
    });
  },

  // --- 10E (D21): INSURANCE IS AN ITEM — charms with uses, scrolls on a clock ---

  useProtection: (itemId, chosenSlot) => {
    const player = get().player;
    const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
    const inSession = !!player.currentSession;
    const source = inSession ? player.currentSession!.inventory : (player.bank.stashTabs[0]?.items ?? []);
    const item = source.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'No such item within reach.' };
    const unread = LoadoutSystem.unreadRefusal(item);
    if (!unread.ok) { feed(unread.reason!, 'loss'); return unread; }
    if (!item.charmData && !item.scrollData) return { ok: false, reason: `${item.name} holds no keeping magic.` };

    const occupied = Object.entries(equipment.slots)
      .filter(([, id]) => !!id)
      .map(([slot]) => slot as EquipSlotId);
    const plan = InsuranceSystem.plan(item, occupied, { chosenSlot });
    if (!plan.ok) {
      feed(plan.reason!, 'loss');
      return { ok: false, reason: plan.reason };
    }

    for (const slot of plan.slots!) get().markSlotProtected(slot, item.name, plan.until);

    // A use is a use: charms count down and leave at zero; scrolls burn whole.
    const spent = item.scrollData ? true : (item.charmData!.uses - 1) <= 0;
    set(s => {
      const update = (items: IItem[]) => spent
        ? items.filter(i => i.id !== itemId)
        : items.map(i => i.id === itemId && i.charmData
          ? { ...i, charmData: { ...i.charmData, uses: i.charmData.uses - 1 } }
          : i);
      if (s.player.currentSession && inSession) {
        const layout = { ...(s.player.currentSession.inventoryLayout || {}) };
        if (spent) delete layout[itemId];
        return { player: { ...s.player, currentSession: { ...s.player.currentSession, inventory: update(s.player.currentSession.inventory), inventoryLayout: layout } } };
      }
      return { player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: update(tab.items) } : tab) } } };
    });
    if (spent) feed(`${item.name} is spent. The magic holds; the vessel is done.`, 'plain');
    return { ok: true };
  },

  // --- 10E (D19): THE STUDY LAW — scoped identify, trained at a workstation ---

  studyItemAtStation: (itemId) => {
    const player = get().player;
    const stashItems = player.bank.stashTabs[0]?.items ?? [];
    const item = stashItems.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'That piece is not in the stash. Study happens at the bench, not in the field.' };
    const scope = StudySystem.identifyScopeOf(item);
    if (!scope) return { ok: false, reason: `${item.name} holds no maker's riddle. There is nothing to study.` };

    // The sitting: the scoped skill grows by use (D6), the record opens.
    get().gainSkillXp(StudySystem.scopeSkillId(scope), 60, ['study', 'intel'], { tags: ['study'], magnitude: 10 } as any);
    set(s => ({
      player: {
        ...StudySystem.reveal(s.player, item),
        bank: {
          ...s.player.bank,
          stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
            idx === 0 ? { ...tab, items: tab.items.map(i => i.id === itemId ? { ...i, isIdentified: true } : i) } : tab)
        }
      }
    }));
    const level = StudySystem.identifyLevel(get().player, item);
    feed(`Studied ${item.name}. The ${scope} eye stands at ${level}; what was banked on it is open.`, 'proof');
    // D27: loot teaches. What the piece implies accrues, and settles only at a rest.
    const teaches = WebSystem.reverseEngineer(item).designs.filter(d => !get().player.bank.universalSkills[d.skillId]);
    if (teaches.length > 0) {
      set(s => ({ player: teaches.reduce((p, d) => WebSystem.accrueFromStudy(p, { id: d.skillId, tags: d.tags }, rankIndexOf(item.rank)), s.player) }));
      feed(`Taking ${item.name} apart in your head: ${teaches.map(d => WebSystem.nameOf(d.skillId)).join(', ')}. It will settle, or it won't.`, 'signal');
    }
    return { ok: true };
  },

  studyRoomAtStation: (room) => {
    const additions = roomAdditions(room);
    if (additions.length === 0) return { ok: false, reason: 'Nothing was worked into this room. Raw walls hold no maker\'s riddle.' };
    const unread = additions.filter(a => !LoadoutSystem.isAffixStudied(get().player, a.id));
    if (unread.length === 0) return { ok: false, reason: 'You have read everything this room holds.' };
    get().gainSkillXp(StudySystem.scopeSkillId('furniture'), 60, ['study', 'intel'], { tags: ['study'], magnitude: 10 } as any);
    set(s => ({ player: StudySystem.revealAffixes(s.player, 'furniture', additions) }));
    feed(`Studied the room. ${unread.length} thing${unread.length === 1 ? '' : 's'} worked into it now read on the card.`, 'proof');
    return { ok: true };
  },

  readLore: (itemId) => {
    const player = get().player;
    const item = player.bank.stashTabs[0]?.items.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'That document is not in the stash.' };
    const data = item.loreData;
    if (!data) return { ok: false, reason: `${item.name} says what it says. It names no trade.` };
    const topic = ProcessSystem.noteTopic(data.processFamily);
    if (player.bank.lore[topic]) return { ok: false, reason: `You have read this already. The ${data.processFamily} it opens is yours.` };
    set(s => {
      const revealed = ProcessSystem.revealByLore(s.player, item);
      return {
        player: {
          ...revealed,
          bank: { ...revealed.bank, lore: { ...revealed.bank.lore, [topic]: { topic, xp: 0, level: 1, dateDiscovered: Date.now() } } }
        }
      };
    });
    feed(`Read ${item.name}. What common ${data.processFamily} leaves behind now reads on the card.`, 'proof');
    return { ok: true };
  },

  practiceTrade: (family) => {
    const skill = ProcessSystem.familySkill(family);
    get().gainSkillXp(skill, PROCESS_SKILL_XP_PER_JOB, ['craft', family], { tags: ['craft', family], magnitude: 5 } as any);
    const before = get().player;
    const after = ProcessSystem.revealBySkill(before, family);
    if (after !== before) {
      set({ player: after });
      feed(`Your hands know ${family} better now. What it leaves behind reads on the card.`, 'proof');
    }
  },

  fieldIdentify: (itemId) => {
    const player = get().player;
    const item = player.currentSession?.inventory.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'No such item in the pack.' };
    const verdict = StudySystem.canFieldIdentify(player, item);
    if (!verdict.ok) {
      feed(verdict.reason!, 'loss');
      return verdict;
    }
    return { ok: true, seconds: StudySystem.identifySeconds(StudySystem.identifyLevel(player, item)) };
  },

  completeFieldIdentify: (itemId) => {
    const player = get().player;
    const item = player.currentSession?.inventory.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'No such item in the pack.' };
    const verdict = StudySystem.canFieldIdentify(player, item);
    if (!verdict.ok) return verdict;

    set(s => {
      if (!s.player.currentSession) return s;
      const revealed = StudySystem.reveal(s.player, item);
      return {
        player: {
          ...revealed,
          currentSession: {
            ...s.player.currentSession,
            inventory: s.player.currentSession.inventory.map(i => i.id === itemId ? { ...i, isIdentified: true } : i)
          }
        }
      };
    });
    // the field use trains the eye too — skills grow by use, smaller away from the bench
    const scope = StudySystem.identifyScopeOf(item)!;
    get().gainSkillXp(StudySystem.scopeSkillId(scope), 15, ['study', 'intel']);
    feed(`${item.name} identified. The record reads exactly what was banked — downsides included.`, 'proof');
    return { ok: true };
  },

  // --- D17: POUCHES — the rule names what stacks; quick-use opens no pack ---

  stowInPouch: (pouchSlot, itemId) => {
    const player = get().player;
    const equipment = player.equipment;
    const pouch = equipment ? LoadoutSystem.itemIn(equipment, pouchSlot) : undefined;
    if (!pouch?.pouchData) return { ok: false, reason: `No pouch rides ${pouchSlot}.` };

    const inSession = !!player.currentSession;
    const source = inSession ? player.currentSession!.inventory : (player.bank.stashTabs[0]?.items ?? []);
    const item = source.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'No such item within reach.' };

    const verdict = LoadoutSystem.canStow(pouch, item);
    if (!verdict.ok) {
      feed(verdict.reason!, 'loss');
      return verdict;
    }

    set(s => {
      const eq = s.player.equipment!;
      const items = eq.items.map(i => i.id === pouch.id
        ? { ...i, pouchData: { ...i.pouchData!, contents: [...i.pouchData!.contents, item] } }
        : i);
      let currentSession = s.player.currentSession;
      let stashTabs = s.player.bank.stashTabs;
      if (inSession && currentSession) {
        const layout = { ...(currentSession.inventoryLayout || {}) };
        delete layout[itemId];
        currentSession = { ...currentSession, inventory: currentSession.inventory.filter(i => i.id !== itemId), inventoryLayout: layout };
      } else {
        stashTabs = stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab);
      }
      return { player: { ...s.player, equipment: { ...eq, items }, currentSession, bank: { ...s.player.bank, stashTabs } } };
    });
    get().recalcWeight();
    feed(`${shown(item)} rides the ${shown(pouch)}.`, 'plain');
    return { ok: true };
  },

  takeFromPouch: (pouchSlot) => {
    const player = get().player;
    const equipment = player.equipment;
    const pouch = equipment ? LoadoutSystem.itemIn(equipment, pouchSlot) : undefined;
    if (!pouch?.pouchData || pouch.pouchData.contents.length === 0) {
      return { ok: false, reason: `Nothing rides ${pouchSlot}.` };
    }
    const item = pouch.pouchData.contents[pouch.pouchData.contents.length - 1];

    const inSession = !!player.currentSession;
    if (inSession) {
      // through the caps, as everything is
      const session = player.currentSession!;
      const bagBonus = LoadoutSystem.bagCapacityBonus(equipment);
      const maxW = InventorySystem.maxCarryWeight(player.attributes.strength) + bagBonus;
      if (InventorySystem.totalWeight(session.inventory) + (item.weight || 0) > maxW) {
        return { ok: false, reason: `The pack refuses the weight of ${shown(item)}.` };
      }
      const place = InventorySystem.autoPlace(session.inventory, session.inventoryLayout || {}, item);
      if (!place) return { ok: false, reason: `The pack refuses ${shown(item)}: no room in the grid.` };
      set(s => {
        const eq = s.player.equipment!;
        const items = eq.items.map(i => i.id === pouch.id
          ? { ...i, pouchData: { ...i.pouchData!, contents: i.pouchData!.contents.slice(0, -1) } }
          : i);
        return {
          player: {
            ...s.player,
            equipment: { ...eq, items },
            currentSession: s.player.currentSession ? {
              ...s.player.currentSession,
              inventory: [...s.player.currentSession.inventory, item],
              inventoryLayout: { ...(s.player.currentSession.inventoryLayout || {}), [item.id]: place }
            } : s.player.currentSession
          }
        };
      });
    } else {
      set(s => {
        const eq = s.player.equipment!;
        const items = eq.items.map(i => i.id === pouch.id
          ? { ...i, pouchData: { ...i.pouchData!, contents: i.pouchData!.contents.slice(0, -1) } }
          : i);
        return {
          player: {
            ...s.player,
            equipment: { ...eq, items },
            bank: {
              ...s.player.bank,
              stashTabs: s.player.bank.stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: [...tab.items, item] } : tab)
            }
          }
        };
      });
    }
    get().recalcWeight();
    return { ok: true };
  },

  quickUse: (pouchSlot) => {
    const player = get().player;
    const session = player.currentSession;
    const equipment = player.equipment;
    const pouch = equipment ? LoadoutSystem.itemIn(equipment, pouchSlot) : undefined;
    if (!pouch?.pouchData) return { ok: false, reason: `No pouch rides ${pouchSlot}.` };
    const item = pouch.pouchData.contents.find(c => c.type === IT.CONSUMABLE);
    if (!item) return { ok: false, reason: `${pouch.name} holds nothing quick to use.` };
    if (!session) return { ok: false, reason: 'Quick-use is for the field.' };

    const restore = item.stats?.health_restore || 0;
    const health = Math.max(1, Math.min(session.maxHealth, session.health + restore));
    set(s => {
      const eq = s.player.equipment!;
      const items = eq.items.map(i => i.id === pouch.id
        ? { ...i, pouchData: { ...i.pouchData!, contents: i.pouchData!.contents.filter(c => c.id !== item.id) } }
        : i);
      return {
        player: {
          ...s.player,
          equipment: { ...eq, items },
          currentSession: s.player.currentSession ? { ...s.player.currentSession, health } : s.player.currentSession
        }
      };
    });
    SessionJournal.record('INTERACT', { kind: 'QUICK_USE', itemId: item.id, restore, health });
    feed(`${item.name}, straight from the belt: ${restore >= 0 ? '+' : ''}${restore} health. The pack never opened.`, restore >= 0 ? 'signal' : 'loss');
    return { ok: true };
  },

  // --- D16: THE CART — a towed world entity that outlives you ---

  deployCart: async (itemId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { ok: false, reason: 'A cart unfolds in the field, nowhere else.' };
    const item = session.inventory.find(i => i.id === itemId);
    if (item) {
      const unread = LoadoutSystem.unreadRefusal(item); // Pedro's run: it unfolded before anyone had read it
      if (!unread.ok) { feed(unread.reason!, 'loss'); return unread; }
    }
    if (!item?.cartData) return { ok: false, reason: 'That does not unfold into a cart.' };

    const world = useWorldStore.getState();
    if (!world.currentMap) return { ok: false, reason: 'No world to stand it in.' };

    let cart = CartSystem.newCart(item, state.player.id, state.player.username);
    // The owner's seal over the deploy record — the claim the theft log is measured against
    try {
      const { CertificateSystem } = await import('../identity/certificateSystem');
      const signed = await CertificateSystem.signPayload(state.player.id, {
        kind: 'CART_DEPLOY', cartItemId: item.id, owner: state.player.id, at: Date.now()
      });
      cart = { ...cart, sealSignature: signed.signature };
    } catch { /* unsigned deploy still stands; the record says so */ }

    const entityId = `cart_${item.id}`;
    const pos = session.position;
    const layout = { ...(session.inventoryLayout || {}) };
    delete layout[itemId];
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventory: s.player.currentSession.inventory.filter(i => i.id !== itemId),
        inventoryLayout: layout
      } }
    }) : s);
    get().recalcWeight();

    world.addEntity({
      id: entityId,
      type: EntityType.CART,
      definitionId: 'cart_field',
      position: { x: pos.x + 24, y: pos.z },
      rank: item.rank,
      rarity: item.rarity,
      isHostile: false,
      cart
    });
    SessionJournal.record('INTERACT', { kind: 'CART_DEPLOY', entityId, cartItemId: item.id });
    feed(`${item.name} unfolds. Its bed is ${cart.gridW}×${cart.gridH}; your seal is on it. It stays in the world — even past your death.`, 'proof');
    await get().persistCarts();
    return { ok: true };
  },

  towCart: async (entityId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { ok: false, reason: 'Nothing to tow outside the field.' };
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (!entity?.cart) return { ok: false, reason: 'No cart there.' };

    const isTheft = entity.cart.ownerId !== state.player.id;

    // 10E (D16's addendum): a warded cart costs the thief TIME before the bar
    // gives. The owner pays none; the broken lock lands in the signed record.
    const security = entity.cart.security;
    if (isTheft && security && security.lockLevel > 0) {
      const seconds = CartSystem.towBreakSeconds(security.lockLevel);
      feed(`${entity.cart.ownerName}'s cart stands ${security.by}: ${security.lockLevel} lock${security.lockLevel === 1 ? '' : 's'}. Breaking them takes ${seconds}s.`, 'loss');
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      const still = Object.values(useWorldStore.getState().currentMap?.chunks || {})
        .flatMap(c => c.entities).find(e => e.id === entityId);
      if (!still?.cart || still.cart.towedBy) return { ok: false, reason: 'The cart is gone, or another hand beat you to the bar.' };
    }
    // The alarm needs no lock to shriek (found in play: the first Shrieking
    // cart was stolen in silence because the shriek hid behind the lock branch)
    if (isTheft && security?.alarm) {
      feed('A shriek crosses the field. The ward says your name to anyone listening.', 'loss');
    }

    let cart: ICartState = { ...entity.cart, towedBy: state.player.id };
    if (isTheft) {
      cart = await CartSystem.recordTheft(cart, state.player.id, state.player.username);
      void import('../../logic/ledger/Ledger').then(({ Ledger }) =>
        Ledger.append('TRADE', {
          kind: 'CART_THEFT', cartItemId: cart.cartItemId,
          owner: cart.ownerId, ownerName: cart.ownerName, thief: state.player.id
        })).catch(() => {});
      feed(`You take the tow bar of a cart under ${cart.ownerName}'s seal. The theft is on record, signed.`, 'loss');
    } else {
      feed('You take the tow bar. The cart follows; your pace pays for it.', 'signal');
    }

    world.updateEntity(entityId, { cart });
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: { ...s.player.currentSession, towingCartId: entityId } }
    }) : s);
    SessionJournal.record('INTERACT', { kind: isTheft ? 'CART_THEFT' : 'CART_TOW', entityId });
    await get().persistCarts();
    return { ok: true };
  },

  releaseCart: () => {
    const session = get().player.currentSession;
    const entityId = session?.towingCartId;
    if (!entityId) return;
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (entity?.cart) world.updateEntity(entityId, { cart: { ...entity.cart, towedBy: undefined } });
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: { ...s.player.currentSession, towingCartId: undefined } }
    }) : s);
    SessionJournal.record('INTERACT', { kind: 'CART_RELEASE', entityId });
    feed('The tow bar drops. The cart stands where it stands.', 'plain');
    void get().persistCarts();
  },

  loadCart: (entityId, itemId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { ok: false, reason: 'The cart is in the field.' };
    const item = session.inventory.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'No such item in the pack.' };
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (!entity?.cart) return { ok: false, reason: 'No cart there.' };

    const verdict = CartSystem.canLoad(entity.cart, item);
    if (!verdict.ok) {
      feed(verdict.reason!, 'loss');
      return verdict;
    }
    const loaded = CartSystem.load(entity.cart, item)!;
    const layout = { ...(session.inventoryLayout || {}) };
    delete layout[itemId];
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventory: s.player.currentSession.inventory.filter(i => i.id !== itemId),
        inventoryLayout: layout
      } }
    }) : s);
    world.updateEntity(entityId, { cart: loaded });
    get().recalcWeight();
    SessionJournal.record('INTERACT', { kind: 'CART_LOAD', entityId, itemId });
    feed(`${shown(item)} onto the cart bed. The pack breathes; the tow bar will not.`, 'plain');
    void get().persistCarts();
    return { ok: true };
  },

  unloadCart: (entityId, itemId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { ok: false, reason: 'The cart is in the field.' };
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (!entity?.cart) return { ok: false, reason: 'No cart there.' };
    const item = entity.cart.items.find(i => i.id === itemId);
    if (!item) return { ok: false, reason: 'Nothing of that name aboard.' };

    const { added, rejected } = get().tryAddItems([item]);
    if (rejected.length > 0 || added.length === 0) {
      const v = { ok: false, reason: `The pack refuses ${shown(item)} — space or weight. It stays aboard.` };
      feed(v.reason, 'loss');
      return v;
    }
    world.updateEntity(entityId, { cart: CartSystem.unload(entity.cart, itemId)! });
    SessionJournal.record('INTERACT', { kind: 'CART_UNLOAD', entityId, itemId });
    void get().persistCarts();
    return { ok: true };
  },

  persistCarts: async () => {
    const world = useWorldStore.getState();
    const worldUid = world.activeWorldId;
    if (!worldUid || !world.currentMap) return;
    const placed: IPlacedCart[] = Object.values(world.currentMap.chunks)
      .flatMap(c => c.entities)
      .filter(e => e.type === EntityType.CART && e.cart)
      .map(e => ({
        id: e.id,
        position: { x: e.position.x, y: e.position.y },
        // a towed cart is saved standing: whoever held the bar is gone with the session
        cart: { ...e.cart!, towedBy: undefined }
      }));
    await CartOverlay.save(worldUid, placed);
  },

  // ... (Rest of existing actions: setView, diveIntoLayer, etc. keep same) ...

  setView: (view) => set({ view }),

  diveIntoLayer: (layerId = 'layer-01-fantasy') => {
    const { player } = get();
    if (player.currentSession) return;

    // Wave 2: FIELD KIT — tools in the main stash are carried into the raid.
    // They leave the bank (they're on your back now) and return on extraction
    // via normal banking. Wave 4's death rules will make losing them real.
    const mainStash = player.bank.stashTabs[0]?.items || [];
    const carried = (i: IItem) => i.tags?.includes('tool') || player.bank.carryItemIds?.includes(i.id);
    const fieldKit = mainStash.filter(carried);
    const remainingStash = mainStash.filter(i => !carried(i));
    if (fieldKit.length > 0) console.log(`[DIVE] Field kit equipped: ${fieldKit.map(i => i.name).join(', ')}`);

    set((state) => ({
      view: 'SESSION',
      player: {
        ...state.player,
        bank: {
          ...state.player.bank,
          carryItemIds: [],
          stashTabs: state.player.bank.stashTabs.map((tab, idx) =>
            idx === 0 ? { ...tab, items: remainingStash } : tab
          )
        },
        currentSession: {
          sessionId: crypto.randomUUID(),
          layerId: layerId,
          inventory: fieldKit,
          // Wave 10C: the harness rides too — anything equipped LATER, in the
          // field, is haul and gets taxed on the way home like the pack's
          kitItemIds: [...fieldKit.map(i => i.id), ...(state.player.equipment?.items.map(i => i.id) ?? [])],
          inventoryLayout: InventorySystem.placeAll(fieldKit),
          health: 100 + (state.player.attributes.constitution * 10),
          maxHealth: 100 + (state.player.attributes.constitution * 10),
          energy: 50 + (state.player.attributes.endurance * 5),
          position: { x: 1500, y: 0, z: 1500 },
          statusEffects: []
        }
      }
    }));
    get().recalcWeight(); // caps reflect the field kit immediately
  },

  emergencyJackOut: (penalty = 'NONE') => {
    const { player } = get();
    const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();

    // Wave 4.4: the WORLD CERT decides what death costs. INVENTORY_LOSS means
    // the haul — field kit included — stays in the world. That is the stakes.
    // Wave 10C (D21): the body falls with the pack, EXCEPT the slots a magic
    // protects. The death keeps exactly what the magic named; nothing more.
    const banksLoot = penalty === 'NONE';
    const sessionLoot = banksLoot
      ? (player.currentSession?.inventory.map(i => ({ ...i, isIdentified: true })) || [])
      : [];

    let lost: IItem[] = [];
    let kept: { item: IItem; by: string }[] = [];
    let nextEquipment = equipment;

    if (!banksLoot) {
      lost = [...(player.currentSession?.inventory || [])];
      // 10E (D21): a scroll's magic runs on a clock — a lapsed mark holds nothing
      const now = Date.now();
      const marks = (equipment.protected ?? []).filter(m => !m.until || m.until > now);
      const keptSlots = new Set(marks.map(m => m.slot));
      const slots: typeof equipment.slots = {};
      const items: IItem[] = [];
      for (const [slot, id] of Object.entries(equipment.slots)) {
        const item = equipment.items.find(i => i.id === id);
        if (!item) continue;
        if (keptSlots.has(slot as EquipSlotId)) {
          slots[slot as EquipSlotId] = id;
          items.push(item);
          kept.push({ item, by: marks.find(m => m.slot === slot)!.by });
        } else {
          lost.push(item);
        }
      }
      // A kept pouch whose belt fell has nowhere to hang: it banks instead
      const orphaned = items.filter(i => {
        const slot = Object.entries(slots).find(([, id]) => id === i.id)?.[0] ?? '';
        return slot.startsWith('POUCH_') && !slots['BELT'];
      });
      const bodyItems = items.filter(i => !orphaned.some(o => o.id === i.id));
      for (const o of orphaned) {
        const slot = Object.entries(slots).find(([, id]) => id === o.id)?.[0];
        if (slot) delete slots[slot as EquipSlotId];
      }
      // frames are mind, not loot: they survive. Protection is spent by the death.
      nextEquipment = { ...equipment, slots, items: bodyItems, protected: [] };

      console.warn(`[SESSION] Death penalty ${penalty}: ${lost.length} item(s) lost to the world, ${kept.length} kept by magic.`);
      set(state => ({
        view: 'BANK',
        player: {
          ...state.player,
          equipment: nextEquipment,
          bank: {
            ...state.player.bank,
            stashTabs: state.player.bank.stashTabs.map((tab, idx) =>
              idx === 0 ? { ...tab, items: [...tab.items, ...orphaned] } : tab)
          },
          currentSession: undefined
        }
      }));
      get().recalcWeight();
      return { lost, kept };
    }

    const updatedStashTabs = player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: [...tab.items, ...sessionLoot] } : tab
    );
    set((state) => ({
      view: 'BANK',
      player: {
        ...state.player,
        bank: { ...state.player.bank, stashTabs: updatedStashTabs },
        currentSession: undefined
      }
    }));
    get().recalcWeight();
    return { lost: [], kept: [] };
  },

  movePlayer: (direction) => { },

  identifyItem: (itemId) => {
      set((state) => {
          if (!state.player.currentSession) return state;
          const updatedInventory = state.player.currentSession.inventory.map(item => 
              item.id === itemId ? { ...item, isIdentified: true } : item
          );
          get().processAction({ tags: ['intel', 'analysis', 'ancient'], magnitude: 50 });
          return { player: { ...state.player, currentSession: { ...state.player.currentSession, inventory: updatedInventory } } };
      });
  },

  openLootContainer: (id, items) => set({ lootContainer: items, lootContainerId: id }),
  closeLootContainer: () => set({ lootContainer: null, lootContainerId: null }),

  transferItem: (itemId, from, to) => {
    set((state) => {
      let item: IItem | undefined;
      const newInventory = [...(state.player.currentSession?.inventory || [])];
      let newContainer = [...(state.lootContainer || [])];

      if (from === 'INVENTORY') {
        const idx = newInventory.findIndex(i => i.id === itemId);
        if (idx !== -1) {
          item = newInventory[idx];
          newInventory.splice(idx, 1);
        }
      } else {
        const idx = newContainer.findIndex(i => i.id === itemId);
        if (idx !== -1) {
          item = newContainer[idx];
          newContainer.splice(idx, 1);
        }
      }

      if (!item) return state;

      if (to === 'INVENTORY') {
        newInventory.push(item);
      } else {
        newContainer.push(item);
      }

      return {
        lootContainer: newContainer,
        player: {
          ...state.player,
          currentSession: state.player.currentSession ? {
            ...state.player.currentSession,
            inventory: newInventory
          } : state.player.currentSession
        }
      };
    });
    get().recalcWeight();
  },

  trashItem: (itemId, source) => {
    set((state) => {
      if (source === 'INVENTORY' && state.player.currentSession) {
        return {
          player: {
            ...state.player,
            currentSession: {
              ...state.player.currentSession,
              inventory: state.player.currentSession.inventory.filter(i => i.id !== itemId)
            }
          }
        };
      }
      // At home, what you hold is the vault. The button that says DISCARD discards.
      if (source === 'INVENTORY') {
        return {
          player: {
            ...state.player,
            bank: {
              ...state.player.bank,
              stashTabs: state.player.bank.stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab)
            }
          }
        };
      }
      return state;
    });
    get().recalcWeight();
  },

  recalcWeight: () => {
      const { player } = get();
      const sessionInv = player.currentSession?.inventory || [];
      // Wave 10C (10C.3): the limit is the haul, not the harness — equipped
      // gear never counts, and the worn BAG extends the capacity itself.
      set({
        currentWeight: InventorySystem.totalWeight(sessionInv),
        maxWeight: InventorySystem.maxCarryWeight(player.attributes.strength)
          + LoadoutSystem.bagCapacityBonus(player.equipment)
      });
  },

  // --------------------------------------------------------------------
  // WAVE 3: SPACE + WEIGHT GATED PICKUP, DROPS, ROTATION
  // --------------------------------------------------------------------

  /**
   * The only door into the session inventory. Checks BOTH caps per item:
   * weight (strength-derived) and grid space (8x6, footprints, rotation).
   * Rejected items are returned to the caller — they stay in the world.
   */
  tryAddItems: (items) => {
    const added: IItem[] = [];
    const rejected: IItem[] = [];
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { added: [], rejected: items };

    const maxW = InventorySystem.maxCarryWeight(state.player.attributes.strength);
    let inv = [...session.inventory];
    let layout = { ...(session.inventoryLayout || InventorySystem.placeAll(session.inventory)) };
    let weight = InventorySystem.totalWeight(inv);

    for (const item of items) {
      const wouldWeigh = weight + (item.weight || 0);
      if (wouldWeigh > maxW) {
        rejected.push(item);
        continue;
      }
      const place = InventorySystem.autoPlace(inv, layout, item);
      if (!place) {
        rejected.push(item);
        continue;
      }
      layout[item.id] = place;
      inv = [...inv, item];
      weight = wouldWeigh;
      added.push(item);
    }

    if (added.length > 0 || !session.inventoryLayout) {
      set(s => s.player.currentSession ? ({
        player: { ...s.player, currentSession: { ...s.player.currentSession, inventory: inv, inventoryLayout: layout } }
      }) : s);
      get().recalcWeight();
    }
    if (rejected.length > 0) {
      console.log(`[CARRY] ${rejected.length} item(s) refused: ${rejected.map(shown).join(', ')} (space or weight)`);
    }
    return { added, rejected };
  },

  /** Leave something behind: it becomes a ground cache, still owned by you. */
  dropItem: (itemId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return;
    const item = session.inventory.find(i => i.id === itemId);
    if (!item) return;

    const layout = { ...(session.inventoryLayout || {}) };
    delete layout[itemId];
    // Dropping something you're wielding unequips it first
    const equipped = { ...(session.equipped || {}) };
    (Object.keys(equipped) as (keyof IEquippedSlots)[]).forEach(k => {
      if (equipped[k] === itemId) delete equipped[k];
    });
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventory: s.player.currentSession.inventory.filter(i => i.id !== itemId),
        inventoryLayout: layout,
        equipped
      } }
    }) : s);
    get().recalcWeight();

    const pos = session.position;
    // The tie-break matters: two caches in one millisecond once shared an id, and taking one took both.
    const cacheId = `cache_${session.sessionId.slice(0, 8)}_${Date.now().toString(36)}_${++cacheSeq}`;
    useWorldStore.getState().addEntity({
      id: cacheId,
      type: EntityType.CONTAINER,
      definitionId: 'ground_cache',
      position: { x: pos.x + 15, y: pos.z },
      rank: item.rank,
      rarity: item.rarity,
      isHostile: false,
      container: { lootRank: item.rank, looted: false, hasLore: false, items: [item], cacheOwner: state.player.id }
    });
    SessionJournal.record('INTERACT', { kind: 'DROP_CACHE', cacheId, itemId: item.id, itemName: item.name });
    feed(`Left behind: ${shown(item)}. The cache is still yours, if you come back for it.`, 'plain');
  },

  /**
   * Wave 10D (10D.2): IMPROVISE — the deliberate floor of the item system. A
   * stone and a stick combine with no bench and no processing, anywhere,
   * including here in the field. The chain is the power budget, and this is
   * depth one of it. The roll is journaled; the mint carries its composition.
   */
  improviseInField: (recipeId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { ok: false, reason: 'Nothing is improvised at the bank.' };

    const rollKey = SessionJournal.rollKey('improvise', `${recipeId}:${session.inventory.length}`);
    const result = improvise(recipeId, session.inventory, rollKey);
    if (!result.ok || !result.item) {
      feed(result.reason ?? 'Refused.', 'loss');
      return { ok: false, reason: result.reason };
    }

    // the atoms leave the pack...
    const layout = { ...(session.inventoryLayout || {}) };
    for (const id of result.consumedIds) delete layout[id];
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventory: s.player.currentSession.inventory.filter(i => !result.consumedIds.includes(i.id)),
        inventoryLayout: layout
      } }
    }) : s);

    // ...and the crude thing enters through the caps like anything else
    const { added, rejected } = get().tryAddItems([result.item]);
    if (rejected.length > 0) {
      const pos = get().player.currentSession?.position;
      if (pos) {
        const cacheId = `cache_imp_${Date.now().toString(36)}`;
        useWorldStore.getState().addEntity({
          id: cacheId,
          type: EntityType.CONTAINER,
          definitionId: 'ground_cache',
          position: { x: pos.x + 15, y: pos.z + 15 },
          rank: result.item.rank,
          rarity: result.item.rarity,
          isHostile: false,
          container: { lootRank: result.item.rank, looted: false, hasLore: false, items: rejected, cacheOwner: get().player.id }
        });
        feed(`The pack refuses ${result.item.name}; a cache holds it at your feet.`, 'loss');
      }
    }
    get().recalcWeight();

    SessionJournal.record('INTERACT', {
      kind: 'IMPROVISE', recipeId, rollKey,
      consumedIds: result.consumedIds, itemId: result.item.id,
      compositionHash: result.item.composition ? CompositionSystem.compositionHash(result.item.composition) : undefined
    });
    void import('../../logic/sovereignty/Provenance').then(({ Provenance }) =>
      Provenance.record(result.item!, 'MINT', { origin: 'IMPROVISATION', rollKey }));
    get().processAction({ tags: ['craft', 'improvised', 'survival'], magnitude: 8 });
    feed(`Lashed together: ${result.item.name}. No bench, no apology.`, 'proof');
    return { ok: true };
  },

  // --------------------------------------------------------------------
  // WAVE 4: EQUIPMENT
  // --------------------------------------------------------------------

  /** Use a carried consumable. Negative restore values are harmful on purpose. */
  consumeItem: (itemId) => {
    const session = get().player.currentSession;
    const item = session?.inventory.find(i => i.id === itemId);
    if (!session || !item || item.type !== ItemType.CONSUMABLE) return;
    const unread = LoadoutSystem.unreadRefusal(item);
    if (!unread.ok) { feed(unread.reason!, 'loss'); return; }

    const restore = item.stats?.health_restore || 0;
    const health = Math.max(1, Math.min(session.maxHealth, session.health + restore));
    const layout = { ...(session.inventoryLayout || {}) };
    delete layout[itemId];
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        health,
        inventory: s.player.currentSession.inventory.filter(i => i.id !== itemId),
        inventoryLayout: layout
      } }
    }) : s);
    get().recalcWeight();
    SessionJournal.record('INTERACT', { kind: 'CONSUME', itemId, restore, health });
    feed(restore >= 0 ? `${item.name}: +${restore} health.` : `${item.name}: ${restore} health. It cured something else.`, restore >= 0 ? 'signal' : 'loss');
  },

  /** Mark a stash item to go along on the next session. */
  toggleCarry: (itemId) => {
    set(s => {
      const current = s.player.bank.carryItemIds || [];
      const carryItemIds = current.includes(itemId) ? current.filter(id => id !== itemId) : [...current, itemId];
      return { player: { ...s.player, bank: { ...s.player.bank, carryItemIds } } };
    });
  },

  /** LEGACY (Wave 4 buckets): equip finds the item's home on the slot tree. */
  equipItem: (itemId) => {
    get().equipToSlot(itemId);
  },

  /** LEGACY: the three buckets map onto the tree. */
  unequipSlot: (slot) => {
    const target: EquipSlotId = slot === 'mainHand' ? 'RIGHT_HAND' : slot === 'armor' ? 'CHEST' : 'TOOL_1';
    get().unequipFromSlot(target);
  },

  /** Durability loss on use/hit. Broken gear stays on the body but stops working. */
  wearEquipment: (slot, amount) => {
    get().wearSlot(slot === 'mainHand' ? 'RIGHT_HAND' : slot === 'armor' ? 'CHEST' : 'TOOL_1', amount);
  },

  wearSlot: (target, amount) => {
    const equipment = get().player.equipment;
    const itemId = equipment?.slots[target];
    if (!equipment || !itemId) return;
    set(s => {
      const eq = s.player.equipment;
      if (!eq) return s;
      const items = eq.items.map(i => {
        if (i.id !== itemId) return i;
        const dur = i.stats?.durability;
        if (dur === undefined) return i;
        const next = Math.max(0, dur - amount);
        if (next === 0 && dur > 0) feed(`${i.name} BROKE. It stays on the body; it stops working.`, 'loss');
        return { ...i, stats: { ...i.stats, durability: next } };
      });
      return { player: { ...s.player, equipment: { ...eq, items } } };
    });
  },

  /** Rotate an item in the grid, if the turned footprint fits. */
  rotateItem: (itemId) => {
    const session = get().player.currentSession;
    if (!session) return;
    const layout = session.inventoryLayout || {};
    const turned = InventorySystem.tryRotate(session.inventory, layout, itemId);
    if (!turned) {
      console.log('[CARRY] No room to rotate that here.');
      return;
    }
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventoryLayout: { ...(s.player.currentSession.inventoryLayout || {}), [itemId]: turned }
      } }
    }) : s);
  },

  performInteraction: (interactionId, targetId) => {
    console.log(`[ACTION] Performing ${interactionId} on ${targetId}`);
    const { player } = get();
    const session = player.currentSession;
    if (!session) return;

    // Resolve the live entity from the world
    const world = useWorldStore.getState();
    const entity = Object.values(world.currentMap?.chunks || {})
      .flatMap(c => c.entities)
      .find(e => e.id === targetId);

    const spendEnergy = (cost: number): boolean => {
      const s = get().player.currentSession;
      if (!s || s.energy < cost) {
        feed(`Refused: needs ${cost} energy, you hold ${Math.floor(s?.energy ?? 0)}.`, 'loss');
        return false;
      }
      set(state => state.player.currentSession ? ({
        player: { ...state.player, currentSession: { ...state.player.currentSession, energy: state.player.currentSession.energy - cost } }
      }) : state);
      return true;
    };

    // Wave 3: everything enters through the caps; overflow lands at your feet
    const addToInventory = (items: IItem[]): IItem[] => {
      const { added, rejected } = get().tryAddItems(items);
      if (rejected.length > 0) {
        const pos = get().player.currentSession?.position;
        if (pos) {
          const cacheId = `cache_ovf_${Date.now().toString(36)}_${++cacheSeq}`;
          useWorldStore.getState().addEntity({
            id: cacheId,
            type: EntityType.CONTAINER,
            definitionId: 'ground_cache',
            position: { x: pos.x + 15, y: pos.z + 15 },
            rank: rejected[0].rank,
            rarity: rejected[0].rarity,
            isHostile: false,
            container: { lootRank: rejected[0].rank, looted: false, hasLore: false, items: rejected, cacheOwner: get().player.id }
          });
          SessionJournal.record('INTERACT', { kind: 'OVERFLOW_CACHE', cacheId, itemIds: rejected.map(i => i.id) });
          feed(`The pack refuses ${rejected.length} item${rejected.length === 1 ? '' : 's'}; a cache holds them at your feet.`, 'loss');
        }
      }
      return added;
    };

    // ------------------------------------------------------------------
    // STUDY (legacy path, kept)
    // ------------------------------------------------------------------
    if (interactionId === 'int_study') {
       set(state => {
         const targetDefId = entity?.definitionId || 'res_rock_small';
         const updatedPlayer = MaterialScience.studyMaterial(targetDefId, state.player);
         return { player: updatedPlayer };
       });
       get().gainSkillXp('skill_analysis', 100, ['intel', 'analysis'], { tags: ['study'], magnitude: 10 });
       return;
    }

    if (!entity) return;

    // ------------------------------------------------------------------
    // THE CART (Wave 10C, D16): tow, release, open
    // ------------------------------------------------------------------
    if (interactionId.startsWith('int_carttow_')) {
      void get().towCart(entity.id);
      return;
    }
    if (interactionId.startsWith('int_cartrelease_')) {
      get().releaseCart();
      return;
    }
    if (interactionId.startsWith('int_cartopen_')) {
      get().openCartWindow(entity.id);
      return;
    }

    // ------------------------------------------------------------------
    // HARVEST (Wave 2.2): keyed yield, node depletion, flora regrow
    // ------------------------------------------------------------------
    if (interactionId.startsWith('int_harvest_')) {
      const def = RESOURCE_DEFINITIONS[entity.definitionId];
      if (!def?.harvestConfig) return;
      if ((entity.usesRemaining ?? 1) <= 0) return;
      // D27: a tool on a material mints from that pair. Winging it costs more.
      const pair = WebSystem.pairOfHarvest(get().player, def);
      const effort = WebSystem.energyFor(get().player, pair, def.harvestConfig.energyCost);
      if (!spendEnergy(effort.cost)) return;

      const usesLeft = (entity.usesRemaining ?? 1) - 1;
      const rollKey = SessionJournal.rollKey('harvest', `${entity.id}:${usesLeft}`);
      const rng = Rng.fromKey(rollKey);
      const [minY, maxY] = def.yieldPerUse ?? [1, 1];
      const quantity = rng.int(minY, maxY + 1);
      // Wave 10E (the Dreaming): in a pinned world a harvest may carry a banked
      // affix — the material remembers what the Seed dreamed into it.
      const dream = DreamingSystem.active();
      const biome = biomeAt(entity.position);
      const items = Array.from({ length: quantity }, () => {
        const dreamAffix = dream && biome ? DreamingSystem.materialAffixFor(dream.pack, biome, def.id, rng) : null;
        return ItemFactory.createResourceItem(def, rng, dreamAffix ? { dreamAffix } : undefined);
      });
      const dreamt = items.filter(i => i.affixes.length > 0);
      if (dreamt.length > 0) feed(`${dreamt[0].name}: the Seed dreamed something into this one.`, 'signal');

      addToInventory(items);
      SessionJournal.record('HARVEST', { nodeId: entity.id, defId: def.id, rollKey, itemIds: items.map(i => i.id) });

      if (usesLeft <= 0) {
        if (def.regrowMs) {
          // Flora: depleted, regrows on the world clock
          world.updateEntity(entity.id, { usesRemaining: 0, regrowAt: Date.now() + def.regrowMs });
        } else {
          // Mineral: the vein is dry forever
          world.removeEntity(entity.id);
          console.log(`[HARVEST] ${def.name} depleted. The vein runs dry.`);
        }
      } else {
        world.updateEntity(entity.id, { usesRemaining: usesLeft });
      }

      if (pair) get().workOn(pair, rankIndexOf(def.rank), Math.ceil(10 * quantity * 0.5));
      feed(`Harvested ${quantity}× ${def.name}.`, 'proof');
      if (usesLeft <= 0 && !def.regrowMs) feed(`${def.name} depleted. The vein runs dry.`, 'plain');
      return;
    }

    // ------------------------------------------------------------------
    // OPEN (Wave 2.3): ruin chests — keyed loot + a lore fragment
    // ------------------------------------------------------------------
    if (interactionId.startsWith('int_open_')) {
      if (!entity.container || entity.container.looted) return;

      // Wave 3.3: GROUND CACHE — explicit contents, no generation. The source is
      // already a container, so what the pack refuses simply stays in it (line 57);
      // the overflow rule is for harvests and chests. A press that moves nothing costs nothing.
      if (entity.container.items && entity.container.items.length > 0) {
        const held = get().player.currentSession?.energy ?? 0;
        if (held < 2) { spendEnergy(2); return; }
        const { added: taken, rejected } = get().tryAddItems(entity.container.items);
        if (taken.length > 0) {
          spendEnergy(2);
          const left = entity.container.items.filter(i => !taken.some(t => t.id === i.id));
          if (left.length === 0) world.removeEntity(entity.id);
          else world.updateEntity(entity.id, { container: { ...entity.container, items: left } });
          SessionJournal.record('INTERACT', { kind: 'CACHE_PICKUP', targetId: entity.id, itemIds: taken.map(i => i.id) });
          feed(`Recovered ${taken.length === 1 ? shown(taken[0]) : `${taken.length} items`}.`, 'proof');
        }
        if (rejected.length > 0) feed(`The pack refuses ${rejected.length}; ${rejected.length === 1 ? 'it stays' : 'they stay'} in the cache.`, 'loss');
        return;
      }

      if (!spendEnergy(2)) return;

      const rollKey = SessionJournal.rollKey('chest', entity.id);
      const rng = Rng.fromKey(rollKey);
      // Wave 10E: a chest in a dreamed world fills from its biome's bank
      const loot = LootTable.generateChestLoot(entity.container.lootRank, 1.0, rollKey, biomeAt(entity.position));

      if (entity.container.hasLore) {
        const fragment = rng.pick(LORE_FRAGMENTS);
        const piece = {
          ...ItemFactory.createResourceItem({ id: 'lore_fragment', name: 'Lore Fragment', icon: '📜', weight: 0.1, dimensions: { width: 1, height: 1 } } as any, rng),
          type: ItemType.LORE,
          description: fragment,
          value: 50,
          tags: ['lore', 'document']
        };
        // D26: in a world pinned to the additions, some fragments are a trade's own
        // notes. The choice is its own stream, so nothing above it moves.
        const trade = ProcessSystem.chestNote(DreamingSystem.active()?.pack.version, rollKey);
        loot.push(trade
          ? { ...piece, name: ProcessSystem.noteOf(trade).name, description: ProcessSystem.noteOf(trade).text, loreData: { processFamily: trade, tier: 1 } }
          : piece);
      }

      addToInventory(loot);
      world.updateEntity(entity.id, { container: { ...entity.container, looted: true } });
      SessionJournal.record('INTERACT', { kind: 'OPEN', targetId: entity.id, rollKey, itemIds: loot.map(i => i.id) });
      get().processAction({ tags: ['scavenging', 'intel'], magnitude: 20 });
      feed(`Chest opened: ${loot.length} item${loot.length === 1 ? '' : 's'}${entity.container.hasLore ? ', one of them a fragment' : ''}.`, 'proof');
      return;
    }

    // ------------------------------------------------------------------
    // NPC SOCIAL LOOP (Wave 2.4): TALK, GIFT, RECRUIT
    // ------------------------------------------------------------------
    if (interactionId.startsWith('int_talk_')) {
      if (!entity.npc) return;
      if (!spendEnergy(5)) return;

      const attempt = entity.npc.attempts + 1;
      const rollKey = SessionJournal.rollKey('social', `${entity.id}:${attempt}`);
      const roll = Rng.fromKey(rollKey).next();
      const charisma = get().player.attributes.charisma || 1;
      // Attribute check: charisma shifts the odds; RESPECT-wanters are easier to talk up
      const threshold = entity.npc.want === 'RESPECT' ? 0.35 : 0.5;
      const success = roll < threshold + charisma * 0.05;
      const delta = success ? 15 : 5;
      const disposition = Math.min(100, entity.npc.disposition + delta);

      useWorldStore.getState().updateEntity(entity.id, { npc: { ...entity.npc, disposition, attempts: attempt } });
      SessionJournal.record('INTERACT', { kind: 'TALK', targetId: entity.id, rollKey, success, disposition });
      get().processAction({ tags: ['social', 'charisma'], magnitude: success ? 15 : 5 });
      feed(`${entity.npc.name} ${success ? 'warms to you' : 'is unconvinced'} (${disposition}/100).`, success ? 'signal' : 'plain');
      return;
    }

    if (interactionId.startsWith('int_gift_')) {
      if (!entity.npc) return;
      const inv = get().player.currentSession?.inventory || [];
      if (inv.length === 0) return;
      if (!spendEnergy(2)) return;

      // Give the least valuable carried item; GIFT-wanters respond strongest
      const gift = [...inv].sort((a, b) => a.value - b.value)[0];
      const delta = entity.npc.want === 'GIFT' ? 25 : 10;
      const disposition = Math.min(100, entity.npc.disposition + delta);

      set(state => state.player.currentSession ? ({
        player: { ...state.player, currentSession: { ...state.player.currentSession, inventory: state.player.currentSession.inventory.filter(i => i.id !== gift.id) } }
      }) : state);
      get().recalcWeight();

      useWorldStore.getState().updateEntity(entity.id, { npc: { ...entity.npc, disposition } });
      SessionJournal.record('INTERACT', { kind: 'GIFT', targetId: entity.id, itemId: gift.id, disposition });
      get().processAction({ tags: ['social', 'trade'], magnitude: 10 });
      feed(`Gave ${gift.name} to ${entity.npc.name} (${disposition}/100).`, 'plain');
      return;
    }

    if (interactionId.startsWith('int_recruit_')) {
      if (!entity.npc || entity.npc.disposition < 70) return;
      if (!spendEnergy(5)) return;

      // The NPC becomes an extractable asset: a signed-for escort contract item.
      // Extracting it banks the social work exactly like any other haul.
      const rng = Rng.fromKey(SessionJournal.rollKey('recruit', entity.id));
      const contract: IItem = {
        ...ItemFactory.createResourceItem({ id: 'npc_contract', name: `Escort Bond: ${entity.npc.name}`, icon: '🤝', weight: 0, dimensions: { width: 1, height: 1 } } as any, rng),
        type: ItemType.LORE,
        description: `${entity.npc.name} (${entity.npc.temperament.toLowerCase()}) walks beside you to the beacon. Worth more than gold, redeemable for some anyway.`,
        rank: entity.rank,
        value: 200,
        rarity: Rarity.RARE,
        tags: ['npc_contract', 'social'],
        // D27, Wave 11's seam: the bond names the person, so their sheet reads back the same
        bondData: {
          worldSeed: useWorldStore.getState().currentMap?.seed ?? '',
          entityId: entity.id,
          webVersion: useWorldStore.getState().availableWorlds?.find(w => w.id === useWorldStore.getState().activeWorldId)?.webVersion,
          rank: entity.rank,
          rarity: entity.rarity,
          sheet: { ...entity.npc }
        }
      };

      addToInventory([contract]);
      useWorldStore.getState().removeEntity(entity.id);
      SessionJournal.record('INTERACT', { kind: 'RECRUIT', targetId: entity.id, npcName: entity.npc.name, contractId: contract.id });
      get().processAction({ tags: ['social', 'rescue', 'charisma'], magnitude: 50 });
      feed(`${entity.npc.name} walks beside you now. Reach the beacon together.`, 'signal');
      return;
    }
  },

  gainSkillXp: (skillId, amount, tags, actionContext) => {
    // D28, clause 4: no throwaway identity. A door handed an id the law did not compute refuses it.
    if (!get().player.bank.universalSkills[skillId] && !WebSystem.isLawfulId(skillId)) {
      console.warn(`[SKILL] ${skillId} is not an identity the tag law can read. Refused.`);
      return;
    }
    const rungBefore = (() => {
      const held = get().player.bank.universalSkills[skillId];
      return held ? WebSystem.masteryOf(held).rung : -1;
    })();
    set((state) => {
      const { player } = state;
      const skills = { ...player.bank.universalSkills };
      
      if (!skills[skillId]) {
        skills[skillId] = {
          id: skillId,
          level: 1,
          currentXp: 0,
          tags: TagLaw.parseSkillId(skillId) ?? tags,
          scalingAttribute: 'intelligence', 
          origin: {
            timestamp: Date.now(),
            triggerAction: actionContext ? actionContext.tags.join(' + ') : 'unknown',
            location: 'Unknown',
            resonance: actionContext ? actionContext.magnitude : 0
          }
        };
      }

      const skill = { ...skills[skillId] };
      skill.currentXp += amount;
      
      while (skill.currentXp >= ProgressionSystem.getXpToNextLevel(skill.level)) {
        skill.currentXp -= ProgressionSystem.getXpToNextLevel(skill.level);
        skill.level++;
      }

      skills[skillId] = skill;
      return { player: { ...player, bank: { ...player.bank, universalSkills: skills } } };
    });
    // D27: crossing a rung reveals more of the material, through the one ledger
    const held = get().player.bank.universalSkills[skillId];
    const { rung } = WebSystem.masteryOf(held);
    if (rung > rungBefore && rungBefore >= 0) {
      set(s => ({ player: WebSystem.revealByMastery(s.player, skillId) }));
      feed(`${WebSystem.nameOf(skillId)}: ${MASTERY_RUNGS[rung]}. The material reads further.`, 'proof');
    }
  },

  workOn: (pair, rank, xp) => {
    if (get().player.bank.universalSkills[pair.id]) {
      get().gainSkillXp(pair.id, xp, pair.tags);
      set(s => {
        const skill = s.player.bank.universalSkills[pair.id];
        if ((skill.rank ?? 0) >= rank) return s;
        return { player: { ...s.player, bank: { ...s.player.bank, universalSkills: { ...s.player.bank.universalSkills, [pair.id]: { ...skill, rank } } } } };
      });
      return;
    }
    if (!get().player.skillProgress?.[pair.id]) {
      feed(`Winging it: ${WebSystem.nameOf(pair.id)}. It costs more without the skill, and it counts toward it.`, 'signal');
    }
    set(s => ({ player: WebSystem.accrue(s.player, pair, rank) }));
  },

  processAction: (context) => {
    const { currentWeight, maxWeight } = get();
    if (context.tags.includes('pickup') && (context as any).item) {
        const item = (context as any).item as IItem;
        const itemWeight = item.weight || 1.0;
        if (currentWeight + itemWeight > maxWeight) return; 
        setTimeout(() => get().recalcWeight(), 50); 
    }
    // D27: the fixed table is gone. What identifies is the registry's word, and a
    // blow's tool is whatever is in the hand, not what the combat log assumed.
    const weapon = get().player.equipment ? LoadoutSystem.itemIn(get().player.equipment!, 'RIGHT_HAND') : undefined;
    const pair = SkillDiscovery.identify(WebSystem.withHeldTool(context, weapon?.tags ?? []));
    if (!pair) return;
    get().workOn(pair, rankIndexOf(context.targetRank), Math.ceil(context.magnitude * 0.5));
  }
}));
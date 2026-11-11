import { create } from 'zustand';
import {
  IPlayer, IItem, UniversalRank, IAttributes, ICognitiveFrame, IEquippedSlots, SlotType,
  EquipSlotId, HeadPositionId, HEAD_BUDGET_POSITIONS, IEquipmentState, ItemType as IT
} from '../../../shared/types';
import { ItemFactory } from '../../../shared/entities/item/ItemFactory';
import { ProgressionSystem, THREAT_RADIUS_TILES, XP_SHARE_CHEST, XP_SHARE_HARVEST } from '../../../shared/entities/player/systems/ProgressionSystem';
import { SkillDiscovery, IActionContext } from './systems/SkillDiscovery';
import { DEFAULT_ATTRIBUTES, IBaseAttributes } from './types';
import { IPlayerCertificate } from '../identity/certificateSystem';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import type { IWorldPort } from '../world/worldView';
import type { IHubPort } from '../hub/hubView';
import { offerPort, portOf } from '../storePorts';
import { ChestSystem } from '../../../shared/entities/world/ChestSystem';
import { LiveClient } from '../../logic/live/LiveClient';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { LootTable } from '../world/LootTable';
import { LORE_FRAGMENTS } from '../lore/LoreBible';
import { SessionJournal } from '../../logic/journal/SessionJournal';
import { ItemType, Rarity } from '../../../shared/types';
import { InventorySystem, GRID_H, GRID_W } from '../../../shared/entities/player/systems/InventorySystem';
import { GROUND_REACH } from '../../logic/systems/ItemHands';
import { STASH_COLS, StashGrid, StashSortKey } from './systems/StashGrid';
import { LoadoutSystem, Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { Anchors } from '../../logic/economy/Anchors';
import { RestSystem } from '../../logic/systems/RestSystem';
import { FieldWords } from '../../logic/systems/FieldWords';
import { ContactNames } from '../../logic/systems/ContactNames';
import { isLooseStone, isThrowable } from '../../../shared/entities/item/Throwable';
import { CircleSystem } from '../../logic/systems/CircleSystem';
import { WeaveSystem } from '../../logic/systems/WeaveSystem';
import { CartSystem } from '../world/CartSystem';
import { CartOverlay, IPlacedCart } from '../world/CartOverlay';
import { EntityType, ICartState, IWorldEntity } from '../../../shared/entities/world/types';
import { MaterialScience } from '../world/MaterialScience';
import { COGNITIVE_FRAMES } from '../../../shared/entities/player/data/cognitiveFrames'; // Import definitions
import { Capture } from '../../../shared/logic/systems/Capture';
import { FieldCapture } from '../../logic/systems/FieldCapture';
import { FieldEscort } from '../../logic/systems/FieldEscort';
import { Escort } from '../../logic/systems/Escort';
import { useFeed, useWaits } from '../../components/ui/stores'; // Wave 9.6: the machine says what happened
import { improvise } from '../../logic/systems/ImprovisedCrafting'; // Wave 10D: the floor
import { CompositionSystem } from '../../../shared/logic/economy/CompositionSystem';
import { StudySystem } from '../../logic/systems/StudySystem'; // Wave 10E: the knowledge law (D19)
import { LORE_NOTE_PAY } from '../../../shared/logic/systems/LoreConstants';
import { LoreDrops } from '../../../shared/logic/systems/LoreDrops';
import { InsuranceSystem } from '../../logic/systems/InsuranceSystem'; // Wave 10E: insurance is an item (D21)
import { DreamingSystem } from '../../../shared/entities/world/Dreaming'; // Wave 10E: the Dreaming (10E.3)
import { PROCESS_SKILL_XP_PER_JOB, ProcessFamily, ProcessSystem } from '../../../shared/logic/systems/ProcessSystem'; // The raw materials leg (D26)
import { IRoomState, ownerHasStationFor, roomAdditions } from '../../../shared/entities/hub/room';
import { PAIR_ENERGY, PairCraft } from '../../../shared/logic/systems/PairCraft';
import { chunkOf } from '../../../shared/entities/world/grid';
import { ISkillPair, MASTERY_RUNGS, WebSystem, rankIndexOf } from '../../../shared/logic/systems/WebSystem'; // D27: the web and the auto skill
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { CreationSystem, ICreationSheet } from '../../logic/systems/CreationSystem';
import { WorldDeed } from '../../logic/systems/WorldDeed';
import type { IPlayerPort, PlayerChange } from './playerView';

/** Chests whose live claim won, opening now (LiveClient.chests). */
const claimedChests = new Set<string>();

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

/** The biome under a world position, when its chunk is built (10E: the Dreaming reads it). */
const biomeAt = (pos: { x: number; y: number }) => {
  const map = wp.view().currentMap;
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
  /** The one door a system's changes come through, applied in order (playerView.ts). */
  apply: (...changes: PlayerChange[]) => void;
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
  /** A sheet is what the creation flow settled. With none, an older birth, as it always was. */
  initializeSession: (certificate: IPlayerCertificate, archetypeId: string, sheet?: ICreationSheet) => void;
  // Wave 9.3: idempotent login — initializes ONLY when the store does not
  // already hold this identity's character, so a returning player is never
  // reset (handleLogin used to rebuild everyone as an Operator).
  ensureCharacter: (certificate: IPlayerCertificate, archetypeId: string, sheet?: ICreationSheet) => void;
  // D83: a fight feeds the level; the guild grants the rank
  applyKillXp: (amount: number) => { leveledUp: boolean; from: number; to: number; pointsGranted: number };
  grantRank: (to?: UniversalRank) => { granted: boolean; from: UniversalRank; to: UniversalRank };
  /** A level poured into a skill. The third one earns something at the next rest. */
  fillCircle: (skillId: string) => boolean;
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
  /** `along`: the whole of a stack in hand moves with it (the interface pass). */
  placeInPack: (itemId: string, x: number, y: number, rotated: boolean, along?: string[]) => Verdict;
  /** The usability pass (U13): where things sit in the vault. Nothing here moves an item out of it. */
  placeInStash: (itemId: string, x: number, y: number, rotated: boolean, along?: string[]) => Verdict;
  arrangeStash: (key: StashSortKey) => void;
  /** The interface pass: pack the pack tight, or in one of the vault's own orders. Nothing is ever left without a place. */
  arrangePack: (key: 'TIGHT' | StashSortKey) => Verdict;
  /** The usability pass (line 74): one thing out of a ground cache, through the pack's caps. */
  takeFromCache: (entityId: string, itemId: string) => Verdict;
  placeOnCart: (entityId: string, itemId: string, x: number, y: number, rotated: boolean, along?: string[]) => Verdict;
  /** Ledger H1b: a piece on a cart's bed turns by a door of its own, with its stack. */
  rotateOnCart: (entityId: string, itemId: string) => Verdict;
  /** What is in this slot wears, whichever hand fired it. */
  wearSlot: (slot: EquipSlotId, amount: number) => void;
  /** C14: one throw of what this hand holds. */
  spendThrown: (slot: EquipSlotId) => void;
  /** This character has been told a person's name (`ContactNames`). It is theirs to keep. */
  learnName: (person: Pick<IWorldEntity, 'id' | 'npc'>) => void;
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
  /** said: a stack dropped whole says one line, on its last piece, naming how many (the interface pass). */
  dropItem: (itemId: string, said?: { quiet?: boolean; count?: number }) => void;
  // Wave 10D (10D.2): the floor — stone-and-stick, no bench, anywhere
  improviseInField: (recipeId: string) => { ok: boolean; reason?: string };
  /** One material set on another: both are used, an unread thing comes of it, and a rest reads it (PairCraft). */
  combine: (itemId: string, ontoId: string, cartId?: string) => Verdict;
  rotateItem: (itemId: string) => void;

  toggleCarry: (itemId: string) => void;
  consumeItem: (itemId: string) => void;
  /** Layer 3: what a scroll just asked the field to cast. */
  pendingCast?: string | null;

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
  /** `costly`: the road charged more for a first try, so the feed may say so (N13). */
  workOn: (pair: ISkillPair, rank: number, xp: number, costly?: boolean) => void;
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
    lore: {},
    loreHeld: 0
  },
  currentSession: undefined,
  materialMastery: {},
  floatMemory: [null, null, null]
};

/** A kit piece the body refuses stays in the vault. That is no fault of anyone's, so nothing is said. */
const quietEquip = (get: () => PlayerState, itemId: string) => {
  const player = get().player;
  const item = player.bank.stashTabs[0]?.items.find(i => i.id === itemId);
  const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
  const slot = item && LoadoutSystem.slotForItem(item, equipment);
  if (item && slot && LoadoutSystem.canEquip({ ...player, equipment }, item, slot).ok) get().equipToSlot(itemId, slot);
};

let cacheSeq = 0;
/**
 * The world, through the port the world store offers (storePorts.ts). The player store reads the world
 * and hands it changes like any system; it never imports the world store.
 */
const wp = portOf<IWorldPort>('world', 'player store');
/** The hub, the same way: what a field act asks of it (a register, a save). */
const hp = portOf<IHubPort>('hub', 'player store');

const shown = LoadoutSystem.shownName.bind(LoadoutSystem);

export const usePlayerStore = create<PlayerState>((set, get) => ({
  apply: (...changes) => {
    const firstTab = (p: IPlayer, items: (now: IItem[]) => IItem[]): IPlayer => ({
      ...p, bank: { ...p.bank, stashTabs: p.bank.stashTabs.map((tab, i) => (i === 0 ? { ...tab, items: items(tab.items) } : tab)) }
    });
    // A field change with no field session changes nothing
    const inSession = (p: IPlayer, step: (cur: NonNullable<IPlayer['currentSession']>) => NonNullable<IPlayer['currentSession']>): IPlayer =>
      p.currentSession ? { ...p, currentSession: step(p.currentSession) } : p;
    for (const change of changes) {
      const store = get();
      switch (change.kind) {
        case 'SET': set({ player: change.player }); break;
        case 'GOLD': set(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + change.delta } } })); break;
        case 'STASH_ADD': set(s => ({ player: firstTab(s.player, now => [...now, ...change.items]) })); break;
        case 'STASH_REMOVE': set(s => ({ player: firstTab(s.player, now => now.filter(i => !change.ids.includes(i.id))) })); break;
        case 'PACK_ADD': set(s => ({ player: inSession(s.player, cur => ({ ...cur, inventory: [...cur.inventory, ...change.items] })) })); break;
        case 'PACK_REMOVE': set(s => ({ player: inSession(s.player, cur => {
          const layout = { ...(cur.inventoryLayout ?? {}) };
          delete layout[change.itemId];
          return { ...cur, inventory: cur.inventory.filter(i => i.id !== change.itemId), inventoryLayout: layout };
        }) })); break;
        case 'PACK_REPLACE': set(s => ({ player: inSession(s.player, cur => ({ ...cur, inventory: cur.inventory.map(i => (i.id === change.item.id ? change.item : i)) })) })); break;
        case 'REPAIR': set(s => {
          const mended = <T extends IItem>(i: T): T => (i.id === change.itemId ? { ...i, stats: { ...i.stats, durability: i.stats.maxDurability } } : i);
          const p = s.player;
          return { player: firstTab({ ...p, equipment: p.equipment ? { ...p.equipment, items: p.equipment.items.map(mended) } : p.equipment }, now => now.map(mended)) };
        }); break;
        case 'TAMED_ADD': set(s => ({ player: inSession(s.player, cur => ({ ...cur, tamed: [...(cur.tamed ?? []), change.tamed] })) })); break;
        case 'TAMED_EXPIRE': set(s => ({ player: inSession(s.player, cur => ({ ...cur, tamed: (cur.tamed ?? []).filter(t => t.until > change.now) })) })); break;
        case 'TAMED_CLEAR': set(s => ({ player: inSession(s.player, cur => ({ ...cur, tamed: [] })) })); break;
        case 'ESCORTS': set(s => ({ player: inSession(s.player, cur => ({ ...cur, escorts: change.escorts })) })); break;
        case 'QUEUE_STUDY': set(s => ({ player: change.ids.reduce((p, id) => RestSystem.queueStudy(p, id), s.player) })); break;
        case 'WAKE': set(s => ({ player: RestSystem.wake(s.player) })); break;
        case 'PENDING_DREAM': set(s => ({ player: { ...s.player, pendingDream: change.dream } })); break;
        case 'ACCRUE': set(s => ({ player: WebSystem.accrue(s.player, change.node, change.rank) })); break;
        case 'RECALC_WEIGHT': store.recalcWeight(); break;
        case 'WORK_ON': store.workOn(change.pair, change.rank, change.xp, change.costly); break;
        case 'PRACTICE_TRADE': store.practiceTrade(change.family); break;
        case 'LORE': set(s => ({ player: { ...s.player, bank: { ...s.player.bank, lore: change.lore } } })); break;
        case 'GAIN_SKILL_XP': store.gainSkillXp(change.skillId, change.amount, change.tags, change.context); break;
        case 'DIVE': store.diveIntoLayer(change.layerId); break;
        case 'DROP_ITEM': store.dropItem(change.itemId, { quiet: change.quiet, count: change.count }); break;
        case 'TOGGLE_CARRY': store.toggleCarry(change.itemId); break;
      }
    }
  },
  player: INITIAL_PLAYER_TEMPLATE,
  view: 'BANK',
  lootContainer: null,
  lootContainerId: null,
  cartWindowId: null,
  openCartWindow: (entityId) => set({ cartWindowId: entityId }),
  closeCartWindow: () => set({ cartWindowId: null }),
  currentWeight: 0,
  maxWeight: 50,

  initializeSession: (certificate, archetypeId, sheet) => {
    const uid = certificate.metadata.uid;
    const baseAttrs = sheet ? CreationSystem.spreadOn(uid, sheet.record.main, sheet.record.sub) as IBaseAttributes : { ...DEFAULT_ATTRIBUTES };
    const bonuses = sheet ? {} : ARCHETYPES[archetypeId] || {};
    const kit = sheet ? CreationSystem.mintKit(uid, sheet.record.kit) : [ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey(`${uid}:genesis:starter`))];
    
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
          // Keyed genesis roll: the same identity always starts with the same things. D72: and one free deed.
          stashTabs: [{ name: 'CACHE_01', items: [...kit, WorldDeed.free(uid)] }],
          universalSkills: sheet ? CreationSystem.heldSkills(sheet.words) : {},
          lore: {},
          loreHeld: 0
        },
        freeDeedGiven: true,
        ...(sheet ? { creation: sheet.record, skillWords: CreationSystem.skillWords(sheet.words) } : {}),
        rankXp: 0,
        attributePoints: 0,
        rank: UniversalRank.F,
        levelXp: 0,
        levelsBanked: 0,
        materialMastery: {},
        floatMemory: [null, null, null]
      }
    });
    // What you carry is carried: what stays in the vault does not ride into a drop
    if (sheet) {
      for (const item of kit) quietEquip(get, item.id);
      get().recalcAttributes();
    }
  },

  ensureCharacter: (certificate, archetypeId, sheet) => {
    if (get().player.id === certificate.metadata.uid) return;
    get().initializeSession(certificate, archetypeId, sheet);
  },

  // --- LEVELS AND RANK (D83): a fight counts, and a level gives something real ---

  applyKillXp: (amount) => {
    const { player, from, to, points } = ProgressionSystem.gainXp(get().player, amount);
    set({ player });
    return { leveledUp: to > from, from, to, pointsGranted: points };
  },

  grantRank: (to) => {
    const { player, granted, from, to: landed } = ProgressionSystem.grantRank(get().player, to);
    set({ player });
    return { granted, from, to: landed };
  },

  fillCircle: (skillId) => {
    const res = CircleSystem.fill(get().player, skillId);
    if (!res.ok) { feed(res.reason!, 'loss'); return false; }
    set({ player: res.player });
    if (res.owed) feed(CircleSystem.standsLine(WebSystem.nameOf(skillId), CircleSystem.circlesOf(res.player.bank.universalSkills[skillId])), 'proof');
    return true;
  },

  spendAttributePoint: (attribute) => {
    // 2.13: the attribute's group point first, then the free one; a group point never leaves its group
    const spent = ProgressionSystem.spendPoint(get().player, attribute as keyof IAttributes);
    if (!spent) return false;
    set({ player: spent.player });
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
        player: CircleSystem.withPassives({ ...state.player, attributes: newAttributes, floatMemory: mirror })
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
      const limit = InventorySystem.maxCarryWeight(player.attributes.strength) + newBag + StatSystem.total(equipment, 'carry_capacity');
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

  placeInPack: (itemId, x, y, rotated, along) => {
    const session = get().player.currentSession;
    const item = session?.inventory.find(i => i.id === itemId);
    if (!session || !item) return { ok: false, reason: 'No such item in the pack.' };
    const layout = session.inventoryLayout || {};
    // Like things stack (the interface pass): the pieces in hand move together, and may lie on their like
    const moving = (along?.includes(itemId) ? along : [itemId, ...(along ?? [])]).filter(id => session.inventory.some(i => i.id === id));
    if (!InventorySystem.fitsAt(session.inventory, layout, item, x, y, rotated, GRID_W, GRID_H, moving)) {
      return { ok: false, reason: `The pack has no room there. ${shown(item)} stays where it was.` };
    }
    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        inventoryLayout: { ...(s.player.currentSession.inventoryLayout || {}), ...Object.fromEntries(moving.map(id => [id, { x, y, rotated }])) }
      } }
    }) : s);
    return { ok: true };
  },

  arrangePack: (key) => {
    const session = get().player.currentSession;
    if (!session) return { ok: false, reason: 'The pack is in the field.' };
    const order = key === 'TIGHT'
      ? [...session.inventory].sort((a, b) => {
        const fa = InventorySystem.footprint(a, false), fb = InventorySystem.footprint(b, false);
        return (fb.w * fb.h) - (fa.w * fa.h);
      })
      : StashGrid.sorted(session.inventory, key);
    // A sort that cannot hold everything falls back to packing tight; if even that cannot, nothing moves
    const layout = InventorySystem.packInOrder(order) ?? (key === 'TIGHT' ? null : InventorySystem.packInOrder(
      [...session.inventory].sort((a, b) => InventorySystem.footprint(b, false).w * InventorySystem.footprint(b, false).h - InventorySystem.footprint(a, false).w * InventorySystem.footprint(a, false).h)));
    if (!layout) {
      const v = { ok: false, reason: 'The pack cannot be laid out that way without leaving something out. Nothing moved.' };
      feed(v.reason, 'loss');
      return v;
    }
    set(s => s.player.currentSession ? ({ player: { ...s.player, currentSession: { ...s.player.currentSession, inventoryLayout: layout } } }) : s);
    return { ok: true };
  },

  placeInStash: (itemId, x, y, rotated, along) => {
    const tab = get().player.bank.stashTabs[0];
    const item = tab?.items.find(i => i.id === itemId);
    if (!tab || !item) return { ok: false, reason: 'No such item in the vault.' };
    const layout = StashGrid.resolve(tab.items, tab.layout);
    const { w, h } = InventorySystem.footprint(item, rotated);
    const moving = (along?.includes(itemId) ? along : [itemId, ...(along ?? [])]).filter(id => tab.items.some(i => i.id === id));
    if (!StashGrid.canPlace(tab.items, layout, itemId, w, h, x, y, STASH_COLS, moving)) {
      return { ok: false, reason: `The vault has something there. ${shown(item)} stays where it was.` };
    }
    for (const id of moving) layout[id] = { x, y, rotated };
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
    const world = wp.view();
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
    if (left.length === 0) wp.apply({ kind: 'REMOVE_BODY', entityId: entityId });
    else wp.apply({ kind: 'UPDATE_BODY', entityId: entityId, patch: { container: { ...entity.container!, items: left } } });
    SessionJournal.record('INTERACT', { kind: 'CACHE_PICKUP', targetId: entityId, itemIds: [itemId] });
    return { ok: true };
  },

  placeOnCart: (entityId, itemId, x, y, rotated, along) => {
    const world = wp.view();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (!entity?.cart) return { ok: false, reason: 'No cart there.' };
    const placed = CartSystem.placeAt(entity.cart, itemId, x, y, rotated, along);
    if (!placed) return { ok: false, reason: 'The cart bed has no room there. It stays where it was.' };
    wp.apply({ kind: 'UPDATE_BODY', entityId: entityId, patch: { cart: placed } });
    void get().persistCarts();
    return { ok: true };
  },

  rotateOnCart: (entityId, itemId) => {
    const entity = Object.values(wp.view().currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    const item = entity?.cart?.items.find(i => i.id === itemId);
    if (!entity?.cart || !item) return { ok: false, reason: 'Nothing of that name aboard.' };
    const turned = CartSystem.rotate(entity.cart, itemId);
    if (!turned) {
      const v = { ok: false, reason: `There is no room on the bed to turn ${shown(item)}. Clear a space beside it.` };
      feed(v.reason, 'loss');
      return v;
    }
    wp.apply({ kind: 'UPDATE_BODY', entityId, patch: { cart: turned } });
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
      return { player: { ...s.player, equipment: { ...eq, protected: [...kept, until ? { slot, by, until, startedAt: Date.now() } : { slot, by }] } } };
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

    // D50: a sitting costs the day's energy, and what it found is known only after a rest.
    const { cost } = StudySystem.identifyAsk(player, item);
    const today = player.energyToday ?? StatSystem.maxEnergyOf(player);
    if (today < cost) {
      const v = { ok: false, reason: `Refused: needs ${cost} energy, you hold ${Math.floor(today)}. Rest first.` };
      feed(v.reason, 'loss');
      return v;
    }
    // Q27: identifying is a skill. Without the eye an unread piece only teaches it; with it, the piece is read at the rest.
    const reads = StudySystem.canRead(player, item);
    // The sitting: the scoped skill grows by use (D6).
    get().gainSkillXp(StudySystem.scopeSkillId(scope), 60, ['study', 'intel'], { tags: ['study'], magnitude: 10 } as any);
    set(s => ({ player: { ...(reads ? RestSystem.queueStudy(s.player, itemId) : s.player), energyToday: today - cost } }));
    const level = StudySystem.identifyLevel(get().player, item);
    // D32: what has not been read is never named, not even by its kind
    feed(!reads
      ? `You sat with it and could not make it out. Your eye for this kind of thing is learning.`
      : item.isIdentified === false
        ? `You sat with it. You will know what it is after you rest.`
        : `You sat with it. The ${scope} eye stands at ${level}. You will know after you rest.`, 'proof');
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
      // Pedro, 2026-11-10: "The note isn't spent, that needs to be spent". Read, it is gone: nothing is left to sell
      const read = StudySystem.loseItem(revealed, item.id);
      return {
        player: {
          ...read,
          bank: {
            ...read.bank,
            lore: { ...read.bank.lore, [topic]: { topic, xp: 0, level: 1, dateDiscovered: Date.now() } },
            loreHeld: (read.bank.loreHeld ?? 0) + LORE_NOTE_PAY // D118: what is read is lore to spend
          }
        }
      };
    });
    feed(`Read ${item.name}. What common ${data.processFamily} leaves behind now reads on the card. The note is spent.`, 'proof');
    void import('../../logic/ledger/Ledger').then(({ Ledger }) =>
      Ledger.append('TECH', { kind: 'NOTE_READ', name: item.name, family: data.processFamily, consumedIds: [item.id] }));
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

  // Q27 (Pedro, 2026-11-04): the field identify was a test of the system, and it is gone. Nothing is read before town.

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
    // A cage is not something to bring out of a belt in a hurry (D65)
    const item = pouch.pouchData.contents.find(c => c.type === IT.CONSUMABLE && !c.creatureData);
    if (!item) return { ok: false, reason: `${pouch.name} holds nothing quick to use.` };
    if (!session) return { ok: false, reason: 'Quick-use is for the field.' };
    // 2026-11-11: a tonic past the body's limit is refused in words, and it stays on the belt
    const drink = RestSystem.isTonic(item) ? RestSystem.drinkTonic(player, item) : undefined;
    if (drink && !drink.ok) { feed(drink.reason!, 'loss'); return { ok: false, reason: drink.reason }; }

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
    const tonic = drink ? RestSystem.drinkTonic(get().player, item) : undefined;
    if (tonic) set({ player: tonic.player });
    const refill = tonic?.gave ?? 0;
    SessionJournal.record('INTERACT', { kind: 'QUICK_USE', itemId: item.id, restore, refill, health });
    if (item.casts) set({ pendingCast: item.casts }); // Layer 3: the field casts it, through the one door
    const said = tonic
      ? FieldWords.tonic({ name: item.name, gave: refill, slow: tonic.slow, fromBelt: true })
      : FieldWords.consumed({ name: item.name, restore, refill, casts: !!item.casts, fromBelt: true });
    feed(said.text, said.tone);
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

    const world = wp.view();
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

    wp.apply({ kind: 'ADD_BODY', entity: {
      id: entityId,
      type: EntityType.CART,
      definitionId: 'cart_field',
      position: { x: pos.x + 24, y: pos.z },
      rank: item.rank,
      rarity: item.rarity,
      isHostile: false,
      cart
    } });
    SessionJournal.record('INTERACT', { kind: 'CART_DEPLOY', entityId, cartItemId: item.id });
    feed(`${item.name} unfolds. Its bed is ${cart.gridW}×${cart.gridH}; your seal is on it. It stays in the world — even past your death.`, 'proof');
    await get().persistCarts();
    return { ok: true };
  },

  towCart: async (entityId) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return { ok: false, reason: 'Nothing to tow outside the field.' };
    const world = wp.view();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (!entity?.cart) return { ok: false, reason: 'No cart there.' };

    const isTheft = entity.cart.ownerId !== state.player.id;

    // 10E (D16's addendum): a warded cart costs the thief TIME before the bar
    // gives. The owner pays none; the broken lock lands in the signed record.
    const security = entity.cart.security;
    if (isTheft && security && security.lockLevel > 0) {
      const seconds = CartSystem.towBreakSeconds(security.lockLevel);
      feed(`${entity.cart.ownerName}'s cart stands ${security.by}: ${security.lockLevel} lock${security.lockLevel === 1 ? '' : 's'}. Breaking them takes ${seconds}s.`, 'loss');
      const waitId = `locks_${entityId}`;
      const startedAt = Date.now();
      useWaits.getState().begin({ id: waitId, label: 'BREAKING THE LOCKS', startedAt, until: startedAt + seconds * 1000 });
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      useWaits.getState().end(waitId);
      const still = Object.values(wp.view().currentMap?.chunks || {})
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

    wp.apply({ kind: 'UPDATE_BODY', entityId: entityId, patch: { cart } });
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
    const world = wp.view();
    const entity = Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === entityId);
    if (entity?.cart) wp.apply({ kind: 'UPDATE_BODY', entityId: entityId, patch: { cart: { ...entity.cart, towedBy: undefined } } });
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
    const world = wp.view();
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
    wp.apply({ kind: 'UPDATE_BODY', entityId: entityId, patch: { cart: loaded } });
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
    const world = wp.view();
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
    wp.apply({ kind: 'UPDATE_BODY', entityId: entityId, patch: { cart: CartSystem.unload(entity.cart, itemId)! } });
    SessionJournal.record('INTERACT', { kind: 'CART_UNLOAD', entityId, itemId });
    void get().persistCarts();
    return { ok: true };
  },

  persistCarts: async () => {
    const world = wp.view();
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
          health: StatSystem.maxHealth(state.player.attributes, state.player.equipment),
          maxHealth: StatSystem.maxHealth(state.player.attributes, state.player.equipment),
          // D51: a drop refills nothing. What is left of the day comes along.
          energy: state.player.energyToday ?? StatSystem.maxEnergyOf(state.player),
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
    // Q27: coming home reads nothing. What nobody has read is banked unread, for the eye to learn on.
    const sessionLoot = banksLoot
      ? (player.currentSession?.inventory || [])
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
          energyToday: state.player.currentSession?.energy ?? state.player.energyToday,
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
        energyToday: state.player.currentSession?.energy ?? state.player.energyToday,
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
        maxWeight: LoadoutSystem.carryLimit(player.attributes.strength, player.equipment)
      });
      // Line 77: what is worn sets the top of the health bar; taking a piece off takes its health too
      const session = player.currentSession;
      if (session) {
        const maxHealth = StatSystem.maxHealth(player.attributes, player.equipment);
        if (maxHealth !== session.maxHealth) {
          set(s => s.player.currentSession ? { player: { ...s.player, currentSession: {
            ...s.player.currentSession, maxHealth, health: Math.max(1, Math.min(maxHealth, s.player.currentSession.health))
          } } } : s);
        }
      }
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

    const maxW = LoadoutSystem.carryLimit(state.player.attributes.strength, state.player.equipment);
    let inv = [...session.inventory];
    let layout = { ...(session.inventoryLayout || InventorySystem.placeAll(session.inventory)) };
    let weight = InventorySystem.totalWeight(inv);
    // The interface pass: a refusal is said on the screen, with its reason, and not only in the console
    let tooHeavy: { item: IItem; would: number } | null = null;
    let noRoom: IItem | null = null;

    for (const item of items) {
      const wouldWeigh = weight + (item.weight || 0);
      if (wouldWeigh > maxW) {
        rejected.push(item);
        tooHeavy ??= { item, would: wouldWeigh };
        continue;
      }
      const place = InventorySystem.autoPlace(inv, layout, item);
      if (!place) {
        rejected.push(item);
        noRoom ??= item;
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
    if (noRoom) feed(`The pack is full: no room in the grid for ${shown(noRoom)}${rejected.length > 1 ? ` and ${rejected.length - 1} more` : ''}.`, 'loss');
    else if (tooHeavy) feed(`The pack refuses the weight: ${shown(tooHeavy.item)} would make ${tooHeavy.would.toFixed(1)} of ${maxW} kg${rejected.length > 1 ? `, and ${rejected.length - 1} more stay too` : ''}.`, 'loss');
    return { added, rejected };
  },

  /** Leave something behind: it becomes a ground cache, still owned by you. */
  dropItem: (itemId, said) => {
    const state = get();
    const session = state.player.currentSession;
    if (!session) return;
    const item = session.inventory.find(i => i.id === itemId);
    if (!item) return;
    // Q16: a body set down lies on the ground again. It is never a cache anyone could open.
    if (Escort.isCorpse(item)) { FieldEscort.setDown(item, wp, playerPort); return; }

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
    // The interface pass: things dropped in one spot make one pile. A drop within reach of a pile this
    // person made joins it, and the pile is still theirs.
    const pile = Object.values(wp.view().currentMap?.chunks || {}).flatMap(c => c.entities)
      .filter(e => e.definitionId === 'ground_cache' && e.container && !e.container.looted && e.container.cacheOwner === state.player.id &&
        (e.container.items?.length ?? 0) > 0 && Math.hypot(e.position.x - pos.x, e.position.y - pos.z) < GROUND_REACH)
      .sort((a, b) => Math.hypot(a.position.x - pos.x, a.position.y - pos.z) - Math.hypot(b.position.x - pos.x, b.position.y - pos.z))[0];
    if (pile?.container) {
      wp.apply({ kind: 'UPDATE_BODY', entityId: pile.id, patch: { container: { ...pile.container, items: [...(pile.container.items ?? []), item] } } });
      SessionJournal.record('INTERACT', { kind: 'DROP_CACHE', cacheId: pile.id, itemId: item.id, itemName: item.name });
      if (!said?.quiet) feed(`Dropped at your feet: ${shown(item)}${(said?.count ?? 1) > 1 ? ` ×${said!.count}` : ''}, onto your pile (${(pile.container.items?.length ?? 0) + 1} there). It is still yours.`, 'plain');
      return;
    }
    // The tie-break matters: two caches in one millisecond once shared an id, and taking one took both.
    const cacheId = `cache_${session.sessionId.slice(0, 8)}_${Date.now().toString(36)}_${++cacheSeq}`;
    wp.apply({ kind: 'ADD_BODY', entity: {
      id: cacheId,
      type: EntityType.CONTAINER,
      definitionId: 'ground_cache',
      position: { x: pos.x + 15, y: pos.z },
      rank: item.rank,
      rarity: item.rarity,
      isHostile: false,
      container: { lootRank: item.rank, looted: false, hasLore: false, items: [item], cacheOwner: state.player.id }
    } });
    SessionJournal.record('INTERACT', { kind: 'DROP_CACHE', cacheId, itemId: item.id, itemName: item.name });
    if (!said?.quiet) feed(`Dropped at your feet: ${shown(item)}${(said?.count ?? 1) > 1 ? ` ×${said!.count}` : ''}. The pile is still yours, if you come back for it.`, 'plain');
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
        wp.apply({ kind: 'ADD_BODY', entity: {
          id: cacheId,
          type: EntityType.CONTAINER,
          definitionId: 'ground_cache',
          position: { x: pos.x + 15, y: pos.z + 15 },
          rank: result.item.rank,
          rarity: result.item.rarity,
          isHostile: false,
          container: { lootRank: result.item.rank, looted: false, hasLore: false, items: rejected, cacheOwner: get().player.id }
        } });
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
    // D65: what is in a cage is tried, not eaten
    if (item.creatureData) { FieldCapture.tame(item.id, wp, playerPort); return; }
    // 2026-11-11: a tonic past the body's limit is refused in words, and it stays in the pack
    const drink = RestSystem.isTonic(item) ? RestSystem.drinkTonic(get().player, item) : undefined;
    if (drink && !drink.ok) { feed(drink.reason!, 'loss'); return; }
    if (item.casts) set({ pendingCast: item.casts }); // Layer 3: the field casts it, through the one door

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
    // Pedro: a very rare potion or plant can refill the day's energy, as a rest does. Since 2026-11-11 it is
    // a tonic: a share of the day, counted, and it slows the walk until the next rest
    const tonic = drink ? RestSystem.drinkTonic(get().player, item) : undefined;
    if (tonic) set({ player: tonic.player });
    const refill = tonic?.gave ?? 0;
    SessionJournal.record('INTERACT', { kind: 'CONSUME', itemId, restore, refill, health });
    const said = tonic
      ? FieldWords.tonic({ name: item.name, gave: refill, slow: tonic.slow })
      : FieldWords.consumed({ name: item.name, restore, refill, casts: !!item.casts });
    feed(said.text, said.tone);
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

  /**
   * C14: a stone thrown is gone from the hand, and the next one carried comes to the same hand,
   * so a held button keeps throwing while the pack has any. The last one leaves the hand empty.
   * Anything else in a hand is left alone: it wears, and that is `wearSlot`'s.
   */
  spendThrown: (target) => {
    const held = get().player.equipment ? LoadoutSystem.itemIn(get().player.equipment!, target) : undefined;
    if (!held || !isThrowable(held)) return;
    const next = get().player.currentSession?.inventory.find(isThrowable);
    set(s => {
      const eq = s.player.equipment;
      if (!eq) return s;
      const slots = { ...eq.slots };
      const items = eq.items.filter(i => i.id !== held.id);
      let currentSession = s.player.currentSession;
      if (next && currentSession) {
        slots[target] = next.id;
        items.push(next);
        const layout = { ...(currentSession.inventoryLayout || {}) };
        delete layout[next.id];
        currentSession = { ...currentSession, inventory: currentSession.inventory.filter(i => i.id !== next.id), inventoryLayout: layout };
      } else {
        delete slots[target];
      }
      return { player: { ...s.player, equipment: { ...eq, slots, items }, currentSession } };
    });
    get().recalcWeight();
    SessionJournal.record('INTERACT', { kind: 'THROW', itemId: held.id, ...(next ? { drew: next.id } : {}) });
    if (!next) feed(`That was the last one. The ${target === 'LEFT_HAND' ? 'left' : 'right'} hand is empty.`, 'plain');
  },

  learnName: (person) => set(s => ({ player: ContactNames.learnName(s.player, person) })),

  /**
   * CRAFTING BY TWO (Pedro, 2026-11-10: "material + material, one dragged on top of another, and
   * then Unidentified appears. there's a secret crafting roll that's done, and after rest you see
   * what you made"). The law is PairCraft's. This is the door: both pieces leave, the unread thing
   * lies where the second one lay when it fits there, the energy is paid, and it goes on the log
   * for the rest. The feed says the same words whatever came of it.
   */
  combine: (itemId, ontoId, cartId) => {
    const p = get().player;
    const session = p.currentSession;
    const tab = p.bank.stashTabs[0];
    // H13d: a cart's bed takes one material set on another, as the pack and the vault do
    const cartBody = cartId ? Object.values(wp.view().currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === cartId) : undefined;
    if (cartId && (!session || !cartBody?.cart)) return { ok: false, reason: 'No cart there.' };
    const beside = cartBody?.cart ? cartBody.cart.items : session ? session.inventory : tab?.items ?? [];
    const item = beside.find(i => i.id === itemId);
    const onto = beside.find(i => i.id === ontoId);
    if (!item || !onto) return { ok: false, reason: 'Two things are worked together where they both lie.' };
    const may = PairCraft.mayCombine(item, onto);
    if (!may.ok) return may;
    const left = StudySystem.energyLeft(p);
    if (left < PAIR_ENERGY) return { ok: false, reason: `Refused: needs ${PAIR_ENERGY} energy, you hold ${Math.floor(left)}. Rest first.` };

    // In the field the roll is the session's own, so a hub can roll it again; at home it is keyed by the two pieces, which are used
    const rollKey = session ? SessionJournal.rollKey('make', `${item.id}:${onto.id}`) : `make:${p.id}:${item.id}:${onto.id}`;
    const hub = hp.view();
    const made = PairCraft.make(item, onto, {
      rank: ProgressionSystem.rankOf(p),
      dexterity: p.attributes?.dexterity ?? 1,
      skillLevel: id => p.bank.universalSkills[id]?.level ?? 0,
      // A bench is at home. Out in a world there is none under anybody's hands
      hasBench: asks => !session && ownerHasStationFor(asks, p.id, { lots: hub.lots, rooms: hub.rooms, stash: p.bank.stashTabs.flatMap(t => t.items) })
    }, rollKey);
    const waiting = { id: made.item.id, outcome: made.outcome, ...(made.why ? { why: made.why } : {}), ...(made.recipe?.trade ? { trade: made.recipe.trade } : {}) };
    const used = [item.id, onto.id];

    if (cartBody?.cart) {
      // Where the second one lay, when what came of it fits there; else wherever the bed has room; else the pack
      const cart = cartBody.cart;
      const lay = cart.layout[onto.id];
      const items = cart.items.filter(i => !used.includes(i.id));
      const layout = { ...cart.layout };
      for (const id of used) delete layout[id];
      const place = lay && InventorySystem.fitsAt(items, layout, made.item, lay.x, lay.y, false, cart.gridW, cart.gridH)
        ? { x: lay.x, y: lay.y, rotated: false }
        : InventorySystem.autoPlace(items, layout, made.item, cart.gridW, cart.gridH);
      set(s => ({ player: RestSystem.queueMade(StudySystem.pay(s.player, PAIR_ENERGY), waiting) }));
      wp.apply({ kind: 'UPDATE_BODY', entityId: cartBody.id, patch: { cart: place
        ? { ...cart, items: [...items, made.item], layout: { ...layout, [made.item.id]: place } }
        : { ...cart, items, layout } } });
      const pos = get().player.currentSession?.position;
      if (!place && get().tryAddItems([made.item]).rejected.length > 0 && pos) {
        wp.apply({ kind: 'ADD_BODY', entity: {
          id: `cache_made_${made.item.id}`, type: EntityType.CONTAINER, definitionId: 'ground_cache', position: { x: pos.x + 15, y: pos.z + 15 },
          rank: made.item.rank, rarity: made.item.rarity, isHostile: false,
          container: { lootRank: made.item.rank, looted: false, hasLore: false, items: [made.item], cacheOwner: get().player.id }
        } });
      }
      SessionJournal.record('INTERACT', { kind: 'MAKE', rollKey, consumedIds: used, itemId: made.item.id });
      void get().persistCarts();
    } else if (session) {
      const layout = { ...(session.inventoryLayout || {}) };
      const lay = layout[onto.id];
      for (const id of used) delete layout[id];
      const inventory = session.inventory.filter(i => !used.includes(i.id));
      // Where the second one lay, when what came of it fits there; otherwise wherever the pack has room
      const { w, h } = InventorySystem.footprint(made.item, false);
      const fitsThere = !!lay && InventorySystem.canPlaceAt(InventorySystem.buildOccupancy(inventory, layout), w, h, lay.x, lay.y);
      set(s => ({ player: RestSystem.queueMade(StudySystem.pay({ ...s.player, currentSession: { ...s.player.currentSession!, inventory, inventoryLayout: layout } }, PAIR_ENERGY), waiting) }));
      if (fitsThere) {
        set(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [...s.player.currentSession!.inventory, made.item], inventoryLayout: { ...s.player.currentSession!.inventoryLayout, [made.item.id]: { x: lay!.x, y: lay!.y, rotated: false } } } } }));
      } else {
        const { rejected } = get().tryAddItems([made.item]);
        const pos = get().player.currentSession?.position;
        if (rejected.length > 0 && pos) {
          wp.apply({ kind: 'ADD_BODY', entity: {
            id: `cache_made_${made.item.id}`, type: EntityType.CONTAINER, definitionId: 'ground_cache', position: { x: pos.x + 15, y: pos.z + 15 },
            rank: made.item.rank, rarity: made.item.rarity, isHostile: false,
            container: { lootRank: made.item.rank, looted: false, hasLore: false, items: rejected, cacheOwner: get().player.id }
          } });
          feed('The pack has no room for what came of it; a cache holds it at your feet.', 'loss');
        }
      }
      get().recalcWeight();
      SessionJournal.record('INTERACT', { kind: 'MAKE', rollKey, consumedIds: used, itemId: made.item.id });
    } else {
      const layout = StashGrid.resolve(tab!.items, tab!.layout);
      const lay = layout[onto.id];
      for (const id of used) delete layout[id];
      const items = [...tab!.items.filter(i => !used.includes(i.id)), made.item];
      const { w, h } = InventorySystem.footprint(made.item, false);
      if (lay && StashGrid.canPlace(items, layout, made.item.id, w, h, lay.x, lay.y)) layout[made.item.id] = { x: lay.x, y: lay.y, rotated: false };
      set(s => ({
        player: RestSystem.queueMade(StudySystem.pay({
          ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, idx) => (idx === 0 ? { ...t, items, layout } : t)) }
        }, PAIR_ENERGY), waiting)
      }));
    }

    // The same words whatever it came to: what was made is nobody's to know before a rest
    feed(`You set ${shown(item)} on ${shown(onto)} and work them together. Something comes of it. You will know what after you rest.`, 'signal');
    void import('../../logic/ledger/Ledger').then(({ Ledger }) =>
      Ledger.append('TECH', { kind: 'MADE', itemId: made.item.id, consumedIds: used, hubId: hub.activeHubId }));
    void import('../../logic/sovereignty/Provenance').then(({ Provenance }) =>
      Provenance.record(made.item, 'MINT', { origin: 'IMPROVISATION', rollKey }));
    return { ok: true };
  },

  /**
   * Turn a piece: in the pack, or in the vault when that is where it is. It turns where it lies when
   * the turned shape fits, and otherwise moves to the nearest place it does; with no room anywhere
   * the feed says so (Pedro, of his own run: "rotate needs to be fixed").
   */
  rotateItem: (itemId) => {
    const session = get().player.currentSession;
    const carried = session?.inventory.find(i => i.id === itemId);
    if (session && carried) {
      // A stack turns whole (the interface pass): its other pieces are lifted while the turn looks for room
      const stack = InventorySystem.stackOf(session.inventory, session.inventoryLayout || {}, itemId);
      const alone = session.inventory.filter(i => i.id === itemId || !stack.includes(i.id));
      const turned = InventorySystem.tryRotate(alone, session.inventoryLayout || {}, itemId);
      if (!turned) {
        feed(`There is no room in the pack to turn ${shown(carried)}. Clear a space beside it, or drag it and press R.`, 'loss');
        return;
      }
      set(s => s.player.currentSession ? ({
        player: { ...s.player, currentSession: {
          ...s.player.currentSession,
          inventoryLayout: { ...(s.player.currentSession.inventoryLayout || {}), ...Object.fromEntries(stack.map(id => [id, turned])) }
        } }
      }) : s);
      return;
    }
    const tab = get().player.bank.stashTabs[0];
    const stored = tab?.items.find(i => i.id === itemId);
    if (!tab || !stored) return;
    // The vault grows downward, so there is always room under what it holds
    const layout = StashGrid.resolve(tab.items, tab.layout);
    const rows = StashGrid.rows(tab.items, layout) + Math.max(stored.dimensions?.width ?? 1, stored.dimensions?.height ?? 1);
    const stack = InventorySystem.stackOf(tab.items, layout, itemId);
    const turned = InventorySystem.tryRotate(tab.items, layout, itemId, STASH_COLS, rows, (w, h, x, y) => StashGrid.canPlace(tab.items, layout, itemId, w, h, x, y, STASH_COLS, stack));
    if (!turned) {
      feed(`${shown(stored)} is too long to lie that way in the vault.`, 'loss');
      return;
    }
    for (const id of stack) layout[id] = turned;
    set(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, idx) => idx === 0 ? { ...t, layout } : t) } }
    }));
  },

  performInteraction: (interactionId, targetId) => {
    console.log(`[ACTION] Performing ${interactionId} on ${targetId}`);
    const { player } = get();
    const session = player.currentSession;
    if (!session) return;

    // Resolve the live entity from the world
    const world = wp.view();
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

    // Pedro: experience pays in the world, once, at the taking, by the risk of what still stands near it.
    // A chest's rarity is its chunk's: richer loot, and no more danger, so it pays by rank alone.
    const payForRisk = (target: { rank: UniversalRank; rarity?: Rarity }, share: number): number => {
      const at = entity!.position;
      const threats = Object.values(world.currentMap?.chunks ?? {}).flatMap(c => c.entities)
        .filter(e => e.type === EntityType.MOB && e.isHostile && (e.health ?? 0) > 0 && Math.hypot(e.position.x - at.x, e.position.y - at.y) <= THREAT_RADIUS_TILES * 20);
      const xp = ProgressionSystem.worldXp(target, share, threats);
      const circlesBefore = ProgressionSystem.circlesEarned(get().player);
      const res = get().applyKillXp(xp);
      SessionJournal.record('INTERACT', { kind: 'WORLD_XP', targetId: entity!.id, xp, threats: threats.length });
      if (res.leveledUp) feed(ProgressionSystem.levelUpLine(res.to, res.pointsGranted, ProgressionSystem.circlesEarned(get().player) > circlesBefore), 'proof');
      return xp;
    };

    // Wave 3: everything enters through the caps; overflow lands at your feet
    const addToInventory = (items: IItem[]): IItem[] => {
      const { added, rejected } = get().tryAddItems(items);
      if (rejected.length > 0) {
        const pos = get().player.currentSession?.position;
        if (pos) {
          const cacheId = `cache_ovf_${Date.now().toString(36)}_${++cacheSeq}`;
          wp.apply({ kind: 'ADD_BODY', entity: {
            id: cacheId,
            type: EntityType.CONTAINER,
            definitionId: 'ground_cache',
            position: { x: pos.x + 15, y: pos.z + 15 },
            rank: rejected[0].rank,
            rarity: rejected[0].rarity,
            isHostile: false,
            container: { lootRank: rejected[0].rank, looted: false, hasLore: false, items: rejected, cacheOwner: get().player.id }
          } });
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
         const targetDefId = entity?.definitionId ?? '';
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
    // D65: a snare on a body in reach. The law and the record are in FieldCapture.
    if (interactionId.startsWith('int_snare_')) {
      if (!entity) return;
      if (!spendEnergy(Capture.SNARE_ENERGY)) return;
      FieldCapture.snare(entity, wp, playerPort, hp);
      return;
    }

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
          wp.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { usesRemaining: 0, regrowAt: Date.now() + def.regrowMs } });
        } else {
          // Mineral: the vein is dry forever
          wp.apply({ kind: 'REMOVE_BODY', entityId: entity.id });
          console.log(`[HARVEST] ${def.name} depleted. The vein runs dry.`);
        }
      } else {
        wp.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { usesRemaining: usesLeft } });
      }

      if (pair) get().workOn(pair, rankIndexOf(def.rank), Math.ceil(10 * quantity * 0.5), effort.winging);
      // What has been worked is known by its name from then on, whatever became of what it gave
      set(s => ({ player: WebSystem.named(s.player, def.id) }));
      // Layer 4: what is gathered gives up its element, from its own world's elements
      const elements = [...new Set(ContentRegistry.get(def.themeId)?.abilities.flatMap(a => a.elements) ?? [])];
      if (elements.length > 0) set(s => ({ player: WeaveSystem.gather(s.player, WeaveSystem.elementOf(def.id, elements)) }));
      // C14: a loose stone is picked up, in the feed as in the prompt
      feed(`${isLooseStone(def) ? 'Picked up' : 'Harvested'} ${quantity}× ${def.name}. +${payForRisk({ rank: def.rank ?? UniversalRank.F, rarity: def.rarity }, XP_SHARE_HARVEST)} XP`, 'proof');
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
          if (left.length === 0) wp.apply({ kind: 'REMOVE_BODY', entityId: entity.id });
          else wp.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { container: { ...entity.container, items: left } } });
          SessionJournal.record('INTERACT', { kind: 'CACHE_PICKUP', targetId: entity.id, itemIds: taken.map(i => i.id) });
          // D93: a leader's store is that much poorer when its cycle closes
          if (entity.structure) wp.apply({ kind: 'STORE_TAKEN', structureId: entity.id, count: taken.length });
          feed(`Recovered ${taken.length === 1 ? shown(taken[0]) : `${taken.length} items`}.`, 'proof');
        }
        if (rejected.length > 0) feed(`The pack refuses ${rejected.length}; ${rejected.length === 1 ? 'it stays' : 'they stay'} in the cache.`, 'loss');
        return;
      }

      const claimedNow = claimedChests.delete(entity.id);
      if (!claimedNow && !spendEnergy(2)) return;

      // Played live, a chest is claimed first, in the room's queue; it opens only for the claim that
      // won, and the write is the room's, after (Pedro: "the first or best lag gets the first spot")
      const live = wp.view();
      if (!claimedNow && ChestSystem.isChest(entity.id) && LiveClient.isLive(live.activeWorldId)) {
        const saw = live.chestRecord?.chests[entity.id]?.lootedAt ?? null;
        void LiveClient.chests({ op: 'loot', chestId: entity.id, cycle: live.generation, saw }).then(out => {
          if (out?.record) wp.apply({ kind: 'CHEST_RECORD', record: out.record });
          if (out?.ok) { claimedChests.add(entity.id); get().performInteraction(interactionId, targetId); return; }
          wp.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { container: { ...entity.container!, looted: true } } });
          feed(out?.reason ?? 'The chest could not be claimed.', 'loss');
        });
        return;
      }

      const rollKey = SessionJournal.rollKey('chest', entity.id);
      const rng = Rng.fromKey(rollKey);
      // Wave 10E: a chest in a dreamed world fills from its biome's bank
      const loot = LootTable.generateChestLoot(entity.container.lootRank, 1.0, rollKey, biomeAt(entity.position));

      // D115: a gem, a work of art, a valuable. Its own stream, so nothing above or below it moves.
      const chestWorld = wp.view().availableWorlds.find(w => w.id === wp.view().activeWorldId);
      const anchor = Anchors.fromChest(Anchors.foundIn(chestWorld?.themeId, biomeAt(entity.position), entity.container.lootRank), rollKey);
      if (anchor) loot.push(anchor);

      if (entity.container.hasLore) {
        const worldCard = wp.view().availableWorlds.find(w => w.id === wp.view().activeWorldId);
        const worldLore = ContentRegistry.lore(worldCard?.themeId, wp.view().directorRecord ?? undefined);
        const fragment = rng.pick(worldLore.length > 0 ? worldLore : LORE_FRAGMENTS);
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
      // The lore pass, call 6: a leader's or a boss's hoard holds a fragment "often", in a world pinned to it
      if (entity.definitionId === 'struct_store' && LoreDrops.fragment('hoard', rollKey, chestWorld?.groundVersion)) loot.push(LootTable.loreFragment(rollKey, chestWorld?.themeId));

      addToInventory(loot);
      wp.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { container: { ...entity.container, looted: true } } });
      wp.apply({ kind: 'CHEST_LOOTED', chestId: entity.id });
      const onTable = LootTable.chestRoll(entity.container.lootRank, rollKey, biomeAt(entity.position));
      SessionJournal.record('INTERACT', { kind: 'OPEN', targetId: entity.id, rollKey, itemIds: loot.map(i => i.id), ...(onTable ? { table: onTable } : {}) });
      get().processAction({ tags: ['scavenging', 'intel'], magnitude: 20 });
      feed(`Chest opened: ${loot.length} item${loot.length === 1 ? '' : 's'}${entity.container.hasLore ? ', one of them a fragment' : ''}. +${payForRisk({ rank: entity.container.lootRank }, XP_SHARE_CHEST)} XP`, 'proof');
      return;
    }

    // ------------------------------------------------------------------
    // NPC SOCIAL LOOP (Wave 2.4): TALK, GIFT, RECRUIT
    // ------------------------------------------------------------------
    // D113, D114: talking opens the talk store's door, which the screen asks first (talkStore.talkFrom).

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

      wp.apply({ kind: 'UPDATE_BODY', entityId: entity.id, patch: { npc: { ...entity.npc, disposition } } });
      SessionJournal.record('INTERACT', { kind: 'GIFT', targetId: entity.id, itemId: gift.id, disposition });
      get().processAction({ tags: ['social', 'trade'], magnitude: 10 });
      // A person has no name until it is asked
      feed(`Gave ${gift.name} to ${ContactNames.knowsName(get().player, entity) ? entity.npc.name : 'them'} (${disposition}/100).`, 'plain');
      return;
    }

    if (interactionId.startsWith('int_recruit_')) {
      if (!entity.npc || entity.escort || entity.npc.disposition < StatSystem.recruitDisposition(get().player.attributes)) return;
      if (!spendEnergy(5)) return;

      // Q16: they walk beside you to the beacon, in the world, and fight back when engaged.
      // The bond the hub reads is written at the beacon, from the same facts (D27, Wave 11's seam).
      const escort = FieldEscort.join(entity, wp, playerPort);
      if (!escort) return;
      SessionJournal.record('INTERACT', { kind: 'RECRUIT', targetId: entity.id, npcName: entity.npc.name });
      get().processAction({ tags: ['social', 'rescue', 'charisma'], magnitude: 50 });
      // Someone who agrees to come says who they are. From here the character knows their name
      const alreadyKnown = ContactNames.knowsName(get().player, entity);
      set(s => ({ player: ContactNames.learnName(s.player, entity) }));
      feed(alreadyKnown
        ? `${entity.npc.name} walks beside you now. Reach the beacon together.`
        : `They give their name, ${entity.npc.name}, and walk beside you now. Reach the beacon together.`, 'signal');
      return;
    }

    // Q16: a person brought out who fell, taken up to be carried home
    if (interactionId.startsWith('int_carry_')) {
      if (!entity.escort?.fallen) return;
      if (FieldEscort.carry(entity.id, wp, playerPort)) SessionJournal.record('INTERACT', { kind: 'CARRY', targetId: entity.id });
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
      // D84: the road is long; knowing how to learn is what shortens it
      skill.currentXp += Math.round(amount * StatSystem.learnRate(player.attributes));
      
      while (skill.currentXp >= ProgressionSystem.getXpToNextLevel(skill.level, ProgressionSystem.skillRarity(skill))) {
        skill.currentXp -= ProgressionSystem.getXpToNextLevel(skill.level, ProgressionSystem.skillRarity(skill));
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

  workOn: (pair, rank, xp, costly = false) => {
    if (get().player.bank.universalSkills[pair.id]) {
      get().gainSkillXp(pair.id, xp, pair.tags);
      set(s => {
        const skill = s.player.bank.universalSkills[pair.id];
        if ((skill.rank ?? 0) >= rank) return s;
        return { player: { ...s.player, bank: { ...s.player.bank, universalSkills: { ...s.player.bank.universalSkills, [pair.id]: { ...skill, bornRank: ProgressionSystem.skillRarity(skill), rank } } } } };
      });
      return;
    }
    if (!get().player.skillProgress?.[pair.id]) {
      // N13: only a road that charged more for the first try says so
      feed(FieldWords.winging(WebSystem.nameOf(pair.id), costly), 'signal');
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

// S2i (2026-11-11): what the pack weighs is read from the player, so any door that hands the store a new player
// (a SET through the port, a set inside an action, a setState) leaves the load as the pack is, not as it was.
usePlayerStore.subscribe((state, prev) => {
  if (state.player === prev.player) return;
  const currentWeight = InventorySystem.totalWeight(state.player.currentSession?.inventory ?? []);
  const maxWeight = LoadoutSystem.carryLimit(state.player.attributes?.strength ?? 0, state.player.equipment);
  if (currentWeight !== state.currentWeight || maxWeight !== state.maxWeight) usePlayerStore.setState({ currentWeight, maxWeight });
});

/** The player as a system takes it (playerView.ts): a fresh view on each read, the store's one door, and its calls. */
export const playerPort: IPlayerPort = {
  view: () => usePlayerStore.getState(),
  apply: (...changes) => usePlayerStore.getState().apply(...changes),
  watch: (listener) => usePlayerStore.subscribe((state, prev) => { if (state.player !== prev.player) listener(state.player, prev.player); }),
  tryAddItems: (...args) => usePlayerStore.getState().tryAddItems(...args),
  applyKillXp: (...args) => usePlayerStore.getState().applyKillXp(...args),
  grantRank: (...args) => usePlayerStore.getState().grantRank(...args),
  placeInPack: (...args) => usePlayerStore.getState().placeInPack(...args),
  placeInStash: (...args) => usePlayerStore.getState().placeInStash(...args),
  stowInPouch: (...args) => usePlayerStore.getState().stowInPouch(...args),
  equipSwap: (...args) => usePlayerStore.getState().equipSwap(...args),
  unequipFromSlot: (...args) => usePlayerStore.getState().unequipFromSlot(...args),
  placeOnCart: (...args) => usePlayerStore.getState().placeOnCart(...args),
  loadCart: (...args) => usePlayerStore.getState().loadCart(...args),
  unloadCart: (...args) => usePlayerStore.getState().unloadCart(...args),
  takeFromCache: (...args) => usePlayerStore.getState().takeFromCache(...args),
  combine: (...args) => usePlayerStore.getState().combine(...args),
  takeFromPouch: (...args) => usePlayerStore.getState().takeFromPouch(...args)
};

offerPort('player', playerPort);

import { create } from 'zustand';
import { IPlayer, IItem, UniversalRank, IAttributes, ICognitiveFrame, IEquippedSlots, SlotType } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { ProgressionSystem } from './systems/ProgressionSystem';
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
import { EntityType } from '../world/types';
import { MaterialScience } from '../world/MaterialScience';
import { COGNITIVE_FRAMES } from './data/cognitiveFrames'; // Import definitions

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
  
  // Physics
  currentWeight: number;
  maxWeight: number;

  // --- ACTIONS ---
  initializeSession: (certificate: IPlayerCertificate, archetypeId: string) => void;
  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  emergencyJackOut: (penalty?: 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH') => void;
  movePlayer: (direction: 'W' | 'A' | 'S' | 'D') => void;
  
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

export const usePlayerStore = create<PlayerState>((set, get) => ({
  player: INITIAL_PLAYER_TEMPLATE,
  view: 'BANK',
  lootContainer: null,
  lootContainerId: null,
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
        materialMastery: {},
        floatMemory: [null, null, null]
      }
    });
  },

  // --- FLOAT MEMORY LOGIC ---

  equipFrame: (slotIndex, frameId) => {
    const frame = COGNITIVE_FRAMES[frameId];
    if (!frame) return;

    set(state => {
      const newMemory = [...state.player.floatMemory] as [ICognitiveFrame | null, ICognitiveFrame | null, ICognitiveFrame | null];
      newMemory[slotIndex] = frame;
      
      return {
        player: { ...state.player, floatMemory: newMemory }
      };
    });
    
    get().recalcAttributes();
  },

  unequipFrame: (slotIndex) => {
    set(state => {
      const newMemory = [...state.player.floatMemory] as [ICognitiveFrame | null, ICognitiveFrame | null, ICognitiveFrame | null];
      newMemory[slotIndex] = null;
      return {
        player: { ...state.player, floatMemory: newMemory }
      };
    });
    get().recalcAttributes();
  },

  recalcAttributes: () => {
    set(state => {
      const { baseAttributes, floatMemory } = state.player;
      const newAttributes = { ...baseAttributes };

      // Apply Frames
      floatMemory.forEach(frame => {
        if (!frame) return;
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

      return {
        player: { ...state.player, attributes: newAttributes }
      };
    });
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
          kitItemIds: fieldKit.map(i => i.id),
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

    // Wave 4.4: the WORLD CERT decides what death costs. INVENTORY_LOSS means
    // the haul — field kit included — stays in the world. That is the stakes.
    const banksLoot = penalty === 'NONE';
    const sessionLoot = banksLoot
      ? (player.currentSession?.inventory.map(i => ({ ...i, isIdentified: true })) || [])
      : [];
    if (!banksLoot) {
      const lost = player.currentSession?.inventory.length || 0;
      console.warn(`[SESSION] Death penalty ${penalty}: ${lost} item(s) lost to the world.`);
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
      return state;
    });
    get().recalcWeight();
  },

  recalcWeight: () => {
      const { player } = get();
      const sessionInv = player.currentSession?.inventory || [];
      set({
        currentWeight: InventorySystem.totalWeight(sessionInv),
        maxWeight: InventorySystem.maxCarryWeight(player.attributes.strength)
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
      console.log(`[CARRY] ${rejected.length} item(s) refused: ${rejected.map(i => i.name).join(', ')} (space or weight)`);
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
    const cacheId = `cache_${session.sessionId.slice(0, 8)}_${Date.now().toString(36)}`;
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
    console.log(`[CARRY] Left behind: ${item.name} (cache ${cacheId})`);
  },

  // --------------------------------------------------------------------
  // WAVE 4: EQUIPMENT
  // --------------------------------------------------------------------

  /** Use a carried consumable. Negative restore values are harmful on purpose. */
  consumeItem: (itemId) => {
    const session = get().player.currentSession;
    const item = session?.inventory.find(i => i.id === itemId);
    if (!session || !item || item.type !== ItemType.CONSUMABLE) return;

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
  },

  /** Mark a stash item to go along on the next session. */
  toggleCarry: (itemId) => {
    set(s => {
      const current = s.player.bank.carryItemIds || [];
      const carryItemIds = current.includes(itemId) ? current.filter(id => id !== itemId) : [...current, itemId];
      return { player: { ...s.player, bank: { ...s.player.bank, carryItemIds } } };
    });
  },

  /** Wield/wear an item from the pack. The slot bucket follows SlotType. */
  equipItem: (itemId) => {
    const session = get().player.currentSession;
    if (!session) return;
    const item = session.inventory.find(i => i.id === itemId);
    if (!item || item.slot === SlotType.NONE) {
      console.log('[GEAR] That cannot be equipped.');
      return;
    }
    const bucket: keyof IEquippedSlots =
      item.slot === SlotType.MAIN_HAND || item.slot === SlotType.OFF_HAND ? 'mainHand'
      : item.slot === SlotType.ACCESSORY ? 'accessory'
      : 'armor'; // HEAD / CHEST / LEGS / FEET / BAG

    set(s => s.player.currentSession ? ({
      player: { ...s.player, currentSession: {
        ...s.player.currentSession,
        equipped: { ...(s.player.currentSession.equipped || {}), [bucket]: itemId }
      } }
    }) : s);
    console.log(`[GEAR] Equipped ${item.name} (${bucket}).`);
  },

  unequipSlot: (slot) => {
    set(s => {
      if (!s.player.currentSession?.equipped) return s;
      const equipped = { ...s.player.currentSession.equipped };
      delete equipped[slot];
      return { player: { ...s.player, currentSession: { ...s.player.currentSession, equipped } } };
    });
  },

  /** Durability loss on use/hit. Broken gear stays in the pack but stops working. */
  wearEquipment: (slot, amount) => {
    const session = get().player.currentSession;
    const itemId = session?.equipped?.[slot];
    if (!session || !itemId) return;
    set(s => {
      if (!s.player.currentSession) return s;
      const inventory = s.player.currentSession.inventory.map(i => {
        if (i.id !== itemId) return i;
        const dur = i.stats?.durability;
        if (dur === undefined) return i;
        const next = Math.max(0, dur - amount);
        if (next === 0 && dur > 0) console.warn(`[GEAR] ${i.name} BROKE.`);
        return { ...i, stats: { ...i.stats, durability: next } };
      });
      return { player: { ...s.player, currentSession: { ...s.player.currentSession, inventory } } };
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
        console.log('[ACTION] Not enough energy.');
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
          const cacheId = `cache_ovf_${Date.now().toString(36)}`;
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
       get().gainSkillXp('skill_analysis', 100, ['intel', 'science'], { tags: ['study'], magnitude: 10 });
       return;
    }

    if (!entity) return;

    // ------------------------------------------------------------------
    // HARVEST (Wave 2.2): keyed yield, node depletion, flora regrow
    // ------------------------------------------------------------------
    if (interactionId.startsWith('int_harvest_')) {
      const def = RESOURCE_DEFINITIONS[entity.definitionId];
      if (!def?.harvestConfig) return;
      if ((entity.usesRemaining ?? 1) <= 0) return;
      if (!spendEnergy(def.harvestConfig.energyCost)) return;

      const usesLeft = (entity.usesRemaining ?? 1) - 1;
      const rollKey = SessionJournal.rollKey('harvest', `${entity.id}:${usesLeft}`);
      const rng = Rng.fromKey(rollKey);
      const [minY, maxY] = def.yieldPerUse ?? [1, 1];
      const quantity = rng.int(minY, maxY + 1);
      const items = Array.from({ length: quantity }, () => ItemFactory.createResourceItem(def, rng));

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

      get().processAction({ tags: ['gathering', 'strength', ...(def.tags || [])], magnitude: 10 * quantity });
      console.log(`[HARVEST] +${quantity}x ${def.name}`);
      return;
    }

    // ------------------------------------------------------------------
    // OPEN (Wave 2.3): ruin chests — keyed loot + a lore fragment
    // ------------------------------------------------------------------
    if (interactionId.startsWith('int_open_')) {
      if (!entity.container || entity.container.looted) return;
      if (!spendEnergy(2)) return;

      // Wave 3.3: GROUND CACHE — explicit contents, no generation
      if (entity.container.items && entity.container.items.length > 0) {
        const taken = addToInventory(entity.container.items);
        const left = entity.container.items.filter(i => !taken.some(t => t.id === i.id));
        if (left.length === 0) {
          world.removeEntity(entity.id);
        } else {
          world.updateEntity(entity.id, { container: { ...entity.container, items: left } });
        }
        SessionJournal.record('INTERACT', { kind: 'CACHE_PICKUP', targetId: entity.id, itemIds: taken.map(i => i.id) });
        console.log(`[CACHE] Recovered ${taken.length} item(s)${left.length ? `, ${left.length} still inside` : ''}.`);
        return;
      }

      const rollKey = SessionJournal.rollKey('chest', entity.id);
      const rng = Rng.fromKey(rollKey);
      const loot = LootTable.generateChestLoot(entity.container.lootRank, 1.0, rollKey);

      if (entity.container.hasLore) {
        const fragment = rng.pick(LORE_FRAGMENTS);
        loot.push({
          ...ItemFactory.createResourceItem({ id: 'lore_fragment', name: 'Lore Fragment', icon: '📜', weight: 0.1, dimensions: { width: 1, height: 1 } } as any, rng),
          type: ItemType.LORE,
          description: fragment,
          value: 50,
          tags: ['lore', 'document']
        });
      }

      addToInventory(loot);
      world.updateEntity(entity.id, { container: { ...entity.container, looted: true } });
      SessionJournal.record('INTERACT', { kind: 'OPEN', targetId: entity.id, rollKey, itemIds: loot.map(i => i.id) });
      get().processAction({ tags: ['scavenging', 'intel'], magnitude: 20 });
      console.log(`[CHEST] Opened: ${loot.length} items (lore included).`);
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
      console.log(`[SOCIAL] ${entity.npc.name}: ${success ? 'warms to you' : 'is unconvinced'} (${disposition}/100)`);
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
      console.log(`[SOCIAL] Gave ${gift.name} to ${entity.npc.name} (${disposition}/100)`);
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
        tags: ['npc_contract', 'social']
      };

      addToInventory([contract]);
      useWorldStore.getState().removeEntity(entity.id);
      SessionJournal.record('INTERACT', { kind: 'RECRUIT', targetId: entity.id, npcName: entity.npc.name, contractId: contract.id });
      get().processAction({ tags: ['social', 'rescue', 'charisma'], magnitude: 50 });
      console.log(`[SOCIAL] ${entity.npc.name} secured for extraction!`);
      return;
    }
  },

  gainSkillXp: (skillId, amount, tags, actionContext) => {
    set((state) => {
      const { player } = state;
      const skills = { ...player.bank.universalSkills };
      
      if (!skills[skillId]) {
        skills[skillId] = {
          id: skillId,
          level: 1,
          currentXp: 0,
          tags: tags,
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
  },

  processAction: (context) => {
    const { gainSkillXp, currentWeight, maxWeight } = get();
    if (context.tags.includes('pickup') && (context as any).item) {
        const item = (context as any).item as IItem;
        const itemWeight = item.weight || 1.0;
        if (currentWeight + itemWeight > maxWeight) return; 
        setTimeout(() => get().recalcWeight(), 50); 
    }
    const skillId = SkillDiscovery.discoverSkill(context);
    const xpAmount = Math.ceil(context.magnitude * 0.5);
    gainSkillXp(skillId, xpAmount, context.tags, context);
  }
}));
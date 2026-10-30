import { create } from 'zustand';
import { IPlayer, IItem, UniversalRank, IAttributes, ICognitiveFrame } from '../../../types';
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
  emergencyJackOut: () => void;
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
    const fieldKit = mainStash.filter(i => i.tags?.includes('tool'));
    const remainingStash = mainStash.filter(i => !i.tags?.includes('tool'));
    if (fieldKit.length > 0) console.log(`[DIVE] Field kit equipped: ${fieldKit.map(i => i.name).join(', ')}`);

    set((state) => ({
      view: 'SESSION',
      player: {
        ...state.player,
        bank: {
          ...state.player.bank,
          stashTabs: state.player.bank.stashTabs.map((tab, idx) =>
            idx === 0 ? { ...tab, items: remainingStash } : tab
          )
        },
        currentSession: {
          sessionId: crypto.randomUUID(),
          layerId: layerId,
          inventory: fieldKit,
          health: 100,
          maxHealth: 100 + (state.player.attributes.constitution * 10),
          energy: 50 + (state.player.attributes.endurance * 5),
          position: { x: 1500, y: 0, z: 1500 },
          statusEffects: []
        }
      }
    }));
  },

  emergencyJackOut: () => {
    const { player } = get();
    const sessionLoot = player.currentSession?.inventory.map(i => ({ ...i, isIdentified: true })) || [];
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
      const weight = sessionInv.reduce((sum, item) => sum + (item.weight || 0), 0);
      set({ currentWeight: weight });
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

    const addToInventory = (items: IItem[]) => {
      set(state => state.player.currentSession ? ({
        player: { ...state.player, currentSession: { ...state.player.currentSession, inventory: [...state.player.currentSession.inventory, ...items] } }
      }) : state);
      get().recalcWeight();
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
import { create } from 'zustand';
import { IPlayer, IItem, UniversalRank, IAttributes, ICognitiveFrame } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { ProgressionSystem } from './systems/ProgressionSystem';
import { SkillDiscovery, IActionContext } from './systems/SkillDiscovery';
import { DEFAULT_ATTRIBUTES, IBaseAttributes } from './types';
import { IPlayerCertificate } from '../identity/certificateSystem';
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
          stashTabs: [{ name: 'CACHE_01', items: [ItemFactory.createItem(UniversalRank.F, true)] }],
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
    set((state) => ({
      view: 'SESSION',
      player: {
        ...state.player,
        currentSession: {
          sessionId: crypto.randomUUID(),
          layerId: layerId,
          inventory: [],
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
    if (interactionId === 'int_study') {
       set(state => {
         const targetDefId = 'res_rock_small'; 
         const updatedPlayer = MaterialScience.studyMaterial(targetDefId, state.player);
         get().gainSkillXp('skill_analysis', 100, ['intel', 'science'], { tags: ['study'], magnitude: 10 });
         return { player: updatedPlayer };
       });
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
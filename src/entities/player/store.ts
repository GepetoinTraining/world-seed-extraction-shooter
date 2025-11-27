import { create } from 'zustand';
import { IPlayer, IItem, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { ProgressionSystem } from './systems/ProgressionSystem';
import { SkillDiscovery, IActionContext } from './systems/SkillDiscovery';
import { DEFAULT_ATTRIBUTES } from './types'; // Ensure this is exported in types.ts

// Mock Initial Player
const INITIAL_PLAYER: IPlayer = {
  id: 'alpha-tester',
  username: 'Kirito_Zero',
  attributes: DEFAULT_ATTRIBUTES, // Ensure attributes exist
  bank: {
    accountId: 'acc_001_alpha',
    gold: 4500,
    stashTabs: [
      {
        name: 'MAIN STASH',
        items: [
          ItemFactory.createItem(UniversalRank.E, true), 
          ItemFactory.createItem(UniversalRank.D, true),
        ]
      },
      { name: 'CRAFTING MATS', items: [] }
    ],
    universalSkills: {}, // Start empty, let discovery fill it
    lore: {} 
  },
  currentSession: undefined
};

interface PlayerState {
  player: IPlayer;
  view: 'BANK' | 'SESSION';
  lootContainer: IItem[] | null;
  lootContainerId: string | null;

  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  emergencyJackOut: () => void;
  movePlayer: (direction: 'W' | 'A' | 'S' | 'D') => void;
  
  identifyItem: (itemId: string) => void;
  openLootContainer: (id: string, items: IItem[]) => void;
  closeLootContainer: () => void;
  transferItem: (itemId: string, from: 'INVENTORY' | 'CONTAINER', to: 'INVENTORY' | 'CONTAINER') => void;
  trashItem: (itemId: string, source: 'INVENTORY' | 'CONTAINER') => void;
  
  // --- NEW ACTIONS ---
  gainSkillXp: (skillId: string, amount: number, tags: string[], actionContext?: IActionContext) => void;
  processAction: (context: IActionContext) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  player: INITIAL_PLAYER,
  view: 'BANK',
  lootContainer: null,
  lootContainerId: null,

  setView: (view) => set({ view }),

  // ... diveIntoLayer, emergencyJackOut, movePlayer same as before ...
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
          maxHealth: 100,
          energy: 100,
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

  movePlayer: (direction) => {
    const MOVEMENT_SPEED = 5.0;
    set((state) => {
      if (!state.player.currentSession) return state;
      const { x, y, z } = state.player.currentSession.position;
      let newPos = { x, y, z };
      switch(direction) {
        case 'W': newPos.z -= MOVEMENT_SPEED; break;
        case 'S': newPos.z += MOVEMENT_SPEED; break;
        case 'A': newPos.x -= MOVEMENT_SPEED; break;
        case 'D': newPos.x += MOVEMENT_SPEED; break;
      }
      
      // Implicit Movement Skill Trigger?
      // get().processAction({ tags: ['movement', 'sprint'], magnitude: 1 });

      return {
        player: { ...state.player, currentSession: { ...state.player.currentSession, position: newPos } }
      };
    });
  },

  identifyItem: (itemId) => {
      set((state) => {
          if (!state.player.currentSession) return state;
          const updatedInventory = state.player.currentSession.inventory.map(item => 
              item.id === itemId ? { ...item, isIdentified: true } : item
          );
          
          // Trigger Academic Skill
          get().processAction({ tags: ['intel', 'analysis', 'ancient'], magnitude: 50 });

          return { player: { ...state.player, currentSession: { ...state.player.currentSession, inventory: updatedInventory } } };
      });
  },

  // ... openLootContainer, closeLootContainer, transferItem, trashItem same as before ...
  openLootContainer: (id, items) => set({ lootContainer: items, lootContainerId: id }),
  closeLootContainer: () => set({ lootContainer: null, lootContainerId: null }),
  transferItem: (itemId, from, to) => { /* ... implementation from previous ... */ },
  trashItem: (itemId, source) => { /* ... implementation from previous ... */ },

  // --- NEW SKILL LOGIC ---

  gainSkillXp: (skillId, amount, tags, actionContext) => {
    set((state) => {
      const { player } = state;
      const skills = { ...player.bank.universalSkills };
      
      // 1. GENESIS MOMENT (First Discovery)
      if (!skills[skillId]) {
        const position = player.currentSession 
          ? `Sector ${Math.floor(player.currentSession.position.x/100)},${Math.floor(player.currentSession.position.z/100)}`
          : 'The Void';

        skills[skillId] = {
          id: skillId,
          level: 1,
          currentXp: 0,
          tags: tags,
          scalingAttribute: 'intelligence', // Placeholder
          origin: {
            timestamp: Date.now(),
            triggerAction: actionContext ? actionContext.tags.join(' + ') : 'unknown',
            location: position,
            resonance: actionContext ? actionContext.magnitude : 0
          }
        };
        console.log(`[NEUROPLASTICITY] New Pathway Formed: ${skillId}`);
      }

      const skill = { ...skills[skillId] };
      
      // 2. Calculate Multipliers
      let finalAmount = amount;
      const isMeme = tags.includes('meme');
      if (isMeme && Math.random() > 0.9) {
        finalAmount *= 10;
        console.log("VIRAL HIT! Massive XP gain");
      }

      const learningRate = ProgressionSystem.calculateLearningRate(tags, player.attributes || DEFAULT_ATTRIBUTES);
      finalAmount *= learningRate;

      // 3. Apply XP
      skill.currentXp += finalAmount;

      // 4. Check Level Up
      while (true) {
        const xpNeeded = ProgressionSystem.getXpToNextLevel(skill.level);
        if (skill.currentXp >= xpNeeded) {
          skill.currentXp -= xpNeeded;
          skill.level++;
        } else {
          break;
        }
      }

      skills[skillId] = skill;

      return {
        player: { ...player, bank: { ...player.bank, universalSkills: skills } }
      };
    });
  },

  processAction: (context) => {
    const { gainSkillXp } = get();
    const skillId = SkillDiscovery.discoverSkill(context);
    const xpAmount = Math.ceil(context.magnitude * 0.5);
    gainSkillXp(skillId, xpAmount, context.tags, context);
  }
}));
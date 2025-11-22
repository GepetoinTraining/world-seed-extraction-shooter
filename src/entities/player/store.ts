import { create } from 'zustand';
import { IPlayer, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { BASE_SIMULATION_STATS } from './types'; // Import base stats for logic

// ... (Initial player setup remains same) ...
const INITIAL_PLAYER: IPlayer = {
  id: 'alpha-tester',
  username: 'Kirito_Zero',
  bank: {
    accountId: 'acc_001_alpha',
    gold: 4500,
    stashTabs: [
      {
        name: 'MAIN STASH',
        items: [
          // Bank items are identified by default
          ItemFactory.createItem(UniversalRank.E, true), 
          ItemFactory.createItem(UniversalRank.D, true),
          ItemFactory.createItem(UniversalRank.F, true),
          ItemFactory.createItem(undefined, true),
        ]
      },
      {
        name: 'CRAFTING MATS',
        items: []
      }
    ],
    universalSkills: {
      'swordsmanship': 50,
      'hacking': 12
    }
  },
  currentSession: undefined
};

interface PlayerState {
  player: IPlayer;
  view: 'BANK' | 'SESSION';
  
  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  emergencyJackOut: () => void;
  simulateLootDrop: () => void;
  movePlayer: (direction: 'W' | 'A' | 'S' | 'D') => void;
  
  // NEW ACTION
  identifyItem: (itemId: string) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  player: INITIAL_PLAYER,
  view: 'BANK',

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
          maxHealth: 100,
          energy: 100,
          position: { x: 0, y: 0, z: 0 },
          statusEffects: []
        }
      }
    }));
  },

  emergencyJackOut: () => {
    const { player } = get();
    // Auto-identify items on extraction? Usually safe zone = free identify or small fee
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

  simulateLootDrop: () => {
    // Drops in session are UNIDENTIFIED
    const newItem = ItemFactory.createItem(undefined, false); 
    set((state) => {
      if (!state.player.currentSession) return state;
      return {
        player: {
          ...state.player,
          currentSession: {
            ...state.player.currentSession,
            inventory: [...state.player.currentSession.inventory, newItem]
          }
        }
      };
    });
  },

  movePlayer: (direction) => {
    const MOVEMENT_SPEED = 1.0;
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
      return {
        player: {
          ...state.player,
          currentSession: {
            ...state.player.currentSession,
            position: newPos
          }
        }
      };
    });
  },

  identifyItem: (itemId) => {
      // In a real implementation, this would trigger a timer based on field_analysis_speed
      // For now, instant flip
      set((state) => {
          if (!state.player.currentSession) return state;
          
          const updatedInventory = state.player.currentSession.inventory.map(item => {
              if (item.id === itemId) {
                  return { ...item, isIdentified: true };
              }
              return item;
          });

          return {
              player: {
                  ...state.player,
                  currentSession: {
                      ...state.player.currentSession,
                      inventory: updatedInventory
                  }
              }
          };
      });
  }
}));
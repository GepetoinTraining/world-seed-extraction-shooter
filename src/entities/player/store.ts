import { create } from 'zustand';
import { IPlayer, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';

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
          // Starter items are identified
          ItemFactory.createItem(UniversalRank.E, true), 
          ItemFactory.createItem(UniversalRank.D, true),
        ]
      },
      { name: 'CRAFTING MATS', items: [] }
    ],
    universalSkills: { 'swordsmanship': 50 }
  },
  currentSession: undefined
};

interface PlayerState {
  player: IPlayer;
  view: 'BANK' | 'SESSION';
  lootContainer: any[] | null; // Looting state

  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  emergencyJackOut: () => void;
  simulateLootDrop: () => void;
  movePlayer: (direction: 'W' | 'A' | 'S' | 'D') => void;
  identifyItem: (itemId: string) => void;
  
  // Looting Actions
  openLootContainer: (items: any[]) => void;
  closeLootContainer: () => void;
  transferItem: (itemId: string, from: 'INVENTORY'|'CONTAINER', to: 'INVENTORY'|'CONTAINER') => void;
  trashItem: (itemId: string, source: 'INVENTORY'|'CONTAINER') => void;
  studyItem: (itemId: string) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  player: INITIAL_PLAYER,
  view: 'BANK',
  lootContainer: null,

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
          position: { x: 15, y: 0, z: 15 }, // Safe start pos
          statusEffects: []
        }
      }
    }));
  },

  emergencyJackOut: () => {
    const { player } = get();
    // Auto-identify on safe extraction
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
    // Drops in session are UNIDENTIFIED (false)
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
      set((state) => {
          if (!state.player.currentSession) return state;
          const updatedInventory = state.player.currentSession.inventory.map(item => {
              if (item.id === itemId) return { ...item, isIdentified: true };
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
  },

  // --- LOOTING ACTIONS ---
  openLootContainer: (items) => set({ lootContainer: items }),
  closeLootContainer: () => set({ lootContainer: null }),
  
  transferItem: (itemId, from, to) => {
      // Logic to move item between container and inventory
      // For brevity, we just console log, but in real app we perform array splicing
      console.log(`Transfer ${itemId} from ${from} to ${to}`);
      // Simplified:
      set(state => {
          if (!state.player.currentSession || !state.lootContainer) return state;
          // Implementation left as exercise or next step
          return state; 
      });
  },
  
  trashItem: (itemId, source) => {
      set(state => {
         if (!state.player.currentSession) return state;
         if (source === 'INVENTORY') {
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
  },

  studyItem: (itemId) => {
      // Destroy item for Lore XP
      get().trashItem(itemId, 'INVENTORY');
      console.log("Item studied! XP Gained.");
  }
}));
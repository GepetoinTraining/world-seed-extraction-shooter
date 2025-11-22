import { create } from 'zustand';
import { IPlayer, IItem, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
// import { LoreManager } from './LoreManager'; // Removed unused import

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
    universalSkills: { 'swordsmanship': 50 },
    // --- FIX: ADDED MISSING LORE PROPERTY ---
    lore: {} 
  },
  currentSession: undefined
};

interface PlayerState {
  player: IPlayer;
  view: 'BANK' | 'SESSION';
  lootContainer: IItem[] | null; // Fixed type from any[] to IItem[]
  lootContainerId: string | null; // Added missing property definition

  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  emergencyJackOut: () => void;
  simulateLootDrop: () => void;
  movePlayer: (direction: 'W' | 'A' | 'S' | 'D') => void;
  
  // --- ITEM INTERACTIONS ---
  identifyItem: (itemId: string) => void;
  openLootContainer: (id: string, items: IItem[]) => void;
  closeLootContainer: () => void;
  transferItem: (itemId: string, from: 'INVENTORY' | 'CONTAINER', to: 'INVENTORY' | 'CONTAINER') => void;
  trashItem: (itemId: string, source: 'INVENTORY' | 'CONTAINER') => void;
  studyItem: (itemId: string) => void; // Converts item to Lore
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  player: INITIAL_PLAYER,
  view: 'BANK',
  lootContainer: null,
  lootContainerId: null,

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
          position: { x: 1500, y: 0, z: 1500 }, // Start at ~15,15 chunk (Global coords)
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
    // Creates a "Virtual" loot container for testing
    const drops = [
        ItemFactory.createItem(UniversalRank.F, false),
        ItemFactory.createItem(UniversalRank.E, false),
        ItemFactory.createItem(UniversalRank.D, false) // Rare drop
    ];
    get().openLootContainer('debug_drop', drops);
  },

  movePlayer: (direction) => {
    const MOVEMENT_SPEED = 5.0; // Faster for global coords
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
          const updatedInventory = state.player.currentSession.inventory.map(item => 
              item.id === itemId ? { ...item, isIdentified: true } : item
          );
          return { player: { ...state.player, currentSession: { ...state.player.currentSession, inventory: updatedInventory } } };
      });
  },

  // --- NEW: LOOTING LOGIC ---

  openLootContainer: (id, items) => {
      set({ lootContainer: items, lootContainerId: id });
  },

  closeLootContainer: () => {
      set({ lootContainer: null, lootContainerId: null });
  },

  transferItem: (itemId, from, to) => {
      set((state) => {
          const session = state.player.currentSession;
          if (!session) return state; // Should ideally check if session exists or just use bank if not

          // Helper to get array reference - careful with mutation in zustand without immer
          // We will clone arrays to be safe
          let sourceList = from === 'INVENTORY' ? [...session.inventory] : [...(state.lootContainer || [])];
          let targetList = to === 'INVENTORY' ? [...session.inventory] : [...(state.lootContainer || [])];

          const itemIndex = sourceList.findIndex(i => i.id === itemId);
          if (itemIndex === -1) return state;

          const [item] = sourceList.splice(itemIndex, 1);
          targetList.push(item);

          // Reconstruct State
          // If moving INVENTORY -> CONTAINER
          if (from === 'INVENTORY') {
              return {
                  player: { 
                      ...state.player, 
                      currentSession: { ...session, inventory: sourceList } 
                  },
                  lootContainer: targetList
              };
          } 
          // If moving CONTAINER -> INVENTORY
          else {
              return {
                  player: { 
                      ...state.player, 
                      currentSession: { ...session, inventory: targetList } 
                  },
                  lootContainer: sourceList
              };
          }
      });
  },

  trashItem: (itemId, source) => {
      // "Trash" mechanism - permanent destruction
      set((state) => {
          const session = state.player.currentSession;
          if (!session) return state;

          if (source === 'INVENTORY') {
              return {
                  player: {
                      ...state.player,
                      currentSession: {
                          ...session,
                          inventory: session.inventory.filter(i => i.id !== itemId)
                      }
                  }
              };
          } else {
              return {
                  lootContainer: (state.lootContainer || []).filter(i => i.id !== itemId)
              };
          }
      });
  },

  studyItem: (itemId) => {
      // Destroys item for Lore XP
      // 1. Find Item
      const state = get();
      const session = state.player.currentSession;
      if (!session) return;
      
      const item = session.inventory.find(i => i.id === itemId);
      if (!item) return;

      // 2. Calculate XP (Higher Rank = More XP)
      // Simple simulation of LoreManager
      console.log(`[LORE] Sacrificed ${item.name} for Science.`);
      
      // 3. Destroy Item
      get().trashItem(itemId, 'INVENTORY');
  }
}));
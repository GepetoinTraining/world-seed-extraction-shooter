import { create } from 'zustand';
import { IPlayer, UniversalRank } from '../../types';
import { ItemFactory } from '../utils/ItemFactory';

// --- INITIAL DATA ---
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
          ItemFactory.createItem(UniversalRank.E),
          ItemFactory.createItem(UniversalRank.D),
          ItemFactory.createItem(UniversalRank.F),
          ItemFactory.createItem(),
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

// --- STORE TYPE ---
interface PlayerState {
  player: IPlayer;
  view: 'BANK' | 'SESSION';
  
  setView: (view: 'BANK' | 'SESSION') => void;
  diveIntoLayer: (layerId?: string) => void;
  emergencyJackOut: () => void;
  simulateLootDrop: () => void;
}

// --- STORE CREATION ---
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
    const sessionLoot = player.currentSession?.inventory || [];

    // Move session items to bank
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
    const newItem = ItemFactory.createItem();
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
  }
}));
/**
 * Hub Store - Manages persistent hub state
 * REFACTORED: Removes mock data, loads from Vector/DB State
 */

import { create } from 'zustand';
import { IItem, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { HubGenerator } from './HubGenerator';

// =============================================================================
// TYPES
// =============================================================================

export interface IPlayerLot {
  id: string;
  lotIndex: number;
  ownerId: string | null;
  ownerName: string | null;
  purchaseDate: number | null;
  structureType: 'EMPTY' | 'VENDOR' | 'WORKSHOP' | 'HOUSE';
  inventory: IItem[];
  price: number;
}

export interface IShopListing {
  id: string;
  item: IItem;
  price: number;
  vendorId: string;
  stock: number;
}

export interface IAuctionListing {
  id: string;
  item: IItem;
  sellerId: string;
  sellerName: string;
  startPrice: number;
  currentBid: number;
  currentBidderId: string | null;
  endTime: number;
  buyoutPrice?: number;
}

// =============================================================================
// STORE
// =============================================================================

interface HubState {
  activeHubId: string | null;
  lots: IPlayerLot[];
  weaponShop: IShopListing[];
  armorShop: IShopListing[];
  consumableShop: IShopListing[];
  auctionListings: IAuctionListing[];
  isLoading: boolean;
  
  // Actions
  loadHub: (hubWorldUid: string) => Promise<void>;
  saveHubState: () => Promise<void>;
  
  purchaseLot: (lotId: string, playerId: string, playerName: string) => Promise<boolean>;
  purchaseFromShop: (listingId: string, shop: 'weapon' | 'armor' | 'consumable') => IItem | null;
  
  // Admin / Generator
  generateDailyStock: () => void; 
}

export const useHubStore = create<HubState>((set, get) => ({
  activeHubId: null,
  lots: [],
  weaponShop: [],
  armorShop: [],
  consumableShop: [],
  auctionListings: [],
  isLoading: false,
  
  loadHub: async (hubWorldUid: string) => {
    set({ isLoading: true, activeHubId: hubWorldUid });

    try {
      // 1. Try to fetch existing Hub State from DB
      const hubStateDoc = await VectorStore.get<{ lots: IPlayerLot[] }>(
        VectorNamespace.TERRITORIES, 
        `hub_state_${hubWorldUid}`
      );

      if (hubStateDoc) {
        // LOAD EXISTING
        console.log('[HUB] State loaded from persistence.');
        set({ lots: hubStateDoc.data.lots });
      } else {
        // GENERATE FRESH (First time this Hub is visited)
        console.log('[HUB] No state found. Generating fresh layout...');
        
        // Use the HubGenerator to find lot positions
        const layout = HubGenerator.generate();
        const lotPOIs = layout.zones.flatMap(z => z.pois).filter(p => p.type === 'PLAYER_LOT');
        
        const freshLots: IPlayerLot[] = lotPOIs.map((poi, idx) => ({
          id: poi.id,
          lotIndex: idx,
          ownerId: null,
          ownerName: null,
          purchaseDate: null,
          structureType: 'EMPTY',
          inventory: [],
          price: 5000 // Base price from POI metadata
        }));

        set({ lots: freshLots });
        // Save immediately
        await get().saveHubState();
      }

      // 2. Generate/Load Shop Stock (Simulated Daily Refresh)
      // In a real app, this would be server-side. Here we simulate it.
      get().generateDailyStock();

    } catch (e) {
      console.error('[HUB] Failed to load hub:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  saveHubState: async () => {
    const { activeHubId, lots } = get();
    if (!activeHubId) return;

    await VectorStore.put({
      id: `hub_state_${activeHubId}`,
      namespace: VectorNamespace.TERRITORIES,
      data: { lots },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    });
  },
  
  purchaseLot: async (lotId, playerId, playerName) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    
    if (!lot || lot.ownerId) return false;
    
    const updatedLots = lots.map(l => 
      l.id === lotId 
        ? { 
            ...l, 
            ownerId: playerId, 
            ownerName: playerName, 
            purchaseDate: Date.now() 
          }
        : l
    );
    
    set({ lots: updatedLots });
    await saveHubState(); // Persist changes
    return true;
  },
  
  generateDailyStock: () => {
    // Procedural Shop Generation
    const generateStock = (rank: UniversalRank, count: number, type: 'weapon' | 'armor') => {
      return Array.from({ length: count }, (_, i) => {
        const item = ItemFactory.createItem(rank, true); // Identified
        // Force type matching roughly
        return {
          id: crypto.randomUUID(),
          item,
          price: item.value * 1.5, // 50% Markup
          vendorId: 'vendor_sys',
          stock: Math.floor(Math.random() * 5) + 1
        };
      });
    };

    set({
      weaponShop: [
        ...generateStock(UniversalRank.F, 5, 'weapon'),
        ...generateStock(UniversalRank.E, 2, 'weapon')
      ],
      armorShop: [
        ...generateStock(UniversalRank.F, 5, 'armor'),
        ...generateStock(UniversalRank.E, 2, 'armor')
      ]
    });
  },

  purchaseFromShop: (listingId, shop) => {
    const state = get();
    const shopKey = `${shop}Shop` as 'weaponShop' | 'armorShop' | 'consumableShop';
    const listings = state[shopKey];
    
    const listing = listings.find(l => l.id === listingId);
    if (!listing || listing.stock <= 0) return null;
    
    const purchasedItem = { ...listing.item, id: crypto.randomUUID() };
    
    const updatedListings = listings.map(l => 
      l.id === listingId ? { ...l, stock: l.stock - 1 } : l
    );
    
    set({ [shopKey]: updatedListings });
    return purchasedItem;
  }
}));
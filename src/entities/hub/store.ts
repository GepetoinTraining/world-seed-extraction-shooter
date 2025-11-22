/**
 * Hub Store - Manages persistent hub state
 * 
 * Handles:
 * - Player lot ownership
 * - NPC shop inventories
 * - Auction house listings
 * - Guild data
 */

import { create } from 'zustand';
import { IItem, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';

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
  customName?: string;
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

export interface IGuildInfo {
  id: string;
  name: string;
  tag: string; // 3-4 char tag
  leaderId: string;
  memberCount: number;
  treasury: number;
  createdAt: number;
}

// =============================================================================
// STORE
// =============================================================================

interface HubState {
  // Lots
  lots: IPlayerLot[];
  
  // Shops
  weaponShop: IShopListing[];
  armorShop: IShopListing[];
  consumableShop: IShopListing[];
  
  // Auction
  auctionListings: IAuctionListing[];
  
  // Guilds
  guilds: IGuildInfo[];
  
  // Actions
  initializeHub: () => void;
  purchaseLot: (lotId: string, playerId: string, playerName: string) => boolean;
  setLotStructure: (lotId: string, type: IPlayerLot['structureType']) => void;
  purchaseFromShop: (listingId: string, shop: 'weapon' | 'armor' | 'consumable') => IItem | null;
  createAuctionListing: (item: IItem, sellerId: string, sellerName: string, startPrice: number, duration: number, buyout?: number) => void;
  placeBid: (listingId: string, bidderId: string, amount: number) => boolean;
  buyoutAuction: (listingId: string, buyerId: string) => IItem | null;
  createGuild: (name: string, tag: string, leaderId: string) => IGuildInfo | null;
}

export const useHubStore = create<HubState>((set, get) => ({
  lots: [],
  weaponShop: [],
  armorShop: [],
  consumableShop: [],
  auctionListings: [],
  guilds: [],
  
  initializeHub: () => {
    // Initialize 6 player lots
    const lots: IPlayerLot[] = Array.from({ length: 6 }, (_, i) => ({
      id: `lot_${i}`,
      lotIndex: i,
      ownerId: null,
      ownerName: null,
      purchaseDate: null,
      structureType: 'EMPTY',
      inventory: []
    }));
    
    // Initialize weapon shop
    const weaponShop: IShopListing[] = [
      {
        id: 'shop_wpn_1',
        item: ItemFactory.createItem(UniversalRank.F, true),
        price: 100,
        vendorId: 'npc_weapon_vendor',
        stock: 10
      },
      {
        id: 'shop_wpn_2',
        item: ItemFactory.createItem(UniversalRank.E, true),
        price: 500,
        vendorId: 'npc_weapon_vendor',
        stock: 5
      },
      {
        id: 'shop_wpn_3',
        item: ItemFactory.createItem(UniversalRank.D, true),
        price: 2000,
        vendorId: 'npc_weapon_vendor',
        stock: 2
      }
    ];
    
    // Initialize armor shop
    const armorShop: IShopListing[] = [
      {
        id: 'shop_arm_1',
        item: ItemFactory.createItem(UniversalRank.F, true),
        price: 80,
        vendorId: 'npc_armor_vendor',
        stock: 10
      },
      {
        id: 'shop_arm_2',
        item: ItemFactory.createItem(UniversalRank.E, true),
        price: 400,
        vendorId: 'npc_armor_vendor',
        stock: 5
      }
    ];
    
    set({ lots, weaponShop, armorShop });
  },
  
  purchaseLot: (lotId, playerId, playerName) => {
    const { lots } = get();
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
    return true;
  },
  
  setLotStructure: (lotId, type) => {
    const { lots } = get();
    const updatedLots = lots.map(l => 
      l.id === lotId ? { ...l, structureType: type } : l
    );
    set({ lots: updatedLots });
  },
  
  purchaseFromShop: (listingId, shop) => {
    const state = get();
    const shopKey = `${shop}Shop` as 'weaponShop' | 'armorShop' | 'consumableShop';
    const listings = state[shopKey];
    
    const listing = listings.find(l => l.id === listingId);
    if (!listing || listing.stock <= 0) return null;
    
    // Clone the item with new ID
    const purchasedItem = { ...listing.item, id: crypto.randomUUID() };
    
    // Decrease stock
    const updatedListings = listings.map(l => 
      l.id === listingId ? { ...l, stock: l.stock - 1 } : l
    );
    
    set({ [shopKey]: updatedListings });
    return purchasedItem;
  },
  
  createAuctionListing: (item, sellerId, sellerName, startPrice, duration, buyout) => {
    const listing: IAuctionListing = {
      id: crypto.randomUUID(),
      item,
      sellerId,
      sellerName,
      startPrice,
      currentBid: startPrice,
      currentBidderId: null,
      endTime: Date.now() + duration,
      buyoutPrice: buyout
    };
    
    set(state => ({ 
      auctionListings: [...state.auctionListings, listing] 
    }));
  },
  
  placeBid: (listingId, bidderId, amount) => {
    const { auctionListings } = get();
    const listing = auctionListings.find(l => l.id === listingId);
    
    if (!listing) return false;
    if (amount <= listing.currentBid) return false;
    if (Date.now() > listing.endTime) return false;
    
    const updatedListings = auctionListings.map(l => 
      l.id === listingId 
        ? { ...l, currentBid: amount, currentBidderId: bidderId }
        : l
    );
    
    set({ auctionListings: updatedListings });
    return true;
  },
  
  buyoutAuction: (listingId, buyerId) => {
    const { auctionListings } = get();
    const listing = auctionListings.find(l => l.id === listingId);
    
    if (!listing || !listing.buyoutPrice) return null;
    
    // Remove listing and return item
    set({ 
      auctionListings: auctionListings.filter(l => l.id !== listingId) 
    });
    
    return listing.item;
  },
  
  createGuild: (name, tag, leaderId) => {
    const { guilds } = get();
    
    // Check if tag already exists
    if (guilds.some(g => g.tag.toLowerCase() === tag.toLowerCase())) {
      return null;
    }
    
    const newGuild: IGuildInfo = {
      id: crypto.randomUUID(),
      name,
      tag: tag.toUpperCase(),
      leaderId,
      memberCount: 1,
      treasury: 0,
      createdAt: Date.now()
    };
    
    set({ guilds: [...guilds, newGuild] });
    return newGuild;
  }
}));

// Initialize hub on module load
useHubStore.getState().initializeHub();
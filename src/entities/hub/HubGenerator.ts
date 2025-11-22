/**
 * HubGenerator - Creates a static, persistent city layout
 * Unlike WorldGenerator (procedural extraction zones), the Hub is FIXED.
 * Think Carleon from Albion, or Stormwind from WoW.
 */

import { UniversalRank, Rarity } from '../../../types';

// =============================================================================
// HUB TYPES
// =============================================================================

export enum POIType {
  // Core Services
  BANK = 'BANK',
  PORTAL = 'PORTAL',
  IDENTIFIER = 'IDENTIFIER',
  GUILD_HALL = 'GUILD_HALL',
  
  // Commerce
  VENDOR_WEAPONS = 'VENDOR_WEAPONS',
  VENDOR_ARMOR = 'VENDOR_ARMOR',
  VENDOR_CONSUMABLES = 'VENDOR_CONSUMABLES',
  AUCTION_HOUSE = 'AUCTION_HOUSE',
  
  // Social
  TAVERN = 'TAVERN',
  ARENA = 'ARENA',
  
  // Player-Owned
  PLAYER_LOT = 'PLAYER_LOT',
  
  // Decorative
  FOUNTAIN = 'FOUNTAIN',
  STATUE = 'STATUE',
  LAMP_POST = 'LAMP_POST'
}

export enum ZoneType {
  PLAZA = 'PLAZA',
  MARKET = 'MARKET',
  RESIDENTIAL = 'RESIDENTIAL',
  INDUSTRIAL = 'INDUSTRIAL',
  GARDEN = 'GARDEN'
}

export interface IPOI {
  id: string;
  type: POIType;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  interactable: boolean;
  npcId?: string;
  ownerId?: string; // For player lots
  metadata: Record<string, any>;
}

export interface IHubZone {
  id: string;
  name: string;
  type: ZoneType;
  bounds: { x: number; y: number; width: number; height: number };
  pois: IPOI[];
  ambientColor: string;
  floorTexture: string;
}

export interface IHubLayout {
  id: string;
  name: string;
  version: string;
  width: number;
  height: number;
  zones: IHubZone[];
  spawnPoint: { x: number; y: number };
  navMesh: boolean[][]; // true = walkable
}

// =============================================================================
// NPC DEFINITIONS
// =============================================================================

export interface INPCDefinition {
  id: string;
  name: string;
  title: string;
  dialogue: {
    greeting: string;
    options: { label: string; action: string; payload?: any }[];
  };
  spriteColor: string;
}

export const HUB_NPCS: Record<string, INPCDefinition> = {
  'npc_banker': {
    id: 'npc_banker',
    name: 'Marcus Goldweave',
    title: 'Vault Keeper',
    dialogue: {
      greeting: "Your assets are secure with the Consortium. What do you need?",
      options: [
        { label: 'Access Stash', action: 'OPEN_BANK' },
        { label: 'Check Balance', action: 'SHOW_BALANCE' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#ffd700'
  },
  'npc_identifier': {
    id: 'npc_identifier',
    name: 'Sera Truthsight',
    title: 'Artifact Analyst',
    dialogue: {
      greeting: "Bring me your mysteries. I see what others cannot.",
      options: [
        { label: 'Identify Item (100g)', action: 'IDENTIFY_ITEM', payload: { cost: 100 } },
        { label: 'Bulk Identify (500g)', action: 'IDENTIFY_ALL', payload: { cost: 500 } },
        { label: 'Study Lore', action: 'OPEN_LORE' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#a855f7'
  },
  'npc_portal_master': {
    id: 'npc_portal_master',
    name: 'The Conduit',
    title: 'Reality Navigator',
    dialogue: {
      greeting: "The threads of reality await. Where shall I send you?",
      options: [
        { label: 'View Extraction Zones', action: 'OPEN_MISSIONS' },
        { label: 'Quick Deploy', action: 'QUICK_DEPLOY' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#06b6d4'
  },
  'npc_weapon_vendor': {
    id: 'npc_weapon_vendor',
    name: 'Bjorn Ironfist',
    title: 'Arms Dealer',
    dialogue: {
      greeting: "Need something that hits hard? You've come to the right place.",
      options: [
        { label: 'Browse Weapons', action: 'OPEN_SHOP', payload: { category: 'weapons' } },
        { label: 'Sell Items', action: 'OPEN_SELL' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#ef4444'
  },
  'npc_armor_vendor': {
    id: 'npc_armor_vendor',
    name: 'Talia Steelweave',
    title: 'Protection Specialist',
    dialogue: {
      greeting: "Defense is the best offense... or something like that.",
      options: [
        { label: 'Browse Armor', action: 'OPEN_SHOP', payload: { category: 'armor' } },
        { label: 'Repair Gear', action: 'OPEN_REPAIR' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#3b82f6'
  },
  'npc_guild_master': {
    id: 'npc_guild_master',
    name: 'Grand Marshal Vex',
    title: 'Guild Registrar',
    dialogue: {
      greeting: "Strength in numbers. What brings you to the Hall?",
      options: [
        { label: 'View My Guild', action: 'OPEN_GUILD' },
        { label: 'Create Guild (10,000g)', action: 'CREATE_GUILD', payload: { cost: 10000 } },
        { label: 'Guild Listings', action: 'BROWSE_GUILDS' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#f59e0b'
  },
  'npc_auctioneer': {
    id: 'npc_auctioneer',
    name: 'Quickfingers',
    title: 'Market Overseer',
    dialogue: {
      greeting: "Buy low, sell high! The market never sleeps.",
      options: [
        { label: 'Browse Listings', action: 'OPEN_AUCTION' },
        { label: 'My Listings', action: 'MY_AUCTIONS' },
        { label: 'Sell Item', action: 'CREATE_LISTING' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#22c55e'
  },
  'npc_bartender': {
    id: 'npc_bartender',
    name: 'Old Mags',
    title: 'The Rusty Anchor',
    dialogue: {
      greeting: "What'll it be? We got drinks and rumors, both equally watered down.",
      options: [
        { label: 'Buy Drink (10g)', action: 'BUY_CONSUMABLE', payload: { itemId: 'drink_ale', cost: 10 } },
        { label: 'Hear Rumors', action: 'GET_HINT' },
        { label: 'Rest (Restore HP)', action: 'REST' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#78716c'
  }
};

// =============================================================================
// THE GENERATOR
// =============================================================================

export class HubGenerator {
  
  /**
   * Generates the canonical Hub layout.
   * This is deterministic - always produces the same city.
   */
  static generate(): IHubLayout {
    const width = 50;  // 50x50 tile grid
    const height = 50;
    
    // Initialize walkable navmesh (true = can walk)
    const navMesh: boolean[][] = Array(height).fill(null).map(() => 
      Array(width).fill(true)
    );
    
    const zones: IHubZone[] = [];
    
    // =========================================================================
    // ZONE 1: CENTRAL PLAZA (The Heart)
    // =========================================================================
    const plaza: IHubZone = {
      id: 'zone_plaza',
      name: 'Central Plaza',
      type: ZoneType.PLAZA,
      bounds: { x: 15, y: 15, width: 20, height: 20 },
      ambientColor: '#1a1a2e',
      floorTexture: 'cobblestone',
      pois: [
        // Fountain (center)
        {
          id: 'poi_fountain',
          type: POIType.FOUNTAIN,
          name: 'Founders Fountain',
          position: { x: 25, y: 25 },
          size: { width: 4, height: 4 },
          interactable: false,
          metadata: { particles: 'water' }
        },
        // Bank (northwest)
        {
          id: 'poi_bank',
          type: POIType.BANK,
          name: 'Consortium Vault',
          position: { x: 17, y: 17 },
          size: { width: 4, height: 3 },
          interactable: true,
          npcId: 'npc_banker',
          metadata: {}
        },
        // Portal (north)
        {
          id: 'poi_portal',
          type: POIType.PORTAL,
          name: 'The Nexus',
          position: { x: 24, y: 16 },
          size: { width: 3, height: 3 },
          interactable: true,
          npcId: 'npc_portal_master',
          metadata: { glowColor: '#06b6d4' }
        },
        // Identifier (northeast)
        {
          id: 'poi_identifier',
          type: POIType.IDENTIFIER,
          name: 'Truthsight Tower',
          position: { x: 30, y: 17 },
          size: { width: 3, height: 3 },
          interactable: true,
          npcId: 'npc_identifier',
          metadata: {}
        },
        // Guild Hall (east)
        {
          id: 'poi_guild',
          type: POIType.GUILD_HALL,
          name: 'Hall of Banners',
          position: { x: 32, y: 24 },
          size: { width: 4, height: 4 },
          interactable: true,
          npcId: 'npc_guild_master',
          metadata: {}
        }
      ]
    };
    zones.push(plaza);
    
    // =========================================================================
    // ZONE 2: MARKET DISTRICT (South)
    // =========================================================================
    const market: IHubZone = {
      id: 'zone_market',
      name: 'Market District',
      type: ZoneType.MARKET,
      bounds: { x: 10, y: 35, width: 30, height: 12 },
      ambientColor: '#2d1b1b',
      floorTexture: 'wooden_planks',
      pois: [
        // Weapon Vendor
        {
          id: 'poi_weapons',
          type: POIType.VENDOR_WEAPONS,
          name: "Ironfist Armory",
          position: { x: 14, y: 38 },
          size: { width: 4, height: 3 },
          interactable: true,
          npcId: 'npc_weapon_vendor',
          metadata: {}
        },
        // Armor Vendor
        {
          id: 'poi_armor',
          type: POIType.VENDOR_ARMOR,
          name: "Steelweave Outfitters",
          position: { x: 20, y: 38 },
          size: { width: 4, height: 3 },
          interactable: true,
          npcId: 'npc_armor_vendor',
          metadata: {}
        },
        // Consumables Vendor
        {
          id: 'poi_consumables',
          type: POIType.VENDOR_CONSUMABLES,
          name: "Alchemist's Corner",
          position: { x: 26, y: 38 },
          size: { width: 3, height: 3 },
          interactable: true,
          metadata: {}
        },
        // Auction House
        {
          id: 'poi_auction',
          type: POIType.AUCTION_HOUSE,
          name: 'The Exchange',
          position: { x: 32, y: 38 },
          size: { width: 5, height: 4 },
          interactable: true,
          npcId: 'npc_auctioneer',
          metadata: {}
        }
      ]
    };
    zones.push(market);
    
    // =========================================================================
    // ZONE 3: TAVERN DISTRICT (West)
    // =========================================================================
    const tavern: IHubZone = {
      id: 'zone_tavern',
      name: 'The Rusty Anchor',
      type: ZoneType.GARDEN, // Outdoor seating vibe
      bounds: { x: 5, y: 20, width: 10, height: 10 },
      ambientColor: '#1f2937',
      floorTexture: 'dirt',
      pois: [
        {
          id: 'poi_tavern',
          type: POIType.TAVERN,
          name: 'The Rusty Anchor',
          position: { x: 8, y: 23 },
          size: { width: 5, height: 4 },
          interactable: true,
          npcId: 'npc_bartender',
          metadata: {}
        }
      ]
    };
    zones.push(tavern);
    
    // =========================================================================
    // ZONE 4: RESIDENTIAL (East) - Player Lots
    // =========================================================================
    const residential: IHubZone = {
      id: 'zone_residential',
      name: 'Homestead Row',
      type: ZoneType.RESIDENTIAL,
      bounds: { x: 38, y: 15, width: 10, height: 30 },
      ambientColor: '#1a1a1a',
      floorTexture: 'grass',
      pois: []
    };
    
    // Generate 6 player lots
    for (let i = 0; i < 6; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      residential.pois.push({
        id: `poi_lot_${i}`,
        type: POIType.PLAYER_LOT,
        name: `Lot #${i + 1}`,
        position: { x: 40 + (col * 5), y: 18 + (row * 8) },
        size: { width: 4, height: 4 },
        interactable: true,
        ownerId: undefined, // Unclaimed
        metadata: { lotIndex: i, price: 5000 }
      });
    }
    zones.push(residential);
    
    // =========================================================================
    // BUILD NAVMESH (Mark buildings as non-walkable)
    // =========================================================================
    zones.forEach(zone => {
      zone.pois.forEach(poi => {
        // Buildings block movement
        if ([POIType.BANK, POIType.GUILD_HALL, POIType.AUCTION_HOUSE, 
             POIType.VENDOR_WEAPONS, POIType.VENDOR_ARMOR, POIType.VENDOR_CONSUMABLES,
             POIType.TAVERN, POIType.IDENTIFIER, POIType.FOUNTAIN].includes(poi.type)) {
          for (let dy = 0; dy < poi.size.height; dy++) {
            for (let dx = 0; dx < poi.size.width; dx++) {
              const nx = poi.position.x + dx;
              const ny = poi.position.y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                navMesh[ny][nx] = false;
              }
            }
          }
        }
      });
    });
    
    // Add some decorative lamp posts
    const lampPositions = [
      { x: 20, y: 20 }, { x: 30, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 30 },
      { x: 15, y: 40 }, { x: 25, y: 40 }, { x: 35, y: 40 }
    ];
    lampPositions.forEach((pos, i) => {
      plaza.pois.push({
        id: `poi_lamp_${i}`,
        type: POIType.LAMP_POST,
        name: 'Street Lamp',
        position: pos,
        size: { width: 1, height: 1 },
        interactable: false,
        metadata: { lightRadius: 3 }
      });
      navMesh[pos.y][pos.x] = false;
    });
    
    return {
      id: 'hub_carleon',
      name: 'New Carleon',
      version: '1.0.0',
      width,
      height,
      zones,
      spawnPoint: { x: 25, y: 28 }, // South of fountain
      navMesh
    };
  }
  
  /**
   * Find a POI by ID across all zones
   */
  static findPOI(layout: IHubLayout, poiId: string): IPOI | null {
    for (const zone of layout.zones) {
      const poi = zone.pois.find(p => p.id === poiId);
      if (poi) return poi;
    }
    return null;
  }
  
  /**
   * Find POI at a given position
   */
  static getPOIAtPosition(layout: IHubLayout, x: number, y: number): IPOI | null {
    for (const zone of layout.zones) {
      for (const poi of zone.pois) {
        if (x >= poi.position.x && x < poi.position.x + poi.size.width &&
            y >= poi.position.y && y < poi.position.y + poi.size.height) {
          return poi;
        }
      }
    }
    return null;
  }
  
  /**
   * Get zone at position
   */
  static getZoneAtPosition(layout: IHubLayout, x: number, y: number): IHubZone | null {
    for (const zone of layout.zones) {
      if (x >= zone.bounds.x && x < zone.bounds.x + zone.bounds.width &&
          y >= zone.bounds.y && y < zone.bounds.y + zone.bounds.height) {
        return zone;
      }
    }
    return null;
  }
}
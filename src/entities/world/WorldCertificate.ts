/**
 * WORLD CERTIFICATE SYSTEM
 * Sovereign ownership of World Seeds
 * 
 * A World Certificate is:
 * - Created by a player (using their identity certificate)
 * - Cryptographically signed (proves creator ownership)
 * - Transferable (can be sold/gifted)
 * - Revenue-generating (creator earns from player activity)
 * 
 * This turns World Seeds into ASSETS.
 */

import { CertificateSystem, IPlayerCertificate, ISignedPayload } from '../identity/CertificateSystem';
import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { UniversalRank } from '../../../types';

// ============================================================================
// TYPES
// ============================================================================

export enum WorldType {
  EXTRACTION = 'EXTRACTION',     // Combat, loot, timer-based
  HUB = 'HUB',                   // Social, trading, persistent
  RAID = 'RAID',                 // Large-scale PvE
  ARENA = 'ARENA',               // PvP focused
  SANDBOX = 'SANDBOX'            // Creative, no rules
}

export enum AccessMode {
  PUBLIC = 'PUBLIC',             // Anyone can enter
  WHITELIST = 'WHITELIST',       // Only approved certificates
  TICKET = 'TICKET',             // Requires a ticket item
  GUILD = 'GUILD'                // Only guild members
}

export interface IWorldRules {
  // Access
  accessMode: AccessMode;
  whitelistedCertUids?: string[];
  requiredTicketItemId?: string;
  requiredGuildId?: string;
  
  // Power Scaling
  ipCap?: UniversalRank;          // Max item power allowed
  ipFloor?: UniversalRank;        // Min item power required
  levelScaling: boolean;          // Normalize player levels?
  
  // Economy
  entryFeeGold: number;           // Cost to enter
  extractionTaxRate: number;      // % of loot value taken on extract (0-0.30)
  creatorRevenueShare: number;    // % of all gold to creator (0-0.10)
  
  // Gameplay
  pvpEnabled: boolean;
  friendlyFireEnabled: boolean;
  deathPenalty: 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH';
  respawnEnabled: boolean;
  
  // Time
  sessionDurationMinutes?: number; // null = unlimited
  worldLifespanHours?: number;     // null = permanent
  
  // Content
  genreId?: string;               // Which generated genre to use
  difficulty: UniversalRank;       // Base difficulty
  mobDensityMultiplier: number;   // 0.5 - 2.0
  lootMultiplier: number;         // 0.5 - 2.0
}

export interface IWorldCertificateData {
  // Identity
  worldUid: string;               // Unique world ID
  worldName: string;
  worldDescription: string;
  worldType: WorldType;
  
  // Ownership
  creatorCertUid: string;         // Who made this
  currentOwnerCertUid: string;    // Who owns it now (can differ after sale)
  createdAt: number;
  
  // Content
  seedHash: string;               // Procedural generation seed
  size: number;                   // Grid size (16, 32, 64, 128)
  rules: IWorldRules;
  
  // Stats (updated over time)
  stats: {
    totalVisitors: number;
    totalExtractions: number;
    totalGoldGenerated: number;
    totalDeaths: number;
    averageSessionMinutes: number;
    rating: number;               // 0-5 stars from players
    ratingCount: number;
  };
  
  // Metadata
  version: number;
  lastModified: number;
}

export interface IWorldCertificate {
  data: IWorldCertificateData;
  creatorSignature: string;       // Signed by creator at creation
  ownerSignature: string;         // Signed by current owner
  certificatePEM: string;         // The full certificate
}

// ============================================================================
// WORLD CERTIFICATE SYSTEM
// ============================================================================

export class WorldCertificateSystem {
  
  /**
   * Mint a new World Certificate
   * Creates a sovereign, tradeable world asset
   */
  static async mintWorld(
    creatorCertificate: IPlayerCertificate,
    worldName: string,
    worldDescription: string,
    worldType: WorldType,
    size: number,
    rules: Partial<IWorldRules>
  ): Promise<IWorldCertificate | null> {
    
    const creatorUid = creatorCertificate.metadata.uid;
    const timestamp = Date.now();
    
    // Generate world UID
    const worldUid = await this.generateWorldUid(creatorUid, worldName, timestamp);
    
    // Generate seed hash for procedural content
    const seedHash = await this.generateSeedHash(worldUid, timestamp);
    
    // Merge rules with defaults
    const fullRules: IWorldRules = {
      accessMode: AccessMode.PUBLIC,
      ipCap: undefined,
      ipFloor: undefined,
      levelScaling: false,
      entryFeeGold: 0,
      extractionTaxRate: 0.05,
      creatorRevenueShare: 0.03,
      pvpEnabled: worldType === WorldType.ARENA,
      friendlyFireEnabled: false,
      deathPenalty: 'INVENTORY_LOSS',
      respawnEnabled: worldType !== WorldType.EXTRACTION,
      sessionDurationMinutes: worldType === WorldType.EXTRACTION ? 15 : undefined,
      worldLifespanHours: worldType === WorldType.EXTRACTION ? 4 : undefined,
      difficulty: UniversalRank.D,
      mobDensityMultiplier: 1.0,
      lootMultiplier: 1.0,
      ...rules
    };

    // Validate rules
    if (fullRules.extractionTaxRate > 0.30) {
      console.error('[WORLD] Extraction tax cannot exceed 30%');
      return null;
    }
    if (fullRules.creatorRevenueShare > 0.10) {
      console.error('[WORLD] Creator revenue share cannot exceed 10%');
      return null;
    }

    // Create certificate data
    const data: IWorldCertificateData = {
      worldUid,
      worldName,
      worldDescription,
      worldType,
      creatorCertUid: creatorUid,
      currentOwnerCertUid: creatorUid, // Creator starts as owner
      createdAt: timestamp,
      seedHash,
      size,
      rules: fullRules,
      stats: {
        totalVisitors: 0,
        totalExtractions: 0,
        totalGoldGenerated: 0,
        totalDeaths: 0,
        averageSessionMinutes: 0,
        rating: 0,
        ratingCount: 0
      },
      version: 1,
      lastModified: timestamp
    };

    // Sign with creator's key
    const signedData = await CertificateSystem.signPayload(creatorUid, data);
    if (!signedData) {
      console.error('[WORLD] Failed to sign world certificate');
      return null;
    }

    // Generate PEM certificate
    const certificatePEM = this.generateWorldCertPEM(data, signedData.signature);

    const worldCert: IWorldCertificate = {
      data,
      creatorSignature: signedData.signature,
      ownerSignature: signedData.signature, // Same at creation
      certificatePEM
    };

    // Store in Vector DB
    await VectorStore.saveContent(
      worldUid,
      'world_certificate',
      worldCert,
      worldType
    );

    console.log(`[WORLD] Minted: "${worldName}" (${worldUid})`);
    return worldCert;
  }

  /**
   * Transfer world ownership to another player
   */
  static async transferOwnership(
    worldUid: string,
    currentOwnerCertUid: string,
    newOwnerCertUid: string,
    salePrice?: number // If sold, record the price
  ): Promise<boolean> {
    
    // Load world certificate
    const worlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const worldCert = worlds.find(w => w.data.worldUid === worldUid);
    
    if (!worldCert) {
      console.error('[WORLD] World not found');
      return false;
    }

    // Verify current owner
    if (worldCert.data.currentOwnerCertUid !== currentOwnerCertUid) {
      console.error('[WORLD] Not the current owner');
      return false;
    }

    // Update ownership
    worldCert.data.currentOwnerCertUid = newOwnerCertUid;
    worldCert.data.lastModified = Date.now();
    worldCert.data.version++;

    // New owner signs
    const newSignature = await CertificateSystem.signPayload(newOwnerCertUid, worldCert.data);
    if (!newSignature) {
      console.error('[WORLD] New owner signature failed');
      return false;
    }
    
    worldCert.ownerSignature = newSignature.signature;

    // Update PEM
    worldCert.certificatePEM = this.generateWorldCertPEM(worldCert.data, worldCert.creatorSignature);

    // Save
    await VectorStore.saveContent(
      worldUid,
      'world_certificate',
      worldCert,
      worldCert.data.worldType
    );

    // Log transaction
    console.log(`[WORLD] Transferred "${worldCert.data.worldName}" to ${newOwnerCertUid}${salePrice ? ` for ${salePrice} gold` : ''}`);
    
    return true;
  }

  /**
   * Update world rules (only owner can do this)
   */
  static async updateRules(
    worldUid: string,
    ownerCertUid: string,
    ruleUpdates: Partial<IWorldRules>
  ): Promise<boolean> {
    
    const worlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const worldCert = worlds.find(w => w.data.worldUid === worldUid);
    
    if (!worldCert) return false;
    if (worldCert.data.currentOwnerCertUid !== ownerCertUid) return false;

    // Apply updates
    worldCert.data.rules = { ...worldCert.data.rules, ...ruleUpdates };
    worldCert.data.lastModified = Date.now();
    worldCert.data.version++;

    // Re-sign
    const newSignature = await CertificateSystem.signPayload(ownerCertUid, worldCert.data);
    if (newSignature) {
      worldCert.ownerSignature = newSignature.signature;
    }

    await VectorStore.saveContent(worldUid, 'world_certificate', worldCert, worldCert.data.worldType);
    
    return true;
  }

  /**
   * Calculate revenue distribution for an extraction
   */
  static calculateRevenue(
    worldCert: IWorldCertificate,
    lootGoldValue: number
  ): {
    playerReceives: number;
    worldTreasury: number;
    creatorReceives: number;
  } {
    const { extractionTaxRate, creatorRevenueShare } = worldCert.data.rules;
    
    const worldTax = Math.floor(lootGoldValue * extractionTaxRate);
    const creatorCut = Math.floor(lootGoldValue * creatorRevenueShare);
    const playerReceives = lootGoldValue - worldTax - creatorCut;

    return {
      playerReceives,
      worldTreasury: worldTax,
      creatorReceives: creatorCut
    };
  }

  /**
   * Record world stats after a session
   */
  static async recordSession(
    worldUid: string,
    sessionData: {
      goldGenerated: number;
      playerDied: boolean;
      sessionMinutes: number;
      extracted: boolean;
    }
  ): Promise<void> {
    const worlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const worldCert = worlds.find(w => w.data.worldUid === worldUid);
    if (!worldCert) return;

    const stats = worldCert.data.stats;
    stats.totalVisitors++;
    stats.totalGoldGenerated += sessionData.goldGenerated;
    if (sessionData.playerDied) stats.totalDeaths++;
    if (sessionData.extracted) stats.totalExtractions++;
    
    // Rolling average for session time
    const totalMinutes = stats.averageSessionMinutes * (stats.totalVisitors - 1) + sessionData.sessionMinutes;
    stats.averageSessionMinutes = totalMinutes / stats.totalVisitors;

    await VectorStore.saveContent(worldUid, 'world_certificate', worldCert, worldCert.data.worldType);
  }

  /**
   * Rate a world (after extraction)
   */
  static async rateWorld(
    worldUid: string,
    rating: number // 1-5
  ): Promise<void> {
    if (rating < 1 || rating > 5) return;

    const worlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const worldCert = worlds.find(w => w.data.worldUid === worldUid);
    if (!worldCert) return;

    const stats = worldCert.data.stats;
    const totalRating = stats.rating * stats.ratingCount + rating;
    stats.ratingCount++;
    stats.rating = totalRating / stats.ratingCount;

    await VectorStore.saveContent(worldUid, 'world_certificate', worldCert, worldCert.data.worldType);
  }

  /**
   * Get worlds by creator
   */
  static async getWorldsByCreator(creatorCertUid: string): Promise<IWorldCertificate[]> {
    const allWorlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    return allWorlds.filter(w => w.data.creatorCertUid === creatorCertUid);
  }

  /**
   * Get worlds by current owner
   */
  static async getWorldsByOwner(ownerCertUid: string): Promise<IWorldCertificate[]> {
    const allWorlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    return allWorlds.filter(w => w.data.currentOwnerCertUid === ownerCertUid);
  }

  /**
   * Get all public worlds
   */
  static async getPublicWorlds(): Promise<IWorldCertificate[]> {
    const allWorlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    return allWorlds.filter(w => w.data.rules.accessMode === AccessMode.PUBLIC);
  }

  /**
   * Verify a world certificate is valid
   */
  static async verifyCertificate(
    worldCert: IWorldCertificate,
    creatorCertificate: IPlayerCertificate
  ): Promise<boolean> {
    // Verify creator signature
    const isValid = await CertificateSystem.verifyPayload(
      {
        payload: worldCert.data,
        signature: worldCert.creatorSignature,
        certUid: worldCert.data.creatorCertUid,
        timestamp: worldCert.data.createdAt
      },
      creatorCertificate
    );

    return isValid;
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private static async generateWorldUid(
    creatorUid: string,
    worldName: string,
    timestamp: number
  ): Promise<string> {
    const data = `${creatorUid}|${worldName}|${timestamp}|${Math.random()}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `world_${hashHex.slice(0, 16)}`;
  }

  private static async generateSeedHash(
    worldUid: string,
    timestamp: number
  ): Promise<string> {
    const data = `${worldUid}|${timestamp}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private static generateWorldCertPEM(
    data: IWorldCertificateData,
    creatorSignature: string
  ): string {
    const certObj = {
      version: 1,
      type: 'WORLD_SEED_CERTIFICATE',
      data,
      creatorSignature
    };
    
    return `-----BEGIN WORLDSEED WORLD CERTIFICATE-----\n${btoa(JSON.stringify(certObj))}\n-----END WORLDSEED WORLD CERTIFICATE-----`;
  }
}
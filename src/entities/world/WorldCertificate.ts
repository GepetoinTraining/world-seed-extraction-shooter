// FIXED: Lowercase 'certificateSystem'
import { CertificateSystem, IPlayerCertificate, ISignedPayload } from '../identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { UniversalRank } from '../../../types';

export enum WorldType {
  EXTRACTION = 'EXTRACTION',
  HUB = 'HUB',
  RAID = 'RAID',
  ARENA = 'ARENA',
  SANDBOX = 'SANDBOX'
}

export enum AccessMode {
  PUBLIC = 'PUBLIC',
  WHITELIST = 'WHITELIST',
  TICKET = 'TICKET',
  GUILD = 'GUILD'
}

export interface IWorldRules {
  accessMode: AccessMode;
  whitelistedCertUids?: string[];
  requiredTicketItemId?: string;
  requiredGuildId?: string;
  ipCap?: UniversalRank;
  ipFloor?: UniversalRank;
  levelScaling: boolean;
  entryFeeGold: number;
  extractionTaxRate: number;
  creatorRevenueShare: number;
  pvpEnabled: boolean;
  friendlyFireEnabled: boolean;
  deathPenalty: 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH';
  respawnEnabled: boolean;
  sessionDurationMinutes?: number;
  worldLifespanHours?: number;
  genreId?: string;
  difficulty: UniversalRank;
  mobDensityMultiplier: number;
  lootMultiplier: number;
}

export interface IWorldCertificateData {
  worldUid: string;
  worldName: string;
  worldDescription: string;
  worldType: WorldType;
  creatorCertUid: string;
  currentOwnerCertUid: string;
  createdAt: number;
  seedHash: string;
  size: number;
  rules: IWorldRules;
  stats: {
    totalVisitors: number;
    totalExtractions: number;
    totalGoldGenerated: number;
    totalDeaths: number;
    averageSessionMinutes: number;
    rating: number;
    ratingCount: number;
  };
  version: number;
  lastModified: number;
}

export interface IWorldCertificate {
  data: IWorldCertificateData;
  creatorSignature: string;
  ownerSignature: string;
  certificatePEM: string;
}

export class WorldCertificateSystem {
  
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
    const worldUid = await this.generateWorldUid(creatorUid, worldName, timestamp);
    const seedHash = await this.generateSeedHash(worldUid, timestamp);
    
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

    if (fullRules.extractionTaxRate > 0.30) {
      console.error('[WORLD] Extraction tax cannot exceed 30%');
      return null;
    }
    if (fullRules.creatorRevenueShare > 0.10) {
      console.error('[WORLD] Creator revenue share cannot exceed 10%');
      return null;
    }

    const data: IWorldCertificateData = {
      worldUid,
      worldName,
      worldDescription,
      worldType,
      creatorCertUid: creatorUid,
      currentOwnerCertUid: creatorUid,
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

    const signedData = await CertificateSystem.signPayload(creatorUid, data);
    if (!signedData) {
      console.error('[WORLD] Failed to sign world certificate');
      return null;
    }

    const certificatePEM = this.generateWorldCertPEM(data, signedData.signature);

    const worldCert: IWorldCertificate = {
      data,
      creatorSignature: signedData.signature,
      ownerSignature: signedData.signature,
      certificatePEM
    };

    await VectorStore.saveContent(
      worldUid,
      'world_certificate',
      worldCert,
      worldType
    );

    console.log(`[WORLD] Minted: "${worldName}" (${worldUid})`);
    return worldCert;
  }

  static async transferOwnership(
    worldUid: string,
    currentOwnerCertUid: string,
    newOwnerCertUid: string,
    salePrice?: number
  ): Promise<boolean> {
    
    const worlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const worldCert = worlds.find(w => w.data.worldUid === worldUid);
    
    if (!worldCert) return false;
    if (worldCert.data.currentOwnerCertUid !== currentOwnerCertUid) return false;

    worldCert.data.currentOwnerCertUid = newOwnerCertUid;
    worldCert.data.lastModified = Date.now();
    worldCert.data.version++;

    const newSignature = await CertificateSystem.signPayload(newOwnerCertUid, worldCert.data);
    if (!newSignature) return false;
    
    worldCert.ownerSignature = newSignature.signature;
    worldCert.certificatePEM = this.generateWorldCertPEM(worldCert.data, worldCert.creatorSignature);

    await VectorStore.saveContent(
      worldUid,
      'world_certificate',
      worldCert,
      worldCert.data.worldType
    );
    
    return true;
  }

  static async updateRules(
    worldUid: string,
    ownerCertUid: string,
    ruleUpdates: Partial<IWorldRules>
  ): Promise<boolean> {
    
    const worlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const worldCert = worlds.find(w => w.data.worldUid === worldUid);
    
    if (!worldCert) return false;
    if (worldCert.data.currentOwnerCertUid !== ownerCertUid) return false;

    worldCert.data.rules = { ...worldCert.data.rules, ...ruleUpdates };
    worldCert.data.lastModified = Date.now();
    worldCert.data.version++;

    const newSignature = await CertificateSystem.signPayload(ownerCertUid, worldCert.data);
    if (newSignature) {
      worldCert.ownerSignature = newSignature.signature;
    }

    await VectorStore.saveContent(worldUid, 'world_certificate', worldCert, worldCert.data.worldType);
    
    return true;
  }

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
    
    const totalMinutes = stats.averageSessionMinutes * (stats.totalVisitors - 1) + sessionData.sessionMinutes;
    stats.averageSessionMinutes = totalMinutes / stats.totalVisitors;

    await VectorStore.saveContent(worldUid, 'world_certificate', worldCert, worldCert.data.worldType);
  }

  static async rateWorld(
    worldUid: string,
    rating: number
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

  static async getPublicWorlds(): Promise<IWorldCertificate[]> {
    const allWorlds = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    return allWorlds.filter(w => w.data.rules.accessMode === AccessMode.PUBLIC);
  }

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
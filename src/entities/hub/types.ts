/**
 * HUB PROTOCOL
 * The breathing city that expands over time.
 */

import { UniversalRank } from '../../../types';

export interface IHubState {
  id: string;
  name: string;
  level: number; // Hub Tier
  
  // The Heartbeat
  cycleCount: number;          // Total cycles elapsed
  nextExpansionCycle: number;  // When the next chunk triggers (Target: Cycle 7, 14...)
  
  // Geography
  grid: Record<string, IHubChunk>; // "x,y" -> Chunk
}

export interface IHubChunk {
  x: number;
  y: number;
  districtType: 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL' | 'MILITARY';
  lots: string[]; // IDs of lots in this chunk
  unlockedAtCycle: number;
}

export interface ILot {
  id: string;
  hubId: string;
  chunkX: number;
  chunkY: number;
  
  // Ownership
  ownerId: string | null;      // Player Cert UID
  deedItemId: string | null;   // The item proving ownership
  
  // Physical Space
  dimensions: { x: number; z: number }; // e.g., 16x16 meters
  maxHeight: number;
  
  // State
  buildingId: string | null;
  constructionState?: {
    blueprintId: string;
    progress: number;          // 0-100%
    materialsDeposited: Record<string, number>; // slotName -> count
    assignedBuilderId: string | null;
  };
}
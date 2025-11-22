import { UniversalRank, GenreType } from '../../../types';

export enum MobSize {
  TINY = 'TINY',       
  MEDIUM = 'MEDIUM',   
  LARGE = 'LARGE',     
  GIGANTIC = 'GIGANTIC', 
  COLOSSAL = 'COLOSSAL'  
}

export enum MobBehavior {
  PASSIVE = 'PASSIVE',       
  NEUTRAL = 'NEUTRAL',       
  AGGRESSIVE = 'AGGRESSIVE', 
  SWARM = 'SWARM',           
  SIEGE = 'SIEGE',           
  TURRET = 'TURRET'          
}

export interface IMobDefinition {
  id: string;
  name: string;
  genre: GenreType; 
  tags: string[];   
  
  rank: UniversalRank;
  size: MobSize;
  behavior: MobBehavior;
  
  baseHealth: number;
  baseDamage: number;
  speed: number;     
  viewRange: number; 
  
  colorHex: string;
  symbol?: string; 
  
  // --- NEW ---
  generatedSprite?: string; // Base64 string cached here
}
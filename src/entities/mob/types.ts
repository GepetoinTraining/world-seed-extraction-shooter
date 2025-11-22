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

// --- ADDED: MUTATION GENOME FOR DIRECTOR ---
export enum MobMutation {
  ARMORED_SHELL = 'ARMORED_SHELL',
  ABLATIVE_COATING = 'ABLATIVE_COATING',
  ADRENAL_GLANDS = 'ADRENAL_GLANDS',
  HIVE_MIND = 'HIVE_MIND',
  EXPLOSIVE_DEATH = 'EXPLOSIVE_DEATH'
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
  
  generatedSprite?: string; 
}
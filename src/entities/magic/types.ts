import { BiomeType } from '../world/types';

export enum SpellScale {
  LOCAL = 'LOCAL',       
  TACTICAL = 'TACTICAL', 
  STRATEGIC = 'STRATEGIC' 
}

export enum ElementType {
  FIRE = 'FIRE',
  EARTH = 'EARTH',
  WATER = 'WATER',
  AIR = 'AIR',
  VOID = 'VOID',
  DATA = 'DATA' 
}

export interface ISpellCost {
  energy: number;
  materials?: string[]; 
  biomeRequirement?: BiomeType; 
  health?: number; 
  
  // --- ADDED: ADVANCED COSTS ---
  entropyGain?: number; // Risk of paradox
  loreRequirements?: { topic: string; level: number }[]; // Knowledge gate
}

export interface ISpellDefinition {
  id: string;
  name: string;
  description: string;
  
  scale: SpellScale;
  element: ElementType;
  
  cost: ISpellCost;
  cooldown: number;
  castTime: number; 
  
  payload: {
    damage?: number;
    range?: number;
    structureId?: string; 
    biomeShift?: BiomeType; 
    projectilePattern?: string;
    summonMobId?: string; // Added this as SpellEngine checks it
  };
  
  visuals: {
    color: string;
    icon: string;
  };
}
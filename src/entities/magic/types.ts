import { BiomeType } from '../world/types';

export enum SpellScale {
  LOCAL = 'LOCAL',       // Instant, Projectile-based (The "Bullet")
  TACTICAL = 'TACTICAL', // Structure-based, alters terrain (The "Wall")
  STRATEGIC = 'STRATEGIC' // World-based, alters biome/rules (The "Nuke")
}

export enum ElementType {
  FIRE = 'FIRE',
  EARTH = 'EARTH',
  WATER = 'WATER',
  AIR = 'AIR',
  VOID = 'VOID', // Sci-fi/Eldritch
  DATA = 'DATA'  // Cyberpunk
}

export interface ISpellCost {
  energy: number;
  materials?: string[]; // Item IDs required (e.g., "res_iron_ore")
  biomeRequirement?: BiomeType; // Must be standing on "INDUSTRIAL" to cast "Ferro-Kinesis"
  health?: number; // Blood Magic
}

export interface ISpellDefinition {
  id: string;
  name: string;
  description: string;
  
  scale: SpellScale;
  element: ElementType;
  
  cost: ISpellCost;
  cooldown: number;
  castTime: number; // 0 = Instant, 5s = Ritual
  
  // Payload (Interpreted by Engine based on Scale)
  payload: {
    damage?: number;
    range?: number;
    structureId?: string; // For TACTICAL (Spawns this structure)
    biomeShift?: BiomeType; // For STRATEGIC (Changes biome)
    projectilePattern?: string; // For LOCAL
  };
  
  visuals: {
    color: string;
    icon: string;
  };
}
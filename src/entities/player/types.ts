// ... existing imports ...

export interface IBaseAttributes {
  strength: number; constitution: number; agility: number; dexterity: number; endurance: number;
  intelligence: number; focus: number; engineering: number; hacking: number; perception: number;
  charisma: number; intimidation: number; subterfuge: number; bartering: number; leadership: number;
}

export interface ISkillOrigin {
  timestamp: number;
  triggerAction: string; 
  location: string;      
  resonance: number;     
}

export interface ISkillState {
  id: string;
  level: number;
  currentXp: number;
  tags: string[];
  scalingAttribute: keyof IBaseAttributes; 
  origin?: ISkillOrigin; 
}

export interface ISimulationStats {
  // --- SURVIVAL & LOGISTICS ---
  max_health: number;
  health_regen: number;
  max_energy: number;
  energy_regen: number;
  metabolic_rate: number;        
  carry_capacity_kg: number;     
  inventory_slots: number;       

  // --- MOVEMENT PHYSICS ---
  movement_speed: number;        
  sprint_multiplier: number;     
  slide_friction: number;        
  jump_height: number;           
  fall_damage_reduction: number; 
  // --- FIXED: ADDED NOISE RADIUS ---
  noise_radius: number;          // Meters (The "Stealth" circle)

  // --- INTERACTION & WORLD ---
  pickup_radius: number;         
  interact_speed: number;        
  build_speed: number;           
  mining_yield: number;          
  light_radius: number;          

  // --- STRATEGIC STATS ---
  recon_efficiency: number;  
  
  // --- COMBAT OFFENSE ---
  physical_damage_add: number;
  physical_damage_mult: number;
  tech_damage_add: number;       
  magic_damage_add: number;      
  attack_speed: number;
  reload_speed: number;
  crit_chance: number;
  crit_multiplier: number;
  armor_penetration: number;

  // --- COMBAT DEFENSE ---
  armor_flat: number;
  evasion_rating: number;
  energy_shield_max: number;
  energy_shield_recharge: number;
  status_resistance_poison: number;
  status_resistance_stun: number;

  // --- WEIRD / ESOTERIC ---
  luck_find_rarity: number;      
  luck_find_quantity: number;    
  shop_price_modifier: number;   
  tax_evasion: number;           
  extraction_speed: number;      
  death_penalty_reduction: number;
  field_analysis_speed: number; // Added for identification mechanic support if needed later
}

export interface IPlayerEntity {
  id: string;
  username: string;
  level: number;
  experience: number;
  attributePoints: number; 
  attributes: IBaseAttributes;
  bank: {
    accountId: string;
    gold: number;
    stashTabs: any[];
    universalSkills: Record<string, ISkillState>; // UPDATED
    lore: any;
  }; 
  currentSession?: any; 
}

export const DEFAULT_ATTRIBUTES: IBaseAttributes = {
  strength: 1, constitution: 1, agility: 1, dexterity: 1, endurance: 1,
  intelligence: 1, focus: 1, engineering: 1, hacking: 1, perception: 1,
  charisma: 1, intimidation: 1, subterfuge: 1, bartering: 1, leadership: 1
};

export const BASE_SIMULATION_STATS: ISimulationStats = {
  max_health: 100,
  health_regen: 1.0,
  max_energy: 50,
  energy_regen: 2.0,
  metabolic_rate: 1.0,
  carry_capacity_kg: 30,
  inventory_slots: 20,
  
  movement_speed: 4.0,
  sprint_multiplier: 1.5,
  slide_friction: 0.8,
  jump_height: 1.2,
  fall_damage_reduction: 0,
  noise_radius: 10.0, // Base 10 meters

  pickup_radius: 2.0,
  interact_speed: 1.0,
  build_speed: 1.0,
  mining_yield: 1.0,
  light_radius: 1, 

  recon_efficiency: 1.0, 

  physical_damage_add: 0,
  physical_damage_mult: 1.0,
  tech_damage_add: 0,
  magic_damage_add: 0,
  attack_speed: 1.0,
  reload_speed: 1.0,
  crit_chance: 0.05,
  crit_multiplier: 1.5,
  armor_penetration: 0,

  armor_flat: 0,
  evasion_rating: 0,
  energy_shield_max: 0,
  energy_shield_recharge: 0,
  status_resistance_poison: 0,
  status_resistance_stun: 0,

  luck_find_rarity: 1.0,
  luck_find_quantity: 1.0,
  shop_price_modifier: 1.0,
  tax_evasion: 0,
  extraction_speed: 1.0,
  death_penalty_reduction: 0,
  field_analysis_speed: 1.0
};
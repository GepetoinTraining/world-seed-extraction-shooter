// ... existing imports ...

export interface ISimulationStats {
  // ... existing stats ...

  // --- INTERACTION & WORLD ---
  pickup_radius: number;         
  interact_speed: number;        
  build_speed: number;           
  mining_yield: number;          
  light_radius: number;          

  // --- NEW: STRATEGIC STATS ---
  // Determines the quality of Intel gathered during the Briefing Phase.
  // 1.0 = Basic Info (Biome/Danger)
  // 2.0 = Detailed Info (Mob Types/Resource Count)
  // 3.0 = Hyper-Spectral (Specific Legendary Drops/Boss Locations)
  recon_efficiency: number;  
  
  // ... existing combat stats ...
}

export const BASE_SIMULATION_STATS: ISimulationStats = {
  // ... existing defaults ...
  pickup_radius: 2.0,
  interact_speed: 1.0,
  build_speed: 1.0,
  mining_yield: 1.0,
  light_radius: 1, 

  recon_efficiency: 1.0, // Default to Basic Scan

  // ... existing defaults ...
};
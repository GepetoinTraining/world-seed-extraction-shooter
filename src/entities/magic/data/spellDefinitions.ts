import { ISpellDefinition, SpellScale, ElementType } from '../types';
import { BiomeType } from '../../world/types';

export const SPELL_DEFINITIONS: Record<string, ISpellDefinition> = {
  
  // ========================================================================
  // LOCAL SCALE (Combat Alchemy)
  // "I snap my fingers and the air burns."
  // ========================================================================
  'spell_flame_snap': {
    id: 'spell_flame_snap',
    name: 'Ignition Snap',
    description: 'Compresses atmospheric oxygen for a directed blast.',
    scale: SpellScale.LOCAL,
    element: ElementType.FIRE,
    cost: { energy: 10 },
    cooldown: 0.5,
    castTime: 0,
    payload: {
      damage: 25,
      projectilePattern: 'SHOTGUN' // Uses our ProjectileSystem
    },
    visuals: { color: '#ef4444', icon: '🔥' }
  },
  
  'spell_stone_fist': {
    id: 'spell_stone_fist',
    name: 'Geo-Strike',
    description: 'Raises a pillar of earth to strike the target.',
    scale: SpellScale.LOCAL,
    element: ElementType.EARTH,
    cost: { energy: 15 },
    cooldown: 1.0,
    castTime: 0.2,
    payload: {
      damage: 40,
      projectilePattern: 'SINGLE' 
    },
    visuals: { color: '#78350f', icon: '👊' }
  },

  // ========================================================================
  // TACTICAL SCALE (Field Alchemy)
  // "I reject your pathing."
  // ========================================================================
  'spell_wall_iron': {
    id: 'spell_wall_iron',
    name: 'Ferro-Barrier',
    description: 'Transmutes scrap metal into a defensive wall.',
    scale: SpellScale.TACTICAL,
    element: ElementType.EARTH,
    cost: { 
      energy: 50, 
      biomeRequirement: BiomeType.INDUSTRIAL // Equivalent Exchange: Needs raw material
    },
    cooldown: 10,
    castTime: 2.0,
    payload: {
      structureId: 'str_wall_iron_t1', // Spawns a physical entity
      range: 5
    },
    visuals: { color: '#57534e', icon: '🧱' }
  },

  'spell_zone_mist': {
    id: 'spell_zone_mist',
    name: 'Aerosol Cover',
    description: 'Generates a dense fog, reducing enemy vision in this chunk.',
    scale: SpellScale.TACTICAL,
    element: ElementType.AIR,
    cost: { energy: 40 },
    cooldown: 30,
    castTime: 1.0,
    payload: {
      structureId: 'eff_smoke_cloud', // Logic handles this as a Zone Effect
      range: 20
    },
    visuals: { color: '#d1d5db', icon: '☁️' }
  },

  // ========================================================================
  // STRATEGIC SCALE (Grand Alchemy)
  // "I am rewriting the map."
  // ========================================================================
  'spell_terra_forest': {
    id: 'spell_terra_forest',
    name: 'Genesis Bloom',
    description: 'Forces rapid biological overgrowth, consuming a Wasteland chunk.',
    scale: SpellScale.STRATEGIC,
    element: ElementType.EARTH,
    cost: { 
      energy: 500, // Massive cost
      materials: ['res_bio_sample_rare'] // Rare catalyst required
    },
    cooldown: 300,
    castTime: 10.0, // You must defend the caster!
    payload: {
      biomeShift: BiomeType.OVERGROWTH // Permanently changes the map for this session
    },
    visuals: { color: '#10b981', icon: '🌳' }
  },

  'spell_orbital_glass': {
    id: 'spell_orbital_glass',
    name: 'Project: HELIOS',
    description: 'Orbital mirror array focuses sunlight to glass the sector.',
    scale: SpellScale.STRATEGIC,
    element: ElementType.FIRE,
    cost: { 
      energy: 1000, 
      materials: ['res_fuel_cell_epic'] 
    },
    cooldown: 600,
    castTime: 20.0, // "Tactical Nuke Incoming"
    payload: {
      damage: 9999, // Everything dies
      biomeShift: BiomeType.WASTELAND // Turns it into a crater
    },
    visuals: { color: '#fbbf24', icon: '☀️' }
  },

  // --- THE FORBIDDEN ART (Summoning) ---
  'spell_summon_scifi_mech': {
    id: 'spell_summon_scifi_mech',
    name: 'Protocol: IRON_GIANT',
    description: 'Reconstructs a destroyed Heavy Walker from scrap memory.',
    scale: SpellScale.STRATEGIC, // This is a war asset
    element: ElementType.DATA,
    cost: {
        energy: 1000,
        materials: ['res_tech_cache_epic', 'res_fuel_cell_epic'], // Expensive!
        loreRequirements: [
            { topic: 'lore_scifi_mech_schematics', level: 3 } // You must have studied mechs
        ],
        entropyGain: 100 // Very high risk
    },
    cooldown: 3600, // Once per hour
    castTime: 30.0,
    payload: {
        summonMobId: 'mob_scifi_mech' // Calls the Mob Definition
    },
    visuals: { color: '#f59e0b', icon: '🤖' }
  }
};
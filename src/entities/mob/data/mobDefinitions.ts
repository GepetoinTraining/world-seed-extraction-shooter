import { IMobDefinition, MobSize, MobBehavior } from '../types';
import { UniversalRank, GenreType } from '../../../../types';

export const MOB_DEFINITIONS: Record<string, IMobDefinition> = {
  'mob_fantasy_rat': {
    id: 'mob_fantasy_rat',
    name: 'Plague Rat',
    genre: GenreType.FANTASY,
    tags: ['grunt', 'biological'],
    rank: UniversalRank.F,
    size: MobSize.TINY,
    behavior: MobBehavior.SWARM,
    baseHealth: 20,
    baseDamage: 5,
    speed: 3.0,
    viewRange: 8,
    colorHex: '#78716c'
  },
  'mob_fantasy_orc': {
    id: 'mob_fantasy_orc',
    name: 'Ironjaw Raider',
    genre: GenreType.FANTASY,
    tags: ['grunt', 'humanoid'],
    rank: UniversalRank.D,
    size: MobSize.MEDIUM,
    behavior: MobBehavior.AGGRESSIVE,
    baseHealth: 150,
    baseDamage: 25,
    speed: 2.5,
    viewRange: 10,
    colorHex: '#15803d'
  },
  'mob_fantasy_dragon': {
    id: 'mob_fantasy_dragon',
    name: 'Cinder Scale',
    genre: GenreType.FANTASY,
    tags: ['elite', 'beast', 'flying'],
    rank: UniversalRank.S,
    size: MobSize.GIGANTIC,
    behavior: MobBehavior.NEUTRAL, // Only attacks if you touch its hoard
    baseHealth: 5000,
    baseDamage: 200,
    speed: 5.0,
    viewRange: 20,
    colorHex: '#dc2626',
    symbol: '🐲'
  },
  // THE TARRASQUE EQUIVALENT
  'boss_fantasy_tarrasque': {
    id: 'boss_fantasy_tarrasque',
    name: 'The Earth Breaker',
    genre: GenreType.FANTASY,
    tags: ['boss', 'titan'],
    rank: UniversalRank.SSS,
    size: MobSize.COLOSSAL, // Takes up huge space
    behavior: MobBehavior.SIEGE, // It destroys the map itself
    baseHealth: 1000000, // Raid Boss HP
    baseDamage: 5000,
    speed: 1.0, // Slow but inevitable
    viewRange: 50,
    colorHex: '#7f1d1d', // Deep Red
    symbol: '🦖'
  },

  // ========================================================================
  // SCI-FI GENRE
  // ========================================================================
  'mob_scifi_drone': {
    id: 'mob_scifi_drone',
    name: 'Seeker Drone',
    genre: GenreType.SCIFI,
    tags: ['grunt', 'mechanical', 'flying'],
    rank: UniversalRank.F,
    size: MobSize.TINY,
    behavior: MobBehavior.SWARM,
    baseHealth: 30,
    baseDamage: 8,
    speed: 4.5,
    viewRange: 15, // High sensor range
    colorHex: '#0ea5e9'
  },
  'mob_scifi_mech': {
    id: 'mob_scifi_mech',
    name: 'Heavy Walker unit',
    genre: GenreType.SCIFI,
    tags: ['elite', 'mechanical', 'armored'],
    rank: UniversalRank.B,
    size: MobSize.LARGE,
    behavior: MobBehavior.TURRET, // Slow moving, holds ground
    baseHealth: 800,
    baseDamage: 150,
    speed: 1.5,
    viewRange: 18,
    colorHex: '#f59e0b'
  },
  // THE SCI-FI COLOSSUS
  'boss_scifi_fortress': {
    id: 'boss_scifi_fortress',
    name: 'Mobile Command Center',
    genre: GenreType.SCIFI,
    tags: ['boss', 'vehicle'],
    rank: UniversalRank.SSS,
    size: MobSize.COLOSSAL,
    behavior: MobBehavior.SIEGE,
    baseHealth: 1500000,
    baseDamage: 8000, // Orbital Strike
    speed: 0.5,
    viewRange: 100, // Satellite Uplink
    colorHex: '#1e293b',
    symbol: '🛸'
  },

  // ========================================================================
  // ELDRITCH GENRE (Horror)
  // ========================================================================
  'mob_eldritch_shambler': {
    id: 'mob_eldritch_shambler',
    name: 'Void Touched',
    genre: GenreType.ELDRITCH,
    tags: ['grunt', 'horror'],
    rank: UniversalRank.E,
    size: MobSize.MEDIUM,
    behavior: MobBehavior.AGGRESSIVE,
    baseHealth: 80,
    baseDamage: 15,
    speed: 2.0,
    viewRange: 6,
    colorHex: '#a855f7'
  },
  'boss_eldritch_god': {
    id: 'boss_eldritch_god',
    name: 'The Unseen Variable',
    genre: GenreType.ELDRITCH,
    tags: ['boss', 'god'],
    rank: UniversalRank.SSS,
    size: MobSize.COLOSSAL,
    behavior: MobBehavior.PASSIVE, // It ignores you... until you look at it.
    baseHealth: 9999999,
    baseDamage: 9999,
    speed: 0, // It is everywhere
    viewRange: 0,
    colorHex: '#000000',
    symbol: '👁️'
  }
};
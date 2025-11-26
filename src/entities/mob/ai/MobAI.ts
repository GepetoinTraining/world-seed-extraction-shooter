import { GenreType, Rarity, UniversalRank } from '../../../../types'; 

// ==========================================
// 1. THE VOCABULARY (AI-Specific Enums)
// ==========================================

export enum MobObjective {
  KILL_PLAYER = 'KILL_PLAYER',       // Default: Seek and destroy
  PROTECT_ASSET = 'PROTECT_ASSET',   // Guard a chest/door/zone
  HOARD = 'HOARD',                   // Collect items, ignore player unless provoked
  SURVIVE = 'SURVIVE',               // Self-preservation prioritized
  FEED = 'FEED',                     // Eat corpses/resources to buff/evolve
  WITNESS = 'WITNESS',               // Eldritch: Observe to escalate danger
  REPRODUCE = 'REPRODUCE',           // Industrial/Swarm: Create more units
}

export enum Temperament {
  AGGRESSIVE = 'AGGRESSIVE',     // Closes distance, prioritizes damage
  COWARD = 'COWARD',             // Flees at HP threshold
  TERRITORIAL = 'TERRITORIAL',   // Only attacks inside a zone
  PASSIVE = 'PASSIVE',           // Never initiates
  BERSERKER = 'BERSERKER',       // Ignores own safety entirely
  OPPORTUNIST = 'OPPORTUNIST',   // Attacks only if player is distracted/low HP
  HIVEMIND = 'HIVEMIND',         // Uses group tactics
}

export enum ActivationTrigger {
  SIGHT = 'SIGHT',
  SOUND = 'SOUND',
  PROXIMITY = 'PROXIMITY', // Blind sense
  DAMAGE = 'DAMAGE',
  ALERT = 'ALERT',         // Propagated from another mob
  TIMER = 'TIMER',         // Industrial
}

export enum MobState {
  DORMANT = 'DORMANT',     // No CPU cost (mostly)
  STALKING = 'STALKING',   // Moving but trying to stay hidden
  ACTIVE = 'ACTIVE',       // Combat engaged
  FLEEING = 'FLEEING',     // Disengaging
  VICTORIOUS = 'VICTORIOUS' // Player dead/gone, celebrating/eating
}

// The atomic actions a mob can take per tick
export enum BehaviorPrimitive {
  IDLE = 'IDLE',
  APPROACH = 'APPROACH',      // Move towards target
  FLEE = 'FLEE',              // Move away from target
  STRAFE = 'STRAFE',          // Move perpendicular to target
  FLANK = 'FLANK',            // Move to target's side/rear
  TELEGRAPH = 'TELEGRAPH',    // Warn player of incoming attack
  ATTACK_MELEE = 'ATTACK_MELEE',
  ATTACK_RANGED = 'ATTACK_RANGED',
  BLOCK = 'BLOCK',
  PHASE = 'PHASE',            // Teleport/Invuln
  CALL_ALLIES = 'CALL_ALLIES',
  SACRIFICE = 'SACRIFICE',    // Suicide for effect
  SPAWN = 'SPAWN',            // Industrial/Swarm creation
}

// ==========================================
// 2. THE DATA STRUCTURES
// ==========================================

export interface IAwarenessProfile {
  sightRange: number;
  hearingRange: number;
  lightDependence: number; // 0.0 (Thermal/Blind) to 1.0 (Needs full light)
  proximitySense: number;  // Radius of "blind" sense
  canAlertOthers: boolean;
  isIndustrial: boolean;   // Ticks even when dormant
}

// The Input State (Read-Only Context from the Game Engine)
export interface ICombatContext {
  mobId: string;
  mobPos: { x: number; y: number };
  mobHpPercent: number; // 0.0 to 1.0
  
  playerPos: { x: number; y: number };
  playerHpPercent: number; // 0.0 to 1.0
  playerNoiseLevel: number; // 0-100 (Sneak vs Sprint)
  playerIsLookingAtMob: boolean;
  
  lightLevelAtMob: number; // 0.0 (Dark) - 1.0 (Bright)
  nearbyAlliesCount: number;
  distanceToPlayer: number;
  
  // World Context
  isInTerritory: boolean;
  nearestCorpseDist?: number;
}

// The Output State (What the mob decides to do)
export interface IMobDecision {
  action: BehaviorPrimitive;
  targetPos?: { x: number; y: number }; // Where to move/aim
  metadata?: any; // For speech bubbles, debug, or special FX (e.g. "Calling Swarm!")
}

// ==========================================
// 3. THE BRAIN (Logic Implementation)
// ==========================================

export class MobAI {
  
  // ---------------------------------------------------------
  // A. ACTIVATION LOGIC (The Cheap Filter)
  // ---------------------------------------------------------
  
  /**
   * Runs every few frames to see if the mob should wake up.
   * Optimized to fail fast.
   */
  static checkActivation(
    currentState: MobState,
    awareness: IAwarenessProfile,
    ctx: ICombatContext
  ): { newState: MobState; trigger: ActivationTrigger | null } {
    
    // 1. Industrial mobs never sleep, they just change modes
    if (awareness.isIndustrial) {
      // If player is close, they become ACTIVE combatants
      if (ctx.distanceToPlayer < awareness.sightRange) {
        return { newState: MobState.ACTIVE, trigger: ActivationTrigger.SIGHT };
      }
      // Otherwise they exist in "Industrial Time" (Producing/Building)
      return { newState: MobState.DORMANT, trigger: ActivationTrigger.TIMER }; 
    }

    // 2. Already active? Stay active until de-aggro conditions met
    if (currentState === MobState.ACTIVE) {
      // Simple de-aggro: Player too far away
      if (ctx.distanceToPlayer > awareness.sightRange * 2.0) {
        return { newState: MobState.DORMANT, trigger: null }; 
      }
      return { newState: MobState.ACTIVE, trigger: null };
    }

    // 3. Sound Check (Cheaper than raycasting)
    // Formula: Noise - (Distance / Sensitivity)
    // A loud player (Sprint=80) is heard further than a quiet one (Crouch=10)
    const effectiveNoise = ctx.playerNoiseLevel - (ctx.distanceToPlayer / 2); 
    if (effectiveNoise > (100 - awareness.hearingRange)) {
      // Sound wakes you up, potentially into STALKING state first
      return { newState: MobState.STALKING, trigger: ActivationTrigger.SOUND };
    }

    // 4. Proximity Check (Blind/Ambush/Trap)
    if (ctx.distanceToPlayer < awareness.proximitySense) {
       return { newState: MobState.ACTIVE, trigger: ActivationTrigger.PROXIMITY };
    }

    // 5. Sight Check (Needs Light)
    if (ctx.distanceToPlayer < awareness.sightRange) {
      // Vision Quality = 1.0 (Perfect) to 0.0 (Blind)
      // Affected by darkness IF the mob relies on light
      const visionQuality = 1 - (awareness.lightDependence * (1 - ctx.lightLevelAtMob));
      const effectiveVisionRange = awareness.sightRange * visionQuality;
      
      if (ctx.distanceToPlayer < effectiveVisionRange) {
        // (Raycast logic would go here in full engine to check walls)
        return { newState: MobState.ACTIVE, trigger: ActivationTrigger.SIGHT };
      }
    }

    return { newState: MobState.DORMANT, trigger: null };
  }

  // ---------------------------------------------------------
  // B. INDUSTRIAL TICK (The "Clock is Ticking" Logic)
  // ---------------------------------------------------------
  
  static getIndustrialAction(objective: MobObjective): IMobDecision {
    // These tick in the background. Player enters room -> Room is full of enemies.
    switch (objective) {
      case MobObjective.REPRODUCE:
        // Logic: Internal timer check would happen here
        return { action: BehaviorPrimitive.SPAWN }; 
      case MobObjective.HOARD:
        // Logic: Slowly accumulate resources/gold in inventory
        return { action: BehaviorPrimitive.IDLE, metadata: { status: 'Mining...' } };
      default:
        return { action: BehaviorPrimitive.IDLE };
    }
  }

  // ---------------------------------------------------------
  // C. COMBAT LOOP (Objective -> Temperament -> Genre -> Action)
  // ---------------------------------------------------------

  static decideAction(
    mob: { 
      objective: MobObjective; 
      temperament: Temperament; 
      genre: GenreType; 
      rarity: Rarity;
      sequenceIndex: number; // For keeping track of combo chains
    },
    ctx: ICombatContext
  ): IMobDecision {

    // 1. High Priority Overrides (Survival)
    // Cowards run when hurt
    if (mob.temperament === Temperament.COWARD && ctx.mobHpPercent < 0.3) {
      return { action: BehaviorPrimitive.FLEE, targetPos: ctx.playerPos }; 
    }

    // 2. Determine High-Level Goal based on Objective
    // What does this mob WANT right now?
    let goal: 'AGGRESS' | 'DEFEND' | 'POSITION' | 'FLEE' = 'AGGRESS';
    
    switch (mob.objective) {
      case MobObjective.PROTECT_ASSET:
        // If lured too far from "home", go back
        goal = ctx.isInTerritory ? 'AGGRESS' : 'POSITION'; 
        break;
      case MobObjective.WITNESS:
        goal = 'POSITION'; // Just watch...
        if (ctx.playerIsLookingAtMob) {
           // Eldritch logic: if you look, they might freeze or enrage
        }
        break;
      case MobObjective.HOARD:
        // If there's loot nearby, go for it instead of the player
        if (ctx.nearestCorpseDist && ctx.nearestCorpseDist < 5) {
          goal = 'POSITION'; 
        } else {
          goal = 'AGGRESS';
        }
        break;
      case MobObjective.SURVIVE:
        goal = ctx.mobHpPercent < 0.5 ? 'FLEE' : 'DEFEND';
        break;
    }

    // 3. Select Genre Primitive based on Goal & Rarity
    // This executes the "How" based on the "What"
    return this.getGenrePrimitive(mob.genre, mob.rarity, goal, ctx, mob.sequenceIndex);
  }

  // ---------------------------------------------------------
  // D. GENRE DEFINITIONS (The "Culture" of Combat)
  // ---------------------------------------------------------

  private static getGenrePrimitive(
    genre: GenreType, 
    rarity: Rarity, 
    goal: string, 
    ctx: ICombatContext,
    seq: number
  ): IMobDecision {

    // Helper: Is this mob smart?
    const isSmart = [Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY, Rarity.ARTIFACT].includes(rarity);
    const isBoss = [Rarity.LEGENDARY, Rarity.ARTIFACT].includes(rarity);

    // --- FANTASY GENRE (Telegraphed, Melee, Heroic) ---
    if (genre === GenreType.FANTASY) {
      if (goal === 'AGGRESS') {
        // Pattern: Approach -> Telegraph -> Attack
        if (ctx.distanceToPlayer > 2) return { action: BehaviorPrimitive.APPROACH };
        
        if (ctx.distanceToPlayer <= 2) {
           // Smart mobs occasionally block
           if (isSmart && Math.random() > 0.8) return { action: BehaviorPrimitive.BLOCK };
           return { action: BehaviorPrimitive.ATTACK_MELEE };
        }
      }
      if (goal === 'DEFEND') return { action: BehaviorPrimitive.BLOCK };
    }

    // --- SCI-FI GENRE (Ranged, Cover, Tactical) ---
    if (genre === GenreType.SCIFI) {
      if (goal === 'AGGRESS') {
        // Pattern: Maintain Range -> Shoot -> Strafe
        const optimalRange = 8;
        
        if (ctx.distanceToPlayer < 4) return { action: BehaviorPrimitive.FLEE }; // Too close
        if (ctx.distanceToPlayer > 12) return { action: BehaviorPrimitive.APPROACH }; // Too far
        
        // Smart mobs strafe while shooting
        if (isSmart) return { action: BehaviorPrimitive.ATTACK_RANGED, metadata: { strafing: true } };
        return { action: BehaviorPrimitive.ATTACK_RANGED };
      }
    }

    // --- POST-APOC GENRE (Scrappy, Ambush) ---
    if (genre === GenreType.POST_APOC) {
      if (goal === 'AGGRESS') {
        // Pattern: Rush -> Hit -> Run
        if (ctx.distanceToPlayer > 1.5) return { action: BehaviorPrimitive.APPROACH };
        return { action: BehaviorPrimitive.ATTACK_MELEE };
      }
    }

    // --- ELDRITCH GENRE (Weird, Non-Euclidean) ---
    if (genre === GenreType.ELDRITCH) {
      // Moves in bursts or teleports
      if (Math.random() > 0.85) return { action: BehaviorPrimitive.PHASE }; // Blink
      if (ctx.playerIsLookingAtMob) return { action: BehaviorPrimitive.IDLE }; // Weeping Angel
      return { action: BehaviorPrimitive.APPROACH };
    }
    
    // --- RETRO GENRE (Pattern-based) ---
    if (genre === GenreType.RETRO) {
      // Very simple, predictable movement (like Pacman ghosts)
      return { action: BehaviorPrimitive.APPROACH };
    }

    // Default Fallback
    return { action: BehaviorPrimitive.APPROACH };
  }

  // ---------------------------------------------------------
  // E. DIRECTOR HOOK (Evolution System)
  // ---------------------------------------------------------
  
  /**
   * Generates a "Behavior Vector" for the vector DB.
   * This allows the Director to search for "Aggressive Swarmers" or "Defensive Snipers".
   */
  static generateBehaviorVector(mob: { temperament: Temperament, genre: GenreType }): number[] {
    // Vector Format: [ Aggression, Social, Range, Sneakiness, Chaos ]
    const vector = [0, 0, 0, 0, 0];
    
    // 1. Temperament Modifiers
    if (mob.temperament === Temperament.AGGRESSIVE) vector[0] += 0.8;
    if (mob.temperament === Temperament.BERSERKER) vector[0] += 1.0;
    if (mob.temperament === Temperament.COWARD) vector[0] -= 0.5;
    if (mob.temperament === Temperament.HIVEMIND) vector[1] += 1.0;
    
    // 2. Genre Modifiers
    if (mob.genre === GenreType.SCIFI) vector[2] += 0.8; // High Range
    if (mob.genre === GenreType.ELDRITCH) vector[4] += 1.0; // High Chaos
    
    return vector;
  }
}
import { GenreType, Rarity } from '../../../../types'; 
import { IChunk, EntityType } from '../../world/types'; 

// ==========================================
// 1. ENUMS (Standard)
// ==========================================

export enum MobObjective {
  KILL_PLAYER = 'KILL_PLAYER',
  PROTECT_ASSET = 'PROTECT_ASSET',
  HOARD = 'HOARD',
  SURVIVE = 'SURVIVE',
  FEED = 'FEED',
  WITNESS = 'WITNESS',
  REPRODUCE = 'REPRODUCE',
}

export enum Temperament {
  AGGRESSIVE = 'AGGRESSIVE',
  COWARD = 'COWARD',
  TERRITORIAL = 'TERRITORIAL',
  PASSIVE = 'PASSIVE',
  BERSERKER = 'BERSERKER',
  OPPORTUNIST = 'OPPORTUNIST',
  HIVEMIND = 'HIVEMIND',
}

export enum ActivationTrigger {
  SIGHT = 'SIGHT',
  SOUND = 'SOUND',
  PROXIMITY = 'PROXIMITY',
  DAMAGE = 'DAMAGE',
  ALERT = 'ALERT',
  TIMER = 'TIMER',
}

export enum MobState {
  DORMANT = 'DORMANT',
  STALKING = 'STALKING',
  ACTIVE = 'ACTIVE',
  FLEEING = 'FLEEING',
}

export enum BehaviorPrimitive {
  IDLE = 'IDLE',
  APPROACH = 'APPROACH',
  FLEE = 'FLEE',
  STRAFE = 'STRAFE',
  FLANK = 'FLANK',
  ATTACK_MELEE = 'ATTACK_MELEE',
  ATTACK_RANGED = 'ATTACK_RANGED',
  BLOCK = 'BLOCK',
  PHASE = 'PHASE',
  SACRIFICE = 'SACRIFICE',
  SPAWN = 'SPAWN',
}

// Input Context
export interface ICombatContext {
  distanceToPlayer: number;
  mobHpPercent: number;
  playerPos: { x: number; y: number };
  playerNoiseLevel: number;
  lightLevelAtMob: number;
  isInTerritory: boolean;
  playerIsLookingAtMob: boolean;
  nearestCorpseDist?: number;
}

// Output Decision
export interface IMobDecision {
  action: BehaviorPrimitive;
  targetPos?: { x: number; y: number };
  metadata?: any;
}

// ==========================================
// 2. THE SYSTEM
// ==========================================

export class MobAI {
  
  // Internal memory (Ephemeral state)
  private static mobMemory: Record<string, {
    lastAttackTime: number;
    state: MobState;
    objective: MobObjective;
  }> = {};

  static reset() {
    this.mobMemory = {};
  }

  static clearMob(entityId: string) {
    delete this.mobMemory[entityId];
  }

  /**
   * THE MAIN LOOP
   * @param visibleChunks - Map of loaded chunks
   * @param playerPos - 2D Position { x: player.x, y: player.z } <-- Y represents Depth here
   * @param deltaTime - Time since last frame in seconds
   */
  static tick(
    visibleChunks: Record<string, IChunk>, 
    playerPos: { x: number; y: number }, 
    deltaTime: number
  ): { 
    updatedChunks: Record<string, IChunk>; 
    spawnedPatterns: any[] 
  } {
    
    const updatedChunks: Record<string, IChunk> = {};
    const spawnedPatterns: any[] = [];
    const now = Date.now();

    Object.values(visibleChunks).forEach(chunk => {
      let chunkWasModified = false;
      
      const newEntities = chunk.entities.map(entity => {
        // Validation
        if (entity.type !== EntityType.MOB || (entity.health || 0) <= 0) return entity;

        // Memory Init
        if (!this.mobMemory[entity.id]) {
          this.mobMemory[entity.id] = {
            lastAttackTime: 0,
            state: MobState.DORMANT,
            objective: MobObjective.KILL_PLAYER
          };
        }

        const mem = this.mobMemory[entity.id];

        // 1. Build Context (2D Math)
        // Note: entity.position.y matches playerPos.y (which is World Z)
        const dx = playerPos.x - entity.position.x;
        const dy = playerPos.y - entity.position.y;
        const dist = Math.hypot(dx, dy);
        
        const ctx: ICombatContext = {
          distanceToPlayer: dist,
          mobHpPercent: (entity.health || 100) / 100,
          playerPos: { x: playerPos.x, y: playerPos.y },
          playerNoiseLevel: 50,
          lightLevelAtMob: 1.0, 
          isInTerritory: true,
          playerIsLookingAtMob: false
        };

        // 2. Check Activation
        if (mem.state === MobState.DORMANT) {
          if (dist < 15) mem.state = MobState.ACTIVE;
        } else if (mem.state === MobState.ACTIVE && dist > 30) {
          mem.state = MobState.DORMANT;
        }

        // 3. Process Active Mobs
        if (mem.state === MobState.ACTIVE) {
          chunkWasModified = true;

          // Decide
          const decision = this.decideAction(mem.objective, Temperament.AGGRESSIVE, GenreType.SCIFI, Rarity.COMMON, ctx);

          // Move
          let moveSpeed = 2.0 * deltaTime;
          let moveX = 0;
          let moveY = 0;

          const angle = Math.atan2(dy, dx);

          if (decision.action === BehaviorPrimitive.APPROACH) {
            moveX = Math.cos(angle) * moveSpeed;
            moveY = Math.sin(angle) * moveSpeed;
          } else if (decision.action === BehaviorPrimitive.FLEE) {
            moveX = -Math.cos(angle) * moveSpeed;
            moveY = -Math.sin(angle) * moveSpeed;
          }

          // Attack
          if (decision.action === BehaviorPrimitive.ATTACK_RANGED || decision.action === BehaviorPrimitive.ATTACK_MELEE) {
            if (now - mem.lastAttackTime > 2000) { 
              mem.lastAttackTime = now;
              
              spawnedPatterns.push({
                type: decision.action === BehaviorPrimitive.ATTACK_RANGED ? 'LINEAR' : 'MELEE',
                // Origin is 2D { x, y }
                origin: { x: entity.position.x, y: entity.position.y },
                angle: angle,
                startTime: now,
                color: 'red'
              });
            }
          }

          // Return Updated Entity (Strictly 2D update)
          return {
            ...entity,
            position: {
              x: entity.position.x + moveX,
              y: entity.position.y + moveY
              // No Z property here
            }
          };
        }

        return entity;
      });

      if (chunkWasModified) {
        updatedChunks[chunk.id] = {
          ...chunk,
          entities: newEntities
        };
      }
    });

    return { updatedChunks, spawnedPatterns };
  }

  // ---------------------------------------------------------
  // LOGIC PRIMITIVES
  // ---------------------------------------------------------

  private static decideAction(
    obj: MobObjective, 
    temp: Temperament, 
    genre: GenreType, 
    rarity: Rarity, 
    ctx: ICombatContext
  ): IMobDecision {

    if (ctx.distanceToPlayer < 2) {
      return { action: BehaviorPrimitive.ATTACK_MELEE };
    }
    
    // Sci-Fi Kiting Logic
    if (genre === GenreType.SCIFI) {
       if (ctx.distanceToPlayer < 8 && ctx.distanceToPlayer > 4) {
         return { action: BehaviorPrimitive.ATTACK_RANGED };
       }
       if (ctx.distanceToPlayer <= 4) {
         return { action: BehaviorPrimitive.FLEE };
       }
    }

    return { action: BehaviorPrimitive.APPROACH };
  }
}
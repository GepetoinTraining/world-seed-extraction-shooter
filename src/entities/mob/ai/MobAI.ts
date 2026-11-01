import { GenreType } from '../../../../types';
import { IChunk, IMap, EntityType } from '../../world/types';
import { PatternType } from '../../combat/projectileSystem';
import { MOB_DEFINITIONS } from '../data/mobDefinitions';
import { MobBehavior } from '../types';
import { CombatMath } from '../../combat/CombatMath';
import { WorldGenerator } from '../../world/WorldGenerator';
import { fnv1a } from '../../../logic/rng/DeterministicRNG';
import { EffectSystem, IEffectReceipt, StatusClock } from '../../../logic/systems/EffectSystem';
import { ContentRegistry } from '../../../logic/theme/ContentRegistry';

// World scale: 1 tile = 20px. All distances below are in PIXELS.
const PX = 20;
/** How much noise reduction it takes to halve the distance you are noticed from. A guess until Wave 12. */
const NOISE_SCALE = 20;
/** R4: nothing lands without a wind-up you can see. Guesses until Wave 12. */
const STRIKE_WINDUP_MS = 450;
const ATTACK_COOLDOWN_MS = 2000;

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

export type MobFacing = 'down' | 'up' | 'left' | 'right';

export class MobAI {

  // Internal memory (Ephemeral state)
  private static mobMemory: Record<string, {
    lastAttackTime: number;
    state: MobState;
    objective: MobObjective;
    facing: MobFacing;
    moving: boolean;
    provoked: boolean;
    /** What it has started and not yet finished: seen, and dodged, before it lands. */
    windup?: { until: number; startedAt: number; receipt?: IEffectReceipt; delivery: string; reachPx: number; ranged: boolean };
    readyAt: Record<string, number>;
    casts: number;
  }> = {};

  static reset() {
    this.mobMemory = {};
  }

  static clearMob(entityId: string) {
    delete this.mobMemory[entityId];
  }

  /** What the renderer needs: which way it looks and whether its legs move. */
  static pose(entityId: string): { facing: MobFacing; moving: boolean } | undefined {
    const mem = this.mobMemory[entityId];
    return mem ? { facing: mem.facing, moving: mem.moving } : undefined;
  }

  /** Being hit wakes what would otherwise ignore you: the neutral turn, the passive flee. */
  static provoke(entityId: string) {
    const mem = this.mobMemory[entityId];
    if (mem) { mem.provoked = true; if (mem.state === MobState.DORMANT) mem.state = MobState.ACTIVE; }
    else this.mobMemory[entityId] = { lastAttackTime: 0, state: MobState.ACTIVE, objective: MobObjective.KILL_PLAYER, facing: 'down', moving: false, provoked: true, readyAt: {}, casts: 0 };
  }

  /**
   * THE MAIN LOOP. Every enemy decides by its own definition — behavior, speed and
   * view range — and no move may end on water, rock or a standing trunk: movement
   * goes through the same resolver the player uses (when a map is given).
   *
   * @param visibleChunks - Map of loaded chunks
   * @param playerPos - 2D Position { x: player.x, y: player.z } <-- Y represents Depth here
   * @param deltaTime - Time since last frame in seconds
   * @param map - The live world; without it, terrain cannot refuse a step (tests only)
   * @param senses - What the person's gear does to being noticed (line 77)
   */
  static tick(
    visibleChunks: Record<string, IChunk>,
    playerPos: { x: number; y: number },
    deltaTime: number,
    map?: IMap,
    senses: { noiseReduction?: number } = {}
  ): {
    updatedChunks: Record<string, IChunk>;
    spawnedPatterns: any[]
  } {

    const updatedChunks: Record<string, IChunk> = {};
    const spawnedPatterns: any[] = [];
    const now = Date.now();
    // Quieter gear shortens how far a thing notices you; loud gear lengthens it.
    const heard = NOISE_SCALE / Math.max(1, NOISE_SCALE + (senses.noiseReduction ?? 0));

    Object.entries(visibleChunks).forEach(([chunkKey, chunk]) => {
      let chunkWasModified = false;

      const newEntities = chunk.entities.map(entity => {
        // Validation
        if (entity.type !== EntityType.MOB || (entity.health || 0) <= 0) return entity;

        // Memory Init
        if (!this.mobMemory[entity.id]) {
          this.mobMemory[entity.id] = {
            lastAttackTime: 0,
            state: MobState.DORMANT,
            objective: MobObjective.KILL_PLAYER,
            facing: 'down',
            moving: false,
            provoked: false,
            readyAt: {},
            casts: 0
          };
        }

        const mem = this.mobMemory[entity.id];
        const def = MOB_DEFINITIONS[entity.definitionId];
        const behavior = def?.behavior ?? MobBehavior.AGGRESSIVE;

        // 1. Build Context (2D Math)
        // Note: entity.position.y matches playerPos.y (which is World Z)
        const dx = playerPos.x - entity.position.x;
        const dy = playerPos.y - entity.position.y;
        const dist = Math.hypot(dx, dy);

        // 2. Activation by the definition's own senses. Neutral things stir only
        // when touched or provoked; passive things only when provoked.
        const aggroTiles =
          // R4: neutral is neutral. Standing near it provokes nothing; only harm does.
          behavior === MobBehavior.NEUTRAL ? 0 :
          behavior === MobBehavior.PASSIVE ? 0 :
          Math.min(def?.viewRange ?? 8, 16) * heard;
        const leashTiles = Math.max(16, aggroTiles * 2);
        if (mem.state === MobState.DORMANT) {
          if ((aggroTiles > 0 && dist < aggroTiles * PX) || mem.provoked) {
            mem.state = MobState.ACTIVE;
            // R4: waking is not striking. The first blow waits its turn like every other.
            mem.lastAttackTime = now - ATTACK_COOLDOWN_MS + STRIKE_WINDUP_MS;
          }
        } else if (dist > leashTiles * PX) {
          mem.state = MobState.DORMANT;
          mem.provoked = false;
          mem.moving = false;
        }

        // 3. Process Active Mobs
        if (mem.state === MobState.ACTIVE) {
          chunkWasModified = true;

          const ctx: ICombatContext = {
            distanceToPlayer: dist,
            mobHpPercent: (entity.health || 100) / 100,
            playerPos: { x: playerPos.x, y: playerPos.y },
            playerNoiseLevel: 50,
            lightLevelAtMob: 1.0,
            isInTerritory: true,
            playerIsLookingAtMob: false
          };
          const known = [...((def as { innate?: string[] })?.innate ?? []), ...(entity.learned ?? [])];
          const kites = def?.genre === GenreType.SCIFI || known.some(id => ContentRegistry.ability(id)?.delivery === 'ranged');
          const decision = this.decideAction(entity.id, behavior, kites, mem.provoked, ctx, { x: entity.position.x, y: entity.position.y });

          // Move at the definition's own pace, against the world's own ground
          const running = ((entity.statuses ?? []) as { until: number }[]).filter(s => s.until > now) as never[];
          const moveSpeed = (def?.speed ?? 2.0) * PX * deltaTime * StatusClock.paceScale(running) * (mem.windup ? 0 : 1);
          let moveX = 0;
          let moveY = 0;
          const angle = Math.atan2(dy, dx);

          if (decision.action === BehaviorPrimitive.APPROACH && decision.targetPos) {
            const tx = decision.targetPos.x - entity.position.x;
            const ty = decision.targetPos.y - entity.position.y;
            const reach = Math.hypot(tx, ty);
            if (reach > 2) {
              moveX = (tx / reach) * Math.min(moveSpeed, reach);
              moveY = (ty / reach) * Math.min(moveSpeed, reach);
            }
          } else if (decision.action === BehaviorPrimitive.APPROACH) {
            moveX = Math.cos(angle) * moveSpeed;
            moveY = Math.sin(angle) * moveSpeed;
          } else if (decision.action === BehaviorPrimitive.FLEE) {
            moveX = -Math.cos(angle) * moveSpeed;
            moveY = -Math.sin(angle) * moveSpeed;
          }

          // A casting or a blow, when it is ready: it winds up first, where you can see it.
          const engaged = behavior !== MobBehavior.PASSIVE && decision.action !== BehaviorPrimitive.FLEE && (mem.provoked || behavior !== MobBehavior.NEUTRAL);
          if (!mem.windup && engaged) {
            const cast = known.find(id => {
              const ability = ContentRegistry.ability(id);
              if (!ability || (mem.readyAt[id] ?? 0) > now) return false;
              const receipt = EffectSystem.resolve(ability, { rank: entity.rank }, `${entity.id}:${mem.casts}`);
              return EffectSystem.landsOnCaster(ability.effect, ability.delivery) || dist <= Math.max(receipt.reachPx, 2 * PX);
            });
            if (cast) {
              const ability = ContentRegistry.ability(cast)!;
              const receipt = EffectSystem.resolve(ability, { rank: entity.rank }, `${entity.id}:${mem.casts++}`);
              mem.readyAt[cast] = now + receipt.cooldownMs + receipt.telegraphMs;
              mem.windup = { startedAt: now, until: now + receipt.telegraphMs, receipt, delivery: ability.delivery, reachPx: receipt.reachPx, ranged: ability.delivery === 'ranged' };
            } else if ((decision.action === BehaviorPrimitive.ATTACK_RANGED || decision.action === BehaviorPrimitive.ATTACK_MELEE) && now - mem.lastAttackTime > ATTACK_COOLDOWN_MS) {
              mem.windup = {
                startedAt: now, until: now + STRIKE_WINDUP_MS,
                delivery: decision.action === BehaviorPrimitive.ATTACK_RANGED ? 'ranged' : 'melee',
                reachPx: decision.action === BehaviorPrimitive.ATTACK_RANGED ? 400 : 50,
                ranged: decision.action === BehaviorPrimitive.ATTACK_RANGED
              };
            }
          }

          let health = entity.health ?? 0;
          let statuses: never[] = running;
          if (mem.windup && now >= mem.windup.until) {
            const { receipt, ranged, reachPx } = mem.windup;
            mem.windup = undefined;
            mem.lastAttackTime = now;
            if (receipt && EffectSystem.landsOnCaster(receipt.effect, receipt.delivery)) {
              if (receipt.effect === 'heal') health = Math.min((def?.baseHealth ?? health) + (entity.bonusHealth ?? 0), health + receipt.magnitude);
              if (receipt.status) statuses = StatusClock.add(statuses, receipt.status, now) as never[];
            } else {
              spawnedPatterns.push({
                // MELEE and AREA resolve at once by the canvas, within reach; ranged uses the projectile system
                type: ranged ? PatternType.SINGLE : receipt?.delivery === 'area' || receipt?.delivery === 'aura' ? 'AREA' : 'MELEE',
                // Wave 4.3: the definition decides what this attack costs you
                damage: receipt
                  ? (receipt.effect === 'damage' ? receipt.magnitude : Math.round(receipt.magnitude / 4))
                  : CombatMath.mobDamage(def) + (entity.bonusDamage ?? 0),
                status: receipt?.status,
                reachPx,
                abilityId: receipt?.abilityId,
                shooterId: entity.id,
                // Origin is 2D { x, y }
                origin: { x: entity.position.x, y: entity.position.y },
                angle: angle,
                startTime: now,
                color: 'red'
              });
            }
          }

          // The ground has a say: water, rock and trunks refuse the step, mud slows it
          let next = { x: entity.position.x + moveX, z: entity.position.y + moveY };
          if (map && (moveX !== 0 || moveY !== 0)) {
            next = WorldGenerator.resolveMove(map, entity.position.x, entity.position.y, moveX, moveY);
          }
          const movedX = next.x - entity.position.x;
          const movedY = next.z - entity.position.y;
          mem.moving = Math.abs(movedX) + Math.abs(movedY) > 0.1;
          if (mem.moving) {
            mem.facing = Math.abs(movedX) > Math.abs(movedY) ? (movedX > 0 ? 'right' : 'left') : (movedY > 0 ? 'down' : 'up');
          } else if (dist < 12 * PX) {
            // Standing its ground, it still watches you
            mem.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
          }

          // Return Updated Entity (Strictly 2D update)
          return {
            ...entity,
            health,
            statuses: statuses as never,
            telegraph: mem.windup ? { startedAt: mem.windup.startedAt, until: mem.windup.until, delivery: mem.windup.delivery, reachPx: mem.windup.reachPx, angle } : undefined,
            position: {
              x: next.x,
              y: next.z
              // No Z property here
            }
          };
        }

        mem.moving = false;
        return entity;
      });

      if (chunkWasModified) {
        // Key by the MAP key ("x,y"), not chunk.id, so merges replace instead of duplicate
        updatedChunks[chunkKey] = {
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

  /** Each swarm member holds its own slot on a ring around you: together they surround. */
  private static swarmSlot(entityId: string, playerPos: { x: number; y: number }): { x: number; y: number } {
    // The multiply avalanches the hash so near-identical ids still spread around the ring
    const h = Math.imul(fnv1a(`swarm:${entityId}`), 2654435761) >>> 0;
    const theta = (h / 0xffffffff) * Math.PI * 2;
    const r = 1.4 * PX;
    return { x: playerPos.x + Math.cos(theta) * r, y: playerPos.y + Math.sin(theta) * r };
  }

  private static decideAction(
    entityId: string,
    behavior: MobBehavior,
    kites: boolean,
    provoked: boolean,
    ctx: ICombatContext,
    mobPos: { x: number; y: number }
  ): IMobDecision {
    const dist = ctx.distanceToPlayer;

    switch (behavior) {
      case MobBehavior.TURRET:
        // It holds its ground. It does not chase, and it does not run.
        if (dist < 10 * PX) return { action: BehaviorPrimitive.ATTACK_RANGED };
        return { action: BehaviorPrimitive.IDLE };

      case MobBehavior.SWARM: {
        // Each one takes its own side BEFORE it bites: it walks to its slot on the
        // ring around you, and only bites once it stands there.
        const slot = this.swarmSlot(entityId, ctx.playerPos);
        const slotDist = Math.hypot(slot.x - mobPos.x, slot.y - mobPos.y);
        if (slotDist < 0.6 * PX && dist < 2.5 * PX) return { action: BehaviorPrimitive.ATTACK_MELEE };
        return { action: BehaviorPrimitive.APPROACH, targetPos: slot };
      }

      case MobBehavior.SIEGE:
        // Slow but inevitable: straight at you, and it never retreats.
        if (dist < 3 * PX) return { action: BehaviorPrimitive.ATTACK_MELEE };
        return { action: BehaviorPrimitive.APPROACH };

      case MobBehavior.PASSIVE:
        // It ignores you — until you hurt it, and then it leaves.
        return { action: provoked ? BehaviorPrimitive.FLEE : BehaviorPrimitive.IDLE };

      case MobBehavior.NEUTRAL:
        if (!provoked) return { action: BehaviorPrimitive.IDLE };
        if (dist < 2 * PX) return { action: BehaviorPrimitive.ATTACK_MELEE };
        return { action: BehaviorPrimitive.APPROACH };

      default: {
        if (dist < 2 * PX) return { action: BehaviorPrimitive.ATTACK_MELEE };
        // What fights at a distance keeps its distance
        if (kites) {
          if (dist < 8 * PX && dist > 4 * PX) return { action: BehaviorPrimitive.ATTACK_RANGED };
          if (dist <= 4 * PX) return { action: BehaviorPrimitive.FLEE };
        }
        return { action: BehaviorPrimitive.APPROACH };
      }
    }
  }
}
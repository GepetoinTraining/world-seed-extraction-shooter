import { MonsterMind } from '../../../logic/systems/MonsterMind';
import { GenreType } from '../../../../types';
import { IChunk, IMap, EntityType, IWorldEntity } from '../../world/types';
import { PatternType, PROJECTILE_RANGE_PX, SIM_MARGIN_PX } from '../../combat/projectileSystem';
import { MOB_DEFINITIONS } from '../data/mobDefinitions';
import { WorldClock } from '../../world/WorldClock';
import { Leaders } from '../../world/Leaders';
import { Wards } from '../../world/Wards';
import { NpcSheet } from '../../../logic/systems/NpcSheet';
import { Toll, useTollPrompt } from '../../../logic/systems/Toll';
import { chunkOf } from '../../world/grid';
import { WIDEST_VIEW_TILES } from '../../../logic/theme/ThemeFormula';
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
/** How a body heading for a fixed point turns when the ground refuses its line: its own side first, then the other. */
/** How long it keeps at a line that gets it no nearer before it stands where it is. A guess until Wave 12. */
const NO_PROGRESS_MS = 4000;
const TURNS_ASIDE = [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
/** A herd at rest walks at a share of its pace, and hurries when it has fallen behind. Guesses until Wave 12. */
const GRAZE_SHARE = 0.25;
const GRAZE_PERIOD_MS = 9000;
const GRAZE_RANGE_TILES = 7;
const GRAZE_SLOT_TILES = 2.5;
const HURRY_TILES = 4;
/** How close a tamed body walks to the person it follows. A guess until Wave 12. */
const FOLLOW_HEEL_PX = 2 * PX;
/** D93: how far a watch post sees a person, and how far a body told to hold will go from its ground. Guesses until Wave 12. */
const WATCH_TILES = 18;
const HOLD_TILES = 16;
/** How far the darkest night lets the widest sight reach. */
const WIDEST_SIGHT_PX = WIDEST_VIEW_TILES * WorldClock.noticeFactor(0) * PX;

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
  /** Which opening of a world the memory below belongs to: bodies are built again, and they keep ids. */
  private static memoryOf?: number;
  private static mobMemory: Record<string, {
    lastAttackTime: number;
    state: MobState;
    objective: MobObjective;
    facing: MobFacing;
    moving: boolean;
    provoked: boolean;
    /** N6: where it last knew you to be: where the last hit came from, or where it last saw you. */
    felt?: { x: number; y: number; safeAtPx: number; bestPx?: number; bestAt: number };
    feltNew?: boolean;
    /** Which way it turns past what refuses it. It keeps to one side, or it dithers at a wall. */
    aside?: 1 | -1;
    /** What it has started and not yet finished: seen, and dodged, before it lands. */
    windup?: { until: number; startedAt: number; receipt?: IEffectReceipt; delivery: string; reachPx: number; ranged: boolean };
    readyAt: Record<string, number>;
    casts: number;
    /** Where a herd at rest walks around, and where it is walking to now. */
    home?: { x: number; y: number };
    graze?: { period: number; x: number; y: number };
  }> = {};
  /** N7: where each body that was hit stood at the last tick. They stay simulated wherever they get to. */
  private static awake = new Map<string, string>();
  /** D65: bodies tamed for a while, until when, and where each stood at the last tick. */
  private static followers = new Map<string, { until: number; x: number; y: number }>();
  /** D93: territories with the alarm up. It stays up, once raised, for as long as the world stands open. */
  private static alarms = new Set<string>();

  static reset() {
    this.mobMemory = {};
    this.awake = new Map();
    this.followers = new Map();
    this.alarms = new Set();
    Wards.reset();
    Toll.reset();
  }

  static alarmUp(heldBy: string): boolean {
    return this.alarms.has(heldBy);
  }

  /** It walks at the person's heel until then, and what would come for the person comes for it, if it is nearer. */
  static follow(entityId: string, until: number) {
    this.followers.set(entityId, { until, x: 0, y: 0 });
  }

  static unfollow(entityId: string) {
    this.followers.delete(entityId);
  }

  static isFollowing(entityId: string): boolean {
    return this.followers.has(entityId);
  }

  private static nearerFollower(x: number, y: number, thanPx: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestPx = thanPx;
    for (const f of this.followers.values()) {
      const px = Math.hypot(f.x - x, f.y - y);
      if (px < bestPx) { best = f; bestPx = px; }
    }
    return best;
  }

  /**
   * What the field should tick. N7: the box reaches as far as a shot or the widest sight there is,
   * whichever is further, and N8: every chunk a body that was hit stands in, however far off.
   */
  static simulatedKeys(_map: IMap, px: number, py: number): string[] {
    const keys = new Set(WorldGenerator.chunkKeysInBox(px, py, Math.max(PROJECTILE_RANGE_PX + SIM_MARGIN_PX, WIDEST_SIGHT_PX)));
    for (const key of this.awake.values()) keys.add(key);
    return [...keys];
  }

  static clearMob(entityId: string) {
    delete this.mobMemory[entityId];
  }

  /** What the renderer needs: which way it looks and whether its legs move. */
  static pose(entityId: string): { facing: MobFacing; moving: boolean } | undefined {
    const mem = this.mobMemory[entityId];
    return mem ? { facing: mem.facing, moving: mem.moving } : undefined;
  }

  static isActive(entityId: string): boolean {
    return this.mobMemory[entityId]?.state === MobState.ACTIVE;
  }

  /** D114: has it been hurt? It stops talking then. */
  static isProvoked(entityId: string): boolean {
    return !!this.mobMemory[entityId]?.provoked;
  }

  /**
   * N6: a hit is always felt, from any distance. It wakes what would otherwise ignore
   * you, it stays awake, and it answers by its own behaviour. How it answers can evolve;
   * whether it notices cannot.
   */
  static provoke(entityId: string) {
    const mem = this.mobMemory[entityId];
    if (mem) { mem.provoked = true; mem.feltNew = true; if (mem.state === MobState.DORMANT) mem.state = MobState.ACTIVE; }
    else this.mobMemory[entityId] = { lastAttackTime: 0, state: MobState.ACTIVE, objective: MobObjective.KILL_PLAYER, facing: 'down', moving: false, provoked: true, feltNew: true, readyAt: {}, casts: 0 };
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
    senses: { noiseReduction?: number; light?: number; walk?: number } = {}
  ): {
    updatedChunks: Record<string, IChunk>;
    spawnedPatterns: any[]
  } {

    const updatedChunks: Record<string, IChunk> = {};
    const spawnedPatterns: any[] = [];
    const now = Date.now();
    if (map && map.generatedAt !== this.memoryOf) {
      this.memoryOf = map.generatedAt;
      this.reset();
    }
    if (senses.walk !== undefined) Wards.paced(Wards.live(), senses.walk);
    const herds = this.gatherHerds(visibleChunks);
    const crossings: { from: string; to: string; id: string }[] = [];
    const awake = new Map<string, string>();
    // Quieter gear shortens how far a thing notices you; loud gear lengthens it.
    // D71: and the dark lets it notice you from further away.
    const heard = NOISE_SCALE / Math.max(1, NOISE_SCALE + (senses.noiseReduction ?? 0)) * WorldClock.noticeFactor(senses.light ?? 1);
    this.watchPosts(visibleChunks, playerPos, heard);

    Object.entries(visibleChunks).forEach(([chunkKey, chunk]) => {
      let chunkWasModified = false;

      const newEntities = chunk.entities.map(standing => {
        // D93: a post comes back on its ward's clock, whole, and can be broken again
        if (standing.structure?.brokenAt !== undefined && standing.ward && Wards.read(standing.ward, Wards.live(), now).relit.includes(standing.id)) {
          Wards.restored(Wards.live(), standing.id);
          chunkWasModified = true;
          return { ...standing, health: standing.structure.maxHealth, structure: { ...standing.structure, brokenAt: undefined } };
        }
        // Validation
        if (standing.type !== EntityType.MOB || (standing.health || 0) <= 0) return standing;
        // D93: a boss is warded while its anchors stand, wherever they are and whoever is near them
        let entity = standing;
        if (entity.ward) {
          const warded = Wards.read(entity.ward, Wards.live(), now).warded;
          if (warded !== !!entity.warded) { entity = { ...entity, warded }; chunkWasModified = true; }
        }

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
        // D114: talked round, it leaves you be, and while someone is talking to it, it waits.
        const behavior = MonsterMind.behaviorOf(entity, def?.behavior ?? MobBehavior.AGGRESSIVE, mem.provoked);
        if (mem.provoked) awake.set(entity.id, chunkKey);
        if (entity.bargain?.holding && !mem.provoked) { mem.moving = false; return entity; }

        // D65: tamed for a while, it walks at the person's heel, and that is all it does
        const following = this.followers.get(entity.id);
        if (following) {
          if (now >= following.until) {
            this.followers.delete(entity.id);
          } else {
            awake.set(entity.id, chunkKey);
            const fx = playerPos.x - entity.position.x, fy = playerPos.y - entity.position.y;
            const away = Math.hypot(fx, fy);
            const step = (def?.speed ?? 2) * PX * deltaTime;
            const heel = away > FOLLOW_HEEL_PX ? Math.min(step, away - FOLLOW_HEEL_PX) : 0;
            const wantX = away > 0 ? (fx / away) * heel : 0, wantY = away > 0 ? (fy / away) * heel : 0;
            const walked = map && heel > 0 ? WorldGenerator.resolveMove(map, entity.position.x, entity.position.y, wantX, wantY) : { x: entity.position.x + wantX, z: entity.position.y + wantY };
            mem.moving = heel > 0.1;
            if (mem.moving) mem.facing = Math.abs(wantX) > Math.abs(wantY) ? (wantX > 0 ? 'right' : 'left') : (wantY > 0 ? 'down' : 'up');
            this.noteCrossing(crossings, awake, map, chunkKey, entity.id, walked.x, walked.z);
            following.x = walked.x;
            following.y = walked.z;
            chunkWasModified = true;
            return { ...entity, position: { x: walked.x, y: walked.z } };
          }
        }

        // 1. Build Context (2D Math)
        // Note: entity.position.y matches playerPos.y (which is World Z)
        const dx = playerPos.x - entity.position.x;
        const dy = playerPos.y - entity.position.y;
        const dist = Math.hypot(dx, dy);

        // D93: a solitary elite asks first. It stands, it waits, and it will not chase anyone who turns back
        if (Toll.asks(def) && !mem.provoked) {
          const owed = Toll.owed(entity.rank, map ? NpcSheet.statsOf(map.seed, entity).bartering : 0);
          const status = Toll.meet(Toll.live(), entity.id, dist / PX, owed, now);
          const shown = useTollPrompt.getState().asking?.entityId === entity.id;
          if (status === 'ASKING' && !shown) useTollPrompt.setState({ asking: { entityId: entity.id, owed, until: Toll.live().askedAt[entity.id] + Toll.GRACE_MS } });
          else if (status !== 'ASKING' && shown) useTollPrompt.setState({ asking: null });
          if (status === 'FIGHT') this.provoke(entity.id);
          else { mem.moving = false; return entity; }
        }

        // 2. Activation by the definition's own senses. Neutral things stir only
        // when touched or provoked; passive things only when provoked.
        const sightTiles = (def?.viewRange ?? 8) * heard;
        const aggroTiles =
          // R4: neutral is neutral. Standing near it provokes nothing; only harm does.
          behavior === MobBehavior.NEUTRAL ? 0 :
          behavior === MobBehavior.PASSIVE ? 0 :
          sightTiles;
        // A floor, not a ceiling: it grows with sight, so it never cuts sight short.
        const leashTiles = Math.max(16, aggroTiles * 2);
        const seen = dist < sightTiles * PX;
        // N6: a hit comes from where the person stands now, and that stays once they leave.
        if (mem.feltNew || (mem.provoked && seen)) {
          mem.feltNew = false;
          mem.felt = { x: playerPos.x, y: playerPos.y, safeAtPx: dist + sightTiles * PX, bestAt: now };
        }
        if (mem.state === MobState.DORMANT) {
          if ((aggroTiles > 0 && dist < aggroTiles * PX) || mem.provoked) {
            mem.state = MobState.ACTIVE;
            // R4: waking is not striking. The first blow waits its turn like every other.
            mem.lastAttackTime = now - ATTACK_COOLDOWN_MS + STRIKE_WINDUP_MS;
          }
        } else if (!mem.provoked && dist > leashTiles * PX) {
          mem.state = MobState.DORMANT;
          mem.moving = false;
        }

        // 3. Process Active Mobs
        if (mem.state === MobState.ACTIVE) {
          chunkWasModified = true;

          // What it answers: you, while it can see you; past that, where it last knew you to be.
          const unseen = mem.provoked && !seen;
          // D65: what walks beside a person draws off what would come for them, if it is nearer.
          const decoy = this.followers.size > 0 ? this.nearerFollower(entity.position.x, entity.position.y, dist) : null;
          const threat = decoy ?? (unseen ? { x: mem.felt!.x, y: mem.felt!.y } : playerPos);
          const toThreat = { x: threat.x - entity.position.x, y: threat.y - entity.position.y };

          const ctx: ICombatContext = {
            distanceToPlayer: decoy ? Math.hypot(toThreat.x, toThreat.y) : dist,
            mobHpPercent: (entity.health || 100) / 100,
            playerPos: { x: threat.x, y: threat.y },
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
          const angle = Math.atan2(toThreat.y, toThreat.x);
          const approachTo = decision.targetPos ?? (unseen ? threat : undefined);

          if (decision.action === BehaviorPrimitive.APPROACH && approachTo) {
            const tx = approachTo.x - entity.position.x;
            const ty = approachTo.y - entity.position.y;
            const reach = Math.hypot(tx, ty);
            if (reach > 2) {
              moveX = (tx / reach) * Math.min(moveSpeed, reach);
              moveY = (ty / reach) * Math.min(moveSpeed, reach);
            }
          } else if (decision.action === BehaviorPrimitive.APPROACH) {
            moveX = Math.cos(angle) * moveSpeed;
            moveY = Math.sin(angle) * moveSpeed;
          } else if (decision.action === BehaviorPrimitive.FLEE && !(unseen && Math.hypot(toThreat.x, toThreat.y) >= mem.felt!.safeAtPx)) {
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

          // N6: nothing here can see a way round a lake. It tries, then it stands, awake.
          if (unseen && (moveX !== 0 || moveY !== 0)) {
            const gain = (decision.action === BehaviorPrimitive.FLEE ? 1 : -1) * Math.hypot(toThreat.x, toThreat.y);
            if (mem.felt!.bestPx === undefined || gain > mem.felt!.bestPx + 1) { mem.felt!.bestPx = gain; mem.felt!.bestAt = now; }
            if (now - mem.felt!.bestAt > NO_PROGRESS_MS) { moveX = 0; moveY = 0; }
          }

          // D93: standing orders. Told to fall back, hurt, it heads for its seat. Told to hold, it stays on its ground
          if (entity.orders) {
            const whole = (def?.baseHealth ?? 100) + (entity.bonusHealth ?? 0);
            const home = mem.home ?? (mem.home = { x: entity.position.x, y: entity.position.y });
            if (entity.orders.posture === 'fall_back' && entity.orders.seat && (entity.health ?? whole) * 2 < whole) {
              const toSeat = Math.atan2(entity.orders.seat.y - entity.position.y, entity.orders.seat.x - entity.position.x);
              moveX = Math.cos(toSeat) * moveSpeed;
              moveY = Math.sin(toSeat) * moveSpeed;
            } else if (entity.orders.posture === 'hold' && Math.hypot(entity.position.x + moveX - home.x, entity.position.y + moveY - home.y) > HOLD_TILES * PX) {
              moveX = 0;
              moveY = 0;
            }
          }

          // The ground has a say: water, rock and trunks refuse the step, mud slows it
          let next = { x: entity.position.x + moveX, z: entity.position.y + moveY };
          if (map && (moveX !== 0 || moveY !== 0)) {
            next = WorldGenerator.resolveMove(map, entity.position.x, entity.position.y, moveX, moveY);
            // A person moves, so a chase's line shifts past a trunk. A fixed point's does not.
            const asked = Math.hypot(moveX, moveY);
            if (unseen && Math.hypot(next.x - entity.position.x, next.z - entity.position.y) < asked / 2) {
              const side = mem.aside ?? 1;
              for (const turn of TURNS_ASIDE) {
                const cos = Math.cos(turn * side), sin = Math.sin(turn * side);
                const aside = WorldGenerator.resolveMove(map, entity.position.x, entity.position.y, moveX * cos - moveY * sin, moveX * sin + moveY * cos);
                if (Math.hypot(aside.x - entity.position.x, aside.z - entity.position.y) >= asked / 2) {
                  next = aside;
                  mem.aside = turn < 0 ? (side === 1 ? -1 : 1) : side;
                  break;
                }
              }
            }
          }
          const movedX = next.x - entity.position.x;
          const movedY = next.z - entity.position.y;
          mem.moving = Math.abs(movedX) + Math.abs(movedY) > 0.1;
          this.noteCrossing(crossings, awake, map, chunkKey, entity.id, next.x, next.z);
          if (mem.moving) {
            mem.facing = Math.abs(movedX) > Math.abs(movedY) ? (movedX > 0 ? 'right' : 'left') : (movedY > 0 ? 'down' : 'up');
          } else if (dist < 12 * PX) {
            // Standing its ground, it still watches you
            mem.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
          } else if (unseen && Math.hypot(toThreat.x, toThreat.y) > 2) {
            // It cannot see you, and it looks where the hit came from
            mem.facing = Math.abs(toThreat.x) > Math.abs(toThreat.y) ? (toThreat.x > 0 ? 'right' : 'left') : (toThreat.y > 0 ? 'down' : 'up');
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

        // A herd at rest walks together, around its home or behind its leader
        const herdKey = (def as { social?: boolean } | undefined)?.social ? Leaders.herdOf(entity.id) : undefined;
        const grazing = herdKey ? this.graze(entity, mem, herds.get(herdKey)!, herdKey, def?.speed ?? 2, deltaTime, now, map) : null;
        if (grazing) {
          chunkWasModified = true;
          this.noteCrossing(crossings, awake, map, chunkKey, entity.id, grazing.x, grazing.y);
          return { ...entity, position: grazing };
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

    // N8: a body lives in the chunk under its feet, so it is simulated where it stands
    for (const { from, to, id } of crossings) {
      const source = updatedChunks[from];
      const moved = source?.entities.find(e => e.id === id);
      const target = updatedChunks[to] ?? visibleChunks[to] ?? map?.chunks[to];
      if (!moved || !target) continue;
      updatedChunks[from] = { ...source, entities: source.entities.filter(e => e.id !== id) };
      updatedChunks[to] = { ...target, entities: [...target.entities, moved] };
    }
    this.awake = awake;

    return { updatedChunks, spawnedPatterns };
  }

  /** A step took this body over a chunk line. It moves across with the rest of the tick, if that chunk is built. */
  private static noteCrossing(
    crossings: { from: string; to: string; id: string }[], awake: Map<string, string>, map: IMap | undefined,
    from: string, id: string, x: number, y: number
  ) {
    if (!map) return;
    const to = `${chunkOf(x)},${chunkOf(y)}`;
    if (to === from || !map.chunks[to]) return;
    crossings.push({ from, to, id });
    if (awake.has(id)) awake.set(id, to);
  }

  /**
   * D93: what a territory's alarm does. A watch post that sees a person raises it, and so does a hit
   * on anyone whose orders say it calls for help. Once it is up, what answers to that seat comes.
   */
  private static watchPosts(visibleChunks: Record<string, IChunk>, playerPos: { x: number; y: number }, heard: number) {
    for (const chunk of Object.values(visibleChunks)) {
      for (const e of chunk.entities) {
        const post = e.structure;
        if (post?.fn === 'watch' && post.built && post.alarm && post.brokenAt === undefined
          && Math.hypot(playerPos.x - e.position.x, playerPos.y - e.position.y) < WATCH_TILES * heard * PX) this.alarms.add(post.heldBy);
        if (e.type === EntityType.MOB && e.heldBy && e.orders?.alarmCalls && this.mobMemory[e.id]?.feltNew) this.alarms.add(e.heldBy);
      }
    }
    if (this.alarms.size === 0) return;
    for (const chunk of Object.values(visibleChunks)) {
      for (const e of chunk.entities) {
        if (e.type === EntityType.MOB && e.heldBy && this.alarms.has(e.heldBy) && !this.mobMemory[e.id]?.provoked) this.provoke(e.id);
      }
    }
  }

  /**
   * Who walks with whom this tick. A hit on one of a herd is felt by the rest (N6's `felt`,
   * shared), and each answers by its own behaviour. Only a social kind has a herd.
   */
  private static gatherHerds(visibleChunks: Record<string, IChunk>) {
    const herds = new Map<string, { anchor: { id: string; x: number; y: number }; members: string[]; struck: boolean }>();
    for (const chunk of Object.values(visibleChunks)) {
      for (const e of chunk.entities) {
        if (e.type !== EntityType.MOB || (e.health || 0) <= 0) continue;
        if (!(MOB_DEFINITIONS[e.definitionId] as { social?: boolean } | undefined)?.social) continue;
        const key = Leaders.herdOf(e.id);
        if (!key) continue;
        let herd = herds.get(key);
        if (!herd) { herd = { anchor: { id: e.id, x: e.position.x, y: e.position.y }, members: [], struck: false }; herds.set(key, herd); }
        herd.members.push(e.id);
        // The first by id leads a herd: a leader's own id sorts before its pack's
        if (e.id < herd.anchor.id) herd.anchor = { id: e.id, x: e.position.x, y: e.position.y };
        if (this.mobMemory[e.id]?.feltNew) herd.struck = true;
      }
    }
    for (const herd of herds.values()) {
      if (!herd.struck) continue;
      for (const id of herd.members) if (!this.mobMemory[id]?.provoked) this.provoke(id);
    }
    return herds;
  }

  /** One step of a herd at rest. Null when it stands. */
  private static graze(
    entity: IWorldEntity, mem: typeof MobAI.mobMemory[string], herd: { anchor: { id: string; x: number; y: number } },
    herdKey: string, speed: number, deltaTime: number, now: number, map?: IMap
  ): { x: number; y: number } | null {
    const home = mem.home ?? (mem.home = { x: entity.position.x, y: entity.position.y });
    let tx: number, ty: number;
    if (herd.anchor.id === entity.id) {
      // What leads walks to a keyed place near home, a new one each while
      const period = Math.floor(now / GRAZE_PERIOD_MS) + (fnv1a(herdKey) % 7);
      if (mem.graze?.period !== period) {
        const a = fnv1a(`graze:${herdKey}:${period}`), b = fnv1a(`graze:${herdKey}:${period}:far`);
        const theta = (a / 0x100000000) * Math.PI * 2, r = (b / 0x100000000) * GRAZE_RANGE_TILES * PX;
        mem.graze = { period, x: home.x + Math.cos(theta) * r, y: home.y + Math.sin(theta) * r };
      }
      tx = mem.graze.x; ty = mem.graze.y;
    } else {
      // What follows keeps its own place beside what leads
      const slot = this.swarmSlot(entity.id, { x: 0, y: 0 });
      tx = herd.anchor.x + slot.x / 1.4 * GRAZE_SLOT_TILES; ty = herd.anchor.y + slot.y / 1.4 * GRAZE_SLOT_TILES;
    }
    const dx = tx - entity.position.x, dy = ty - entity.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < PX / 2) { mem.moving = false; return null; }
    const share = dist > HURRY_TILES * PX ? 1 : GRAZE_SHARE;
    const step = Math.min(dist, speed * PX * deltaTime * share);
    const moveX = (dx / dist) * step, moveY = (dy / dist) * step;
    const next = map ? WorldGenerator.resolveMove(map, entity.position.x, entity.position.y, moveX, moveY) : { x: entity.position.x + moveX, z: entity.position.y + moveY };
    const movedX = next.x - entity.position.x, movedY = next.z - entity.position.y;
    mem.moving = Math.abs(movedX) + Math.abs(movedY) > 0.1;
    if (!mem.moving) return null;
    mem.facing = Math.abs(movedX) > Math.abs(movedY) ? (movedX > 0 ? 'right' : 'left') : (movedY > 0 ? 'down' : 'up');
    return { x: next.x, y: next.z };
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
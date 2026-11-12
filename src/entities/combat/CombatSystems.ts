import { POISON_MS, POISON_TICK_MS } from '../../../shared/logic/systems/FightNumbers';
import { IProjectile, ProjectileSystem } from '../../../shared/entities/combat/projectileSystem';
import { IWorldEntity, EntityType, IChunk, IMap } from '../../../shared/entities/world/types';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { LootTable } from '../world/LootTable';
import { MonsterMind } from '../../logic/systems/MonsterMind';
import { LoreDrops } from '../../../shared/logic/systems/LoreDrops';
import { IItem, UniversalRank, Rarity } from '../../../shared/types';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { SessionJournal } from '../../logic/journal/SessionJournal';
import { IStatusPlan, StatusClock } from '../../../shared/logic/systems/EffectSystem';
import { bodyRadiusPx, covers, pushFrom } from '../../../shared/entities/combat/Shapes';
import { bodyPoise, feltHit } from '../../../shared/logic/theme/ThemeFormula';
import { WorldGenerator } from '../../../shared/entities/world/WorldGenerator';
import { laidKind } from '../../../shared/entities/mob/BodyLaw';

/** The fight's shapes: a swing as it lands. `inner` and `half` are its hole and its half-width; a swing that names none is the old arc. */
export interface IMeleeArc {
  origin: { x: number; y: number }; angle: number; range: number; inner?: number; half?: number;
  startTime: number; damage?: number; poison?: number; status?: IStatusPlan; hitIds?: Set<string>;
  /** Part 2: what the blow weighs, so what it lands on feels it. None is not felt (an escort's bare hand). */
  weight?: number;
  /** SH3: the blow glanced when it was let go. */
  glance?: boolean;
}
/**
 * SH4: how near a shot must pass a body's middle to land. A shot is drawn 4 px across, so it lands on any part of a
 * body it is drawn over: the body's drawn half-width (`bodyRadiusPx`) and the shot's own. Never less than the 20 px
 * the field has always given, so nothing small is harder to hit than it was; a gigantic body (64 px across) or a
 * colossal one (96) is now struck where a shot is seen to cross it.
 */
export const SHOT_LANDS_PX = 20;
const SHOT_HALF_PX = 2;
export const shotLandsWithinPx = (size?: string): number => Math.max(SHOT_LANDS_PX, bodyRadiusPx(size) + SHOT_HALF_PX);
/** The arc every swing was before shapes, and an escort's still is. */
const OLD_HALF_ANGLE = 0.75;
/** How much ground a body takes: half its drawn width, by its size word (a post or a structure is a middling one). */
const radiusOf = (ent: IWorldEntity) => bodyRadiusPx(MOB_DEFINITIONS[ent.definitionId]?.size);

export interface ICombatEvent {
  type: 'HIT' | 'KILL' | 'LOOT_SPAWN' | 'PLAYER_DAMAGE' | 'ACTION_LOG' | 'WARDED' | 'BROKE' | 'STAGGER';
  /** Part 2: a hit felt broke the wind-up its body stood for. */
  broke?: boolean;
  /** Part 2: which way a hit felt pushed it, and how far. */
  push?: { dx: number; dy: number };
  /** SH3: the blow that landed glanced, so half of it landed. */
  glance?: boolean;
  entityId?: string;
  definitionId?: string;
  displayName?: string;
  damage?: number;
  position?: { x: number; y: number };
  loot?: IItem[];
  xpReward?: {
    amount: number;
    sourceRank: UniversalRank;
    sourceRarity: Rarity;
  };
  actionContext?: {
    targetTags?: string[];
    targetRank?: string;
    tags: string[];
    magnitude: number;
  };
}

/** How long poison keeps working after the hit, and how often it bites. Guesses until Wave 12. */

const poisoned = (mob: IWorldEntity, perTick: number, now: number) => {
  mob.statuses = StatusClock.add(mob.statuses as never, { kind: 'dot', magnitude: perTick, durationMs: POISON_MS, tickMs: POISON_TICK_MS }, now) as never;
};

/** D93: what a blow lands on. A body, or something a leader raised that stands to be broken. SH5: the attack key aims only at such a thing. */
export const landsOn = (ent: Pick<IWorldEntity, 'type' | 'structure'>) =>
  ent.type === EntityType.MOB || (ent.type === EntityType.STRUCTURE && !!ent.structure && ent.structure.brokenAt === undefined);
const isTarget = landsOn;

const struck = (mob: IWorldEntity, status: IStatusPlan | undefined, now: number) => {
  if (status) mob.statuses = StatusClock.add(mob.statuses as never, status, now) as never;
};

export class CombatSystem {
  
  static tick(
    bullets: IProjectile[],
    chunks: Record<string, IChunk>,
    playerPos: { x: number; y: number; z: number },
    playerHealth: number,
    meleeArcs: IMeleeArc[],
    opts: { magicFind?: number; groundVersion?: number; luck?: number; map?: IMap } = {}
  ): {
    events: ICombatEvent[]; 
    updatedChunks: Record<string, IChunk>;
    survivingBullets: IProjectile[];
    playerDamage: number;
    spawnedLoot: { position: { x: number; y: number }; items: IItem[] }[];
  } {
    const events: ICombatEvent[] = [];
    // Worlds resumed from the database are read-only, so enemies are copied before any change.
    const updatedChunks: Record<string, IChunk> = {};
    Object.entries(chunks).forEach(([key, chunk]) => {
      updatedChunks[key] = {
        ...chunk,
        entities: chunk.entities.map(ent => (isTarget(ent) ? { ...ent, ...(ent.structure ? { structure: { ...ent.structure } } : {}) } : ent))
      };
    });
    const spawnedLoot: { position: { x: number; y: number }; items: IItem[] }[] = [];
    let playerDamage = 0;
    let survivingBullets = [...bullets];

    const allMobs: { mob: IWorldEntity; chunkKey: string }[] = [];
    Object.entries(updatedChunks).forEach(([key, chunk]) => {
      chunk.entities.forEach(ent => {
        if (isTarget(ent) && ent.health && ent.health > 0) {
          allMobs.push({ mob: ent, chunkKey: key });
        }
      });
    });

    const resolveDefeat = (mob: IWorldEntity, chunkKey: string) => {
      // A post stands where it was, down, until its ward's clock says otherwise. It teaches nothing and drops nothing
      if (mob.structure) {
        mob.structure.brokenAt = Date.now();
        events.push({ type: 'BROKE', entityId: mob.id, definitionId: mob.definitionId, position: mob.position });
        return;
      }
      const xpAmount = ProgressionSystem.calculateKillXp(mob.rank, mob.rarity, 1);
      events.push({
        type: 'KILL',
        entityId: mob.id,
        definitionId: mob.definitionId,
        displayName: mob.displayName,
        position: mob.position,
        xpReward: { amount: xpAmount, sourceRank: mob.rank, sourceRarity: mob.rarity }
      });

      // GS3: a body on a ground that ranks it leaves what it leaves at the rank it stood at
      const kind = MOB_DEFINITIONS[mob.definitionId];
      const def = kind ? laidKind(kind, mob) : undefined;
      if (def) {
        const rollKey = SessionJournal.rollKey('loot', mob.id);
        const origin = chunks[chunkKey];
        const loot = LootTable.generateLoot(def, 1.0, origin ? {
          chunkX: origin.x,
          chunkY: origin.y,
          layerId: 'field',
          biome: origin.biome,
          magicFind: opts.magicFind ?? 1.0,
          quantityBonus: 1.0
        } : undefined, rollKey, mob.displayName, opts.groundVersion, opts.luck ?? 0, { bonusHealth: mob.bonusHealth, bonusDamage: mob.bonusDamage });
        // The lore pass, call 6: a creature with a mind leaves a fragment "sometimes", in a world pinned to it
        if (MonsterMind.holds(def) && LoreDrops.fragment('creature', rollKey, opts.groundVersion)) loot.push(LootTable.loreFragment(rollKey, (def as { themeId?: string }).themeId));
        const onTable = LootTable.creatureRoll(def, rollKey);
        SessionJournal.record('KILL', { mobId: mob.id, defId: mob.definitionId, rollKey, drops: loot.map(l => l.id), ...(onTable ? { table: onTable } : {}), ...(def !== kind ? { laidAt: def.rank } : {}) });
        if (loot.length > 0) {
          spawnedLoot.push({ position: mob.position, items: loot });
          events.push({ type: 'LOOT_SPAWN', position: mob.position, loot });
        }
      }

      const chunk = updatedChunks[chunkKey];
      if (chunk) {
        updatedChunks[chunkKey] = {
          ...chunk,
          entities: chunk.entities.filter(e => e.id !== mob.id)
        };
      }
    };

    // 0. WHAT IS ALREADY WORKING ON THEM
    const tickNow = Date.now();

    // Part 2: a hit is felt. That share of a tile pushed from the striker, that share of pace lost for that share
    // of a second, and the wind-up it stood for broken when the blow weighs at least what the body stands
    const felt = (mob: IWorldEntity, weight: number | undefined, from: { x: number; y: number }) => {
      if (weight === undefined || mob.structure || (mob.health ?? 0) <= 0) return;
      const hit = feltHit(weight, bodyPoise(MOB_DEFINITIONS[mob.definitionId]?.size));
      const push = pushFrom(from, mob.position, hit.pushPx);
      const to = opts.map ? WorldGenerator.resolveMove(opts.map, mob.position.x, mob.position.y, push.dx, push.dy) : { x: mob.position.x + push.dx, z: mob.position.y + push.dy };
      mob.position = { x: to.x, y: to.z };
      mob.statuses = StatusClock.add(mob.statuses as never, hit.pause, tickNow) as never;
      events.push({ type: 'STAGGER', entityId: mob.id, definitionId: mob.definitionId, position: mob.position, broke: hit.breaks, push });
    };
    allMobs.forEach(({ mob, chunkKey }) => {
      if (!mob.statuses?.length) return;
      const { damage, statuses } = StatusClock.tick(mob.statuses as never, tickNow);
      mob.statuses = statuses as never;
      if (damage > 0 && !mob.warded) {
        mob.health = (mob.health ?? 0) - damage;
        events.push({ type: 'HIT', entityId: mob.id, definitionId: mob.definitionId, damage, position: mob.position });
        if (mob.health <= 0) resolveDefeat(mob, chunkKey);
      }
    });

    // 1. BULLET -> MOB
    const bulletsToRemove = new Set<number>();

    bullets.forEach((bullet, bulletIdx) => {
      for (const { mob, chunkKey } of allMobs) {
        if (!mob.health || mob.health <= 0) continue;

        // SH4: any part of the body the shot is drawn over, never under 20 px
        if (ProjectileSystem.sweptDistance(bullet, mob.position.x, mob.position.y) >= shotLandsWithinPx(MOB_DEFINITIONS[mob.definitionId]?.size)) continue;

        // The fight's shapes: a volley lands once on one body. Its other shots stop there and do nothing
        if (bullet.struck?.has(mob.id)) {
          bulletsToRemove.add(bulletIdx);
          break;
        }
        bullet.struck?.add(mob.id);

        // D93: while its anchors stand the blow lands on nothing. It is spent, and it says so
        if (mob.warded) {
          bulletsToRemove.add(bulletIdx);
          events.push({ type: 'WARDED', entityId: mob.id, definitionId: mob.definitionId, position: mob.position });
          break;
        }

        const damage = bullet.damage ?? 25;
        mob.health -= damage;
        if (bullet.poison) poisoned(mob, bullet.poison, tickNow);
        struck(mob, bullet.status, tickNow);
        felt(mob, bullet.weight, { x: mob.position.x - Math.cos(bullet.angle), y: mob.position.y - Math.sin(bullet.angle) });
        bulletsToRemove.add(bulletIdx);

        events.push({
          type: 'ACTION_LOG',
          actionContext: {
              tags: ['ranged', 'projectile', 'tech', 'precision'],
              magnitude: damage,
              targetTags: MOB_DEFINITIONS[mob.definitionId]?.tags,
              targetRank: mob.rank
          }
        });

        events.push({ type: 'HIT', entityId: mob.id, definitionId: mob.definitionId, damage, position: mob.position, ...(bullet.glance ? { glance: true } : {}) });

        if (mob.health <= 0) resolveDefeat(mob, chunkKey);
        break; // a projectile is spent on its first target
      }
    });

    survivingBullets = bullets.filter((_, idx) => !bulletsToRemove.has(idx));

    // 2. MELEE -> MOB
    const now = Date.now();
    meleeArcs.forEach(arc => {
      if (now - arc.startTime > 200) return;
      const hitIds = arc.hitIds ?? (arc.hitIds = new Set<string>());

      allMobs.forEach(({ mob, chunkKey }) => {
        if (!mob.health || mob.health <= 0) return;
        if (hitIds.has(mob.id)) return; // one swing lands once per target
        // The fight's shapes: what is struck is exactly what the drawn shape covers, any part of a body
        const shape = { reachPx: arc.range, innerPx: arc.inner ?? 0, halfAngle: arc.half ?? OLD_HALF_ANGLE };
        if (covers(shape, arc.origin, arc.angle, mob.position, radiusOf(mob))) {
          if (mob.warded) {
            hitIds.add(mob.id);
            events.push({ type: 'WARDED', entityId: mob.id, definitionId: mob.definitionId, position: mob.position });
            return;
          }
          const damage = arc.damage ?? 50; // Wave 4: the weapon decides
          mob.health -= damage;
          if (arc.poison) poisoned(mob, arc.poison, tickNow);
          struck(mob, arc.status, tickNow);
          felt(mob, arc.weight, arc.origin);
          hitIds.add(mob.id);

          // ACTION: Melee Hit
          events.push({
            type: 'ACTION_LOG',
            actionContext: {
                tags: ['melee', 'physical', 'violence', 'blade'],
                magnitude: damage,
                targetTags: MOB_DEFINITIONS[mob.definitionId]?.tags,
                targetRank: mob.rank
            }
          });

          events.push({ type: 'HIT', entityId: mob.id, definitionId: mob.definitionId, damage, position: mob.position, ...(arc.glance ? { glance: true } : {}) });

          if (mob.health <= 0) resolveDefeat(mob, chunkKey);
        }
      });
    });

    // 3. MOB -> PLAYER: nothing here. Part 3: what is hit is exactly what a drawn shape covers, so standing on a body
    // costs nothing by itself; a body's blow is its wind-up's shape, resolved by the field (WorldCanvas)

    return { events, updatedChunks, survivingBullets, playerDamage, spawnedLoot };
  }

  static checkLootPickup(playerPos: any, lootDrops: any, pickupRadius: number = 2.0) {
      const pickedUp: any[] = [];
      const remainingDrops: any[] = [];
      lootDrops.forEach((drop: any) => {
          const dx = playerPos.x - drop.position.x;
          const dy = playerPos.z - drop.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < pickupRadius) pickedUp.push(...drop.items);
          else remainingDrops.push(drop);
      });
      return { pickedUp, remainingDrops };
  }
}
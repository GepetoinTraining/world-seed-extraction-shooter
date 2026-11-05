import { IProjectile, ProjectileSystem } from './projectileSystem';
import { IWorldEntity, EntityType, IChunk } from '../world/types';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { LootTable } from '../world/LootTable';
import { IItem, UniversalRank, Rarity } from '../../../types';
import { ProgressionSystem } from '../player/systems/ProgressionSystem';
import { SessionJournal } from '../../logic/journal/SessionJournal';
import { IStatusPlan, StatusClock } from '../../logic/systems/EffectSystem';

export interface ICombatEvent {
  type: 'HIT' | 'KILL' | 'LOOT_SPAWN' | 'PLAYER_DAMAGE' | 'ACTION_LOG' | 'WARDED' | 'BROKE';
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
const POISON_MS = 3000;
const POISON_TICK_MS = 1000;

const poisoned = (mob: IWorldEntity, perTick: number, now: number) => {
  mob.statuses = StatusClock.add(mob.statuses as never, { kind: 'dot', magnitude: perTick, durationMs: POISON_MS, tickMs: POISON_TICK_MS }, now) as never;
};

/** D93: what a blow lands on. A body, or something a leader raised that stands to be broken. */
const isTarget = (ent: IWorldEntity) =>
  ent.type === EntityType.MOB || (ent.type === EntityType.STRUCTURE && !!ent.structure && ent.structure.brokenAt === undefined);

const struck = (mob: IWorldEntity, status: IStatusPlan | undefined, now: number) => {
  if (status) mob.statuses = StatusClock.add(mob.statuses as never, status, now) as never;
};

export class CombatSystem {
  
  static tick(
    bullets: IProjectile[],
    chunks: Record<string, IChunk>,
    playerPos: { x: number; y: number; z: number },
    playerHealth: number,
    meleeArcs: { origin: { x: number; y: number }; angle: number; range: number; startTime: number; damage?: number; poison?: number; status?: IStatusPlan; hitIds?: Set<string> }[],
    opts: { magicFind?: number } = {}
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

      const def = MOB_DEFINITIONS[mob.definitionId];
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
        } : undefined, rollKey, mob.displayName);
        const onTable = LootTable.creatureRoll(def, rollKey);
        SessionJournal.record('KILL', { mobId: mob.id, defId: mob.definitionId, rollKey, drops: loot.map(l => l.id), ...(onTable ? { table: onTable } : {}) });
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

        // px: mob radius (12) + bullet radius + grace
        if (ProjectileSystem.sweptDistance(bullet, mob.position.x, mob.position.y) >= 20) continue;

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

        events.push({ type: 'HIT', entityId: mob.id, definitionId: mob.definitionId, damage, position: mob.position });

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
        const dx = mob.position.x - arc.origin.x;
        const dy = mob.position.y - arc.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > arc.range) return;
        const angleToMob = Math.atan2(dy, dx);
        const angleDiff = Math.abs(angleToMob - arc.angle);
        
        if (angleDiff < 0.75 || angleDiff > Math.PI * 2 - 0.75) {
          if (mob.warded) {
            hitIds.add(mob.id);
            events.push({ type: 'WARDED', entityId: mob.id, definitionId: mob.definitionId, position: mob.position });
            return;
          }
          const damage = arc.damage ?? 50; // Wave 4: the weapon decides
          mob.health -= damage;
          if (arc.poison) poisoned(mob, arc.poison, tickNow);
          struck(mob, arc.status, tickNow);
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

          events.push({ type: 'HIT', entityId: mob.id, definitionId: mob.definitionId, damage, position: mob.position });

          if (mob.health <= 0) resolveDefeat(mob, chunkKey);
        }
      });
    });

    // 3. MOB -> PLAYER
    allMobs.forEach(({ mob }) => {
      if (!mob.health || mob.health <= 0 || !mob.isHostile) return;
      const dx = playerPos.x - mob.position.x;
      const dy = playerPos.z - mob.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 1.0) {
        const def = MOB_DEFINITIONS[mob.definitionId];
        const damage = def?.baseDamage || 10;
        playerDamage += damage;
        
        // ACTION: Took Damage
        events.push({
            type: 'ACTION_LOG',
            actionContext: {
                tags: ['defense', 'pain', 'durability'],
                magnitude: damage
            }
        });

        events.push({ type: 'PLAYER_DAMAGE', damage, entityId: mob.id });
      }
    });

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
import { IProjectile, ProjectileSystem } from './projectileSystem';
import { IWorldEntity, EntityType, IChunk } from '../world/types';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { LootTable } from '../world/LootTable';
import { IItem, UniversalRank, Rarity } from '../../../types';
import { ProgressionSystem } from '../player/systems/ProgressionSystem';
import { SessionJournal } from '../../logic/journal/SessionJournal';

export interface ICombatEvent {
  type: 'HIT' | 'KILL' | 'LOOT_SPAWN' | 'PLAYER_DAMAGE' | 'ACTION_LOG';
  entityId?: string;
  definitionId?: string;
  damage?: number;
  position?: { x: number; y: number };
  loot?: IItem[];
  xpReward?: {
    amount: number;
    sourceRank: UniversalRank;
    sourceRarity: Rarity;
  };
  actionContext?: {
    tags: string[];
    magnitude: number;
  };
}

export class CombatSystem {
  
  static tick(
    bullets: IProjectile[],
    chunks: Record<string, IChunk>,
    playerPos: { x: number; y: number; z: number },
    playerHealth: number,
    meleeArcs: { origin: { x: number; y: number }; angle: number; range: number; startTime: number; damage?: number; hitIds?: Set<string> }[]
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
        entities: chunk.entities.map(ent => (ent.type === EntityType.MOB ? { ...ent } : ent))
      };
    });
    const spawnedLoot: { position: { x: number; y: number }; items: IItem[] }[] = [];
    let playerDamage = 0;
    let survivingBullets = [...bullets];

    const allMobs: { mob: IWorldEntity; chunkKey: string }[] = [];
    Object.entries(updatedChunks).forEach(([key, chunk]) => {
      chunk.entities.forEach(ent => {
        if (ent.type === EntityType.MOB && ent.health && ent.health > 0) {
          allMobs.push({ mob: ent, chunkKey: key });
        }
      });
    });

    const resolveDefeat = (mob: IWorldEntity, chunkKey: string) => {
      const xpAmount = ProgressionSystem.calculateKillXp(mob.rank, mob.rarity, 1);
      events.push({
        type: 'KILL',
        entityId: mob.id,
        definitionId: mob.definitionId,
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
          magicFind: 1.0,
          quantityBonus: 1.0
        } : undefined, rollKey);
        SessionJournal.record('KILL', { mobId: mob.id, defId: mob.definitionId, rollKey, drops: loot.map(l => l.id) });
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

    // 1. BULLET -> MOB
    const bulletsToRemove = new Set<number>();

    bullets.forEach((bullet, bulletIdx) => {
      for (const { mob, chunkKey } of allMobs) {
        if (!mob.health || mob.health <= 0) continue;

        // px: mob radius (12) + bullet radius + grace
        if (ProjectileSystem.sweptDistance(bullet, mob.position.x, mob.position.y) >= 20) continue;

        const damage = bullet.damage ?? 25;
        mob.health -= damage;
        bulletsToRemove.add(bulletIdx);

        events.push({
          type: 'ACTION_LOG',
          actionContext: {
              tags: ['ranged', 'projectile', 'tech', 'precision'],
              magnitude: damage
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
          const damage = arc.damage ?? 50; // Wave 4: the weapon decides
          mob.health -= damage;
          hitIds.add(mob.id);

          // ACTION: Melee Hit
          events.push({
            type: 'ACTION_LOG',
            actionContext: {
                tags: ['melee', 'physical', 'violence', 'blade'],
                magnitude: damage
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
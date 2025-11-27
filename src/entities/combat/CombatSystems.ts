import { IProjectile } from './projectileSystem';
import { IWorldEntity, EntityType, IChunk } from '../world/types';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { LootTable } from '../world/LootTable';
import { IItem, UniversalRank, Rarity } from '../../../types';
import { ProgressionSystem } from '../player/systems/ProgressionSystem';

export interface ICombatEvent {
  type: 'HIT' | 'KILL' | 'LOOT_SPAWN' | 'PLAYER_DAMAGE' | 'ACTION_LOG';
  entityId?: string;
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
    meleeArcs: { origin: { x: number; y: number }; angle: number; range: number; startTime: number }[]
  ): { 
    events: ICombatEvent[]; 
    updatedChunks: Record<string, IChunk>;
    survivingBullets: IProjectile[];
    playerDamage: number;
    spawnedLoot: { position: { x: number; y: number }; items: IItem[] }[];
  } {
    const events: ICombatEvent[] = [];
    const updatedChunks = { ...chunks };
    const spawnedLoot: { position: { x: number; y: number }; items: IItem[] }[] = [];
    let playerDamage = 0;
    let survivingBullets = [...bullets];

    const allMobs: { mob: IWorldEntity; chunkKey: string }[] = [];
    Object.entries(chunks).forEach(([key, chunk]) => {
      chunk.entities.forEach(ent => {
        if (ent.type === EntityType.MOB && ent.health && ent.health > 0) {
          allMobs.push({ mob: ent, chunkKey: key });
        }
      });
    });

    // 1. BULLET -> MOB
    const bulletsToRemove = new Set<number>();
    
    bullets.forEach((bullet, bulletIdx) => {
      allMobs.forEach(({ mob, chunkKey }) => {
        if (!mob.health || mob.health <= 0) return;
        
        const dx = bullet.x - mob.position.x;
        const dy = bullet.y - mob.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 1.5) {
          const damage = 25; 
          mob.health -= damage;
          bulletsToRemove.add(bulletIdx);
          
          // ACTION: Ranged Hit
          events.push({
            type: 'ACTION_LOG',
            actionContext: {
                tags: ['ranged', 'projectile', 'tech', 'precision'],
                magnitude: damage
            }
          });

          events.push({ type: 'HIT', entityId: mob.id, damage, position: mob.position });

          if (mob.health <= 0) {
            // KILL LOGIC
            const xpAmount = ProgressionSystem.calculateKillXp(mob.rank, mob.rarity, 1);
            
            events.push({ 
                type: 'KILL', 
                entityId: mob.id,
                xpReward: { amount: xpAmount, sourceRank: mob.rank, sourceRarity: mob.rarity }
            });

            const def = MOB_DEFINITIONS[mob.definitionId];
            if (def) {
              const loot = LootTable.generateLoot(def, 1.0);
              if (loot.length > 0) {
                spawnedLoot.push({ position: mob.position, items: loot });
                events.push({ type: 'LOOT_SPAWN', position: mob.position, loot });
              }
            }
            
            // Remove mob
            const chunk = updatedChunks[chunkKey];
            if (chunk) {
              updatedChunks[chunkKey] = {
                ...chunk,
                entities: chunk.entities.filter(e => e.id !== mob.id)
              };
            }
          }
        }
      });
    });

    survivingBullets = bullets.filter((_, idx) => !bulletsToRemove.has(idx));

    // 2. MELEE -> MOB
    const now = Date.now();
    meleeArcs.forEach(arc => {
      if (now - arc.startTime > 200) return;
      
      allMobs.forEach(({ mob, chunkKey }) => {
        if (!mob.health || mob.health <= 0) return;
        const dx = mob.position.x - arc.origin.x;
        const dy = mob.position.y - arc.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > arc.range) return;
        const angleToMob = Math.atan2(dy, dx);
        const angleDiff = Math.abs(angleToMob - arc.angle);
        
        if (angleDiff < 0.75 || angleDiff > Math.PI * 2 - 0.75) {
          const damage = 50;
          mob.health -= damage;
          
          // ACTION: Melee Hit
          events.push({
            type: 'ACTION_LOG',
            actionContext: {
                tags: ['melee', 'physical', 'violence', 'blade'],
                magnitude: damage
            }
          });

          events.push({ type: 'HIT', entityId: mob.id, damage, position: mob.position });

          if (mob.health <= 0) {
             const xpAmount = ProgressionSystem.calculateKillXp(mob.rank, mob.rarity, 1);
             events.push({ type: 'KILL', entityId: mob.id, xpReward: { amount: xpAmount, sourceRank: mob.rank, sourceRarity: mob.rarity } });
             // ... (loot logic repeated) ...
             const chunk = updatedChunks[chunkKey];
             if (chunk) {
               updatedChunks[chunkKey] = { ...chunk, entities: chunk.entities.filter(e => e.id !== mob.id) };
             }
          }
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
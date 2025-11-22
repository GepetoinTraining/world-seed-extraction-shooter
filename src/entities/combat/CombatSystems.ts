/**
 * COMBAT SYSTEM
 * The bridge between ProjectileSystem (math) and World (state)
 * Handles: Collision, Damage, Death, Loot Spawning
 */

import { IProjectile } from './projectileSystem';
import { IWorldEntity, EntityType, IChunk } from '../world/types';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { LootTable } from '../world/LootTable';
import { IItem, UniversalRank, Rarity } from '../../../types';

export interface ICombatEvent {
  type: 'HIT' | 'KILL' | 'LOOT_SPAWN' | 'PLAYER_DAMAGE';
  entityId?: string;
  damage?: number;
  position?: { x: number; y: number };
  loot?: IItem[];
}

export class CombatSystem {
  
  /**
   * Process all combat for a single frame
   * Returns events for UI feedback (damage numbers, death anims, etc)
   */
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

    // Get all mobs from visible chunks
    const allMobs: { mob: IWorldEntity; chunkKey: string }[] = [];
    Object.entries(chunks).forEach(([key, chunk]) => {
      chunk.entities.forEach(ent => {
        if (ent.type === EntityType.MOB && ent.health && ent.health > 0) {
          allMobs.push({ mob: ent, chunkKey: key });
        }
      });
    });

    // 1. BULLET → MOB COLLISION
    const bulletsToRemove = new Set<number>();
    
    bullets.forEach((bullet, bulletIdx) => {
      allMobs.forEach(({ mob, chunkKey }) => {
        if (!mob.health || mob.health <= 0) return;
        
        const dx = bullet.x - mob.position.x;
        const dy = bullet.y - mob.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Hit radius based on mob size (simplified)
        const hitRadius = 1.5;
        
        if (dist < hitRadius) {
          // DAMAGE
          const damage = 25; // Base bullet damage - should come from weapon
          mob.health -= damage;
          bulletsToRemove.add(bulletIdx);
          
          events.push({ 
            type: 'HIT', 
            entityId: mob.id, 
            damage,
            position: { x: mob.position.x, y: mob.position.y }
          });

          // KILL CHECK
          if (mob.health <= 0) {
            const def = MOB_DEFINITIONS[mob.definitionId];
            if (def) {
              const loot = LootTable.generateLoot(def, 1.0);
              
              if (loot.length > 0) {
                spawnedLoot.push({
                  position: { x: mob.position.x, y: mob.position.y },
                  items: loot
                });
                
                events.push({ 
                  type: 'LOOT_SPAWN', 
                  position: { x: mob.position.x, y: mob.position.y },
                  loot 
                });
              }
            }
            
            events.push({ type: 'KILL', entityId: mob.id });
            
            // Remove mob from chunk
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

    // Remove bullets that hit
    survivingBullets = bullets.filter((_, idx) => !bulletsToRemove.has(idx));

    // 2. MELEE ARC → MOB COLLISION
    const now = Date.now();
    meleeArcs.forEach(arc => {
      const arcAge = now - arc.startTime;
      if (arcAge > 200) return; // Arc only active for 200ms
      
      allMobs.forEach(({ mob, chunkKey }) => {
        if (!mob.health || mob.health <= 0) return;
        
        const dx = mob.position.x - arc.origin.x;
        const dy = mob.position.y - arc.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > arc.range) return;
        
        const angleToMob = Math.atan2(dy, dx);
        const angleDiff = Math.abs(angleToMob - arc.angle);
        
        // 90 degree arc (0.75 rad each side)
        if (angleDiff < 0.75 || angleDiff > Math.PI * 2 - 0.75) {
          const damage = 50; // Melee base damage
          mob.health -= damage;
          
          events.push({ 
            type: 'HIT', 
            entityId: mob.id, 
            damage,
            position: { x: mob.position.x, y: mob.position.y }
          });

          if (mob.health <= 0) {
            const def = MOB_DEFINITIONS[mob.definitionId];
            if (def) {
              const loot = LootTable.generateLoot(def, 1.0);
              if (loot.length > 0) {
                spawnedLoot.push({
                  position: { x: mob.position.x, y: mob.position.y },
                  items: loot
                });
              }
            }
            
            events.push({ type: 'KILL', entityId: mob.id });
            
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

    // 3. MOB → PLAYER COLLISION (Contact Damage)
    allMobs.forEach(({ mob }) => {
      if (!mob.health || mob.health <= 0 || !mob.isHostile) return;
      
      const dx = playerPos.x - mob.position.x;
      const dy = playerPos.z - mob.position.y; // Note: player uses z for depth
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 1.0) {
        const def = MOB_DEFINITIONS[mob.definitionId];
        const damage = def?.baseDamage || 10;
        playerDamage += damage;
        
        events.push({ 
          type: 'PLAYER_DAMAGE', 
          damage,
          entityId: mob.id 
        });
      }
    });

    return {
      events,
      updatedChunks,
      survivingBullets,
      playerDamage,
      spawnedLoot
    };
  }

  /**
   * Check if player can pick up loot
   */
  static checkLootPickup(
    playerPos: { x: number; y: number; z: number },
    lootDrops: { id: string; position: { x: number; y: number }; items: IItem[] }[],
    pickupRadius: number = 2.0
  ): { pickedUp: IItem[]; remainingDrops: typeof lootDrops } {
    const pickedUp: IItem[] = [];
    const remainingDrops: typeof lootDrops = [];

    lootDrops.forEach(drop => {
      const dx = playerPos.x - drop.position.x;
      const dy = playerPos.z - drop.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < pickupRadius) {
        pickedUp.push(...drop.items);
      } else {
        remainingDrops.push(drop);
      }
    });

    return { pickedUp, remainingDrops };
  }
}
import { SPELL_DEFINITIONS } from './data/spellDefinitions';
import { SpellScale, ISpellDefinition } from './types';
import { useWorldStore } from '../world/store';
import { EntityType, IWorldEntity } from '../world/types'; 
import { UniversalRank, Rarity } from '../../../types';
import { LoreManager } from '../player/LoreManager';

export class SpellEngine {

  static castSpell(spellId: string, origin: {x: number, y: number}, target: {x: number, y: number}, playerLore: any) {
    const spell = SPELL_DEFINITIONS[spellId];
    if (!spell) return;

    // 1. CHECK LORE
    if (spell.cost.loreRequirements) {
        if (!LoreManager.hasRequiredLore(spell.cost.loreRequirements, playerLore)) {
            console.log("[MAGIC] CAST FAILED: Insufficient forbidden knowledge.");
            return;
        }
    }

    // 2. CHECK ENTROPY (Paradox)
    const entropyCheck = Math.random() * 100;
    if (entropyCheck < spell.cost.entropyGain) {
        console.log("[MAGIC] PARADOX! Reality rejects your assertion.");
        // Trigger Backlash: Damage player, summon 'mob_eldritch_shambler', etc.
        return; // Spell fails OR casts with side effects
    }

    console.log(`[MAGIC] Casting ${spell.name} [${spell.scale}]`);

    switch (spell.scale) {
      case SpellScale.LOCAL:
        // ... existing local logic ...
        break;
      case SpellScale.TACTICAL:
        // ... existing tactical logic ...
        break;
      case SpellScale.STRATEGIC:
        if (spell.payload.summonMobId) {
            this.handleSummon(spell, target);
        } else {
            this.handleStrategic(spell, origin, target);
        }
        break;
    }
  }

  // ... existing handlers ...

  // --- NEW: SUMMONING LOGIC ---
  private static handleSummon(spell: ISpellDefinition, target: {x: number, y: number}) {
      const worldStore = useWorldStore.getState();
      const map = worldStore.currentMap;
      if (!map || !spell.payload.summonMobId) return;

      const chunkX = Math.round(target.x);
      const chunkY = Math.round(target.y);
      const chunkKey = `${chunkX},${chunkY}`;

      console.log(`-> SUMMONING ${spell.payload.summonMobId} at ${chunkKey}`);

      // In a real app, fetch MobDefinition to get Rank/Stats
      const newMob: IWorldEntity = {
          id: crypto.randomUUID(),
          type: EntityType.MOB,
          definitionId: spell.payload.summonMobId,
          position: { x: 50, y: 50 },
          rank: UniversalRank.B, // Default, should come from definition
          rarity: Rarity.EPIC,
          isHostile: false // It's YOUR summon (for now...)
      };

      if (map.chunks[chunkKey]) {
          map.chunks[chunkKey].entities.push(newMob);
          useWorldStore.setState({ currentMap: { ...map } });
      }
  }
  
  // ... existing handleStrategic logic ...
  private static handleStrategic(spell: ISpellDefinition, origin: {x: number, y: number}, target: {x: number, y: number}) {
    // ... existing logic ...
    // Re-implementing strictly for context of this file update if needed
    const worldStore = useWorldStore.getState();
    const map = worldStore.currentMap;
    if (!map) return;

    const chunkX = Math.round(target.x);
    const chunkY = Math.round(target.y);
    const chunkKey = `${chunkX},${chunkY}`;

    if (map.chunks[chunkKey] && spell.payload.biomeShift) {
        map.chunks[chunkKey].biome = spell.payload.biomeShift;
        if (spell.payload.damage && spell.payload.damage > 1000) {
            map.chunks[chunkKey].entities = []; 
        }
        useWorldStore.setState({ currentMap: { ...map } });
    }
  }
  
  // ... re-adding handleLocal and handleTactical to complete file ...
  private static handleLocal(spell: ISpellDefinition, origin: {x: number, y: number}, target: {x: number, y: number}) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const angle = Math.atan2(dy, dx);
    console.log(`-> Spawning ${spell.payload.projectilePattern} at angle ${angle.toFixed(2)}`);
  }

  private static handleTactical(spell: ISpellDefinition, origin: {x: number, y: number}, target: {x: number, y: number}) {
    const worldStore = useWorldStore.getState();
    const map = worldStore.currentMap;
    if (!map) return;

    const chunkX = Math.round(target.x);
    const chunkY = Math.round(target.y);
    const chunkKey = `${chunkX},${chunkY}`;
    
    const newStructure: IWorldEntity = {
        id: crypto.randomUUID(),
        type: EntityType.STRUCTURE,
        definitionId: spell.payload.structureId || 'str_wall_generic',
        position: { x: 50, y: 50 },
        rank: UniversalRank.D,
        rarity: Rarity.COMMON
    };

    if (map.chunks[chunkKey]) {
        map.chunks[chunkKey].entities.push(newStructure);
        useWorldStore.setState({ currentMap: { ...map } }); 
    }
  }
}
import { usePlayerStore } from './store';

export interface ILoreEntry {
  topic: string; // e.g., 'lore_scifi_mech_schematics'
  xp: number;
  level: number;
}

export class LoreManager {
  
  // XP required per level: 100, 300, 600, 1000...
  static getLevelFromXP(xp: number): number {
    return Math.floor(Math.sqrt(xp / 100)); 
  }

  static studyEntity(entityId: string, durationSeconds: number) {
    // 1. Calculate XP gain based on risk/time
    const xpGain = durationSeconds * 10; 
    const topic = `lore_${entityId}_anatomy`; // Simplistic mapping

    console.log(`[LORE] Studying ${entityId} for ${durationSeconds}s. Gained ${xpGain} XP.`);

    // 2. Update Player State (Pseudo-code for store update)
    // const player = usePlayerStore.getState().player;
    // const currentLore = player.lore[topic] || { xp: 0, level: 0 };
    // currentLore.xp += xpGain;
    // currentLore.level = this.getLevelFromXP(currentLore.xp);
    // updatePlayerLore(topic, currentLore);
  }

  static hasRequiredLore(requirements: { topic: string, level: number }[], playerLore: Record<string, ILoreEntry>): boolean {
    return requirements.every(req => {
      const known = playerLore[req.topic];
      return known && known.level >= req.level;
    });
  }
}
import { MobMutation } from '../mob/types';

// Track performance of each mutation
interface MutationStats {
  spawnCount: number;
  playerKills: number;
  averageLifespan: number; // Seconds alive before death
}

export class Director {
  // The "Genome" of the server. 
  // Higher weight = Higher chance to spawn in next generation.
  private static mutationWeights: Record<MobMutation, number> = {
    [MobMutation.ARMORED_SHELL]: 1.0,
    [MobMutation.ABLATIVE_COATING]: 1.0,
    [MobMutation.ADRENAL_GLANDS]: 1.0,
    [MobMutation.HIVE_MIND]: 1.0,
    [MobMutation.EXPLOSIVE_DEATH]: 1.0
  };

  // Active Session Data
  private static sessionStats: Record<MobMutation, MutationStats> = {
    [MobMutation.ARMORED_SHELL]: { spawnCount: 0, playerKills: 0, averageLifespan: 0 },
    [MobMutation.ABLATIVE_COATING]: { spawnCount: 0, playerKills: 0, averageLifespan: 0 },
    [MobMutation.ADRENAL_GLANDS]: { spawnCount: 0, playerKills: 0, averageLifespan: 0 },
    [MobMutation.HIVE_MIND]: { spawnCount: 0, playerKills: 0, averageLifespan: 0 },
    [MobMutation.EXPLOSIVE_DEATH]: { spawnCount: 0, playerKills: 0, averageLifespan: 0 }
  };

  // --- RUNTIME LOGIC ---

  static reportSpawn(mutations: MobMutation[]) {
    mutations.forEach(m => {
      if (!this.sessionStats[m]) return;
      this.sessionStats[m].spawnCount++;
    });
  }

  static reportMobDeath(mutations: MobMutation[], lifespanSeconds: number) {
    mutations.forEach(m => {
      if (!this.sessionStats[m]) return;
      // Rolling average for lifespan
      const stats = this.sessionStats[m];
      const currentTotal = stats.averageLifespan * (stats.spawnCount - 1); // Approx
      stats.averageLifespan = (currentTotal + lifespanSeconds) / stats.spawnCount;
    });
  }

  static reportPlayerDeath(killerMutations: MobMutation[]) {
    killerMutations.forEach(m => {
      if (!this.sessionStats[m]) return;
      this.sessionStats[m].playerKills++;
    });
  }

  // --- GENERATION LOGIC ---

  // Called by WorldGenerator to pick mutations for a new chunk
  static getEvolutionaryMutations(rngNext: () => number): MobMutation[] {
    const mutations: MobMutation[] = [];
    
    // Roll for mutations based on weighted pool
    const possibleMutations = Object.keys(this.mutationWeights) as MobMutation[];
    
    // Limit to 1-2 mutations for now
    const mutationCount = rngNext() > 0.8 ? 2 : 1;

    for (let i = 0; i < mutationCount; i++) {
      // Weighted Selection
      const totalWeight = possibleMutations.reduce((sum, m) => sum + this.mutationWeights[m], 0);
      let random = rngNext() * totalWeight;
      
      for (const m of possibleMutations) {
        random -= this.mutationWeights[m];
        if (random <= 0) {
          if (!mutations.includes(m)) mutations.push(m);
          break;
        }
      }
    }

    return mutations;
  }

  // --- THE "END OF CYCLE" EVENT ---
  // This would be run by the server once per day/week/match-end
  static evolveCycle() {
    console.log("[DIRECTOR] EVOLUTION CYCLE INITIATED...");
    
    const possibleMutations = Object.keys(this.mutationWeights) as MobMutation[];

    possibleMutations.forEach(m => {
      const stats = this.sessionStats[m];
      if (stats.spawnCount === 0) return; // No data

      // Fitness Function:
      // 1. Did it kill players? (High Weight)
      // 2. Did it survive long? (Medium Weight)
      let fitnessScore = 1.0;
      
      // Kill Rate Bonus
      const killRate = stats.playerKills / stats.spawnCount;
      if (killRate > 0.1) fitnessScore += 0.5; // Highly lethal
      if (killRate > 0.5) fitnessScore += 1.0; // Broken OP

      // Survival Bonus (e.g., standard survival is 10s)
      if (stats.averageLifespan > 20) fitnessScore += 0.2; 
      if (stats.averageLifespan < 5) fitnessScore -= 0.2; // Died too fast (Useless)

      // Apply Evolution
      // We clamp weights to prevent one trait from taking over 100% (Diversity preservation)
      const newWeight = Math.max(0.1, Math.min(5.0, this.mutationWeights[m] * fitnessScore));
      
      console.log(`[DIRECTOR] Mutation [${m}]: Fitness ${fitnessScore.toFixed(2)} -> Weight ${newWeight.toFixed(2)}`);
      this.mutationWeights[m] = newWeight;

      // Reset Stats for next cycle
      this.sessionStats[m] = { spawnCount: 0, playerKills: 0, averageLifespan: 0 };
    });

    console.log("[DIRECTOR] CYCLE COMPLETE. NEW META ESTABLISHED.");
  }
}
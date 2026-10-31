import { describe, it, expect } from 'vitest';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { IProjectile, PatternType, ProjectileSystem, PROJECTILE_RANGE_PX, SIM_MARGIN_PX } from '../src/entities/combat/projectileSystem';
import { EntityType, IChunk, IWorldEntity, BiomeType, ScanLevel } from '../src/entities/world/types';
import { Rarity, UniversalRank } from '../types';

const target = (x: number, y: number, health: number, definitionId = 'mob_scifi_drone'): IWorldEntity => ({
  id: 'target', type: EntityType.MOB, definitionId, position: { x, y },
  rank: UniversalRank.F, rarity: Rarity.COMMON, health, isHostile: true
});

const chunkWith = (...entities: IWorldEntity[]): Record<string, IChunk> => ({
  '0,0': {
    id: 'chk_0_0', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON,
    entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false
  }
});

const playerPos = { x: 0, y: 0, z: 0 };

/** Runs the same per-frame steps as the canvas loop for one fired pattern. */
function flyShot(initial: Record<string, IChunk>, fps: number, damage: number) {
  let chunks = initial;
  const start = 1_000_000;
  const pattern = { type: PatternType.SINGLE, origin: { x: 0, y: 0 }, startTime: start, angle: 0, damage };
  const spent = new Map<string, number>();
  const hits: string[] = [];
  const frameMs = 1000 / fps;
  let prev = start;
  for (let now = start + frameMs; now < start + 2000; now += frameMs) {
    const shots: IProjectile[] = ProjectileSystem.liveShots(pattern, id => `s_${id}`, now, prev, spent);
    const result = CombatSystem.tick(shots, chunks, playerPos, 100, []);
    const surviving = new Set(result.survivingBullets.map(b => b.id));
    shots.forEach(s => { if (!surviving.has(s.id)) spent.set(s.id, now); });
    result.events.filter(e => e.type === 'HIT').forEach(e => hits.push(e.entityId!));
    chunks = result.updatedChunks;
    prev = now;
  }
  return hits;
}

describe('projectiles', () => {
  it('land exactly once at 60fps', () => {
    expect(flyShot(chunkWith(target(200, 0, 1000)), 60, 5)).toHaveLength(1);
  });

  it('still land when frames are slow', () => {
    expect(flyShot(chunkWith(target(200, 0, 1000)), 1, 5)).toHaveLength(1);
  });

  it('are spent on the first target only', () => {
    const a = { ...target(200, 0, 1000), id: 'a' };
    const b = { ...target(205, 0, 1000), id: 'b' };
    expect(flyShot(chunkWith(a, b), 60, 5)).toHaveLength(1);
  });

  it('never outrange the simulated window', () => {
    expect(PROJECTILE_RANGE_PX + SIM_MARGIN_PX).toBeLessThan(1280);
  });
});

describe('read-only worlds', () => {
  const deepFreeze = <T,>(value: T): T => {
    Object.values(value as object).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(value);
  };

  it('resolve hits without writing to the stored entities', () => {
    const chunks = deepFreeze(chunkWith(target(200, 0, 100)));
    const shot: IProjectile = { id: 's', x: 200, y: 0, angle: 0, speed: 200, spawnTime: 0, lifespan: 2, color: 'x', damage: 5 };
    const result = CombatSystem.tick([shot], chunks, playerPos, 100, []);
    expect(result.updatedChunks['0,0'].entities[0].health).toBe(95);
    expect(chunks['0,0'].entities[0].health).toBe(100);
  });
});

describe('melee', () => {
  const swing = (damage: number) => ({ origin: { x: 0, y: 0 }, angle: 0, range: 60, startTime: Date.now(), damage });

  it('lands once per target across a whole swing', () => {
    let chunks = chunkWith(target(30, 0, 1000));
    const arc = swing(10);
    for (let frame = 0; frame < 12; frame++) chunks = CombatSystem.tick([], chunks, playerPos, 100, [arc]).updatedChunks;
    expect(chunks['0,0'].entities[0].health).toBe(990);
  });

  it('removes the target and rolls its drops at zero health', () => {
    const mob = target(30, 0, 5, 'boss_scifi_fortress');
    const chunks = chunkWith(mob);
    const result = CombatSystem.tick([], chunks, playerPos, 100, [swing(10)]);
    expect(result.updatedChunks['0,0'].entities).toHaveLength(0);
    expect(result.spawnedLoot.length).toBeGreaterThan(0);
  });
});

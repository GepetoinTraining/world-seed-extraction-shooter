/**
 * HOW A BLOW READS ON THE FIELD, part 2: the field draws by the rule, and only the drawing changes (the UX pass, ux-fight).
 *
 * Put to Pedro, 2026-11-12: "A number over each blow, given and taken, and a fight log that stays."
 * His answer: "might be not fluid enough in our animation style, maybe the size of the proj?"
 *
 * The field draws a shot, a swing's ground, a hit's brackets and the pips by `src/render/BlowMarks.ts`, and passes each
 * shot its step against the person's own rank and its flight. What a shot hits is decided where it always was: these bars
 * pin that a shot of 1 and one of a million land at the same distance, and that SH4's reach and a person's 15 px stand.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CombatSystem, shotLandsWithinPx, SHOT_LANDS_PX } from '../src/entities/combat/CombatSystems';
import { IProjectile } from '../shared/entities/combat/projectileSystem';
import { BiomeType, EntityType, IChunk, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { Rarity, UniversalRank } from '../shared/types';

const SRC = (p: string) => readFileSync(p, 'utf8');

describe('the field draws a blow by the rule', () => {
  it('the field draws a shot by the rule, keeps the colour roles as a second cue, and passes each shot its step and flight', () => {
    const renderer = SRC('src/render/FieldRenderer.ts');
    expect(renderer).toMatch(/shotMarks\(/);
    expect(renderer).toMatch(/Role\.LOSS/);
    expect(renderer).toMatch(/Role\.SIGNAL/);
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/hostile: false, step: blowStep\(/);
    expect(canvas).toMatch(/hostile: true, step: blowStep\(/);
  });

  it('the field weighs a swing and a hit by it', () => {
    const renderer = SRC('src/render/FieldRenderer.ts');
    expect(renderer).toMatch(/swingFill\(/);
    expect(renderer).toMatch(/markWeight\(/);
  });

  it('the pips are drawn by the rule too', () => {
    expect(SRC('src/render/FieldRenderer.ts')).toMatch(/pipsLeft\(/);
  });
});

describe('only the drawing changes: what a shot hits is what it hit', () => {
  const chunkWith = (...entities: IWorldEntity[]): Record<string, IChunk> => ({
    '0,0': { id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false } as IChunk
  });
  const mob = (y: number): IWorldEntity => ({ id: 'm', type: EntityType.MOB, definitionId: 'mob_fantasy_rat', position: { x: 0, y }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: true, health: 1e9 });
  const shot = (damage: number): IProjectile => ({ id: `s${damage}`, x: 10, y: 0, prevX: -10, prevY: 0, angle: 0, speed: 200, spawnTime: 0, lifespan: 2, color: 'y', damage });

  it('a shot of 1 and a shot of a million land at the same distance and miss at the same distance', () => {
    const reach = shotLandsWithinPx('TINY');
    for (const damage of [1, 1e6]) {
      expect(CombatSystem.tick([shot(damage)], chunkWith(mob(reach - 0.5)), { x: 0, y: 0, z: 0 }, 100, []).events.some(e => e.type === 'HIT')).toBe(true);
      expect(CombatSystem.tick([shot(damage)], chunkWith(mob(reach + 0.5)), { x: 0, y: 0, z: 0 }, 100, []).events.some(e => e.type === 'HIT')).toBe(false);
    }
  });

  it('where a shot lands on a body is as SH4 left it, and a creature\'s still lands on a person within 15 px', () => {
    expect(SHOT_LANDS_PX).toBe(20);
    expect(['TINY', 'MEDIUM', 'LARGE', 'GIGANTIC', 'COLOSSAL'].map(s => shotLandsWithinPx(s))).toEqual([20, 20, 22, 34, 50]);
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/sweptDistance\(b, playerPos\.x, playerPos\.z\) < 15/);
  });
});

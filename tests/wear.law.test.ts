/**
 * WEAR BY THE WORK DONE (2026-11-12), bars set before the build.
 *
 * Pedro, after his round on main: "also, durability, needs to be fixed, breaks too early." As it stood a weapon lost
 * one point a release, whatever its pace, landed or not, and only the chest lost one point for every frame anything
 * got through, whatever its size: 100 releases (81 s of held fire on his bow at 1.23 a second), and eighteen hound
 * nips that took 28 wore the chest four times what five turret shots that took 51 did. The coordinator's calls, each
 * an open row he can strike:
 * - a blow wears its weapon by the share of a second's work it is (one over its own rate), so two kinds of one power
 *   last the same time of fighting, and it wears whether or not it lands;
 * - a hit wears what protects by the share of a body it took, not once a hit;
 * - a piece lasts three runs of the fighting a run holds at its own rank, a run being the spine's sixteen plain
 *   creatures (BALANCE_RUN 1.2, call 2), each felled in the whole blows of a plain weapon of the rank.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RUN_PLAIN_CREATURES, RUNS_A_PIECE_LASTS, runFightSeconds, runBodyShare, blowWear, hitWear, protects } from '../shared/logic/theme/WearLaw';
import { creatureNumbers, personHealth, CREATURE_COOLDOWN_MS, CREATURE_WINDUP_MS } from '../shared/logic/theme/ThemeFormula';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { IItem } from '../shared/types';

const plain = (rank: string) => creatureNumbers({ rank: rank as never, build: 'sturdy', threat: 'sharp', pace: 'steady', size: 'MEDIUM' });

describe('a run, from the fight\'s own numbers', () => {
  it('is sixteen plain creatures, each felled in the whole blows of a plain weapon of the rank at one a second', () => {
    expect(RUN_PLAIN_CREATURES).toBe(16);
    expect(RUNS_A_PIECE_LASTS).toBe(3);
    for (const rank of ['F', 'C', 'S']) {
      const blows = Math.ceil(plain(rank).baseHealth / PieceLaw.blowOf(PieceLaw.power(rank, 0, false)));
      expect(runFightSeconds(rank), rank).toBe(16 * blows);
    }
    expect(runFightSeconds('F')).toBe(48);
  });
  it('takes what sixteen plain creatures land while they are felled, as a share of a body of the rank', () => {
    const p = plain('F');
    const fell = runFightSeconds('F') / 16;
    expect(runBodyShare('F')).toBeCloseTo(16 * fell * p.baseDamage / ((CREATURE_COOLDOWN_MS + CREATURE_WINDUP_MS) / 1000) / personHealth('F', 1), 9);
  });
});

describe('a blow wears its weapon by the work it is', () => {
  it('two kinds of one power last the same time of fighting, three runs of it', () => {
    for (const rate of [0.8, 1.0, 1.6]) {
      const blows = 100 / blowWear(100, rate, 'F');
      expect(blows / rate, `rate ${rate}`).toBeCloseTo(RUNS_A_PIECE_LASTS * runFightSeconds('F'), 6);
    }
  });
  it('a quick kind wears less a blow than a slow one', () => {
    expect(blowWear(100, 1.6, 'F')).toBeLessThan(blowWear(100, 0.8, 'F'));
  });
  it('the field wears the weapon when the blow lets go, landed or not, by this law', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    const release = canvas.slice(canvas.indexOf('releaseRef.current = (now: number)'), canvas.indexOf('// Wave 2.5: extraction channel'));
    expect(release).toMatch(/st\.wearSlot\(slot, blowWear\(/);
    expect(canvas).not.toMatch(/st\.wearSlot\(slot, 1\)/);
  });
});

describe('a hit wears what protects by the share of a body it took', () => {
  it('eight light shots wear as much as one blow that takes as much', () => {
    expect(8 * hitWear(100, 0.05 / 8, 'F')).toBeCloseTo(hitWear(100, 0.05, 'F'), 9);
  });
  it('three runs of a plain run\'s hits spend a piece', () => {
    expect(hitWear(100, RUNS_A_PIECE_LASTS * runBodyShare('F'), 'F')).toBeCloseTo(100, 6);
  });
  it('what protects is what carries a protection line', () => {
    const piece = (stats: Record<string, number>) => ({ stats } as unknown as IItem);
    expect(protects(piece({ defense: 10 }))).toBe(true);
    expect(protects(piece({ physical_reduction: 0.05 }))).toBe(true);
    expect(protects(piece({ evasion_rating: 5 }))).toBe(true);
    expect(protects(piece({ block_chance: 0.1 }))).toBe(true);
    expect(protects(piece({ crit_chance: 0.1 }))).toBe(false);
  });
  it('the field wears every piece that protects by the share a blow took, and a tick of poison wears nothing', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(canvas).toMatch(/hitWear\(/);
    expect(canvas).toMatch(/Math\.min\(hit\.damage, totalDamage\)/);
    expect(canvas).not.toMatch(/wearEquipment\('armor', 1\)/);
  });
});

describe('a player can tell a piece is wearing, and broken', () => {
  it('the card says durability in whole points, and near breaking under a third', () => {
    const inspect = readFileSync('src/render/atoms/inspect.ts', 'utf8');
    expect(inspect).toMatch(/near breaking/);
    expect(inspect).toMatch(/Math\.max\(1, Math\.round\(durability\)\)/);
  });
  it('the pack says when a piece wears thin, and when it breaks', () => {
    const store = readFileSync('src/entities/player/store.ts', 'utf8');
    expect(store).toMatch(/is wearing thin/);
    expect(store).toMatch(/BROKE/);
  });
});

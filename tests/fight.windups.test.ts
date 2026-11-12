/**
 * WIND-UPS AND A HIT FELT (the fight's rebalance, part 2), bars set before the build.
 *
 * BALANCE_RUN 2.13, call 6, made by the coordinator on Pedro's word: "A person's wind-up, and a hit felt: yes to
 * both. Without them there is no triangle." A bow is drawn standing; a swing begins at half pace; the time of each
 * comes from the weapon through the formula, and a faster hand shortens what comes after, never the draw. A hit is
 * felt by what the game can already do: a push, a pause, a mark, words. A share of it, weight / (weight + poise),
 * is that share of a tile pushed and that share of pace lost for that share of a second, and it breaks a wind-up
 * its target stood for only when its weight is at least the target's poise. Call 12: the empty hand throws under
 * the draw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IItem, Rarity, UniversalRank } from '../shared/types';
import {
  strikeNumbers, drawMs, swingWindupMs, blowWeight, bodyPoise, feltHit, SHOT_WEIGHT, abilityNumbers
} from '../shared/logic/theme/ThemeFormula';
import { pushFrom } from '../shared/entities/combat/Shapes';
import { StatusClock } from '../shared/logic/systems/EffectSystem';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { windupOf, cycleMs } from '../src/logic/systems/FieldInput';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { ProjectileSystem } from '../shared/entities/combat/projectileSystem';
import { BiomeType, EntityType, IChunk, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { TILE_PX } from '../shared/entities/world/grid';
import { UNARMED_SHOTS_PER_SEC } from '../shared/logic/systems/FightNumbers';

installShippedThemes();
const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const gearDef = (name: string) => [...Object.values(compiled.items).flat(), ...compiled.craftedGear].find((d: any) => d.universal_name === name) as any;
const mobByName = (name: string) => Object.values(compiled.mobs).find(m => m.name === name)!;
const mint = (name: string, key: string, over: Record<string, unknown> = {}): IItem => ItemFactory.createFromTemplate({ ...gearDef(name), ...over }, true, Rng.fromKey(key));
const SRC = (p: string) => readFileSync(p, 'utf8');
const shape = (reach: 'short' | 'middling' | 'long', sweep: 'thrust' | 'arc' | 'wide', hollow: 'none' | 'haft' = 'none') => strikeNumbers({ reach, sweep, hollow });

const chunkWith = (...entities: IWorldEntity[]): Record<string, IChunk> => ({
  '0,0': {
    id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON,
    entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false
  } as IChunk
});
const body = (def: { id: string; rank: unknown }, id: string, x: number, y = 0, health = 1000): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: def.id, position: { x, y },
  rank: def.rank as UniversalRank, rarity: Rarity.COMMON, isHostile: true, health
});

describe('a person winds up: a bow is drawn standing, a swing begins at half pace', () => {
  it('a shot is drawn standing for six tenths of its own cycle; a swing at half pace, for a time its shape gives', () => {
    const bow = mint('Steel-Rule Bow', 'wind:bow');
    const w = windupOf(bow);
    expect(w.pace).toBe(0);
    expect(w.kind).toBe('draw');
    expect(w.ms).toBe(drawMs(bow.stats!.attack_speed!));
    expect(drawMs(1)).toBeCloseTo(600);
    const blade = mint('Letter Opener', 'wind:blade');
    const s = windupOf(blade);
    expect(s.pace).toBe(0.5);
    expect(s.kind).toBe('swing');
    expect(s.ms).toBe(swingWindupMs(CombatMath.strikeOf(blade)));
  });

  it('the empty hand and a stone throw under the draw, standing, and eight tiles (call 12)', () => {
    const bare = windupOf(undefined);
    expect(bare.pace).toBe(0);
    expect(bare.ms).toBe(drawMs(UNARMED_SHOTS_PER_SEC));
    expect(CombatMath.shotRangePx(undefined)).toBe(8 * TILE_PX);
    expect(CombatMath.shotRangePx(mint('Steel-Rule Bow', 'wind:bow-range'))).toBeUndefined();
    const pattern = { type: 'SINGLE' as never, origin: { x: 0, y: 0 }, startTime: 0, angle: 0, rangePx: 8 * TILE_PX };
    expect(ProjectileSystem.lifeMs(pattern)).toBeLessThan(ProjectileSystem.lifeMs({ ...pattern, rangePx: undefined }));
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/rangePx: CombatMath\.shotRangePx\(weapon\)/);
  });

  it('a stab is quick, a wide sweep slow, and a longer reach takes longer: the time comes from the shape, not a table', () => {
    expect(swingWindupMs(shape('long', 'thrust'))).toBeLessThan(swingWindupMs(shape('middling', 'arc')));
    expect(swingWindupMs(shape('middling', 'arc'))).toBeLessThan(swingWindupMs(shape('middling', 'wide')));
    expect(swingWindupMs(shape('short', 'arc'))).toBeLessThan(swingWindupMs(shape('long', 'arc')));
    // Within what the fight worker found playable: a stab about 0.15 s, a heavy sweep about half a second
    expect(swingWindupMs(shape('long', 'thrust'))).toBeLessThan(250);
    expect(swingWindupMs(shape('middling', 'wide'))).toBeGreaterThan(400);
    expect(swingWindupMs(shape('middling', 'wide'))).toBeLessThan(700);
  });

  it('a faster hand shortens what comes after a draw, never the draw itself', () => {
    const bow = mint('Steel-Rule Bow', 'wind:bow2');
    const quick = { ...bow, stats: { ...bow.stats, haste: 3 } };
    const eq = (item: IItem) => ({ slots: { RIGHT_HAND: item.id }, items: [item] }) as any;
    expect(windupOf(quick, eq(quick)).ms).toBe(windupOf(bow, eq(bow)).ms);
    expect(CombatMath.fireCooldownMs(quick, eq(quick))).toBeLessThan(windupOf(quick, eq(quick)).ms);
    expect(cycleMs(quick, eq(quick))).toBe(windupOf(quick, eq(quick)).ms);
    expect(cycleMs(bow, eq(bow))).toBe(CombatMath.fireCooldownMs(bow, eq(bow)));
  });

  it('a working cast from a focus is drawn standing for its own telegraph', () => {
    const t = abilityNumbers('medium', 'F').telegraphMs;
    const focus = mint("Clerk's Abacus", 'wind:focus');
    const w = windupOf(focus, undefined, undefined, { cost: 'medium', rank: 'F' });
    expect(w.ms).toBe(t);
    expect(w.pace).toBe(0);
  });

  it('the field holds the hand through the wind-up, moves at its pace, and lets the blow go at its end', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/windupOf\(/);
    expect(canvas).toMatch(/windupRef\.current/);
    expect(canvas).toMatch(/windupRef\.current\?\.pace/);
    const renderer = SRC('src/render/FieldRenderer.ts');
    expect(renderer).toMatch(/scene\.windup/);
  });
});

describe('a hit is felt: a push, a pause, a mark and words', () => {
  it('the share of a hit is its weight over its weight and the poise it lands on', () => {
    const f = feltHit(1, 1);
    expect(f.share).toBeCloseTo(0.5);
    expect(f.pushPx).toBeCloseTo(0.5 * TILE_PX);
    expect(f.pause.kind).toBe('stagger');
    expect(f.pause.magnitude).toBeCloseTo(0.5);
    expect(f.pause.durationMs).toBeCloseTo(500);
    expect(f.breaks).toBe(true);
    expect(feltHit(1, 2).breaks).toBe(false);
    expect(feltHit(1, 8).pushPx).toBeLessThan(feltHit(1, 1).pushPx);
    // It approaches a tile and never arrives: no top is needed
    expect(feltHit(1000, 1).pushPx).toBeLessThan(TILE_PX);
    expect(feltHit(1000, 1).pushPx).toBeGreaterThan(0.99 * TILE_PX);
  });

  it('a heavier sweep weighs more than a blade, a stab less; a shot weighs half the blade (SH1); a bigger body stands firmer', () => {
    expect(blowWeight(shape('middling', 'arc'))).toBeCloseTo(1);
    expect(blowWeight(shape('middling', 'wide'))).toBeGreaterThan(1);
    expect(blowWeight(shape('long', 'thrust'))).toBeLessThan(1);
    expect(SHOT_WEIGHT).toBe(1 / 2); // SH1: half the middling blow
    expect(bodyPoise('LARGE')).toBeGreaterThan(bodyPoise('MEDIUM'));
    expect(bodyPoise('MEDIUM')).toBeGreaterThan(bodyPoise('TINY'));
    expect(bodyPoise(undefined)).toBe(bodyPoise('MEDIUM'));
  });

  it('a pause takes from pace, as a slow does', () => {
    expect(StatusClock.paceScale([{ kind: 'stagger', magnitude: 0.4, until: 99, nextAt: 99 }])).toBeCloseTo(0.6);
  });

  it('a push goes from the striker through the struck', () => {
    const p = pushFrom({ x: 0, y: 0 }, { x: 30, y: 40 }, 10);
    expect(p.dx).toBeCloseTo(6);
    expect(p.dy).toBeCloseTo(8);
  });

  it('a swing that lands pushes the body away, pauses it, and says when it broke what the body stood for', () => {
    const goat = mobByName('Collateral Goat');
    const arc = { origin: { x: 0, y: 0 }, angle: 0, range: 60, inner: 0, half: 0.75, startTime: Date.now(), damage: 5, weight: 1.5 };
    const out = CombatSystem.tick([], chunkWith(body(goat, 'goat', 30)), { x: 0, y: 0, z: 0 }, 100, [arc]);
    const after = out.updatedChunks['0,0'].entities[0];
    expect(after.position.x).toBeGreaterThan(30);
    expect((after.statuses as any[]).some(s => s.kind === 'stagger')).toBe(true);
    const felt = out.events.find(e => e.type === 'STAGGER');
    expect(felt?.entityId).toBe('goat');
    expect(felt?.broke).toBe(true);
  });

  it('a light blow on a big body pushes it less and breaks nothing', () => {
    const bear = mobByName('Compound Bear');
    const goat = mobByName('Collateral Goat');
    const arc = () => ({ origin: { x: 0, y: 0 }, angle: 0, range: 60, inner: 0, half: 0.75, startTime: Date.now(), damage: 5, weight: 1 });
    const onBear = CombatSystem.tick([], chunkWith(body(bear, 'bear', 30)), { x: 0, y: 0, z: 0 }, 100, [arc()]);
    const onGoat = CombatSystem.tick([], chunkWith(body(goat, 'goat', 30)), { x: 0, y: 0, z: 0 }, 100, [arc()]);
    expect(onBear.updatedChunks['0,0'].entities[0].position.x - 30).toBeLessThan(onGoat.updatedChunks['0,0'].entities[0].position.x - 30);
    expect(onBear.events.find(e => e.type === 'STAGGER')?.broke).toBe(false);
  });

  it('a shot is felt too, at a shot\'s weight', () => {
    const goat = mobByName('Collateral Goat');
    const shot = { id: 's', x: 30, y: 0, angle: 0, speed: 200, spawnTime: 0, lifespan: 2, color: 'x', damage: 5, weight: SHOT_WEIGHT, prevX: 20, prevY: 0 };
    const out = CombatSystem.tick([shot], chunkWith(body(goat, 'goat', 30)), { x: 0, y: 0, z: 0 }, 100, []);
    expect(out.updatedChunks['0,0'].entities[0].position.x).toBeGreaterThan(30);
    expect(out.events.some(e => e.type === 'STAGGER')).toBe(true);
  });

  it('the field feels a blow on the person: pushed, paused, a draw broken, and said', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/feltHit\(/);
    expect(canvas).toMatch(/MobAI\.interrupt\(/);
    expect(canvas).toMatch(/draw breaks/i);
  });
});

describe('a broken wind-up is begun again, so a quick hand does not hold a body for good', () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('what it stood for is lost and nothing lands from it; the next lands before a blade can strike again', () => {
    const teller = mobByName('Teller Still On Shift');
    let chunks = chunkWith(body(teller, 'teller', 0));
    const person = { x: 30, y: 0 };
    let broke = -1, first: any, again: any;
    const landed: number[] = [];
    for (let t = 0; t < 3000; t += 25) {
      vi.advanceTimersByTime(25);
      const out = MobAI.tick(chunks, person, 0.025);
      chunks = { ...chunks, ...out.updatedChunks };
      const tg = chunks['0,0'].entities[0].telegraph;
      if (tg && broke < 0) { first = tg; MobAI.interrupt('teller'); broke = Date.now(); continue; }
      if (tg && broke > 0 && !again && tg.startedAt > first.startedAt) again = tg;
      if (out.spawnedPatterns.some(p => p.type === 'MELEE')) landed.push(Date.now());
    }
    expect(broke).toBeGreaterThan(0);
    expect(landed.length).toBeGreaterThan(0);
    // What lands first is a wind-up begun after the break, not the broken one
    expect(again).toBeDefined();
    expect(landed[0]).toBeGreaterThanOrEqual(again.until);
    const blade = mint('Letter Opener', 'wind:lock');
    expect(landed[0] - broke).toBeLessThan(cycleMs(blade));
  });

  it('a body is not broken by what weighs less than it stands', () => {
    expect(feltHit(blowWeight(shape('middling', 'arc')), bodyPoise('LARGE')).breaks).toBe(false);
    expect(feltHit(blowWeight(shape('middling', 'wide')), bodyPoise('GIGANTIC')).breaks).toBe(false);
  });
});

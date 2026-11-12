/**
 * THE FIGHT'S NUMBERS (the fight's rebalance, part 3), bars set before the build.
 *
 * BALANCE_RUN 1.2 and 2.13, the calls made on Pedro's word: a rank doubles (1); a plain creature alone is a quarter
 * of a person in what it holds and deals (2); ten seconds between equals (3); a creature is faster than a walk only
 * in a burst, with a rest the formula sets (14); a cast is worth twice a bow for each second stood, an aether for 3
 * damage (19); heavy pieces cost pace by their own penalty (10). And the rescale's loose ends: pace's reader gets a
 * curve, and a rating is read against the rank it is set against. A world that already stands keeps its creatures as
 * written (GROUND_VERSION); a character's health and blow follow the new law at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IAttributes, IEquipmentState, IItem, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../shared/types';
import {
  creatureNumbers, consumableNumbers, abilityNumbers, burstNumbers, BODIES_FROM_GROUND, creatureShare, CREATURE_COOLDOWN_MS, CREATURE_WINDUP_MS
} from '../shared/logic/theme/ThemeFormula';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { EffectSystem } from '../shared/logic/systems/EffectSystem';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { bodyLawOf } from '../shared/entities/mob/BodyLaw';
import { LoadoutSystem, BASE_WALK_TILES_PER_S } from '../shared/entities/player/systems/LoadoutSystem';
import { WorldGenerator, GROUND_VERSION } from '../shared/entities/world/WorldGenerator';
import { Director, emptyDirectorRecord } from '../shared/entities/world/Director';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { Escort } from '../src/logic/systems/Escort';
import { BiomeType, EntityType, IChunk, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { TILE_PX } from '../shared/entities/world/grid';

installShippedThemes();
const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const gearDef = (name: string) => [...Object.values(compiled.items).flat(), ...compiled.craftedGear].find((d: any) => d.universal_name === name) as any;
const mobByName = (name: string) => Object.values(compiled.mobs).find(m => m.name === name)! as any;
const SRC = (p: string) => readFileSync(p, 'utf8');
const STEP: Record<string, number> = { F: 0, C: 3, S: 6 };
const floor = (rank: string, over = 0): IAttributes =>
  Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1 + STEP[rank] + over])) as unknown as IAttributes;
const mintAt = (name: string, rank: string, key: string, over: Record<string, unknown> = {}): IItem =>
  ItemFactory.createFromTemplate({ ...gearDef(name), ...over }, true, Rng.fromKey(key), undefined, rank as UniversalRank, { quality: 0, depth: 0 });
const wearing = (...items: IItem[]): IEquipmentState => ({
  slots: Object.fromEntries(items.map((it, i) => [it.slot === 'MAIN_HAND' ? 'RIGHT_HAND' : `${it.slot}_${i}`, it.id])), items, frames: {}, protected: []
}) as unknown as IEquipmentState;

describe('a rank doubles what a body holds and deals, once (calls 1 and 3)', () => {
  it('a plain person holds 100 at F and doubles a rank; a point of constitution over the floor adds a tenth, under it divides', () => {
    expect(StatSystem.maxHealth(floor('F'), undefined, 'F')).toBe(100);
    expect(StatSystem.maxHealth(floor('C'), undefined, 'C')).toBe(800);
    expect(StatSystem.maxHealth(floor('S'), undefined, 'S')).toBe(6400);
    expect(StatSystem.maxHealth(floor('C', 2), undefined, 'C')).toBe(960);
    const under = StatSystem.maxHealth({ ...floor('C'), constitution: 1 }, undefined, 'C');
    expect(under).toBeLessThan(800);
    expect(under).toBeGreaterThan(0);
  });

  it('a bare hand deals half a plain weapon of its body\'s rank', () => {
    for (const r of ['F', 'C', 'S']) {
      expect(CombatMath.weaponDamage(undefined, undefined, r)).toBe(Math.round(5 * PieceLaw.scale(r)));
      expect(CombatMath.weaponDamage(mintAt('Steel-Rule Bow', r, `n:bow0:${r}`), undefined, r)).toBe(Math.round(10 * PieceLaw.scale(r)));
    }
  });

  it('a plain weapon deals ten a second at F whatever its pace: a slow kind hits harder each blow, a quick one lighter', () => {
    for (const r of ['F', 'C', 'S']) {
      for (const name of ['Letter Opener', 'Oversized Gavel', 'Steel-Rule Bow']) {
        const w = mintAt(name, r, `n:pace:${name}:${r}`);
        const perSecond = CombatMath.weaponDamage(w, undefined, r) * w.stats!.attack_speed!;
        expect(perSecond / (10 * PieceLaw.scale(r)), `${name} ${r}`).toBeCloseTo(1, 1);
      }
    }
    const gavel = mintAt('Oversized Gavel', 'F', 'n:pace:g'), blade = mintAt('Letter Opener', 'F', 'n:pace:b');
    expect(CombatMath.weaponDamage(gavel, undefined, 'F')).toBeGreaterThan(CombatMath.weaponDamage(blade, undefined, 'F'));
  });

  it('two equals with the plain bow of their rank fell each other in about ten seconds, at every rank', () => {
    for (const r of ['F', 'C', 'S']) {
      const bow = mintAt('Steel-Rule Bow', r, `n:bow:${r}`);
      const perSecond = CombatMath.weaponDamage(bow, undefined, r) * 1000 / CombatMath.fireCooldownMs(bow, undefined, floor(r));
      const seconds = StatSystem.maxHealth(floor(r), undefined, r) / perSecond;
      expect(seconds).toBeGreaterThan(8);
      expect(seconds).toBeLessThan(12);
    }
  });

  it('a plain creature alone, middling, sturdy and sharp, is a quarter of a person in what it holds and in what it deals a second', () => {
    for (const r of ['F', 'C', 'S'] as const) {
      const n = creatureNumbers({ rank: r, build: 'sturdy', threat: 'sharp', pace: 'steady', size: 'MEDIUM' });
      expect(n.baseHealth).toBe(Math.round(0.25 * 100 * PieceLaw.scale(r)));
      const perSecond = n.baseDamage / ((CREATURE_COOLDOWN_MS + CREATURE_WINDUP_MS) / 1000);
      expect(perSecond / (10 * PieceLaw.scale(r))).toBeGreaterThan(0.2);
      expect(perSecond / (10 * PieceLaw.scale(r))).toBeLessThan(0.3);
    }
    expect(creatureShare('MEDIUM')).toBe(0.25);
    expect(creatureShare('TINY')).toBe(0.125);
    expect(creatureShare('GIGANTIC')).toBe(2);
  });

  it('a heal is three tenths of a plain body of its rank', () => {
    for (const r of ['F', 'C', 'S'] as const) expect(consumableNumbers('heal', r).health_restore).toBe(Math.round(0.3 * 100 * PieceLaw.scale(r)));
  });

  it('a working is worth twice a bow for each second it is stood for, and an aether buys three of what it deals at F (call 19)', () => {
    for (const cost of ['trivial', 'low', 'medium', 'high', 'extreme'] as const) {
      const f = abilityNumbers(cost, 'F', false, 'damage');
      expect(f.magnitude).toBe(Math.round(2 * 10 * f.telegraphMs / 1000));
      expect(f.aether).toBe(Math.round(f.magnitude / 3));
      expect(abilityNumbers(cost, 'C', false, 'damage').magnitude).toBe(Math.round(2 * 10 * 8 * f.telegraphMs / 1000));
      expect(abilityNumbers(cost, 'C', false, 'damage').aether).toBe(f.aether);
    }
    // A working that deals nothing keeps its band's price: a way out still costs what D77 asks
    expect(abilityNumbers('extreme', 'F', false, 'forced_exit').aether).toBe(30);
  });

  it('a creature\'s working is a blow of its body: its share of what a person\'s would be', () => {
    const ability = { id: 'a', name: 'A', elements: ['debt'], delivery: 'ranged', effect: 'damage', cost: 'medium' } as any;
    const person = EffectSystem.resolve(ability, { rank: 'C' }, 'k');
    const body = EffectSystem.resolve(ability, { rank: 'C', share: 0.25 }, 'k');
    expect(body.magnitude).toBe(Math.max(1, Math.round(person.magnitude * 0.25)));
  });
});

describe('a world that already stands keeps its creatures as written; a new one lays them by the new law', () => {
  it('the ground moved to the version the bodies follow', () => {
    expect(GROUND_VERSION).toBeGreaterThanOrEqual(BODIES_FROM_GROUND);
  });

  it('a body laid under an older ground reads its old numbers, and one laid under this ground the new', () => {
    const hound = mobByName('Dun Hound');
    expect(hound.standing).toBeDefined();
    expect(bodyLawOf(hound, {})).toEqual(hound.standing);
    expect(bodyLawOf(hound, { law: BODIES_FROM_GROUND })).toEqual({ baseHealth: hound.baseHealth, baseDamage: hound.baseDamage });
    const ctx = (ground: number) => ({ ...ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.E, emptyDirectorRecord(), true), groundVersion: ground });
    const bodies = (ground: number) => {
      const map = WorldGenerator.generate('standing-bodies', 16, ctx(ground) as any);
      const out: IWorldEntity[] = [];
      for (let y = 40; y < 56 && out.length < 30; y++) for (let x = 40; x < 56; x++) out.push(...(WorldGenerator.chunkAt(map, x, y, ctx(ground) as any)?.entities ?? []).filter(e => e.type === EntityType.MOB));
      return out;
    };
    const old = bodies(4), now = bodies(GROUND_VERSION);
    expect(old.length).toBeGreaterThan(0);
    expect(old.every(e => e.law === undefined)).toBe(true);
    expect(now.every(e => e.law === BODIES_FROM_GROUND)).toBe(true);
    const plain = (list: IWorldEntity[]) => list.find(e => !e.bonusHealth && e.health === bodyLawOf(compiled.mobs[e.definitionId] as any, e).baseHealth);
    expect(plain(old)).toBeDefined();
    expect(plain(now)).toBeDefined();
  });

  it('a creature\'s trait is a property on its body, sized by the body: a band of its own figure', () => {
    let record = emptyDirectorRecord();
    for (let i = 0; i < 12; i++) record = Director.evolve(record);
    const pool = { affixes: [{ id: 'aff_x', name: 'Swollen', type: 'PREFIX' as const, statModifiers: { max_health: [30, 53] as [number, number] }, gives: [{ stat: 'max_health', band: 'moderate', downside: false }] }], abilities: [] };
    let found: any;
    for (let i = 0; i < 400 && !found; i++) {
      const v = Director.variantOf('seed', `b${i}`, 'd', 'Body', record, pool as any, [], 1, { baseHealth: 800, baseDamage: 50 });
      if (v.traits.length > 0) found = v;
    }
    expect(found).toBeDefined();
    expect(found.bonusHealth).toBeCloseTo(800 / 6, 0);
  });
});

describe('a rating is read against the rank it is set against, and doubles on its piece', () => {
  it('a plain chest\'s protection is the same share against a blow of its own rank at F, C and S, and less against one a rank up', () => {
    const shares = ['F', 'C', 'S'].map(r => CombatMath.mitigationOf(wearing(mintAt('Reinforced Waistcoat', r, `n:chest:${r}`)), r));
    for (const s of shares) expect(s).toBeCloseTo(shares[0], 5);
    expect(shares[0]).toBeGreaterThan(0);
    const c = wearing(mintAt('Reinforced Waistcoat', 'C', 'n:chest:C2'));
    expect(CombatMath.mitigationOf(c, 'B')).toBeLessThan(CombatMath.mitigationOf(c, 'C'));
    expect(PieceLaw.rankFactor('defense', 'C')).toBe(8);
    expect(PieceLaw.rankFactor('evasion_rating', 'C')).toBe(8);
    expect(PieceLaw.rankFactor('crit_chance', 'C')).toBe(1);
  });

  it('a dodge reads against the striker\'s rank; a glance against the holder\'s own', () => {
    const boots = mintAt('Worn Oxfords', 'C', 'n:boots', {});
    const eq = { ...wearing(boots), items: [{ ...boots, stats: { ...boots.stats, evasion_rating: 200 } }] } as IEquipmentState;
    expect(CombatMath.dodgeChance(eq, undefined, 'C')).toBeLessThan(CombatMath.dodgeChance(eq, undefined, 'F'));
    expect(CombatMath.glanceChance(undefined, undefined, 'C')).toBeCloseTo(CombatMath.glanceChance(undefined, undefined, 'F'));
  });
});

describe('pace has a curve, and weight costs it (call 10)', () => {
  it('what is worn for pace is read on a curve that approaches twice a walk and never arrives', () => {
    const at = (b: number) => LoadoutSystem.walkTilesPerSecond({ slots: { FEET: 'b' }, items: [{ id: 'b', stats: { movement_speed: b } }] } as any);
    expect(at(0)).toBeCloseTo(BASE_WALK_TILES_PER_S);
    expect(at(0.045)).toBeCloseTo(BASE_WALK_TILES_PER_S * (1 + 0.045 / 1.045), 4);
    expect(at(1000)).toBeLessThan(2 * BASE_WALK_TILES_PER_S);
    expect(at(1000)).toBeGreaterThan(1.99 * BASE_WALK_TILES_PER_S);
  });

  it('each heavy piece worn costs a share of the walk, by its word', () => {
    const chest = mintAt('Reinforced Waistcoat', 'F', 'n:heavy');
    expect(chest.tags).toContain('heavy');
    const light = LoadoutSystem.walkTilesPerSecond(undefined);
    const heavy = LoadoutSystem.walkTilesPerSecond(wearing(chest));
    expect(heavy).toBeLessThan(light);
    expect(heavy).toBeGreaterThan(light * 0.85);
  });
});

describe('speed: a swift body bursts past a walk, then rests, and a person can still leave from outside it (call 14)', () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a burst is twice its pace for a second, and the rest keeps its pace over the cycle at its own, under a walk', () => {
    const b = burstNumbers(3.7);
    expect(b.pace).toBeGreaterThan(BASE_WALK_TILES_PER_S);
    const average = (b.pace * b.ms) / (b.ms + b.restMs);
    expect(average).toBeLessThanOrEqual(3.7 + 1e-9);
    expect(average).toBeLessThan(BASE_WALK_TILES_PER_S);
  });

  it('a swift hound closes faster than a walk while it bursts, and a heavy enough hit ends the burst', () => {
    const hound = mobByName('Dun Hound');
    const chunkWith = (...entities: IWorldEntity[]): Record<string, IChunk> => ({
      '0,0': { id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false } as IChunk
    });
    let chunks = chunkWith({ id: 'h', type: EntityType.MOB, definitionId: hound.id, position: { x: 0, y: 0 }, rank: hound.rank, rarity: Rarity.COMMON, isHostile: true, health: 999, law: BODIES_FROM_GROUND });
    MobAI.provoke('h');
    const person = { x: 6 * TILE_PX, y: 0 };
    let best = 0, last = 0;
    for (let t = 0; t < 600; t += 25) {
      vi.advanceTimersByTime(25);
      chunks = { ...chunks, ...MobAI.tick(chunks, person, 0.025).updatedChunks };
      const x = chunks['0,0'].entities[0].position.x;
      best = Math.max(best, (x - last) / 0.025 / TILE_PX);
      last = x;
    }
    expect(best).toBeGreaterThan(BASE_WALK_TILES_PER_S);
    expect(MobAI.isBursting('h')).toBe(true);
    MobAI.interrupt('h');
    expect(MobAI.isBursting('h')).toBe(false);
  });
});

describe('what was weightless gets its weight, and only a drawn shape hits', () => {
  it('an escort\'s blow weighs what its swing weighs, and lands by its body\'s rank', () => {
    const stats = floor('C');
    const escort = Escort.join({ id: 'e' } as any, { sheet: { name: 'Bond' } } as any, stats, 'C');
    expect(escort.maxHealth).toBe(800);
    const { swing } = Escort.strike(escort, { x: 0, y: 0 }, [{ id: 'm', x: 20, y: 0, engaged: true }], 10_000);
    expect(swing?.weight).toBeGreaterThan(0);
  });

  it('a person\'s working lands with a weight, as a blow or a shot', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    const receipt = canvas.slice(canvas.indexOf('const applyPlayerReceipt'), canvas.indexOf('const castFromFocus'));
    expect(receipt).toMatch(/weight: SHOT_WEIGHT/);
    expect(receipt).toMatch(/weight: blowWeight\(/);
  });

  it('nothing lands for standing on a body: the old touch of a body is gone', () => {
    const hound = mobByName('Dun Hound');
    const chunks: Record<string, IChunk> = { '0,0': { id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities: [{ id: 'h', type: EntityType.MOB, definitionId: hound.id, position: { x: 0.2, y: 0 }, rank: hound.rank, rarity: Rarity.COMMON, isHostile: true, health: 50 }], scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false } as IChunk };
    expect(CombatSystem.tick([], chunks, { x: 0, y: 0, z: 0 }, 100, []).playerDamage).toBe(0);
  });
});

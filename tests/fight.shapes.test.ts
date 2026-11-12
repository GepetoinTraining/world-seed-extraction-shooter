/**
 * THE FIGHT'S SHAPES (the fight's rebalance, part 1), bars set before the build.
 *
 * Pedro, 2026-11-11: "something for us to do is make the combat and bullet shapes, it should be bullet
 * hellish, and meele needs reach, and it needs to have that arc, an axe has reach but doesn't hit close to
 * the character usin ..., a spear can atack forward far, and wide arc... see the concept?"
 *
 * Read as (BALANCE_RUN 2.13): every kind of weapon has a shape of its own on the ground, how far it reaches,
 * how wide it sweeps and where it does not reach at all; shots come in patterns that fill the field. A shape
 * is content: words on the kind, judged by the theme's law and turned into geometry by the one formula. A
 * kind that names none is read from what it already says of itself, so the shipped weapons differ too. What
 * is hit is exactly what the drawn shape covers, and a creature's blow or volley is drawn on the ground before
 * it lands, long enough to step out of.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IItem, Rarity, UniversalRank } from '../shared/types';
import {
  STRIKE_REACHES, STRIKE_SWEEPS, STRIKE_HOLLOWS, VOLLEYS, THEME_SCHEMA, IStrikeWords
} from '../shared/logic/theme/ThemeTypes';
import {
  strikeNumbers, strikeWordsOf, volleyWordOf, creatureVolleyOf, creatureStrikeWords, volleyShots
} from '../shared/logic/theme/ThemeFormula';
import { covers, shapeMarks, bodyRadiusPx, stepOutPx, PERSON_RADIUS_PX } from '../shared/entities/combat/Shapes';
import { bodyOf, compileTheme, sealTheme } from '../shared/logic/theme/ThemeCompiler';
import { ThemeLaw } from '../shared/logic/theme/ThemeLaw';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { THEME_GRAMMAR } from '../shared/intelligence/prompts';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { IProjectile, PatternType, ProjectileSystem, patternOf } from '../shared/entities/combat/projectileSystem';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { BiomeType, EntityType, IChunk, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { TILE_PX } from '../shared/entities/world/grid';
import { BASE_WALK_TILES_PER_S } from '../shared/entities/player/systems/LoadoutSystem';

installShippedThemes();
const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const gearDef = (name: string) => [...Object.values(compiled.items).flat(), ...compiled.craftedGear].find((d: any) => d.universal_name === name) as any;
/** The law reads what a model wrote, under the law that pack was written to. */
const lawful = (pack: any) => ThemeLaw.validate(bodyOf(pack), () => true, FIRST_THEME_PACK.formula).ok;
const mobByName = (name: string) => Object.values(compiled.mobs).find(m => m.name === name)!;
const mint = (template: any, key: string): IItem => ItemFactory.createFromTemplate(template, true, Rng.fromKey(key));
const SRC = (p: string) => readFileSync(p, 'utf8');

const chunkWith = (...entities: IWorldEntity[]): Record<string, IChunk> => ({
  '0,0': {
    id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON,
    entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false
  } as IChunk
});
const body = (def: { id: string; rank: unknown; baseHealth?: number }, id: string, x: number, y = 0, health = 1000): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: def.id, position: { x, y },
  rank: def.rank as UniversalRank, rarity: Rarity.COMMON, isHostile: true, health
});
const swingOf = (weapon: IItem, angle = 0) => {
  const s = CombatMath.strikeOf(weapon);
  return { origin: { x: 0, y: 0 }, angle, range: s.reachPx, inner: s.innerPx, half: s.halfAngle, startTime: Date.now(), damage: 7 };
};
const struckBy = (arc: ReturnType<typeof swingOf>, ...bodies: IWorldEntity[]) => {
  const out = CombatSystem.tick([], chunkWith(...bodies), { x: 0, y: 0, z: 0 }, 100, [arc]);
  return out.events.filter(e => e.type === 'HIT').map(e => e.entityId);
};

describe('a shape comes from words on the kind, through the one formula', () => {
  it('each reach word reaches further than the one before, each sweep is wider, and a haft leaves a hole', () => {
    const at = (w: Partial<IStrikeWords>) => strikeNumbers({ reach: 'middling', sweep: 'arc', hollow: 'none', ...w });
    const reaches = STRIKE_REACHES.map(reach => at({ reach }).reachPx);
    for (let i = 1; i < reaches.length; i++) expect(reaches[i]).toBeGreaterThan(reaches[i - 1]);
    const sweeps = STRIKE_SWEEPS.map(sweep => at({ sweep }).halfAngle);
    for (let i = 1; i < sweeps.length; i++) expect(sweeps[i]).toBeGreaterThan(sweeps[i - 1]);
    expect(at({ hollow: 'none' }).innerPx).toBe(0);
    expect(at({ hollow: 'haft' }).innerPx).toBeGreaterThan(0);
    expect(at({ hollow: 'haft' }).innerPx).toBeLessThan(at({ hollow: 'haft' }).reachPx);
    expect(STRIKE_HOLLOWS).toContain('haft');
  });

  it('the swing Pedro played is the middling arc: three tiles and three quarters of a radian either side', () => {
    const s = strikeNumbers({ reach: 'middling', sweep: 'arc', hollow: 'none' });
    expect(s.reachPx).toBe(3 * TILE_PX);
    expect(s.halfAngle).toBeCloseTo(0.75);
  });

  it('a pack may write strike and volley words on a kind and a volley on a creature; they reach what is minted; an unknown word is refused', () => {
    const gearProps = (THEME_SCHEMA.properties as any).gear.items.properties;
    expect(JSON.stringify(gearProps.strike)).toContain('haft');
    expect(JSON.stringify(gearProps.volley)).toContain('spiral');
    expect(JSON.stringify((THEME_SCHEMA.properties as any).creatures.items.properties.volley)).toContain('ring');
    const pack = JSON.parse(JSON.stringify(FIRST_THEME_PACK));
    const opener = pack.gear.find((g: any) => g.key === 'letter_opener');
    opener.strike = { reach: 'long', sweep: 'thrust', hollow: 'none' };
    const bow = pack.gear.find((g: any) => g.key === 'ruler_bow');
    bow.volley = 'spread';
    const sentry = pack.creatures.find((c: any) => c.key === 'ledger_sentry');
    sentry.volley = 'ring';
    expect(lawful(pack)).toBe(true);
    const out = compileTheme(sealTheme(pack, 'test', 0));
    const spearDef = Object.values(out.items).flat().find((d: any) => d.universal_name === 'Letter Opener') as any;
    expect(spearDef.strike).toEqual({ reach: 'long', sweep: 'thrust', hollow: 'none' });
    const spear = mint(spearDef, 'shapes:spear');
    expect(spear.strike).toEqual({ reach: 'long', sweep: 'thrust', hollow: 'none' });
    expect(CombatMath.strikeOf(spear).reachPx).toBe(strikeNumbers({ reach: 'long', sweep: 'thrust', hollow: 'none' }).reachPx);
    const bowDef = Object.values(out.items).flat().find((d: any) => d.universal_name === 'Steel-Rule Bow') as any;
    expect(CombatMath.volleyOf(mint(bowDef, 'shapes:bow'))).toBe('spread');
    expect(Object.values(out.mobs).find(m => m.name === 'Ledger Sentry')!.volley).toBe('ring');

    opener.strike = { reach: 'endless', sweep: 'thrust', hollow: 'none' };
    expect(lawful(pack)).toBe(false);
    opener.strike = { reach: 'long', sweep: 'thrust', hollow: 'none' };
    bow.volley = 'blizzard';
    expect(lawful(pack)).toBe(false);
    bow.volley = 'spread';
    sentry.volley = 'blizzard';
    expect(lawful(pack)).toBe(false);
  });

  it('the writer is told what the words mean', () => {
    for (const word of [...STRIKE_REACHES, ...STRIKE_SWEEPS, ...STRIKE_HOLLOWS, ...VOLLEYS]) expect(THEME_GRAMMAR).toContain(word);
    expect(THEME_GRAMMAR).toMatch(/strike/);
    expect(THEME_GRAMMAR).toMatch(/volley/);
  });

  it('the pinned pack names none, compiles to what it compiled to, and its weapons still differ from each other', () => {
    expect(FIRST_THEME_PACK.gear.some((g: any) => g.strike || g.volley)).toBe(false);
    expect(gearDef('Letter Opener').strike).toBeUndefined();
    const shapeOf = (name: string) => CombatMath.strikeOf(mint(gearDef(name), `shapes:${name}`));
    const hatchet = shapeOf("Clerk's Hatchet");
    const gavel = shapeOf('Oversized Gavel');
    const pick = shapeOf('Claim Pick');
    const blade = shapeOf('Letter Opener');
    // An axe has reach, and does not hit close to the one holding it
    expect(hatchet.innerPx).toBeGreaterThan(0);
    expect(hatchet.reachPx).toBeGreaterThan(blade.reachPx);
    // A wide arc sweeps close
    expect(gavel.halfAngle).toBeGreaterThan(blade.halfAngle);
    expect(gavel.innerPx).toBe(0);
    // A pick strikes at a point
    expect(pick.halfAngle).toBeLessThan(blade.halfAngle);
    const melee = ['Letter Opener', 'Oversized Gavel', 'Stone-Bound Club', "Clerk's Hatchet", 'Claim Pick', 'Ledger Saw', 'Stamping Hammer'];
    const distinct = new Set(melee.map(n => JSON.stringify(shapeOf(n))));
    expect(distinct.size).toBeGreaterThanOrEqual(5);
  });

  it('a kind is read from its own words, and the reading names no weapon', () => {
    expect(strikeWordsOf(['melee', 'one_hand', 'blade'])).toEqual({ reach: 'middling', sweep: 'arc', hollow: 'none' });
    expect(strikeWordsOf(['tool', 'axe', 'chopping']).hollow).toBe('haft');
    expect(strikeWordsOf(['melee', 'two_hand', 'spear']).sweep).toBe('thrust');
    expect(strikeWordsOf(['melee', 'two_hand', 'spear']).reach).toBe('long');
    expect(strikeWordsOf(['melee', 'two_hand', 'blunt', 'heavy']).sweep).toBe('wide');
    expect(volleyWordOf(['magic', 'caster'])).toBe('ring');
    expect(volleyWordOf(['ranged', 'projectile'])).toBe('single');
    const formula = SRC('shared/logic/theme/ThemeFormula.ts');
    for (const name of ['Letter Opener', 'Gavel', 'Hatchet', 'letter_opener', 'gavel']) expect(formula).not.toContain(name);
  });

  it('shapes and patterns read no rank: tiles and seconds are the same at F and at SSS', () => {
    expect(strikeNumbers.length).toBe(1);
    expect(volleyShots.length).toBe(1);
  });
});

describe('what is hit is exactly what the drawn shape covers', () => {
  it('an axe misses what stands against its wielder and hits at its edge', () => {
    const axe = mint(gearDef("Clerk's Hatchet"), 'shapes:axe');
    const rat = mobByName('Tally Rat');
    const close = body(rat, 'close', 22);
    const edge = body(rat, 'edge', CombatMath.strikeOf(axe).reachPx - 5);
    expect(struckBy(swingOf(axe), close, edge)).toEqual(['edge']);
  });

  it('a spear reaches far ahead where a blade does not, and misses to the side where a blade hits', () => {
    const pack = JSON.parse(JSON.stringify(FIRST_THEME_PACK));
    pack.gear.find((g: any) => g.key === 'letter_opener').strike = { reach: 'long', sweep: 'thrust', hollow: 'none' };
    const out = compileTheme(sealTheme(pack, 'test', 0));
    const spear = mint(Object.values(out.items).flat().find((d: any) => d.universal_name === 'Letter Opener'), 'shapes:spear2');
    const blade = mint(gearDef('Letter Opener'), 'shapes:blade');
    const rat = mobByName('Tally Rat');
    const far = () => body(rat, 'far', strikeNumbers({ reach: 'long', sweep: 'thrust', hollow: 'none' }).reachPx - 4);
    expect(struckBy(swingOf(spear), far())).toEqual(['far']);
    expect(struckBy(swingOf(blade), far())).toEqual([]);
    const aside = () => body(rat, 'aside', 30 * Math.cos(1.0), 30 * Math.sin(1.0));
    expect(struckBy(swingOf(spear), aside())).toEqual([]);
    expect(struckBy(swingOf(blade), aside())).toEqual(['aside']);
  });

  it('a body is struck when the shape covers any part of it: a large one whose edge is under it, not a small one at the same place', () => {
    const shape = strikeNumbers({ reach: 'middling', sweep: 'arc', hollow: 'none' });
    const past = shape.reachPx + bodyRadiusPx('TINY') + 4;
    expect(bodyRadiusPx('LARGE')).toBeGreaterThan(bodyRadiusPx('TINY'));
    expect(covers(shape, { x: 0, y: 0 }, 0, { x: past, y: 0 }, bodyRadiusPx('LARGE'))).toBe(true);
    expect(covers(shape, { x: 0, y: 0 }, 0, { x: past, y: 0 }, bodyRadiusPx('TINY'))).toBe(false);
    const bear = mobByName('Compound Bear'), rat = mobByName('Tally Rat');
    expect(struckBy(swingOf(mint(gearDef('Letter Opener'), 'shapes:b2')), body(bear, 'bear', past))).toEqual(['bear']);
    expect(struckBy(swingOf(mint(gearDef('Letter Opener'), 'shapes:b3')), body(rat, 'rat', past))).toEqual([]);
  });

  it('every mark the field draws lies in the shape, and the marks reach its far edge and its hole', () => {
    for (const words of [
      { reach: 'long', sweep: 'arc', hollow: 'haft' }, { reach: 'long', sweep: 'thrust', hollow: 'none' }, { reach: 'middling', sweep: 'wide', hollow: 'none' }
    ] as IStrikeWords[]) {
      const shape = strikeNumbers(words);
      const marks = shapeMarks(shape, { x: 100, y: 50 }, 0.4, 6);
      expect(marks.length).toBeGreaterThan(10);
      for (const m of marks) expect(covers(shape, { x: 100, y: 50 }, 0.4, m, 0.01)).toBe(true);
      const far = Math.max(...marks.map(m => Math.hypot(m.x - 100, m.y - 50)));
      const near = Math.min(...marks.map(m => Math.hypot(m.x - 100, m.y - 50)));
      expect(far).toBeGreaterThan(shape.reachPx - 4);
      expect(near).toBeLessThan(shape.innerPx + 8);
    }
  });

  it('the field swings the held shape and draws it as it lands', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/CombatMath\.strikeOf\(/);
    expect(canvas).not.toMatch(/range: 60, startTime/);
    const renderer = SRC('src/render/FieldRenderer.ts');
    expect(renderer).toMatch(/shapeMarks\(/);
  });
});

describe('shots come in patterns that fill the field', () => {
  it('a spread, a spiral and a ring each fly more than one shot; a spiral leaves over time, turning', () => {
    expect(volleyShots('single')).toHaveLength(1);
    for (const v of ['spread', 'spiral', 'ring'] as const) expect(volleyShots(v).length).toBeGreaterThan(2);
    const spiral = volleyShots('spiral');
    expect(new Set(spiral.map(s => s.delayMs)).size).toBeGreaterThan(2);
    expect(new Set(spiral.map(s => Math.round(s.offset * 100))).size).toBe(spiral.length);
    const ring = volleyShots('ring');
    expect(Math.max(...ring.map(s => s.offset)) - Math.min(...ring.map(s => s.offset))).toBeGreaterThan(Math.PI);
    expect(Object.values(PatternType)).toContain(patternOf('spiral'));
  });

  it('every volley word becomes a pattern that flies, and a pattern lives as long as its last shot', () => {
    for (const v of VOLLEYS) {
      const pattern = { type: patternOf(v), origin: { x: 0, y: 0 }, startTime: 0, angle: 0 };
      const last = Math.max(...volleyShots(v).map(s => s.delayMs));
      const flying = ProjectileSystem.getProjectilesAtTime(pattern.type, pattern.origin, 0, last + 10, 0);
      expect(flying.length).toBe(volleyShots(v).length);
      expect(ProjectileSystem.lifeMs(pattern)).toBeGreaterThan(last);
      expect(ProjectileSystem.alive(pattern, last + 100)).toBe(true);
      expect(ProjectileSystem.alive(pattern, ProjectileSystem.lifeMs(pattern) + 1)).toBe(false);
    }
  });

  it('a volley lands once on one body, however many of its shots reach it', () => {
    const rat = mobByName('Tally Rat');
    const chunks = chunkWith(body(rat, 'target', 30));
    const struck = new Set<string>();
    const pattern = { type: PatternType.SHOTGUN, origin: { x: 0, y: 0 }, startTime: 0, angle: 0, damage: 5, struck };
    const shots: IProjectile[] = ProjectileSystem.liveShots(pattern, id => `v_${id}`, 150, 0, new Map());
    expect(shots.length).toBe(volleyShots('spread').length);
    const out = CombatSystem.tick(shots, chunks, { x: 0, y: 0, z: 0 }, 100, []);
    expect(out.events.filter(e => e.type === 'HIT')).toHaveLength(1);
    expect(out.updatedChunks['0,0'].entities[0].health).toBe(995);
  });

  it('what a person holds fires its own pattern: a focus rings, a bow and a stone fly one, unless their words say otherwise', () => {
    expect(CombatMath.volleyOf(mint(gearDef("Clerk's Abacus"), 'shapes:focus'))).toBe('ring');
    expect(CombatMath.volleyOf(mint(gearDef('Steel-Rule Bow'), 'shapes:bow2'))).toBe('single');
    expect(CombatMath.volleyOf(undefined)).toBe('single');
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/CombatMath\.volleyOf\(/);
  });

  it("a creature's volley is read from what it says of itself: a bolted-down thing turns a spiral, a bigger body fills more", () => {
    expect(creatureVolleyOf({ size: 'MEDIUM', behavior: 'TURRET' })).toBe('spiral');
    expect(creatureVolleyOf({ size: 'TINY', behavior: 'AGGRESSIVE' })).toBe('single');
    expect(volleyShots(creatureVolleyOf({ size: 'GIGANTIC', behavior: 'NEUTRAL' })).length)
      .toBeGreaterThan(volleyShots(creatureVolleyOf({ size: 'MEDIUM', behavior: 'AGGRESSIVE' })).length);
    expect(creatureStrikeWords({ size: 'GIGANTIC', behavior: 'NEUTRAL' }).reach).toBe('long');
    expect(creatureStrikeWords({ size: 'LARGE', behavior: 'SIEGE' }).sweep).toBe('wide');
  });
});

describe("a creature's blow or volley is drawn on the ground before it lands, long enough to step out of", () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const run = (chunks: Record<string, IChunk>, person: (t: number) => { x: number; y: number }, ms: number, step = 25) => {
    const patterns: any[] = [];
    const telegraphs: any[] = [];
    for (let t = 0; t < ms; t += step) {
      vi.advanceTimersByTime(step);
      const out = MobAI.tick(chunks, person(t), step / 1000);
      patterns.push(...out.spawnedPatterns.map(p => ({ ...p, at: person(t) })));
      chunks = { ...chunks, ...out.updatedChunks };
      const seen = chunks['0,0'].entities[0];
      if (seen?.telegraph) telegraphs.push({ ...seen.telegraph, t });
    }
    return { patterns, telegraphs };
  };

  it("a blow's wind-up carries its shape, aimed where the person stood when it began, for long enough to step out at a walk", () => {
    const teller = mobByName('Teller Still On Shift');
    const { telegraphs } = run(chunkWith(body(teller, 'teller', 0)), () => ({ x: 30, y: 0 }), 1200);
    const t = telegraphs.find(x => x.delivery === 'melee');
    expect(t).toBeDefined();
    expect(t.shape).toEqual(strikeNumbers(creatureStrikeWords(teller)));
    expect(t.angle).toBeCloseTo(0);
    const way = stepOutPx(t.shape, 30, PERSON_RADIUS_PX);
    expect(way).toBeGreaterThan(0);
    expect(t.until - t.startedAt).toBeGreaterThanOrEqual(way / (BASE_WALK_TILES_PER_S * TILE_PX) * 1000);
  });

  it('it lands on a person who stays, and not on one who steps aside while it winds up', () => {
    const teller = mobByName('Teller Still On Shift');
    const stays = run(chunkWith(body(teller, 'teller', 0)), () => ({ x: 30, y: 0 }), 1500);
    const blow = stays.patterns.find(p => p.type === 'MELEE');
    expect(blow).toBeDefined();
    expect(covers(blow.shape, blow.origin, blow.angle, blow.at, PERSON_RADIUS_PX)).toBe(true);

    MobAI.reset();
    // The person stands until the wind-up is drawn, then steps aside, still close
    let chunks = chunkWith(body(teller, 'teller', 0));
    let person = { x: 30, y: 0 };
    let dodged: any;
    for (let t = 0; t < 1500 && !dodged; t += 25) {
      vi.advanceTimersByTime(25);
      const out = MobAI.tick(chunks, person, 0.025);
      chunks = { ...chunks, ...out.updatedChunks };
      if (chunks['0,0'].entities[0].telegraph?.delivery === 'melee') person = { x: 0, y: 45 };
      dodged = out.spawnedPatterns.find(p => p.type === 'MELEE');
    }
    expect(dodged).toBeDefined();
    expect(dodged.angle).toBeCloseTo(0);
    expect(covers(dodged.shape, dodged.origin, dodged.angle, person, PERSON_RADIUS_PX)).toBe(false);
    expect(covers(dodged.shape, dodged.origin, dodged.angle, { x: 30, y: 0 }, PERSON_RADIUS_PX)).toBe(true);
  });

  it('a shooting creature draws its volley before it flies, and flies that volley', () => {
    const sentry = mobByName('Ledger Sentry');
    const { telegraphs, patterns } = run(chunkWith(body(sentry, 'sentry', 0)), () => ({ x: 120, y: 0 }), 8000, 50);
    const shot = telegraphs.find(x => x.delivery === 'ranged');
    expect(shot?.volley).toBe('spiral');
    const fired = patterns.find(p => p.abilityId || p.type !== 'MELEE');
    expect(fired.type).toBe(patternOf('spiral'));
    expect(fired.struck).toBeInstanceOf(Set);
  });

  it('the field resolves a blow by the shape it drew, and draws a creature\'s shape and lanes on the ground', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/covers\(p\.shape/);
    const renderer = SRC('src/render/FieldRenderer.ts');
    expect(renderer).toMatch(/t\.shape/);
    expect(renderer).toMatch(/volleyShots\(/);
  });
});

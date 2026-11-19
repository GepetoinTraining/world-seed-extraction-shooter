/**
 * SHOTS READ OFF WHAT FIRES THEM.
 *
 * Pedro, 2026-11-18: "the fighting needs the ... the ships... you know the old arcade game where each little thing
 * you grab changes the bullets slightly? OUR bullets need to be that granular, on a tensor, meaning we don't choose,
 * slight vairantions change them between the same weapon rolled twice".
 *
 * Read as (`shared/logic/theme/ShotLaw.ts`, BALANCE_RUN 2.13): a volley is a point in a space of small measures; a
 * kind keeps a middle there; a piece is moved off it by its own words, its one roll and each line it holds, each a
 * push whose direction nobody wrote; and what a shape gains in shots, speed or reach it pays for in the others, so
 * a piece deals in a second what its numbers already said. A creature fires by the same rule, read off its kind.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IItem, Rarity, SlotType, UniversalRank } from '../shared/types';
import {
  IShotShape, SHOT_FLIGHT_S, SHOT_SPEED_PX, STAT_SCALE, creatureVolleyOf, shotAt, shotFlightS, shotsOf, volleyShape, volleyShots
} from '../shared/logic/theme/ThemeFormula';
import { VOLLEYS } from '../shared/logic/theme/ThemeTypes';
import {
  LINE_PUSH, SHOT_MEASURES, SHOTS_WORTH, creatureShot, directionOf, pieceShot, piecePush, pushed, qualityPush, shotDistance, shotWorth, wordsPush
} from '../shared/logic/theme/ShotLaw';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { IFiredPattern, PatternType, ProjectileSystem, patternOf } from '../shared/entities/combat/projectileSystem';
import { fireMode } from '../src/logic/systems/FieldInput';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { BiomeType, EntityType, IChunk, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { TILE_PX } from '../shared/entities/world/grid';

installShippedThemes();
const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const allGear = [...Object.values(compiled.items).flat(), ...compiled.craftedGear] as any[];
const gearDef = (name: string) => allGear.find(d => d.universal_name === name);
const mobByName = (name: string) => Object.values(compiled.mobs).find(m => m.name === name)!;
const SRC = (p: string) => readFileSync(p, 'utf8');

/** Every kind in the first theme whose hand shoots: nothing is named here, the kinds are found by how they fire. */
const SHOOTERS = allGear.filter(d => {
  if (d.slot !== SlotType.MAIN_HAND) return false;
  const piece = ItemFactory.createFromTemplate(d, true, Rng.fromKey(`shots:probe:${d.id}`));
  return fireMode(piece) !== 'MELEE' && CombatMath.shotRangePx(piece) === undefined;
});
const BOW = gearDef('Steel-Rule Bow');
const FOCUS = gearDef("Clerk's Abacus");

/** A piece as the game rolls it: its quality drawn, and its depth drawn at the game's own odds; every fourth with pairs open, so lines are met. */
const rolled = (def: any, i: number): IItem =>
  ItemFactory.createFromTemplate(def, true, Rng.fromKey(`shots:${def.id}:${i}`), undefined, undefined, i % 4 === 3 ? { pairsOpen: true, odds: 4 } : { pairsOpen: false });
/** The same kind at a quality named, holding nothing: the roll alone. */
const plain = (def: any, quality: number): IItem =>
  ItemFactory.createFromTemplate(def, true, Rng.fromKey(`shots:plain:${def.id}`), undefined, undefined, { quality, depth: 0 });
const ROLLS = 240;
const many = (def: any) => Array.from({ length: ROLLS }, (_, i) => rolled(def, i));

const chunkWith = (...entities: IWorldEntity[]): Record<string, IChunk> => ({
  '0,0': { id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false } as IChunk
});
const body = (def: { id: string; rank: unknown }, id: string, x: number, y = 0, health = 1e9): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: def.id, position: { x, y }, rank: def.rank as UniversalRank, rarity: Rarity.COMMON, isHostile: true, health
});

describe('the space: every volley there is flies from one point of it', () => {
  it('the four words are points, and fly exactly what they flew: one shot, a fan of three, a turning spiral, a ring of eight', () => {
    expect(volleyShots('single')).toEqual([{ delayMs: 0, offset: 0 }]);
    expect(volleyShots('spread').map(s => s.offset).sort((a, b) => a - b).map(o => +o.toFixed(6))).toEqual([-0.3, 0, 0.3]);
    const ring = volleyShots('ring').map(s => ((s.offset % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
    ring.forEach((o, i) => expect(o).toBeCloseTo((i * 2 * Math.PI) / 8));
    const spiral = volleyShots('spiral');
    expect(spiral).toHaveLength(15);
    expect(Math.max(...spiral.map(s => s.delayMs))).toBe(4 * 80);
    for (const v of VOLLEYS) {
      const s = volleyShape(v);
      expect(s.speedPx).toBe(SHOT_SPEED_PX);
      expect(shotFlightS(s)).toBeCloseTo(SHOT_FLIGHT_S);
      expect(s.curve).toBe(0);
      expect(s.swayPx).toBe(0);
    }
  });

  it('a pattern that names no shape flies its word\'s plain middle, as every volley did before', () => {
    const [shot] = ProjectileSystem.getProjectilesAtTime(PatternType.SINGLE, { x: 5, y: 7 }, 0, 500, 0);
    expect(shot.x).toBeCloseTo(5 + SHOT_SPEED_PX * 0.5);
    expect(shot.y).toBeCloseTo(7);
    expect(ProjectileSystem.lifeMs({ type: PatternType.SINGLE })).toBeCloseTo(SHOT_FLIGHT_S * 1000);
    // A throw's shorter flight is the same path cut short
    expect(ProjectileSystem.lifeMs({ type: PatternType.SINGLE, rangePx: 160 })).toBeCloseTo((160 / SHOT_SPEED_PX) * 1000);
  });

  it('one lane always flies where the volley is aimed, whatever the count of lanes', () => {
    for (let arms = 1; arms <= 12; arms++) {
      const shots = shotsOf({ ...volleyShape('single'), arms, fan: 1.1 });
      expect(shots).toHaveLength(arms);
      expect(shots.filter(s => s.offset === 0)).toHaveLength(1);
      expect(new Set(shots.map(s => s.offset.toFixed(6))).size).toBe(arms);
    }
  });

  it('a bent shot leaves to one side of its lane and ends on it; a swaying one swings either side of its path', () => {
    const bent = { ...volleyShape('single'), curve: 0.6 };
    const lane = 0.4;
    const end = shotAt(bent, lane, bent.reachPx);
    expect(Math.atan2(end.y, end.x)).toBeCloseTo(lane);
    const mid = shotAt(bent, lane, bent.reachPx / 2);
    const off = -Math.sin(lane) * mid.x + Math.cos(lane) * mid.y;
    expect(Math.abs(off)).toBeGreaterThan(10);
    const swaying = { ...volleyShape('single'), swayPx: 6, swayLenPx: 80 };
    const sides = [20, 60].map(d => shotAt(swaying, 0, d).y);
    expect(sides[0]).toBeCloseTo(6);
    expect(sides[1]).toBeCloseTo(-6);
    expect(shotAt(swaying, 0, 80).y).toBeCloseTo(0);
  });

  it('a flying shot says where it was a frame ago along its own path, so a slow frame skips nothing on a bend', () => {
    const shape = { ...volleyShape('single'), curve: 0.8, swayPx: 5 };
    const pattern: IFiredPattern = { type: PatternType.SINGLE, origin: { x: 0, y: 0 }, startTime: 0, angle: 0, shape };
    const [now] = ProjectileSystem.liveShots(pattern, id => id, 900, 800, new Map());
    const [then] = ProjectileSystem.liveShots(pattern, id => id, 800, 700, new Map());
    expect(now.prevX).toBeCloseTo(then.x);
    expect(now.prevY).toBeCloseTo(then.y);
  });
});

describe('(c1) the same piece, the same shot', () => {
  it('a piece minted twice from one key fires the same point, and so does a copy of it read back from its words', () => {
    for (const def of SHOOTERS) {
      for (let i = 0; i < 40; i++) {
        const a = rolled(def, i), b = rolled(def, i);
        expect(CombatMath.shotOf(a)).toEqual(CombatMath.shotOf(b));
        expect(CombatMath.shotOf(JSON.parse(JSON.stringify(a)))).toEqual(CombatMath.shotOf(a));
      }
    }
  });

  it('nothing but the piece is read: no clock, no count of shots, no wear, no name and no id moves it', () => {
    const piece = rolled(BOW, 7);
    const first = CombatMath.shotOf(piece);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01'));
    const later = CombatMath.shotOf({ ...piece, id: 'another', name: 'Another Name', stats: { ...piece.stats, durability: 3 }, history: { dropDate: 1, killCount: 99 } } as IItem);
    vi.useRealTimers();
    expect(later).toEqual(first);
    const source = SRC('shared/logic/theme/ShotLaw.ts');
    expect(source).not.toMatch(/Date\.now|Math\.random|performance\./);
  });

  it('every shot of its volley is in the same place at the same moment, fired twice', () => {
    const piece = rolled(FOCUS, 3);
    const fire = (): IFiredPattern => ({ type: patternOf(CombatMath.volleyOf(piece)), shape: CombatMath.shotOf(piece), origin: { x: 100, y: 50 }, startTime: 1000, angle: 0.3 });
    for (const t of [1016, 1200, 1700, 2400]) {
      expect(ProjectileSystem.liveShots(fire(), id => id, t, t - 16, new Map())).toEqual(ProjectileSystem.liveShots(fire(), id => id, t, t - 16, new Map()));
    }
  });
});

describe('(c2) two rolls differ, each inside the ground its kind keeps', () => {
  it('every ranged kind of the first theme fires through the rule, and the field asks it', () => {
    expect(SHOOTERS.map(d => d.universal_name).sort()).toEqual(["Auditor's Seal", "Clerk's Abacus", 'Steel-Rule Bow']);
    for (const def of SHOOTERS) {
      const piece = rolled(def, 1);
      expect(CombatMath.shotOf(piece)).toEqual(pieceShot(piece, CombatMath.volleyOf(piece)));
    }
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas.match(/shape: CombatMath\.shotOf\(weapon\)/g)).toHaveLength(2);
    expect(SRC('src/render/atoms/inspect.ts')).toMatch(/CombatMath\.shotOf\(hand\)/);
  });

  it('no two rolls of a kind fire the same point', () => {
    for (const def of SHOOTERS) {
      const shapes = many(def).map(p => JSON.stringify(CombatMath.shotOf(p)));
      expect(new Set(shapes).size).toBe(ROLLS);
    }
  });

  it('two rolls can be told apart by eye: most pairs differ by a different count of shots or by more than a plain shot is wide, somewhere in flight', () => {
    const PLAIN_SHOT_PX = 8;
    for (const def of SHOOTERS) {
      const pieces = many(def);
      let told = 0, pairs = 0;
      for (let i = 0; i + 1 < pieces.length; i += 2) {
        const a = CombatMath.shotOf(pieces[i]), b = CombatMath.shotOf(pieces[i + 1]);
        pairs++;
        if (shotsOf(a).length !== shotsOf(b).length) { told++; continue; }
        // Both volleys seen at the same moments after they leave, shot against shot
        const life = Math.min(shotFlightS(a), shotFlightS(b));
        const apart = Math.max(...[0.25, 0.5, 0.75, 1].flatMap(share => shotsOf(a).map((sa, n) => {
          const sb = shotsOf(b)[n];
          const pa = shotAt(a, sa.offset, a.speedPx * life * share), pb = shotAt(b, sb.offset, b.speedPx * life * share);
          return Math.hypot(pa.x - pb.x, pa.y - pb.y);
        })));
        if (apart > PLAIN_SHOT_PX) told++;
      }
      expect(told / pairs).toBeGreaterThan(0.9);
    }
  });

  it('a hair apart in the roll is a hair apart in flight, and further apart is further: the roll is read smoothly', () => {
    for (const def of SHOOTERS) {
      for (const q of [-0.17, -0.06, 0.02, 0.11]) {
        const at = (quality: number) => piecePush(plain(def, quality));
        const gap = (a: ReturnType<typeof piecePush>, b: ReturnType<typeof piecePush>) => Math.hypot(...SHOT_MEASURES.map(m => a[m] - b[m]));
        const hair = gap(at(q), at(q + 0.001)), step = gap(at(q), at(q + 0.01)), stride = gap(at(q), at(q + 0.05));
        expect(hair).toBeGreaterThan(0);
        expect(hair).toBeLessThan(0.03);
        expect(step).toBeGreaterThan(hair);
        expect(stride).toBeGreaterThan(step);
      }
    }
  });

  it('a kind keeps its ground: every roll stands nearer its own kind\'s middle than another kind\'s; no bow\'s fan comes round and no focus\'s closes to a fan', () => {
    const bows = many(BOW).map(p => CombatMath.shotOf(p)), foci = many(FOCUS).map(p => CombatMath.shotOf(p));
    const bowMiddle = volleyShape(CombatMath.volleyOf(rolled(BOW, 0))), focusMiddle = volleyShape(CombatMath.volleyOf(rolled(FOCUS, 0)));
    expect(bowMiddle).not.toEqual(focusMiddle);
    for (const s of bows) expect(shotDistance(s, bowMiddle)).toBeLessThan(shotDistance(s, focusMiddle));
    for (const s of foci) expect(shotDistance(s, focusMiddle)).toBeLessThan(shotDistance(s, bowMiddle));
    // Seen in what leaves the hand: a bow's lanes stay a fan ahead of it, a focus's go most of the way round or all of it
    for (const s of bows) expect(s.fan).toBeLessThan(Math.PI);
    for (const s of foci) expect(s.fan).toBeGreaterThan(Math.PI);
    // And in the count: a bow holding no line never fans more lanes than the fewest any such focus rings
    const lineless = (def: any) => many(def).filter(p => p.affixes.length === 0).map(p => CombatMath.shotOf(p).arms);
    expect(Math.max(...lineless(BOW))).toBeLessThan(Math.min(...lineless(FOCUS)));
  });

  it('a kind\'s own words give it a lean of its own: two kinds of one word differ, and every piece of a kind shares its kind\'s', () => {
    const seal = gearDef("Auditor's Seal");
    expect(wordsPush(BOW.tags)).not.toEqual(wordsPush(FOCUS.tags));
    expect(wordsPush(seal.tags)).toEqual(wordsPush(FOCUS.tags));
    expect(wordsPush([...FOCUS.tags, 'a_word_a_pack_writes_tomorrow'])).not.toEqual(wordsPush(FOCUS.tags));
  });
});

describe('each thing a piece holds is one push, and nobody wrote which way', () => {
  it('a direction is drawn from the word alone, has length one, and is the same wherever it is asked', () => {
    for (const word of [...Object.keys(STAT_SCALE), 'a_stat_a_pack_writes_tomorrow']) {
      const way = directionOf(word);
      expect(Math.hypot(...SHOT_MEASURES.map(m => way[m]))).toBeCloseTo(1);
      expect(directionOf(word)).toEqual(way);
    }
    expect(directionOf('crit_chance')).not.toEqual(directionOf('poison_damage'));
  });

  it('the rule names no stat and no weapon: its only tables are the measures and their units', () => {
    const source = SRC('shared/logic/theme/ShotLaw.ts');
    for (const stat of Object.keys(STAT_SCALE)) expect(source).not.toContain(`'${stat}'`);
    for (const def of allGear) { expect(source).not.toContain(def.universal_name); expect(source).not.toContain(def.id); }
    for (const word of ['bow', 'focus', 'blade', 'quiver']) expect(source).not.toMatch(new RegExp(`['"\`]${word}['"\`]`));
  });

  it('a line pushes by its size in rulers: a major twice a moderate, a minor half, the same at any rank and any roll', () => {
    const lineless = (rank: string, quality: number) => ({ rank, quality, tags: BOW.tags, affixes: [] });
    const withLine = (rank: string, quality: number, band: 'minor' | 'moderate' | 'major') =>
      ({ ...lineless(rank, quality), affixes: [{ stats: PieceLaw.affixStats({ gift: { stat: 'crit_chance', band } }, rank, quality) }] });
    const moved = (rank: string, quality: number, band: 'minor' | 'moderate' | 'major') => {
      const a = piecePush(withLine(rank, quality, band)), b = piecePush(lineless(rank, quality));
      return SHOT_MEASURES.map(m => a[m] - b[m]);
    };
    const way = directionOf('crit_chance');
    const moderate = moved('F', 0.1, 'moderate');
    SHOT_MEASURES.forEach((m, i) => expect(moderate[i]).toBeCloseTo(LINE_PUSH * way[m]));
    SHOT_MEASURES.forEach((_, i) => expect(moved('F', 0.1, 'major')[i]).toBeCloseTo(2 * moderate[i]));
    SHOT_MEASURES.forEach((_, i) => expect(moved('F', 0.1, 'minor')[i]).toBeCloseTo(0.5 * moderate[i]));
    SHOT_MEASURES.forEach((_, i) => expect(moved('SS', -0.15, 'moderate')[i]).toBeCloseTo(moderate[i]));
  });

  it('a piece holding more lines stands further from its kind\'s middle, on the whole', () => {
    const far = (depth: number) => {
      const pieces = Array.from({ length: 80 }, (_, i) => ItemFactory.createFromTemplate(BOW, true, Rng.fromKey(`shots:deep:${depth}:${i}`), undefined, undefined, { depth, pairsOpen: true }));
      expect(pieces.every(p => p.affixes.length === (depth <= 1 ? depth : 2 * (depth - 1)))).toBe(true);
      const pushes = pieces.map(p => { const a = piecePush(p), b = piecePush({ ...p, affixes: [] }); return Math.hypot(...SHOT_MEASURES.map(m => a[m] - b[m])); });
      return pushes.reduce((s, n) => s + n, 0) / pushes.length;
    };
    const none = far(0), one = far(1), four = far(3);
    expect(none).toBe(0);
    expect(one).toBeGreaterThan(0);
    expect(four).toBeGreaterThan(one);
  });

  it('a rank moves nothing: the same roll of the same kind fires the same point at F and at SSS', () => {
    for (const def of SHOOTERS) {
      const piece = ItemFactory.createFromTemplate(def, true, Rng.fromKey(`shots:rank:${def.id}`), undefined, UniversalRank.F, { depth: 0 });
      expect(CombatMath.shotOf({ ...piece, rank: UniversalRank.SSS })).toEqual(CombatMath.shotOf(piece));
    }
    expect(qualityPush(0.0731)).toEqual(qualityPush(0.0731));
  });
});

describe('(c3) what a piece deals in a second is what its numbers already said', () => {
  it('every rolled shape is worth exactly what its kind\'s middle is: shots, counting half, times speed times reach', () => {
    expect(SHOTS_WORTH).toBe(0.5);
    for (const def of SHOOTERS) {
      for (const piece of many(def)) {
        const shape = CombatMath.shotOf(piece);
        expect(shotWorth(shape) / shotWorth(volleyShape(CombatMath.volleyOf(piece)))).toBeCloseTo(1, 9);
      }
    }
  });

  it('so more shots fly slower and less far, and a faster shot less far: nothing is gained that is not paid for', () => {
    const middle = volleyShape('single');
    const push = (over: Partial<Record<typeof SHOT_MEASURES[number], number>>) => pushed(middle, { ...Object.fromEntries(SHOT_MEASURES.map(m => [m, 0])), ...over } as never);
    const more = push({ arms: 2 });
    expect(more.arms).toBeGreaterThan(middle.arms);
    expect(more.speedPx).toBeLessThan(middle.speedPx);
    expect(more.reachPx).toBeLessThan(middle.reachPx);
    const faster = push({ speedPx: 1 });
    expect(faster.speedPx).toBeGreaterThan(middle.speedPx);
    expect(faster.reachPx).toBeLessThan(middle.reachPx);
    expect(faster.speedPx * faster.reachPx).toBeCloseTo(middle.speedPx * middle.reachPx);
    // What costs nothing either way leaves speed and reach alone
    const turned = push({ fan: 1, gapMs: -1, twist: 1, curve: -1, swayPx: 1, swayLenPx: 1 });
    expect(turned.speedPx).toBeCloseTo(middle.speedPx);
    expect(turned.reachPx).toBeCloseTo(middle.reachPx);
  });

  it('played out over many rolled pieces: a body standing in the aim takes one blow from each volley, so a second deals blow times rate, whatever the shape', () => {
    const rat = mobByName('Tally Rat');
    let fired = 0, manyShots = 0;
    for (const def of SHOOTERS) {
      for (const piece of many(def).slice(0, 120)) {
        const shape = CombatMath.shotOf(piece);
        const blow = CombatMath.weaponDamage(piece, undefined, String(piece.rank));
        const pattern: IFiredPattern = { type: patternOf(CombatMath.volleyOf(piece)), shape, origin: { x: 0, y: 0 }, startTime: 0, angle: 0, damage: blow, struck: new Set<string>() };
        let chunks = chunkWith(body(rat, 'target', TILE_PX));
        const spent = new Map<string, number>();
        const life = ProjectileSystem.lifeMs(pattern);
        let landed = 0;
        for (let t = 16; t <= life + 16; t += 16) {
          const shots = ProjectileSystem.liveShots(pattern, id => id, t, t - 16, spent);
          const out = CombatSystem.tick(shots, chunks, { x: 0, y: 0, z: 0 }, 100, []);
          const still = new Set(out.survivingBullets.map(b => b.id));
          shots.forEach(b => { if (!still.has(b.id)) spent.set(b.id, t); });
          landed += out.events.filter(e => e.type === 'HIT').reduce((s, e) => s + (e.damage ?? 0), 0);
          chunks = out.updatedChunks;
        }
        // One volley, one blow on one body: the piece's own blow, neither split among its shots nor multiplied by them
        expect(landed).toBe(blow);
        const perSecond = landed * CombatMath.ownRate(piece);
        expect(perSecond).toBeCloseTo(CombatMath.ownBlow(piece, String(piece.rank)) * (piece.stats.attack_speed as number), 9);
        fired++;
        if (shotsOf(shape).length > 1) manyShots++;
      }
    }
    expect(fired).toBe(SHOOTERS.length * 120);
    expect(manyShots).toBeGreaterThan(fired / 3);
  });

  it('the rule leaves the piece\'s own rate and blow alone: it reads no speed of the hand and writes none', () => {
    const piece = rolled(BOW, 11);
    const before = JSON.stringify(piece);
    CombatMath.shotOf(piece);
    expect(JSON.stringify(piece)).toBe(before);
    const source = SRC('shared/logic/theme/ShotLaw.ts');
    expect(source).not.toMatch(/attack_speed['"]|itemPower|haste/);
  });
});

describe('a bare hand and a stone throw the plain shot, eight tiles', () => {
  it('nothing rolled is read where there is nothing rolled to read', () => {
    const hand = CombatMath.shotOf(undefined);
    expect(hand).toEqual({ ...volleyShape('single'), reachPx: CombatMath.shotRangePx(undefined) });
    expect(shotsOf(hand)).toHaveLength(1);
  });
});

describe('a creature fires by the same rule, read off its kind', () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('every body of a kind fires alike; kinds written with other words fire apart; each is worth its word\'s middle', () => {
    const mobs = Object.values(compiled.mobs);
    for (const kind of mobs) {
      const word = creatureVolleyOf(kind);
      const shape = creatureShot(kind, word);
      expect(creatureShot({ ...kind }, word)).toEqual(shape);
      expect(shotWorth(shape) / shotWorth(volleyShape(word))).toBeCloseTo(1, 9);
      expect(shape).toEqual(pushed(volleyShape(word), wordsPush(kind.tags)));
    }
    const rat = mobByName('Tally Rat'), moth = mobByName('Lien Moth');
    expect(creatureVolleyOf(rat)).toBe(creatureVolleyOf(moth));
    expect(rat.tags).not.toEqual(moth.tags);
    expect(creatureShot(rat, creatureVolleyOf(rat))).not.toEqual(creatureShot(moth, creatureVolleyOf(moth)));
  });

  it('what it draws before it shoots is what it then flies: the wind-up and the volley carry the same point', () => {
    const sentry = mobByName('Ledger Sentry');
    const want = creatureShot(sentry, creatureVolleyOf(sentry));
    let chunks = chunkWith(body(sentry, 'sentry', 0, 0, 1000));
    let drawn: IShotShape | undefined, flown: IShotShape | undefined;
    for (let t = 0; t < 8000 && !flown; t += 50) {
      vi.advanceTimersByTime(50);
      const out = MobAI.tick(chunks, { x: 120, y: 0 }, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
      const telegraph = chunks['0,0'].entities[0]?.telegraph;
      if (telegraph?.delivery === 'ranged') drawn = telegraph.shot;
      flown = out.spawnedPatterns.find(p => p.type !== 'MELEE' && p.type !== 'AREA')?.shape;
    }
    expect(drawn).toEqual(want);
    expect(flown).toEqual(want);
    const renderer = SRC('src/render/FieldRenderer.ts');
    expect(renderer).toMatch(/t\.shot \?\? volleyShape\(/);
    expect(renderer).toMatch(/shotAt\(flown, t\.angle \+ shot\.offset, d\)/);
  });

  it('a person\'s own wind-up draws the lanes their piece will fly', () => {
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/shot: CombatMath\.shotOf\(held\)/);
    expect(SRC('src/render/FieldRenderer.ts')).toMatch(/shotAt\(w\.shot, w\.angle \+ lane, d\)/);
  });
});

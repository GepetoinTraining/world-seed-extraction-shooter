/**
 * SHOOTING, AS PEDRO MET IT (2026-11-12), bars set before the fixes.
 *
 * Pedro played one round on main (854bcce) on a fresh character at rank F and said: "it plays well, but EITHER
 * there's a HUGE bug on the shooting or accuracy is a bitch". These bars hold what was found by shooting as he did.
 *
 * SH1, the coordinator's call on his word: a shot is felt, but it breaks only what is lighter than a person. Only a
 * blow struck in reach breaks a person's draw, because closing the distance is how speed beats a shooter; a field
 * full of shots must not stop every shooter in it. One rule, a shot's weight against a body's poise: a shot weighs
 * half the middling blow, so it breaks what stands at less than a person and nothing that stands as firmly.
 */

import { describe, it, expect } from 'vitest';
import { strikeNumbers, blowWeight, bodyPoise, feltHit, SHOT_WEIGHT, creatureBlowWeight } from '../shared/logic/theme/ThemeFormula';
import { TILE_PX } from '../shared/entities/world/grid';
import { aimAt } from '../src/logic/systems/FieldInput';
import { readFileSync } from 'node:fs';
import { CombatSystem, SHOT_LANDS_PX, landsOn, shotLandsWithinPx } from '../src/entities/combat/CombatSystems';
import { ProjectileSystem, PatternType } from '../shared/entities/combat/projectileSystem';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { BiomeType, EntityType, IChunk, ScanLevel } from '../shared/entities/world/types';
import { bodyRadiusPx } from '../shared/entities/combat/Shapes';
import { IEquipmentState, IItem, SlotType } from '../shared/types';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { UNARMED_SHOTS_PER_SEC } from '../shared/logic/systems/FightNumbers';

const middling = () => blowWeight(strikeNumbers({ reach: 'middling', sweep: 'arc', hollow: 'none' }));
const PERSON = bodyPoise('MEDIUM');

describe('SH1: a shot is felt, and breaks only what is lighter than a person', () => {
  it('a shot weighs half the middling blow', () => {
    expect(SHOT_WEIGHT).toBeCloseTo(middling() / 2);
  });

  it('a shot does not break a person\'s draw; a middling blow struck in reach does', () => {
    expect(feltHit(SHOT_WEIGHT, PERSON).breaks).toBe(false);
    expect(feltHit(middling(), PERSON).breaks).toBe(true);
    // A large creature's blow struck in reach still breaks it (a middling creature's weighs 0.78 and never did)
    expect(feltHit(creatureBlowWeight({ size: 'LARGE' }), PERSON).breaks).toBe(true);
  });

  it('by the same rule a shot breaks a small body\'s wind-up and not a middling one\'s', () => {
    expect(feltHit(SHOT_WEIGHT, bodyPoise('TINY')).breaks).toBe(true);
    expect(feltHit(SHOT_WEIGHT, bodyPoise('MEDIUM')).breaks).toBe(false);
    expect(feltHit(SHOT_WEIGHT, bodyPoise('LARGE')).breaks).toBe(false);
  });

  it('on a person a shot pushes a third of a tile and takes a third of their pace for a third of a second', () => {
    const f = feltHit(SHOT_WEIGHT, PERSON);
    expect(f.share).toBeCloseTo(1 / 3);
    expect(f.pushPx).toBeCloseTo(TILE_PX / 3);
    expect(f.pause.magnitude).toBeCloseTo(1 / 3);
    expect(f.pause.durationMs).toBe(333);
  });
});

/**
 * SH2, a fault found by shooting as Pedro did: a blow begun by a click was aimed where the button was when the blow
 * let go. The draw stands for six tenths of the hand's cycle (0.6 s for a stone or a bare hand), and a click is let
 * go long before that, so the release no longer saw the pointer held and aimed at what the inspect card held, or
 * the way the person last walked. A blow begun by the pointer flies at the pointer as it is when the blow lets go,
 * held or not; one begun by the attack key at what the inspect card holds, or the way its holder faces.
 */

describe('SH2: a blow begun by the pointer flies at the pointer, held or let go', () => {
  const centre = { x: 500, y: 400 };
  it('begun by the pointer, it flies at the pointer as it stands when the blow lets go', () => {
    expect(aimAt({ by: 'pointer', pointer: { x: 600, y: 400 }, centre, facing: 'up' })).toBeCloseTo(0);
    expect(aimAt({ by: 'pointer', pointer: { x: 500, y: 300 }, centre, facing: 'right' })).toBeCloseTo(-Math.PI / 2);
  });
  it('the pointer wins over what the inspect card holds and over the way you face', () => {
    expect(aimAt({ by: 'pointer', pointer: { x: 400, y: 400 }, centre, held: { dx: 0, dy: 50 }, facing: 'right' })).toBeCloseTo(Math.PI);
  });
  it('begun by the attack key, it flies at what the inspect card holds, or the way you face', () => {
    expect(aimAt({ by: 'key', pointer: { x: 400, y: 400 }, centre, held: { dx: 0, dy: 50 }, facing: 'right' })).toBeCloseTo(Math.PI / 2);
    expect(aimAt({ by: 'key', pointer: { x: 400, y: 400 }, centre, facing: 'down' })).toBeCloseTo(Math.PI / 2);
    // A pointer never moved over the field aims as the key does
    expect(aimAt({ by: 'pointer', centre, facing: 'left' })).toBeCloseTo(Math.PI);
  });
  it('the field keeps how a wind-up was begun, and aims its release by it', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(canvas).toMatch(/windupRef\.current = \{[^}]*\bby\b/);
    expect(canvas).toMatch(/aimFrom\(playerPos, held\.by\)/);
    // The click that begins a blow says so
    expect(canvas).toMatch(/fireRef\.current\(Date\.now\(\), 'pointer'\)/);
  });
});

/**
 * SH3, a fault the brief named: a glance was never said. `CombatMath.outgoing` rolls it at the release (one hit in
 * five at F, half of the blow) and the field kept only the damage, so half a blow landed with nothing on screen to
 * tell it from a whole one. A glance now rides the shot or the swing to the body, the hit says it glanced, and the
 * field says so in words.
 */

installShippedThemes();
const mobs = () => Object.values(ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.mobs);
const goatAt = (x: number, health = 100): Record<string, IChunk> => {
  const goat = mobs().find(m => m.name === 'Collateral Goat')!;
  return { '0,0': { x: 0, y: 0, biome: BiomeType.RUINS, scanLevel: ScanLevel.COMPLETE, entities: [{ id: 'goat', type: EntityType.MOB, definitionId: goat.id, position: { x, y: 0 }, rank: 'F', rarity: 'COMMON', health, isHostile: true }] } as unknown as IChunk };
};

describe('SH3: a glance is carried to the body and said', () => {
  it('a fired pattern hands its glance to every shot of it', () => {
    const shots = ProjectileSystem.liveShots({ type: PatternType.SINGLE, origin: { x: 0, y: 0 }, startTime: 0, angle: 0, damage: 5, glance: true }, id => id, 100, 80, new Map());
    expect(shots.length).toBe(1);
    expect(shots[0].glance).toBe(true);
  });
  it('a shot that glanced says so where it lands; one that did not says nothing of it', () => {
    const shot = (glance?: boolean) => ({ id: 's', x: 30, y: 0, angle: 0, speed: 200, spawnTime: 0, lifespan: 2, color: 'x', damage: 5, prevX: 20, prevY: 0, ...(glance ? { glance } : {}) });
    const hit = (g?: boolean) => CombatSystem.tick([shot(g)], goatAt(30), { x: 0, y: 0, z: 0 }, 100, []).events.find(e => e.type === 'HIT');
    expect(hit(true)?.glance).toBe(true);
    expect(hit()?.glance).toBeFalsy();
  });
  it('a swing that glanced says so too', () => {
    const arc = { origin: { x: 0, y: 0 }, angle: 0, range: 60, inner: 0, half: 0.75, startTime: Date.now(), damage: 5, glance: true };
    const hit = CombatSystem.tick([], goatAt(30), { x: 0, y: 0, z: 0 }, 100, [arc]).events.find(e => e.type === 'HIT');
    expect(hit?.glance).toBe(true);
  });
  it('the field keeps the glance it rolled and says it in words', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(canvas).toMatch(/const \{ damage, poison, glance \} = CombatMath\.outgoing\(/);
    expect(canvas).toMatch(/event\.glance/);
    expect(canvas).toMatch(/glances/);
  });
});

/**
 * SH4, a fault the brief named: a shot drawn across a body did nothing. A shot landed within 20 px of a body's
 * middle whatever its size, so on a body drawn wider than that (a gigantic one is 64 px across, a colossal one 96)
 * a shot could be seen to cross its edge and fly on. A shot lands on any part of a body it is drawn over: the
 * body's own drawn half-width and the shot's own (4 px drawn), and never less than the 20 px the field always
 * gave, so nothing small is harder to hit than it was.
 */

describe('SH4: a shot lands on any part of a body it is drawn over', () => {
  const at = (name: string, passPx: number) => {
    const def = mobs().find(m => m.name === name)!;
    const chunk = { '0,0': { x: 0, y: 0, biome: BiomeType.RUINS, scanLevel: ScanLevel.COMPLETE, entities: [{ id: 'b', type: EntityType.MOB, definitionId: def.id, position: { x: 100, y: passPx }, rank: 'F', rarity: 'COMMON', health: 500, isHostile: true }] } as unknown as IChunk };
    const shot = { id: 's', x: 120, y: 0, angle: 0, speed: 200, spawnTime: 0, lifespan: 2, color: 'x', damage: 5, prevX: 80, prevY: 0 };
    return CombatSystem.tick([shot], chunk, { x: 0, y: 0, z: 0 }, 100, []).events.some(e => e.type === 'HIT');
  };
  it('reads the drawn body: its half-width and the shot\'s, never under the old 20 px', () => {
    expect(SHOT_LANDS_PX).toBe(20);
    expect(shotLandsWithinPx('GIGANTIC')).toBe(bodyRadiusPx('GIGANTIC') + 2);
    expect(shotLandsWithinPx('COLOSSAL')).toBe(bodyRadiusPx('COLOSSAL') + 2);
    expect(shotLandsWithinPx('LARGE')).toBe(bodyRadiusPx('LARGE') + 2);
    expect(shotLandsWithinPx('MEDIUM')).toBe(20);
    expect(shotLandsWithinPx('TINY')).toBe(20);
  });
  it('a shot crossing a gigantic body\'s edge lands; one passing a middling body at the same distance does not', () => {
    expect(at('The Auditor General', 28)).toBe(true);
    expect(at('Collateral Goat', 28)).toBe(false);
    expect(at('Collateral Goat', 18)).toBe(true);
    expect(at('Tally Rat', 18)).toBe(true);
  });
});

/**
 * SH5, found by shooting as Pedro did: the attack key aimed at whatever the inspect card held, and the card holds
 * whatever the cursor rests on. In a wood the cursor rests on a tree, so a shot fired by the key flew at the tree
 * (176 degrees off a body standing ahead, every hand alike). The key aims at what the card holds only when it is a
 * body a blow lands on (a creature, or a post still standing); otherwise the way its holder faces.
 */

describe('SH5: the attack key aims at a body the card holds, never at a tree', () => {
  it('a creature and a standing post are bodies a blow lands on; a tree, a chest and a fallen post are not', () => {
    expect(landsOn({ type: EntityType.MOB } as any)).toBe(true);
    expect(landsOn({ type: EntityType.STRUCTURE, structure: {} } as any)).toBe(true);
    expect(landsOn({ type: EntityType.STRUCTURE, structure: { brokenAt: 5 } } as any)).toBe(false);
    expect(landsOn({ type: EntityType.RESOURCE } as any)).toBe(false);
    expect(landsOn({ type: EntityType.CONTAINER } as any)).toBe(false);
  });
  it('the field aims the key only at what the card holds when a blow lands on it', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(canvas).toMatch(/near\.find\(n => n\.id === inspectedIdRef\.current && landsOn\(n\)\)/);
  });
});

/**
 * SH6, found by shooting as Pedro did: a hand fired at its own rate and what everything else worn adds, and
 * "everything else" took in what the other hand wields. A newcomer with the focus kit holds the abacus (0.93 a
 * second) in the right hand, so the empty left hand threw at 1.93 a second where a bare hand throws at one: a
 * throw every 600 ms (its draw, the cycle's floor) where it should be every second. What another hand wields
 * keeps its own rate to itself; a piece worn elsewhere that adds a rate (a ring, a quiver's haste) still adds it.
 */

describe('SH6: what another hand wields keeps its own rate to itself', () => {
  const piece = (id: string, slot: SlotType, stats: Record<string, number>) => ({ id, name: id, slot, tags: [], stats: { durability: 100, maxDurability: 100, ...stats } } as unknown as IItem);
  const wearing = (pairs: [string, IItem][]): IEquipmentState => ({ slots: Object.fromEntries(pairs.map(([s, i]) => [s, i.id])), items: pairs.map(p => p[1]), frames: {}, protected: [] } as unknown as IEquipmentState);
  const abacus = piece('abacus', SlotType.MAIN_HAND, { attack_speed: 0.93 });
  const blade = piece('blade', SlotType.MAIN_HAND, { attack_speed: 1.32 });
  const ring = piece('ring', SlotType.RING, { attack_speed: 0.5 });
  it('the empty hand throws at a bare hand\'s rate whatever the other hand holds', () => {
    const bare = Math.round(1000 / UNARMED_SHOTS_PER_SEC);
    expect(CombatMath.fireCooldownMs(undefined, wearing([['RIGHT_HAND', abacus]]))).toBe(bare);
    expect(CombatMath.fireCooldownMs(undefined, wearing([['RIGHT_HAND', blade]]))).toBe(bare);
  });
  it('a hand\'s own weapon keeps its own rate beside another weapon', () => {
    const other = piece('blade2', SlotType.MAIN_HAND, { attack_speed: 1.5 });
    expect(CombatMath.fireCooldownMs(blade, wearing([['RIGHT_HAND', blade], ['LEFT_HAND', other]]))).toBe(Math.round(1000 / 1.32));
  });
  it('what is worn elsewhere still adds its rate', () => {
    expect(CombatMath.fireCooldownMs(undefined, wearing([['RIGHT_HAND', abacus], ['RING_1', ring]]))).toBe(Math.round(1000 / 1.5));
    expect(CombatMath.fireCooldownMs(blade, wearing([['RIGHT_HAND', blade], ['RING_1', ring]]))).toBe(Math.round(1000 / 1.82));
  });
});

/**
 * SH7, found by strafing and shooting as Pedro did ("I think it's direction, I was strafing and shooting"): the way
 * a person faces was read from the step the walk took this frame, after the draw's pace scaled it. A draw stands
 * (pace 0), so with a movement key held the step was nothing, and nothing read as facing up: every blow aimed by
 * the facing (the attack key, and before SH2 a click) flew north while the person strafed. The facing comes from
 * the keys held, whatever the draw lets the body do.
 */
import { walkFacing } from '../src/logic/systems/FieldInput';

describe('SH7: the facing is the way the keys point, not the step the draw allowed', () => {
  it('reads the keys\' own direction, and a frame with no keys keeps the facing it had', () => {
    expect(walkFacing(1, 0, 'up')).toBe('right');
    expect(walkFacing(-1, 0, 'up')).toBe('left');
    expect(walkFacing(0, 1, 'up')).toBe('down');
    expect(walkFacing(0, -1, 'right')).toBe('up');
    expect(walkFacing(0, 0, 'left')).toBe('left');
    // A diagonal reads as its side, as the step did
    expect(walkFacing(1, -1, 'down')).toBe('up');
  });
  it('the field sets the facing from the keys before the draw\'s pace scales the step', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    const keysAt = canvas.indexOf('facingRef.current = walkFacing(');
    const paceAt = canvas.indexOf('(windupRef.current?.pace ?? 1)');
    expect(keysAt).toBeGreaterThan(0);
    expect(keysAt).toBeLessThan(paceAt);
    expect(canvas).not.toMatch(/facingRef\.current = Math\.abs\(dx\) > Math\.abs\(dz\)/);
  });
});

/**
 * SH8, the coordinator's call after strafing as Pedro did: with SH7 fixed, the attack key fired the way the keys
 * point, so a person strafing with the key held and the pointer resting just off a body fired along the walk, 55 to
 * 180 degrees off the pointer. With the pointer over the field the inspect card already follows the pointer, so only
 * empty ground fell back to the facing. Now the key aims at the pointer while the pointer rests over the field, as a
 * click does; off the field (over the panels, or out of the window), at what the card holds or the way the keys point.
 */
describe('SH8: the attack key aims at the pointer while it rests over the field', () => {
  const centre = { x: 500, y: 400 };
  it('over the field, the pointer; off it, the card or the facing', () => {
    expect(aimAt({ by: 'key', pointer: { x: 500, y: 300 }, onField: true, centre, facing: 'right' })).toBeCloseTo(-Math.PI / 2);
    expect(aimAt({ by: 'key', pointer: { x: 500, y: 300 }, onField: true, centre, held: { dx: 0, dy: 50 }, facing: 'right' })).toBeCloseTo(-Math.PI / 2);
    expect(aimAt({ by: 'key', pointer: { x: 500, y: 300 }, onField: false, centre, held: { dx: 0, dy: 50 }, facing: 'right' })).toBeCloseTo(Math.PI / 2);
    expect(aimAt({ by: 'key', pointer: { x: 500, y: 300 }, onField: false, centre, facing: 'left' })).toBeCloseTo(Math.PI);
  });
  it('the field tells the aim whether the pointer rests over the ground', () => {
    const canvas = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(canvas).toMatch(/onField: !!mouseRef\.current/);
  });
});

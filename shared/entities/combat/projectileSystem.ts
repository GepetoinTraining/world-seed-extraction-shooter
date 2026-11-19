import { IShotShape, SHOT_FLIGHT_S, SHOT_SPEED_PX, shotAt, shotFlightS, shotsOf, volleyShape } from '../../logic/theme/ThemeFormula';
import type { Volley } from '../../logic/theme/ThemeTypes';

export interface IProjectile {
  id: string;
  x: number;      // FIXED: Was 'startX'
  y: number;      // FIXED: Was 'startY'
  angle: number;
  speed: number;
  spawnTime: number;
  lifespan: number;
  color: string;
  damage?: number; // Wave 4: carried from the weapon/mob that fired it
  poison?: number; // Layer 0: what the blade left on it
  status?: { kind: 'dot' | 'slow' | 'stun' | 'ward' | 'haste' | 'weaken' | 'stagger'; magnitude: number; durationMs: number; tickMs?: number }; // Layer 1: what it leaves behind
  // Position on the previous frame, so a slow frame cannot skip over a target
  prevX?: number;
  prevY?: number;
  /** The fight's shapes: who its volley has already struck. A volley lands once on one body; its other shots stop there and do nothing. */
  struck?: Set<string>;
  /** Part 2: what it weighs when it lands, so the body it lands on feels it. None is not felt. */
  weight?: number;
  /** SH3: the blow it carries glanced when it was let go, so where it lands says so. */
  glance?: boolean;
}

const PROJECTILE_SPEED_PX = SHOT_SPEED_PX; // 10 tiles/s at 20px tiles
const PROJECTILE_FLIGHT_S = SHOT_FLIGHT_S;
export const PROJECTILE_RANGE_PX = PROJECTILE_SPEED_PX * PROJECTILE_FLIGHT_S;
/** How far past a shot's range things keep simulating, so they are live before they come into reach. */
export const SIM_MARGIN_PX = 100;

export enum PatternType {
  SINGLE = 'SINGLE',
  SHOTGUN = 'SHOTGUN',
  SPIRAL = 'SPIRAL',
  NOVA = 'NOVA'
}

/** The fight's shapes: the pattern a volley word flies as. The shots in it are the formula's (`volleyShots`). */
const PATTERN_OF: Record<Volley, PatternType> = { single: PatternType.SINGLE, spread: PatternType.SHOTGUN, spiral: PatternType.SPIRAL, ring: PatternType.NOVA };
export const patternOf = (volley: Volley): PatternType => PATTERN_OF[volley] ?? PatternType.SINGLE;
const volleyOfPattern = (type: PatternType): Volley =>
  (Object.keys(PATTERN_OF) as Volley[]).find(v => PATTERN_OF[v] === type) ?? 'single';

/**
 * A fired pattern, as the field keeps it. `shape` is how its shots leave and fly (`IShotShape`); none is its word's
 * plain middle. `rangePx` shortens that flight (a thrown stone); none is the shape's whole reach.
 */
export interface IFiredPattern {
  type: PatternType;
  origin: { x: number; y: number };
  startTime: number;
  angle: number;
  damage?: number;
  poison?: number;
  status?: IProjectile['status'];
  struck?: Set<string>;
  rangePx?: number;
  /** Shots read off what fires them (`ShotLaw`): the point this volley flies as. */
  shape?: IShotShape;
  /** Part 2: what each of its shots weighs when it lands. */
  weight?: number;
  /** SH3: the blow glanced when it was let go. */
  glance?: boolean;
}

type Flown = { type: PatternType; rangePx?: number; shape?: IShotShape };

export class ProjectileSystem {

  /** The point a pattern flies as: its own shape, or its word's middle, its reach shortened where the pattern says so. */
  static shapeOf(pattern: Flown): IShotShape {
    const shape = pattern.shape ?? volleyShape(volleyOfPattern(pattern.type));
    return pattern.rangePx !== undefined && pattern.rangePx < shape.reachPx ? { ...shape, reachPx: pattern.rangePx } : shape;
  }

  /**
   * Every shot of a pattern still in the air at `currentTime`, recomputed from time: each leaves the origin
   * when its own delay has passed, down its own lane off the aim, and flies its shape's path (`shotAt`).
   * `backMs` is how long ago the frame before was, so each shot also says where it was then.
   */
  static getProjectilesAtTime(
    pattern: PatternType,
    origin: {x: number, y: number},
    startTime: number,
    currentTime: number,
    baseAngle: number,
    flightS?: number,
    shape?: IShotShape,
    backMs: number = 0
  ): IProjectile[] {

    const elapsed = (currentTime - startTime) / 1000;
    if (elapsed < 0) return [];

    const word = shape ?? volleyShape(volleyOfPattern(pattern));
    const flown = flightS !== undefined && flightS * word.speedPx < word.reachPx ? { ...word, reachPx: flightS * word.speedPx } : word;
    // A shortened flight is the same path cut short, never a tighter bend
    const life = shotFlightS(flown);
    const bullets: IProjectile[] = [];
    const colour = pattern === PatternType.NOVA ? 'cyan' : pattern === PatternType.SINGLE ? 'yellow' : 'red';

    shotsOf(word).forEach((shot, i) => {
      const age = elapsed - shot.delayMs / 1000;
      if (age < 0 || age > life) return;
      const lane = baseAngle + shot.offset;
      const here = shotAt(word, lane, word.speedPx * age);
      const before = shotAt(word, lane, word.speedPx * Math.max(0, age - Math.max(0, backMs) / 1000));
      bullets.push({
        id: `p_${i}`,
        x: origin.x + here.x,
        y: origin.y + here.y,
        angle: here.heading,
        speed: word.speedPx,
        spawnTime: startTime + shot.delayMs,
        lifespan: life,
        color: colour,
        prevX: origin.x + before.x,
        prevY: origin.y + before.y
      });
    });

    return bullets;
  }

  /** How long a pattern has shots in the air: its last shot's delay and one whole flight. */
  static lifeMs(pattern: Flown): number {
    const shape = this.shapeOf(pattern);
    const last = Math.max(...shotsOf(shape).map(s => s.delayMs));
    return last + shotFlightS(shape) * 1000;
  }

  static alive(pattern: Flown & { startTime: number }, now: number): boolean {
    return now - pattern.startTime < this.lifeMs(pattern);
  }

  /**
   * Projectiles of one firing pattern that are still in flight this frame.
   * Positions are recomputed from time, so `spent` remembers shots that landed.
   */
  static liveShots(
    pattern: IFiredPattern,
    shotId: (bulletId: string) => string,
    now: number,
    prevTick: number,
    spent: Map<string, number>
  ): IProjectile[] {
    const shape = pattern.shape ?? volleyShape(volleyOfPattern(pattern.type));
    const flightS = pattern.rangePx !== undefined ? pattern.rangePx / shape.speedPx : undefined;
    return this.getProjectilesAtTime(pattern.type, pattern.origin, pattern.startTime, now, pattern.angle, flightS, shape, now - prevTick)
      .map(b => ({
        ...b,
        id: shotId(b.id),
        damage: pattern.damage,
        poison: pattern.poison,
        status: pattern.status,
        ...(pattern.struck ? { struck: pattern.struck } : {}),
        ...(pattern.weight !== undefined ? { weight: pattern.weight } : {}),
        ...(pattern.glance ? { glance: true } : {})
      }))
      .filter(b => !spent.has(b.id));
  }

  /** Closest approach of a projectile's path this frame to a point. */
  static sweptDistance(bullet: IProjectile, px: number, py: number): number {
    const ax = bullet.prevX ?? bullet.x;
    const ay = bullet.prevY ?? bullet.y;
    const abx = bullet.x - ax;
    const aby = bullet.y - ay;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
    return Math.hypot(ax + abx * t - px, ay + aby * t - py);
  }

  // --- NEW: COLLISION/DEFLECTION LOGIC ---
  static checkDeflection(bullet: IProjectile, swingOrigin: {x: number, y: number}, swingAngle: number): boolean {
      // Simple check: Is bullet within swing range (2.0) and within arc?
      const dx = bullet.x - swingOrigin.x;
      const dy = bullet.y - swingOrigin.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist > 40) return false; // 2 tiles in px

      const angleToBullet = Math.atan2(dy, dx);
      const angleDiff = Math.abs(angleToBullet - swingAngle);

      // 0.75 rad is roughly 45 degrees
      return angleDiff < 0.75;
  }
}

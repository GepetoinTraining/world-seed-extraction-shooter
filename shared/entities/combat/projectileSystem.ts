import { SHOT_FLIGHT_S, SHOT_SPEED_PX, volleyShots } from '../../logic/theme/ThemeFormula';
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
  status?: { kind: 'dot' | 'slow' | 'stun' | 'ward' | 'haste' | 'weaken'; magnitude: number; durationMs: number; tickMs?: number }; // Layer 1: what it leaves behind
  // Position on the previous frame, so a slow frame cannot skip over a target
  prevX?: number;
  prevY?: number;
  /** The fight's shapes: who its volley has already struck. A volley lands once on one body; its other shots stop there and do nothing. */
  struck?: Set<string>;
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

/** A fired pattern, as the field keeps it. `rangePx` shortens a shot's flight (a thrown stone); none is a shot's whole flight. */
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
}

export class ProjectileSystem {

  /**
   * Every shot of a pattern still in the air at `currentTime`, recomputed from time: each leaves the origin
   * when its own delay has passed, at its own angle off the aim, and flies for the pattern's flight.
   */
  static getProjectilesAtTime(
    pattern: PatternType,
    origin: {x: number, y: number},
    startTime: number,
    currentTime: number,
    baseAngle: number,
    flightS: number = PROJECTILE_FLIGHT_S
  ): IProjectile[] {

    const elapsed = (currentTime - startTime) / 1000;
    if (elapsed < 0) return [];

    const bullets: IProjectile[] = [];
    const speed = PROJECTILE_SPEED_PX;
    const colour = pattern === PatternType.NOVA ? 'cyan' : pattern === PatternType.SINGLE ? 'yellow' : 'red';

    volleyShots(volleyOfPattern(pattern)).forEach((shot, i) => {
      const age = elapsed - shot.delayMs / 1000;
      if (age < 0 || age > flightS) return;
      const a = baseAngle + shot.offset;
      const dist = speed * age;
      bullets.push({
        id: `p_${i}`,
        x: origin.x + Math.cos(a) * dist,
        y: origin.y + Math.sin(a) * dist,
        angle: a,
        speed,
        spawnTime: startTime + shot.delayMs,
        lifespan: flightS,
        color: colour
      });
    });

    return bullets;
  }

  /** How long a pattern has shots in the air: its last shot's delay and one whole flight. */
  static lifeMs(pattern: { type: PatternType; rangePx?: number }): number {
    const last = Math.max(...volleyShots(volleyOfPattern(pattern.type)).map(s => s.delayMs));
    return last + this.flightS(pattern) * 1000;
  }

  static alive(pattern: { type: PatternType; startTime: number; rangePx?: number }, now: number): boolean {
    return now - pattern.startTime < this.lifeMs(pattern);
  }

  private static flightS(pattern: { rangePx?: number }): number {
    return pattern.rangePx !== undefined ? Math.min(PROJECTILE_FLIGHT_S, pattern.rangePx / PROJECTILE_SPEED_PX) : PROJECTILE_FLIGHT_S;
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
    return this.getProjectilesAtTime(pattern.type, pattern.origin, pattern.startTime, now, pattern.angle, this.flightS(pattern))
      .map(b => {
        const back = (Math.min(now - prevTick, now - b.spawnTime) / 1000) * b.speed;
        return {
          ...b,
          id: shotId(b.id),
          damage: pattern.damage,
          poison: pattern.poison,
          status: pattern.status,
          ...(pattern.struck ? { struck: pattern.struck } : {}),
          prevX: b.x - Math.cos(b.angle) * back,
          prevY: b.y - Math.sin(b.angle) * back
        };
      })
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

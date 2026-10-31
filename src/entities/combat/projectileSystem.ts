

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
  // Position on the previous frame, so a slow frame cannot skip over a target
  prevX?: number;
  prevY?: number;
}

const PROJECTILE_SPEED_PX = 200; // 10 tiles/s at 20px tiles
const PROJECTILE_FLIGHT_S = 2.0;
export const PROJECTILE_RANGE_PX = PROJECTILE_SPEED_PX * PROJECTILE_FLIGHT_S;
export const SIM_RADIUS_CHUNKS = Math.ceil(PROJECTILE_RANGE_PX / 100) + 1;

export enum PatternType {
  SINGLE = 'SINGLE',
  SHOTGUN = 'SHOTGUN',
  SPIRAL = 'SPIRAL',
  NOVA = 'NOVA'
}

export class ProjectileSystem {
  
  static getProjectilesAtTime(
    pattern: PatternType, 
    origin: {x: number, y: number}, 
    startTime: number, 
    currentTime: number,
    baseAngle: number
  ): IProjectile[] {
    
    const elapsed = (currentTime - startTime) / 1000;
    if (elapsed < 0) return [];

    const bullets: IProjectile[] = [];
    const speed = PROJECTILE_SPEED_PX;
    const range = PROJECTILE_FLIGHT_S;

    if (elapsed > range) return [];

    const dist = speed * elapsed;

    // Helper to create projectile
    const makeProj = (id: string, a: number, c: string): IProjectile => ({
        id,
        x: origin.x + Math.cos(a) * dist,
        y: origin.y + Math.sin(a) * dist,
        angle: a,
        speed,
        spawnTime: startTime,
        lifespan: range,
        color: c
    });

    switch (pattern) {
      case PatternType.SINGLE:
        bullets.push(makeProj('p_0', baseAngle, 'yellow'));
        break;

      case PatternType.SHOTGUN:
        [-0.25, 0, 0.25].forEach((offset, idx) => {
          bullets.push(makeProj(`p_${idx}`, baseAngle + offset, 'red'));
        });
        break;

      case PatternType.NOVA:
        for(let i=0; i<8; i++) {
          bullets.push(makeProj(`p_${i}`, baseAngle + (i * (Math.PI / 4)), 'cyan'));
        }
        break;
    }

    return bullets;
  }
  
  /**
   * Projectiles of one firing pattern that are still in flight this frame.
   * Positions are recomputed from time, so `spent` remembers shots that landed.
   */
  static liveShots(
    pattern: { type: PatternType; origin: { x: number; y: number }; startTime: number; angle: number; damage?: number },
    shotId: (bulletId: string) => string,
    now: number,
    prevTick: number,
    spent: Map<string, number>
  ): IProjectile[] {
    return this.getProjectilesAtTime(pattern.type, pattern.origin, pattern.startTime, now, pattern.angle)
      .map(b => {
        const back = (Math.min(now - prevTick, now - pattern.startTime) / 1000) * b.speed;
        return {
          ...b,
          id: shotId(b.id),
          damage: pattern.damage,
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
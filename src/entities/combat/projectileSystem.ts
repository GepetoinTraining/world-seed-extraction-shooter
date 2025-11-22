import { IActiveSession } from '../../../types';

export interface IProjectile {
  id: string;
  x: startX,
  y: startY,
  angle: number; // Radians
  speed: number; // Units per sec
  spawnTime: number; // Timestamp
  lifespan: number; // Seconds
  color: string;
}

export enum PatternType {
  SINGLE = 'SINGLE',
  SHOTGUN = 'SHOTGUN', // Multiple angles spread
  SPIRAL = 'SPIRAL',   // Rotating emitter
  NOVA = 'NOVA'        // 360 burst
}

export class ProjectileSystem {
  
  // This function is deterministic. 
  // Given a timestamp and a pattern, it tells you where every bullet is RIGHT NOW.
  // No need to store bullet state frame-by-frame.
  static getProjectilesAtTime(
    pattern: PatternType, 
    origin: {x: number, y: number}, 
    startTime: number, 
    currentTime: number,
    baseAngle: number
  ): IProjectile[] {
    
    const elapsed = (currentTime - startTime) / 1000; // Seconds
    if (elapsed < 0) return [];

    const bullets: IProjectile[] = [];
    const speed = 10; // Base speed
    const range = 2.0; // Base lifespan (seconds)

    if (elapsed > range) return []; // Bullets died

    const dist = speed * elapsed;

    switch (pattern) {
      case PatternType.SINGLE:
        bullets.push({
          id: 'p_0',
          x: origin.x + Math.cos(baseAngle) * dist,
          y: origin.y + Math.sin(baseAngle) * dist,
          angle: baseAngle,
          speed, spawnTime: startTime, lifespan: range, color: 'yellow'
        });
        break;

      case PatternType.SHOTGUN:
        // 3 Bullets: -15, 0, +15 degrees
        [-0.25, 0, 0.25].forEach((offset, idx) => {
          const a = baseAngle + offset;
          bullets.push({
            id: `p_${idx}`,
            x: origin.x + Math.cos(a) * dist,
            y: origin.y + Math.sin(a) * dist,
            angle: a,
            speed, spawnTime: startTime, lifespan: range, color: 'red'
          });
        });
        break;

      case PatternType.NOVA:
        // 8 Bullets in a circle
        for(let i=0; i<8; i++) {
          const a = baseAngle + (i * (Math.PI / 4));
          bullets.push({
            id: `p_${i}`,
            x: origin.x + Math.cos(a) * dist,
            y: origin.y + Math.sin(a) * dist,
            angle: a,
            speed, spawnTime: startTime, lifespan: range, color: 'cyan'
          });
        }
        break;
    }

    return bullets;
  }
}